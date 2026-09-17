-- Preserve the OCR corpus that the accuracy harness measures against.
--
-- CONTEXT
-- -------
-- shamo_ingestion_pages stores the raw Mistral OCR markdown for every ingested
-- paper. The rows are treated as temporary and carry an expires_at; a cleanup
-- operation reclaims them. On 2026-08-07 a read-only audit found 494 of 695
-- rows already past expires_at, surviving only because the cleanup had not run.
--
-- That markdown is the input side of every accuracy measurement: it is what
-- lets the deterministic mark-scheme parser and the validator rules be tested
-- offline, against real papers, at zero API cost. Losing it would mean paying
-- for OCR and extraction again to test any pipeline change.
--
-- This script extends expires_at for the runs the harness uses as fixtures.
-- It is a convenience, NOT a backup -- the durable copy is the git snapshot
-- written by workflows/n8n/harness/snapshot_fixtures.mjs. Run that too.
--
-- SAFETY
-- ------
-- Touches exactly one column on one temporary table. No academic content, no
-- published rows, no run state, no workflow, no publication. Asserts the
-- expected row count before committing and raises if the corpus has already
-- shrunk -- a smaller count than expected means cleanup ran and the transaction
-- should abort loudly rather than silently protect a remnant.
--
-- Paired verification: database/shamo_harness_preserve_ocr_corpus_verification.sql

begin;

-- Lock the target rows so a concurrent cleanup cannot delete them mid-flight.
create temporary table harness_target_pages on commit drop as
select pg.id, pg.ingestion_run_id, pg.expires_at
from shamo_ingestion_pages pg
join shamo_ingestion_runs r on r.id = pg.ingestion_run_id
join shamo_papers p on p.id = r.paper_id
where
  -- Batch-2 staged runs: the papers currently under review.
  (r.status = 'awaiting_review' and p.status = 'staging')
  -- Published papers: their OCR is the ground-truth input for regression tests.
  or p.status = 'published'
for update of pg;

do $$
declare
  target_count integer;
  run_count integer;
begin
  select count(*), count(distinct ingestion_run_id)
    into target_count, run_count
  from harness_target_pages;

  raise notice 'Harness fixture corpus: % pages across % ingestion runs', target_count, run_count;

  -- Observed on 2026-08-07: 695 pages across 21 runs. That is more than the
  -- 429 pages belonging to the 13 current runs, because a published paper
  -- keeps its superseded v1/diagnostic runs and each stored its own OCR. Those
  -- extra runs are worth preserving too -- they are free additional samples of
  -- the same papers under a different pipeline version, which is exactly what
  -- a regression corpus wants.
  --
  -- Allow growth (a new batch stages more pages) but abort on shrinkage, which
  -- would mean the cleanup already destroyed part of the corpus.
  if target_count < 695 then
    raise exception
      'Expected at least 695 fixture OCR pages, found %. The cleanup may have already run; investigate before extending expires_at.',
      target_count;
  end if;
end $$;

update shamo_ingestion_pages pg
set expires_at = greatest(pg.expires_at, now() + interval '180 days')
from harness_target_pages t
where pg.id = t.id;

commit;
