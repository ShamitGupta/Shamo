-- Drop one asset record that claimed the security barcode as a required diagram.
--
-- 9709/32 May/June 2025 Q11 stages TWO assets that point at the SAME file,
-- a_level/.../32/question_paper/q11/page-18-image-1.jpg. A student would see the
-- same graph rendered twice, the second time captioned as a "number line".
--
-- WHAT THE SPURIOUS RECORD ACTUALLY IS
--
-- It is the model claiming the Cambridge security barcode as instructional
-- content. Three independent signals agree:
--
--   * index_resolution = 'claimed_furniture'. The deterministic resolver in
--     lib/asset_matching.mjs classified the claimed image as page furniture and
--     redirected the claim to the one real content image on the page. That is
--     why both records share a storage path -- the resolver was defending
--     against a bad claim, and did so correctly.
--   * bounding_box y 33-71, the top strip of the page, which is where the
--     barcode is printed. The genuine diagram sits at y 92-276.
--   * The description reads "evenly spaced tick marks and the label 0", which
--     describes a barcode, and asset_type is 'number_line' on a question whose
--     printed figure is a trigonometric graph.
--
-- OCR page 18 confirms the count: two image references, `img-19.jpeg` above the
-- printed page-number line (the barcode) and `img-20.jpeg` below it (the graph).
-- One content image, therefore one asset.
--
-- The surviving record is correct and is left untouched: asset_type
-- 'coordinate_grid', describing the curve y = 5 sin 2x cos^2 x and its maximum
-- point M, which is exactly what the question prints.
--
-- SCOPE AND RARITY
--
-- One record of the 100 staged across the 60 papers, and the only one carrying
-- 'claimed_furniture' -- the other 99 resolved cleanly. The published corpus has
-- 46 assets with zero duplicate storage paths, so nothing published is affected.
--
-- The correction keys on index_resolution rather than on a description or an
-- array index, because that field is written by the resolver and is the actual
-- evidence. asset_count is decremented to match, or ASSET_UPLOAD_COUNT_MISMATCH
-- would fire on the next validation.
--
-- WHY NOTHING CAUGHT IT
--
-- Every asset check passed: the file exists in Storage, has a non-zero byte
-- size, a description, an image MIME type, and the recorded asset_count matched
-- the bundle -- because there genuinely were two rows. Duplicate detection is
-- now part of harness/check_asset_matching.mjs, which fails on this case.
--
-- The Storage object itself is deliberately NOT deleted. It is the correct
-- diagram and the surviving record points at it.

begin;

create temporary table _dup_asset on commit drop as
select r.id as run_id,
       r.asset_count as asset_count_before,
       -- WITH ORDINALITY yields bigint, and there is no `jsonb - bigint`
       -- operator; the delete below needs a plain integer index.
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
  and av.value->>'index_resolution' = 'claimed_furniture';

do $$
declare
  n int;
  rec record;
begin
  select count(*) into n from _dup_asset;
  if n <> 1 then
    raise exception 'Expected exactly 1 claimed_furniture asset, found %', n;
  end if;

  select * into rec from _dup_asset;

  -- The record may only be dropped because another asset on the same question
  -- already points at the same file. Deleting an only-asset would lose a
  -- diagram rather than de-duplicate one.
  if not exists (
    select 1
    from shamo_ingestion_runs r,
         jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') with ordinality q,
         jsonb_array_elements(coalesce(q.value->'assets', '[]'::jsonb)) with ordinality av
    where r.id = rec.run_id
      and q.ordinality - 1 = rec.q_idx
      and av.ordinality - 1 <> rec.a_idx
      and av.value->>'storage_path' = rec.asset->>'storage_path'
  ) then
    raise exception
      'Refusing to drop the asset: no sibling on the same question points at %. '
      'That would remove a diagram, not a duplicate.', rec.asset->>'storage_path';
  end if;
end $$;

-- Remove the element. jsonb `- integer` deletes by array index.
update shamo_ingestion_runs r
   set extraction_summary = jsonb_set(
         r.extraction_summary,
         array['paper_bundle', 'questions', d.q_idx::text, 'assets'],
         (r.extraction_summary #> array['paper_bundle', 'questions', d.q_idx::text, 'assets']) - d.a_idx
       ),
       asset_count = r.asset_count - 1,
       updated_at = now()
  from _dup_asset d
 where r.id = d.run_id;

-- Audit trail. Question-level, so part_path is NULL: valid_part_path() rejects
-- an empty array. `resolved` and `resolved_at` are set together because a CHECK
-- constraint ties them.
insert into shamo_ingestion_issues
  (ingestion_run_id, question_number, part_path, severity, issue_code, message,
   resolved, resolved_at, resolution_note)
select d.run_id,
       d.question_number,
       -- Cast required: part_path is text[] and an untyped NULL in a SELECT list
       -- is text. NULL rather than '{}' because valid_part_path() rejects an
       -- empty array.
       null::text[],
       'warning',
       'DUPLICATE_ASSET_CLAIM_REMOVED',
       'Two asset records on this question pointed at the same Storage object, so the '
       'diagram would have rendered twice. The removed record carried '
       'index_resolution = claimed_furniture: the model claimed the page security barcode '
       'as a required diagram and the deterministic resolver redirected it to the one real '
       'content image on the page.',
       true,
       now(),
       'Removed the barcode claim and decremented asset_count from 2 to 1. Confirmed '
       'against OCR page 18, which carries one image above the printed page-number line '
       '(the barcode) and one below it (the graph). The surviving coordinate_grid record '
       'describes y = 5 sin 2x cos^2 x and its maximum point M, matching the printed '
       'figure, and is unchanged. The Storage object is correct and was NOT deleted. '
       'Applied by database/shamo_v2_3_duplicate_asset_correction.sql.'
from _dup_asset d;

do $$
declare
  remaining  int;
  now_assets int;
  now_count  int;
begin
  select count(*) into remaining
  from shamo_ingestion_runs r,
       jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
       jsonb_array_elements(coalesce(q->'assets', '[]'::jsonb)) av
  where r.idempotency_key ~ 'v2\.3-batch-'
    and av->>'index_resolution' = 'claimed_furniture';

  if remaining <> 0 then
    raise exception 'claimed_furniture asset still present in % row(s)', remaining;
  end if;

  select jsonb_array_length(r.extraction_summary #> '{paper_bundle,questions,10,assets}'),
         r.asset_count
    into now_assets, now_count
  from shamo_ingestion_runs r
  join _dup_asset d on d.run_id = r.id;

  if now_assets <> 1 then
    raise exception 'Q11 should hold exactly 1 asset after the correction, holds %', now_assets;
  end if;
  if now_count <> 1 then
    raise exception 'asset_count should be 1 after the correction, is %', now_count;
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
  select runs.id, runs.paper, runs.asset_count,
         (q.value->>'question_number')::int as qnum,
         av.value as asset
  from runs, jsonb_array_elements(runs.b->'questions') q,
       jsonb_array_elements(coalesce(q.value->'assets', '[]'::jsonb)) av
)
select '1. barcode claims remaining' as check,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as result,
       count(*) || ' asset(s) still marked claimed_furniture' as detail
from a where asset->>'index_resolution' = 'claimed_furniture'

union all

select '2. one image claimed twice on a question',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' duplicate group(s)'
from (
  select id, qnum, asset->>'storage_path' as sp
  from a group by id, qnum, asset->>'storage_path' having count(*) > 1
) d

union all

select '3. staged asset total',
       case when count(*) = 99 then 'PASS' else 'FAIL' end,
       count(*) || ' assets across the 60 papers (expect 99, was 100)'
from a

union all

select '4. every asset still has a storage path',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' asset(s) missing a storage path'
from a where coalesce(asset->>'storage_path', '') = ''

union all

select '5. asset_count agrees with the bundle',
       case when count(*) = 0 then 'PASS' else 'FAIL' end,
       count(*) || ' run(s) where asset_count <> assets in bundle'
from (
  select runs.id, runs.asset_count, count(av.*) as actual
  from runs
  left join lateral (
    select 1 from jsonb_array_elements(runs.b->'questions') q,
                  jsonb_array_elements(coalesce(q->'assets', '[]'::jsonb)) x
  ) av on true
  group by runs.id, runs.asset_count
  having coalesce(runs.asset_count, 0) <> count(av.*)
) m

union all

select '6. the surviving Q11 asset is the graph',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*) || ' coordinate_grid asset on 9709/32 M/J 2025 Q11 (expect 1)'
from a
where paper = '32 2025 may_june' and qnum = 11
  and asset->>'asset_type' = 'coordinate_grid'

union all

select '7. audit row recorded',
       case when count(*) = 1 then 'PASS' else 'FAIL' end,
       count(*) || ' resolved DUPLICATE_ASSET_CLAIM_REMOVED row(s)'
from shamo_ingestion_issues
where issue_code = 'DUPLICATE_ASSET_CLAIM_REMOVED' and resolved

union all

select '8. published content unchanged',
       case when count(*) = 25 then 'PASS' else 'FAIL' end,
       count(*) || ' published papers (expect 25)'
from shamo_papers where status = 'published'

union all

select '9. all 60 still ready',
       case when count(*) = 60 then 'PASS' else 'FAIL' end,
       count(*) || ' of 60 ready_for_approval'
from shamo_ingestion_runs
where idempotency_key ~ 'v2\.3-batch-' and status = 'awaiting_review'
  and extraction_summary->>'ready_for_approval' = 'true'

order by 1;
