begin;

-- Shamo v2.10: teacher (staff) accounts, and the sample-data marker.
--
-- Additive: one new table, one new column, one tightened column-level grant.
-- Nothing here touches published content or any existing row's meaning.
--
-- Three decisions are deliberate and should be argued with before anyone
-- simplifies them:
--
-- 1. THE ROLE IS NOT IN shamo_profiles. That table grants `update` to
--    `authenticated` with an own-row policy, which is exactly right for a
--    display name and exactly wrong for an authorization field: a student could
--    promote themselves with one PATCH. Keeping the role in its own table, with
--    no browser privileges at all, is the same reasoning that produced
--    shamo_user_entitlements in v2.4.
--
-- 2. THE ROLE IS NOT SEEDED FROM SIGNUP METADATA. shamo_private
--    .handle_new_auth_user() is deliberately left unmodified. It reads
--    raw_user_meta_data, and raw_user_meta_data is writable from the browser
--    via supabase.auth.signUp()/updateUser() -- if a role could ride in on it,
--    the invite code guarding staff signup would be decorative. The ONLY path
--    to a staff row is the backend's POST /me/claim-staff-role, which checks
--    the invite code server-side with the service-role key.
--
-- 3. ABSENCE OF A ROW MEANS STUDENT. There is no default 'student' row to
--    write, so a signup that fails halfway cannot leave a half-teacher, and
--    revoking staff is a delete rather than a state machine.
--
-- INTERIM ACCESS MODEL, recorded here because the table itself cannot say it:
-- any account holding the invite code can read EVERY student's performance
-- data. That is a deliberate pre-pilot shortcut. The intended model is
-- admin-verified schools with students mapped to a school and teachers scoped
-- to their own -- see PENDING.md P1-6.

create table if not exists public.shamo_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null,
  granted_by text not null,
  granted_at timestamptz not null default now(),
  notes text not null default '',
  constraint shamo_user_roles_role_known
    check (role in ('student', 'staff')),
  constraint shamo_user_roles_granted_by_known
    check (granted_by in ('invite_code', 'manual_admin'))
);

comment on table public.shamo_user_roles is
  'Which surface an account belongs to. Absence of a row means student. Only the backend writes here; the browser has no privileges, because this is an authorization field rather than a profile field.';
comment on column public.shamo_user_roles.role is
  'student or staff. A staff account reads other students'' performance data and never their conversations.';
comment on column public.shamo_user_roles.granted_by is
  'How this role was obtained: invite_code (self-serve teacher signup) or manual_admin (granted directly in the database).';

create index if not exists shamo_user_roles_role_idx
  on public.shamo_user_roles(role);

alter table public.shamo_user_roles enable row level security;

revoke all on table public.shamo_user_roles from anon, authenticated;
grant select, insert, update, delete on table public.shamo_user_roles to service_role;

-- Defence in depth only. The browser has no table privileges, so nothing can
-- reach this policy today; it exists so that a future direct-access path reads
-- one row rather than the roster.
drop policy if exists "Users can read own Shamo role" on public.shamo_user_roles;
create policy "Users can read own Shamo role"
on public.shamo_user_roles
for select
to authenticated
using ((select auth.uid()) = user_id);

-- The sample-data marker.
--
-- The teacher dashboard is unusable with an empty roster, so a demonstration
-- cohort of invented students lives alongside real ones. Fabricated rows shown
-- to a reviewer must never read as real children, so every surface that names a
-- student reads this column and labels it.
alter table public.shamo_profiles
  add column if not exists is_sample boolean not null default false;

comment on column public.shamo_profiles.is_sample is
  'True for demonstration accounts seeded by backend_v2/tests/demo_cohort.py. Every view that names a student must label these visibly. Not writable from the browser -- see the column-level grant below.';

-- shamo_profiles granted `update` at TABLE level in v2.4, which covers every
-- column including any added later. That is how is_sample would otherwise
-- become self-settable: a student could mark themselves sample data. Narrow the
-- grant to the two fields a user genuinely owns. No application code writes
-- this table from the browser today (only the backend does, with the service
-- role), so this removes a latent hole rather than a capability in use.
revoke update on table public.shamo_profiles from authenticated;
grant update (display_name, grade) on table public.shamo_profiles to authenticated;

commit;
