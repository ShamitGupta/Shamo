begin;

-- Shamo v2.12: what a teacher needs in order to plan a lesson.
--
-- Additive: three functions, no schema change, nothing dropped. They answer the
-- three questions the v2.11 roster cannot --
--
--   what is the CLASS losing marks on?        shamo_get_class_topic_summary
--   WHY are marks being lost -- method or      shamo_get_mark_code_profile
--     accuracy?
--   is anyone quietly not working?             shamo_get_activity_by_week
--
-- Four decisions are deliberate and worth defending before anyone simplifies
-- them:
--
-- 1. NO CONVERSATION CONTENT AND NO THREAD TITLE, same as v2.11. None of these
--    functions reads shamo_conversations or shamo_conversation_turns at all --
--    every figure here comes from shamo_attempts, which is work handed in for
--    marking. If a future column needs either, that is a policy change and
--    should be argued for, not added quietly.
--
-- 2. THE CLASS SUMMARY CALLS shamo_get_topic_weakness RATHER THAN RE-AGGREGATING
--    THE ATTEMPTS ITSELF. Re-deriving "weak" here would create a second
--    definition of it, free to drift from the one on the student's own screen,
--    and a teacher and their student would eventually be shown different
--    answers about the same work. The lateral call is slower than an inlined
--    aggregate and is worth it for that reason alone -- the same trade v2.11
--    already made for the roster's weakest_topic column.
--
-- 3. THE HEADLINE IS A HEADCOUNT, NOT A POOLED RATIO. class_mark_ratio pools
--    every student's marks together, so it is dominated by whoever practised
--    most: one heavy user can define the whole class's apparent weakness. The
--    ordering therefore leads on students_struggling / students_with_evidence,
--    and both numbers are returned so the caller can never show the share
--    without the count it rests on.
--
-- 4. security invoker, NOT definer. Unlike shamo_get_student_roster these read
--    no auth.users column -- the student set comes from who has actually
--    attempted something, with staff excluded via shamo_user_roles. There is no
--    reason to cut another hole through the privilege system.
--
-- INTERIM ACCESS MODEL, unchanged from v2.11: "the class" means every student in
-- the database, because school scoping does not exist yet (PENDING.md P1-6).
-- When schools land, the filter belongs in the `students` CTE below and in
-- shamo_get_student_roster, and nowhere else.


-- 1. What the class as a whole is losing marks on ---------------------------

create or replace function public.shamo_get_class_topic_summary(
  p_min_attempts integer default 3,
  p_limit integer default 20
)
returns table (
  main_topic text,
  students_attempting integer,
  students_with_evidence integer,
  students_struggling integer,
  attempts integer,
  scored_attempts integer,
  marks_earned integer,
  marks_available integer,
  class_mark_ratio numeric,
  has_enough_evidence boolean,
  last_attempted_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounded as (
    select
      greatest(1, least(coalesce(p_min_attempts, 3), 50)) as min_attempts,
      greatest(1, least(coalesce(p_limit, 20), 100)) as row_limit
  ),
  -- Whoever has actually submitted work, minus staff. Derived from the attempts
  -- rather than from auth.users or shamo_profiles: a topic summary has nothing
  -- to say about an account that has never attempted anything, and reading
  -- auth.users would force this function to be security definer for no gain.
  students as (
    select distinct a.user_id
    from public.shamo_attempts a
    left join public.shamo_user_roles r on r.user_id = a.user_id
    where a.deleted_at is null
      and coalesce(r.role, 'student') = 'student'
  ),
  per_student as (
    select s.user_id, t.*
    from students s
    cross join lateral public.shamo_get_topic_weakness(
      s.user_id, (select min_attempts from bounded), 100
    ) t
  )
  select
    ps.main_topic,
    count(*)::integer as students_attempting,
    count(*) filter (where ps.has_enough_evidence)::integer as students_with_evidence,
    -- 0.4 is the same boundary the student's own panel calls "Struggling"
    -- (frontend/src/Teacher/format.js and ChatSection/WeakTopics.jsx). One
    -- number, one meaning, on every screen.
    count(*) filter (
      where ps.has_enough_evidence and ps.mark_ratio is not null and ps.mark_ratio < 0.4
    )::integer as students_struggling,
    coalesce(sum(ps.attempts), 0)::integer as attempts,
    coalesce(sum(ps.scored_attempts), 0)::integer as scored_attempts,
    coalesce(sum(ps.marks_earned), 0)::integer as marks_earned,
    coalesce(sum(ps.marks_available), 0)::integer as marks_available,
    -- Null, not zero, when nothing in this topic has been scored. Zero would
    -- sort like the class's worst topic and read as a judgement of work that
    -- has simply not been marked.
    case when coalesce(sum(ps.marks_available), 0) > 0
      then round(sum(ps.marks_earned)::numeric / sum(ps.marks_available), 4)
      else null end as class_mark_ratio,
    -- A class-level claim needs more than one student behind it. One student
    -- struggling with Vectors is a conversation with that student, not a lesson
    -- plan. Topics below this are still returned, flagged false, so they can be
    -- shown honestly rather than silently vanishing -- same rule as v2.8.
    (count(*) filter (where ps.has_enough_evidence) >= 2) as has_enough_evidence,
    max(ps.last_attempted_at) as last_attempted_at
  from per_student ps
  group by ps.main_topic
  order by
    (count(*) filter (where ps.has_enough_evidence) >= 2) desc,
    (count(*) filter (
       where ps.has_enough_evidence and ps.mark_ratio is not null and ps.mark_ratio < 0.4
     )::numeric
     / nullif(count(*) filter (where ps.has_enough_evidence), 0)) desc nulls last,
    case when coalesce(sum(ps.marks_available), 0) > 0
      then sum(ps.marks_earned)::numeric / sum(ps.marks_available)
      else null end asc nulls last,
    max(ps.last_attempted_at) desc
  limit (select row_limit from bounded);
$$;

comment on function public.shamo_get_class_topic_summary(integer, integer) is
  'Per-topic performance across every student, built by calling shamo_get_topic_weakness once per student so that "weak" keeps exactly one definition. Ranked by the SHARE OF STUDENTS struggling rather than by the pooled mark ratio, which one heavy user would otherwise dominate; both numbers are returned. Reads no conversation content. Covers every student in the database -- school scoping is not built yet (PENDING.md P1-6).';


-- 2. Method marks, accuracy marks, independent marks -------------------------

create or replace function public.shamo_get_mark_code_profile(
  p_user_id uuid default null
)
returns table (
  code_class text,
  earned integer,
  missed integer,
  total integer,
  earned_ratio numeric,
  students integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as (
    select a.user_id, a.earned_codes, a.missed_codes
    from public.shamo_attempts a
    left join public.shamo_user_roles r on r.user_id = a.user_id
    where a.deleted_at is null
      -- Only scored attempts carry codes at all. An attempt whose outcome could
      -- not be extracted is real evidence the student worked and says nothing
      -- about which marks they earned; counting it would invent a zero.
      and a.outcome_source = 'extractor'
      and (p_user_id is null or a.user_id = p_user_id)
      -- Staff are excluded from the CLASS view only. Asked about one id, this
      -- answers about that id, whoever it belongs to.
      and (p_user_id is not null or coalesce(r.role, 'student') = 'student')
  ),
  exploded as (
    select s.user_id, 'earned' as outcome, code
    from scoped s, unnest(s.earned_codes) as code
    union all
    select s.user_id, 'missed', code
    from scoped s, unnest(s.missed_codes) as code
  ),
  classified as (
    select
      e.user_id,
      e.outcome,
      -- Cambridge mark codes name what the mark is FOR: M method, A accuracy
      -- (normally dependent on the method mark), B independent. Stored codes
      -- are already normalised by backend_v2/app/attempt_outcome.py --
      -- uppercased, '*' and spaces stripped -- so the first M, A or B in the
      -- string is the class: 'DM1' is a dependent METHOD mark, 'A1FT' a
      -- follow-through ACCURACY mark, 'B2' independent. Verified against the
      -- live corpus: this classifies all 7,569 codes in
      -- shamo_mark_scheme_items with none left over. 'other' exists so that a
      -- code shape nobody anticipated surfaces as itself instead of being
      -- silently folded into one of the three.
      coalesce(substring(upper(e.code) from '[MAB]'), 'other') as code_class
    from exploded e
  )
  select
    c.code_class,
    count(*) filter (where c.outcome = 'earned')::integer as earned,
    count(*) filter (where c.outcome = 'missed')::integer as missed,
    count(*)::integer as total,
    round(count(*) filter (where c.outcome = 'earned')::numeric / count(*), 4) as earned_ratio,
    count(distinct c.user_id)::integer as students
  from classified c
  group by c.code_class
  -- Method before accuracy before independent: that is the order a mark scheme
  -- awards them in, and the order the comparison is read in.
  order by case c.code_class
             when 'M' then 1 when 'A' then 2 when 'B' then 3 else 4 end;
$$;

comment on function public.shamo_get_mark_code_profile(uuid) is
  'Marks earned and missed split by what the mark is for: M method, A accuracy, B independent. Null p_user_id means every student; a uuid means that one. Only extractor-scored attempts contribute, because an unscored attempt carries no codes and counting it would invent a zero. Every row carries its own denominator so no share is ever shown without the count behind it.';


-- 3. Whether anyone is actually working --------------------------------------

create or replace function public.shamo_get_activity_by_week(
  p_user_id uuid default null,
  p_weeks integer default 8
)
returns table (
  week_start timestamptz,
  attempts integer,
  scored_attempts integer,
  students_active integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounded as (
    select greatest(1, least(coalesce(p_weeks, 8), 26)) as weeks
  ),
  -- Every week in the window is generated, including the empty ones. A quiet
  -- fortnight has to render as two zero bars; dropping the rows would draw it
  -- as a continuous line and hide the exact thing this function is for.
  calendar as (
    select generate_series(
      date_trunc('week', now()) - (((select weeks from bounded) - 1) * interval '1 week'),
      date_trunc('week', now()),
      interval '1 week'
    ) as week_start
  ),
  scoped as (
    select
      a.user_id,
      a.outcome_source,
      date_trunc('week', a.created_at) as week_start
    from public.shamo_attempts a
    left join public.shamo_user_roles r on r.user_id = a.user_id
    where a.deleted_at is null
      and (p_user_id is null or a.user_id = p_user_id)
      and (p_user_id is not null or coalesce(r.role, 'student') = 'student')
      and a.created_at >= (select min(week_start) from calendar)
  )
  select
    c.week_start,
    count(s.user_id)::integer as attempts,
    count(*) filter (where s.outcome_source = 'extractor')::integer as scored_attempts,
    count(distinct s.user_id)::integer as students_active
  from calendar c
  left join scoped s on s.week_start = c.week_start
  group by c.week_start
  order by c.week_start;
$$;

comment on function public.shamo_get_activity_by_week(uuid, integer) is
  'Attempts submitted per week, for the whole class (null p_user_id) or one student. Empty weeks are generated rather than omitted: a gap must draw as a zero bar, since noticing that someone stopped is the point.';


-- Grants ---------------------------------------------------------------------
--
-- service_role only, matching every other operational function. The browser
-- reaches these through backend_v2, which is where the staff gate lives.

revoke execute on function public.shamo_get_class_topic_summary(integer, integer)
  from public, anon, authenticated;
grant execute on function public.shamo_get_class_topic_summary(integer, integer)
  to service_role;

revoke execute on function public.shamo_get_mark_code_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.shamo_get_mark_code_profile(uuid)
  to service_role;

revoke execute on function public.shamo_get_activity_by_week(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.shamo_get_activity_by_week(uuid, integer)
  to service_role;

commit;
