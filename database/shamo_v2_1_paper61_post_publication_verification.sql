-- Shamo v2.1: read-only post-publication verification for
-- Cambridge 9709/61 May/June 2024.
--
-- Published ingestion run:
--   054f296f-e08c-4360-a27d-325d064b2496
-- Published paper:
--   2f718302-24c2-48ee-b6bb-ee2ec932b722
--
-- Run each numbered section separately in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Section 1: compact database audit.
-- Expected: every row says PASS.
-- ---------------------------------------------------------------------------

with
target as (
    select
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
            as ingestion_run_id,
        '2f718302-24c2-48ee-b6bb-ee2ec932b722'::uuid
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
            where mark_item.ingestion_run_id = target.ingestion_run_id
        ) as mark_item_count,
        (
            select count(*)
            from public.shamo_question_assets as asset
            cross join target
            where asset.ingestion_run_id = target.ingestion_run_id
        ) as asset_count,
        (
            select count(*)
            from public.shamo_question_metadata as metadata
            cross join target
            where metadata.ingestion_run_id = target.ingestion_run_id
        ) as metadata_count,
        (
            select count(*)
            from public.shamo_question_search as search_item
            cross join target
            where search_item.ingestion_run_id = target.ingestion_run_id
        ) as stored_search_item_count,
        (
            select count(*)
            from public.shamo_get_pending_search_items(500)
                as pending_item
            cross join target
            where pending_item.ingestion_run_id =
                target.ingestion_run_id
        ) as pending_search_candidate_count
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
        metrics.question_count = 7,
        metrics.question_count::text
    from metrics

    union all

    select
        4,
        'paper mark total',
        metrics.total_marks = 50,
        metrics.total_marks::text
    from metrics

    union all

    select
        5,
        'question-part count',
        metrics.part_count = 18,
        metrics.part_count::text
    from metrics

    union all

    select
        6,
        'mark-scheme row count',
        metrics.mark_item_count = 51,
        metrics.mark_item_count::text
    from metrics

    union all

    select
        7,
        'instructional asset count',
        metrics.asset_count = 1,
        metrics.asset_count::text
    from metrics

    union all

    select
        8,
        'metadata row count',
        metrics.metadata_count = 7,
        metrics.metadata_count::text
    from metrics

    union all

    select
        9,
        'all metadata is structurally complete',
        count(*) = 0,
        count(*)::text
    from public.shamo_question_metadata as metadata
    cross join target
    where metadata.ingestion_run_id = target.ingestion_run_id
      and (
          btrim(metadata.main_topic) = ''
          or cardinality(metadata.skills) = 0
          or btrim(metadata.metadata_model) = ''
      )

    union all

    select
        10,
        'all metadata has been human-reviewed',
        count(*) = 7,
        count(*)::text
    from public.shamo_question_metadata as metadata
    cross join target
    where metadata.ingestion_run_id = target.ingestion_run_id
      and metadata.review_status = 'approved'

    union all

    select
        11,
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
        12,
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
        13,
        'no unresolved ingestion issues',
        count(*) = 0,
        count(*)::text
    from public.shamo_ingestion_issues as issue
    cross join target
    where issue.ingestion_run_id = target.ingestion_run_id
      and issue.resolved = false

    union all

    select
        14,
        'all mark codes have a valid format',
        count(*) = 0,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    cross join target
    where mark_item.ingestion_run_id = target.ingestion_run_id
      and mark_item.mark_code is not null
      and btrim(mark_item.mark_code)
          !~* '^\*?(D?M|A|B)[0-9]+([[:space:]]*FT)?([[:space:]]+[A-Z][A-Z0-9]*)*$'

    union all

    select
        15,
        'Question 6 legitimate guidance-only mark is preserved',
        count(*) = 1,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    join paper_questions as question
      on question.id = mark_item.question_id
    where question.question_number = 6
      and mark_item.sequence_number = 8
      and mark_item.mark_code = 'A1'
      and btrim(mark_item.content_markdown) = ''
      and strpos(
          mark_item.guidance_markdown,
          'Wholly correct integration and limits.'
      ) > 0

    union all

    select
        16,
        'no printed subtotal cells remain as answer rows',
        count(*) = 0,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    cross join target
    where mark_item.ingestion_run_id = target.ingestion_run_id
      and (
          btrim(coalesce(mark_item.mark_code, ''))
              ~ '^\*{0,2}[0-9]+\*{0,2}$'
          or (
              lower(mark_item.content_markdown) like 'total marks%'
              and btrim(mark_item.guidance_markdown) = ''
          )
      )

    union all

    select
        17,
        'no Markdown wrappers remain around mark codes',
        count(*) = 0,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    cross join target
    where mark_item.ingestion_run_id = target.ingestion_run_id
      and mark_item.mark_code ~ '^\*+.*\*+$'

    union all

    select
        18,
        'Question 6 metadata reflects the required graph',
        count(*) = 1,
        count(*)::text
    from public.shamo_question_metadata as metadata
    join paper_questions as question
      on question.id = metadata.question_id
    where question.question_number = 6
      and metadata.main_topic = 'Statistics'
      and metadata.diagram_required = true
      and metadata.review_status = 'approved'

    union all

    select
        19,
        'Question 6 graph asset was normalized correctly',
        count(*) = 1,
        count(*)::text
    from public.shamo_question_assets as asset
    join paper_questions as question
      on question.id = asset.question_id
    where question.question_number = 6
      and asset.source_page_number = 10
      and asset.source_image_index = 0
      and asset.asset_type = 'graph'
      and asset.bounding_box is null
      and btrim(asset.storage_path) <> ''
      and btrim(asset.description) <> ''

    union all

    select
        20,
        'search candidates are complete and awaiting embeddings',
        (
            metrics.stored_search_item_count = 0
            and metrics.pending_search_candidate_count =
                metrics.searchable_question_count + metrics.part_count
        ),
        concat(
            'stored=', metrics.stored_search_item_count,
            ', pending_candidates=',
            metrics.pending_search_candidate_count,
            ', expected=',
            metrics.searchable_question_count + metrics.part_count
        )
    from metrics

    union all

    select
        21,
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
-- Section 2: one row per live question.
-- Expected: questions 1-7, totals adding to 50, 18 parts, 51 instructional
-- mark rows,
-- and one asset.
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
        180
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
    '2f718302-24c2-48ee-b6bb-ee2ec932b722'::uuid
order by overview.question_number;

-- ---------------------------------------------------------------------------
-- Section 3: review all seven live metadata classifications.
-- Expected: all seven rows are approved. Questions 4 and 6 include the
-- source-checked taxonomy corrections described in the live correction.
-- ---------------------------------------------------------------------------

select
    question_number,
    main_topic,
    subtopics,
    skills,
    methods,
    question_style,
    difficulty_level,
    calculator_required,
    diagram_required,
    classification_confidence,
    review_status,
    reviewer_note
from public.shamo_question_metadata_review
where qualification = 'a_level'
  and syllabus_code = '9709'
  and year = 2024
  and exam_session = 'may_june'
  and paper_variant = '61'
order by question_number;

-- ---------------------------------------------------------------------------
-- Section 4: inspect the published graph asset.
-- Expected: one graph for Question 6, bounding_box is SQL NULL, and the
-- description, mathematical details and storage path are populated.
-- ---------------------------------------------------------------------------

select
    question.question_number,
    asset.source_page_number,
    asset.source_image_index,
    asset.asset_type,
    asset.bounding_box,
    asset.required_to_solve,
    asset.description,
    asset.mathematical_details,
    asset.storage_bucket,
    asset.storage_path,
    asset.mime_type,
    asset.byte_size
from public.shamo_question_assets as asset
join public.shamo_questions as question
  on question.id = asset.question_id
 and question.ingestion_run_id = asset.ingestion_run_id
where asset.ingestion_run_id =
    '054f296f-e08c-4360-a27d-325d064b2496'::uuid
order by
    question.question_number,
    asset.source_page_number,
    asset.source_image_index;

-- ---------------------------------------------------------------------------
-- Section 5: live chatbot context for Question 6.
-- Expected: a non-null payload containing all question parts, mark-scheme
-- guidance and the graph asset. Return it for visual review.
-- ---------------------------------------------------------------------------

select jsonb_pretty(
    public.shamo_get_question_context(
        'a_level',
        '9709',
        2024,
        'may_june',
        '61',
        6
    )
) as question_6_context;
