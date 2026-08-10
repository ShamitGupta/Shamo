-- Shamo v2.1: calibration batch-1 measurement.
--
-- Scope: the six current batch-1 ingestion runs for variants 12, 21, 32,
-- 41, 52 and 61. The February-March 2025 variant-12 pilot is excluded.
-- This script is read-only and makes no provider API calls.

-- ---------------------------------------------------------------------------
-- Section 1: final published content and indexing counts per paper.
-- ---------------------------------------------------------------------------

with targets(paper_variant, run_id) as (
    values
        ('12', '414a7734-2afe-4bab-9896-02649106d027'::uuid),
        ('21', '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid),
        ('32', '466116cc-75de-423e-9745-e2e401cfbe29'::uuid),
        ('41', '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid),
        ('52', '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid),
        ('61', '054f296f-e08c-4360-a27d-325d064b2496'::uuid)
)
select
    target.paper_variant,
    paper.year,
    paper.exam_session,
    run.status || '/' || run.review_status as run_state,
    (select count(*) from public.shamo_questions as item
        where item.ingestion_run_id = target.run_id) as questions,
    (select count(*) from public.shamo_question_parts as item
        where item.ingestion_run_id = target.run_id) as stored_parts,
    (select sum(item.total_marks) from public.shamo_questions as item
        where item.ingestion_run_id = target.run_id) as total_marks,
    (select count(*) from public.shamo_mark_scheme_items as item
        where item.ingestion_run_id = target.run_id) as mark_rows,
    (select count(*) from public.shamo_question_assets as item
        where item.ingestion_run_id = target.run_id) as assets,
    (select coalesce(sum(item.byte_size), 0)
        from public.shamo_question_assets as item
        where item.ingestion_run_id = target.run_id) as asset_bytes,
    (select count(*) from public.shamo_paper_documents as item
        where item.ingestion_run_id = target.run_id) as documents,
    (select count(*) from public.shamo_question_metadata as item
        where item.ingestion_run_id = target.run_id) as metadata_rows,
    (select count(*) from public.shamo_question_metadata as item
        where item.ingestion_run_id = target.run_id
          and item.review_status = 'approved') as approved_metadata_rows,
    (select count(*) from public.shamo_question_search as item
        where item.ingestion_run_id = target.run_id) as search_rows
from targets as target
join public.shamo_ingestion_runs as run on run.id = target.run_id
join public.shamo_papers as paper on paper.id = run.paper_id
order by left(target.paper_variant, 1);

-- ---------------------------------------------------------------------------
-- Section 2: successful v2 extraction cost, repair use, and staging time.
-- Mistral OCR cost is not present because the workflow did not ledger it.
-- ---------------------------------------------------------------------------

with targets(paper_variant, run_id) as (
    values
        ('12', '414a7734-2afe-4bab-9896-02649106d027'::uuid),
        ('21', '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid),
        ('32', '466116cc-75de-423e-9745-e2e401cfbe29'::uuid),
        ('41', '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid),
        ('52', '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid),
        ('61', '054f296f-e08c-4360-a27d-325d064b2496'::uuid)
)
select
    target.paper_variant,
    run.attempt_count,
    round(extract(epoch from (run.finished_at - run.started_at))::numeric, 1)
        as staged_elapsed_seconds,
    count(cost.id) as finalized_cost_events,
    count(cost.id) filter (
        where cost.operation = 'targeted_question_repair'
    ) as targeted_repair_events,
    sum(cost.actual_usd) as actual_openai_usd,
    sum(cost.actual_usd) filter (
        where cost.operation = 'targeted_question_repair'
    ) as repair_openai_usd,
    sum(cost.input_tokens) as input_tokens,
    sum(cost.cached_input_tokens) as cached_input_tokens,
    sum(cost.output_tokens) as output_tokens
from targets as target
join public.shamo_ingestion_runs as run on run.id = target.run_id
left join public.shamo_api_cost_events as cost
  on cost.ingestion_run_id = target.run_id
 and cost.status = 'finalized'
group by target.paper_variant, run.attempt_count, run.started_at, run.finished_at
order by left(target.paper_variant, 1);

-- ---------------------------------------------------------------------------
-- Section 3: issue and correction mix. All current rows should be resolved.
-- ---------------------------------------------------------------------------

with targets(paper_variant, run_id) as (
    values
        ('12', '414a7734-2afe-4bab-9896-02649106d027'::uuid),
        ('21', '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid),
        ('32', '466116cc-75de-423e-9745-e2e401cfbe29'::uuid),
        ('41', '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid),
        ('52', '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid),
        ('61', '054f296f-e08c-4360-a27d-325d064b2496'::uuid)
)
select
    issue.issue_code,
    issue.severity,
    count(*) as occurrences,
    count(distinct target.paper_variant) as affected_papers,
    array_agg(distinct target.paper_variant order by target.paper_variant)
        as variants,
    count(*) filter (where issue.resolved) as resolved,
    count(*) filter (where not issue.resolved) as unresolved
from targets as target
join public.shamo_ingestion_issues as issue
  on issue.ingestion_run_id = target.run_id
group by issue.issue_code, issue.severity
order by occurrences desc, issue.issue_code;

-- ---------------------------------------------------------------------------
-- Section 4: batch-level totals and known measurement gaps.
-- ---------------------------------------------------------------------------

with targets(run_id) as (
    values
        ('414a7734-2afe-4bab-9896-02649106d027'::uuid),
        ('0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid),
        ('466116cc-75de-423e-9745-e2e401cfbe29'::uuid),
        ('98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid),
        ('754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid),
        ('054f296f-e08c-4360-a27d-325d064b2496'::uuid)
)
select
    (select count(*) from targets) as papers,
    (select count(*) from public.shamo_questions as item
        join targets on targets.run_id = item.ingestion_run_id) as questions,
    (select count(*) from public.shamo_question_parts as item
        join targets on targets.run_id = item.ingestion_run_id) as stored_parts,
    (select count(*) from public.shamo_mark_scheme_items as item
        join targets on targets.run_id = item.ingestion_run_id) as mark_rows,
    (select count(*) from public.shamo_question_assets as item
        join targets on targets.run_id = item.ingestion_run_id) as assets,
    (select coalesce(sum(item.byte_size), 0)
        from public.shamo_question_assets as item
        join targets on targets.run_id = item.ingestion_run_id) as asset_bytes,
    (select count(*) from public.shamo_question_metadata as item
        join targets on targets.run_id = item.ingestion_run_id) as metadata_rows,
    (select count(*) from public.shamo_question_metadata as item
        join targets on targets.run_id = item.ingestion_run_id
        where item.review_status = 'approved') as approved_metadata_rows,
    (select count(*) from public.shamo_question_search as item
        join targets on targets.run_id = item.ingestion_run_id) as search_rows,
    (select count(*) from public.shamo_ingestion_issues as issue
        join targets on targets.run_id = issue.ingestion_run_id) as issue_rows,
    (select count(*) from public.shamo_ingestion_issues as issue
        join targets on targets.run_id = issue.ingestion_run_id
        where not issue.resolved) as unresolved_issue_rows,
    (select count(*) from public.shamo_get_pending_search_items(500))
        as global_pending_search_rows,
    (select database_megabytes from public.shamo_database_usage limit 1)
        as current_database_megabytes,
    'Mistral cost and human reviewer minutes were not recorded'::text
        as known_measurement_gap;
