-- Shamo v2: read-only verification for the published 9709/12 M25 pilot.
--
-- Run Section 1 first in the Supabase SQL Editor as postgres. Every row should
-- say PASS. Sections 2 and 3 provide the human-readable detail.

-- ---------------------------------------------------------------------------
-- Section 1: compact pass/fail audit
-- ---------------------------------------------------------------------------

with
target as (
    select
        '1298c634-b404-4a36-9aa9-3739e88caf08'::uuid
            as ingestion_run_id,
        '3d36bf44-03e3-4640-984e-60ff7d5db675'::uuid
            as paper_id
),
paper_questions as (
    select question.*
    from public.shamo_questions as question
    cross join target
    where question.paper_id = target.paper_id
      and question.ingestion_run_id = target.ingestion_run_id
),
metrics as (
    select
        (select count(*) from paper_questions) as question_count,
        (
            select count(*)
            from paper_questions
            where btrim(stem_markdown) <> ''
        ) as searchable_question_count,
        (
            select coalesce(sum(total_marks), 0)
            from paper_questions
        ) as total_marks,
        (
            select count(*)
            from public.shamo_question_parts as part
            cross join target
            where part.ingestion_run_id = target.ingestion_run_id
        ) as part_count,
        (
            select count(*)
            from public.shamo_mark_scheme_items as mark_item
            cross join target
            where mark_item.ingestion_run_id =
                target.ingestion_run_id
        ) as mark_item_count,
        (
            select count(*)
            from public.shamo_question_assets as asset
            cross join target
            where asset.ingestion_run_id = target.ingestion_run_id
        ) as asset_count,
        (
            select count(*)
            from public.shamo_question_search as search_item
            cross join target
            where search_item.ingestion_run_id = target.ingestion_run_id
              and search_item.content_kind = 'question'
              and search_item.embedding is not null
        ) as embedded_search_count
),
checks as (
    select
        1 as sort_order,
        'ingestion run state'::text as check_name,
        (
            run.status = 'search_pending'
            and run.review_status = 'approved'
            and run.published_at is not null
        ) as passed,
        concat(
            'status=', run.status,
            ', review=', run.review_status,
            ', published_at=', run.published_at
        ) as actual
    from public.shamo_ingestion_runs as run
    cross join target
    where run.id = target.ingestion_run_id

    union all

    select
        2,
        'paper publication pointer',
        (
            paper.status = 'published'
            and paper.current_ingestion_run_id =
                target.ingestion_run_id
        ),
        concat(
            'status=', paper.status,
            ', current_run=', paper.current_ingestion_run_id
        )
    from public.shamo_papers as paper
    cross join target
    where paper.id = target.paper_id

    union all

    select
        3,
        'question count',
        metrics.question_count = 11,
        metrics.question_count::text
    from metrics

    union all

    select
        4,
        'paper mark total',
        metrics.total_marks = 75,
        metrics.total_marks::text
    from metrics

    union all

    select
        5,
        'question-part count',
        metrics.part_count = 20,
        metrics.part_count::text
    from metrics

    union all

    select
        6,
        'mark-scheme row count',
        metrics.mark_item_count = 96,
        metrics.mark_item_count::text
    from metrics

    union all

    select
        7,
        'instructional asset count',
        metrics.asset_count = 4,
        metrics.asset_count::text
    from metrics

    union all

    select
        8,
        'no temporary publication placeholders',
        count(*) = 0,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    cross join target
    where mark_item.ingestion_run_id = target.ingestion_run_id
      and mark_item.content_markdown =
          '[Guidance-only row pending publication]'

    union all

    select
        9,
        'no completely empty mark-scheme rows',
        count(*) = 0,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    cross join target
    where mark_item.ingestion_run_id = target.ingestion_run_id
      and btrim(mark_item.content_markdown) = ''
      and btrim(mark_item.guidance_markdown) = ''

    union all

    select
        10,
        'no unresolved blocking issues',
        count(*) = 0,
        count(*)::text
    from public.shamo_ingestion_issues as issue
    cross join target
    where issue.ingestion_run_id = target.ingestion_run_id
      and issue.severity = 'blocking'
      and issue.resolved = false

    union all

    select
        11,
        'Question 6 guidance-only special case',
        count(*) = 1,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    join paper_questions as question
        on question.id = mark_item.question_id
    left join public.shamo_question_parts as part
        on part.id = mark_item.question_part_id
    where question.question_number = 6
      and part.label_path = array['b']::text[]
      and mark_item.mark_code is null
      and btrim(mark_item.content_markdown) = ''
      and mark_item.guidance_markdown like '%SCB1%'
      and mark_item.is_final_answer = false

    union all

    select
        12,
        'Question 6 complete factorisation',
        count(*) = 1,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    join paper_questions as question
        on question.id = mark_item.question_id
    where question.question_number = 6
      and replace(mark_item.content_markdown, ' ', '')
          like '%(r+17)(r-4)%'

    union all

    select
        13,
        'Question 10 dependency mark',
        count(*) = 1,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    join paper_questions as question
        on question.id = mark_item.question_id
    left join public.shamo_question_parts as part
        on part.id = mark_item.question_part_id
    where question.question_number = 10
      and part.label_path = array['b']::text[]
      and mark_item.mark_code = '*M1'

    union all

    select
        14,
        'Question 10 negative derivative exponent',
        count(*) = 1,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    join paper_questions as question
        on question.id = mark_item.question_id
    left join public.shamo_question_parts as part
        on part.id = mark_item.question_part_id
    where question.question_number = 10
      and part.label_path = array['b']::text[]
      and mark_item.mark_code = 'B1'
      and mark_item.content_markdown like '%(3x+4)^{-%'
      and mark_item.content_markdown like '%frac12%'

    union all

    select
        15,
        'Question 6 chatbot context',
        (
            context.payload is not null
            and context.payload::text like '%guidance_markdown%'
            and context.payload::text like '%SCB1%'
        ),
        case
            when context.payload is null then 'NULL'
            else 'returned with Guidance and SCB1'
        end
    from (
        select public.shamo_get_question_context(
            'a_level',
            '9709',
            2025,
            'feb_march',
            '12',
            6
        ) as payload
    ) as context

    union all

    select
        16,
        'search item coverage',
        pending.pending_count + metrics.embedded_search_count
            = metrics.searchable_question_count + metrics.part_count,
        concat(
            'pending=', pending.pending_count,
            ', embedded=', metrics.embedded_search_count,
            ', expected_searchable=',
            metrics.searchable_question_count + metrics.part_count,
            ' (question-level=', metrics.searchable_question_count,
            ', parts=', metrics.part_count, ')'
        )
    from metrics
    cross join (
        select count(*) as pending_count
        from public.shamo_get_pending_search_items(100)
    ) as pending

    union all

    select
        17,
        'database remains below 400 MB safety line',
        usage.database_megabytes < 400,
        usage.database_megabytes::text || ' MB'
    from public.shamo_database_usage as usage
)
select
    check_name,
    case when passed then 'PASS' else 'FAIL' end as result,
    actual
from checks
order by sort_order;

-- ---------------------------------------------------------------------------
-- Section 2: one row per published question
-- ---------------------------------------------------------------------------

select
    overview.question_number,
    overview.total_marks,
    overview.part_count,
    overview.mark_scheme_item_count,
    overview.asset_count,
    case
        when btrim(question.stem_markdown) = ''
            then 'parts only'
        when overview.part_count = 0
            then 'standalone question'
        else 'shared stem + parts'
    end as searchable_structure,
    left(
        coalesce(
            nullif(btrim(question.stem_markdown), ''),
            first_part.prompt_markdown
        ),
        120
    ) as opening_content_preview
from public.shamo_published_question_overview as overview
join public.shamo_questions as question
    on question.id = overview.question_id
left join lateral (
    select part.prompt_markdown
    from public.shamo_question_parts as part
    where part.question_id = question.id
      and part.ingestion_run_id = question.ingestion_run_id
    order by part.sort_order
    limit 1
) as first_part on true
where overview.paper_id =
    '3d36bf44-03e3-4640-984e-60ff7d5db675'::uuid
order by overview.question_number;

-- ---------------------------------------------------------------------------
-- Section 3: exact chatbot payload for a question with a special case
-- ---------------------------------------------------------------------------

select jsonb_pretty(
    public.shamo_get_question_context(
        'a_level',
        '9709',
        2025,
        'feb_march',
        '12',
        6
    )
) as question_6_context;
