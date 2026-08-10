-- Read-only verification for shamo_v2_3_pilot_paper_status_restore.sql.
-- Every row should read PASS. Run after applying the correction.

-- 1. The pilot paper is published again.
select
  '1. pilot paper status' as check,
  case when status = 'published' then 'PASS' else 'FAIL' end as result,
  status as detail
from shamo_papers
where qualification = 'a_level' and syllabus_code = '9709'
  and year = 2025 and exam_session = 'feb_march' and paper_variant = '12'

union all

-- 2. It is visible to the tutor again. This is the check that matters to a
--    student: the catalogue view filters on status = 'published', so 0 rows
--    here means the paper is not offerable however intact its content is.
select
  '2. visible in tutor catalogue',
  case when count(*) = 11 then 'PASS' else 'FAIL' end,
  count(*) || ' of 11 questions visible'
from shamo_published_question_overview
where year = 2025 and exam_session = 'feb_march' and paper_variant = '12'

union all

-- 3. Content is unchanged, not merely present.
select
  '3. published content intact',
  case when q = 11 and p = 20 and m = 96 then 'PASS' else 'FAIL' end,
  q || 'q / ' || p || 'p / ' || m || ' mark rows'
from (
  select
    (select count(*) from shamo_questions where paper_id = paper.id
       and ingestion_run_id = paper.current_ingestion_run_id) as q,
    (select count(*) from shamo_question_parts pt join shamo_questions qq on qq.id = pt.question_id
       where qq.paper_id = paper.id and pt.ingestion_run_id = paper.current_ingestion_run_id) as p,
    (select count(*) from shamo_mark_scheme_items mi join shamo_questions qq on qq.id = mi.question_id
       where qq.paper_id = paper.id and mi.ingestion_run_id = paper.current_ingestion_run_id) as m
  from shamo_papers paper
  where paper.qualification = 'a_level' and paper.syllabus_code = '9709'
    and paper.year = 2025 and paper.exam_session = 'feb_march' and paper.paper_variant = '12'
) counts

union all

-- 4. Provenance still points at the reviewed, published run -- not at the
--    staging run that caused this.
select
  '4. provenance unchanged',
  case when current_ingestion_run_id = '1298c634-b404-4a36-9aa9-3739e88caf08'::uuid
       then 'PASS' else 'FAIL' end,
  coalesce(current_ingestion_run_id::text, 'null')
from shamo_papers
where qualification = 'a_level' and syllabus_code = '9709'
  and year = 2025 and exam_session = 'feb_march' and paper_variant = '12'

union all

-- 5. Search rows survived, so the paper is still retrievable as well as
--    listable.
select
  '5. search rows intact',
  case when count(*) = 29 then 'PASS' else 'FAIL' end,
  count(*) || ' of 29'
from shamo_question_search s
join shamo_questions q on q.id = s.question_id
join shamo_papers p on p.id = q.paper_id
where p.year = 2025 and p.exam_session = 'feb_march' and p.paper_variant = '12'

union all

-- 6. Published-paper count is back to 25.
select
  '6. published paper count',
  case when count(*) = 25 then 'PASS' else 'FAIL' end,
  count(*) || ' published papers'
from shamo_papers where status = 'published'

union all

-- 7. No OTHER published paper was affected. The expansion run only overlapped
--    a published identity in batch 8, but assert it rather than assume it.
select
  '7. no other published paper delisted',
  case when count(*) = 0 then 'PASS' else 'FAIL' end,
  coalesce(string_agg(paper_variant || ' ' || year || ' ' || exam_session, ', '), 'none')
from shamo_papers p
where p.status <> 'published'
  and exists (
    select 1 from shamo_questions q
    where q.paper_id = p.id and q.ingestion_run_id = p.current_ingestion_run_id
  )
  and p.paper_variant not like '%-h'

union all

-- 8. The incident is recorded against the run that caused it.
select
  '8. incident recorded',
  case when count(*) = 1 then 'PASS' else 'FAIL' end,
  count(*) || ' PUBLISHED_PAPER_RESTAGED row(s)'
from shamo_ingestion_issues
where issue_code = 'PUBLISHED_PAPER_RESTAGED'

order by 1;
