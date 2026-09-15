-- Shamo v2.6: seed-by-question-id similar-question retrieval for the tutor API.
--
-- Run this complete file once in the Supabase SQL Editor as the postgres role.
-- It adds ONE service-role-only function. It does not change stored papers,
-- questions, metadata, mark schemes, assets, embeddings, indexes, constraints,
-- or any existing function. Reversible with a single drop function.
--
-- WHY
-- ---
-- shamo_match_similar_questions_same_component already encodes every policy
-- worth keeping (published-only, ingestion-run pinning, same qualification /
-- syllabus / paper component, own-paper exclusion, one row per question, an
-- HNSW-friendly candidate pool). But it takes a 512-dimension query VECTOR.
-- A tutor backend holding only a question reference therefore had two bad
-- options: ship 512 floats out of the database and straight back in on every
-- request, or pay OpenAI to re-embed text the corpus already stores -- which
-- also risks embedding text that is not byte-identical to what was embedded
-- at ingestion, so results would quietly drift from the stored index.
--
-- This function takes the seed's question_id, resolves that embedding itself,
-- and DELEGATES the matching to the existing function rather than restating
-- it. The matching SQL stays defined in exactly one place.
--
-- SEED EMBEDDING RULE
-- -------------------
-- Prefer the whole-question search row (question_part_id is null). 155 of the
-- 947 published questions have no such row, because shamo_v2_search_indexing_
-- patch.sql only creates one where btrim(stem_markdown) <> '' -- a question
-- whose text lives entirely in its parts has part rows and nothing else.
-- Those are exactly the questions that would otherwise be unservable. Fall
-- back to the FIRST part by shamo_question_parts.sort_order, tie-broken on
-- (label_path, id) so the choice is deterministic across runs and replicas.
-- Postgres orders false < true, so ordering on (question_part_id is not null)
-- puts the whole-question row first and the later keys only ever break ties
-- among part rows.
--
-- POLICY: the 0.60 similarity floor is MEASURED, not guessed
-- ---------------------------------------------------------
-- Sampling 120 seed questions per syllabus and comparing each match's
-- main_topic against its seed's (15 September 2026):
--
--   similarity      share of matches sharing the seed's main_topic
--   < 0.50          30-42%
--   0.50 - 0.60     43-46%
--   0.60 - 0.70     56-68%
--   0.70 - 0.80     63-68%
--   0.80+           76-85%
--
-- Coverage at each candidate floor:
--
--   floor   questions returning >= 3 matches   questions returning none
--   0.55    86-91%                             --
--   0.60    74-78%                             7-11%
--   0.65    49-69%                             16%
--
-- 0.60 is the knee: the last point where most questions still get a usable
-- list while topic agreement stays meaningfully above chance. Returning a
-- 0.55 match to a student labelled "similar" is worse than returning nothing,
-- so roughly one question in ten is EXPECTED to return no matches, and that
-- is a correct answer rather than a failure.
--
-- Note the floor's real semantics, which are more permissive than they look:
-- the inner function applies min_similarity per SEARCH ROW, before collapsing
-- to one row per question, so a question qualifies when ANY of its part rows
-- clears the floor. Measured on the live corpus, 39.8% of matches at 0.60 are
-- matched on a part row rather than the whole question. That is deliberate --
-- it is what keeps the 155 stemless questions above -- but it means real
-- precision sits slightly below the table above, so this function returns
-- matched_on_part to keep the effect visible and measurable.
--
-- Explanation is metadata-derived only: main_topic, total_marks, marks and
-- paper identity, all already stored and reviewed. No model is called and no
-- rationale is generated, so nothing about a recommendation can be invented.
--
-- THE EMPTY STATE IS A ROW, NOT AN ABSENCE
-- ----------------------------------------
-- Four different situations produce zero recommendations and a caller has to
-- tell them apart: the seed is not published; the component is not ready yet;
-- the seed has no embedding at all; or we looked and nothing cleared the
-- floor. So this function always returns at least one row -- a sentinel with
-- null match columns and a result_status naming the reason.
--
-- CONTRACT NOTE: backend_v2/app/models.py validates result_status against
-- SimilarQuestionsStatus. Adding a status value here without adding the
-- matching Python enum member will produce a 500 on every affected response.
-- That is deliberate pressure to keep the two in sync -- change both.

begin;

create or replace function public.shamo_match_similar_questions_for_question(
    requested_seed_question_id uuid,
    requested_limit integer default 5,
    requested_qualification text default null,
    requested_syllabus_code text default null,
    min_same_component_papers integer default 2,
    min_cross_paper_questions integer default 5,
    min_similarity double precision default 0.60
)
returns table (
    result_status text,
    seed_question_id uuid,
    seed_main_topic text,
    seed_total_marks integer,
    is_ready boolean,
    readiness_status text,
    same_component_paper_count bigint,
    same_component_cross_paper_question_count bigint,
    applied_min_similarity double precision,
    match_rank integer,
    question_id uuid,
    question_part_id uuid,
    matched_on_part boolean,
    qualification text,
    syllabus_code text,
    subject text,
    year smallint,
    exam_session text,
    paper_variant text,
    question_number integer,
    paper_component text,
    main_topic text,
    shares_main_topic boolean,
    total_marks integer,
    stem_snippet text,
    similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
    with seed as (
        select
            seed_question.id as seed_question_id,
            seed_question.ingestion_run_id as seed_ingestion_run_id,
            seed_question.total_marks as seed_total_marks
        from public.shamo_questions as seed_question
        join public.shamo_papers as seed_paper
          on seed_paper.id = seed_question.paper_id
         and seed_paper.current_ingestion_run_id = seed_question.ingestion_run_id
        where seed_question.id = requested_seed_question_id
          and seed_paper.status = 'published'
          and (
              requested_qualification is null
              or seed_paper.qualification = requested_qualification
          )
          and (
              requested_syllabus_code is null
              or seed_paper.syllabus_code = requested_syllabus_code
          )
        limit 1
    ),
    seed_topic as (
        -- Left join, and pinned on the run as well as the question: the
        -- metadata primary key is question_id alone, so an unpinned join
        -- would happily return a superseded run's topic. A missing metadata
        -- row must weaken the explanation, never erase the whole result.
        select
            seed.seed_question_id,
            seed.seed_total_marks,
            seed_metadata.main_topic as seed_main_topic
        from seed
        left join public.shamo_question_metadata as seed_metadata
          on seed_metadata.question_id = seed.seed_question_id
         and seed_metadata.ingestion_run_id = seed.seed_ingestion_run_id
    ),
    seed_embedding as materialized (
        -- `materialized` is load-bearing, not a style choice. The inner
        -- matching function gets its HNSW index scan from
        -- `order by embedding <=> query_embedding`, which needs the query
        -- vector to be a runtime constant. Left inlinable, this lookup could
        -- become a correlated subquery inside that order by, which pgvector
        -- cannot serve from the index -- silently degrading to a full scan
        -- and sort of every embedded row.
        select distinct on (seed_search.question_id)
            seed_search.question_id as seed_question_id,
            seed_search.question_part_id as seed_question_part_id,
            seed_search.embedding as seed_embedding
        from seed
        join public.shamo_question_search as seed_search
          on seed_search.question_id = seed.seed_question_id
         and seed_search.ingestion_run_id = seed.seed_ingestion_run_id
         and seed_search.content_kind = 'question'
         and seed_search.embedding is not null
        left join public.shamo_question_parts as seed_part
          on seed_part.id = seed_search.question_part_id
         and seed_part.ingestion_run_id = seed_search.ingestion_run_id
        order by
            seed_search.question_id,
            (seed_search.question_part_id is not null),
            seed_part.sort_order,
            seed_part.label_path,
            seed_part.id
    ),
    readiness as (
        -- left join lateral, NOT cross join lateral. shamo_get_similarity_
        -- readiness returns zero rows for a seed that exists in a published
        -- paper whose whole component has no embedded search rows: its pool
        -- CTE produces no groups, and its not-found fallback branch only
        -- fires when the seed itself is missing. A cross join would collapse
        -- this entire result to nothing and the caller would be told only
        -- "unavailable", with no reason. Unreachable on today's corpus (zero
        -- pending embeddings), reachable the moment a component is published
        -- ahead of its embedding pass.
        select
            seed.seed_question_id,
            ready.is_ready,
            ready.status as readiness_status,
            ready.same_component_paper_count,
            ready.same_component_cross_paper_question_count
        from seed
        left join lateral public.shamo_get_similarity_readiness(
            seed.seed_question_id,
            requested_qualification,
            requested_syllabus_code,
            min_same_component_papers,
            min_cross_paper_questions
        ) as ready on true
    ),
    matched as (
        -- The delegation. This is the only place the matching function is
        -- called, and no part of its logic is restated here.
        --
        -- requested_seed_question_id is passed as excluded_question_id
        -- because that argument is both the seed identifier and the
        -- exclusion in the existing function's design -- it reads the seed's
        -- paper and component from it, then excludes it from the results.
        --
        -- The limit clamp is mandatory, not cosmetic. The inner function
        -- computes `least(requested_limit * 20, 1000)` and the multiply
        -- happens first, in integer arithmetic: any value above 107374182
        -- raises 22003 integer out of range. That was unreachable while only
        -- service_role could call it; the moment an HTTP endpoint forwards a
        -- caller-supplied limit, it is reachable by anyone. Clamped here so
        -- no value of requested_limit can reach the overflow.
        select
            match_row.question_id,
            match_row.question_part_id,
            match_row.qualification,
            match_row.syllabus_code,
            match_row.year,
            match_row.exam_session,
            match_row.paper_variant,
            match_row.question_number,
            match_row.paper_component,
            match_row.similarity,
            row_number() over (
                order by match_row.similarity desc, match_row.question_id
            )::integer as match_rank
        from seed_embedding
        cross join lateral public.shamo_match_similar_questions_same_component(
            seed_embedding.seed_embedding,
            least(greatest(coalesce(requested_limit, 5), 1), 20),
            requested_qualification,
            requested_syllabus_code,
            requested_seed_question_id,
            min_same_component_papers,
            min_cross_paper_questions,
            min_similarity
        ) as match_row
    ),
    enriched as (
        select
            matched.question_id,
            matched.question_part_id,
            (matched.question_part_id is not null) as matched_on_part,
            matched.qualification,
            matched.syllabus_code,
            matched_paper.subject,
            matched.year,
            matched.exam_session,
            matched.paper_variant,
            matched.question_number,
            matched.paper_component,
            matched.similarity,
            matched.match_rank,
            matched_metadata.main_topic,
            coalesce(
                matched_metadata.main_topic = seed_topic.seed_main_topic,
                false
            ) as shares_main_topic,
            matched_question.total_marks,
            seed_topic.seed_main_topic,
            seed_topic.seed_total_marks,
            readiness.is_ready,
            readiness.readiness_status,
            readiness.same_component_paper_count,
            readiness.same_component_cross_paper_question_count,
            -- The first-part fallback is not defensive padding. The 155
            -- questions with no whole-question search row are exactly the
            -- questions with an empty stem, so without it roughly one card
            -- in six would render with no text at all.
            coalesce(
                nullif(btrim(matched_question.stem_markdown), ''),
                nullif(btrim(matched_first_part.prompt_markdown), ''),
                ''
            ) as stem_source
        from matched
        cross join seed_topic
        cross join readiness
        join public.shamo_questions as matched_question
          on matched_question.id = matched.question_id
        -- Re-asserts run pinning on the way out, so a superseded question
        -- row (the twice-published pilot paper) is dropped rather than shown.
        join public.shamo_papers as matched_paper
          on matched_paper.id = matched_question.paper_id
         and matched_paper.current_ingestion_run_id = matched_question.ingestion_run_id
         and matched_paper.status = 'published'
        left join public.shamo_question_metadata as matched_metadata
          on matched_metadata.question_id = matched_question.id
         and matched_metadata.ingestion_run_id = matched_question.ingestion_run_id
        left join lateral (
            select candidate_part.prompt_markdown
            from public.shamo_question_parts as candidate_part
            where candidate_part.question_id = matched_question.id
              and candidate_part.ingestion_run_id = matched_question.ingestion_run_id
            order by
                candidate_part.sort_order,
                candidate_part.label_path,
                candidate_part.id
            limit 1
        ) as matched_first_part on true
    )
    select combined.*
    from (
        select
            'ok'::text as result_status,
            requested_seed_question_id as seed_question_id,
            enriched.seed_main_topic,
            enriched.seed_total_marks,
            enriched.is_ready,
            enriched.readiness_status,
            enriched.same_component_paper_count,
            enriched.same_component_cross_paper_question_count,
            min_similarity as applied_min_similarity,
            enriched.match_rank,
            enriched.question_id,
            enriched.question_part_id,
            enriched.matched_on_part,
            enriched.qualification,
            enriched.syllabus_code,
            enriched.subject,
            enriched.year,
            enriched.exam_session,
            enriched.paper_variant,
            enriched.question_number,
            enriched.paper_component,
            enriched.main_topic,
            enriched.shares_main_topic,
            enriched.total_marks,
            -- Bounded at 240 characters to match the max_length the API
            -- model declares, so that bound is a guarantee rather than a
            -- hope. left(s, 237) || '...' lands on exactly 240. This can cut
            -- a LaTeX token in half, so the snippet is plain-text preview
            -- material and must not be rendered as mathematics.
            case
                when length(enriched.stem_source) > 240
                    then left(enriched.stem_source, 237) || '...'
                else enriched.stem_source
            end as stem_snippet,
            enriched.similarity
        from enriched

        union all

        -- The sentinel. Ordered most specific first: a seed that is not
        -- published explains everything else, and the readiness gate
        -- outranks a missing embedding because "this component has too few
        -- papers so far" is the honest, student-facing answer.
        select
            case
                when not exists (select 1 from seed)
                    then 'seed_not_published_or_not_found'
                when coalesce(
                    (select readiness.readiness_status from readiness),
                    'readiness_unavailable'
                ) <> 'ready'
                    then coalesce(
                        (select readiness.readiness_status from readiness),
                        'readiness_unavailable'
                    )
                when not exists (select 1 from seed_embedding)
                    then 'seed_embedding_missing'
                else 'no_matches_above_threshold'
            end::text as result_status,
            requested_seed_question_id as seed_question_id,
            (select seed_topic.seed_main_topic from seed_topic) as seed_main_topic,
            (select seed_topic.seed_total_marks from seed_topic) as seed_total_marks,
            coalesce((select readiness.is_ready from readiness), false) as is_ready,
            coalesce(
                (select readiness.readiness_status from readiness),
                'readiness_unavailable'
            ) as readiness_status,
            coalesce(
                (select readiness.same_component_paper_count from readiness),
                0::bigint
            ) as same_component_paper_count,
            coalesce(
                (select readiness.same_component_cross_paper_question_count from readiness),
                0::bigint
            ) as same_component_cross_paper_question_count,
            min_similarity as applied_min_similarity,
            null::integer as match_rank,
            null::uuid as question_id,
            null::uuid as question_part_id,
            null::boolean as matched_on_part,
            null::text as qualification,
            null::text as syllabus_code,
            null::text as subject,
            null::smallint as year,
            null::text as exam_session,
            null::text as paper_variant,
            null::integer as question_number,
            null::text as paper_component,
            null::text as main_topic,
            null::boolean as shares_main_topic,
            null::integer as total_marks,
            null::text as stem_snippet,
            null::double precision as similarity
        where not exists (select 1 from enriched)
    ) as combined
    order by combined.match_rank nulls last;
$$;

comment on function public.shamo_match_similar_questions_for_question(
    uuid,
    integer,
    text,
    text,
    integer,
    integer,
    double precision
) is
  'Same-component similar questions for one published seed question, addressed by id rather than by embedding. Resolves the seed embedding internally (whole-question row, else first part), delegates matching to shamo_match_similar_questions_same_component, and enriches results with reviewed metadata. Always returns at least one row; result_status names why when there are no matches.';

revoke execute on function public.shamo_match_similar_questions_for_question(
    uuid,
    integer,
    text,
    text,
    integer,
    integer,
    double precision
) from public, anon, authenticated;

grant execute on function public.shamo_match_similar_questions_for_question(
    uuid,
    integer,
    text,
    text,
    integer,
    integer,
    double precision
) to service_role;

commit;

-- Verification 1: the function is service-role-only.
select
    has_function_privilege(
        'service_role',
        'public.shamo_match_similar_questions_for_question(uuid,integer,text,text,integer,integer,double precision)',
        'execute'
    ) as service_role_can_execute,
    has_function_privilege(
        'anon',
        'public.shamo_match_similar_questions_for_question(uuid,integer,text,text,integer,integer,double precision)',
        'execute'
    ) as anon_can_execute,
    has_function_privilege(
        'authenticated',
        'public.shamo_match_similar_questions_for_question(uuid,integer,text,text,integer,integer,double precision)',
        'execute'
    ) as authenticated_can_execute;

-- Verification 2: a real published seed returns enriched matches above the floor.
with seed as (
    select question.id as seed_question_id
    from public.shamo_questions as question
    join public.shamo_papers as paper
      on paper.id = question.paper_id
     and paper.current_ingestion_run_id = question.ingestion_run_id
    where paper.status = 'published'
      and paper.syllabus_code = '9709'
      and left(paper.paper_variant, 1) = '1'
    order by question.id
    limit 1
)
select
    match_row.result_status,
    match_row.match_rank,
    match_row.syllabus_code,
    match_row.paper_variant,
    match_row.question_number,
    match_row.main_topic,
    match_row.shares_main_topic,
    match_row.total_marks,
    match_row.matched_on_part,
    round(match_row.similarity::numeric, 4) as similarity,
    length(match_row.stem_snippet) as snippet_length
from seed
cross join lateral public.shamo_match_similar_questions_for_question(
    seed.seed_question_id
) as match_row
order by match_row.match_rank nulls last;

-- Verification 3: an unknown seed returns exactly one explanatory sentinel row.
select
    count(*) as row_count,
    min(match_row.result_status) as result_status,
    bool_and(match_row.question_id is null) as no_match_columns
from public.shamo_match_similar_questions_for_question(
    gen_random_uuid()
) as match_row;
