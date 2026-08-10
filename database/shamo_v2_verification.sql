-- Read-only verification for the Shamo v2 database setup.
-- Run each section in the Supabase SQL Editor after shamo_v2_setup.sql.

-- 1. Confirm the vector extension and its schema.
select
    extension.extname,
    namespace.nspname as extension_schema,
    extension.extversion
from pg_extension as extension
join pg_namespace as namespace
    on namespace.oid = extension.extnamespace
where extension.extname = 'vector';

-- 1b. Confirm that the schema-qualified cosine operator is callable.
-- Expected cosine_distance: 0
select
    '[1,0]'::extensions.vector(2)
    operator(extensions.<=>)
    '[1,0]'::extensions.vector(2) as cosine_distance;

-- 2. Confirm every expected table exists.
select
    table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
  and table_name like 'shamo_%'
order by table_name;

-- Expected tables:
-- shamo_ingestion_issues
-- shamo_ingestion_pages
-- shamo_ingestion_runs
-- shamo_mark_scheme_items
-- shamo_paper_documents
-- shamo_papers
-- shamo_question_assets
-- shamo_question_parts
-- shamo_question_search
-- shamo_questions

-- 3. Confirm RLS is enabled on every Shamo table.
select
    relname as table_name,
    relrowsecurity as rls_enabled
from pg_class
join pg_namespace
    on pg_namespace.oid = pg_class.relnamespace
where pg_namespace.nspname = 'public'
  and pg_class.relkind = 'r'
  and relname like 'shamo_%'
order by relname;

-- Every rls_enabled value should be true.

-- 4. Confirm required database functions exist.
select
    routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name like 'shamo_%'
order by routine_name;

-- 5. Confirm the legacy tables still exist and were not changed by this setup.
select
    relname as legacy_table,
    pg_size_pretty(pg_total_relation_size(relid)) as total_size
from pg_catalog.pg_statio_user_tables
where relname in ('documents', 'A_level Math')
order by relname;

-- 6. Check current Free Plan database usage.
select *
from public.shamo_database_usage;

-- 7. Confirm the new tables are initially empty.
select 'papers' as entity, count(*) as row_count
from public.shamo_papers
union all
select 'ingestion_runs', count(*)
from public.shamo_ingestion_runs
union all
select 'questions', count(*)
from public.shamo_questions
union all
select 'question_parts', count(*)
from public.shamo_question_parts
union all
select 'mark_scheme_items', count(*)
from public.shamo_mark_scheme_items
union all
select 'question_assets', count(*)
from public.shamo_question_assets
union all
select 'question_search', count(*)
from public.shamo_question_search;

-- 8. Safe constraint smoke test. Everything is rolled back.
begin;

insert into public.shamo_papers (
    qualification,
    syllabus_code,
    subject,
    year,
    exam_session,
    paper_variant
)
values (
    'a_level',
    '9709',
    'Mathematics',
    2025,
    'may_june',
    '12'
);

-- This invalid question number should fail if run separately:
-- insert into public.shamo_questions (
--     paper_id,
--     ingestion_run_id,
--     question_number,
--     source_page_numbers
-- )
-- values (
--     gen_random_uuid(),
--     gen_random_uuid(),
--     -1,
--     array[1]
-- );

rollback;
