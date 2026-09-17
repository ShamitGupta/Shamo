-- Shamo v2.1: complete six-paper calibration batch search verification.
--
-- This script is read-only and makes no provider API calls. Run it after the
-- combined embedding workflow. Every row in Section 1 should say PASS, then
-- inspect the ranked examples in Section 2 for conceptual relevance.

-- ---------------------------------------------------------------------------
-- Section 1: structural, embedding, and indexing checks.
-- ---------------------------------------------------------------------------

with
targets as (
    select *
    from (
        values
            ('12', '414a7734-2afe-4bab-9896-02649106d027'::uuid, 26::bigint),
            ('21', '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid, 17::bigint),
            ('32', '466116cc-75de-423e-9745-e2e401cfbe29'::uuid, 27::bigint),
            ('41', '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid, 17::bigint),
            ('52', '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid, 23::bigint),
            ('61', '054f296f-e08c-4360-a27d-325d064b2496'::uuid, 25::bigint)
    ) as selected(paper_variant, ingestion_run_id, expected_item_count)
),
duplicate_keys as (
    select
        search_item.ingestion_run_id,
        search_item.question_id,
        search_item.question_part_id,
        search_item.content_kind
    from public.shamo_question_search as search_item
    group by
        search_item.ingestion_run_id,
        search_item.question_id,
        search_item.question_part_id,
        search_item.content_kind
    having count(*) > 1
),
checks as (
    select
        target.paper_variant,
        1 as sort_order,
        'run is complete and approved'::text as check_name,
        run.status = 'complete' and run.review_status = 'approved' as passed,
        run.status || '/' || run.review_status as actual
    from targets as target
    join public.shamo_ingestion_runs as run
      on run.id = target.ingestion_run_id

    union all

    select
        target.paper_variant,
        2,
        'embedding model recorded',
        run.embedding_model = 'text-embedding-3-small',
        coalesce(run.embedding_model, 'NULL')
    from targets as target
    join public.shamo_ingestion_runs as run
      on run.id = target.ingestion_run_id

    union all

    select
        target.paper_variant,
        3,
        'exact search-row count',
        count(search_item.id) = target.expected_item_count,
        count(search_item.id)::text
    from targets as target
    left join public.shamo_question_search as search_item
      on search_item.ingestion_run_id = target.ingestion_run_id
     and search_item.content_kind = 'question'
    group by target.paper_variant, target.expected_item_count

    union all

    select
        target.paper_variant,
        4,
        'all embeddings are non-null 512-dimensional non-zero vectors',
        count(search_item.id) filter (
            where search_item.embedding is null
               or extensions.vector_dims(search_item.embedding) <> 512
               or extensions.vector_norm(search_item.embedding) = 0
        ) = 0,
        count(search_item.id) filter (
            where search_item.embedding is null
               or extensions.vector_dims(search_item.embedding) <> 512
               or extensions.vector_norm(search_item.embedding) = 0
        )::text
    from targets as target
    left join public.shamo_question_search as search_item
      on search_item.ingestion_run_id = target.ingestion_run_id
     and search_item.content_kind = 'question'
    group by target.paper_variant

    union all

    select
        'batch',
        5,
        'six-paper batch contains 135 search rows',
        count(search_item.id) = 135,
        count(search_item.id)::text
    from public.shamo_question_search as search_item
    join targets as target
      on target.ingestion_run_id = search_item.ingestion_run_id
    where search_item.content_kind = 'question'

    union all

    select
        'global',
        6,
        'all seven published papers contain 164 search rows',
        count(*) = 164,
        count(*)::text
    from public.shamo_question_search
    where content_kind = 'question'

    union all

    select
        'global',
        7,
        'no pending published search items',
        count(*) = 0,
        count(*)::text
    from public.shamo_get_pending_search_items(500)

    union all

    select
        'global',
        8,
        'no duplicate search identity keys',
        count(*) = 0,
        count(*)::text
    from duplicate_keys

    union all

    select
        'global',
        9,
        'all content hashes match stored content',
        count(*) filter (
            where content_hash <> md5(content)
        ) = 0,
        count(*) filter (
            where content_hash <> md5(content)
        )::text
    from public.shamo_question_search
    where content_kind = 'question'

    union all

    select
        'database',
        10,
        'database remains below 400 MB safety line',
        usage.database_megabytes < 400,
        usage.database_megabytes::text || ' MB'
    from public.shamo_database_usage as usage
)
select
    paper_variant,
    check_name,
    case when passed then 'PASS' else 'FAIL' end as result,
    actual
from checks
order by sort_order, paper_variant;

-- ---------------------------------------------------------------------------
-- Section 2: three domain-level semantic smoke tests.
--
-- Expected manual result:
--   * statistics_probability ranks Statistics questions first;
--   * pure_calculus ranks differentiation/calculus questions first;
--   * mechanics_kinematics ranks Mechanics motion questions first.
-- The matching function deduplicates each main question.
-- ---------------------------------------------------------------------------

with
seed_specs(seed_name, year, exam_session, paper_variant, question_number) as (
    values
        ('statistics_probability', 2024::smallint, 'feb_march', '52', 5),
        ('pure_calculus', 2024::smallint, 'may_june', '32', 4),
        ('mechanics_kinematics', 2025::smallint, 'oct_nov', '41', 7)
),
seeds as (
    select
        spec.seed_name,
        question.id as seed_question_id,
        search_item.embedding
    from seed_specs as spec
    join public.shamo_papers as paper
      on paper.qualification = 'a_level'
     and paper.syllabus_code = '9709'
     and paper.year = spec.year
     and paper.exam_session = spec.exam_session
     and paper.paper_variant = spec.paper_variant
     and paper.status = 'published'
    join public.shamo_questions as question
      on question.paper_id = paper.id
     and question.ingestion_run_id = paper.current_ingestion_run_id
     and question.question_number = spec.question_number
    join public.shamo_question_search as search_item
      on search_item.question_id = question.id
     and search_item.ingestion_run_id = question.ingestion_run_id
     and search_item.question_part_id is null
     and search_item.content_kind = 'question'
),
matches as (
    select
        seed.seed_name,
        row_number() over (
            partition by seed.seed_name
            order by matched.similarity desc
        ) as rank,
        matched.*
    from seeds as seed
    cross join lateral public.shamo_match_similar_questions(
        seed.embedding,
        5,
        'a_level',
        '9709',
        seed.seed_question_id
    ) as matched
)
select
    matches.seed_name,
    matches.rank,
    matches.year,
    matches.exam_session,
    matches.paper_variant,
    matches.question_number,
    round(matches.similarity::numeric, 4) as similarity,
    metadata.main_topic,
    metadata.subtopics,
    left(search_item.content, 180) as content_preview
from matches
join public.shamo_question_search as search_item
  on search_item.question_id = matches.question_id
 and search_item.question_part_id is not distinct from matches.question_part_id
 and search_item.content_kind = 'question'
left join public.shamo_question_metadata as metadata
  on metadata.question_id = matches.question_id
 and metadata.ingestion_run_id = search_item.ingestion_run_id
order by matches.seed_name, matches.rank;
