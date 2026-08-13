-- Sync the stale `validation_report.passed` flag on the 8 false-blocker papers.
--
-- FOUND DURING PUBLICATION, 12 August 2026: the publisher workflow's own gate
-- node (`Inspect Reviewed Run` in `Shamo Budget v1 - Approve Reviewed Paper and
-- Metadata`) throws "Deterministic validation did not pass." for
-- 9709/63 M/J 2024 -- one of the eight papers already cleared by
-- shamo_v2_3_false_blocker_corrections.sql on 11 August.
--
-- THE GAP
--
-- A run carries validation state in THREE places, and 11 August's correction
-- updated two of them:
--   - shamo_ingestion_issues       -- the live issue rows; resolved there
--   - extraction_summary.ready_for_approval -- flipped to true there
--   - verifier_report.passed                -- flipped to true there
--   - validation_report.passed              -- NOT touched, still false
--
-- validation_report is a JSON SNAPSHOT written once by the validator at
-- staging time and never revisited afterwards -- it is not derived from
-- shamo_ingestion_issues, so resolving an issue row does not update it. The
-- publisher's own gate node reads exactly this field:
--
--     if (run.validation_report?.passed !== true) {
--       throw new Error('Deterministic validation did not pass.');
--     }
--
-- and nothing else in that node -- confirmed by reading the live node source
-- via the n8n API before writing this file, rather than guessing at the check.
--
-- WHY THIS IS SAFE
--
-- All eight runs were independently confirmed on 11 August to be validator
-- false positives -- each read against source, extraction faithful, rule
-- wrong -- and all eight rules have since been fixed at source. This file
-- changes NO academic content and no other flag; it makes the third
-- bookkeeping field agree with the two that were already corrected, for
-- exactly the eight runs where shamo_ingestion_issues independently confirms
-- zero unresolved blockers today.
--
-- SCOPE
--
-- Only `validation_report.passed` and `validation_report.blocking_issue_count`
-- on the eight runs. The `issues` array inside validation_report is left as
-- printed history of what the validator originally reported -- same
-- convention as shamo_ingestion_issues.message, which is never edited either.

begin;

create temporary table _val_sync on commit drop as
select r.id as run_id,
       p.paper_variant, p.year, p.exam_session,
       r.validation_report->>'passed' as passed_before,
       r.validation_report->>'blocking_issue_count' as blocking_before
from shamo_ingestion_runs r
join shamo_papers p on p.id = r.paper_id
where r.idempotency_key ~ 'v2\.3-batch-'
  and r.status = 'awaiting_review'
  and r.extraction_summary->>'ready_for_approval' = 'true'
  and r.verifier_report->>'passed' = 'true'
  and coalesce(r.validation_report->>'passed', 'true') <> 'true'
for update of r;

do $$
declare
  n int;
  bad record;
begin
  select count(*) into n from _val_sync;
  if n <> 8 then
    raise exception 'Expected exactly 8 stale runs (the known 11 August false blockers), found %', n;
  end if;

  -- Every one of the eight must have zero unresolved blockers RIGHT NOW. This
  -- is the actual safety condition, checked live rather than assumed from the
  -- 11 August history.
  for bad in
    select v.run_id, v.paper_variant, v.year, v.exam_session, count(i.id) as unresolved
    from _val_sync v
    left join shamo_ingestion_issues i
      on i.ingestion_run_id = v.run_id and i.severity = 'blocking' and not i.resolved
    group by v.run_id, v.paper_variant, v.year, v.exam_session
    having count(i.id) > 0
  loop
    raise exception 'Run % (9709/%s %s %s) still has % unresolved blocking issue(s); refusing to sync',
      bad.run_id, bad.paper_variant, bad.year, bad.exam_session, bad.unresolved;
  end loop;
end $$;

update shamo_ingestion_runs r
   set validation_report = jsonb_set(
         jsonb_set(r.validation_report, '{passed}', 'true'::jsonb),
         '{blocking_issue_count}', '0'::jsonb
       ),
       updated_at = now()
  from _val_sync v
 where r.id = v.run_id;

-- Audit trail, one row per paper. Question-level fields NULL: this is a
-- run-level bookkeeping fix, not tied to any question or part.
insert into shamo_ingestion_issues
  (ingestion_run_id, question_number, part_path, severity, issue_code, message,
   resolved, resolved_at, resolution_note)
select run_id, null::int, null::text[], 'warning', 'VALIDATION_REPORT_SYNCED_POST_HOC',
       'validation_report.passed was still false after the false-blocker correction of '
       '11 August had already resolved the underlying issue and flipped '
       'extraction_summary.ready_for_approval and verifier_report.passed to true. '
       'validation_report is a point-in-time snapshot and is not derived from '
       'shamo_ingestion_issues, so resolving the issue row did not update it.',
       true, now(),
       'Synced validation_report.passed to true and blocking_issue_count to 0, matching the '
       'two flags already corrected and the zero unresolved blockers confirmed live. '
       'Found because the publisher workflow''s own gate node reads validation_report.passed '
       'directly (confirmed from the live node source) and threw on 9709/63 M/J 2024 during '
       'an attempted publish. Applied by '
       'database/shamo_v2_3_validation_report_sync_correction.sql.'
from _val_sync;

do $$
declare n int;
begin
  select count(*) into n
  from shamo_ingestion_runs r join _val_sync v on v.run_id = r.id
  where coalesce(r.validation_report->>'passed', 'false') <> 'true';
  if n <> 0 then
    raise exception 'validation_report.passed still not true on % run(s)', n;
  end if;
end $$;

commit;

-- ------------------------------------------------------------------
-- Verification -- every row should read PASS.
-- ------------------------------------------------------------------
select '1. all 8 now pass validation_report' as check,
       case when count(*) = 8 then 'PASS' else 'FAIL' end as result,
       count(*) || ' run(s) (expect 8)' as detail
from shamo_ingestion_runs r
join shamo_papers p on p.id = r.paper_id
where r.idempotency_key ~ 'v2\.3-batch-'
  and r.status = 'awaiting_review'
  and r.validation_report->>'passed' = 'true'
  and (p.paper_variant, p.year, p.exam_session) in (
    ('13','2025','may_june'), ('13','2025','oct_nov'), ('21','2025','may_june'),
    ('22','2025','may_june'), ('23','2025','may_june'), ('42','2025','may_june'),
    ('53','2025','oct_nov'),  ('63','2024','may_june')
  )

union all

select '2. no run has all-flags-mismatched anymore',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' run(s) where the three flags still disagree'
from shamo_ingestion_runs
where idempotency_key ~ 'v2\.3-batch-' and status = 'awaiting_review'
  and extraction_summary->>'ready_for_approval' = 'true'
  and verifier_report->>'passed' = 'true'
  and coalesce(validation_report->>'passed', 'false') <> 'true'

union all

select '3. all 60 still ready_for_approval',
       case when count(*) = 60 then 'PASS' else 'FAIL' end,
       count(*) || ' of 60'
from shamo_ingestion_runs
where idempotency_key ~ 'v2\.3-batch-' and status = 'awaiting_review'
  and extraction_summary->>'ready_for_approval' = 'true'

union all

select '4. audit rows recorded',
       case when count(*) = 8 then 'PASS' else 'FAIL' end,
       count(*) || ' resolved VALIDATION_REPORT_SYNCED_POST_HOC row(s) (expect 8)'
from shamo_ingestion_issues
where issue_code = 'VALIDATION_REPORT_SYNCED_POST_HOC' and resolved

union all

select '5. published content unchanged',
       case when count(*) = 25 then 'PASS' else 'FAIL' end,
       count(*) || ' published papers (expect 25, will grow as batches publish)'
from shamo_papers where status = 'published'

order by 1;
