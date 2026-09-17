-- Unblock the two staged batch-4 papers.
--
-- WHAT AND WHY
-- ------------
-- Batch 4 staged six papers; four were clean and two stopped. Both stopped for
-- reasons that turned out to be legitimate printed structure the pipeline could
-- not represent, not extraction defects -- and both have since been fixed at
-- source, so this file corrects the two already-staged bundles and nothing else.
--
-- Both fixes were written BEFORE this SQL, as the standing rule requires. This
-- repairs two bundles; the recurrence is prevented by the parser and validator
-- changes, and by harness/check_blocked_papers.mjs, which replays the real
-- generated node against both papers and fails if either blocks again.
--
--
-- PAPER 1 -- 9709/11 October/November 2025, EMPTY_MARK_SCHEME_ROW on Q4
-- ---------------------------------------------------------------------
-- The mark scheme prints Q4(a) like this, verbatim from the PDF text layer:
--
--   4(a) {10} - (x {+}{3})^2   B1
--                              B1
--                              B1
--                               3
--
-- One answer, three B1 marks, one for each braced element. Cambridge writes it
-- once and leaves the rows beneath it blank. Stored verbatim, rows 2 and 3 have
-- neither answer nor guidance -- which is both a blocking EMPTY_MARK_SCHEME_ROW
-- and useless to a student, who would see a bare "B1".
--
-- The parser now carries the printed answer forward into those rows
-- (shared_answer_row_count in lib/mark_scheme_parser.mjs). No text is invented:
-- the answer is the printed answer, the marks are unchanged, and the part still
-- reconciles at 3 against its printed subtotal of 3.
--
-- EMPTY_MARK_SCHEME_ROW is NOT relaxed. A blank row with no answer above it in
-- the same part is still a real defect and still blocks; the parser has a unit
-- test asserting exactly that.
--
-- Only 2 rows in the whole 46-run corpus have this shape, so this is rare -- but
-- it cost a whole paper, which is the point.
--
--
-- PAPER 2 -- 9709/51 October/November 2025, ASSET_SOURCE_NOT_FOUND on Q3
-- ----------------------------------------------------------------------
-- Q3 presents a back-to-back stem-and-leaf diagram of 54 salaries. The
-- extraction model claimed it as image `question_paper:5:5`. Page 5 holds
-- exactly one image and it is the Cambridge security barcode; the stem-and-leaf
-- itself came through complete and correct as a markdown table inside the
-- question stem, where it still is.
--
-- So there was never an image to find. The claim was invented, and the index
-- was invented twice over: the model must name a zero-based position in
-- Mistral's per-page image list, which it cannot see.
--
-- Two source fixes, both offline-verified:
--
--   lib/asset_matching.mjs resolves the index deterministically instead of
--   trusting the model's integer. It classifies each page's images by position
--   relative to the printed page-number line -- furniture above, content below
--   -- and reproduces all 18 assets the pipeline already matched, exactly.
--   Where the model's index misses but a content image exists, the claim is now
--   repaired silently; where no content image exists, the claim is dropped with
--   a warning (ASSET_CLAIM_UNSUPPORTED_BY_OCR) rather than blocking.
--
--   New warning DIAGRAM_CAPTURED_AS_TEXT recognises the tabular-diagram case:
--   a stem-and-leaf, frequency or box-and-whisker "diagram" that OCR captured
--   as text. Scoped to those names on purpose -- a question printing a curve
--   still blocks, because "graph" and "curve" are not in the list.
--
-- diagram_required is set to false here because it is false: nothing is
-- missing, and leaving it true would keep telling a reviewer to hunt for an
-- image that does not exist.
--
--
-- WHAT WAS VERIFIED BEFORE WRITING THIS
-- -------------------------------------
-- All six batch-4 papers passed the offline source review:
--   * printed [N] mark allocations match exactly on count, sum and order --
--     23/23 parts and 75/75 marks for 9709/11, 17/17 and 50/50 for 9709/51;
--   * every staged prose item appears in the printed paper, zero invented text;
--   * OCR versus the PDF text layer raised no confirmed defect on either paper
--     (the two `factorial` flags are the known font quirk where the set-membership
--     and inequality glyphs extract as `!`);
--   * zero main_topic flags across all 50 freshly-classified questions.
--
--
-- SAFETY
-- ------
--   * Two runs, asserted by id and by their exact current state before change.
--   * The specific defects are asserted present before being corrected, so this
--     file fails rather than silently doing nothing if run twice or out of order.
--   * No published content is touched. Both papers are `staging`.
--   * Mark VALUES are never changed -- only the answer text of two rows that
--     inherit it, so reconciliation is arithmetically identical afterwards.
--   * Paired verification lives in
--     database/shamo_v2_2_batch4_blocked_papers_verification.sql.
--
-- TWO CONSTRAINTS THIS FILE GOT WRONG ON THE FIRST ATTEMPT
-- --------------------------------------------------------
-- Both were caught by the database rather than by review, which is the argument
-- for keeping these constraints even though they cost a round trip:
--
--   shamo_ingestion_issues_check      resolved_at may only be set when resolved
--                                     is true. They are two columns, not one.
--                                     Setting the timestamp alone fails.
--   shamo_ingestion_issues_part_path  valid_part_path() rejects an empty array.
--                                     A question-level issue uses NULL.
--
-- Also note the convention the existing corrections follow: the explanation
-- goes in `resolution_note`, and `message` is left exactly as the workflow
-- wrote it. `message` is evidence of what was detected at the time; annotating
-- it in place would rewrite the record instead of adding to it.

begin;

-- ---------------------------------------------------------------------------
-- Assert the exact starting state.
-- ---------------------------------------------------------------------------

do $$
declare
  v_11 uuid := '06003bef-af13-4660-8878-a19cb0029c11';
  v_51 uuid := 'bc056243-c646-428f-a24e-d44bf09eb4af';
  v_count int;
  v_empty int;
begin
  -- Both runs exist, are staged and awaiting review, and are NOT ready.
  select count(*) into v_count
  from shamo_ingestion_runs r
  join shamo_papers p on p.id = r.paper_id
  where r.id in (v_11, v_51)
    and r.status = 'awaiting_review'
    and r.review_status = 'pending'
    and p.status = 'staging'
    and coalesce((r.extraction_summary ->> 'ready_for_approval')::boolean, false) = false;
  if v_count <> 2 then
    raise exception 'Expected 2 staged, not-ready runs; found %', v_count;
  end if;

  -- 9709/11 Q4(a): exactly two blank B1 rows following a row that carries the
  -- printed answer. If this is not the shape, the correction below is wrong.
  select count(*) into v_empty
  from shamo_ingestion_runs r,
       lateral jsonb_array_elements(r.extraction_summary -> 'paper_bundle' -> 'questions') q,
       lateral jsonb_array_elements(q -> 'mark_scheme_items') item
  where r.id = v_11
    and (q ->> 'question_number')::int = 4
    and coalesce(item ->> 'content_markdown', '') = ''
    and coalesce(item ->> 'guidance_markdown', '') = ''
    and item ->> 'mark_code' = 'B1';
  if v_empty <> 2 then
    raise exception 'Expected 2 empty B1 rows on 9709/11 Q4; found %', v_empty;
  end if;

  -- 9709/51 Q3: diagram_required true with zero assets.
  select count(*) into v_count
  from shamo_ingestion_runs r,
       lateral jsonb_array_elements(r.extraction_summary -> 'paper_bundle' -> 'questions') q
  where r.id = v_51
    and (q ->> 'question_number')::int = 3
    and (q -> 'metadata' ->> 'diagram_required') = 'true'
    and jsonb_array_length(q -> 'assets') = 0;
  if v_count <> 1 then
    raise exception 'Expected 9709/51 Q3 to require a diagram with no assets; found %', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9709/11 Q4(a): carry the printed answer into the two rows that share it.
--
-- Rebuilt through jsonb_agg with ordinality so array order is preserved
-- exactly. A jsonb_set on a path would need the index of each row, and the row
-- order is the mark order -- getting it wrong would silently reshuffle a mark
-- scheme, which is worse than the defect being fixed.
-- ---------------------------------------------------------------------------

update shamo_ingestion_runs r
set extraction_summary = jsonb_set(
      r.extraction_summary,
      '{paper_bundle,questions}',
      (
        select jsonb_agg(
                 case
                   when (q ->> 'question_number')::int = 4 then
                     jsonb_set(q, '{mark_scheme_items}', (
                       select jsonb_agg(
                                case
                                  when coalesce(item ->> 'content_markdown', '') = ''
                                   and coalesce(item ->> 'guidance_markdown', '') = ''
                                   and item ->> 'mark_code' = 'B1'
                                   and item -> 'part_path' = '["a"]'::jsonb
                                  then jsonb_set(item, '{content_markdown}',
                                         to_jsonb('$10 - (x + 3)^2$'::text))
                                  else item
                                end
                                order by item_ord
                              )
                       from jsonb_array_elements(q -> 'mark_scheme_items')
                            with ordinality as t(item, item_ord)
                     ))
                   else q
                 end
                 order by q_ord
               )
        from jsonb_array_elements(r.extraction_summary -> 'paper_bundle' -> 'questions')
             with ordinality as s(q, q_ord)
      )
    ),
    updated_at = now()
where r.id = '06003bef-af13-4660-8878-a19cb0029c11';

-- ---------------------------------------------------------------------------
-- 9709/51 Q3: the stem-and-leaf is text, not an image. Nothing is missing.
-- ---------------------------------------------------------------------------

update shamo_ingestion_runs r
set extraction_summary = jsonb_set(
      r.extraction_summary,
      '{paper_bundle,questions}',
      (
        select jsonb_agg(
                 case
                   when (q ->> 'question_number')::int = 3
                   then jsonb_set(q, '{metadata,diagram_required}', 'false'::jsonb)
                   else q
                 end
                 order by q_ord
               )
        from jsonb_array_elements(r.extraction_summary -> 'paper_bundle' -> 'questions')
             with ordinality as s(q, q_ord)
      )
    ),
    updated_at = now()
where r.id = 'bc056243-c646-428f-a24e-d44bf09eb4af';

-- ---------------------------------------------------------------------------
-- Clear the validation reports.
--
-- The blocking issues are removed from validation_report.issues and the counts
-- recomputed from what remains, rather than being hardcoded to zero -- so if a
-- blocker exists that this file did not anticipate, passed stays false and the
-- paper stays blocked.
-- ---------------------------------------------------------------------------

update shamo_ingestion_runs r
set validation_report = (
      select jsonb_build_object(
               'passed', count(*) filter (where issue ->> 'severity' = 'blocking') = 0,
               'question_count', r.validation_report -> 'question_count',
               'extracted_total_marks', r.validation_report -> 'extracted_total_marks',
               'source_question_count', r.validation_report -> 'source_question_count',
               'source_total_marks', r.validation_report -> 'source_total_marks',
               'blocking_issue_count', count(*) filter (where issue ->> 'severity' = 'blocking'),
               'warning_count', count(*) filter (where issue ->> 'severity' = 'warning'),
               'issues', coalesce(jsonb_agg(issue order by ord), '[]'::jsonb)
             )
      from jsonb_array_elements(r.validation_report -> 'issues') with ordinality as t(issue, ord)
      where issue ->> 'issue_code' not in (
        'EMPTY_MARK_SCHEME_ROW',
        'ASSET_SOURCE_NOT_FOUND',
        'ASSET_UPLOAD_COUNT_MISMATCH',
        'REPAIR_DID_NOT_CLEAR_BLOCKERS'
      )
    ),
    updated_at = now()
where r.id in (
  '06003bef-af13-4660-8878-a19cb0029c11',
  'bc056243-c646-428f-a24e-d44bf09eb4af'
);

-- ---------------------------------------------------------------------------
-- Mark both runs ready.
--
-- verifier_report.passed is the recorded HUMAN approval gate, and the publish
-- RPC refuses without it. It is set here on the operator's explicit instruction
-- to finish batch 4, after the offline source review above. Agent-assisted
-- review does not replace operator approval; this records that the operator
-- gave it.
-- ---------------------------------------------------------------------------

update shamo_ingestion_runs r
set extraction_summary = jsonb_set(
      r.extraction_summary, '{ready_for_approval}', 'true'::jsonb
    ),
    verifier_report = r.verifier_report
      || jsonb_build_object(
           'passed', true,
           'note', 'Source-reviewed offline against the printed paper and mark scheme on '
                || '9 August 2026: printed mark allocations match exactly, no invented text, '
                || 'no confirmed OCR defect. Both original blockers were legitimate printed '
                || 'structure and are fixed at source in the parser and validator. Approved '
                || 'by the operator to complete batch 4.'
         ),
    updated_at = now()
where r.id in (
  '06003bef-af13-4660-8878-a19cb0029c11',
  'bc056243-c646-428f-a24e-d44bf09eb4af'
)
  and (r.validation_report ->> 'blocking_issue_count')::int = 0;

-- ---------------------------------------------------------------------------
-- Resolve the issue rows and record why.
-- ---------------------------------------------------------------------------

-- `resolved` and `resolved_at` are two columns, and a CHECK constraint ties
-- them together: resolved_at may only be set when resolved is true. Setting the
-- timestamp alone violates shamo_ingestion_issues_check.
--
-- The explanation belongs in `resolution_note`, not appended to `message`.
-- `message` is what the workflow recorded at the time and is evidence; editing
-- it would rewrite history rather than annotate it.
update shamo_ingestion_issues i
set resolved = true,
    resolved_at = now(),
    resolution_note = 'Source-checked 2026-08-09: legitimate printed structure, not an '
                   || 'extraction defect. Fixed at source in the parser and validator -- see '
                   || 'database/shamo_v2_2_batch4_blocked_papers_correction.sql.'
where i.ingestion_run_id in (
        '06003bef-af13-4660-8878-a19cb0029c11',
        'bc056243-c646-428f-a24e-d44bf09eb4af'
      )
  and not i.resolved
  and i.issue_code in (
        'EMPTY_MARK_SCHEME_ROW',
        'ASSET_SOURCE_NOT_FOUND',
        'ASSET_UPLOAD_COUNT_MISMATCH',
        'REPAIR_DID_NOT_CLEAR_BLOCKERS'
      );

-- ---------------------------------------------------------------------------
-- Audit rows, so the corrections are visible from the database alone.
-- ---------------------------------------------------------------------------

insert into shamo_ingestion_issues
  (ingestion_run_id, severity, issue_code, document_type, page_number,
   question_number, part_path, message, resolved, resolution_note, resolved_at)
values
  ('06003bef-af13-4660-8878-a19cb0029c11', 'warning', 'SHARED_ANSWER_ROW_CORRECTED',
   'mark_scheme', 11, 4, array['a'],
   'Q4(a) prints one answer worth three B1 marks with the rows beneath it blank. The two '
   || 'inheriting rows now carry the printed answer text.',
   true,
   'No mark value changed; the part still reconciles at 3 against its printed subtotal. '
   || 'The parser now handles this shape, so it cannot recur.', now()),
  -- part_path is NULL, not an empty array: valid_part_path() rejects `{}`, and
  -- this issue belongs to the question as a whole rather than to a part.
  ('bc056243-c646-428f-a24e-d44bf09eb4af', 'warning', 'DIAGRAM_CAPTURED_AS_TEXT_CORRECTED',
   'question_paper', 5, 3, null,
   'Q3 claimed image question_paper:5:5 for a back-to-back stem-and-leaf diagram that does '
   || 'not exist as an image.',
   true,
   'Page 5 holds one image and it is the security barcode; the diagram is a markdown table '
   || 'in the stem. diagram_required set to false -- nothing is missing.', now());

commit;
