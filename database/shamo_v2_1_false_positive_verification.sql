-- Shamo v2.1 false-positive correction verification.
--
-- Run each numbered section separately after running
-- shamo_v2_1_false_positive_correction.sql.

-- ---------------------------------------------------------------------------
-- Section 1: both runs should now be ready for manual approval.
-- Expected: two rows, result = PASS.
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    run.id as ingestion_run_id,
    run.status,
    run.review_status,
    run.validation_report ->> 'passed' as validation_passed,
    run.verifier_report ->> 'passed' as verifier_passed,
    run.extraction_summary ->> 'ready_for_approval' as ready_for_approval,
    count(issue.id) filter (
        where issue.resolved = false
          and issue.severity = 'blocking'
    ) as open_blockers,
    case
        when run.status = 'awaiting_review'
         and run.review_status = 'pending'
         and run.validation_report ->> 'passed' = 'true'
         and run.verifier_report ->> 'passed' = 'true'
         and run.extraction_summary ->> 'ready_for_approval' = 'true'
         and count(issue.id) filter (
             where issue.resolved = false
               and issue.severity = 'blocking'
         ) = 0
        then 'PASS'
        else 'FAIL'
    end as result
from public.shamo_ingestion_runs as run
join public.shamo_papers as paper
    on paper.id = run.paper_id
left join public.shamo_ingestion_issues as issue
    on issue.ingestion_run_id = run.id
where run.id in (
    '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
    '054f296f-e08c-4360-a27d-325d064b2496'::uuid
)
group by paper.paper_variant, run.id
order by paper.paper_variant;

-- ---------------------------------------------------------------------------
-- Section 2: the two false-positive issue records should be retained as an
-- audit trail but marked resolved.
-- Expected: two rows, resolved = true, resolved_at is populated.
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    issue.issue_code,
    issue.question_number,
    issue.part_path,
    issue.resolved,
    issue.resolution_note,
    issue.resolved_at
from public.shamo_ingestion_issues as issue
join public.shamo_ingestion_runs as run
    on run.id = issue.ingestion_run_id
join public.shamo_papers as paper
    on paper.id = run.paper_id
where issue.ingestion_run_id in (
    '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
    '054f296f-e08c-4360-a27d-325d064b2496'::uuid
)
  and issue.issue_code = 'GUIDANCE_ONLY_ROW_HAS_MARK_CODE'
order by paper.paper_variant;

-- ---------------------------------------------------------------------------
-- Section 3: confirm that the legitimate source rows were preserved exactly.
-- Expected: two rows with blank content_markdown, A1, and nonblank Guidance.
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    (question ->> 'question_number')::integer as question_number,
    (mark_item ->> 'sequence_number')::integer as sequence_number,
    mark_item -> 'part_path' as part_path,
    mark_item ->> 'mark_code' as mark_code,
    mark_item ->> 'content_markdown' as content_markdown,
    mark_item ->> 'guidance_markdown' as guidance_markdown
from public.shamo_ingestion_runs as run
join public.shamo_papers as paper
    on paper.id = run.paper_id
cross join lateral jsonb_array_elements(
    run.extraction_summary #> '{paper_bundle,questions}'
) as question
cross join lateral jsonb_array_elements(
    question -> 'mark_scheme_items'
) as mark_item
where (
    run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
    and (question ->> 'question_number')::integer = 3
    and (mark_item ->> 'sequence_number')::integer = 2
) or (
    run.id = '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    and (question ->> 'question_number')::integer = 6
    and (mark_item ->> 'sequence_number')::integer = 8
)
order by paper.paper_variant;

-- ---------------------------------------------------------------------------
-- Section 4: encoding repair and duplicate Answer/Guidance audit.
-- First result should be 0. The second query may return rows and is a manual
-- review list; do not automatically alter or resolve them.
-- ---------------------------------------------------------------------------

select count(*) as corrupted_text_fragment_count
from public.shamo_ingestion_runs
where id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
  and (
      extraction_summary::text like '%â€%'
      or extraction_summary::text like '%â€“%'
      or extraction_summary::text like '%ï¿½%'
      or extraction_summary::text like '%�%'
  );

select
    paper.paper_variant,
    (question ->> 'question_number')::integer as question_number,
    (mark_item ->> 'sequence_number')::integer as sequence_number,
    mark_item -> 'part_path' as part_path,
    mark_item ->> 'mark_code' as mark_code,
    mark_item ->> 'content_markdown' as content_markdown,
    mark_item ->> 'guidance_markdown' as guidance_markdown
from public.shamo_ingestion_runs as run
join public.shamo_papers as paper
    on paper.id = run.paper_id
cross join lateral jsonb_array_elements(
    run.extraction_summary #> '{paper_bundle,questions}'
) as question
cross join lateral jsonb_array_elements(
    question -> 'mark_scheme_items'
) as mark_item
where run.id in (
    '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
    '054f296f-e08c-4360-a27d-325d064b2496'::uuid
)
  and length(btrim(coalesce(mark_item ->> 'content_markdown', ''))) >= 20
  and lower(regexp_replace(
      btrim(mark_item ->> 'content_markdown'),
      '\s+',
      ' ',
      'g'
  )) = lower(regexp_replace(
      btrim(mark_item ->> 'guidance_markdown'),
      '\s+',
      ' ',
      'g'
  ))
order by paper.paper_variant, question_number, sequence_number;

-- ---------------------------------------------------------------------------
-- Section 5: remaining warnings must still be reviewed manually.
-- No warnings are resolved by the correction script.
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    issue.issue_code,
    issue.question_number,
    issue.part_path,
    issue.message
from public.shamo_ingestion_issues as issue
join public.shamo_ingestion_runs as run
    on run.id = issue.ingestion_run_id
join public.shamo_papers as paper
    on paper.id = run.paper_id
where issue.ingestion_run_id in (
    '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
    '054f296f-e08c-4360-a27d-325d064b2496'::uuid
)
  and issue.resolved = false
order by paper.paper_variant, issue.severity desc, issue.question_number;

