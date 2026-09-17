-- Shamo v2.1 batch 2: verify the Q7 duplicate-guidance false-positive
-- correction.
--
-- Run after shamo_v2_1_batch2_q7_duplicate_guidance_false_positive_correction.sql.

-- Section 1: both target runs should be awaiting review, validation-passing,
-- and ready for approval.
select
    run.id,
    substring(run.idempotency_key from ':(202[0-9]):') as year,
    substring(run.idempotency_key from ':(feb_march|may_june|oct_nov):')
        as exam_session,
    substring(run.idempotency_key from ':([0-9]{2})$') as paper_variant,
    run.status,
    run.review_status,
    run.validation_report ->> 'passed' as validation_passed,
    run.validation_report ->> 'blocking_issue_count' as blocking_issue_count,
    run.validation_report ->> 'warning_count' as warning_count,
    run.extraction_summary ->> 'ready_for_approval' as ready_for_approval,
    case
        when run.status = 'awaiting_review'
         and run.review_status = 'pending'
         and run.validation_report ->> 'passed' = 'true'
         and run.validation_report ->> 'blocking_issue_count' = '0'
         and run.extraction_summary ->> 'ready_for_approval' = 'true'
        then 'PASS'
        else 'FAIL'
    end as check_result
from public.shamo_ingestion_runs as run
where run.id in (
    '38aa9576-9519-49bd-81ce-34275525f985'::uuid,
    '38103a22-dc31-4060-aead-7bad9b77a174'::uuid
)
order by paper_variant;

-- Section 2: the two reviewed blockers should be resolved with source notes.
select
    issue.ingestion_run_id,
    issue.issue_code,
    issue.severity,
    issue.question_number,
    issue.part_path,
    issue.resolved,
    issue.resolution_note,
    case
        when issue.resolved = true
         and issue.resolution_note ilike '%validator false positive%'
        then 'PASS'
        else 'FAIL'
    end as check_result
from public.shamo_ingestion_issues as issue
where issue.ingestion_run_id in (
    '38aa9576-9519-49bd-81ce-34275525f985'::uuid,
    '38103a22-dc31-4060-aead-7bad9b77a174'::uuid
)
  and issue.issue_code = 'DUPLICATED_ANSWER_GUIDANCE_TEXT'
  and issue.question_number = 7
order by issue.ingestion_run_id;

-- Section 3: no unresolved blockers should remain on the two target runs.
select
    issue.ingestion_run_id,
    count(*) filter (
        where issue.resolved = false
          and issue.severity = 'blocking'
    ) as unresolved_blockers,
    count(*) filter (
        where issue.resolved = false
          and issue.severity = 'warning'
    ) as unresolved_warnings,
    case
        when count(*) filter (
            where issue.resolved = false
              and issue.severity = 'blocking'
        ) = 0
        then 'PASS'
        else 'FAIL'
    end as check_result
from public.shamo_ingestion_issues as issue
where issue.ingestion_run_id in (
    '38aa9576-9519-49bd-81ce-34275525f985'::uuid,
    '38103a22-dc31-4060-aead-7bad9b77a174'::uuid
)
group by issue.ingestion_run_id
order by issue.ingestion_run_id;

-- Section 4: all six batch-2 runs should now have no blocking issues in their
-- validation reports. Warnings still require manual review.
select
    substring(run.idempotency_key from ':(202[0-9]):') as year,
    substring(run.idempotency_key from ':(feb_march|may_june|oct_nov):')
        as exam_session,
    substring(run.idempotency_key from ':([0-9]{2})$') as paper_variant,
    run.status,
    run.review_status,
    run.validation_report ->> 'passed' as validation_passed,
    run.validation_report ->> 'blocking_issue_count' as blocking_issue_count,
    run.validation_report ->> 'warning_count' as warning_count,
    run.extraction_summary ->> 'ready_for_approval' as ready_for_approval,
    case
        when run.status = 'awaiting_review'
         and run.review_status = 'pending'
         and run.validation_report ->> 'passed' = 'true'
         and run.validation_report ->> 'blocking_issue_count' = '0'
         and run.extraction_summary ->> 'ready_for_approval' = 'true'
        then 'PASS'
        else 'FAIL'
    end as check_result
from public.shamo_ingestion_runs as run
where run.idempotency_key like
    'budget-v2.1:a-level-9709-test2-pilot-v1-v2.1-batch-02:%'
order by (run.source_summary ->> 'batch_position')::integer;
