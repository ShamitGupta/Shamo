begin;

-- Shamo v2.8: rank a student topics by how they are actually scoring.
--
-- Additive: one function, no schema change. Reads shamo_attempts (v2.7) and
-- joins to the reviewed metadata that already carries main_topic.
--
-- Four decisions are deliberate and worth defending before anyone simplifies
-- them:
--
-- 1. THE RATIO IS NEVER RETURNED ALONE. Every row carries the attempts behind
--    it, the raw marks, when it was last practised, and example questions. A
--    single opaque score is exactly what this project guidance says not to
--    build: a student told "you are 43% at Vectors" learns nothing, and a
--    teacher cannot check it.
--
-- 2. A TOPIC NEEDS A MINIMUM NUMBER OF SCORED ATTEMPTS BEFORE IT RANKS. One bad
--    question is not a weakness. Topics below the threshold are still returned,
--    flagged has_enough_evidence = false, so "not enough evidence yet" can be
--    shown honestly rather than the topic silently vanishing.
--
-- 3. ONLY SCORED ATTEMPTS FEED THE RATIO. An attempt whose outcome could not be
--    extracted is real evidence the student worked on the topic but says
--    nothing about how well. It counts in attempts, is excluded from the ratio,
--    and the two numbers are reported separately so the gap stays visible.
--
-- 4. GROUPED BY TOPIC ALONE, NOT BY (TOPIC, SYLLABUS). "Trigonometry" exists in
--    both 9709 (56 questions) and 0606 (34). Grouping by both fragments one
--    student evidence into two half-sized rows, which can push BOTH below the
--    threshold -- observed on the first run of the verification script, where
--    four Trigonometry attempts became a 3-attempt row and a 1-attempt row. The
--    syllabuses involved are returned as data so a practice-set step can still
--    filter.
--
-- Question identity: attempts store the reference tuple as the durable identity
-- and question_id only as a convenience link (see v2.7). This resolves the
-- topic through question_id when present and falls back to the reference, so a
-- republished paper does not erase a student history.

drop function if exists public.shamo_get_topic_weakness(uuid, integer, integer);

create or replace function public.shamo_get_topic_weakness(
  p_user_id uuid,
  p_min_attempts integer default 3,
  p_limit integer default 20
)
returns table (
  main_topic text,
  syllabus_codes text[],
  attempts integer,
  scored_attempts integer,
  marks_earned integer,
  marks_available integer,
  mark_ratio numeric,
  has_enough_evidence boolean,
  last_attempted_at timestamptz,
  example_questions jsonb
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
  resolved as (
    select
      a.id, a.created_at, a.marks_earned, a.marks_available, a.outcome_source,
      a.qualification, a.syllabus_code, a.year, a.exam_session,
      a.paper_variant, a.question_number,
      coalesce(m_by_id.main_topic, m_by_ref.main_topic) as main_topic
    from public.shamo_attempts a
    left join public.shamo_question_metadata m_by_id
      on m_by_id.question_id = a.question_id
    left join public.shamo_questions q_by_ref
      on a.question_id is null
     and q_by_ref.question_number = a.question_number
    left join public.shamo_papers p_by_ref
      on p_by_ref.id = q_by_ref.paper_id
     and p_by_ref.qualification = a.qualification
     and p_by_ref.syllabus_code = a.syllabus_code
     and p_by_ref.year = a.year
     and p_by_ref.exam_session = a.exam_session
     and p_by_ref.paper_variant = a.paper_variant
    left join public.shamo_question_metadata m_by_ref
      on m_by_ref.question_id = q_by_ref.id
     and p_by_ref.id is not null
    where a.user_id = p_user_id
      and a.deleted_at is null
  ),
  grouped as (
    select
      r.main_topic,
      array_agg(distinct r.syllabus_code order by r.syllabus_code) as syllabus_codes,
      count(*)::integer as attempts,
      count(*) filter (where r.outcome_source = 'extractor')::integer as scored_attempts,
      coalesce(sum(r.marks_earned) filter (where r.outcome_source = 'extractor'), 0)::integer as marks_earned,
      coalesce(sum(r.marks_available) filter (where r.outcome_source = 'extractor'), 0)::integer as marks_available,
      max(r.created_at) as last_attempted_at,
      jsonb_agg(
        jsonb_build_object(
          'qualification', r.qualification,
          'syllabus_code', r.syllabus_code,
          'year', r.year,
          'exam_session', r.exam_session,
          'paper_variant', r.paper_variant,
          'question_number', r.question_number,
          'marks_earned', r.marks_earned,
          'marks_available', r.marks_available,
          'attempted_at', r.created_at
        )
        order by r.created_at desc
      ) as all_questions
    from resolved r
    where r.main_topic is not null
    group by r.main_topic
  )
  select
    g.main_topic, g.syllabus_codes,
    g.attempts, g.scored_attempts, g.marks_earned, g.marks_available,
    case when g.marks_available > 0
      then round(g.marks_earned::numeric / g.marks_available, 4)
      else null end as mark_ratio,
    (g.scored_attempts >= b.min_attempts) as has_enough_evidence,
    g.last_attempted_at,
    (select jsonb_agg(value) from (
       select value from jsonb_array_elements(g.all_questions) limit 5
     ) trimmed) as example_questions
  from grouped g
  cross join bounded b
  order by
    (g.scored_attempts >= b.min_attempts) desc,
    case when g.marks_available > 0
      then g.marks_earned::numeric / g.marks_available
      else null end asc nulls last,
    g.scored_attempts desc,
    g.last_attempted_at desc
  limit (select row_limit from bounded);
$$;

comment on function public.shamo_get_topic_weakness(uuid, integer, integer) is
  'Per-topic mark ratio for one student, always returned with the evidence behind it (attempts, raw marks, recency, example questions). Grouped by topic ALONE: the same topic name exists in more than one syllabus, and splitting it fragments a student evidence so that both halves fall below the threshold. The syllabuses involved are returned as data so a practice-set step can still filter.';

revoke execute on function public.shamo_get_topic_weakness(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.shamo_get_topic_weakness(uuid, integer, integer)
  to service_role;

commit;
