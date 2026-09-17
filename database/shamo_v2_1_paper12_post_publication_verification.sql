-- Shamo v2.1: read-only post-publication verification for the first
-- remaining batch-1 paper, Cambridge 9709 variant 12.
--
-- Published ingestion run:
--   414a7734-2afe-4bab-9896-02649106d027
-- Published paper:
--   df50b0d6-0483-47ab-8192-798e5083a88d
--
-- Run each numbered section separately in the Supabase SQL editor.
-- This file does not modify data and does not make API calls.

-- ---------------------------------------------------------------------------
-- Section 1: compact database audit.
-- Expected: every row says PASS.
-- ---------------------------------------------------------------------------

with
target as (
    select
        '414a7734-2afe-4bab-9896-02649106d027'::uuid
            as ingestion_run_id,
        'df50b0d6-0483-47ab-8192-798e5083a88d'::uuid
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
        metrics.part_count = 17,
        metrics.part_count::text
    from metrics

    union all

    select
        6,
        'mark-scheme row count',
        metrics.mark_item_count = 73,
        metrics.mark_item_count::text
    from metrics

    union all

    select
        7,
        'instructional asset count',
        metrics.asset_count = 3,
        metrics.asset_count::text
    from metrics

    union all

    select
        8,
        'metadata row count',
        metrics.metadata_count = 11,
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
          btrim(coalesce(metadata.main_topic, '')) = ''
          or coalesce(cardinality(metadata.skills), 0) = 0
          or btrim(coalesce(metadata.metadata_model, '')) = ''
      )

    union all

    select
        10,
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
        11,
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
        12,
        'all mark codes have a valid format',
        count(*) = 0,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    cross join target
    where mark_item.ingestion_run_id = target.ingestion_run_id
      and mark_item.mark_code is not null
      and btrim(mark_item.mark_code) !~*
          '^\*?(D?M|A|B)[0-9]+([[:space:]]*FT)?'
          '([[:space:]]+[A-Z][A-Z0-9]*)*$'

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
        'Question 7 dependency mark is preserved',
        count(*) = 1,
        count(*)::text
    from public.shamo_mark_scheme_items as mark_item
    join paper_questions as question
      on question.id = mark_item.question_id
    where question.question_number = 7
      and mark_item.mark_code = '*M1'
      and mark_item.is_alternative_method = false

    union all

    select
        15,
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
        16,
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
-- Section 2: one row per published question.
-- Expected: questions 1-11, marks adding to 75, 17 parts, 73 mark rows,
-- and three assets.
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
    'df50b0d6-0483-47ab-8192-798e5083a88d'::uuid
order by overview.question_number;

-- ---------------------------------------------------------------------------
-- Section 3: inspect all published metadata classifications.
-- Expected: 11 rows. Question 4 should describe the tan(theta)=5/4 method,
-- and Question 8 should have main_topic=Algebra.
-- ---------------------------------------------------------------------------

select
    question.question_number,
    metadata.main_topic,
    metadata.subtopics,
    metadata.skills,
    metadata.methods,
    metadata.question_style,
    metadata.difficulty_level,
    metadata.calculator_required,
    metadata.diagram_required,
    metadata.classification_confidence,
    metadata.review_status,
    metadata.reviewer_note
from public.shamo_question_metadata as metadata
join public.shamo_questions as question
  on question.id = metadata.question_id
where metadata.ingestion_run_id =
    '414a7734-2afe-4bab-9896-02649106d027'::uuid
order by question.question_number;

-- ---------------------------------------------------------------------------
-- Section 4: live chatbot context for Question 7.
-- Expected: a non-null payload containing the complete question, parts,
-- the primary *M1 dependency mark, and examiner guidance.
-- ---------------------------------------------------------------------------

select jsonb_pretty(
    public.shamo_get_question_context(
        paper.qualification::text,
        paper.syllabus_code,
        paper.year,
        paper.exam_session::text,
        paper.paper_variant,
        7
    )
) as question_7_context
from public.shamo_papers as paper
where paper.id =
    'df50b0d6-0483-47ab-8192-798e5083a88d'::uuid;
