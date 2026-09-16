begin;

-- Shamo v2.11: the class roster a teacher sees.
--
-- Additive: one function, no schema change. Reads what students have DONE --
-- how much, how recently, how they scored -- and deliberately never reads what
-- they SAID.
--
-- Four decisions are deliberate:
--
-- 1. IT SELECTS NO CONVERSATION CONTENT. Not shamo_conversation_turns.content,
--    not shamo_conversations.title. Threads are counted, never read. A title is
--    student-authored free text, so a thread named "i have no idea what im
--    doing" would otherwise appear in a teacher's roster; the tutoring itself
--    is a student asking for help, which is not work handed in. If a future
--    column here needs either, that is a policy change and should be argued
--    for, not added quietly.
--
-- 2. THE WEAKEST TOPIC COMES FROM shamo_get_topic_weakness, NOT FROM A SECOND
--    QUERY. Recomputing "weak" here would create two definitions of it that
--    drift, and a teacher and their student would eventually be shown
--    different answers about the same work. The lateral call is slower than
--    inlining the aggregate and is worth it for that reason alone.
--
-- 3. security definer, BECAUSE auth.users IS THE ONLY SOURCE OF AN EMAIL.
--    service_role genuinely cannot read auth.users (verified:
--    has_table_privilege('service_role','auth.users','SELECT') is false), so
--    this function is the narrow window onto it. It exposes exactly one column
--    from that table -- the email a teacher needs to tell two students apart --
--    takes no user-supplied filter, and is executable by service_role alone.
--
-- 4. STAFF ARE NOT STUDENTS. Anyone holding a staff role is excluded, so a
--    teacher does not appear in their own class list. Absence of a role row
--    means student, matching v2.10.
--
-- INTERIM ACCESS MODEL: this function returns EVERY student in the database,
-- because school scoping does not exist yet. That is deliberate and recorded in
-- PENDING.md P1-6. When schools land, the filter belongs here.

create or replace function public.shamo_get_student_roster(
  p_limit integer default 200
)
returns table (
  user_id uuid,
  display_name text,
  email text,
  is_sample boolean,
  conversations integer,
  turns integer,
  attempts integer,
  scored_attempts integer,
  mark_ratio numeric,
  weakest_topic text,
  last_active_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounded as (
    select greatest(1, least(coalesce(p_limit, 200), 500)) as row_limit
  ),
  students as (
    select u.id as user_id, u.email::text as email
    from auth.users u
    left join public.shamo_user_roles r on r.user_id = u.id
    where coalesce(r.role, 'student') = 'student'
  ),
  thread_counts as (
    select c.user_id,
           count(*)::integer as conversations,
           max(c.last_active_at) as last_active_at
    from public.shamo_conversations c
    where c.deleted_at is null
    group by c.user_id
  ),
  -- Counted from the turns table rather than shamo_conversations.turn_count,
  -- which v2.7 documents as an advisory display counter. A teacher's figure
  -- should come from the rows themselves.
  turn_counts as (
    select t.user_id, count(*)::integer as turns
    from public.shamo_conversation_turns t
    group by t.user_id
  ),
  attempt_stats as (
    select a.user_id,
           count(*)::integer as attempts,
           count(*) filter (where a.outcome_source = 'extractor')::integer as scored_attempts,
           coalesce(sum(a.marks_earned) filter (where a.outcome_source = 'extractor'), 0) as marks_earned,
           coalesce(sum(a.marks_available) filter (where a.outcome_source = 'extractor'), 0) as marks_available,
           max(a.created_at) as last_attempt_at
    from public.shamo_attempts a
    where a.deleted_at is null
    group by a.user_id
  )
  select
    s.user_id,
    p.display_name,
    s.email,
    coalesce(p.is_sample, false) as is_sample,
    coalesce(tc.conversations, 0) as conversations,
    coalesce(uc.turns, 0) as turns,
    coalesce(ast.attempts, 0) as attempts,
    coalesce(ast.scored_attempts, 0) as scored_attempts,
    -- Null, not zero, when nothing has been scored. A zero would sort like the
    -- worst student in the class and read like a judgement of someone who has
    -- simply not been marked yet.
    case when coalesce(ast.marks_available, 0) > 0
      then round(ast.marks_earned::numeric / ast.marks_available, 4)
      else null end as mark_ratio,
    w.main_topic as weakest_topic,
    -- greatest() ignores nulls here, so a student who has attempted questions
    -- without saving a thread still shows a real date.
    greatest(tc.last_active_at, ast.last_attempt_at) as last_active_at
  from students s
  left join public.shamo_profiles p on p.user_id = s.user_id
  left join thread_counts tc on tc.user_id = s.user_id
  left join turn_counts uc on uc.user_id = s.user_id
  left join attempt_stats ast on ast.user_id = s.user_id
  left join lateral (
    select t.main_topic
    from public.shamo_get_topic_weakness(s.user_id, 3, 5) t
    where t.has_enough_evidence
    limit 1
  ) w on true
  order by greatest(tc.last_active_at, ast.last_attempt_at) desc nulls last,
           s.email
  limit (select row_limit from bounded);
$$;

comment on function public.shamo_get_student_roster(integer) is
  'Class roster for a staff account: usage, attempt counts, overall mark ratio and weakest topic per student. Reads no conversation content or thread titles by design. security definer because auth.users holds the email and service_role cannot read it; executable by service_role only. Returns every student in the database -- school scoping is not built yet (PENDING.md P1-6).';

revoke execute on function public.shamo_get_student_roster(integer)
  from public, anon, authenticated;
grant execute on function public.shamo_get_student_roster(integer)
  to service_role;

commit;
