-- Correct eleven main_topic values found wrong by source review.
--
-- WHAT AND WHY
-- ------------
-- `main_topic` was the one metadata field with no independent witness. Mark rows
-- are checked against the printed subtotal, content against the PDF text layer,
-- OCR against the PDF's own characters -- but the only thing vouching for a
-- topic was the model that chose it. The vocabulary and paper-domain rules catch
-- an invalid or wrong-family topic; they cannot catch a topic that is valid,
-- in-domain, and simply wrong. That is the case that quietly degrades search.
--
-- Two offline checks now supply that witness, and this file applies what they
-- found after every row was read against the printed question and mark scheme:
--
--   harness/check_metadata_topics.mjs   evidence scoring + hallmark test
--   (targeted confusable sweep)          near-deterministic class rules
--
-- Nineteen rows were examined. Eleven were wrong and are corrected here; eight
-- were defensible and are deliberately left alone (see NOT CORRECTED below).
--
-- THE ERRORS FALL INTO FOUR CLASSES, not eleven unrelated slips
-- -------------------------------------------------------------
--   1. Binomial expansion and progressions labelled `Algebra` instead of
--      `Series` -- four rows. In Paper 1 the syllabus places the expansion of
--      (a+b)^n under Series; `Algebra` is the model reaching for the broader
--      word.
--   2. Graph transformations labelled by the carrier curve rather than by the
--      assessed skill -- two rows. 9709/11 Q2 awards all six marks for
--      {Stretch}{factor 3}{y-direction} and {Translation}, yet was `Trigonometry`
--      because the curve happens to be y = sin x.
--   3. `Differential Equations` and `Calculus` swapped in both directions --
--      two rows. 9709/12 Q10 is related rates with no differential equation
--      anywhere; 9709/32 Q10 spends 8 of its 10 marks separating variables in
--      one that is printed explicitly.
--   4. Three singletons: a continuous-random-variable p.d.f. question labelled
--      `Probability`, a P3 modulus inequality labelled `Functions`, and
--      parametric differentiation labelled `Differential Equations`.
--
-- NOT CORRECTED, and why -- these are review decisions, not oversights
-- ---------------------------------------------------------------------
--   9709/22 M/J Q5, 9709/21 M/J Q7   `Calculus`. Both open with polynomial
--     division (3 marks) and then integrate (5-6 marks). The integral is the
--     substance; the division is the means. Flagged only because Algebra's
--     vocabulary saturates the mark scheme.
--   9709/41 M/J Q4, Q5   `Energy, Work and Power`. Both genuinely span two
--     Mechanics topics. Q4 needs P = Fv before Newton's laws; Q5's part (b)
--     marks the work-energy principle as the primary route. Relabelling a
--     coin-flip would inflate the error count with my own preference.
--   9709/52 F/M Q2   `The Binomial and Geometric Distributions` is correct.
--     Cambridge never prints either word -- the mark scheme just writes
--     ^{10}C_8(0.7)^8(0.3)^2. The checker's hallmark list was too strict and
--     has been widened; the label was always right.
--   9709/31 O/N Q10   `Algebra` is correct, and the reason matters: in Paper 3
--     the binomial expansion of (1+x)^n for rational n sits under Algebra
--     alongside partial fractions, whereas in Paper 1 it sits under Series.
--     The right topic depends on the component, not just the words.
--   9709/61 O/N Q6   `Linear Combinations of Random Variables` is correct; the
--     signature list was missing "independent distributions".
--   9709/12 F/M Q2   `Trigonometry` is defensible: part (a) asks for the
--     minimum of y = k sin(x/2), which is trig-graph knowledge, so unlike
--     9709/11 Q2 not every mark is transformation work.
--
-- SAFETY
-- ------
--   * Every row asserted by question_id AND its exact current main_topic before
--     anything changes. A single mismatch raises and rolls the whole file back.
--   * No question, part, mark-scheme or search row is touched. Metadata only.
--   * `review_status` is deliberately NOT changed. Only main_topic has been
--     checked against source; subtopics, skills, methods and difficulty have
--     not, so the row-level gate must stay visibly open.
--   * Re-embedding is not required: shamo_get_pending_search_items embeds
--     question and part text, never metadata.
--   * Verify with database/shamo_v2_2_main_topic_source_review_verification.sql.
--
-- Expected: 11 rows updated, 11 resolved audit rows, 138 rows on taxonomy 9709-v3.

begin;

create temporary table tmp_topic_correction (
    question_id uuid primary key,
    expected_topic text not null,
    corrected_topic text not null,
    reason text not null
) on commit drop;

insert into tmp_topic_correction (question_id, expected_topic, corrected_topic, reason) values
  ('420276eb-2df7-4ff8-8ce4-1d2fee8af7ef', 'Probability', 'Continuous Random Variables',
   '9709/62 M/J 2024 Q7 defines a probability density function, normalises it, locates the median from the c.d.f. and integrates for E(X). Nothing in it is elementary probability.'),
  ('87d8b57a-dfae-4bf7-8853-051b4b83501a', 'Algebra', 'Series',
   '9709/12 F/M 2024 Q6 asks for the coefficient of x^3 in a binomial expansion. Paper 1 places the expansion of (a+b)^n under Series.'),
  ('57455615-e942-4aa3-a084-ada8d8afb3c2', 'Algebra', 'Series',
   '9709/11 M/J 2024 Q3 asks for the coefficient of x^3 in the expansion of (3+ax)^6. Paper 1 places the expansion of (a+b)^n under Series.'),
  ('007ce42b-5e1b-4028-8241-96ff15d62084', 'Functions', 'Algebra',
   '9709/32 M/J 2024 Q1 sketches y = |x-2a| and solves a modulus inequality. Paper 3 places the modulus function and its inequalities under Algebra; Functions covers domain, range, inverse and composite.'),
  ('9be05521-f8bf-44dc-8a54-9f2958e15d2d', 'Differential Equations', 'Calculus',
   '9709/21 O/N 2025 Q6 differentiates parametric equations and finds a normal. There is no differential equation in the question; showing dy/dx equals an expression is not one.'),
  ('b321e2a1-bf94-4eba-8411-201281f6e923', 'Algebra', 'Series',
   '9709/12 M/J 2024 Q1 compares coefficients of x^2 in two binomial expansions. Paper 1 places the expansion of (a+b)^n under Series.'),
  ('2fbd571b-eaaa-49c5-b766-5b1b7805d2c0', 'Coordinate Geometry', 'Functions',
   '9709/12 M/J 2024 Q2 asks for a sequence of transformations taking y = x^2 to y = 4(x-3)^2 - 8. Paper 1 places the effect of transformations on y = f(x) under Functions.'),
  ('d96d3011-efcd-4348-bf32-c00661afba40', 'Algebra', 'Series',
   '9709/12 M/J 2024 Q5 uses an arithmetic progression and a geometric progression, its sum to infinity and a finite sum. This is Series throughout.'),
  ('a5827000-bb95-4731-992b-6ade7cabc4d2', 'Differential Equations', 'Calculus',
   '9709/12 M/J 2024 Q10 is connected rates of change and a perpendicular bisector. No differential equation appears; it was the lowest-confidence row in the corpus at 0.45.'),
  ('db1e73c7-b1c3-4f2d-9dfa-2f67c42359c0', 'Trigonometry', 'Functions',
   '9709/11 M/J 2024 Q2 awards every mark for describing transformations -- {Stretch}{factor 3}{y-direction} and {Translation} -- then composing them. y = sin x is the carrier curve, not the topic.'),
  ('2bbc7a79-af1b-4233-8546-d123ea09df18', 'Calculus', 'Differential Equations',
   '9709/32 M/J 2024 Q10 part (b) prints a differential equation and spends 8 of the question''s 10 marks separating variables and applying a boundary condition.');

do $$
declare
  v_expected int := 11;
  v_matched int;
  v_updated int;
  v_offtaxonomy int;
begin
  -- Assert every target exists AND still carries the topic this review saw.
  -- Matching on question_id alone would let a concurrent edit be overwritten
  -- silently; matching on the pair makes that impossible.
  select count(*) into v_matched
  from tmp_topic_correction as c
  join public.shamo_question_metadata as m
    on m.question_id = c.question_id and m.main_topic = c.expected_topic;

  if v_matched <> v_expected then
    raise exception
      'Expected % rows matching both question_id and current main_topic, found %. Nothing changed.',
      v_expected, v_matched;
  end if;

  update public.shamo_question_metadata as m
     set main_topic = c.corrected_topic,
         taxonomy_version = '9709-v3',
         reviewer_note = concat_ws(' | ',
           nullif(m.reviewer_note, ''),
           'Agent-assisted source review 2026-08-09: main_topic ' || c.expected_topic ||
           ' -> ' || c.corrected_topic || '. ' || c.reason),
         updated_at = now()
    from tmp_topic_correction as c
   where m.question_id = c.question_id
     and m.main_topic = c.expected_topic;

  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception 'Expected % updates, performed %. Rolled back.', v_expected, v_updated;
  end if;

  -- Every row now carries a 9709-v3 topic, verified earlier against the
  -- vocabulary and the paper-domain rule, so the stale `cambridge-maths-v1`
  -- label is wrong for all of them and not only the eleven corrected here.
  update public.shamo_question_metadata
     set taxonomy_version = '9709-v3', updated_at = now()
   where taxonomy_version is distinct from '9709-v3';

  select count(*) into v_offtaxonomy
  from public.shamo_question_metadata
  where taxonomy_version <> '9709-v3';

  if v_offtaxonomy <> 0 then
    raise exception '% metadata rows are still off-taxonomy. Rolled back.', v_offtaxonomy;
  end if;
end;
$$;

-- Audit trail. Resolved on insert: the correction IS the resolution, and each
-- row states plainly that only main_topic was reviewed.
insert into public.shamo_ingestion_issues (
    ingestion_run_id, severity, issue_code, document_type, question_number,
    part_path, message, resolved, resolution_note, resolved_at
)
select q.ingestion_run_id, 'warning', 'METADATA_MAIN_TOPIC_CORRECTED',
       'question_paper', q.question_number, null,
       'main_topic was "' || c.expected_topic || '" and is not supported by the printed question or mark scheme.',
       true,
       'Corrected to "' || c.corrected_topic || '". ' || c.reason ||
       ' Only main_topic was reviewed; subtopics, skills, methods and difficulty were not, so review_status is unchanged.',
       now()
from tmp_topic_correction as c
join public.shamo_questions as q on q.id = c.question_id
where not exists (
    select 1
    from public.shamo_ingestion_issues as existing
    where existing.ingestion_run_id = q.ingestion_run_id
      and existing.issue_code = 'METADATA_MAIN_TOPIC_CORRECTED'
      and existing.question_number = q.question_number
);

commit;
