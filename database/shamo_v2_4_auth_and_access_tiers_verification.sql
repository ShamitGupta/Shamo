-- Shamo v2.4 auth/access-tier verification.
-- Read-only checks. Run after shamo_v2_4_auth_and_access_tiers_patch.sql.

select
  '1. auth tables exist' as check_name,
  case
    when to_regclass('public.shamo_profiles') is not null
     and to_regclass('public.shamo_user_entitlements') is not null
    then 'PASS' else 'FAIL'
  end as result;

select
  '2. legacy tables locked from browser roles' as check_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  not (
    has_table_privilege('anon', c.oid, 'select')
    or has_table_privilege('anon', c.oid, 'insert')
    or has_table_privilege('anon', c.oid, 'update')
    or has_table_privilege('anon', c.oid, 'delete')
    or has_table_privilege('authenticated', c.oid, 'select')
    or has_table_privilege('authenticated', c.oid, 'insert')
    or has_table_privilege('authenticated', c.oid, 'update')
    or has_table_privilege('authenticated', c.oid, 'delete')
  ) as pass
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('documents', 'A_level Math')
order by c.relname;

select
  '3. profile RLS and grants' as check_name,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('authenticated', c.oid, 'select') as authenticated_can_select,
  has_table_privilege('authenticated', c.oid, 'update') as authenticated_can_update,
  not has_table_privilege('authenticated', c.oid, 'insert') as authenticated_cannot_insert,
  not has_table_privilege('authenticated', c.oid, 'delete') as authenticated_cannot_delete,
  not has_table_privilege('anon', c.oid, 'select') as anon_cannot_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'shamo_profiles';

select
  '4. entitlement table hidden from browser roles' as check_name,
  c.relrowsecurity as rls_enabled,
  not (
    has_table_privilege('anon', c.oid, 'select')
    or has_table_privilege('anon', c.oid, 'insert')
    or has_table_privilege('anon', c.oid, 'update')
    or has_table_privilege('anon', c.oid, 'delete')
    or has_table_privilege('authenticated', c.oid, 'select')
    or has_table_privilege('authenticated', c.oid, 'insert')
    or has_table_privilege('authenticated', c.oid, 'update')
    or has_table_privilege('authenticated', c.oid, 'delete')
  ) as pass
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'shamo_user_entitlements';

select
  '5. profile trigger installed' as check_name,
  exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created_shamo_profile'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
  ) as pass;

select
  '6. match_documents no longer public' as check_name,
  not has_function_privilege('anon', 'public.match_documents(vector, integer, jsonb)', 'execute') as anon_cannot_execute,
  not has_function_privilege('authenticated', 'public.match_documents(vector, integer, jsonb)', 'execute') as authenticated_cannot_execute,
  (
    select p.proconfig::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'match_documents'
  ) like '%search_path=public, extensions%' as search_path_fixed;
