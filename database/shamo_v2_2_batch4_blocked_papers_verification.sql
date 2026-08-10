-- Read-only verification for shamo_v2_2_batch4_blocked_papers_correction.sql.
--
-- Run after the correction. Every check returns PASS or FAIL in its own row, so
-- a partial application is visible rather than having to be inferred.

-- 1. Both runs are now ready, with zero blocking issues and a verifier pass.
select 'both runs ready' as check_name,
       case when count(*) = 2 then 'PASS' else 'FAIL' end as result,
       count(*) as runs_ready
from shamo_ingestion_runs r
where r.id in ('06003bef-af13-4660-8878-a19cb0029c11','bc056243-c646-428f-a24e-d44bf09eb4af')
  and (r.validation_report ->> 'passed')::boolean
  and (r.validation_report ->> 'blocking_issue_count')::int = 0
  and (r.extraction_summary ->> 'ready_for_approval')::boolean
  and (r.verifier_report ->> 'passed')::boolean;

-- 2. 9709/11 Q4(a) now has three B1 rows, all carrying the printed answer, and
--    still totals exactly 3 marks. The mark VALUES must be untouched -- if this
--    reports anything but 3, the correction changed the marking, not the text.
select '9709/11 Q4(a) answers carried, marks unchanged' as check_name,
       case when count(*) = 3 and count(distinct item ->> 'content_markdown') = 1
                 and bool_and(coalesce(item ->> 'content_markdown','') <> '')
            then 'PASS' else 'FAIL' end as result,
       count(*) as rows_found,
       count(distinct item ->> 'content_markdown') as distinct_answers
from shamo_ingestion_runs r,
     lateral jsonb_array_elements(r.extraction_summary -> 'paper_bundle' -> 'questions') q,
     lateral jsonb_array_elements(q -> 'mark_scheme_items') item
where r.id = '06003bef-af13-4660-8878-a19cb0029c11'
  and (q ->> 'question_number')::int = 4
  and item -> 'part_path' = '["a"]'::jsonb;

-- 3. No mark row anywhere in either paper is empty of both answer and guidance.
--    This is the condition EMPTY_MARK_SCHEME_ROW exists to catch; it must be
--    satisfied by content, not by the rule having been switched off.
select 'no empty mark rows remain' as check_name,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
       count(*) as empty_rows
from shamo_ingestion_runs r,
     lateral jsonb_array_elements(r.extraction_summary -> 'paper_bundle' -> 'questions') q,
     lateral jsonb_array_elements(q -> 'mark_scheme_items') item
where r.id in ('06003bef-af13-4660-8878-a19cb0029c11','bc056243-c646-428f-a24e-d44bf09eb4af')
  and coalesce(item ->> 'content_markdown','') = ''
  and coalesce(item ->> 'guidance_markdown','') = '';

-- 4. 9709/51 Q3 no longer requires a diagram, and Q4's real tree diagram is
--    still there with its Storage path. The second half matters: the fix must
--    not have swept away a genuine asset along with the phantom.
select '9709/51 Q3 not diagram-required, Q4 asset intact' as check_name,
       case when count(*) filter (where (q ->> 'question_number')::int = 3
                                    and (q -> 'metadata' ->> 'diagram_required') = 'false') = 1
             and count(*) filter (where (q ->> 'question_number')::int = 4
                                    and jsonb_array_length(q -> 'assets') = 1
                                    and (q -> 'assets' -> 0 ->> 'storage_path') is not null) = 1
            then 'PASS' else 'FAIL' end as result
from shamo_ingestion_runs r,
     lateral jsonb_array_elements(r.extraction_summary -> 'paper_bundle' -> 'questions') q
where r.id = 'bc056243-c646-428f-a24e-d44bf09eb4af'
  and (q ->> 'question_number')::int in (3, 4);

-- 5. The four blocking issue codes are resolved on both runs, and the two audit
--    rows exist.
select 'issues resolved and audited' as check_name,
       case when count(*) filter (where not resolved) = 0
             and count(*) filter (where resolved and resolved_at is null) = 0
             and count(*) filter (where issue_code like '%_CORRECTED') = 2
            then 'PASS' else 'FAIL' end as result,
       count(*) filter (where not resolved) as still_unresolved,
       count(*) filter (where issue_code like '%_CORRECTED') as audit_rows
from shamo_ingestion_issues
where ingestion_run_id in ('06003bef-af13-4660-8878-a19cb0029c11','bc056243-c646-428f-a24e-d44bf09eb4af')
  and (issue_code in ('EMPTY_MARK_SCHEME_ROW','ASSET_SOURCE_NOT_FOUND',
                      'ASSET_UPLOAD_COUNT_MISMATCH','REPAIR_DID_NOT_CLEAR_BLOCKERS')
       or issue_code like '%_CORRECTED');

-- 6. All six batch-4 papers are now ready. This is the batch-level gate: four
--    were already clean, two were corrected here.
select 'all six batch-4 papers ready' as check_name,
       case when count(*) = 6 then 'PASS' else 'FAIL' end as result,
       count(*) as ready_papers
from shamo_ingestion_runs r
where r.idempotency_key like '%v2.2-batch-04%'
  and (r.extraction_summary ->> 'ready_for_approval')::boolean;

-- 7. Nothing published was touched. Both papers must still be staging, and the
--    published corpus must still read 19 papers / 160 questions / 1389 mark rows.
select 'published content untouched' as check_name,
       case when (select count(*) from shamo_papers where status = 'published') = 19
             and (select count(*) from shamo_questions) = 160
             and (select count(*) from shamo_mark_scheme_items) = 1389
             and (select count(*) from shamo_papers p
                  join shamo_ingestion_runs r on r.paper_id = p.id
                  where r.id in ('06003bef-af13-4660-8878-a19cb0029c11',
                                 'bc056243-c646-428f-a24e-d44bf09eb4af')
                    and p.status = 'staging') = 2
            then 'PASS' else 'FAIL' end as result,
       (select count(*) from shamo_papers where status = 'published') as published_papers,
       (select count(*) from shamo_questions) as published_questions,
       (select count(*) from shamo_mark_scheme_items) as published_mark_rows;
