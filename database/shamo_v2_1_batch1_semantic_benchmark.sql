-- Shamo v2.1: 18-seed semantic-retrieval benchmark candidate set.
--
-- This query is read-only and makes no embedding/provider API calls. It uses
-- stored whole-question vectors, excludes each seed, asks for five deduplicated
-- main-question matches, and returns the evidence needed for graded review.

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
seeds as (
    select
        spec.seed_name,
        spec.expected_domain,
        question.id as seed_question_id,
        search_item.embedding
    from seed_specs as spec
    join public.shamo_papers as paper
      on paper.qualification = 'a_level'
     and paper.syllabus_code = '9709'
     and paper.year = spec.year
     and paper.exam_session = spec.exam_session
     and paper.paper_variant = spec.paper_variant
     and paper.status = 'published'
    join public.shamo_questions as question
      on question.paper_id = paper.id
     and question.ingestion_run_id = paper.current_ingestion_run_id
     and question.question_number = spec.question_number
    join public.shamo_question_search as search_item
      on search_item.question_id = question.id
     and search_item.ingestion_run_id = question.ingestion_run_id
     and search_item.question_part_id is null
     and search_item.content_kind = 'question'
),
matches as (
    select
        seed.seed_name,
        seed.expected_domain,
        row_number() over (
            partition by seed.seed_name
            order by matched.similarity desc
        ) as rank,
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
    matches.seed_name,
    matches.expected_domain,
    matches.rank,
    matches.year,
    matches.exam_session,
    matches.paper_variant,
    matches.question_number,
    round(matches.similarity::numeric, 4) as similarity,
    case left(matches.paper_variant, 1)
        when '4' then 'mechanics'
        when '5' then 'statistics'
        when '6' then 'statistics'
        else 'pure'
    end as matched_domain,
    metadata.main_topic,
    metadata.subtopics,
    left(search_item.content, 240) as content_preview
from matches
join public.shamo_question_search as search_item
  on search_item.question_id = matches.question_id
 and search_item.question_part_id is not distinct from matches.question_part_id
 and search_item.content_kind = 'question'
left join public.shamo_question_metadata as metadata
  on metadata.question_id = matches.question_id
 and metadata.ingestion_run_id = search_item.ingestion_run_id
order by matches.seed_name, matches.rank;
