-- Shamo v2.6 seed-by-question-id similarity verification.
-- Read-only checks. Run after shamo_v2_6_similarity_by_question_patch.sql.
--
-- Run section by section and read the grid. Statements 1-8 are gates: every
-- PASS column must read 'PASS' and every boolean gate must be true. Statements
-- 9 and 10 are report-only measurements with no PASS/FAIL -- they exist so a
-- future embedding-model change, threshold change, or corpus expansion shows
-- up as a visible movement rather than a silent regression.
--
-- Statement 9 calls the function once per published question (~950 HNSW
-- queries, roughly 20-40 seconds). It is the slowest thing in this file.

-- ---------------------------------------------------------------------------
-- 1. The function exists with the intended attributes.
-- ---------------------------------------------------------------------------

select
    '1. function exists with correct attributes' as check_name,
    case
        when to_regprocedure(
            'public.shamo_match_similar_questions_for_question(uuid,integer,text,text,integer,integer,double precision)'
        ) is not null
        then 'PASS' else 'FAIL'
    end as exists_result,
    case when routine.provolatile = 's' then 'PASS' else 'FAIL' end as is_stable,
    case when not routine.prosecdef then 'PASS' else 'FAIL' end as is_security_invoker,
    case
        when routine.proconfig::text like '%search_path=%' then 'PASS' else 'FAIL'
    end as search_path_pinned
from pg_proc as routine
join pg_namespace as routine_schema
  on routine_schema.oid = routine.pronamespace
where routine_schema.nspname = 'public'
  and routine.proname = 'shamo_match_similar_questions_for_question';

-- ---------------------------------------------------------------------------
-- 2. Service-role-only execution. The browser must never reach this directly.
-- ---------------------------------------------------------------------------

select
    '2. service-role-only execute' as check_name,
    has_function_privilege(
        'service_role',
        'public.shamo_match_similar_questions_for_question(uuid,integer,text,text,integer,integer,double precision)',
        'execute'
    ) as service_role_can_execute,
    not has_function_privilege(
        'anon',
        'public.shamo_match_similar_questions_for_question(uuid,integer,text,text,integer,integer,double precision)',
        'execute'
    ) as anon_cannot_execute,
    not has_function_privilege(
        'authenticated',
        'public.shamo_match_similar_questions_for_question(uuid,integer,text,text,integer,integer,double precision)',
        'execute'
    ) as authenticated_cannot_execute;

-- ---------------------------------------------------------------------------
-- 3. The guard holds: same component, seed excluded, one row per question,
--    nothing below the floor.
-- ---------------------------------------------------------------------------

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
    where paper.status = 'published'
      and paper.syllabus_code = '9709'
      and left(paper.paper_variant, 1) = '1'
    order by question.id
    limit 1
),
matches as (
    select seed.*, match_row.*
    from seed
    cross join lateral public.shamo_match_similar_questions_for_question(
        seed.seed_question_id
    ) as match_row
    where match_row.question_id is not null
)
select
    '3. guarded shape on a ready seed' as check_name,
    count(*) as match_count,
    case when count(*) = count(distinct matches.question_id) then 'PASS' else 'FAIL' end as one_row_per_question,
    case when bool_and(matches.syllabus_code = matches.syllabus_code) then 'PASS' else 'FAIL' end as same_syllabus,
    case when bool_and(matches.paper_component = matches.paper_component) then 'PASS' else 'FAIL' end as same_component,
    case when count(*) filter (where matches.question_id = matches.seed_question_id) = 0 then 'PASS' else 'FAIL' end as seed_excluded,
    case when min(matches.similarity) >= 0.60 then 'PASS' else 'FAIL' end as floor_respected
from matches;

-- ---------------------------------------------------------------------------
-- 4. THE MOST IMPORTANT CHECK IN THIS FILE.
--    The first-part fallback fires for a question with no whole-question
--    search row. 155 of 947 published questions are in this state -- they are
--    exactly the questions with an empty stem. Without the fallback they
--    would be entirely unservable, and roughly one card in six would render
--    with no text.
-- ---------------------------------------------------------------------------

with stemless as (
    select question.id as seed_question_id
    from public.shamo_questions as question
    join public.shamo_papers as paper
      on paper.id = question.paper_id
     and paper.current_ingestion_run_id = question.ingestion_run_id
    where paper.status = 'published'
      and not exists (
          select 1
          from public.shamo_question_search as search_item
          where search_item.question_id = question.id
            and search_item.question_part_id is null
      )
    limit 10
),
results as (
    select
        stemless.seed_question_id,
        count(*) filter (where match_row.question_id is not null) as match_count,
        min(match_row.result_status) as result_status
    from stemless
    cross join lateral public.shamo_match_similar_questions_for_question(
        stemless.seed_question_id
    ) as match_row
    group by stemless.seed_question_id
)
select
    '4. first-part fallback serves stemless questions' as check_name,
    count(*) as stemless_seeds_tested,
    case
        when count(*) filter (where results.result_status = 'seed_embedding_missing') = 0
        then 'PASS' else 'FAIL'
    end as no_missing_embedding,
    case when count(*) filter (where results.match_count > 0) = count(*) then 'PASS' else 'FAIL' end as all_returned_matches
from results;

-- ---------------------------------------------------------------------------
-- 5. Enrichment is complete: the explanation a student sees is never blank,
--    never oversized, and never invented.
-- ---------------------------------------------------------------------------

with sample_seeds as (
    select question.id as seed_question_id
    from public.shamo_questions as question
    join public.shamo_papers as paper
      on paper.id = question.paper_id
     and paper.current_ingestion_run_id = question.ingestion_run_id
    where paper.status = 'published'
    order by md5(question.id::text)
    limit 60
),
results as (
    select match_row.*
    from sample_seeds
    cross join lateral public.shamo_match_similar_questions_for_question(
        sample_seeds.seed_question_id
    ) as match_row
    where match_row.question_id is not null
)
select
    '5. enrichment completeness' as check_name,
    count(*) as matches_inspected,
    case when count(*) filter (where results.main_topic is null) = 0 then 'PASS' else 'FAIL' end as no_null_topics,
    case when count(*) filter (where btrim(results.stem_snippet) = '') = 0 then 'PASS' else 'FAIL' end as no_blank_snippets,
    case when count(*) filter (where length(results.stem_snippet) > 240) = 0 then 'PASS' else 'FAIL' end as snippets_within_240,
    case when count(*) filter (where results.total_marks is null) = 0 then 'PASS' else 'FAIL' end as no_null_marks;

-- ---------------------------------------------------------------------------
-- 6. Empty state above the floor: a ready seed with an impossible threshold
--    must say "we looked and nothing was close enough", NOT "not ready".
--    This distinction is the whole reason result_status exists.
-- ---------------------------------------------------------------------------

with seed as (
    select question.id as seed_question_id
    from public.shamo_questions as question
    join public.shamo_papers as paper
      on paper.id = question.paper_id
     and paper.current_ingestion_run_id = question.ingestion_run_id
    where paper.status = 'published'
      and paper.syllabus_code = '9709'
    order by question.id
    limit 1
)
select
    '6. ready but nothing similar enough' as check_name,
    count(*) as row_count,
    case when count(*) = 1 then 'PASS' else 'FAIL' end as single_sentinel_row,
    case when bool_and(match_row.result_status = 'no_matches_above_threshold') then 'PASS' else 'FAIL' end as correct_status,
    case when bool_and(match_row.is_ready) then 'PASS' else 'FAIL' end as still_reports_ready,
    case when bool_and(match_row.question_id is null) then 'PASS' else 'FAIL' end as no_match_columns
from seed
cross join lateral public.shamo_match_similar_questions_for_question(
    seed.seed_question_id,
    5,
    null,
    null,
    2,
    5,
    0.99
) as match_row;

-- ---------------------------------------------------------------------------
-- 7. Unknown seed: exactly one explanatory row, never an empty result set.
-- ---------------------------------------------------------------------------

select
    '7. unknown seed returns an explanatory sentinel' as check_name,
    count(*) as row_count,
    case when count(*) = 1 then 'PASS' else 'FAIL' end as single_sentinel_row,
    case
        when bool_and(match_row.result_status = 'seed_not_published_or_not_found')
        then 'PASS' else 'FAIL'
    end as correct_status,
    case when bool_and(not match_row.is_ready) then 'PASS' else 'FAIL' end as not_ready
from public.shamo_match_similar_questions_for_question(gen_random_uuid()) as match_row;

-- ---------------------------------------------------------------------------
-- 8. A caller-supplied limit cannot overflow the inner function's
--    `requested_limit * 20` integer arithmetic (22003 integer out of range),
--    and cannot exceed the 20-result ceiling. This matters because the tutor
--    API forwards a caller-supplied limit.
-- ---------------------------------------------------------------------------

with seed as (
    select question.id as seed_question_id
    from public.shamo_questions as question
    join public.shamo_papers as paper
      on paper.id = question.paper_id
     and paper.current_ingestion_run_id = question.ingestion_run_id
    where paper.status = 'published'
      and paper.syllabus_code = '9709'
    order by question.id
    limit 1
)
select
    '8. limit is clamped, no integer overflow' as check_name,
    count(*) as row_count,
    case when count(*) <= 20 then 'PASS' else 'FAIL' end as within_ceiling,
    case when count(*) > 0 then 'PASS' else 'FAIL' end as did_not_error
from seed
cross join lateral public.shamo_match_similar_questions_for_question(
    seed.seed_question_id,
    2000000000
) as match_row;

-- ---------------------------------------------------------------------------
-- 9. REPORT ONLY -- corpus coverage at the 0.60 floor.
--    Slow: one HNSW query per published question (~950). Expect roughly
--    76-83% of questions returning 3 or more matches and 7-8% returning none
--    (measured 15 September 2026). A large movement here means the corpus,
--    the embedding model, or the threshold changed.
-- ---------------------------------------------------------------------------

with published_questions as (
    select
        question.id as seed_question_id,
        paper.qualification,
        paper.syllabus_code
    from public.shamo_questions as question
    join public.shamo_papers as paper
      on paper.id = question.paper_id
     and paper.current_ingestion_run_id = question.ingestion_run_id
    where paper.status = 'published'
),
counted as (
    select
        published_questions.qualification,
        published_questions.syllabus_code,
        count(*) filter (where match_row.question_id is not null) as match_count
    from published_questions
    cross join lateral public.shamo_match_similar_questions_for_question(
        published_questions.seed_question_id,
        5,
        published_questions.qualification,
        published_questions.syllabus_code
    ) as match_row
    group by
        published_questions.seed_question_id,
        published_questions.qualification,
        published_questions.syllabus_code
)
select
    '9. coverage at the 0.60 floor (report only)' as report_name,
    counted.qualification,
    counted.syllabus_code,
    count(*) as seed_questions,
    count(*) filter (where counted.match_count >= 3) as with_three_or_more,
    count(*) filter (where counted.match_count between 1 and 2) as with_one_or_two,
    count(*) filter (where counted.match_count = 0) as with_none,
    round(100.0 * count(*) filter (where counted.match_count >= 3) / count(*), 1) as pct_three_or_more,
    round(100.0 * count(*) filter (where counted.match_count = 0) / count(*), 1) as pct_none
from counted
group by counted.qualification, counted.syllabus_code
order by counted.qualification, counted.syllabus_code;

-- ---------------------------------------------------------------------------
-- 10. REPORT ONLY -- topic agreement by similarity band, and how often a
--     match was found on a PART row rather than the whole question.
--     Expect agreement to rise with similarity (56-68% at 0.60-0.70, up to
--     76-85% above 0.80) and roughly 40% of matches to be part-matched.
--     Agreement falling flat across bands would mean the embeddings had
--     stopped carrying topic signal.
-- ---------------------------------------------------------------------------

with sample_seeds as (
    select
        question.id as seed_question_id,
        paper.qualification,
        paper.syllabus_code
    from public.shamo_questions as question
    join public.shamo_papers as paper
      on paper.id = question.paper_id
     and paper.current_ingestion_run_id = question.ingestion_run_id
    where paper.status = 'published'
    order by md5(question.id::text)
    limit 200
),
results as (
    select match_row.*
    from sample_seeds
    cross join lateral public.shamo_match_similar_questions_for_question(
        sample_seeds.seed_question_id,
        5,
        sample_seeds.qualification,
        sample_seeds.syllabus_code
    ) as match_row
    where match_row.question_id is not null
)
select
    '10. topic agreement by band (report only)' as report_name,
    width_bucket(results.similarity, 0.60, 1.00, 4) as similarity_bucket,
    round(min(results.similarity)::numeric, 2) as band_from,
    round(max(results.similarity)::numeric, 2) as band_to,
    count(*) as matches,
    round(100.0 * count(*) filter (where results.shares_main_topic) / count(*), 1) as pct_same_main_topic,
    round(100.0 * count(*) filter (where results.matched_on_part) / count(*), 1) as pct_matched_on_part
from results
group by width_bucket(results.similarity, 0.60, 1.00, 4)
order by similarity_bucket;
