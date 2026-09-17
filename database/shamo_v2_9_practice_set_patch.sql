begin;

-- Shamo v2.9: pick unattempted questions on one topic for one student.
--
-- Additive: one function, no schema change.
--
-- This is deliberately NOT the similarity function. That one answers "questions
-- like THIS question", which is a search feature. This one answers "what should
-- I work on next", which needs the student: it excludes what they have already
-- attempted, spreads the set across papers so a session is not four questions
-- from one sitting, and starts gentle because it is called on a topic the
-- student is struggling with.
--
-- Exclusion matches on question_id OR the reference tuple, for the same reason
-- v2.8 resolves topics both ways: question_id can change when a paper is
-- corrected and republished, and a student must not be handed back a question
-- they already worked on just because its row was replaced.
--
-- Every row carries selection_reason. A recommendation a student cannot see the
-- reasoning for is one they cannot disagree with, and the reason here is drawn
-- from stored metadata rather than written by a model -- so it cannot be
-- fluent and wrong.

create or replace function public.shamo_get_practice_set(
  p_user_id uuid,
  p_main_topic text,
  p_syllabus_code text default null,
  p_limit integer default 5
)
returns table (
  question_id uuid,
  qualification text,
  syllabus_code text,
  year smallint,
  exam_session text,
  paper_variant text,
  question_number integer,
  main_topic text,
  difficulty_level smallint,
  total_marks integer,
  stem_snippet text,
  selection_reason text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounded as (
    select greatest(1, least(coalesce(p_limit, 5), 20)) as row_limit
  ),
  attempted as (
    select distinct
      a.question_id,
      a.qualification, a.syllabus_code, a.year,
      a.exam_session, a.paper_variant, a.question_number
    from public.shamo_attempts a
    where a.user_id = p_user_id
      and a.deleted_at is null
  ),
  candidates as (
    select
      o.question_id, o.qualification, o.syllabus_code, o.year, o.exam_session,
      o.paper_variant, o.question_number, o.total_marks, o.paper_id,
      m.main_topic, m.difficulty_level,
      left(coalesce(q.stem_markdown, ''), 240) as stem_snippet
    from public.shamo_published_question_overview o
    join public.shamo_question_metadata m on m.question_id = o.question_id
    join public.shamo_questions q on q.id = o.question_id
    where m.main_topic = p_main_topic
      and (p_syllabus_code is null or o.syllabus_code = p_syllabus_code)
      and not exists (
        select 1 from attempted t
        where t.question_id = o.question_id
           or (t.qualification = o.qualification
           and t.syllabus_code = o.syllabus_code
           and t.year = o.year
           and t.exam_session = o.exam_session
           and t.paper_variant = o.paper_variant
           and t.question_number = o.question_number)
      )
  ),
  spread as (
    select
      c.*,
      -- One question per paper before a second is taken from any paper, so a
      -- practice set is not four questions from the same sitting.
      row_number() over (
        partition by c.paper_id
        order by coalesce(c.difficulty_level, 3), c.question_number
      ) as rank_in_paper
    from candidates c
  )
  select
    s.question_id, s.qualification, s.syllabus_code, s.year, s.exam_session,
    s.paper_variant, s.question_number, s.main_topic, s.difficulty_level,
    s.total_marks, s.stem_snippet,
    case
      when s.difficulty_level is null then
        'Same topic, not attempted yet'
      when s.difficulty_level <= 2 then
        'Same topic, a gentler question to rebuild the method'
      when s.difficulty_level >= 4 then
        'Same topic, a harder question once the method is secure'
      else
        'Same topic, a typical question at this level'
    end as selection_reason
  from spread s
  order by
    s.rank_in_paper,
    coalesce(s.difficulty_level, 3),
    s.year desc,
    s.question_number
  limit (select row_limit from bounded);
$$;

comment on function public.shamo_get_practice_set(uuid, text, text, integer) is
  'Unattempted published questions on one topic for one student, easiest first and spread across papers. Selects FOR A STUDENT (excluding what they have already done), which is why it is not the similarity function -- that selects questions like a question.';

revoke execute on function public.shamo_get_practice_set(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.shamo_get_practice_set(uuid, text, text, integer)
  to service_role;

commit;
