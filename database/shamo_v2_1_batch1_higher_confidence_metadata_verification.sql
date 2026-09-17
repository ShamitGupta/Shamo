-- Read-only verification for the batch-1 higher-confidence metadata review.

with expected(question_id, expected_topic, expected_calculator, expected_diagram) as (
    values
      ('96326150-b81f-4c20-9ca9-b4317c60a0c0'::uuid, 'Trigonometry', false, true),
      ('00aa07dd-ceb0-46cf-971a-6b91ab640abd'::uuid, 'Calculus', false, false),
      ('1b7d8beb-932d-408e-88dc-03a8ecba5cfd'::uuid, 'Calculus', false, false),
      ('87d8b57a-dfae-4bf7-8853-051b4b83501a'::uuid, 'Algebra', false, false),
      ('f4f2ad88-9166-4dfe-8c2d-11e09f3832e9'::uuid, 'Coordinate Geometry', true, true),
      ('2a39e39c-d02e-464d-b2dc-eae61a4e9209'::uuid, 'Calculus', false, false),
      ('366aa272-dcdc-4d97-97b6-3115b17a4a48'::uuid, 'Calculus', false, false),
      ('ecfc4b1d-22c8-48ae-98c1-ea251a27478c'::uuid, 'Calculus', true, false),
      ('902e4396-9b17-4184-bbcc-abfc1122a036'::uuid, 'Calculus', true, false),
      ('007ce42b-5e1b-4028-8241-96ff15d62084'::uuid, 'Functions', false, false),
      ('36317e70-9ea8-46d1-9a3d-4569a9a5fa0e'::uuid, 'Algebra', false, false),
      ('50e1e870-c433-445a-82e5-619533f0eed2'::uuid, 'Exponential and Logarithmic Functions', false, false),
      ('be072e3b-ecee-4299-a911-2b370380c680'::uuid, 'Calculus', false, false),
      ('cda867e2-e1f0-4623-8667-891e34fc86e1'::uuid, 'Calculus', false, false),
      ('cc3380cd-bc63-459f-a63b-4b3df48e375e'::uuid, 'Trigonometry', false, false),
      ('94b4d05d-df24-4682-a5c3-05f40bc6e59e'::uuid, 'Vectors', false, false),
      ('2bbc7a79-af1b-4233-8546-d123ea09df18'::uuid, 'Calculus', true, false),
      ('d127f0db-0ea5-418d-9504-ab66c0d13970'::uuid, 'Mechanics', false, false),
      ('736807bb-ed6d-4034-93bd-7efed0905ada'::uuid, 'Mechanics', false, false),
      ('c2a674fe-75d9-4982-b49a-55dbdbf3b999'::uuid, 'Mechanics', true, true),
      ('1b545fe3-9a82-41e0-a1e1-85ca410ee68c'::uuid, 'Mechanics', false, false),
      ('0ffba2e0-4cdd-4f25-8c26-44fbaefe5113'::uuid, 'Mechanics', true, true)
), checks as (
    select paper.paper_variant, question.question_number,
           metadata.main_topic, metadata.calculator_required,
           metadata.diagram_required, metadata.classification_confidence,
           metadata.review_status, metadata.reviewer_note,
           case when metadata.main_topic = expected.expected_topic
                  and metadata.calculator_required = expected.expected_calculator
                  and metadata.diagram_required = expected.expected_diagram
                  and metadata.classification_confidence >= 0.75
                  and metadata.review_status = 'approved'
                  and metadata.reviewer_note like 'Codex source-reviewed at operator request against official%'
                then 'PASS' else 'FAIL' end as result
    from expected
    join public.shamo_question_metadata metadata on metadata.question_id=expected.question_id
    join public.shamo_questions question on question.id=metadata.question_id
    join public.shamo_papers paper on paper.id=question.paper_id
)
select * from checks order by paper_variant, question_number;

-- Expected: one PASS row with 49 approved and zero pending.
select
    count(*) filter (where review_status='approved') as approved,
    count(*) filter (where review_status='pending') as pending,
    case when count(*) filter (where review_status='approved')=49
           and count(*) filter (where review_status='pending')=0
         then 'PASS' else 'FAIL' end as result
from public.shamo_question_metadata;

-- Exact corrected metadata assertions. Expected: one PASS row.
select case when
    (select main_topic from public.shamo_question_metadata where question_id='1b7d8beb-932d-408e-88dc-03a8ecba5cfd'::uuid)='Calculus'
    and (select subtopics from public.shamo_question_metadata where question_id='00aa07dd-ceb0-46cf-971a-6b91ab640abd'::uuid)
        @> array['Integration from a derivative function']::text[]
    and (select methods from public.shamo_question_metadata where question_id='36317e70-9ea8-46d1-9a3d-4569a9a5fa0e'::uuid)
        @> array['Use polynomial division, or start with a constant plus two proper partial fractions']::text[]
    and (select methods from public.shamo_question_metadata where question_id='be072e3b-ecee-4299-a911-2b370380c680'::uuid)
        @> array['Substitute y=1 into the curve equation and solve e^(2x)+e^x-6=0 to obtain e^x=2']::text[]
    and (select methods from public.shamo_question_metadata where question_id='1b545fe3-9a82-41e0-a1e1-85ca410ee68c'::uuid)
        @> array['Use conservation of linear momentum with the stated velocities of A and B to obtain A''s post-collision speed']::text[]
    and (select methods from public.shamo_question_metadata where question_id='0ffba2e0-4cdd-4f25-8c26-44fbaefe5113'::uuid)
        @> array['For B, use T cos(15 degrees)=0.5(1.2) to find the tension']::text[]
    then 'PASS' else 'FAIL' end as result;

-- Expected: ten matching resolved correction issues.
select count(*) as correction_issue_count,
       count(*) filter (where resolved) as resolved_count,
       case when count(*)=10 and count(*) filter(where resolved)=10
            then 'PASS' else 'FAIL' end as result
from public.shamo_ingestion_issues
where issue_code='POST_PUBLICATION_METADATA_CORRECTED'
  and message in (
    'Variant 12 Question 3 metadata included Differentiation although the given derivative must be integrated.',
    'Variant 12 Question 5 was broadly classified as Coordinate Geometry although differentiation and the normal gradient are the principal method.',
    'Variant 12 Question 11 had diagram_required=true although the equation and text fully define the assessed tasks.',
    'Variant 21 Question 6 had diagram_required=true although the equation and explicit bounds fully define the assessed tasks.',
    'Variant 32 Question 1 had diagram_required=true although the candidate is asked to draw the graph and no source diagram is supplied.',
    'Variant 32 Question 2 metadata incorrectly described factorising the numerator and omitted the improper-fraction step.',
    'Variant 32 Question 4 metadata used an inaccurate parametric label and omitted solving e^x=2 before differentiating.',
    'Variant 32 Question 6 had diagram_required=true although the equation and definition of M fully define the exact tasks.',
    'Variant 41 Question 6 metadata invented coefficient-of-restitution and energy methods not used by the official solution.',
    'Variant 41 Question 8 metadata inaccurately described the force equations for the two connected bodies.'
  );

-- Embedding integrity is unchanged. Expected: 164 valid vectors and no pending candidates.
select count(*) as search_rows,
       count(*) filter(where embedding is not null and vector_dims(embedding)=512) as valid_512_vectors,
       (select count(*) from public.shamo_get_pending_search_items(1000)) as pending_candidates,
       case when count(*)=164
              and count(*) filter(where embedding is not null and vector_dims(embedding)=512)=164
              and (select count(*) from public.shamo_get_pending_search_items(1000))=0
            then 'PASS' else 'FAIL' end as result
from public.shamo_question_search;
