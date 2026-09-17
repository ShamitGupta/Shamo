begin;

-- Shamo v2.4: Supabase Auth profiles, trusted access tiers, and legacy lock-down.
--
-- User-facing identity lives in auth.users. Shamo product access lives here,
-- not in user-editable auth user_metadata.

create table if not exists public.shamo_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  grade text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shamo_profiles_display_name_not_blank
    check (display_name is null or btrim(display_name) <> ''),
  constraint shamo_profiles_grade_known
    check (grade is null or grade in ('IGCSE', 'A-levels'))
);

comment on table public.shamo_profiles is
  'User-owned Shamo profile fields. Authorization tiers are deliberately not stored here.';
comment on column public.shamo_profiles.display_name is
  'Display name seeded from signup metadata/OAuth profile and user-editable later.';
comment on column public.shamo_profiles.grade is
  'Student-selected study level; not an authorization field.';

create table if not exists public.shamo_user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_type text not null,
  source text not null,
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  external_reference text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shamo_user_entitlements_type_known
    check (entitlement_type in ('premium', 'shamo_student')),
  constraint shamo_user_entitlements_source_known
    check (source in ('manual_admin', 'stripe', 'system')),
  constraint shamo_user_entitlements_status_known
    check (status in ('active', 'inactive', 'revoked', 'expired', 'canceled')),
  constraint shamo_user_entitlements_window_valid
    check (ends_at is null or ends_at > starts_at),
  constraint shamo_user_entitlements_source_matches_type
    check (
      (entitlement_type = 'premium' and source in ('stripe', 'system'))
      or (entitlement_type = 'shamo_student' and source in ('manual_admin', 'system'))
    )
);

comment on table public.shamo_user_entitlements is
  'Trusted access grants. Free is derived from authentication; premium will be set by Stripe later; shamo_student is manually granted by Admin.';

create index if not exists shamo_profiles_updated_at_idx
  on public.shamo_profiles(updated_at);

create index if not exists shamo_user_entitlements_user_status_idx
  on public.shamo_user_entitlements(user_id, status, entitlement_type);

create unique index if not exists shamo_user_entitlements_one_active_type_idx
  on public.shamo_user_entitlements(user_id, entitlement_type)
  where status = 'active';

drop trigger if exists shamo_profiles_set_updated_at on public.shamo_profiles;
create trigger shamo_profiles_set_updated_at
before update on public.shamo_profiles
for each row execute function shamo_private.set_updated_at();

drop trigger if exists shamo_user_entitlements_set_updated_at on public.shamo_user_entitlements;
create trigger shamo_user_entitlements_set_updated_at
before update on public.shamo_user_entitlements
for each row execute function shamo_private.set_updated_at();

create or replace function shamo_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_name text;
  profile_grade text;
begin
  profile_name := nullif(
    btrim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      new.email
    )),
    ''
  );

  profile_grade := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'grade', '')), '');
  if profile_grade not in ('IGCSE', 'A-levels') then
    profile_grade := null;
  end if;

  insert into public.shamo_profiles(user_id, display_name, grade)
  values (new.id, profile_name, profile_grade)
  on conflict (user_id) do update
    set display_name = coalesce(public.shamo_profiles.display_name, excluded.display_name),
        grade = coalesce(public.shamo_profiles.grade, excluded.grade),
        updated_at = now();

  return new;
end;
$$;

revoke execute on function shamo_private.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_shamo_profile on auth.users;
create trigger on_auth_user_created_shamo_profile
after insert on auth.users
for each row execute function shamo_private.handle_new_auth_user();

insert into public.shamo_profiles(user_id, display_name, grade)
select
  u.id,
  nullif(btrim(coalesce(
    u.raw_user_meta_data ->> 'display_name',
    u.raw_user_meta_data ->> 'name',
    u.raw_user_meta_data ->> 'full_name',
    u.email
  )), ''),
  case
    when u.raw_user_meta_data ->> 'grade' in ('IGCSE', 'A-levels')
      then u.raw_user_meta_data ->> 'grade'
    else null
  end
from auth.users u
on conflict (user_id) do nothing;

alter table public.shamo_profiles enable row level security;
alter table public.shamo_user_entitlements enable row level security;

revoke all on table public.shamo_profiles from anon, authenticated;
revoke all on table public.shamo_user_entitlements from anon, authenticated;
grant select, update on table public.shamo_profiles to authenticated;

drop policy if exists "Users can read own Shamo profile" on public.shamo_profiles;
create policy "Users can read own Shamo profile"
on public.shamo_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can update own Shamo profile" on public.shamo_profiles;
create policy "Users can update own Shamo profile"
on public.shamo_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- No anon/authenticated policies for shamo_user_entitlements by design.
-- Backend/service-role code reads this table and computes the effective tier.

grant select, insert, update, delete on table public.shamo_profiles to service_role;
grant select, insert, update, delete on table public.shamo_user_entitlements to service_role;

-- Close the legacy public-write hole before exposing a Supabase browser key.
revoke all on table public.documents from anon, authenticated;
revoke all on table public."A_level Math" from anon, authenticated;
alter table public.documents enable row level security;
alter table public."A_level Math" enable row level security;

-- Keep the old function for compatibility history, but remove public execution
-- and give it a fixed search_path so the advisor no longer flags it.
alter function public.match_documents(vector, integer, jsonb)
  set search_path = public, extensions;
revoke execute on function public.match_documents(vector, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.match_documents(vector, integer, jsonb)
  to service_role;

commit;
