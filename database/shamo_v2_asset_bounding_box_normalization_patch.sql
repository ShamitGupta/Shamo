-- Shamo v2: normalize JSON null asset bounding boxes before constraints run.
--
-- Why:
--   The extraction contract permits bounding_box=null when OCR supplies an
--   instructional image but no reliable crop coordinates. PostgREST sends
--   that value as JSON null, which is distinct from SQL NULL in PostgreSQL.
--   The table correctly accepts SQL NULL or a JSON object.
--
-- This BEFORE trigger converts only JSON null to SQL NULL. It does not weaken
-- the bounding-box constraint or invent coordinates.
--
-- Run the complete file once in the Supabase SQL editor as postgres.

begin;

create or replace function
    shamo_private.normalize_question_asset_bounding_box()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if new.bounding_box = 'null'::jsonb then
        new.bounding_box := null;
    end if;

    return new;
end;
$$;

drop trigger if exists
    shamo_question_assets_normalize_bounding_box
on public.shamo_question_assets;

create trigger shamo_question_assets_normalize_bounding_box
before insert or update of bounding_box
on public.shamo_question_assets
for each row
execute function
    shamo_private.normalize_question_asset_bounding_box();

revoke execute on function
    shamo_private.normalize_question_asset_bounding_box()
from public, anon, authenticated;

grant execute on function
    shamo_private.normalize_question_asset_bounding_box()
to service_role;

commit;

-- Verification 1: expected run state after the failed atomic publication.
-- Expected: PASS, awaiting_review/pending, zero live questions/assets.
select
    run.status,
    run.review_status,
    (
        select count(*)
        from public.shamo_questions as question
        where question.ingestion_run_id = run.id
    ) as live_question_count,
    (
        select count(*)
        from public.shamo_question_assets as asset
        where asset.ingestion_run_id = run.id
    ) as live_asset_count,
    case
        when run.status = 'awaiting_review'
         and run.review_status = 'pending'
         and not exists (
             select 1
             from public.shamo_questions as question
             where question.ingestion_run_id = run.id
         )
         and not exists (
             select 1
             from public.shamo_question_assets as asset
             where asset.ingestion_run_id = run.id
         )
        then 'PASS'
        else 'FAIL'
    end as result
from public.shamo_ingestion_runs as run
where run.id =
    '054f296f-e08c-4360-a27d-325d064b2496'::uuid;

-- Verification 2: expected one enabled normalizing trigger.
-- Expected: trigger_count=1, all_enabled=true, result=PASS.
select
    count(*) as trigger_count,
    bool_and(trigger.tgenabled <> 'D') as all_enabled,
    case
        when count(*) = 1
         and bool_and(trigger.tgenabled <> 'D')
        then 'PASS'
        else 'FAIL'
    end as result
from pg_catalog.pg_trigger as trigger
join pg_catalog.pg_class as relation
  on relation.oid = trigger.tgrelid
join pg_catalog.pg_namespace as namespace
  on namespace.oid = relation.relnamespace
where namespace.nspname = 'public'
  and relation.relname = 'shamo_question_assets'
  and trigger.tgname =
      'shamo_question_assets_normalize_bounding_box'
  and trigger.tgisinternal = false;

-- Verification 3: confirms the exact conversion used by the trigger.
-- Expected: both values=true and result=PASS.
select
    ('null'::jsonb is not null) as json_null_is_not_sql_null,
    (
        nullif('null'::jsonb, 'null'::jsonb)
        is null
    ) as normalization_returns_sql_null,
    case
        when 'null'::jsonb is not null
         and nullif('null'::jsonb, 'null'::jsonb) is null
        then 'PASS'
        else 'FAIL'
    end as result;
