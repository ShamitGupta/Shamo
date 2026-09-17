-- Shamo v2.1: semantic benchmark review sheet.
--
-- Read-only. No embedding/provider API calls.
-- Use this to review the 18 semantic seeds with the full seed question and
-- the five matched whole-question results returned by shamo_match_similar_questions.

with
seed_specs(
    seed_name,
    year,
    exam_session,
    paper_variant,
    question_number,
    expected_domain
) as (
    values
        ('12_q1_improper_integral', 2024::smallint, 'feb_march', '12', 1, 'pure'),
        ('12_q6_binomial_expansion', 2024::smallint, 'feb_march', '12', 6, 'pure'),
        ('12_q10_circle_geometry', 2024::smallint, 'feb_march', '12', 10, 'pure'),
        ('21_q2_implicit_differentiation', 2024::smallint, 'may_june', '21', 2, 'pure'),
        ('21_q6_integration_volume', 2024::smallint, 'may_june', '21', 6, 'pure'),
        ('21_q7_partial_fractions', 2024::smallint, 'may_june', '21', 7, 'pure'),
        ('32_q3_logs', 2024::smallint, 'may_june', '32', 3, 'pure'),
        ('32_q8_vectors', 2024::smallint, 'may_june', '32', 8, 'pure'),
        ('32_q9_complex', 2024::smallint, 'may_june', '32', 9, 'pure'),
        ('41_q2_collisions', 2025::smallint, 'oct_nov', '41', 2, 'mechanics'),
        ('41_q5_statics_friction', 2025::smallint, 'oct_nov', '41', 5, 'mechanics'),
        ('41_q7_kinematics', 2025::smallint, 'oct_nov', '41', 7, 'mechanics'),
        ('52_q2_binomial_geometric', 2024::smallint, 'feb_march', '52', 2, 'statistics'),
        ('52_q3_histogram', 2024::smallint, 'feb_march', '52', 3, 'statistics'),
        ('52_q6_permutations', 2024::smallint, 'feb_march', '52', 6, 'statistics'),
        ('61_q1_poisson', 2024::smallint, 'may_june', '61', 1, 'statistics'),
        ('61_q3_confidence_interval', 2024::smallint, 'may_june', '61', 3, 'statistics'),
        ('61_q7_hypothesis_test', 2024::smallint, 'may_june', '61', 7, 'statistics')
),
provisional_labels(
    seed_name,
    grades_rank_1_to_5,
    note
) as (
    values
        ('12_q1_improper_integral', '2|2|0|0|0', 'Two calculus-adjacent results; three unrelated results'),
        ('12_q6_binomial_expansion', '3|0|0|1|1', 'One strong binomial peer; remaining results weak or unrelated'),
        ('12_q10_circle_geometry', '3|2|1|0|0', 'One strong coordinate/circle peer and one meaningful adjacent result'),
        ('21_q2_implicit_differentiation', '3|2|2|2|0', 'Strong calculus neighbourhood'),
        ('21_q6_integration_volume', '1|2|3|1|2', 'One strong and two adjacent integration/calculus results'),
        ('21_q7_partial_fractions', '1|1|1|1|0', 'Known partial-fractions peer was below the top five at rank 29'),
        ('32_q3_logs', '0|1|0|2|0', 'Sparse log coverage; only one meaningfully adjacent result'),
        ('32_q8_vectors', '1|1|1|1|0', 'No vector peer in the current top five'),
        ('32_q9_complex', '1|2|2|0|1', 'Two meaningful algebra/geometry-adjacent results'),
        ('41_q2_collisions', '3|2|2|1|2', 'Strong mechanics neighbourhood with four useful results'),
        ('41_q5_statics_friction', '3|3|1|1|1', 'Two strong statics/forces peers'),
        ('41_q7_kinematics', '2|3|1|1|0', 'Two useful kinematics/mechanics peers'),
        ('52_q2_binomial_geometric', '2|3|2|2|2', 'All five are meaningful probability/distribution practice'),
        ('52_q3_histogram', '1|1|1|0|1', 'No histogram peer; broad statistics matches only'),
        ('52_q6_permutations', '1|0|1|0|0', 'No useful counting/permutations peer'),
        ('61_q1_poisson', '3|1|1|2|3', 'Two strong Poisson peers and one related distribution result'),
        ('61_q3_confidence_interval', '2|1|2|3|2', 'Strong inferential-statistics neighbourhood'),
        ('61_q7_hypothesis_test', '1|1|1|1|2', 'Known hypothesis-testing peer was below the top five at rank 10')
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
        spec.expected_domain,
        seed_paper.year as seed_year,
        seed_paper.exam_session as seed_exam_session,
        seed_paper.paper_variant as seed_paper_variant,
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
matches as (
    select
        seed.seed_name,
        row_number() over (
            partition by seed.seed_name
            order by matched.similarity desc
        ) as match_rank,
        matched.*
    from seeds as seed
    cross join lateral public.shamo_match_similar_questions(
        seed.embedding,
        5,
        'a_level',
        '9709',
        seed.seed_question_id
    ) as matched
)
select
    seed.seed_name,
    seed.expected_domain,
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
    match.match_rank,
    split_part(label.grades_rank_1_to_5, '|', match.match_rank::integer)::integer as provisional_grade,
    label.note as provisional_note,
    round(match.similarity::numeric, 4) as similarity,
    case left(match.paper_variant, 1)
        when '4' then 'mechanics'
        when '5' then 'statistics'
        when '6' then 'statistics'
        else 'pure'
    end as matched_domain,
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
join matches as match
  on match.seed_name = seed.seed_name
join provisional_labels as label
  on label.seed_name = seed.seed_name
join public.shamo_questions as matched_question
  on matched_question.id = match.question_id
join question_texts as matched_text
  on matched_text.question_id = matched_question.id
left join public.shamo_question_metadata as matched_metadata
  on matched_metadata.question_id = matched_question.id
 and matched_metadata.ingestion_run_id = matched_question.ingestion_run_id
-- To review one seed at a time, uncomment and edit the next line:
-- where seed.seed_name = '21_q7_partial_fractions'
order by seed.seed_name, match.match_rank;
