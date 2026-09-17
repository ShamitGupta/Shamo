-- Verification for shamo_v2_12_class_insights_patch.sql. Read-only.
--
-- Section 5 is the one that matters most. The rest confirm the three functions
-- exist and return sensible rows; section 5 confirms the class summary agrees
-- with the per-student ranking it is built from, which is the whole reason it
-- calls shamo_get_topic_weakness instead of re-aggregating the attempts.

-- 1. All three exist, are security INVOKER (unlike the v2.11 roster -- these
--    read no auth.users column), have a pinned search_path, and are callable by
--    service_role alone.
select p.proname,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_can_call,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_call,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'shamo_get_class_topic_summary',
    'shamo_get_mark_code_profile',
    'shamo_get_activity_by_week'
  )
order by p.proname;
-- Expect: three rows. security_definer false, settings {search_path=""},
-- service_can_call true, auth_can_call false, anon_can_call false.

-- 2. THE PRIVACY BOUNDARY: none of them touches a conversation at all.
select p.proname,
       (p.prosrc ilike '%shamo_conversation%') as reads_conversations,
       (p.prosrc ilike '%.content%') as reads_turn_content,
       (p.prosrc ilike '%title%') as reads_thread_title
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'shamo_get_class_topic_summary',
    'shamo_get_mark_code_profile',
    'shamo_get_activity_by_week'
  )
order by p.proname;
-- Expect: false, false, false on every row. Ever.

-- 3. They return rows, and the numbers are real rather than defaulted.
select * from public.shamo_get_class_topic_summary(3, 20);
-- Expect: one row per topic anyone has attempted. class_mark_ratio NULL (not 0)
-- where nothing has been scored. has_enough_evidence false where fewer than two
-- students have enough attempts behind them -- those rows sort last.
-- students_struggling <= students_with_evidence <= students_attempting on every
-- row; if that ever fails, the filters have drifted apart.

select * from public.shamo_get_mark_code_profile();          -- the class
select * from public.shamo_get_activity_by_week(null, 8);    -- the class
-- Expect: mark-code rows ordered M, A, B (then 'other' if it ever appears), each
-- with earned + missed = total. Activity: exactly 8 rows, consecutive Mondays,
-- ending with the current week, zeros included rather than omitted.

-- 4. THE CLASSIFIER LEAVES NOTHING BEHIND. The M/A/B split is only meaningful
--    if every code lands in a class, so check it against the whole published
--    corpus rather than against the handful of codes students have hit so far.
select coalesce(substring(upper(mark_code) from '[MAB]'), 'UNCLASSIFIED') as code_class,
       count(*) as n
from public.shamo_mark_scheme_items
where mark_code is not null
group by 1
order by n desc;
-- Expect: M, A and B only. A non-zero UNCLASSIFIED row means a code shape exists
-- that the profile function will bucket as 'other' -- not a failure, but it
-- should be looked at rather than left to accumulate silently.

-- 5. ONE DEFINITION OF "WEAK". For a topic in the class summary, the student
--    counts must equal what the per-student rankings say. Replace the topic
--    name with one that section 3 actually returned.
/*
with per_student as (
  select s.user_id, t.*
  from (
    select distinct a.user_id
    from public.shamo_attempts a
    left join public.shamo_user_roles r on r.user_id = a.user_id
    where a.deleted_at is null and coalesce(r.role, 'student') = 'student'
  ) s
  cross join lateral public.shamo_get_topic_weakness(s.user_id, 3, 100) t
  where t.main_topic = 'Trigonometry'
)
select
  (select students_attempting from public.shamo_get_class_topic_summary(3, 100)
    where main_topic = 'Trigonometry') as summary_attempting,
  (select count(*) from per_student) as ranking_attempting,
  (select students_with_evidence from public.shamo_get_class_topic_summary(3, 100)
    where main_topic = 'Trigonometry') as summary_evidenced,
  (select count(*) from per_student where has_enough_evidence) as ranking_evidenced,
  (select students_struggling from public.shamo_get_class_topic_summary(3, 100)
    where main_topic = 'Trigonometry') as summary_struggling,
  (select count(*) from per_student
    where has_enough_evidence and mark_ratio is not null and mark_ratio < 0.4)
    as ranking_struggling;
*/
-- Expect: each pair agrees. A divergence means a second definition of "weak"
-- has been introduced and a teacher and their student are being shown different
-- answers about the same work.

-- 6. Staff do not count as students in the class figures.
select
  (select count(*) from public.shamo_user_roles where role = 'staff') as staff_accounts,
  (select coalesce(sum(students_attempting), 0)
     from public.shamo_get_class_topic_summary(1, 100)) as student_topic_rows,
  (select coalesce(sum(students), 0) from public.shamo_get_mark_code_profile()) as code_rows;
-- Expect: neither figure changes when a staff account submits an attempt of its
-- own -- a teacher trying the tutor must not appear in their own class data.

-- 7. Scoping to one student really does scope. Replace with a real id.
/*
select 'class' as scope, * from public.shamo_get_mark_code_profile()
union all
select 'one', * from public.shamo_get_mark_code_profile(
  '00000000-0000-0000-0000-000000000000');
*/
-- Expect: the 'one' rows have students = 1 and totals no larger than the class
-- rows they sit beside.
