-- Restore four Poisson factorial denominators that OCR dropped.
--
-- 9709/61 and 9709/63 October/November 2024 store two Poisson series each with
-- the factorial lost from the cubic term: `\frac{1.95^3}{3}` for a printed
-- `1.95^3/3!`, and the same on `6.6^3`. Four mark rows, six occurrences.
--
-- WHY THIS IS A REAL DEFECT AND NOT A NOTATION PREFERENCE
--
-- The value changes. 1.95^3/3 = 2.4716 where 1.95^3/3! = 1.2358, and the
-- 6.6 series moves a stated answer from 0.105 to 0.170. A student shown the
-- stored expression and working it through reaches the wrong number.
--
-- CONFIRMED THREE INDEPENDENT WAYS
--
-- 1. The PDF text layer, which is authoritative here. pypdf reads a stacked
--    fraction denominator-first, so the printed cells extract as:
--        `21.95 2`   -> 1.95^2 / 2    (no factorial printed)
--        `31.95 3!`  -> 1.95^3 / 3!   (factorial printed)
--        `26.6 2`    -> 6.6^2 / 2     (no factorial printed)
--        `36.6 3!`   -> 6.6^3 / 3!    (factorial printed)
--    Cached at workflows/n8n/harness/fixtures/pdf_text/9709_2024_oct_nov_{61,63}.json,
--    mark-scheme pages 10 and 11.
--
-- 2. Arithmetic against decimals printed in the SAME cell. Q6 prints the
--    expansion `1 + 1.95 + 1.90125 + 1.2358`; the fourth term is 1.95^3/6,
--    not 1.95^3/3. Q7 prints `0.0400 + e^-6.6 x 6.6^3/3! = 0.105`; with 3! the
--    left side evaluates to 0.1050, with 3 it evaluates to 0.1700.
--
-- 3. Mathematics. A Poisson cumulative probability is
--    e^-lambda * sum(lambda^k / k!), so the k=3 term has a 3! denominator.
--
-- WHY THE `2` DENOMINATORS ARE LEFT ALONE
--
-- Cambridge itself prints `1.95^2/2` rather than `1.95^2/2!` -- confirmed in
-- the PDF extraction above. What is stored is faithful to the printed page, so
-- changing it would introduce an infidelity rather than remove one. 2! = 2, so
-- nothing is numerically at stake either way.
--
-- WHY NOTHING CAUGHT THIS
--
-- Both papers staged completely clean. No mark value changes, so every part
-- still reconciles against its printed subtotal; prose-fidelity checking
-- compares words and cannot judge mathematics; and the deterministic validator
-- has no view of formula semantics. harness/check_lost_factorials.mjs now
-- covers the class and is wired into check.mjs.
--
-- SCOPE
--
-- Content correction, staged bundles only. Neither paper is published, so no
-- published row exists to change; a corpus scan of shamo_mark_scheme_items
-- found no occurrence of this pattern in the 25 published papers. Mark codes,
-- mark values, part structure, guidance and every other field are untouched.
--
-- The OCR rows in shamo_ingestion_pages are deliberately NOT rewritten. They
-- are the historical record of what the provider actually returned, and that
-- record is evidence.

begin;

-- Lock the two runs and assert the exact starting state, so this file fails
-- rather than half-applies if the bundles have moved.
create temporary table _fx_targets on commit drop as
select r.id as run_id,
       p.paper_variant,
       -- Verified positions: Q6 is questions[5], its M1 row is item[3];
       -- Q7 is questions[6], its B1 row is item[2].
       '{paper_bundle,questions,5,mark_scheme_items,3,content_markdown}'::text[] as q6_path,
       '{paper_bundle,questions,6,mark_scheme_items,2,content_markdown}'::text[] as q7_path
from shamo_ingestion_runs r
join shamo_papers p on p.id = r.paper_id
where r.idempotency_key ~ 'v2\.3-batch-'
  and r.status = 'awaiting_review'
  and p.year = 2024
  and p.exam_session = 'oct_nov'
  and p.paper_variant in ('61', '63')
for update of r;

do $$
declare
  n_runs int;
  n_hits int;
begin
  select count(*) into n_runs from _fx_targets;
  if n_runs <> 2 then
    raise exception 'Expected exactly 2 target runs (9709/61 and 9709/63 O/N 2024), found %', n_runs;
  end if;

  -- The addressed cells must be the ones carrying the defect, and they must
  -- carry exactly the six occurrences found during review: 1 in Q6, 2 in Q7,
  -- per paper. Addressing a cell by index is only safe if its content is
  -- asserted, so assert it.
  select sum(cnt) into n_hits
  from (
    select (length(es.value) - length(replace(es.value, '^3}{3}', ''))) / 6 as cnt
    from _fx_targets t
    join shamo_ingestion_runs r on r.id = t.run_id
    cross join lateral (
      select r.extraction_summary #>> t.q6_path as value
      union all
      select r.extraction_summary #>> t.q7_path
    ) es
  ) s;

  if n_hits <> 6 then
    raise exception 'Expected 6 lost-factorial occurrences in the 4 addressed cells, found %', n_hits;
  end if;

  -- Guard against addressing the wrong row: each cell must be a Poisson series.
  if exists (
    select 1
    from _fx_targets t
    join shamo_ingestion_runs r on r.id = t.run_id
    cross join lateral (
      select r.extraction_summary #>> t.q6_path as value
      union all
      select r.extraction_summary #>> t.q7_path
    ) es
    where es.value not like '%e^{-%'
  ) then
    raise exception 'An addressed cell is not a Poisson series (no e^{-lambda} factor); indices are wrong';
  end if;
end $$;

-- Apply. Chained jsonb_set, one call per addressed cell. The replacement is the
-- exact substring `^3}{3}` -> `^3}{3!}`, which cannot match an antiderivative
-- such as `\frac{x^3}{3}` written with a symbolic base, and in any case is
-- confined to the four cells asserted above.
update shamo_ingestion_runs r
   set extraction_summary = jsonb_set(
         jsonb_set(
           r.extraction_summary,
           t.q6_path,
           to_jsonb(replace(r.extraction_summary #>> t.q6_path, '^3}{3}', '^3}{3!}'))
         ),
         t.q7_path,
         to_jsonb(replace(r.extraction_summary #>> t.q7_path, '^3}{3}', '^3}{3!}'))
       ),
       updated_at = now()
  from _fx_targets t
 where r.id = t.run_id;

-- Audit trail, one resolved row per paper. Question-level, so part_path is NULL
-- -- valid_part_path() rejects an empty array. `resolved` and `resolved_at` are
-- set together because a CHECK constraint ties them.
insert into shamo_ingestion_issues
  (ingestion_run_id, question_number, part_path, severity, issue_code, message,
   resolved, resolved_at, resolution_note)
select t.run_id,
       null::int,
       -- Cast required: part_path is text[] and an untyped NULL in a SELECT list
       -- is text, which Postgres will not coerce. NULL rather than '{}' because
       -- valid_part_path() rejects an empty array.
       null::text[],
       'warning',
       'OCR_LOST_FACTORIAL_CORRECTED',
       'Two Poisson series stored the cubic term with the factorial dropped from the '
       'denominator (1.95^3/3 and 6.6^3/3 for a printed 1.95^3/3! and 6.6^3/3!), across '
       'Q6 and Q7. Six occurrences in four mark rows.',
       true,
       now(),
       'Corrected against the PDF text layer, which prints 3! in both cells, and '
       'independently confirmed by decimals printed in the same cells (1.2358 = 1.95^3/3! '
       'and 0.105 = 0.0400 + e^-6.6 * 6.6^3/3!). Denominators printed as 2 rather than 2! '
       'were left as printed. No mark code, mark value or part structure changed. Applied by '
       'database/shamo_v2_3_lost_factorial_corrections.sql.'
from _fx_targets t;

-- Post-assert inside the transaction, so a bad result rolls back rather than
-- needing to be noticed in the verification output afterwards.
do $$
declare
  remaining int;
  restored  int;
begin
  -- Series context is REQUIRED here. The bare pattern `^3}{3}` also matches an
  -- antiderivative -- integrating 2x^2 gives 2x^3/3 -- and 10 such rows exist
  -- legitimately elsewhere in this staged batch, one of them with a numeric base
  -- (`4.5^3/3`, evaluating an antiderivative at x = 4.5). Counting the bare
  -- pattern corpus-wide would fail this assertion on correct mathematics.
  select count(*) into remaining
  from shamo_ingestion_runs r,
       jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
       jsonb_array_elements(q->'mark_scheme_items') m
  where r.idempotency_key ~ 'v2\.3-batch-'
    and m->>'content_markdown' like '%^3}{3}%'
    and m->>'content_markdown' like '%e^{-%';

  if remaining <> 0 then
    raise exception 'Lost-factorial pattern still present in % staged Poisson mark row(s)', remaining;
  end if;

  -- Joined to _fx_targets, so scoped to the two papers. Unscoped this would
  -- count the 12 rows elsewhere in the batch that were already correct.
  select count(*) into restored
  from shamo_ingestion_runs r
  join _fx_targets t on t.run_id = r.id,
       jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
       jsonb_array_elements(q->'mark_scheme_items') m
  where m->>'content_markdown' like '%^3}{3!}%';

  if restored <> 4 then
    raise exception 'Expected 4 corrected mark rows, found %', restored;
  end if;
end $$;

commit;

-- ------------------------------------------------------------------
-- Verification -- every row should read PASS.
-- ------------------------------------------------------------------
-- Scoped to Poisson series. The bare `^3}{3}` shape is also a correct
-- antiderivative and occurs legitimately in 10 other staged rows.
select '1. lost factorials remaining' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
       count(*) || ' staged Poisson row(s) still matching ^3}{3}' as detail
from shamo_ingestion_runs r,
     jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
     jsonb_array_elements(q->'mark_scheme_items') m
where r.idempotency_key ~ 'v2\.3-batch-'
  and m->>'content_markdown' like '%^3}{3}%'
  and m->>'content_markdown' like '%e^{-%'

union all

-- MUST be scoped to the two papers. Corpus-wide this reads 16, because 12
-- Poisson series across 8 other staged papers ALREADY store 3! correctly --
-- 9709/61 M/J 2025, 9709/62 O/N 2024, 9709/63 M/J 2024 and others. That is the
-- strongest evidence available that the corruption was isolated rather than a
-- systematic failure to read the factorial glyph, and it is also why the
-- earlier unscoped version of this assertion failed on correct data.
select '2. corrected rows carry 3!',
       case when count(*) = 4 then 'PASS' else 'FAIL' end,
       count(*) || ' mark row(s) in the two papers now printing 3! (expect 4)'
from shamo_ingestion_runs r
join shamo_papers p on p.id = r.paper_id,
     jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
     jsonb_array_elements(q->'mark_scheme_items') m
where r.idempotency_key ~ 'v2\.3-batch-'
  and p.year = 2024 and p.exam_session = 'oct_nov' and p.paper_variant in ('61','63')
  and m->>'content_markdown' like '%^3}{3!}%'

union all

-- The printed `2` denominators must survive untouched: they are faithful to the
-- page, which prints 1.95^2/2 rather than 1.95^2/2!.
-- 8, not 4: the four corrected rows each carry a /2 term, and four further
-- Poisson rows in the same two papers carry one too (the separate P(X <= 2)
-- rows). None of them may change.
select '3. squared terms left as printed',
       case when count(*) = 8 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) in the two papers retaining a /2 denominator (expect 8)'
from shamo_ingestion_runs r
join shamo_papers p on p.id = r.paper_id,
     jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
     jsonb_array_elements(q->'mark_scheme_items') m
where r.idempotency_key ~ 'v2\.3-batch-'
  and p.year = 2024 and p.exam_session = 'oct_nov' and p.paper_variant in ('61','63')
  and m->>'content_markdown' like '%^2}{2}%'
  and m->>'content_markdown' like '%e^{-%'

union all

-- Marks must be unchanged. Both papers print 50.
select '4. mark totals unchanged',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       string_agg(paper_variant || '=' || total, ', ' order by paper_variant)
from (
  select p.paper_variant,
         sum((q->>'total_marks')::int)::text as total
  from shamo_ingestion_runs r
  join shamo_papers p on p.id = r.paper_id,
       jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q
  where r.idempotency_key ~ 'v2\.3-batch-'
    and r.status = 'awaiting_review'
    and p.year = 2024 and p.exam_session = 'oct_nov'
    and p.paper_variant in ('61','63')
  group by p.paper_variant
  having sum((q->>'total_marks')::int) = 50
) s

union all

select '5. both papers still ready',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       count(*) || ' of 2 ready_for_approval'
from shamo_ingestion_runs r
join shamo_papers p on p.id = r.paper_id
where r.idempotency_key ~ 'v2\.3-batch-'
  and r.status = 'awaiting_review'
  and p.year = 2024 and p.exam_session = 'oct_nov'
  and p.paper_variant in ('61','63')
  and r.extraction_summary->>'ready_for_approval' = 'true'

union all

select '6. audit rows recorded',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       count(*) || ' resolved OCR_LOST_FACTORIAL_CORRECTED row(s)'
from shamo_ingestion_issues i
join shamo_ingestion_runs r on r.id = i.ingestion_run_id
where i.issue_code = 'OCR_LOST_FACTORIAL_CORRECTED' and i.resolved

union all

select '7. published content unchanged',
       case when count(*) = 25 then 'PASS' else 'FAIL' end,
       count(*) || ' published papers (expect 25)'
from shamo_papers where status = 'published'

union all

select '8. staged corpus still 60 ready',
       case when count(*) = 60 then 'PASS' else 'FAIL' end,
       count(*) || ' of 60 ready_for_approval'
from shamo_ingestion_runs
where idempotency_key ~ 'v2\.3-batch-'
  and status = 'awaiting_review'
  and extraction_summary->>'ready_for_approval' = 'true'

order by 1;
