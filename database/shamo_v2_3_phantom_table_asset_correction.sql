-- Drop a phantom asset on 9709/51 May/June 2025 Q3: the stored "table" is the
-- page security barcode.
--
-- The paper's ONLY asset claims question_paper page 4 image 0, described as
-- "Table of times taken, in seconds, to run 50 m for 11 runners from the Gulls
-- and 11 runners from the Herons." There is no such image.
--
-- EVIDENCE
--
-- OCR page 4 contains exactly one image reference and it sits BEFORE the printed
-- page-number line:
--
--     * 0000800000004 * ![img-5.jpeg](img-5.jpeg) 4 3 Last Sunday, teams of ...
--
-- Everything above that line is Cambridge page furniture, so img-5 is the
-- barcode -- the digits `0000800000004` beside it are the barcode's own text.
--
-- The real table came through as MARKDOWN TEXT in the question stem, complete
-- and correct:
--
--     | Gulls  | 7.9 | 8.2 | 8.3 | 8.6 | 8.6 | 8.8 | 9.2 | 9.7 | 9.8 | 10.0 | 10.4 |
--     | Herons | 9.5 | 9.9 | 8.5 | 8.1 | 9.2 | 10.8 | 8.3 | 9.7 | 9.3 | 9.9  | 8.7  |
--
-- so nothing is lost by removing the asset. A student would otherwise be shown a
-- barcode strip captioned as the data table.
--
-- lib/asset_matching.mjs agrees independently: classifyPageImages reports no
-- content image on that page, and harness/check_asset_matching.mjs flags the
-- stored index 0 as `no_content_image` -- the single disagreement across 117
-- assets. Note the stored asset carries index_resolution = NULL, meaning the
-- live pipeline matched the model's claim directly without consulting the
-- resolver, which is how it reached Storage.
--
-- THIS IS A KNOWN CLASS, SECOND OCCURRENCE
--
-- 9709/51 O/N 2025 Q3 was the same thing: a back-to-back stem-and-leaf question
-- whose claimed diagram never existed, corrected during batch-4 review. Same
-- component, same question type, same phantom. Statistics papers print their
-- data as tables and ask the candidate to draw the diagram, so there is
-- routinely nothing to extract.
--
-- WHY REMOVING IT DOES NOT BLOCK THE PAPER
--
-- Q3 metadata sets diagram_required = true and the paper's asset_count is 1, so
-- the asset going to zero could have tripped DIAGRAM_REQUIRED_WITHOUT_ASSET.
-- It does not: part (a) reads "Draw a back-to-back stem-and-leaf diagram", so
-- DIAGRAM_REQUIRED_BUT_CANDIDATE_DRAWS_IT fires first and is warning severity.
-- Verified by replaying the modified bundle through the real generated validator
-- with harness/check_autonomy.mjs before applying this file: the paper does not
-- appear among those that would stop.
--
-- diagram_required is left as true ON PURPOSE. The question does involve a
-- diagram -- the student has to draw one -- and the flag is what makes the
-- candidate-draws rule reachable. Setting it false would hide the case rather
-- than describe it.
--
-- SCOPE
--
-- One asset record on one staged bundle. asset_count goes 1 -> 0. No question,
-- part, mark row, mark value or metadata field changes.
--
-- The Storage object is NOT deleted. It is a barcode crop, harmless, and
-- deleting from a private bucket is a separate irreversible operation that
-- nothing here depends on.

begin;

create temporary table _phantom on commit drop as
select r.id as run_id,
       r.asset_count as asset_count_before,
       (q.ordinality - 1)::int as q_idx,
       (q.value->>'question_number')::int as question_number,
       (av.ordinality - 1)::int as a_idx,
       av.value as asset
from shamo_ingestion_runs r
join shamo_papers p on p.id = r.paper_id,
     jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') with ordinality q,
     jsonb_array_elements(coalesce(q.value->'assets', '[]'::jsonb)) with ordinality av
where r.idempotency_key ~ 'v2\.3-batch-'
  and r.status = 'awaiting_review'
  and p.paper_variant = '51'
  and p.year = 2025
  and p.exam_session = 'may_june'
  and (q.value->>'question_number')::int = 3;

do $$
declare rec record; n int;
begin
  select count(*) into n from _phantom;
  if n <> 1 then
    raise exception 'Expected exactly 1 asset on 9709/51 M/J 2025 Q3, found %', n;
  end if;

  select * into rec from _phantom;

  -- Assert this is the record reviewed, not some later replacement.
  if rec.asset->>'source_page_number' <> '4' or rec.asset->>'source_image_index' <> '0' then
    raise exception 'Asset claims page %/index %, expected 4/0 -- wrong target',
      rec.asset->>'source_page_number', rec.asset->>'source_image_index';
  end if;
  if rec.asset->>'asset_type' <> 'table' then
    raise exception 'Asset type is %, expected table -- wrong target', rec.asset->>'asset_type';
  end if;

  -- The data must survive as text in the stem, or removing the asset loses it.
  -- This is the check that makes the deletion safe rather than merely tidy.
  if not exists (
    select 1 from shamo_ingestion_runs r,
         jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q
    where r.id = rec.run_id
      and (q.value->>'question_number')::int = 3
      and strpos(q.value->>'stem_markdown', 'Gulls') > 0
      and strpos(q.value->>'stem_markdown', 'Herons') > 0
      and strpos(q.value->>'stem_markdown', '10.4') > 0
  ) then
    raise exception
      'Refusing to remove the asset: the Gulls/Herons table is not present as text in the '
      'stem, so this would delete data rather than a phantom.';
  end if;
end $$;

update shamo_ingestion_runs r
   set extraction_summary = jsonb_set(
         r.extraction_summary,
         array['paper_bundle', 'questions', ph.q_idx::text, 'assets'],
         (r.extraction_summary #> array['paper_bundle', 'questions', ph.q_idx::text, 'assets']) - ph.a_idx
       ),
       asset_count = greatest(r.asset_count - 1, 0),
       updated_at = now()
  from _phantom ph
 where r.id = ph.run_id;

-- Audit trail. Question-level, so part_path is NULL: valid_part_path() rejects
-- an empty array. `resolved` and `resolved_at` are set together because a CHECK
-- constraint ties them.
insert into shamo_ingestion_issues
  (ingestion_run_id, question_number, part_path, severity, issue_code, message,
   resolved, resolved_at, resolution_note)
select ph.run_id,
       ph.question_number,
       null::text[],
       'warning',
       'PHANTOM_ASSET_REMOVED',
       'The only asset staged for this paper claimed question_paper page 4 image 0 as a '
       'table of runners'' times. Page 4 holds exactly one image and it sits above the '
       'printed page-number line, so it is the Cambridge security barcode. No table image '
       'exists.',
       true,
       now(),
       'Removed the phantom and decremented asset_count from 1 to 0. The Gulls/Herons data '
       'is present and complete as a markdown table in the question stem, so nothing was '
       'lost; that was asserted before deleting. lib/asset_matching.mjs independently '
       'reports no content image on the page. diagram_required is deliberately left true: '
       'part (a) asks the candidate to draw the diagram, so '
       'DIAGRAM_REQUIRED_BUT_CANDIDATE_DRAWS_IT applies at warning severity, confirmed by '
       'replaying the modified bundle through the generated validator. The Storage object '
       'was NOT deleted. Applied by '
       'database/shamo_v2_3_phantom_table_asset_correction.sql.'
from _phantom ph;

do $$
declare n_assets int; n_count int;
begin
  select jsonb_array_length(r.extraction_summary #> '{paper_bundle,questions,2,assets}'), r.asset_count
    into n_assets, n_count
  from shamo_ingestion_runs r join _phantom ph on ph.run_id = r.id;

  if n_assets <> 0 then
    raise exception 'Q3 should hold 0 assets after the correction, holds %', n_assets;
  end if;
  if n_count <> 0 then
    raise exception 'asset_count should be 0 after the correction, is %', n_count;
  end if;
end $$;

commit;

-- ------------------------------------------------------------------
-- Verification -- every row should read PASS.
-- ------------------------------------------------------------------
with runs as (
  select r.id, r.asset_count, p.paper_variant||' '||p.year||' '||p.exam_session as paper,
         r.extraction_summary->'paper_bundle' as b
  from shamo_ingestion_runs r
  join shamo_papers p on p.id = r.paper_id
  where r.idempotency_key ~ 'v2\.3-batch-' and r.status = 'awaiting_review'
),
a as (
  select runs.paper, runs.asset_count, (q.value->>'question_number')::int as qnum, av.value as asset
  from runs, jsonb_array_elements(runs.b->'questions') q,
       jsonb_array_elements(coalesce(q.value->'assets', '[]'::jsonb)) av
)
select '1. phantom removed' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
       count(*) || ' asset(s) on 9709/51 M/J 2025 Q3 (expect 0)' as detail
from a where paper = '51 2025 may_june' and qnum = 3

union all

select '2. staged asset total',
       case when count(*) = 98 then 'PASS' else 'FAIL' end,
       count(*) || ' assets across the 60 papers (expect 98)'
from a

union all

select '3. the table survives as text',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*) || ' stem(s) still holding the Gulls/Herons data (expect 1)'
from runs, jsonb_array_elements(runs.b->'questions') q
where runs.paper = '51 2025 may_june'
  and (q.value->>'question_number')::int = 3
  and strpos(q.value->>'stem_markdown', 'Gulls') > 0
  and strpos(q.value->>'stem_markdown', '10.4') > 0

union all

select '4. asset_count agrees with the bundle',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' run(s) where asset_count disagrees'
from (
  select runs.id, runs.asset_count,
         (select count(*) from a where a.paper = runs.paper) as actual
  from runs
) m
where coalesce(asset_count, 0) <> actual

union all

select '5. every remaining asset has a storage path',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' asset(s) missing a storage path'
from a where coalesce(asset->>'storage_path', '') = ''

union all

select '6. audit row recorded',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*) || ' resolved PHANTOM_ASSET_REMOVED row(s)'
from shamo_ingestion_issues where issue_code = 'PHANTOM_ASSET_REMOVED' and resolved

union all

select '7. all 60 still ready',
       case when count(*) = 60 then 'PASS' else 'FAIL' end,
       count(*) || ' of 60 ready_for_approval'
from shamo_ingestion_runs
where idempotency_key ~ 'v2\.3-batch-' and status = 'awaiting_review'
  and extraction_summary->>'ready_for_approval' = 'true'

union all

select '8. published content unchanged',
       case when count(*) = 25 then 'PASS' else 'FAIL' end,
       count(*) || ' published papers (expect 25)'
from shamo_papers where status = 'published'

order by 1;
