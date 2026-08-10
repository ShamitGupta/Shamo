-- Correct three main_topic labels on the newly published batch-4 questions.
--
-- WHAT THIS MEASURES
-- ------------------
-- Batch 4 is the first batch classified by the prompt carrying the seven
-- disambiguation rules added on 9 August. Its 50 new metadata rows raised 7
-- flags in harness/check_metadata_topics.mjs. All seven were read against the
-- printed question; four were correct and are recorded in the checker's
-- ADJUDICATED list, three were wrong and are corrected here.
--
--   3 wrong in 50  =  6.0%,  against a measured 11.6% (16 in 138) on the old
--   prompt. Roughly halved, not eliminated.
--
-- State that carefully. 50 rows is a small denominator, and the four false
-- positives show the checker is not a ground truth either -- it is a queue.
--
-- THE FOUR THAT WERE CORRECT, and why they flagged:
--   9709/22 F/M Q2  Algebra        the modulus function is Paper 2 Algebra;
--                                  flagged for "graph"/"axes", the carrier.
--   9709/31 M/J Q1  Algebra        (1-2x)^(1/2) is expansion for RATIONAL n,
--                                  which is Paper 3 Algebra, not Series. The
--                                  documented component-dependent split.
--   9709/51 O/N Q2  Binomial/Geom  Geo(1/6) written as "thrown repeatedly
--                                  until a 6 is obtained" -- never named.
--   9709/51 O/N Q5  Binomial/Geom  B(7, 0.6) written as "in a week (7 days)
--                                  ... on at least 5 days" -- never named.
--
-- The last two were a gap in the checker, not in the metadata: its hallmark
-- list required the words "binomial" or "geometric", which Cambridge does not
-- print. The list has been widened.
--
-- THE THREE CORRECTED HERE
-- ------------------------
--   9709/42 M/J Q7   Momentum -> Newton's Laws of Motion
--       Two particles over a pulley on an inclined plane. (a) find the
--       acceleration, (b) use an energy method for the speed. There is no
--       collision and no impulse anywhere in the question; momentum is simply
--       not the topic. The checker found 7 separate matches for Newton's Laws.
--
--   9709/62 F/M Q3   Discrete Random Variables -> The Poisson Distribution
--       1 in 10 000 tickets wins, 6000 sold, "use a suitable approximating
--       distribution". That is the Poisson approximation to the binomial with
--       lambda = 0.6, and part (b) asks the candidate to justify it. The
--       assigned label is the generic parent of the real topic -- the same
--       class of imprecision as the `Statistics` labels corrected in batch 3.
--
--   9709/62 F/M Q4   Continuous Random Variables -> The Normal Distribution
--       The stem declares X ~ N(10 700, 950^2) and Y ~ N(13 400, 1210^2).
--       Caught by MAIN_TOPIC_CONFUSABLE_CLASS, the rule added on 9 August that
--       says a declared distribution names the topic. The rule firing on fresh
--       output is the point: it was written for exactly this.
--
-- SAFETY
-- ------
--   * Each row is matched on (paper identity, question number, CURRENT topic),
--     so a row already corrected is not matched and the count assertion fails
--     loudly rather than the file silently doing nothing.
--   * Only main_topic and taxonomy_version change. review_status is untouched:
--     only main_topic has been source-reviewed on these rows, and closing the
--     gate on a partial review is what this project has repeatedly refused.
--   * No re-embedding is needed. Search vectors are built from question and
--     part text, not from metadata.

begin;

create temporary table batch4_topic_fix (
  paper_variant text,
  year int,
  exam_session text,
  question_number int,
  expected_topic text,
  corrected_topic text,
  reason text
) on commit drop;

insert into batch4_topic_fix values
  ('42', 2024, 'may_june', 7, 'Momentum', 'Newton''s Laws of Motion',
   'Connected particles over a pulley on an inclined plane. No collision and no impulse; part (a) is F = ma and part (b) is an energy method.'),
  ('62', 2024, 'feb_march', 3, 'Discrete Random Variables', 'The Poisson Distribution',
   'Poisson approximation to the binomial, lambda = 0.6. Part (b) asks the candidate to justify the approximating distribution.'),
  ('62', 2024, 'feb_march', 4, 'Continuous Random Variables', 'The Normal Distribution',
   'The stem declares X ~ N(10700, 950^2) and Y ~ N(13400, 1210^2). A declared distribution names the topic.');

do $$
declare
  v_matched int;
begin
  select count(*) into v_matched
  from batch4_topic_fix f
  join shamo_papers p
    on p.paper_variant = f.paper_variant and p.year = f.year and p.exam_session = f.exam_session
  join shamo_questions q on q.paper_id = p.id and q.question_number = f.question_number
  join shamo_question_metadata m on m.question_id = q.id and m.main_topic = f.expected_topic;
  if v_matched <> 3 then
    raise exception 'Expected 3 rows to correct, matched %. Nothing changed.', v_matched;
  end if;
end $$;

update shamo_question_metadata m
set main_topic = f.corrected_topic,
    taxonomy_version = '9709-v3',
    updated_at = now()
from batch4_topic_fix f
join shamo_papers p
  on p.paper_variant = f.paper_variant and p.year = f.year and p.exam_session = f.exam_session
join shamo_questions q on q.paper_id = p.id and q.question_number = f.question_number
where m.question_id = q.id and m.main_topic = f.expected_topic;

insert into shamo_ingestion_issues
  (ingestion_run_id, severity, issue_code, document_type, page_number,
   question_number, part_path, message, resolved, resolution_note, resolved_at)
select p.current_ingestion_run_id, 'warning', 'METADATA_MAIN_TOPIC_CORRECTED',
       null, null, f.question_number, null,
       'main_topic was "' || f.expected_topic || '" on a question that is "' || f.corrected_topic || '".',
       true, f.reason, now()
from batch4_topic_fix f
join shamo_papers p
  on p.paper_variant = f.paper_variant and p.year = f.year and p.exam_session = f.exam_session;

commit;

-- Verification, read-only. Run after the transaction commits.
--
-- select p.paper_variant, p.exam_session, q.question_number, m.main_topic, m.taxonomy_version
-- from shamo_question_metadata m
-- join shamo_questions q on q.id = m.question_id
-- join shamo_papers p on p.id = q.paper_id
-- where (p.paper_variant, p.year, p.exam_session, q.question_number) in
--       (('42',2024,'may_june',7), ('62',2024,'feb_march',3), ('62',2024,'feb_march',4))
-- order by p.paper_variant, q.question_number;
--
-- Expect: Newton's Laws of Motion, The Poisson Distribution, The Normal
-- Distribution, all on taxonomy 9709-v3.
