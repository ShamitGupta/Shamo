-- Verification for shamo_v2_7_conversations_and_attempts_patch.sql.
--
-- Read-only except for section 3, which writes and then removes its own probe
-- rows inside one transaction. Run section 3 against a synthetic user only --
-- backend_v2/tests/sprint_fixtures.py creates one.
--
-- Section 3 matters more than it looks. A CHECK constraint that never fires is
-- indistinguishable from a correct one until the day bad data arrives, and this
-- project has already shipped a constraint that silently disagreed with its own
-- validator (see shamo_v2_5_parent_part_prompt_constraint_patch.sql). Asserting
-- that each constraint REJECTS what it is supposed to reject is the only way to
-- know it works.

-- 1. Structure: the three tables exist, RLS is on, the browser has no direct
--    privileges, and service_role can write.
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
  and c.relname in ('shamo_conversations', 'shamo_conversation_turns', 'shamo_attempts')
order by c.relname;
-- Expect: 3 rows, rls_enabled true, policies 1, anon_select false,
-- auth_select false, service_insert true.

-- 2. The foreign keys that carry the design decisions.
select conrelid::regclass::text as child_table,
       conname,
       confrelid::regclass::text as parent_table,
       confdeltype as on_delete  -- 'c' = cascade, 'n' = set null
from pg_constraint
where contype = 'f'
  and conrelid::regclass::text in
      ('shamo_conversation_turns', 'shamo_attempts')
order by child_table, conname;
-- Expect in particular:
--   shamo_conversation_turns -> shamo_conversations  = 'c' (cascade)
--   shamo_attempts -> shamo_conversation_turns       = 'n' (set null)
--   shamo_attempts -> shamo_questions                = 'n' (set null)
-- The two 'n' entries are the load-bearing ones: a deleted conversation, or a
-- republished paper, must not destroy a student's mark record.

-- 3. Behaviour: every constraint rejects what it exists to reject, and an
--    attempt outlives the conversation it happened in.
--    Replace the user id with a synthetic user's id before running.
do $$
declare
  u uuid := '00000000-0000-0000-0000-000000000000';  -- synthetic user id
  conv uuid;
  turn uuid;
  att uuid;
  surviving uuid;
begin
  if not exists (select 1 from auth.users where id = u) then
    raise exception 'Set u to a synthetic user id before running section 3';
  end if;

  insert into public.shamo_conversations (user_id, title) values (u, 'Constraint probe')
    returning id into conv;
  insert into public.shamo_conversation_turns
    (conversation_id, user_id, role, content, sort_order,
     qualification, syllabus_code, year, exam_session, paper_variant, question_number)
  values (conv, u, 'user', 'my working', 0,
     'a_level', '9709', 2025, 'oct_nov', '12', 4)
    returning id into turn;
  insert into public.shamo_attempts
    (user_id, qualification, syllabus_code, year, exam_session, paper_variant,
     question_number, conversation_turn_id, attempt_text, marks_earned,
     marks_available, outcome_source)
  values (u, 'a_level', '9709', 2025, 'oct_nov', '12', 4, turn, 'x = 3', 2, 5, 'extractor')
    returning id into att;

  begin
    insert into public.shamo_conversations (user_id, title) values (u, '   ');
    raise exception 'CONSTRAINT GAP: blank conversation title was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.shamo_conversation_turns (conversation_id, user_id, role, sort_order)
    values (conv, u, 'system', 99);
    raise exception 'CONSTRAINT GAP: unknown turn role was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.shamo_conversation_turns
      (conversation_id, user_id, role, sort_order, year, paper_variant)
    values (conv, u, 'user', 98, 2025, '12');
    raise exception 'CONSTRAINT GAP: partial question reference was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.shamo_conversation_turns (conversation_id, user_id, role, sort_order)
    values (conv, u, 'user', 0);
    raise exception 'CONSTRAINT GAP: duplicate sort_order in one thread was accepted';
  exception when unique_violation then null; end;

  begin
    insert into public.shamo_attempts
      (user_id, qualification, syllabus_code, year, exam_session, paper_variant,
       question_number, attempt_text, marks_earned, marks_available, outcome_source)
    values (u, 'a_level', '9709', 2025, 'oct_nov', '12', 4, 'x', 9, 5, 'extractor');
    raise exception 'CONSTRAINT GAP: marks_earned above marks_available was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.shamo_attempts
      (user_id, qualification, syllabus_code, year, exam_session, paper_variant,
       question_number, attempt_text, outcome_source)
    values (u, 'a_level', '9709', 2025, 'oct_nov', '12', 4, 'x', 'extractor');
    raise exception 'CONSTRAINT GAP: extractor outcome with no marks was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.shamo_attempts
      (user_id, qualification, syllabus_code, year, exam_session, paper_variant,
       question_number, attempt_text, marks_earned, marks_available, outcome_source)
    values (u, 'a_level', '9709', 2025, 'oct_nov', '12', 4, 'x', 2, 5, 'unavailable');
    raise exception 'CONSTRAINT GAP: unavailable outcome carrying marks was accepted';
  exception when check_violation then null; end;

  begin
    insert into public.shamo_attempts
      (user_id, qualification, syllabus_code, year, exam_session, paper_variant,
       question_number, attempt_text, outcome_source)
    values (u, 'a_level', '9709', 2025, 'oct_nov', '12', 4, '   ', 'unavailable');
    raise exception 'CONSTRAINT GAP: blank attempt text was accepted';
  exception when check_violation then null; end;

  delete from public.shamo_conversations where id = conv;

  if not exists (select 1 from public.shamo_attempts where id = att) then
    raise exception 'DESIGN GAP: deleting a conversation destroyed the attempt record';
  end if;
  select conversation_turn_id into surviving from public.shamo_attempts where id = att;
  if surviving is not null then
    raise exception 'DESIGN GAP: attempt still points at a deleted turn';
  end if;
  if exists (select 1 from public.shamo_conversation_turns where id = turn) then
    raise exception 'DESIGN GAP: turns outlived their deleted conversation';
  end if;

  delete from public.shamo_attempts where id = att;
  raise notice 'all constraint and cascade probes passed';
end $$;
-- Result recorded 15 September 2026: all eleven probes passed against synthetic
-- user shamo-sprint-synthetic-a, and the tables were left at zero rows.

-- 4. No rows left behind.
select
  (select count(*) from public.shamo_conversations) as conversations,
  (select count(*) from public.shamo_conversation_turns) as turns,
  (select count(*) from public.shamo_attempts) as attempts;
