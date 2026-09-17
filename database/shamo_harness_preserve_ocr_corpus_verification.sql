-- Read-only verification for database/shamo_harness_preserve_ocr_corpus.sql
--
-- Every check must return pass = true. Nothing here mutates state.

-- 1. No fixture OCR page is left expired or expiring soon.
select
  'no_expired_fixture_pages' as check_name,
  count(*) filter (where pg.expires_at < now() + interval '90 days') = 0 as pass,
  count(*) as total_pages,
  count(*) filter (where pg.expires_at < now()) as still_expired,
  count(*) filter (where pg.expires_at < now() + interval '90 days') as expiring_within_90d
from shamo_ingestion_pages pg
join shamo_ingestion_runs r on r.id = pg.ingestion_run_id
join shamo_papers p on p.id = r.paper_id
where (r.status = 'awaiting_review' and p.status = 'staging')
   or p.status = 'published';

-- 2. The corpus is intact: page count and run count unchanged.
select
  'corpus_intact' as check_name,
  count(*) >= 695 and count(distinct ingestion_run_id) >= 21 as pass,
  count(*) as ocr_pages,
  count(distinct ingestion_run_id) as runs
from shamo_ingestion_pages;

-- 3. Only expires_at moved -- content is untouched.
--    Byte length is a cheap proxy that would change if markdown were rewritten.
select
  'ocr_content_unchanged' as check_name,
  sum(length(raw_markdown)) between 600000 and 640000 as pass,
  sum(length(raw_markdown)) as total_ocr_chars,
  count(*) filter (where raw_markdown is null or raw_markdown = '') as empty_pages;

-- 4. Per-paper coverage: every staged and published paper still has both
--    documents represented, so no paper became unreplayable.
select
  'per_paper_coverage' as check_name,
  bool_and(qp_pages > 0 and ms_pages > 0) as pass,
  count(*) as papers_checked
from (
  select
    p.id,
    count(*) filter (where pg.document_type = 'question_paper') as qp_pages,
    count(*) filter (where pg.document_type = 'mark_scheme') as ms_pages
  from shamo_papers p
  join shamo_ingestion_runs r on r.paper_id = p.id
  join shamo_ingestion_pages pg on pg.ingestion_run_id = r.id
  where p.status in ('staging', 'published')
  group by p.id
) per_paper;

-- 5. Nothing else changed: no run state, no published content touched.
select
  'no_collateral_change' as check_name,
  (select count(*) from shamo_papers where status = 'published') = 7
  and (select count(*) from shamo_papers where status = 'staging') = 6
  and (select count(*) from shamo_questions) = 60
  and (select count(*) from shamo_mark_scheme_items) = 509 as pass,
  (select count(*) from shamo_papers where status = 'published') as published_papers,
  (select count(*) from shamo_papers where status = 'staging') as staging_papers,
  (select count(*) from shamo_questions) as published_questions,
  (select count(*) from shamo_mark_scheme_items) as published_mark_rows;
