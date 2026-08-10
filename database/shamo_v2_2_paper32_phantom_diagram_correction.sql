-- Unblock the staged 9709/32 February/March 2024 bundle.
--
-- WHAT AND WHY
-- ------------
-- This was the last batch-3 paper still staged, blocked since 8 August on a
-- required diagram that targeted repair could not recover. It could not recover
-- it because the diagram does not exist.
--
-- Question 5 reads, in full:
--
--   (a) On a sketch of an Argand diagram, shade the region whose points
--       represent complex numbers z satisfying |z-4-2i| <= 3 and |z| >= |10-z|.
--   (b) Find the greatest value of arg z for points in this region.
--
-- The CANDIDATE draws the diagram. There is nothing printed to capture. Three
-- independent readings agree:
--
--   * question-paper page 7, where Q5 is printed, contains zero images;
--   * the mark scheme contains zero images on all 18 pages, so the claimed
--     source `mark_scheme:10:1` cannot exist anywhere in that document;
--   * the printed text is answer lines, not a figure.
--
-- So `diagram_required = true` was wrong, and the asset the model claimed was
-- invented. ASSET_SOURCE_NOT_FOUND did its job: it refused to accept an asset
-- with no source. The blocker was correct; the metadata behind it was not.
--
-- THE CHECK CAME FIRST, as the standing rule requires. New warning-severity
-- rule DIAGRAM_REQUIRED_BUT_CANDIDATE_DRAWS_IT in lib/validation_rules.mjs
-- recognises "on a sketch / sketch the / draw the / shade the region" with no
-- reference to a printed diagram, and reports that diagram_required should be
-- false rather than sending a reviewer hunting for a missing image. Verified by
-- offline replay: this paper now yields 0 blocking issues and that one warning.
--
-- The blocking DIAGRAM_REQUIRED_WITHOUT_ASSET rule is unchanged and still
-- catches the real case -- 9709/11 Q11, where a genuinely printed graph was
-- dropped. The two are separated by whether the text references a printed
-- diagram, because a question can both show one and ask for a sketch.
--
-- This is the second time the class has appeared: 9709/32 M/J Q1 needed the
-- same correction during batch 1. Twice is a class, not an accident.
--
-- THE PAPER ITSELF IS SOUND, verified offline before this correction was written:
--   * printed [N] mark allocations match exactly -- 20 of 20 parts, 75/75 marks,
--     correct count, sum and order;
--   * 25 staged prose items all appear in the printed paper, zero invented;
--   * OCR versus the PDF text layer shows zero lost symbols across 38 pages;
--   * the run's own totals agree: 11 questions and 75 marks, source and extracted.
--
-- The other two blockers are consequences of the first and are stale:
--   ASSET_UPLOAD_COUNT_MISMATCH  "Extracted 2 assets but uploaded 1" counted the
--     pre-repair state. The bundle now holds exactly 1 asset (Q7's coordinate
--     grid, uploaded to Storage), so extracted and uploaded already agree.
--   REPAIR_DID_NOT_CLEAR_BLOCKERS  is a true record that repair ran and failed.
--     It is resolved rather than deleted, because repair genuinely could not fix
--     this and that fact is worth keeping.
--
-- SAFETY
-- ------
--   * One run, asserted by id and by its exact current state before any change.
--   * Q5 asserted to have diagram_required = true and zero assets first.
--   * The bundle's academic content -- questions, parts, mark rows, marks -- is
--     NOT touched. Only the metadata flag and the run's validation state change.
--   * `review_status` stays `pending`; this authorises publication, it does not
--     record a metadata row review.
--   * Verify with database/shamo_v2_2_paper32_phantom_diagram_verification.sql.
--
-- Target: run 460f3b25-6a00-49e2-ac35-c37cfd9c6a1b
-- Expected: 3 blocking issues -> 0, ready_for_approval false -> true.

begin;

do $$
declare
  v_run_id uuid := '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b';
  v_status text;
  v_review text;
  v_paper_status text;
  v_q5_diagram text;
  v_q5_assets int;
  v_bundle_assets int;
  v_blocking_before int;
  v_blocking_after int;
  v_bundle jsonb;
  v_report jsonb;
  v_kept jsonb;
begin
  select r.status, r.review_status, p.status
    into v_status, v_review, v_paper_status
  from public.shamo_ingestion_runs r
  join public.shamo_papers p on p.id = r.paper_id
  where r.id = v_run_id
  for update of r;

  if v_status is null then
    raise exception 'Run % not found.', v_run_id;
  end if;
  if v_status <> 'awaiting_review' or v_review <> 'pending' or v_paper_status <> 'staging' then
    raise exception 'Expected awaiting_review/pending on a staging paper, found %/% on %.',
      v_status, v_review, v_paper_status;
  end if;

  -- Assert the exact defect this file was written for, before repairing it.
  select q->'metadata'->>'diagram_required',
         jsonb_array_length(coalesce(q->'assets', '[]'::jsonb))
    into v_q5_diagram, v_q5_assets
  from public.shamo_ingestion_runs r,
       jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q
  where r.id = v_run_id and q->>'question_number' = '5';

  if v_q5_diagram is distinct from 'true' or v_q5_assets <> 0 then
    raise exception
      'Q5 was expected to have diagram_required=true and 0 assets, found %/% assets. Nothing changed.',
      coalesce(v_q5_diagram, 'null'), v_q5_assets;
  end if;

  select count(*) into v_blocking_before
  from public.shamo_ingestion_issues
  where ingestion_run_id = v_run_id and severity = 'blocking' and not resolved;

  if v_blocking_before <> 3 then
    raise exception 'Expected 3 unresolved blocking issues, found %. Nothing changed.', v_blocking_before;
  end if;

  -- 1. Q5 metadata: the candidate draws the diagram, so none is required.
  select jsonb_set(
           extraction_summary->'paper_bundle',
           '{questions}',
           (select jsonb_agg(
                     case when q->>'question_number' = '5'
                       then jsonb_set(q, '{metadata,diagram_required}', 'false'::jsonb)
                       else q
                     end order by (q->>'question_number')::int)
            from jsonb_array_elements(extraction_summary->'paper_bundle'->'questions') q)
         )
    into v_bundle
  from public.shamo_ingestion_runs where id = v_run_id;

  -- 2. Validation report: drop the three blocking entries, keep every warning,
  --    and record the replacement warning so the report explains itself.
  select coalesce(jsonb_agg(issue), '[]'::jsonb) into v_kept
  from public.shamo_ingestion_runs r,
       jsonb_array_elements(r.validation_report->'issues') issue
  where r.id = v_run_id and issue->>'severity' <> 'blocking';

  v_kept := v_kept || jsonb_build_object(
    'message', 'Metadata marks this question as requiring a source diagram, but the question asks the candidate to produce the sketch and no printed diagram is referenced. diagram_required should be false; there is no missing asset to recover.',
    'severity', 'warning',
    'part_path', '[]'::jsonb,
    'issue_code', 'DIAGRAM_REQUIRED_BUT_CANDIDATE_DRAWS_IT',
    'page_number', null,
    'document_type', null,
    'question_number', 5
  );

  select validation_report into v_report from public.shamo_ingestion_runs where id = v_run_id;
  v_report := v_report
    || jsonb_build_object('issues', v_kept)
    || jsonb_build_object('passed', true)
    || jsonb_build_object('blocking_issue_count', 0)
    || jsonb_build_object('warning_count', jsonb_array_length(v_kept));

  update public.shamo_ingestion_runs
     set validation_report = v_report,
         extraction_summary = jsonb_set(
           jsonb_set(extraction_summary, '{paper_bundle}', v_bundle),
           '{ready_for_approval}', 'true'::jsonb
         )
   where id = v_run_id;

  -- 3. Resolve the three blocking rows with the source finding on each.
  update public.shamo_ingestion_issues
     set resolved = true,
         resolved_at = now(),
         resolution_note = case issue_code
           when 'ASSET_SOURCE_NOT_FOUND' then
             'Source-checked 2026-08-09: the asset was invented. The mark scheme contains zero images on all 18 pages, so mark_scheme:10:1 cannot exist, and question-paper page 7 where Q5 is printed also contains none. Q5 asks the candidate to draw the Argand diagram, so diagram_required was set to false.'
           when 'ASSET_UPLOAD_COUNT_MISMATCH' then
             'Stale: the count of 2 predates targeted repair, which dropped the invented Q5 asset. The bundle now holds exactly 1 asset, Q7 coordinate_grid, and it is uploaded to Storage.'
           when 'REPAIR_DID_NOT_CLEAR_BLOCKERS' then
             'Correct at the time and kept as a true record. Repair could not recover a diagram that was never printed; the underlying blocker was a metadata error, now corrected.'
           else 'Resolved by source review 2026-08-09.'
         end
   where ingestion_run_id = v_run_id and severity = 'blocking' and not resolved;

  select count(*) into v_blocking_after
  from public.shamo_ingestion_issues
  where ingestion_run_id = v_run_id and severity = 'blocking' and not resolved;

  if v_blocking_after <> 0 then
    raise exception '% blocking issues still unresolved. Rolled back.', v_blocking_after;
  end if;

  -- Post-conditions: the bundle must be unchanged apart from the one flag.
  select jsonb_array_length(extraction_summary->'paper_bundle'->'questions'),
         (select count(*) from jsonb_array_elements(extraction_summary->'paper_bundle'->'questions') q,
                 jsonb_array_elements(coalesce(q->'assets','[]'::jsonb)) a)
    into v_q5_assets, v_bundle_assets
  from public.shamo_ingestion_runs where id = v_run_id;

  if v_q5_assets <> 11 then
    raise exception 'Question count changed to %. Rolled back.', v_q5_assets;
  end if;
  if v_bundle_assets <> 1 then
    raise exception 'Bundle asset count is %, expected 1. Rolled back.', v_bundle_assets;
  end if;
end;
$$;

-- Audit trail.
insert into public.shamo_ingestion_issues (
    ingestion_run_id, severity, issue_code, document_type, question_number,
    part_path, message, resolved, resolution_note, resolved_at)
select '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b'::uuid, 'warning', 'METADATA_DIAGRAM_FLAG_CORRECTED',
       'question_paper', 5, null,
       'Question 5 had diagram_required=true although it asks the candidate to sketch the Argand diagram and no diagram is printed.',
       true,
       'Set diagram_required=false after confirming zero images on question-paper page 7 and zero images anywhere in the 18-page mark scheme. New validator rule DIAGRAM_REQUIRED_BUT_CANDIDATE_DRAWS_IT prevents recurrence.',
       now()
where not exists (
    select 1 from public.shamo_ingestion_issues
    where ingestion_run_id = '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b'::uuid
      and issue_code = 'METADATA_DIAGRAM_FLAG_CORRECTED');

commit;

-- ---------------------------------------------------------------------------
-- OPERATOR STEP -- deliberately NOT run by the agent
-- ---------------------------------------------------------------------------
--
-- Everything above unblocks the paper. It does not approve it.
--
-- `verifier_report.passed` is the human review gate, and its own note says so:
-- "Bulk mode uses deterministic checks and requires human review before
-- publication." The publish RPC refuses any run where it is false, which is why
-- the webhook returned "Verifier report has not passed" even with all six
-- workflow-level checks green. The other five batch-3 papers had this flipped
-- during the 8 August review; 9709/32 was skipped because it was blocked.
--
-- The operating guide is explicit that agent-assisted source review is recorded
-- distinctly and does NOT replace the operator's final paper approval, so the
-- agent stopped here on purpose. Run this yourself once satisfied with the
-- evidence, then POST the run id to /webhook/shamo-publish-paper.
--
-- Evidence supporting approval, all gathered offline and free:
--   * printed [N] mark allocations exact -- 20 of 20 parts, 75/75 marks, on
--     count, sum and order;
--   * 25 staged prose items all present in the printed paper, zero invented;
--   * OCR versus PDF text layer -- zero lost symbols across 38 pages;
--   * Q5's phantom diagram source-checked -- zero images on question-paper
--     page 7 and zero images anywhere in the 18-page mark scheme.
--
-- begin;
-- do $$
-- declare
--   v_run_id uuid := '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b';
--   v_blocking int;
-- begin
--   if (select verifier_report->>'passed' from public.shamo_ingestion_runs where id = v_run_id) <> 'false'
--     then raise exception 'Verifier gate is not false. Nothing changed.'; end if;
--   if (select validation_report->>'passed' from public.shamo_ingestion_runs where id = v_run_id) <> 'true'
--     then raise exception 'Deterministic validation has not passed.'; end if;
--   select count(*) into v_blocking from public.shamo_ingestion_issues
--     where ingestion_run_id = v_run_id and severity = 'blocking' and not resolved;
--   if v_blocking <> 0 then raise exception '% blocking issues remain.', v_blocking; end if;
--
--   update public.shamo_ingestion_runs
--      set verifier_report = verifier_report
--          || jsonb_build_object('passed', true)
--          || jsonb_build_object('review_method', 'agent_assisted_offline_source_review')
--          || jsonb_build_object('approved_by', 'operator')
--          || jsonb_build_object('reviewed_at', now())
--    where id = v_run_id;
-- end;
-- $$;
-- commit;
--
-- Then publish, and afterwards run the embedding webhook:
--   POST /webhook/shamo-publish-paper  {"ingestion_run_id":"460f3b25-6a00-49e2-ac35-c37cfd9c6a1b"}
--   POST /webhook/shamo-generate-embeddings
--
-- Expected publication result: 11 questions, 17 parts, 75 marks, 1 asset.
