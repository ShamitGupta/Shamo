-- Shamo v2.1: search-index verification for the two reviewed batch papers.
--
-- Paper 52 run: 754da6c9-7ee7-4699-9cd9-718e63dc1a15
-- Paper 61 run: 054f296f-e08c-4360-a27d-325d064b2496
--
-- Run each numbered section separately after the n8n embedding workflow.
-- This script is read-only and makes no API calls.

-- ---------------------------------------------------------------------------
-- Section 1: core indexing checks.
-- Expected: every row says PASS.
-- ---------------------------------------------------------------------------

with
targets as (
    select *
    from (
        values
            (
                '52'::text,
                '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
                23::bigint
            ),
            (
                '61'::text,
                '054f296f-e08c-4360-a27d-325d064b2496'::uuid,
                25::bigint
            )
    ) as selected(
        paper_variant,
        ingestion_run_id,
        expected_item_count
    )
),
run_checks as (
    select
        target.paper_variant,
        1 as sort_order,
        'ingestion run is complete'::text as check_name,
        run.status = 'complete' as passed,
        run.status::text as actual
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
        'search item count',
        count(search_item.id) = target.expected_item_count,
        count(search_item.id)::text
    from targets as target
    left join public.shamo_question_search as search_item
      on search_item.ingestion_run_id = target.ingestion_run_id
     and search_item.content_kind = 'question'
    group by
        target.paper_variant,
        target.expected_item_count

    union all

    select
        target.paper_variant,
        4,
        'all embeddings present',
        count(search_item.id) filter (
            where search_item.embedding is null
        ) = 0,
        count(search_item.id) filter (
            where search_item.embedding is null
        )::text
    from targets as target
    left join public.shamo_question_search as search_item
      on search_item.ingestion_run_id = target.ingestion_run_id
     and search_item.content_kind = 'question'
    group by target.paper_variant

    union all

    select
        target.paper_variant,
        5,
        'all embeddings use 512 dimensions',
        count(search_item.id) filter (
            where search_item.embedding is not null
              and extensions.vector_dims(search_item.embedding) <> 512
        ) = 0,
        count(search_item.id) filter (
            where search_item.embedding is not null
              and extensions.vector_dims(search_item.embedding) <> 512
        )::text
    from targets as target
    left join public.shamo_question_search as search_item
      on search_item.ingestion_run_id = target.ingestion_run_id
     and search_item.content_kind = 'question'
    group by target.paper_variant

    union all

    select
        target.paper_variant,
        6,
        'no pending search items for this paper',
        count(pending_item.question_id) = 0,
        count(pending_item.question_id)::text
    from targets as target
    left join public.shamo_get_pending_search_items(500)
        as pending_item
      on pending_item.ingestion_run_id = target.ingestion_run_id
    group by target.paper_variant
),
combined_checks as (
    select
        'both'::text as paper_variant,
        7 as sort_order,
        'combined new search item count'::text as check_name,
        count(search_item.id) = 48 as passed,
        count(search_item.id)::text as actual
    from public.shamo_question_search as search_item
    join targets as target
      on target.ingestion_run_id = search_item.ingestion_run_id
    where search_item.content_kind = 'question'

    union all

    select
        'database',
        8,
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
from (
    select * from run_checks
    union all
    select * from combined_checks
) as checks
order by sort_order, paper_variant;

-- ---------------------------------------------------------------------------
-- Section 2: search rows grouped by paper and question.
-- Expected totals:
--   Paper 52 = 23
--   Paper 61 = 25
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    question.question_number,
    count(*) as searchable_item_count,
    count(*) filter (
        where search_item.question_part_id is null
    ) as whole_question_items,
    count(*) filter (
        where search_item.question_part_id is not null
    ) as part_items,
    min(search_item.embedding_model) as embedding_model
from public.shamo_question_search as search_item
join public.shamo_questions as question
  on question.id = search_item.question_id
 and question.ingestion_run_id = search_item.ingestion_run_id
join public.shamo_papers as paper
  on paper.id = question.paper_id
where search_item.ingestion_run_id in (
    '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
    '054f296f-e08c-4360-a27d-325d064b2496'::uuid
)
  and search_item.content_kind = 'question'
group by
    paper.paper_variant,
    question.question_number
order by
    paper.paper_variant,
    question.question_number;

-- ---------------------------------------------------------------------------
-- Section 3: cross-paper similarity smoke test.
--
-- Uses Paper 52, Question 5 as the seed. This is a discrete-random-variable
-- question, so relevant Statistics questions from Paper 61 should rank above
-- unrelated Pure Mathematics questions. It uses a stored embedding and makes
-- no OpenAI API call.
-- ---------------------------------------------------------------------------

with seed as (
    select
        search_item.question_id,
        search_item.embedding
    from public.shamo_question_search as search_item
    join public.shamo_questions as question
      on question.id = search_item.question_id
     and question.ingestion_run_id = search_item.ingestion_run_id
    where search_item.ingestion_run_id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and question.question_number = 5
      and search_item.question_part_id is null
      and search_item.content_kind = 'question'
    limit 1
)
select
    paper.paper_variant,
    matched.question_number,
    matched.question_part_id,
    round(matched.similarity::numeric, 4) as similarity,
    metadata.main_topic,
    metadata.subtopics,
    left(search_item.content, 180) as content_preview
from seed
cross join lateral public.shamo_match_similar_questions(
    seed.embedding,
    10,
    'a_level',
    '9709',
    seed.question_id
) as matched
join public.shamo_question_search as search_item
  on search_item.question_id = matched.question_id
 and search_item.question_part_id is not distinct from
     matched.question_part_id
join public.shamo_questions as question
  on question.id = matched.question_id
join public.shamo_papers as paper
  on paper.id = question.paper_id
left join public.shamo_question_metadata as metadata
  on metadata.question_id = question.id
 and metadata.ingestion_run_id = question.ingestion_run_id
where search_item.content_kind = 'question'
order by matched.similarity desc;
