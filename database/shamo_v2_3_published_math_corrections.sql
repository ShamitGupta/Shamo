-- Correct five PUBLISHED mark rows whose stored mathematics is wrong.
--
-- Seven edits in total: six in content_markdown plus two in guidance_markdown,
-- because two rows repeat the corrupted expression in their guidance.
--
-- These are student-visible right now. Every other correction file in this
-- series works on staged bundles; this one touches published content, so it is
-- deliberately separate and its assertions are tighter.
--
-- Three papers, five rows, three distinct OCR corruption classes. Each was
-- confirmed against the PDF text layer cached under
-- workflows/n8n/harness/fixtures/pdf_text/, and independently against a value
-- printed in the same cell. Nothing here is inferred from the mathematics alone.
--
-- ------------------------------------------------------------------
-- 1. 9709/62 M/J 2024 Q5 -- factorials read as squares
-- ------------------------------------------------------------------
--   stored   e^{-3.1}(1 + 3.1 + \frac{3.1^2}{2^2} + \frac{3.1^3}{3^2})
--   printed  e^-3.1 (1 + 3.1 + 3.1^2/2! + 3.1^3/3!)
--
-- Mark-scheme page 6 extracts as `e-3.1(1 + 3.1 + 233.1 3.1 2! 3! )`: pypdf
-- reads a stacked fraction denominator-last, giving numerators 3.1^2 and 3.1^3
-- against denominators 2! and 3!.
--
-- The same cell prints the expansion `1 + 3.1 + 4.805 + 4.965`:
--     3.1^2/2! = 4.805    3.1^2/2^2 = 2.4025
--     3.1^3/3! = 4.96517  3.1^3/3^2 = 3.3101
-- and the third alternative `0.0450 + 0.1397 + 0.2165 + 0.22368` agrees term by
-- term. Note 2^2 = 4 while 2! = 2, so unlike the O/N 2024 papers this one is
-- wrong in the squared term too -- there is no accidental survival here.
--
-- This corruption has been documented since 7 August 2026 as an "OCR ceiling"
-- and was never corrected. It is correctable: the printed value is right there.
--
-- ------------------------------------------------------------------
-- 2. 9709/62 M/J 2024 Q6 -- a division read as an addition
-- ------------------------------------------------------------------
--   stored   \pm \frac{508 - 510}{10 + \sqrt{120}}
--   printed  ± (508 - 510) / (10 ÷ sqrt(120))
--
-- Decisive evidence: the guidance on mark-scheme page 9 for part (b) reads
-- "Standardising to find critical value (must use 510 and 10÷ 120)" -- Cambridge
-- states the divide sign in prose. The A1 row also prints `± -2.191`:
--     10/sqrt(120) = 0.91287 -> -2/0.91287 = -2.1906
--     10+sqrt(120) = 20.954  -> -2/20.954  = -0.0954
-- sigma/sqrt(n) is the standard error of the mean; sigma + sqrt(n) is not a
-- quantity.
--
-- ------------------------------------------------------------------
-- 3. 9709/51 M/J 2024 Q7 and 9709/51 O/N 2025 Q7 -- commas read as products
-- ------------------------------------------------------------------
-- Cambridge lists a value beside an equivalent form of itself, comma-separated.
--
--   9709/51 M/J 2024 p20 prints   [Probability] 1 - 132/336 , 204/336 , 0.607
--   stored                        1 - \frac{132}{336} \cdot \frac{204}{336}, 0.607
--
--   9709/51 O/N 2025 p19 prints   [Probability =] 21/252 , 1/12
--   stored                        \frac{21}{252} \cdot \frac{1}{12}
--
-- As stored the first evaluates to 1 - 0.2385 = 0.7615 against a printed 0.607,
-- and the second to 0.00694 against a printed 0.0833. In the O/N 2025 case the
-- two operands are numerically EQUAL (21/252 = 1/12), so multiplication is
-- impossible on its face; the M/J 2024 case is equal across the subtraction
-- (1 - 132/336 = 204/336), which is why harness/check_lost_operators.mjs finds
-- the former and not the latter -- a limitation recorded in that file.
--
-- ------------------------------------------------------------------
-- WHAT THIS DOES NOT TOUCH
-- ------------------------------------------------------------------
-- Only content_markdown and guidance_markdown on five mark rows. No mark code,
-- mark value, question, part, asset, metadata or paper row changes.
--
-- Embeddings do NOT need regenerating. shamo_question_search holds only
-- content_kind = 'question' rows built from question stems and part prompts;
-- verified live at 579 rows, none derived from mark-scheme text. So a
-- mark-scheme correction cannot invalidate a vector.
--
-- Legitimate \cdot in published content is deliberately left alone: the
-- integration results on 9709/12 M/J 2024 Q6, the quotient rule on
-- 9709/31 O/N 2025 Q7, and the vector dot product on 9709/33 O/N 2025 Q9 are
-- all real multiplications. That is why this file addresses rows by primary key
-- rather than pattern-matching \cdot corpus-wide.
--
-- LIKE IS AVOIDED THROUGHOUT: Postgres LIKE treats backslash as an escape, so
-- `like '%\frac%'` silently matches the letters `frac`. Every match uses
-- strpos() or replace(), which are literal.

begin;

create temporary table _pub_fix on commit drop as
select *
from (values
  -- 9709/62 M/J 2024 Q5 seq 1: two factorials.
  ('5a2e388c-86fb-4f80-bbcd-81695b5d272f'::uuid, '\frac{3.1^2}{2^2}', '\frac{3.1^2}{2!}'),
  ('5a2e388c-86fb-4f80-bbcd-81695b5d272f'::uuid, '\frac{3.1^3}{3^2}', '\frac{3.1^3}{3!}'),
  -- 9709/62 M/J 2024 Q6 seq 2: the standard error.
  ('34437975-f10a-4a43-b69b-e02f8cd125ac'::uuid, '10 + \sqrt{120}',   '10 \div \sqrt{120}'),
  -- 9709/51 M/J 2024 Q7 seq 24: a comma.
  ('1c9144f2-6023-4219-8b0d-b7c3c6a48afe'::uuid,
     '\frac{132}{336} \cdot \frac{204}{336}', '\frac{132}{336}, \frac{204}{336}'),
  -- 9709/51 O/N 2025 Q7 seq 16 and 19: the same comma twice.
  ('e6e14e0c-b310-4395-8845-69cd474a5698'::uuid,
     '\frac{21}{252} \cdot \frac{1}{12}', '\frac{21}{252}, \frac{1}{12}'),
  ('9444db30-2e10-4be4-af35-af68fa45406f'::uuid,
     '\frac{21}{252} \cdot \frac{1}{12}', '\frac{21}{252}, \frac{1}{12}')
) as t(row_id, needle, replacement);

-- THE GUIDANCE COLUMN CARRIES THE SAME CORRUPTION, and a first run of this file
-- missed it by correcting content_markdown alone. Both 9709/51 O/N 2025 rows
-- repeat the expression in their guidance -- "If M mark not awarded, SCB1 for
-- 21/252 . 1/12 WWW." -- and mark-scheme page 19 prints a comma there too. The
-- verification block below is what caught it: check 7 read 6 where 4 was
-- expected, because a row whose guidance still held \cdot still counted.
--
-- Lesson worth keeping: a correction addressed at one column of a two-column
-- source field is half a correction. Assert on the row, not on the column.
create temporary table _pub_fix_guidance on commit drop as
select * from (values
  ('e6e14e0c-b310-4395-8845-69cd474a5698'::uuid,
     '\frac{21}{252} \cdot \frac{1}{12}', '\frac{21}{252}, \frac{1}{12}'),
  ('9444db30-2e10-4be4-af35-af68fa45406f'::uuid,
     '\frac{21}{252} \cdot \frac{1}{12}', '\frac{21}{252}, \frac{1}{12}')
) as t(row_id, needle, replacement);

do $$
declare
  n int;
  bad record;
begin
  -- All six target rows must exist, be published, and still hold their needle.
  -- Addressing published content by id is only safe if the content is asserted.
  select count(*) into n
  from _pub_fix f
  join shamo_mark_scheme_items mi on mi.id = f.row_id
  where strpos(mi.content_markdown, f.needle) > 0;
  if n <> 6 then
    raise exception 'Expected 6 addressable corrections, found % -- content has moved', n;
  end if;

  for bad in
    select f.row_id, f.needle
    from _pub_fix f
    join shamo_mark_scheme_items mi on mi.id = f.row_id
    join shamo_questions q on q.id = mi.question_id
    join shamo_papers p on p.id = q.paper_id
    where p.status <> 'published'
  loop
    raise exception 'Row % is not on a published paper; wrong target', bad.row_id;
  end loop;

  -- Refuse to run twice.
  if exists (
    select 1 from _pub_fix f
    join shamo_mark_scheme_items mi on mi.id = f.row_id
    where strpos(mi.content_markdown, f.replacement) > 0
  ) then
    raise exception 'A target row already holds the corrected form; refusing to run twice';
  end if;
end $$;

-- Apply, one needle at a time. Two corrections land on the same row (Q5's two
-- factorials), so this iterates rather than joining.
do $$
declare
  f record;
begin
  for f in select * from _pub_fix loop
    -- No updated_at on this table: it carries created_at only, so the audit
    -- row inserted below is the sole record that these values were changed
    -- after publication. Do not add a timestamp column just for this.
    update shamo_mark_scheme_items
       set content_markdown = replace(content_markdown, f.needle, f.replacement)
     where id = f.row_id;
  end loop;

  for f in select * from _pub_fix_guidance loop
    update shamo_mark_scheme_items
       set guidance_markdown = replace(guidance_markdown, f.needle, f.replacement)
     where id = f.row_id;
  end loop;
end $$;

-- Audit trail on the ingestion run that produced each published row, so the
-- correction is discoverable from the paper's provenance. Question-level, so
-- part_path is NULL: valid_part_path() rejects an empty array. `resolved` and
-- `resolved_at` are set together because a CHECK constraint ties them.
insert into shamo_ingestion_issues
  (ingestion_run_id, question_number, part_path, severity, issue_code, message,
   resolved, resolved_at, resolution_note)
select distinct
       p.current_ingestion_run_id,
       q.question_number,
       -- Must be cast: part_path is text[] and an untyped NULL in a SELECT list
       -- is text, which Postgres will not coerce. NULL rather than '{}' because
       -- valid_part_path() rejects an empty array.
       null::text[],
       'warning',
       'PUBLISHED_MATH_CORRECTED_POST_HOC',
       'A published mark row stored mathematics that disagreed with the printed page: an '
       'OCR-level operator or factorial corruption that left every mark value intact and so '
       'passed publication.',
       true,
       now(),
       'Corrected against the PDF text layer and against a value printed in the same cell. '
       'Only content_markdown and guidance_markdown changed; no mark code, mark value or '
       'structure was altered. '
       'Embeddings were not regenerated because shamo_question_search is built from question '
       'and part text only, not mark-scheme rows. Applied by '
       'database/shamo_v2_3_published_math_corrections.sql.'
from _pub_fix f
join shamo_mark_scheme_items mi on mi.id = f.row_id
join shamo_questions q on q.id = mi.question_id
join shamo_papers p on p.id = q.paper_id
where p.current_ingestion_run_id is not null;

do $$
declare
  n int;
begin
  select count(*) into n
  from _pub_fix f
  join shamo_mark_scheme_items mi on mi.id = f.row_id
  where strpos(mi.content_markdown, f.needle) > 0;
  if n <> 0 then
    raise exception 'Corruption still present in % published content row(s)', n;
  end if;

  -- Guidance repeats the same expression on both 9709/51 O/N 2025 rows. A first
  -- run corrected content only and the verification block caught the miss.
  select count(*) into n
  from _pub_fix_guidance f
  join shamo_mark_scheme_items mi on mi.id = f.row_id
  where strpos(mi.guidance_markdown, f.needle) > 0;
  if n <> 0 then
    raise exception 'Corruption still present in % published guidance row(s)', n;
  end if;

  select count(*) into n
  from _pub_fix f
  join shamo_mark_scheme_items mi on mi.id = f.row_id
  where strpos(mi.content_markdown, f.replacement) = 0;
  if n <> 0 then
    raise exception 'Replacement missing from % published row(s)', n;
  end if;
end $$;

commit;

-- ------------------------------------------------------------------
-- Verification -- every row should read PASS.
-- ------------------------------------------------------------------
select '1. factorials restored on 9709/62 M/J 2024 Q5' as check,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as result,
       count(*) || ' row(s) holding both 2! and 3! (expect 1)' as detail
from shamo_mark_scheme_items
where strpos(content_markdown, '\frac{3.1^2}{2!}') > 0
  and strpos(content_markdown, '\frac{3.1^3}{3!}') > 0

union all

select '2. no squared factorial remains',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) still holding 3.1^n over n^2'
from shamo_mark_scheme_items
where strpos(content_markdown, '\frac{3.1^2}{2^2}') > 0
   or strpos(content_markdown, '\frac{3.1^3}{3^2}') > 0

union all

-- 3, not 1. Rows seq 6 and seq 8 of the same question ALREADY stored the
-- divide correctly; only seq 2 was corrupted. That inconsistency inside one
-- paper is the strongest confirmation available that the divide is the printed
-- form, and it shows the corruption is sporadic rather than a systematic
-- mis-rendering of the glyph.
select '3. standard error restored on 9709/62 M/J 2024 Q6',
       case when count(*) = 3 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) holding 10 div sqrt(120) (expect 3)'
from shamo_mark_scheme_items
where strpos(content_markdown, '10 \div \sqrt{120}') > 0

union all

select '4. no corrupted standard error remains',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) still holding 10 + sqrt(120)'
from shamo_mark_scheme_items
where strpos(content_markdown, '10 + \sqrt{120}') > 0

union all

select '5. commas restored',
       case when count(*) = 3 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) now comma-separated (expect 3)'
from shamo_mark_scheme_items
where strpos(content_markdown, '\frac{132}{336}, \frac{204}{336}') > 0
   or strpos(content_markdown, '\frac{21}{252}, \frac{1}{12}') > 0

union all

select '6. no corrupted product remains',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' row(s) still multiplying equal fractions'
from shamo_mark_scheme_items
where strpos(content_markdown, '\frac{132}{336} \cdot \frac{204}{336}') > 0
   or strpos(content_markdown, '\frac{21}{252} \cdot \frac{1}{12}') > 0

union all

-- Genuine multiplication must survive: 7 published rows hold \cdot today, 3 of
-- them corrupted, so 4 must remain. They are the two integration results on
-- 9709/12 M/J 2024 Q6, the quotient rule on 9709/31 O/N 2025 Q7, and a guidance
-- row on 9709/32 F/M 2024 Q9.
select '7. legitimate \cdot preserved',
       case when count(*) = 4 then 'PASS' else 'FAIL' end,
       count(*) || ' published row(s) retaining a real \cdot (expect 4)'
from shamo_mark_scheme_items
where strpos(content_markdown, ' \cdot ') > 0
   or strpos(guidance_markdown, ' \cdot ') > 0

union all

select '8. published corpus shape unchanged',
       case when count(*) = 1795 then 'PASS' else 'FAIL' end,
       count(*) || ' published mark rows (expect 1795)'
from shamo_mark_scheme_items

union all

select '9. published papers unchanged',
       case when count(*) = 25 then 'PASS' else 'FAIL' end,
       count(*) || ' published papers (expect 25)'
from shamo_papers where status = 'published'

union all

select '10. embeddings untouched and still valid',
       case when count(*) = 579 then 'PASS' else 'FAIL' end,
       count(*) || ' search rows with a 512-dim vector (expect 579)'
from shamo_question_search
where embedding is not null and vector_dims(embedding) = 512

union all

select '11. audit rows recorded',
       case when count(*) >= 3 then 'PASS' else 'FAIL' end,
       count(*) || ' resolved PUBLISHED_MATH_CORRECTED_POST_HOC row(s)'
from shamo_ingestion_issues
where issue_code = 'PUBLISHED_MATH_CORRECTED_POST_HOC' and resolved

order by 1;
