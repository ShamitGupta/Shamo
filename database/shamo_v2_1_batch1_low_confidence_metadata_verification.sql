-- Read-only verification for the batch-1 low-confidence metadata review.

with reviewed(question_id, expected_topic, expected_calculator, expected_diagram) as (
    values
        ('fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid, 'Trigonometry', true, false),
        ('34c2f758-fbee-498b-933a-6b737d314cb4'::uuid, 'Algebra', false, false),
        ('74471b59-675a-481b-baf4-cbb492e30242'::uuid, 'Algebra', false, false),
        ('ee33189f-ded4-4c5e-b662-ec2a895fc1d6'::uuid, 'Calculus', true, false),
        ('267bf081-b73d-4c3b-9ae5-4ba105e8082f'::uuid, 'Algebra', true, false),
        ('4cd99f3d-db70-4603-b6fb-e39d46c3b439'::uuid, 'Trigonometry', true, false),
        ('1890afc9-803f-4737-831e-fd60b6c6ab04'::uuid, 'Calculus', false, false),
        ('43ccbfa4-750d-470d-a892-29955a2ffe71'::uuid, 'Numerical Methods', true, false),
        ('dde23047-a204-4df1-90ca-a37ee7a96591'::uuid, 'Complex Numbers', false, false),
        ('f6fe2e9a-ba11-4478-9af8-4aa0666faf51'::uuid, 'Mechanics', true, true),
        ('406d434c-6998-44ab-9028-b107903ee3fd'::uuid, 'Mechanics', false, true)
),
checks as (
    select
        paper.paper_variant,
        question.question_number,
        metadata.main_topic,
        metadata.calculator_required,
        metadata.diagram_required,
        metadata.classification_confidence,
        metadata.review_status,
        metadata.reviewer_note,
        case
            when metadata.main_topic = reviewed.expected_topic
             and metadata.calculator_required = reviewed.expected_calculator
             and metadata.diagram_required = reviewed.expected_diagram
             and metadata.classification_confidence < 0.75
             and metadata.review_status = 'approved'
             and metadata.reviewer_note like 'Codex source-reviewed at operator request against official%'
             and (
                question.id <> 'fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid
                or metadata.methods @> array[
                    'Use the identity to solve 5tan^3(theta)=2tan(theta), retaining tan(theta)=0 and tan^2(theta)=2/5 before applying the stated interval'
                ]::text[]
             )
             and (
                question.id <> '406d434c-6998-44ab-9028-b107903ee3fd'::uuid
                or metadata.methods @> array[
                    'Apply a whole-system work-energy balance: potential energy lost by A equals potential energy gained by B plus kinetic energy gained and work done against resistance'
                ]::text[]
             )
            then 'PASS'
            else 'FAIL'
        end as result
    from reviewed
    join public.shamo_question_metadata as metadata
      on metadata.question_id = reviewed.question_id
    join public.shamo_questions as question
      on question.id = metadata.question_id
     and question.ingestion_run_id = metadata.ingestion_run_id
    join public.shamo_papers as paper
      on paper.id = question.paper_id
     and paper.current_ingestion_run_id = metadata.ingestion_run_id
)
select *
from checks
order by paper_variant, question_number;

-- Expected: one PASS row with approved=27, pending=22 and pending_low=0.
select
    count(*) filter (where review_status = 'approved') as approved,
    count(*) filter (where review_status = 'pending') as pending,
    count(*) filter (
        where review_status = 'pending'
          and classification_confidence < 0.75
    ) as pending_low,
    case
        when count(*) filter (where review_status = 'approved') = 27
         and count(*) filter (where review_status = 'pending') = 22
         and count(*) filter (
            where review_status = 'pending'
              and classification_confidence < 0.75
         ) = 0
        then 'PASS'
        else 'FAIL'
    end as result
from public.shamo_question_metadata;

-- Expected: five matching resolved correction issues.
select
    count(*) as correction_issue_count,
    count(*) filter (where resolved) as resolved_count,
    case
        when count(*) = 5 and count(*) filter (where resolved) = 5
        then 'PASS'
        else 'FAIL'
    end as result
from public.shamo_ingestion_issues
where issue_code = 'POST_PUBLICATION_METADATA_CORRECTED'
  and message in (
    'Variant 12 Question 4 metadata contained the incorrect equation-solving branch tan(theta)=5/4.',
    'Variant 21 Question 7 was broadly classified as Algebra although its principal six-mark task is integration.',
    'Variant 32 Question 5 was classified as Calculus although it asks for root bracketing and fixed-point iteration.',
    'Variant 32 Question 9 had diagram_required=true although no source-provided diagram must be interpreted.',
    'Variant 41 Question 4 metadata named a kinematic method although the question explicitly requires an energy method.'
  );

-- Embedding integrity is unchanged. Expected: 164 valid vectors and no pending candidates.
select
    count(*) as search_rows,
    count(*) filter (
        where embedding is not null and vector_dims(embedding) = 512
    ) as valid_512_vectors,
    (select count(*) from public.shamo_get_pending_search_items(1000))
        as pending_candidates,
    case
        when count(*) = 164
         and count(*) filter (
            where embedding is not null and vector_dims(embedding) = 512
         ) = 164
         and (select count(*) from public.shamo_get_pending_search_items(1000)) = 0
        then 'PASS'
        else 'FAIL'
    end as result
from public.shamo_question_search;
