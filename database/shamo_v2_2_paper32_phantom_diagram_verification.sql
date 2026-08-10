-- Read-only verification for shamo_v2_2_paper32_phantom_diagram_correction.sql.
--
-- Checks 1-5 cover what the agent applied. Check 6 is the operator gate and is
-- EXPECTED TO FAIL until the operator approves the paper; it is included so the
-- open gate stays visible rather than being quietly forgotten.

-- 1. No unresolved blocking issues remain, and all three carry a source note.
select
    'blocking issues resolved with notes' as check_name,
    count(*) filter (where not resolved) = 0
      and count(*) filter (where resolved and resolution_note is not null) = 3 as ok,
    count(*) filter (where not resolved) as unresolved,
    count(*) as total_blocking
from public.shamo_ingestion_issues
where ingestion_run_id = '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b' and severity = 'blocking';

-- 2. Deterministic validation now passes with zero blockers.
select
    'validation passes with zero blockers' as check_name,
    validation_report->>'passed' = 'true'
      and (validation_report->>'blocking_issue_count')::int = 0 as ok,
    validation_report->>'passed' as passed,
    validation_report->>'blocking_issue_count' as blocking_count
from public.shamo_ingestion_runs
where id = '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b';

-- 3. Q5 no longer claims a diagram it never had, and the new warning explains why.
select
    'Q5 diagram flag corrected and explained' as check_name,
    (select q->'metadata'->>'diagram_required'
     from public.shamo_ingestion_runs r,
          jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q
     where r.id = '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b' and q->>'question_number' = '5') = 'false'
    and exists (
      select 1 from public.shamo_ingestion_runs r,
             jsonb_array_elements(r.validation_report->'issues') i
      where r.id = '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b'
        and i->>'issue_code' = 'DIAGRAM_REQUIRED_BUT_CANDIDATE_DRAWS_IT') as ok;

-- 4. Academic content is untouched: 11 questions, 17 parts, 75 marks, 1 asset.
--
-- Note on the two mark figures, which are both correct and must not be confused.
-- The bundle's PART marks sum to 59, not 75, because an unparted question
-- carries its marks at question level and has no part row at all. The paper
-- total is the sum of question totals, 75, which is what the printed [N]
-- allocations reconcile against. Comparing the printed 75 with the part sum
-- would look like a 16-mark shortfall that does not exist.
select
    'bundle content unchanged' as check_name,
    q_count = 11 and part_count = 17 and question_marks = 75 and part_marks = 59 and asset_count = 1 as ok,
    q_count, part_count, question_marks, part_marks, asset_count
from (
    select
        jsonb_array_length(extraction_summary->'paper_bundle'->'questions') as q_count,
        (select count(*) from jsonb_array_elements(extraction_summary->'paper_bundle'->'questions') q,
                jsonb_array_elements(q->'parts') p) as part_count,
        (select coalesce(sum((p->>'marks')::int), 0)
         from jsonb_array_elements(extraction_summary->'paper_bundle'->'questions') q,
              jsonb_array_elements(q->'parts') p where p->>'marks' is not null) as part_marks,
        (select coalesce(sum((q->>'total_marks')::int), 0)
         from jsonb_array_elements(extraction_summary->'paper_bundle'->'questions') q
         where q->>'total_marks' is not null) as question_marks,
        (select count(*) from jsonb_array_elements(extraction_summary->'paper_bundle'->'questions') q,
                jsonb_array_elements(coalesce(q->'assets','[]'::jsonb)) a) as asset_count
    from public.shamo_ingestion_runs where id = '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b'
) as t;

-- 5. Nothing already published moved. This correction touches a staged run only.
select
    'published corpus unchanged' as check_name,
    (select count(*) from public.shamo_questions) = 149
      and (select count(*) from public.shamo_mark_scheme_items) = 1296
      and (select count(*) from public.shamo_papers where status = 'published') = 18 as ok,
    (select count(*) from public.shamo_papers where status = 'published') as published_papers;

-- 6. OPERATOR GATE -- expected false until the operator approves. See the
--    correction file's OPERATOR STEP section.
select
    'operator approval recorded (expected false until approved)' as check_name,
    verifier_report->>'passed' = 'true' as ok,
    verifier_report->>'passed' as verifier_passed,
    verifier_report->>'review_method' as review_method
from public.shamo_ingestion_runs
where id = '460f3b25-6a00-49e2-ac35-c37cfd9c6a1b';
