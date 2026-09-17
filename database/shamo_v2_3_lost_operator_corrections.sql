-- Restore three operators that OCR replaced with the wrong symbol.
--
-- A SECOND corruption class, distinct from the lost factorials in
-- shamo_v2_3_lost_factorial_corrections.sql and found the same way: the printed
-- page and the stored text disagree on an operator, so the stored expression
-- evaluates to the wrong number while every structural check still passes.
--
-- Four cells across two papers, all in Question 4.
--
-- ------------------------------------------------------------------
-- 1. 9709/51 O/N 2024 Q4 -- a comma read as multiplication (5 occurrences)
-- ------------------------------------------------------------------
-- Cambridge lists an unsimplified probability beside its simplified form,
-- separated by a COMMA. Mark-scheme page 10 extracts as
--
--     P(HRR) = 1 4 4 16 4 ,4 6 6 144 36  =
--     P(TBB) = 3 4 3 36 6 3 ,,4 7 6 168 28 14  =
--
-- i.e. `= 16/144, 4/36` and `= 36/168, 6/28, 3/14` -- five commas in the row.
-- The OCR stored all five as `\cdot`, which reads as multiplication:
--
--     stored   \frac{16}{144} \cdot \frac{4}{36}   = 0.0123
--     printed  \frac{16}{144},      \frac{4}{36}   = 0.1111 (both forms)
--
-- Every pair is numerically EQUAL either side of the separator -- 16/144 = 4/36,
-- 18/168 = 3/28, 4/144 = 1/36, 36/168 = 6/28 = 3/14 -- which is the proof: a
-- product of two equal quantities is not either of them, so `\cdot` cannot be
-- what was meant. The guidance for the row asks for "2 clearly identified
-- unsimplified probabilities", confirming both forms are being shown.
--
-- ------------------------------------------------------------------
-- 2. 9709/51 O/N 2024 Q4 -- a division read as an addition (1 occurrence)
-- ------------------------------------------------------------------
-- Mark-scheme page 11 prints `3/14 ÷ 61/252  or  (3/14)/(61/252)`. The stored
-- row keeps the second form correctly as a nested fraction but stored the first
-- as `+`, so one cell now contains two "equivalent" forms that disagree:
--
--     stored   3/14 + 61/252        = 0.456
--     printed  3/14 ÷ 61/252        = 54/61 = 0.885
--
-- The A1 row two positions later prints `\frac{54}{61} or 0.885`, so the
-- division is the form that reaches the printed answer.
--
-- NOTE the row's OTHER addition is genuine and is left alone: the denominator
-- `\frac{1}{36} + \frac{6}{28}` really is a sum, printed as such, and the
-- guidance quotes its value as 0.24206. One `+` in this cell is correct and one
-- is a corrupted `÷`, which is why the replacement is anchored on the full
-- surrounding expression rather than on `+`.
--
-- ------------------------------------------------------------------
-- 3. 9709/62 O/N 2024 Q4 -- a division read as an addition (2 occurrences)
-- ------------------------------------------------------------------
-- Mark-scheme page 8 prints the standard error of the mean, `8.1 ÷ sqrt(140)`;
-- the page extracts as `36 35 8.1 140 − ÷ [= 1.461]` (operators trail the
-- Times-set digits because Cambridge sets them in Adobe Symbol). Stored as a
-- sum:
--
--     stored   (36-35) / (8.1 + sqrt(140)) = 1/19.932  = 0.0502
--     printed  (36-35) / (8.1 / sqrt(140)) = 1/0.68459 = 1.461
--
-- The cell prints `[= 1.461]` itself, so it is self-refuting as stored. The
-- second occurrence, `± (a-35)/(8.1 + sqrt(140)) = ±2.198`, is the same
-- denominator in the inverse-normal step: with the division a - 35 = ±1.505,
-- which is credible for a mean of 35; as stored it would be ±43.8.
--
-- Statistically the division is not a judgement call -- sigma/sqrt(n) is the
-- standard error, and sigma + sqrt(n) is not a quantity.
--
-- ------------------------------------------------------------------
-- WHY NOTHING CAUGHT THESE, AND WHAT NOW DOES
-- ------------------------------------------------------------------
-- Same blind spot as the factorials: no mark value changes, so every part still
-- reconciles against its printed subtotal; prose fidelity compares words, not
-- mathematics; and the deterministic validator has no view of formula
-- semantics. Both papers staged completely clean.
--
-- They were found by harness/check_ocr_vs_pdf.mjs, which counts symbols in the
-- PDF text layer against the OCR and had flagged `divide: PDF 2, OCR 0` on
-- both pages. That check already existed; the flags had not been worked.
--
-- A NOTE ON A PAPER THAT NEEDED NO CORRECTION
--
-- 9709/63 M/J 2024 carries the same `divide` flags at OCR level -- its pages
-- hold `\sqrt{0.783 + 200}` and `\sqrt{4.1+60}` -- but its STAGED BUNDLE stores
-- `\sqrt{0.783/200}` and `\sqrt{4.1/60}`, correctly. The pipeline's repair path
-- fixed it before staging. This is the reason a correction must be driven from
-- the staged bundle and never from the OCR record: three of the five flagged
-- pages were already clean downstream.
--
-- SCOPE
--
-- Content correction, staged bundles only. Neither paper is published. Mark
-- codes, mark values, part structure and guidance are untouched; only
-- content_markdown changes, and only in the four asserted cells.
--
-- The OCR rows in shamo_ingestion_pages are deliberately NOT rewritten -- they
-- record what the provider returned, and that record is evidence.
--
-- LIKE IS AVOIDED THROUGHOUT. Postgres LIKE treats backslash as an escape
-- character, so `like '%\frac%'` silently matches the letters `frac`. Every
-- match below uses strpos() or replace(), which are literal.

begin;

create temporary table _op_fix on commit drop as
select r.id as run_id,
       p.paper_variant,
       cell.path,
       cell.needle,
       cell.replacement,
       cell.expected_count,
       r.extraction_summary #>> cell.path as before_text
from shamo_ingestion_runs r
join shamo_papers p on p.id = r.paper_id
join lateral (
  values
    -- 9709/51 Q4: five commas stored as multiplication.
    ('51', '{paper_bundle,questions,3,mark_scheme_items,0,content_markdown}'::text[],
     ' \cdot ', ', ', 5),
    -- 9709/51 Q4: the division between the two fractions.
    ('51', '{paper_bundle,questions,3,mark_scheme_items,3,content_markdown}'::text[],
     '\frac{3}{14} + \frac{61}{252}', '\frac{3}{14} \div \frac{61}{252}', 1),
    -- 9709/62 Q4: the standard error, twice.
    ('62', '{paper_bundle,questions,3,mark_scheme_items,0,content_markdown}'::text[],
     '8.1+\sqrt{140}', '8.1 \div \sqrt{140}', 1),
    ('62', '{paper_bundle,questions,3,mark_scheme_items,4,content_markdown}'::text[],
     '8.1+\sqrt{140}', '8.1 \div \sqrt{140}', 1)
) as cell(variant, path, needle, replacement, expected_count)
  on cell.variant = p.paper_variant
where r.idempotency_key ~ 'v2\.3-batch-'
  and r.status = 'awaiting_review'
  and p.year = 2024
  and p.exam_session = 'oct_nov'
  and p.paper_variant in ('51', '62');

do $$
declare
  n int;
  bad record;
begin
  select count(*) into n from _op_fix;
  if n <> 4 then
    raise exception 'Expected exactly 4 target cells across 9709/51 and 9709/62 O/N 2024, found %', n;
  end if;

  -- Each cell must contain its needle exactly the expected number of times.
  -- Addressing a JSON path by index is only safe if the content is asserted.
  for bad in
    select paper_variant, path, needle, expected_count,
           (length(before_text) - length(replace(before_text, needle, ''))) / length(needle) as actual
    from _op_fix
  loop
    if bad.actual <> bad.expected_count then
      raise exception
        'Cell %/% expected % occurrence(s) of %, found % -- indices or content have moved',
        bad.paper_variant, bad.path, bad.expected_count, bad.needle, bad.actual;
    end if;
  end loop;

  -- Sanity: the replacement must not already be present, or this has been run.
  if exists (select 1 from _op_fix where strpos(before_text, replacement) > 0) then
    raise exception 'A target cell already contains the corrected form; refusing to run twice';
  end if;
end $$;

-- Apply. One jsonb_set per cell; a paper with two cells is updated twice, which
-- is safe because each addresses a distinct path.
do $$
declare
  f record;
begin
  for f in select * from _op_fix loop
    update shamo_ingestion_runs r
       set extraction_summary = jsonb_set(
             r.extraction_summary,
             f.path,
             to_jsonb(replace(r.extraction_summary #>> f.path, f.needle, f.replacement))
           ),
           updated_at = now()
     where r.id = f.run_id;
  end loop;
end $$;

-- Audit trail, one resolved row per paper. Question-level, so part_path is NULL
-- -- valid_part_path() rejects an empty array. `resolved` and `resolved_at` are
-- set together because a CHECK constraint ties them.
insert into shamo_ingestion_issues
  (ingestion_run_id, question_number, part_path, severity, issue_code, message,
   resolved, resolved_at, resolution_note)
select run_id,
       4,
       -- Cast required: part_path is text[] and an untyped NULL in a SELECT list
       -- is text. NULL rather than '{}' because valid_part_path() rejects an
       -- empty array.
       null::text[],
       'warning',
       'OCR_LOST_OPERATOR_CORRECTED',
       case paper_variant
         when '51' then
           'Question 4 stored five printed commas as \cdot, turning a list of equivalent '
           'fractions into a product, and stored one printed division as an addition '
           '(3/14 + 61/252 for a printed 3/14 div 61/252).'
         else
           'Question 4 stored a printed division as an addition in two mark rows: '
           '8.1 + sqrt(140) for a printed 8.1 div sqrt(140), the standard error of the mean.'
       end,
       true,
       now(),
       case paper_variant
         when '51' then
           'Corrected against mark-scheme pages 10 and 11 of the PDF text layer. The comma '
           'reading is proved by every separated pair being numerically equal (16/144 = 4/36, '
           '36/168 = 6/28 = 3/14), and the division by the A1 row printing 54/61 = 0.885, '
           'which only 3/14 div 61/252 reaches. The row''s other addition, 1/36 + 6/28, is '
           'genuine and was left unchanged. '
         else
           'Corrected against mark-scheme page 8 of the PDF text layer, which prints the '
           'divide sign. The cell prints [= 1.461], which requires 8.1/sqrt(140) = 0.68459; '
           'as stored it evaluates to 0.0502. sigma/sqrt(n) is the standard error of the mean. '
       end ||
       'No mark code, mark value or part structure changed. Applied by '
       'database/shamo_v2_3_lost_operator_corrections.sql.'
from (select distinct run_id, paper_variant from _op_fix) s;

do $$
declare
  n int;
begin
  -- Every needle must be gone and every replacement present.
  select count(*) into n
  from _op_fix f
  join shamo_ingestion_runs r on r.id = f.run_id
  where strpos(r.extraction_summary #>> f.path, f.needle) > 0;
  if n <> 0 then
    raise exception 'Corruption still present in % cell(s)', n;
  end if;

  select count(*) into n
  from _op_fix f
  join shamo_ingestion_runs r on r.id = f.run_id
  where strpos(r.extraction_summary #>> f.path, f.replacement) = 0;
  if n <> 0 then
    raise exception 'Replacement missing from % cell(s)', n;
  end if;
end $$;

commit;

-- ------------------------------------------------------------------
-- Verification -- every row should read PASS.
-- ------------------------------------------------------------------
with runs as (
  select r.id, p.paper_variant||' '||p.year||' '||p.exam_session as paper,
         r.extraction_summary->'paper_bundle' as b
  from shamo_ingestion_runs r
  join shamo_papers p on p.id = r.paper_id
  where r.idempotency_key ~ 'v2\.3-batch-' and r.status = 'awaiting_review'
),
rows as (
  select runs.paper, (qv.value->>'question_number')::int as qnum,
         m.value->>'content_markdown' as t
  from runs, jsonb_array_elements(runs.b->'questions') qv,
       jsonb_array_elements(coalesce(qv.value->'mark_scheme_items','[]'::jsonb)) m
  union all
  select runs.paper, (qv.value->>'question_number')::int,
         pm.value->>'content_markdown'
  from runs, jsonb_array_elements(runs.b->'questions') qv,
       jsonb_array_elements(coalesce(qv.value->'parts','[]'::jsonb)) pv,
       jsonb_array_elements(coalesce(pv.value->'mark_scheme_items','[]'::jsonb)) pm
)
select '1. equal-fraction lists no longer multiplied' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
       count(*) || ' row(s) still holding \cdot on 9709/51 O/N 2024 Q4' as detail
from rows where paper = '51 2024 oct_nov' and qnum = 4 and strpos(t, ' \cdot ') > 0

union all

select '2. the 3/14 division restored',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) holding 3/14 div 61/252 (expect 1)'
from rows where strpos(t, '\frac{3}{14} \div \frac{61}{252}') > 0

union all

-- 2, not 1: the sum appears both in the M1 row being corrected and in the
-- earlier row that adds all four scenarios, 4/36 + 3/28 + 1/36 + 6/28.
select '3. the genuine 1/36 + 6/28 sum survives',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) retaining the printed addition (expect 2)'
from rows where strpos(t, '\frac{1}{36} + \frac{6}{28}') > 0

union all

select '4. standard error restored',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) holding 8.1 div sqrt(140) (expect 2)'
from rows where strpos(t, '8.1 \div \sqrt{140}') > 0

union all

select '5. no corrupted standard error remains',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) still holding 8.1+sqrt(140)'
from rows where strpos(t, '8.1+\sqrt{140}') > 0

union all

-- 9709/63 M/J 2024 was already correct and must not have been touched.
select '6. 9709/63 M/J 2024 left alone',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) retaining their correct division (expect 2)'
from rows
where paper = '63 2024 may_june'
  and (strpos(t, '\sqrt{0.783/200}') > 0 or strpos(t, '\sqrt{4.1/60}') > 0)

union all

select '7. mark totals unchanged',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       string_agg(paper || '=' || tot, ', ' order by paper)
from (
  select runs.paper, sum((qv.value->>'total_marks')::int)::text as tot
  from runs, jsonb_array_elements(runs.b->'questions') qv
  where runs.paper in ('51 2024 oct_nov', '62 2024 oct_nov')
  group by runs.paper
  having sum((qv.value->>'total_marks')::int) = 50
) s

union all

select '8. audit rows recorded',
       case when count(*) = 2 then 'PASS' else 'FAIL' end,
       count(*) || ' resolved OCR_LOST_OPERATOR_CORRECTED row(s)'
from shamo_ingestion_issues
where issue_code = 'OCR_LOST_OPERATOR_CORRECTED' and resolved

union all

select '9. published content unchanged',
       case when count(*) = 25 then 'PASS' else 'FAIL' end,
       count(*) || ' published papers (expect 25)'
from shamo_papers where status = 'published'

union all

select '10. all 60 still ready',
       case when count(*) = 60 then 'PASS' else 'FAIL' end,
       count(*) || ' of 60 ready_for_approval'
from shamo_ingestion_runs
where idempotency_key ~ 'v2\.3-batch-' and status = 'awaiting_review'
  and extraction_summary->>'ready_for_approval' = 'true'

order by 1;
