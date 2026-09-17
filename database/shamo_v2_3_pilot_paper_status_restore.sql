-- Restore 9709/12 February/March 2025 (the pilot paper) to published.
--
-- WHAT HAPPENED
--
-- On 10 August 2026 the v2.3 expansion run re-staged this paper as part of
-- batch 8, which flipped shamo_papers.status from 'published' to 'staging'.
-- Because shamo_published_question_overview filters on status = 'published',
-- the paper silently disappeared from the tutor's catalogue: the frontend
-- selector stopped offering it and GET /papers no longer listed it.
--
-- WHY IT HAPPENED
--
-- The staging child's skip guard looks a run up by idempotency_key ONLY:
--
--     GET shamo_ingestion_runs?idempotency_key=eq.<key>
--
-- It never asks whether the PAPER is already published. The expansion run used
-- workflow_version v2.3 (bumped to avoid colliding with the existing
-- v2.2-batch-04 batch key), which produced a brand-new idempotency key, so the
-- guard found no prior run and the paper was re-staged from scratch.
--
-- This is documented behaviour, not a new bug: the operating guide states the
-- child "skips only retries of the same idempotency key" and names the
-- selection preflight as the practical guard against reprocessing a published
-- paper. The preflight was run and DID report that batch 8 contained one
-- already-published paper. That report was noted and then not acted on.
--
-- WHAT WAS AND WAS NOT DAMAGED
--
-- Damaged: shamo_papers.status, one row, one column.
--
-- Intact, verified before writing this file:
--   * 11 published questions, 20 parts, 96 mark-scheme rows, 29 search rows
--   * current_ingestion_run_id still points at the published run
--     1298c634-b404-4a36-9aa9-3739e88caf08 (status complete, review_status
--     approved, published_at 2026-07-25)
--   * the new staging run 549ff16f-... is NOT current and touches no
--     published row
--
-- So this restores a pointer, not content. No academic data is rewritten.
--
-- The new staging run is deliberately LEFT IN PLACE rather than deleted. It
-- cost USD 0.046863 and it is evidence of what happened; deleting it would also
-- remove its cost events from the ledger, which is the one record that makes
-- the wasted spend visible.

begin;

-- Lock the target and assert the exact state before changing anything. If any
-- assertion fails the transaction aborts, so a file that no longer matches
-- reality cannot silently do something else.
do $$
declare
  v_paper_id uuid;
  v_status text;
  v_current_run uuid;
  v_questions integer;
  v_parts integer;
  v_mark_rows integer;
  v_search_rows integer;
begin
  select id, status, current_ingestion_run_id
    into v_paper_id, v_status, v_current_run
  from shamo_papers
  where qualification = 'a_level'
    and syllabus_code = '9709'
    and year = 2025
    and exam_session = 'feb_march'
    and paper_variant = '12'
  for update;

  if v_paper_id is null then
    raise exception 'Pilot paper 9709/12 Feb-March 2025 not found.';
  end if;

  if v_status = 'published' then
    raise exception 'Paper is already published; nothing to restore. Status = %.', v_status;
  end if;

  if v_status <> 'staging' then
    raise exception 'Expected status staging, found %. Investigate before running this file.', v_status;
  end if;

  if v_current_run <> '1298c634-b404-4a36-9aa9-3739e88caf08'::uuid then
    raise exception
      'current_ingestion_run_id is %, expected the published run 1298c634-.... '
      'The provenance pointer moved too; this file only restores status and is not sufficient.',
      v_current_run;
  end if;

  -- The published content must still be there. Restoring status on an empty
  -- paper would put an empty paper back in front of students.
  select count(*) into v_questions
    from shamo_questions where paper_id = v_paper_id and ingestion_run_id = v_current_run;
  select count(*) into v_parts
    from shamo_question_parts pt join shamo_questions q on q.id = pt.question_id
    where q.paper_id = v_paper_id and pt.ingestion_run_id = v_current_run;
  select count(*) into v_mark_rows
    from shamo_mark_scheme_items m join shamo_questions q on q.id = m.question_id
    where q.paper_id = v_paper_id and m.ingestion_run_id = v_current_run;
  select count(*) into v_search_rows
    from shamo_question_search s join shamo_questions q on q.id = s.question_id
    where q.paper_id = v_paper_id;

  if v_questions <> 11 or v_parts <> 20 or v_mark_rows <> 96 or v_search_rows <> 29 then
    raise exception
      'Published content does not match the expected 11/20/96/29; found %/%/%/%. '
      'Do not restore status until this is understood.',
      v_questions, v_parts, v_mark_rows, v_search_rows;
  end if;

  update shamo_papers
     set status = 'published',
         updated_at = now()
   where id = v_paper_id;

  raise notice
    'Restored 9709/12 Feb-March 2025 to published. Content verified at %q/%p/%m/%s.',
    v_questions, v_parts, v_mark_rows, v_search_rows;
end $$;

-- Record what happened against the run that caused it, so the incident is
-- discoverable from the ingestion history rather than only from a git log.
--
-- resolved/resolved_at must be set together: shamo_ingestion_issues_check ties
-- them. part_path must be NULL rather than an empty array, because
-- valid_part_path() rejects '{}'. Both learned the hard way on 9 August.
insert into shamo_ingestion_issues (
  ingestion_run_id, severity, issue_code, question_number, part_path,
  message, resolved, resolution_note, resolved_at
)
select
  '549ff16f-35bf-4ea4-a5ad-c9618063341d'::uuid,
  'warning',
  'PUBLISHED_PAPER_RESTAGED',
  null,
  null,
  'This run re-staged an already-published paper, resetting shamo_papers.status to staging.',
  true,
  'Status restored to published by database/shamo_v2_3_pilot_paper_status_restore.sql. '
  'Published content was verified intact and unchanged (11 questions, 20 parts, 96 mark rows, '
  '29 search rows) and current_ingestion_run_id never moved off the published run. Root cause: '
  'the child skip guard keys on idempotency_key alone, so bumping workflow_version to v2.3 '
  'produced a new key and the paper was re-processed. A paper-status guard is the durable fix.',
  now()
where not exists (
  select 1 from shamo_ingestion_issues
  where ingestion_run_id = '549ff16f-35bf-4ea4-a5ad-c9618063341d'::uuid
    and issue_code = 'PUBLISHED_PAPER_RESTAGED'
);

commit;
