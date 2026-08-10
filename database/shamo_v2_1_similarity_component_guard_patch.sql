-- Shamo v2.1: guarded same-component similar-question retrieval.
--
-- Run this complete file once in the Supabase SQL Editor as the postgres role.
-- It adds two service-role-only functions and does not change stored papers,
-- questions, metadata, mark schemes, assets, embeddings, or the existing broad
-- shamo_match_similar_questions diagnostic function.
--
-- Policy:
-- - compare Paper 1 with Paper 1, Paper 2 with Paper 2, and so on;
-- - exclude the seed question's own paper from recommendation candidates;
-- - return no recommendations unless the same component has at least two
--   published papers and at least five embedded cross-paper candidate questions.

begin;

create or replace function public.shamo_get_similarity_readiness(
    requested_seed_question_id uuid,
    requested_qualification text default null,
    requested_syllabus_code text default null,
    min_same_component_papers integer default 2,
    min_cross_paper_questions integer default 5
)
returns table (
    seed_question_id uuid,
    qualification text,
    syllabus_code text,
    paper_component text,
    same_component_paper_count bigint,
    same_component_cross_paper_question_count bigint,
    is_ready boolean,
    status text
)
language sql
stable
security invoker
set search_path = ''
as $$
    with seed as (
        select
            question.id as seed_question_id,
            paper.id as seed_paper_id,
            paper.qualification,
            paper.syllabus_code,
            left(paper.paper_variant, 1) as paper_component
        from public.shamo_questions as question
        join public.shamo_papers as paper
          on paper.id = question.paper_id
         and paper.current_ingestion_run_id = question.ingestion_run_id
        where question.id = requested_seed_question_id
          and paper.status = 'published'
          and (
              requested_qualification is null
              or paper.qualification = requested_qualification
          )
          and (
              requested_syllabus_code is null
              or paper.syllabus_code = requested_syllabus_code
          )
        limit 1
    ),
    pool as (
        select
            seed.seed_question_id,
            seed.qualification,
            seed.syllabus_code,
            seed.paper_component,
            count(distinct candidate_paper.id) as same_component_paper_count,
            count(distinct candidate_question.id) filter (
                where candidate_paper.id <> seed.seed_paper_id
            ) as same_component_cross_paper_question_count
        from seed
        join public.shamo_papers as candidate_paper
          on candidate_paper.qualification = seed.qualification
         and candidate_paper.syllabus_code = seed.syllabus_code
         and candidate_paper.status = 'published'
         and left(candidate_paper.paper_variant, 1) = seed.paper_component
        join public.shamo_questions as candidate_question
          on candidate_question.paper_id = candidate_paper.id
         and candidate_question.ingestion_run_id =
             candidate_paper.current_ingestion_run_id
        where exists (
            select 1
            from public.shamo_question_search as candidate_search
            where candidate_search.question_id = candidate_question.id
              and candidate_search.ingestion_run_id =
                  candidate_question.ingestion_run_id
              and candidate_search.content_kind = 'question'
              and candidate_search.embedding is not null
        )
        group by
            seed.seed_question_id,
            seed.qualification,
            seed.syllabus_code,
            seed.paper_component
    )
    select
        pool.seed_question_id,
        pool.qualification,
        pool.syllabus_code,
        pool.paper_component,
        pool.same_component_paper_count,
        pool.same_component_cross_paper_question_count,
        (
            pool.same_component_paper_count >=
                greatest(coalesce(min_same_component_papers, 2), 2)
            and pool.same_component_cross_paper_question_count >=
                greatest(coalesce(min_cross_paper_questions, 5), 1)
        ) as is_ready,
        case
            when pool.same_component_paper_count <
                greatest(coalesce(min_same_component_papers, 2), 2)
                then 'not_enough_same_component_papers'
            when pool.same_component_cross_paper_question_count <
                greatest(coalesce(min_cross_paper_questions, 5), 1)
                then 'not_enough_cross_paper_questions'
            else 'ready'
        end as status
    from pool

    union all

    select
        requested_seed_question_id,
        null::text,
        null::text,
        null::text,
        0::bigint,
        0::bigint,
        false,
        'seed_question_not_published_or_not_found'
    where not exists (select 1 from seed);
$$;

create or replace function public.shamo_match_similar_questions_same_component(
    query_embedding extensions.vector(512),
    requested_limit integer default 5,
    requested_qualification text default null,
    requested_syllabus_code text default null,
    excluded_question_id uuid default null,
    min_same_component_papers integer default 2,
    min_cross_paper_questions integer default 5,
    min_similarity double precision default null
)
returns table (
    question_id uuid,
    question_part_id uuid,
    qualification text,
    syllabus_code text,
    year smallint,
    exam_session text,
    paper_variant text,
    question_number integer,
    paper_component text,
    same_component_paper_count bigint,
    same_component_cross_paper_question_count bigint,
    similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
    with seed as (
        select
            question.id as seed_question_id,
            paper.id as seed_paper_id,
            paper.qualification,
            paper.syllabus_code,
            left(paper.paper_variant, 1) as paper_component
        from public.shamo_questions as question
        join public.shamo_papers as paper
          on paper.id = question.paper_id
         and paper.current_ingestion_run_id = question.ingestion_run_id
        where question.id = excluded_question_id
          and paper.status = 'published'
          and (
              requested_qualification is null
              or paper.qualification = requested_qualification
          )
          and (
              requested_syllabus_code is null
              or paper.syllabus_code = requested_syllabus_code
          )
        limit 1
    ),
    readiness as (
        select ready.*
        from seed
        cross join lateral public.shamo_get_similarity_readiness(
            seed.seed_question_id,
            requested_qualification,
            requested_syllabus_code,
            min_same_component_papers,
            min_cross_paper_questions
        ) as ready
        where ready.is_ready
    ),
    candidate_pool as materialized (
        select
            search_item.question_id,
            search_item.question_part_id,
            paper.qualification,
            paper.syllabus_code,
            paper.year,
            paper.exam_session,
            paper.paper_variant,
            left(paper.paper_variant, 1) as paper_component,
            question.question_number,
            readiness.same_component_paper_count,
            readiness.same_component_cross_paper_question_count,
            search_item.embedding
                operator(extensions.<=>)
                query_embedding as distance
        from readiness
        join seed
          on seed.seed_question_id = readiness.seed_question_id
        join public.shamo_question_search as search_item
          on search_item.content_kind = 'question'
         and search_item.embedding is not null
        join public.shamo_questions as question
          on question.id = search_item.question_id
         and question.ingestion_run_id = search_item.ingestion_run_id
        join public.shamo_papers as paper
          on paper.id = question.paper_id
         and paper.current_ingestion_run_id = search_item.ingestion_run_id
        where paper.status = 'published'
          and paper.qualification = seed.qualification
          and paper.syllabus_code = seed.syllabus_code
          and left(paper.paper_variant, 1) = seed.paper_component
          and paper.id <> seed.seed_paper_id
          and search_item.question_id <> seed.seed_question_id
        order by
            search_item.embedding
            operator(extensions.<=>)
            query_embedding
        limit greatest(
            10,
            least(
                coalesce(requested_limit, 5) * 20,
                1000
            )
        )
    ),
    best_per_question as (
        select distinct on (candidate.question_id)
            candidate.question_id,
            candidate.question_part_id,
            candidate.qualification,
            candidate.syllabus_code,
            candidate.year,
            candidate.exam_session,
            candidate.paper_variant,
            candidate.question_number,
            candidate.paper_component,
            candidate.same_component_paper_count,
            candidate.same_component_cross_paper_question_count,
            candidate.distance
        from candidate_pool as candidate
        where (
            min_similarity is null
            or 1 - candidate.distance >= min_similarity
        )
        order by
            candidate.question_id,
            candidate.distance,
            candidate.question_part_id nulls first
    )
    select
        best.question_id,
        best.question_part_id,
        best.qualification,
        best.syllabus_code,
        best.year,
        best.exam_session,
        best.paper_variant,
        best.question_number,
        best.paper_component,
        best.same_component_paper_count,
        best.same_component_cross_paper_question_count,
        1 - best.distance as similarity
    from best_per_question as best
    order by best.distance
    limit greatest(
        1,
        least(coalesce(requested_limit, 5), 20)
    );
$$;

revoke execute on function public.shamo_get_similarity_readiness(
    uuid,
    text,
    text,
    integer,
    integer
) from public, anon, authenticated;

revoke execute on function public.shamo_match_similar_questions_same_component(
    extensions.vector,
    integer,
    text,
    text,
    uuid,
    integer,
    integer,
    double precision
) from public, anon, authenticated;

grant execute on function public.shamo_get_similarity_readiness(
    uuid,
    text,
    text,
    integer,
    integer
) to service_role;

grant execute on function public.shamo_match_similar_questions_same_component(
    extensions.vector,
    integer,
    text,
    text,
    uuid,
    integer,
    integer,
    double precision
) to service_role;

commit;

-- Verification 1: only the service role should be able to execute the
-- readiness and guarded-match functions.
select
    has_function_privilege(
        'service_role',
        'public.shamo_get_similarity_readiness(uuid,text,text,integer,integer)',
        'execute'
    ) as service_role_can_check_readiness,
    has_function_privilege(
        'anon',
        'public.shamo_get_similarity_readiness(uuid,text,text,integer,integer)',
        'execute'
    ) as anon_can_check_readiness,
    has_function_privilege(
        'authenticated',
        'public.shamo_get_similarity_readiness(uuid,text,text,integer,integer)',
        'execute'
    ) as authenticated_can_check_readiness,
    has_function_privilege(
        'service_role',
        'public.shamo_match_similar_questions_same_component(extensions.vector,integer,text,text,uuid,integer,integer,double precision)',
        'execute'
    ) as service_role_can_match_guarded,
    has_function_privilege(
        'anon',
        'public.shamo_match_similar_questions_same_component(extensions.vector,integer,text,text,uuid,integer,integer,double precision)',
        'execute'
    ) as anon_can_match_guarded,
    has_function_privilege(
        'authenticated',
        'public.shamo_match_similar_questions_same_component(extensions.vector,integer,text,text,uuid,integer,integer,double precision)',
        'execute'
    ) as authenticated_can_match_guarded;

-- Verification 2: the existing batch-1 Paper 1 seed should be ready because
-- the pilot adds another published Paper 1 with more than five cross-paper
-- candidate questions.
with seed as (
    select question.id
    from public.shamo_papers as paper
    join public.shamo_questions as question
      on question.paper_id = paper.id
     and question.ingestion_run_id = paper.current_ingestion_run_id
    where paper.qualification = 'a_level'
      and paper.syllabus_code = '9709'
      and paper.year = 2024
      and paper.exam_session = 'feb_march'
      and paper.paper_variant = '12'
      and question.question_number = 1
)
select *
from seed
cross join lateral public.shamo_get_similarity_readiness(
    seed.id,
    'a_level',
    '9709',
    2,
    5
);

-- Verification 3: the existing batch-1 Paper 2 seed should not be ready until
-- another Paper 2 has been published and embedded.
with seed as (
    select question.id
    from public.shamo_papers as paper
    join public.shamo_questions as question
      on question.paper_id = paper.id
     and question.ingestion_run_id = paper.current_ingestion_run_id
    where paper.qualification = 'a_level'
      and paper.syllabus_code = '9709'
      and paper.year = 2024
      and paper.exam_session = 'may_june'
      and paper.paper_variant = '21'
      and question.question_number = 7
)
select *
from seed
cross join lateral public.shamo_get_similarity_readiness(
    seed.id,
    'a_level',
    '9709',
    2,
    5
);

-- Verification 4: guarded Paper 2 recommendations should return zero rows
-- while the Paper 2 same-component pool is too sparse.
with seed as (
    select
        question.id as question_id,
        search_item.embedding
    from public.shamo_papers as paper
    join public.shamo_questions as question
      on question.paper_id = paper.id
     and question.ingestion_run_id = paper.current_ingestion_run_id
    join public.shamo_question_search as search_item
      on search_item.question_id = question.id
     and search_item.ingestion_run_id = question.ingestion_run_id
     and search_item.question_part_id is null
     and search_item.content_kind = 'question'
    where paper.qualification = 'a_level'
      and paper.syllabus_code = '9709'
      and paper.year = 2024
      and paper.exam_session = 'may_june'
      and paper.paper_variant = '21'
      and question.question_number = 7
    limit 1
)
select count(*) as guarded_paper2_match_count
from seed
cross join lateral public.shamo_match_similar_questions_same_component(
    seed.embedding,
    5,
    'a_level',
    '9709',
    seed.question_id,
    2,
    5,
    null
);

-- Verification 5: guarded Paper 1 recommendations should only return
-- cross-paper Paper 1 questions, with no duplicate main questions.
with seed as (
    select
        question.id as question_id,
        paper.id as paper_id,
        left(paper.paper_variant, 1) as paper_component,
        search_item.embedding
    from public.shamo_papers as paper
    join public.shamo_questions as question
      on question.paper_id = paper.id
     and question.ingestion_run_id = paper.current_ingestion_run_id
    join public.shamo_question_search as search_item
      on search_item.question_id = question.id
     and search_item.ingestion_run_id = question.ingestion_run_id
     and search_item.question_part_id is null
     and search_item.content_kind = 'question'
    where paper.qualification = 'a_level'
      and paper.syllabus_code = '9709'
      and paper.year = 2024
      and paper.exam_session = 'feb_march'
      and paper.paper_variant = '12'
      and question.question_number = 1
    limit 1
),
matches as (
    select matched.*
    from seed
    cross join lateral public.shamo_match_similar_questions_same_component(
        seed.embedding,
        5,
        'a_level',
        '9709',
        seed.question_id,
        2,
        5,
        null
    ) as matched
),
matched_papers as (
    select
        matches.*,
        paper.id as matched_paper_id
    from matches
    join public.shamo_papers as paper
      on paper.qualification = matches.qualification
     and paper.syllabus_code = matches.syllabus_code
     and paper.year = matches.year
     and paper.exam_session = matches.exam_session
     and paper.paper_variant = matches.paper_variant
     and paper.status = 'published'
)
select
    count(*) as returned_rows,
    count(distinct matched_papers.question_id) as distinct_questions,
    bool_and(matched_papers.paper_component = seed.paper_component)
        as all_same_component,
    bool_and(matched_papers.matched_paper_id <> seed.paper_id)
        as all_cross_paper,
    count(*) = count(distinct matched_papers.question_id)
        as no_duplicate_questions
from seed
cross join matched_papers;
