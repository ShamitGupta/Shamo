-- Shamo v2.1: same-component semantic similarity review.
--
-- Read-only. No embedding/provider API calls.
-- This uses the existing shamo_match_similar_questions function as a wide
-- candidate source, then filters the results to the same paper component:
-- Paper 1 with Paper 1, Paper 2 with Paper 2, and so on.
--
-- The current corpus is sparse by component. This file therefore reports the
-- same-component pool size so weak/empty results are not mistaken for a final
-- search-quality judgement.

with
seed_specs(
    seed_name,
    year,
    exam_session,
    paper_variant,
    question_number,
    expected_component
) as (
    values
        ('12_q1_improper_integral', 2024::smallint, 'feb_march', '12', 1, '1'),
        ('12_q6_binomial_expansion', 2024::smallint, 'feb_march', '12', 6, '1'),
        ('12_q10_circle_geometry', 2024::smallint, 'feb_march', '12', 10, '1'),
        ('21_q2_implicit_differentiation', 2024::smallint, 'may_june', '21', 2, '2'),
        ('21_q6_integration_volume', 2024::smallint, 'may_june', '21', 6, '2'),
        ('21_q7_partial_fractions', 2024::smallint, 'may_june', '21', 7, '2'),
        ('32_q3_logs', 2024::smallint, 'may_june', '32', 3, '3'),
        ('32_q8_vectors', 2024::smallint, 'may_june', '32', 8, '3'),
        ('32_q9_complex', 2024::smallint, 'may_june', '32', 9, '3'),
        ('41_q2_collisions', 2025::smallint, 'oct_nov', '41', 2, '4'),
        ('41_q5_statics_friction', 2025::smallint, 'oct_nov', '41', 5, '4'),
        ('41_q7_kinematics', 2025::smallint, 'oct_nov', '41', 7, '4'),
        ('52_q2_binomial_geometric', 2024::smallint, 'feb_march', '52', 2, '5'),
        ('52_q3_histogram', 2024::smallint, 'feb_march', '52', 3, '5'),
        ('52_q6_permutations', 2024::smallint, 'feb_march', '52', 6, '5'),
        ('61_q1_poisson', 2024::smallint, 'may_june', '61', 1, '6'),
        ('61_q3_confidence_interval', 2024::smallint, 'may_june', '61', 3, '6'),
        ('61_q7_hypothesis_test', 2024::smallint, 'may_june', '61', 7, '6')
),
question_texts as (
    select
        question.id as question_id,
        concat_ws(
            E'\n\n',
            nullif(question.stem_markdown, ''),
            string_agg(
                format(
                    'Part %s: %s',
                    array_to_string(part.label_path, '.'),
                    part.prompt_markdown
                ),
                E'\n\n'
                order by part.sort_order
            ) filter (where part.id is not null)
        ) as full_question_text
    from public.shamo_questions as question
    left join public.shamo_question_parts as part
      on part.question_id = question.id
     and part.ingestion_run_id = question.ingestion_run_id
    group by question.id, question.stem_markdown
),
seeds as (
    select
        spec.seed_name,
        spec.expected_component,
        seed_paper.year as seed_year,
        seed_paper.exam_session as seed_exam_session,
        seed_paper.paper_variant as seed_paper_variant,
        left(seed_paper.paper_variant, 1) as seed_component,
        seed_question.question_number as seed_question_number,
        seed_question.id as seed_question_id,
        seed_question.total_marks as seed_total_marks,
        seed_text.full_question_text as seed_question_text,
        seed_metadata.main_topic as seed_main_topic,
        seed_metadata.subtopics as seed_subtopics,
        seed_search.embedding
    from seed_specs as spec
    join public.shamo_papers as seed_paper
      on seed_paper.qualification = 'a_level'
     and seed_paper.syllabus_code = '9709'
     and seed_paper.year = spec.year
     and seed_paper.exam_session = spec.exam_session
     and seed_paper.paper_variant = spec.paper_variant
     and seed_paper.status = 'published'
    join public.shamo_questions as seed_question
      on seed_question.paper_id = seed_paper.id
     and seed_question.ingestion_run_id = seed_paper.current_ingestion_run_id
     and seed_question.question_number = spec.question_number
    join public.shamo_question_search as seed_search
      on seed_search.question_id = seed_question.id
     and seed_search.ingestion_run_id = seed_question.ingestion_run_id
     and seed_search.question_part_id is null
     and seed_search.content_kind = 'question'
    join question_texts as seed_text
      on seed_text.question_id = seed_question.id
    left join public.shamo_question_metadata as seed_metadata
      on seed_metadata.question_id = seed_question.id
     and seed_metadata.ingestion_run_id = seed_question.ingestion_run_id
),
component_pool as (
    select
        seed.seed_name,
        count(distinct paper.id) as same_component_paper_count,
        count(distinct question.id) filter (
            where question.id <> seed.seed_question_id
        ) as same_component_other_question_count,
        count(distinct question.id) filter (
            where question.id <> seed.seed_question_id
              and paper.id <> seed_paper.id
        ) as same_component_cross_paper_question_count
    from seeds as seed
    join public.shamo_papers as seed_paper
      on seed_paper.qualification = 'a_level'
     and seed_paper.syllabus_code = '9709'
     and seed_paper.year = seed.seed_year
     and seed_paper.exam_session = seed.seed_exam_session
     and seed_paper.paper_variant = seed.seed_paper_variant
    join public.shamo_papers as paper
      on paper.qualification = seed_paper.qualification
     and paper.syllabus_code = seed_paper.syllabus_code
     and paper.status = 'published'
     and left(paper.paper_variant, 1) = seed.seed_component
    join public.shamo_questions as question
      on question.paper_id = paper.id
     and question.ingestion_run_id = paper.current_ingestion_run_id
    group by seed.seed_name
),
wide_matches as (
    select
        seed.seed_name,
        matched.*
    from seeds as seed
    cross join lateral public.shamo_match_similar_questions(
        seed.embedding,
        50,
        'a_level',
        '9709',
        seed.seed_question_id
    ) as matched
    where left(matched.paper_variant, 1) = seed.seed_component
),
ranked_component_matches as (
    select
        wide.seed_name,
        row_number() over (
            partition by wide.seed_name
            order by wide.similarity desc
        ) as component_rank,
        wide.question_id,
        wide.question_part_id,
        wide.qualification,
        wide.syllabus_code,
        wide.year,
        wide.exam_session,
        wide.paper_variant,
        wide.question_number,
        wide.similarity
    from wide_matches as wide
)
select
    seed.seed_name,
    seed.expected_component as paper_component,
    case seed.expected_component
        when '1' then 'Paper 1 / Pure Mathematics 1'
        when '2' then 'Paper 2 / Pure Mathematics 2'
        when '3' then 'Paper 3 / Pure Mathematics 3'
        when '4' then 'Paper 4 / Mechanics'
        when '5' then 'Paper 5 / Probability and Statistics 1'
        when '6' then 'Paper 6 / Probability and Statistics 2'
        else 'Unknown'
    end as component_label,
    pool.same_component_paper_count,
    pool.same_component_other_question_count,
    pool.same_component_cross_paper_question_count,
    case
        when pool.same_component_paper_count < 2 then
            'insufficient cross-paper same-component corpus; smoke test only'
        else
            'cross-paper same-component corpus available'
    end as benchmark_scope,
    format(
        '9709/%s %s %s Q%s',
        seed.seed_paper_variant,
        seed.seed_exam_session,
        seed.seed_year,
        seed.seed_question_number
    ) as seed_question_ref,
    seed.seed_main_topic,
    seed.seed_subtopics,
    seed.seed_total_marks,
    seed.seed_question_text,
    match.component_rank,
    round(match.similarity::numeric, 4) as similarity,
    format(
        '9709/%s %s %s Q%s',
        match.paper_variant,
        match.exam_session,
        match.year,
        match.question_number
    ) as matched_question_ref,
    matched_metadata.main_topic as matched_main_topic,
    matched_metadata.subtopics as matched_subtopics,
    matched_question.total_marks as matched_total_marks,
    matched_text.full_question_text as matched_question_text
from seeds as seed
join component_pool as pool
  on pool.seed_name = seed.seed_name
left join ranked_component_matches as match
  on match.seed_name = seed.seed_name
 and match.component_rank <= 5
left join public.shamo_questions as matched_question
  on matched_question.id = match.question_id
left join question_texts as matched_text
  on matched_text.question_id = matched_question.id
left join public.shamo_question_metadata as matched_metadata
  on matched_metadata.question_id = matched_question.id
 and matched_metadata.ingestion_run_id = matched_question.ingestion_run_id
-- To review one seed at a time, uncomment and edit the next line:
-- where seed.seed_name = '21_q7_partial_fractions'
order by seed.seed_name, match.component_rank nulls last;
