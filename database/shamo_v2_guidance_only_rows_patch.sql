-- Shamo v2: permit official mark-scheme rows that contain Guidance but have
-- blank Answer and Marks cells.
--
-- Run this entire file once in the Supabase SQL Editor as the postgres role.
-- It changes only a check constraint and does not publish or delete data.

begin;

alter table public.shamo_mark_scheme_items
    drop constraint if exists
        shamo_mark_scheme_items_content_markdown_check;

do $$
begin
    if not exists (
        select 1
        from pg_catalog.pg_constraint
        where conname =
            'shamo_mark_scheme_items_content_or_guidance_check'
          and conrelid =
            'public.shamo_mark_scheme_items'::regclass
    ) then
        alter table public.shamo_mark_scheme_items
            add constraint
                shamo_mark_scheme_items_content_or_guidance_check
            check (
                btrim(content_markdown) <> ''
                or btrim(guidance_markdown) <> ''
            );
    end if;
end;
$$;

commit;

-- Verification: should return one row with constraint_valid = true.
select
    constraint_name,
    constraint_type,
    enforced = 'YES' as constraint_valid
from information_schema.table_constraints
where table_schema = 'public'
  and table_name = 'shamo_mark_scheme_items'
  and constraint_name =
      'shamo_mark_scheme_items_content_or_guidance_check';
