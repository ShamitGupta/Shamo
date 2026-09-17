-- Remove embedded table debris from the staged 9709/22 May/June 2024 bundle.
--
-- WHAT AND WHY
-- ------------
-- Question 5(a) prints an Alternative Method solved by synthetic division. The
-- working is laid out as a small numeric grid INSIDE the Answer cell:
--
--     | $$-2/3$$ | 9 | 18 | 5 | 4 |
--     |  |  | $$-6$$ | 8 | $$-2$$ |
--     |  | 9 | 12 | $$-3$$ | 6 |
--
-- Three 5-column rows inside a 4-column mark table. They carry no mark code and
-- no prose, because they are layout, not awards -- but they were stored as mark
-- rows. Two consequences:
--
--   * Question 5 reported 12 alternative-method rows against 9 printed.
--   * A student would be shown "-2/3 | 9 | 18" as a mark-scheme row.
--
-- Because each awards nothing, per-part reconciliation stayed balanced and never
-- saw them. That is why this needed its own rule rather than better arithmetic.
--
-- THE CHECK CAME FIRST, as the standing rule requires. The parser now drops
-- codeless prose-free rows (workflows/n8n/lib/mark_scheme_parser.mjs, guarded by
-- three unit tests) and MARK_ROW_WITHOUT_CODE_OR_PROSE blocks any that survive
-- the model-fallback path. This file only repairs the bundle that was staged
-- before that fix landed; it does not prevent recurrence, the parser does.
--
-- A codeless row is NOT automatically debris. 9709/62 Q7(b) has a genuinely
-- blank Marks cell and real special-case guidance, and must survive. The
-- discriminator is prose: at least one three-letter word once mathematics is
-- stripped. That condition is written identically here and in the parser.
--
-- SAFETY
-- ------
--   * One run, locked FOR UPDATE, asserted by id before anything changes.
--   * Every expected count asserted before and after; any mismatch raises and
--     rolls the whole thing back.
--   * Staged content only. This run is `awaiting_review` and has published no
--     normalized rows, so nothing student-facing is touched.
--   * Verify with database/shamo_v2_2_paper22_table_debris_verification.sql.
--
-- Target: run 1dcb0f86-1396-464d-857e-a131f31fa6a9
--         batch a-level-9709-test2-pilot-v1-v2.2-batch-02
-- Expected: 62 mark rows -> 59, Q5 14 rows -> 11, debris 3 -> 0.

begin;

do $$
declare
  v_run_id uuid := '1dcb0f86-1396-464d-857e-a131f31fa6a9';
  -- Note on the prose test used throughout: mathematics is stripped before it
  -- runs, or `\frac` and `\sqrt` would read as words and every equation would
  -- look like prose.
  v_status text;
  v_review text;
  v_before_total int;
  v_before_debris int;
  v_before_q5 int;
  v_after_total int;
  v_after_debris int;
  v_after_q5 int;
  v_questions jsonb;
begin
  -- ---- 1. Lock and assert the target ------------------------------------
  select status, review_status
    into v_status, v_review
    from shamo_ingestion_runs
   where id = v_run_id
     for update;

  if not found then
    raise exception 'Run % not found.', v_run_id;
  end if;
  if v_status <> 'awaiting_review' or v_review <> 'pending' then
    raise exception 'Run % is %/% -- expected awaiting_review/pending. Refusing to edit a run that has moved on.',
      v_run_id, v_status, v_review;
  end if;
  if exists (select 1 from shamo_questions q
              join shamo_papers p on p.id = q.paper_id
             where p.current_ingestion_run_id = v_run_id) then
    raise exception 'Run % already has published questions. Refusing to edit staged content behind published rows.', v_run_id;
  end if;

  -- ---- 2. Measure the current state --------------------------------------
  select count(*),
         count(*) filter (
           where m->>'mark_code' is null
             and regexp_replace(
                   regexp_replace(coalesce(m->>'content_markdown','') || ' ' || coalesce(m->>'guidance_markdown',''),
                                  '\$\$?[^$]*\$\$?', ' ', 'g'),
                   '\\[A-Za-z]+', ' ', 'g') !~ '[A-Za-z]{3,}'),
         count(*) filter (where (q->>'question_number')::int = 5)
    into v_before_total, v_before_debris, v_before_q5
    from shamo_ingestion_runs r,
         lateral jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
         lateral jsonb_array_elements(coalesce(q->'mark_scheme_items','[]'::jsonb)) m
   where r.id = v_run_id;

  if v_before_total <> 62 or v_before_debris <> 3 or v_before_q5 <> 14 then
    raise exception 'Unexpected starting state: % mark rows, % debris, % on Q5 (expected 62/3/14). Refusing to guess.',
      v_before_total, v_before_debris, v_before_q5;
  end if;

  -- ---- 3. Rebuild the questions array ------------------------------------
  -- Drop the debris rows, then renumber sequence_number within each question so
  -- the stored order stays contiguous rather than jumping 4 -> 8.
  -- WITH ORDINALITY rather than row_number() over (): array position is the
  -- thing being preserved, so take it from the set-returning function itself
  -- instead of relying on evaluation order.
  with questions as (
    select q.qidx::int as qidx, q.question
      from shamo_ingestion_runs r,
           lateral jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions')
             with ordinality as q(question, qidx)
     where r.id = v_run_id
  ),
  items as (
    select qs.qidx,
           m.value as item,
           (m.value->>'sequence_number')::int as old_seq,
           (m.value->>'mark_code' is not null)
             or regexp_replace(
                  regexp_replace(coalesce(m.value->>'content_markdown','') || ' ' || coalesce(m.value->>'guidance_markdown',''),
                                 '\$\$?[^$]*\$\$?', ' ', 'g'),
                  '\\[A-Za-z]+', ' ', 'g') ~ '[A-Za-z]{3,}' as keep
      from questions qs,
           lateral jsonb_array_elements(coalesce(qs.question->'mark_scheme_items','[]'::jsonb)) m
  ),
  renumbered as (
    select qidx, old_seq,
           jsonb_set(item, '{sequence_number}',
                     to_jsonb(row_number() over (partition by qidx order by old_seq))) as item
      from items
     where keep
  ),
  regrouped as (
    select qidx, jsonb_agg(item order by old_seq) as mark_items
      from renumbered
     group by qidx
  )
  select jsonb_agg(
           case
             when jsonb_exists(qs.question, 'mark_scheme_items')
               then jsonb_set(qs.question, '{mark_scheme_items}', coalesce(rg.mark_items, '[]'::jsonb))
             else qs.question
           end
           order by qs.qidx)
    into v_questions
    from questions qs
    left join regrouped rg on rg.qidx = qs.qidx;

  if v_questions is null or jsonb_array_length(v_questions) <> 7 then
    raise exception 'Rebuilt bundle has % questions, expected 7.', coalesce(jsonb_array_length(v_questions), -1);
  end if;

  update shamo_ingestion_runs
     set extraction_summary = jsonb_set(extraction_summary, '{paper_bundle,questions}', v_questions),
         updated_at = now()
   where id = v_run_id;

  -- ---- 4. Assert the result ----------------------------------------------
  select count(*),
         count(*) filter (
           where m->>'mark_code' is null
             and regexp_replace(
                   regexp_replace(coalesce(m->>'content_markdown','') || ' ' || coalesce(m->>'guidance_markdown',''),
                                  '\$\$?[^$]*\$\$?', ' ', 'g'),
                   '\\[A-Za-z]+', ' ', 'g') !~ '[A-Za-z]{3,}'),
         count(*) filter (where (q->>'question_number')::int = 5)
    into v_after_total, v_after_debris, v_after_q5
    from shamo_ingestion_runs r,
         lateral jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
         lateral jsonb_array_elements(coalesce(q->'mark_scheme_items','[]'::jsonb)) m
   where r.id = v_run_id;

  if v_after_total <> 59 or v_after_debris <> 0 or v_after_q5 <> 11 then
    raise exception 'Unexpected result: % mark rows, % debris, % on Q5 (expected 59/0/11).',
      v_after_total, v_after_debris, v_after_q5;
  end if;

  -- Marks must be untouched: every removed row awarded nothing, and these three
  -- were the paper's only codeless rows, so all 59 survivors carry a code.
  if (select count(*) from shamo_ingestion_runs r,
             lateral jsonb_array_elements(r.extraction_summary->'paper_bundle'->'questions') q,
             lateral jsonb_array_elements(coalesce(q->'mark_scheme_items','[]'::jsonb)) m
       where r.id = v_run_id and m->>'mark_code' is not null) <> 59 then
    raise exception 'Coded mark rows changed. Expected all 59 survivors to carry a mark code.';
  end if;

  -- ---- 5. Audit ------------------------------------------------------------
  insert into shamo_ingestion_issues
    (ingestion_run_id, severity, issue_code, document_type, question_number, part_path,
     message, resolved, resolution_note, resolved_at)
  values
    (v_run_id, 'warning', 'MARK_SCHEME_TABLE_DEBRIS_REMOVED', 'mark_scheme', 5, array['a'],
     'Removed 3 codeless prose-free rows from Q5(a): the printed synthetic-division working grid, ' ||
     'stored as mark rows because it sits inside the Answer cell as a 5-column sub-table.',
     true,
     'Corrected post-staging by database/shamo_v2_2_paper22_table_debris_correction.sql. ' ||
     'Recurrence is prevented by the parser rule and MARK_ROW_WITHOUT_CODE_OR_PROSE, not by this file.',
     now());

  raise notice 'Paper 22 corrected: % -> % mark rows, Q5 % -> %, debris % -> 0.',
    v_before_total, v_after_total, v_before_q5, v_after_q5, v_before_debris;
end;
$$;

commit;
