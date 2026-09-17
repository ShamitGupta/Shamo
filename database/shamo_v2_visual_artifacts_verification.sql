-- Read-only verification for database/shamo_v2_visual_artifacts_patch.sql.

with checks as (
    select
        '1. visual artifact table exists' as check_name,
        to_regclass('public.shamo_visual_artifacts') is not null as passed,
        coalesce(to_regclass('public.shamo_visual_artifacts')::text, 'missing') as detail

    union all

    select
        '2. row level security is enabled',
        coalesce(
            (
                select c.relrowsecurity
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public'
                  and c.relname = 'shamo_visual_artifacts'
            ),
            false
        ),
        coalesce(
            (
                select c.relrowsecurity::text
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public'
                  and c.relname = 'shamo_visual_artifacts'
            ),
            'missing'
        )

    union all

    select
        '3. anon has no table privileges',
        not (
            has_table_privilege('anon', 'public.shamo_visual_artifacts', 'select')
            or has_table_privilege('anon', 'public.shamo_visual_artifacts', 'insert')
            or has_table_privilege('anon', 'public.shamo_visual_artifacts', 'update')
            or has_table_privilege('anon', 'public.shamo_visual_artifacts', 'delete')
        ),
        'anon direct privileges checked'

    union all

    select
        '4. authenticated has no table privileges',
        not (
            has_table_privilege('authenticated', 'public.shamo_visual_artifacts', 'select')
            or has_table_privilege('authenticated', 'public.shamo_visual_artifacts', 'insert')
            or has_table_privilege('authenticated', 'public.shamo_visual_artifacts', 'update')
            or has_table_privilege('authenticated', 'public.shamo_visual_artifacts', 'delete')
        ),
        'authenticated direct privileges checked'

    union all

    select
        '5. service_role can use the table',
        has_table_privilege('service_role', 'public.shamo_visual_artifacts', 'select')
        and has_table_privilege('service_role', 'public.shamo_visual_artifacts', 'insert')
        and has_table_privilege('service_role', 'public.shamo_visual_artifacts', 'update')
        and has_table_privilege('service_role', 'public.shamo_visual_artifacts', 'delete'),
        'service_role privileges checked'

    union all

    select
        '6. cache index exists',
        to_regclass('public.shamo_visual_artifacts_question_cache_idx') is not null,
        coalesce(to_regclass('public.shamo_visual_artifacts_question_cache_idx')::text, 'missing')

    union all

    select
        '7. review index exists',
        to_regclass('public.shamo_visual_artifacts_review_idx') is not null,
        coalesce(to_regclass('public.shamo_visual_artifacts_review_idx')::text, 'missing')

    union all

    select
        '8. no public policies exist',
        not exists (
            select 1
            from pg_policies
            where schemaname = 'public'
              and tablename = 'shamo_visual_artifacts'
              and ('anon' = any(roles) or 'authenticated' = any(roles) or 'public' = any(roles))
        ),
        'public policy scan complete'
)
select
    check_name,
    case when passed then 'PASS' else 'FAIL' end as result,
    detail
from checks
order by check_name;
