-- Verification for shamo_v2_11_staff_class_view_patch.sql. Read-only.
--
-- Section 3 is the one that matters. The other checks confirm the roster is
-- correct; section 3 confirms it is not also a leak. A security definer
-- function is a hole cut deliberately through the privilege system, and the
-- only thing that makes it safe is that the hole is exactly the right size.

-- 1. The function exists, is security definer, has a pinned search_path, and is
--    callable by service_role alone.
select p.proname,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_can_call,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_call,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_call
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'shamo_get_student_roster';
-- Expect: security_definer true, settings {search_path=""},
-- service_can_call true, auth_can_call false, anon_can_call false.

-- 2. It returns rows, and the numbers are real rather than defaulted.
select * from public.shamo_get_student_roster(50);
-- Expect: one row per non-staff account. mark_ratio is NULL (not 0) for anyone
-- with no scored attempts; last_active_at is NULL for an account that has never
-- had a thread or an attempt.

-- 3. THE PRIVACY BOUNDARY: the roster's return type contains no conversation
--    content and no thread title.
select unnest(string_to_array(pg_get_function_result(p.oid), ',')) as returned_column
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'shamo_get_student_roster';
-- Expect: no 'content' and no 'title' among them. Ever.

select (p.prosrc ilike '%.content%') as reads_turn_content,
       (p.prosrc ilike '%c.title%' or p.prosrc ilike '%conversations.title%') as reads_thread_title
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'shamo_get_student_roster';
-- Expect: false, false.

-- 4. Staff do not appear in their own roster. Run after a staff row exists.
select
  (select count(*) from public.shamo_user_roles where role = 'staff') as staff_accounts,
  (select count(*) from public.shamo_get_student_roster(500) r
     join public.shamo_user_roles ur on ur.user_id = r.user_id
    where ur.role = 'staff') as staff_in_roster;
-- Expect: staff_in_roster 0, whatever staff_accounts is.

-- 5. "Weak" has exactly one definition. The roster's weakest_topic must equal
--    the first evidenced row of the student's own ranking -- the same function
--    the student sees. Replace the id with a real student who has attempts.
/*
select r.weakest_topic as roster_says,
       (select t.main_topic
          from public.shamo_get_topic_weakness(r.user_id, 3, 5) t
         where t.has_enough_evidence
         limit 1) as ranking_says
from public.shamo_get_student_roster(500) r
where r.user_id = '00000000-0000-0000-0000-000000000000';
*/
-- Expect: the two columns agree. If they ever diverge, a second definition of
-- "weak" has been introduced somewhere and a teacher and their student are
-- being shown different answers about the same work.
