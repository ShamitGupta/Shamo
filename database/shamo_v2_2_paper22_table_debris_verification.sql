-- Read-only verification for shamo_v2_2_paper22_table_debris_correction.sql.
--
-- Run after the correction. Every row must report PASS. Nothing here writes.
--
-- Target: run 1dcb0f86-1396-464d-857e-a131f31fa6a9 (9709/22 May/June 2024,
--         batch a-level-9709-test2-pilot-v1-v2.2-batch-02)

with target as (
  select id, status, review_status, extraction_summary->'paper_bundle' as bundle
    from shamo_ingestion_runs
   where id = '1dcb0f86-1396-464d-857e-a131f31fa6a9'
),
mark_rows as (
  select (q->>'question_number')::int as qn,
         (m->>'sequence_number')::int as seq,
         m->>'mark_code' as mark_code,
         coalesce((m->>'is_alternative_method')::boolean, false) as is_alt,
         coalesce((select sum(g[1]::numeric)
                     from regexp_matches(m->>'mark_code', '\*?(?:DM|DB|M|A|B)(\d+)', 'g') g), 0) as mark_value,
         m->'part_path' as part_path,
         -- Same prose test as the parser and the correction: strip mathematics,
         -- then look for a real word.
         regexp_replace(
           regexp_replace(coalesce(m->>'content_markdown','') || ' ' || coalesce(m->>'guidance_markdown',''),
                          '\$\$?[^$]*\$\$?', ' ', 'g'),
           '\\[A-Za-z]+', ' ', 'g') ~ '[A-Za-z]{3,}' as has_prose
    from target t,
         lateral jsonb_array_elements(t.bundle->'questions') q,
         lateral jsonb_array_elements(coalesce(q->'mark_scheme_items','[]'::jsonb)) m
),
printed_parts as (
  select (q->>'question_number')::int as qn, pt->'label_path' as part_path, (pt->>'marks')::numeric as printed
    from target t,
         lateral jsonb_array_elements(t.bundle->'questions') q,
         lateral jsonb_array_elements(coalesce(q->'parts','[]'::jsonb)) pt
   where pt->>'marks' is not null
),
reconciliation as (
  select pp.qn, pp.part_path, pp.printed,
         coalesce(sum(mr.mark_value) filter (where not mr.is_alt), 0) as staged
    from printed_parts pp
    left join mark_rows mr on mr.qn = pp.qn and mr.part_path = pp.part_path
   group by pp.qn, pp.part_path, pp.printed
),
sequence_shape as (
  select qn, count(*) as n, min(seq) as lo, max(seq) as hi, count(distinct seq) as distinct_seq
    from mark_rows group by qn
)
select * from (
  values
    ('run is still staged, not published',
     (select status || '/' || review_status from target),
     'awaiting_review/pending'),

    ('mark rows reduced from 62 to 59',
     (select count(*)::text from mark_rows), '59'),

    ('no codeless prose-free rows remain',
     (select count(*)::text from mark_rows where mark_code is null and not has_prose), '0'),

    -- The three removed rows were this paper's only codeless rows, so every
    -- survivor must carry a code.
    ('every surviving row carries a mark code',
     (select count(*)::text from mark_rows where mark_code is null), '0'),

    ('question 5 reduced from 14 rows to 11',
     (select count(*)::text from mark_rows where qn = 5), '11'),

    -- The whole point: 12 flagged against 9 printed in the source.
    ('alternative-flagged rows now match the printed count',
     (select count(*)::text from mark_rows where is_alt), '9'),

    ('sequence numbers are contiguous from 1 within every question',
     (select bool_and(lo = 1 and hi = n and distinct_seq = n)::text from sequence_shape), 'true'),

    -- Removing rows worth zero marks must not disturb any total.
    ('all 11 leaf parts still reconcile against their printed marks',
     (select count(*)::text from reconciliation where staged = printed), '11'),
    ('no leaf part fails reconciliation',
     (select count(*)::text from reconciliation where staged is distinct from printed), '0'),

    ('the correction recorded exactly one audit row',
     (select count(*)::text from shamo_ingestion_issues
       where ingestion_run_id = '1dcb0f86-1396-464d-857e-a131f31fa6a9'
         and issue_code = 'MARK_SCHEME_TABLE_DEBRIS_REMOVED'), '1'),

    ('this run still blocks nothing',
     (select count(*)::text from shamo_ingestion_issues
       where ingestion_run_id = '1dcb0f86-1396-464d-857e-a131f31fa6a9'
         and severity = 'blocking' and not resolved), '0'),

    -- The other five staged papers must be byte-for-byte untouched.
    ('other five batch-2 papers still hold 389 mark rows',
     (select count(*)::text
        from shamo_ingestion_runs r,
             lateral jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
             lateral jsonb_array_elements(coalesce(q->'mark_scheme_items','[]'::jsonb)) m
       where r.idempotency_key like '%v2.2-batch-02%'
         and r.id <> '1dcb0f86-1396-464d-857e-a131f31fa6a9'), '389'),

    ('published content is untouched',
     (select count(*)::text from shamo_mark_scheme_items), '509')
) as checks(check_name, actual, expected)
order by (actual is distinct from expected) desc, check_name;
