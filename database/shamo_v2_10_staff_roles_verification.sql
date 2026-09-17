-- Verification for shamo_v2_10_staff_roles_patch.sql.
--
-- Read-only except section 4, which writes probe rows inside an explicit
-- transaction and rolls them back. Run section 4 against a synthetic user only.
--
-- Section 5 is the one that matters most. Every other check confirms the table
-- is shaped correctly; section 5 confirms the browser cannot write the two
-- fields that would defeat the whole design -- the role itself, and the sample
-- marker. A correct table with a too-wide grant is not a safe table.

-- 1. Structure: the table exists, RLS is on, the browser has no privileges,
--    service_role can write.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       coalesce(has_table_privilege('anon', c.oid, 'SELECT'), false) as anon_select,
       coalesce(has_table_privilege('authenticated', c.oid, 'SELECT'), false) as auth_select,
       coalesce(has_table_privilege('service_role', c.oid, 'INSERT'), false) as service_insert
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'shamo_user_roles';
-- Expect: 1 row, rls_enabled true, policies 1, anon_select false,
-- auth_select false, service_insert true.

-- 2. The constraints that carry the design.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.shamo_user_roles'::regclass
order by conname;
-- Expect: the two CHECKs (role, granted_by), the primary key, and the
-- user_id foreign key with ON DELETE CASCADE.

-- 3. The sample marker exists, defaults false, and nothing is marked yet.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shamo_profiles'
  and column_name = 'is_sample';
-- Expect: boolean, NO, false.

select count(*) filter (where is_sample) as sample_profiles,
       count(*) as total_profiles
from public.shamo_profiles;
-- Expect: sample_profiles 0 until demo_cohort.py has run.

-- 4. The CHECK constraints actually reject. A constraint that never fires is
--    indistinguishable from a correct one until bad data arrives.
--    Replace :probe_user with a real synthetic auth.users id before running.
/*
begin;
  -- Should raise: shamo_user_roles_role_known
  insert into public.shamo_user_roles(user_id, role, granted_by)
  values (:'probe_user', 'admin', 'invite_code');
rollback;

begin;
  -- Should raise: shamo_user_roles_granted_by_known
  insert into public.shamo_user_roles(user_id, role, granted_by)
  values (:'probe_user', 'staff', 'self_declared');
rollback;

begin;
  -- Should succeed, then disappear.
  insert into public.shamo_user_roles(user_id, role, granted_by)
  values (:'probe_user', 'staff', 'invite_code');
  select count(*) from public.shamo_user_roles where user_id = :'probe_user';
rollback;
*/

-- 5. THE CHECK THAT MATTERS: the browser cannot write a role, and cannot mark
--    itself as sample data.
select
  coalesce(has_table_privilege('authenticated', 'public.shamo_user_roles', 'INSERT'), false)
    as auth_can_insert_role,
  coalesce(has_table_privilege('authenticated', 'public.shamo_user_roles', 'UPDATE'), false)
    as auth_can_update_role,
  has_column_privilege('authenticated', 'public.shamo_profiles', 'is_sample', 'UPDATE')
    as auth_can_update_is_sample,
  has_column_privilege('authenticated', 'public.shamo_profiles', 'display_name', 'UPDATE')
    as auth_can_update_display_name;
-- Expect: false, false, false, true.
-- The last one must stay TRUE: narrowing the grant was meant to remove a hole,
-- not to take away a capability the profile screen is entitled to.

-- 6. The signup trigger was NOT taught about roles. If this ever returns a
--    match, the invite code has stopped being the only path to staff.
select count(*) as mentions_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'shamo_private'
  and p.proname = 'handle_new_auth_user'
  and p.prosrc ilike '%role%';
-- Expect: 0.
