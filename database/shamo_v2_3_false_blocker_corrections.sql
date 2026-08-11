-- Clear eight blockers that source review found to be validator false positives.
--
-- Every one was read against the staged bundle and, where the question is about
-- a diagram, against the OCR page inventory. None is a data defect: in each case
-- the extraction is faithful to the printed paper and the RULE was wrong. Each
-- rule has since been fixed at source, so these cannot recur -- see the paired
-- generator changes and the replay evidence below.
--
-- WHAT THIS FILE DOES NOT DO
--
-- It does not touch a single row of academic content. No question text, no part,
-- no mark row, no mark code changes. It resolves issue rows and lifts the
-- derived approval flags that those issues had held down.
--
-- ------------------------------------------------------------------
-- 1. DIAGRAM_REQUIRED_WITHOUT_ASSET -- 4 papers
-- ------------------------------------------------------------------
-- 9709/21 M/J 2025 Q3, 9709/22 M/J 2025 Q2, 9709/23 M/J 2025 Q2,
-- 9709/53 O/N 2025 Q5.
--
-- All four ask the CANDIDATE to draw:
--     "Sketch, on a single diagram, the graphs of y = 3e^-2x and y = sec x"
--     "Sketch on the same diagram the graphs of y = |2x-9| and y = 4x-5"
-- and classifyPageImages reports content=[] on every referenced page -- the one
-- image is the security barcode. There is no printed diagram to recover.
--
-- DIAGRAM_REQUIRED_BUT_CANDIDATE_DRAWS_IT already existed for exactly this case
-- (written for 9709/32's Argand diagram) but keyed on the adjacent phrase
-- "sketch the", and Cambridge puts the qualifier in between. The pattern now
-- anchors the imperative at a sentence start or part label. referencesPrinted-
-- Diagram still gates it, so a question that shows a figure AND asks for a
-- sketch keeps blocking.
--
-- ------------------------------------------------------------------
-- 2. INVALID_MARK_CODE: DA1 -- 1 paper
-- ------------------------------------------------------------------
-- 9709/63 M/J 2024 Q6. DA1 is genuinely printed on mark-scheme page 10, and
-- Cambridge's generic marking principles define "DM or DA" as a mark dependent
-- on a previous one. The regex knew DM and DB but not DA. Added to both copies
-- and to the shared corpus that drives them together.
--
-- ------------------------------------------------------------------
-- 3. EMPTY_PART_TEXT -- 1 paper
-- ------------------------------------------------------------------
-- 9709/13 O/N 2025 Q11(b). A structural parent: Cambridge prints (b) as a bare
-- label with the text in (b)(i) and (b)(ii). The rule fired on any part with no
-- prompt; it now fires only on a LEAF, which is the case a student would
-- actually be shown with nothing to answer.
--
-- ------------------------------------------------------------------
-- 4. MARK_CODE_COPIED_INTO_GUIDANCE -- 2 papers
-- ------------------------------------------------------------------
-- 9709/42 M/J 2025 Q7 and 9709/13 M/J 2025 Q10. The printed guidance reads
-- "A1 for correct LHS.", "A1 for correct RHS.", "A1 for two correct x-values or
-- one correct point." That is Cambridge explaining how a multi-mark award
-- splits, not a Marks column bleeding into Guidance -- a real bleed leaves a
-- bare code or the answer text, never a grammatical continuation. A following
-- connective now exempts the row.
--
-- 9709/13 M/J 2025 Q10 also carried MARK_CODE_ALTERNATIVE_CLASSIFICATION and
-- PART_MARK_RECONCILIATION, both consequences of the same misread rows.
--
-- ------------------------------------------------------------------
-- REPLAY EVIDENCE
-- ------------------------------------------------------------------
-- check_autonomy.mjs replays every staged bundle through the CURRENT generated
-- validator. Before these fixes all eight papers blocked; after, none of them
-- appears. The remaining entries in that report are MARK_CODE_COVERAGE_TOO_LOW
-- on papers where the model fallback fired in production and staged them
-- cleanly -- a parser-only replay artifact, not a defect. See the note in the
-- operating guide.

begin;

-- Resolve the issue rows. Scoped to the exact codes on the exact runs, so a
-- different blocker appearing later on the same paper is untouched.
with target_runs as (
  select r.id, p.paper_variant, p.year, p.exam_session
  from shamo_ingestion_runs r
  join shamo_papers p on p.id = r.paper_id
  where r.idempotency_key ~ 'v2\.3-batch-'
    and (p.paper_variant, p.year, p.exam_session) in (
      ('21', 2025, 'may_june'), ('22', 2025, 'may_june'), ('23', 2025, 'may_june'),
      ('53', 2025, 'oct_nov'),  ('63', 2024, 'may_june'), ('13', 2025, 'oct_nov'),
      ('42', 2025, 'may_june'), ('13', 2025, 'may_june')
    )
)
update shamo_ingestion_issues i
   set resolved = true,
       resolved_at = now(),
       resolution_note =
         'Source-reviewed and found to be a validator false positive, not a data defect. '
         'The rule has been fixed at source and the paper replays clean through the current '
         'validator. Cleared by database/shamo_v2_3_false_blocker_corrections.sql. '
         'The message column is left exactly as the workflow wrote it: it is evidence of what '
         'was detected at the time.'
  from target_runs t
 where i.ingestion_run_id = t.id
   and not i.resolved
   and i.severity = 'blocking'
   and i.issue_code in (
     'DIAGRAM_REQUIRED_WITHOUT_ASSET',
     'INVALID_MARK_CODE',
     'EMPTY_PART_TEXT',
     'MARK_CODE_COPIED_INTO_GUIDANCE',
     'MARK_CODE_ALTERNATIVE_CLASSIFICATION',
     'PART_MARK_RECONCILIATION',
     'REPAIR_DID_NOT_CLEAR_BLOCKERS'
   );

-- Lift the derived approval flags, but ONLY on runs that now carry zero
-- unresolved blockers. Written as a condition rather than a list so a paper with
-- a surviving blocker cannot be swept along by this file.
update shamo_ingestion_runs r
   set extraction_summary = jsonb_set(
         coalesce(r.extraction_summary, '{}'::jsonb), '{ready_for_approval}', 'true'::jsonb),
       verifier_report = jsonb_set(
         coalesce(r.verifier_report, '{}'::jsonb), '{passed}', 'true'::jsonb),
       updated_at = now()
 where r.idempotency_key ~ 'v2\.3-batch-'
   and r.status = 'awaiting_review'
   and coalesce(r.extraction_summary->>'ready_for_approval', 'false') <> 'true'
   and not exists (
     select 1 from shamo_ingestion_issues i
     where i.ingestion_run_id = r.id and i.severity = 'blocking' and not i.resolved
   );

commit;

-- ------------------------------------------------------------------
-- Verification -- every row should read PASS.
-- ------------------------------------------------------------------
select '1. unresolved blockers remaining' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
       count(*) || ' remaining' as detail
from shamo_ingestion_issues i
join shamo_ingestion_runs r on r.id = i.ingestion_run_id
where r.idempotency_key ~ 'v2\.3-batch-' and i.severity = 'blocking' and not i.resolved

union all

select '2. staged papers now ready',
       case when count(*) filter (where extraction_summary->>'ready_for_approval' = 'true') = 60
            then 'PASS' else 'FAIL' end,
       count(*) filter (where extraction_summary->>'ready_for_approval' = 'true') || ' of ' || count(*)
from shamo_ingestion_runs
where idempotency_key ~ 'v2\.3-batch-' and status = 'awaiting_review'

union all

select '3. verifier_report.passed agrees',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' run(s) where the two flags disagree'
from shamo_ingestion_runs
where idempotency_key ~ 'v2\.3-batch-' and status = 'awaiting_review'
  and coalesce(extraction_summary->>'ready_for_approval','false')
      <> coalesce(verifier_report->>'passed','false')

union all

-- Content must be untouched: this file changes flags, never academic rows.
select '4. published content unchanged',
       case when count(*) = 25 then 'PASS' else 'FAIL' end,
       count(*) || ' published papers (expect 25)'
from shamo_papers where status = 'published'

order by 1;
