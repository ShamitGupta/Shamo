-- Shamo v2 search-index verification
--
-- Run each numbered section separately after the n8n embedding workflow.
-- The pilot ingestion run is pre-filled below.

-- ---------------------------------------------------------------------------
-- 1. Core pass/fail checks
-- ---------------------------------------------------------------------------

with settings as (
    select
        '1298c634-b404-4a36-9aa9-3739e88caf08'::uuid
            as ingestion_run_id,
        'text-embedding-3-small'::text as expected_model
),
checks as (
    select
        'ingestion run is complete'::text as check_name,
        case when run.status = 'complete'
            then 'PASS' else 'FAIL' end as result,
        run.status::text as actual
    from public.shamo_ingestion_runs as run
    cross join settings
    where run.id = settings.ingestion_run_id

    union all

    select
        'embedding model recorded',
        case when run.embedding_model = settings.expected_model
            then 'PASS' else 'FAIL' end,
        coalesce(run.embedding_model, 'NULL')
    from public.shamo_ingestion_runs as run
    cross join settings
    where run.id = settings.ingestion_run_id

    union all

    select
        'search item count',
        case when count(*) = 29 then 'PASS' else 'FAIL' end,
        count(*)::text
    from public.shamo_question_search as search_item
    cross join settings
    where search_item.ingestion_run_id =
        settings.ingestion_run_id
      and search_item.content_kind = 'question'

    union all

    select
        'all embeddings present',
        case when count(*) filter (
            where search_item.embedding is null
        ) = 0 then 'PASS' else 'FAIL' end,
        count(*) filter (
            where search_item.embedding is null
        )::text
    from public.shamo_question_search as search_item
    cross join settings
    where search_item.ingestion_run_id =
        settings.ingestion_run_id
      and search_item.content_kind = 'question'

    union all

    select
        'all embeddings use 512 dimensions',
        case when count(*) filter (
            where extensions.vector_dims(
                search_item.embedding
            ) <> 512
        ) = 0 then 'PASS' else 'FAIL' end,
        count(*) filter (
            where extensions.vector_dims(
                search_item.embedding
            ) <> 512
        )::text
    from public.shamo_question_search as search_item
    cross join settings
    where search_item.ingestion_run_id =
        settings.ingestion_run_id
      and search_item.embedding is not null

    union all

    select
        'no pending search items',
        case when count(*) = 0 then 'PASS' else 'FAIL' end,
        count(*)::text
    from public.shamo_get_pending_search_items(500)
)
select *
from checks;

-- ---------------------------------------------------------------------------
-- 2. Search rows grouped by question
-- ---------------------------------------------------------------------------

select
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
   and question.ingestion_run_id =
       search_item.ingestion_run_id
where search_item.ingestion_run_id =
    '1298c634-b404-4a36-9aa9-3739e88caf08'::uuid
  and search_item.content_kind = 'question'
group by question.question_number
order by question.question_number;

-- ---------------------------------------------------------------------------
-- 3. Similarity smoke test
--
-- Uses Question 6's stored whole-question embedding as the query, excludes
-- Question 6 itself, and returns the closest other questions. After applying
-- shamo_v2_search_deduplication_patch.sql, each question appears at most once.
-- This makes no additional OpenAI API call.
-- ---------------------------------------------------------------------------

with seed as (
    select
        search_item.question_id,
        search_item.embedding
    from public.shamo_question_search as search_item
    join public.shamo_questions as question
        on question.id = search_item.question_id
       and question.ingestion_run_id =
           search_item.ingestion_run_id
    where search_item.ingestion_run_id =
        '1298c634-b404-4a36-9aa9-3739e88caf08'::uuid
      and question.question_number = 6
      and search_item.question_part_id is null
      and search_item.content_kind = 'question'
    limit 1
)
select
    matched.question_number,
    matched.question_part_id,
    round(matched.similarity::numeric, 4) as similarity,
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
where search_item.content_kind = 'question'
order by matched.similarity desc;
