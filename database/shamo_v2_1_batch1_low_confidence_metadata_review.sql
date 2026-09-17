-- Shamo v2.1: source review at operator request of the 11 remaining batch-1 metadata
-- rows whose model classification confidence is below 0.75.
--
-- Review basis: the official question paper and mark scheme for each row.
-- The original classification_confidence is deliberately preserved as
-- pipeline-performance evidence. All 11 rows are explicitly approved;
-- five receive source-grounded corrections and six are approved unchanged
-- apart from resolving nullable calculator_required values.
--
-- This script changes only shamo_question_metadata and appends resolved
-- audit issues for the five substantive corrections. Existing question text,
-- parts, marks, assets, search text and embedding vectors are not changed.
-- Run this whole file once.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $low_confidence_metadata_review_guard$
declare
    matching_paper_count integer;
    matching_metadata_count integer;
begin
    select count(*)
    into matching_paper_count
    from public.shamo_papers as paper
    join public.shamo_ingestion_runs as run
      on run.id = paper.current_ingestion_run_id
     and run.paper_id = paper.id
    where paper.syllabus_code = '9709'
      and paper.status = 'published'
      and run.status = 'complete'
      and run.review_status = 'approved'
      and (
        (paper.id = 'df50b0d6-0483-47ab-8192-798e5083a88d'::uuid
          and run.id = '414a7734-2afe-4bab-9896-02649106d027'::uuid)
        or
        (paper.id = '4f105c50-6624-4e0a-a429-44c24d53d3e6'::uuid
          and run.id = '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid)
        or
        (paper.id = '3987e648-872d-4649-9fa1-e234ab2516c8'::uuid
          and run.id = '466116cc-75de-423e-9745-e2e401cfbe29'::uuid)
        or
        (paper.id = '03382be6-bf6d-420e-b356-6a899a11a88c'::uuid
          and run.id = '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid)
      );

    if matching_paper_count <> 4 then
        raise exception
            'Safety stop: expected four current complete/approved papers; found %.',
            matching_paper_count;
    end if;

    perform metadata.question_id
    from public.shamo_question_metadata as metadata
    where metadata.question_id in (
        'fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid,
        '34c2f758-fbee-498b-933a-6b737d314cb4'::uuid,
        '74471b59-675a-481b-baf4-cbb492e30242'::uuid,
        'ee33189f-ded4-4c5e-b662-ec2a895fc1d6'::uuid,
        '267bf081-b73d-4c3b-9ae5-4ba105e8082f'::uuid,
        '4cd99f3d-db70-4603-b6fb-e39d46c3b439'::uuid,
        '1890afc9-803f-4737-831e-fd60b6c6ab04'::uuid,
        '43ccbfa4-750d-470d-a892-29955a2ffe71'::uuid,
        'dde23047-a204-4df1-90ca-a37ee7a96591'::uuid,
        'f6fe2e9a-ba11-4478-9af8-4aa0666faf51'::uuid,
        '406d434c-6998-44ab-9028-b107903ee3fd'::uuid
    )
    order by metadata.question_id
    for update;

    select count(*)
    into matching_metadata_count
    from public.shamo_question_metadata as metadata
    join public.shamo_questions as question
      on question.id = metadata.question_id
     and question.ingestion_run_id = metadata.ingestion_run_id
    join public.shamo_papers as paper
      on paper.id = question.paper_id
     and paper.current_ingestion_run_id = metadata.ingestion_run_id
    where metadata.question_id in (
        'fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid,
        '34c2f758-fbee-498b-933a-6b737d314cb4'::uuid,
        '74471b59-675a-481b-baf4-cbb492e30242'::uuid,
        'ee33189f-ded4-4c5e-b662-ec2a895fc1d6'::uuid,
        '267bf081-b73d-4c3b-9ae5-4ba105e8082f'::uuid,
        '4cd99f3d-db70-4603-b6fb-e39d46c3b439'::uuid,
        '1890afc9-803f-4737-831e-fd60b6c6ab04'::uuid,
        '43ccbfa4-750d-470d-a892-29955a2ffe71'::uuid,
        'dde23047-a204-4df1-90ca-a37ee7a96591'::uuid,
        'f6fe2e9a-ba11-4478-9af8-4aa0666faf51'::uuid,
        '406d434c-6998-44ab-9028-b107903ee3fd'::uuid
    )
      and metadata.review_status = 'pending'
      and metadata.reviewer_note is null
      and metadata.classification_confidence < 0.75;

    if matching_metadata_count <> 11 then
        raise exception
            'Safety stop: expected exactly 11 pending low-confidence rows; found %.',
            matching_metadata_count;
    end if;

    if not exists (
        select 1
        from public.shamo_question_metadata
        where question_id = 'fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid
          and main_topic = 'Trigonometry'
          and methods @> array[
              'Use the identity to reduce the equation to tan(theta)=5/4, then apply the stated interval'
          ]::text[]
    ) then
        raise exception
            'Safety stop: variant 12 Question 4 no longer has the reviewed incorrect method.';
    end if;

    if not exists (
        select 1
        from public.shamo_question_metadata
        where question_id = '1890afc9-803f-4737-831e-fd60b6c6ab04'::uuid
          and main_topic = 'Algebra'
    ) then
        raise exception
            'Safety stop: variant 21 Question 7 no longer has the reviewed Algebra topic.';
    end if;

    if not exists (
        select 1
        from public.shamo_question_metadata
        where question_id = '43ccbfa4-750d-470d-a892-29955a2ffe71'::uuid
          and main_topic = 'Calculus'
    ) then
        raise exception
            'Safety stop: variant 32 Question 5 no longer has the reviewed Calculus topic.';
    end if;

    if not exists (
        select 1
        from public.shamo_question_metadata
        where question_id = 'dde23047-a204-4df1-90ca-a37ee7a96591'::uuid
          and diagram_required = true
    ) then
        raise exception
            'Safety stop: variant 32 Question 9 no longer has diagram_required=true.';
    end if;

    if not exists (
        select 1
        from public.shamo_question_metadata
        where question_id = '406d434c-6998-44ab-9028-b107903ee3fd'::uuid
          and methods @> array[
              'kinematic relation using given final speed and height change'
          ]::text[]
    ) then
        raise exception
            'Safety stop: variant 41 Question 4 no longer has the reviewed kinematics method.';
    end if;
end;
$low_confidence_metadata_review_guard$;

-- Correct the five source-grounded discrepancies.
update public.shamo_question_metadata
set
    methods = array[
        'Expand the numerator and use sin^2(theta)+cos^2(theta)=1 to obtain 2tan(theta)',
        'Use the identity to solve 5tan^3(theta)=2tan(theta), retaining tan(theta)=0 and tan^2(theta)=2/5 before applying the stated interval'
    ]::text[],
    updated_at = now()
where question_id = 'fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid;

update public.shamo_question_metadata
set
    main_topic = 'Calculus',
    methods = array[
        'Divide p(x) by 3x+2 to relate the quotient and remainder to k',
        'Rewrite p(x)/[x(3x+2)] into integrable polynomial, reciprocal and partial-fraction terms',
        'Evaluate the definite integral and compare it with a+ln(64) to identify a and solve for k'
    ]::text[],
    updated_at = now()
where question_id = '1890afc9-803f-4737-831e-fd60b6c6ab04'::uuid;

update public.shamo_question_metadata
set
    main_topic = 'Numerical Methods',
    updated_at = now()
where question_id = '43ccbfa4-750d-470d-a892-29955a2ffe71'::uuid;

update public.shamo_question_metadata
set
    diagram_required = false,
    updated_at = now()
where question_id = 'dde23047-a204-4df1-90ca-a37ee7a96591'::uuid;

update public.shamo_question_metadata
set
    methods = array[
        'Apply a whole-system work-energy balance: potential energy lost by A equals potential energy gained by B plus kinetic energy gained and work done against resistance',
        'Use the common 0.75 m displacement and common 2 m/s speed of the connected particles to solve for m'
    ]::text[],
    updated_at = now()
where question_id = '406d434c-6998-44ab-9028-b107903ee3fd'::uuid;

-- Resolve nullable calculator flags and record one explicit source-review decision per
-- row. The confidence scores remain the original model values.
update public.shamo_question_metadata as metadata
set
    calculator_required = case metadata.question_id
        when 'fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid then true
        when '34c2f758-fbee-498b-933a-6b737d314cb4'::uuid then false
        when '74471b59-675a-481b-baf4-cbb492e30242'::uuid then false
        when 'ee33189f-ded4-4c5e-b662-ec2a895fc1d6'::uuid then true
        when '267bf081-b73d-4c3b-9ae5-4ba105e8082f'::uuid then true
        when '4cd99f3d-db70-4603-b6fb-e39d46c3b439'::uuid then true
        when '1890afc9-803f-4737-831e-fd60b6c6ab04'::uuid then false
        when '43ccbfa4-750d-470d-a892-29955a2ffe71'::uuid then true
        when 'dde23047-a204-4df1-90ca-a37ee7a96591'::uuid then false
        when 'f6fe2e9a-ba11-4478-9af8-4aa0666faf51'::uuid then true
        when '406d434c-6998-44ab-9028-b107903ee3fd'::uuid then false
        else metadata.calculator_required
    end,
    review_status = 'approved',
    reviewer_note = case metadata.question_id
        when 'fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid then
            'Codex source-reviewed at operator request against official QP page 5 and MS pages 7-8. Corrected the equation-solving method; the valid branches are tan(theta)=0 and tan^2(theta)=2/5.'
        when '34c2f758-fbee-498b-933a-6b737d314cb4'::uuid then
            'Codex source-reviewed at operator request against official QP page 9 and MS page 10. The progressions classification, skills and methods are accurate.'
        when '74471b59-675a-481b-baf4-cbb492e30242'::uuid then
            'Codex source-reviewed at operator request against official QP pages 10-11 and MS page 11. The Algebra/functions classification, skills and methods are accurate.'
        when 'ee33189f-ded4-4c5e-b662-ec2a895fc1d6'::uuid then
            'Codex source-reviewed at operator request against official QP page 2 and MS page 6. The Calculus classification is accurate; numerical evaluation to 3 significant figures requires a calculator.'
        when '267bf081-b73d-4c3b-9ae5-4ba105e8082f'::uuid then
            'Codex source-reviewed at operator request against official QP pages 4-5 and MS page 7. The Algebra classification is accurate; drawing a graph does not mean a source-provided diagram is required.'
        when '4cd99f3d-db70-4603-b6fb-e39d46c3b439'::uuid then
            'Codex source-reviewed at operator request against official QP pages 6-7 and MS page 8. The Trigonometry identity-and-equation classification is accurate.'
        when '1890afc9-803f-4737-831e-fd60b6c6ab04'::uuid then
            'Codex source-reviewed at operator request against official QP pages 12-13 and MS pages 12-13. Corrected the main topic to Calculus because the six-mark principal task is integration, while retaining the polynomial subtopic.'
        when '43ccbfa4-750d-470d-a892-29955a2ffe71'::uuid then
            'Codex source-reviewed at operator request against official QP page 7 and MS page 12. Corrected the main topic from Calculus to Numerical Methods; the question uses root bracketing and fixed-point iteration.'
        when 'dde23047-a204-4df1-90ca-a37ee7a96591'::uuid then
            'Codex source-reviewed at operator request against official QP pages 14-15 and MS pages 17-19. Corrected diagram_required to false; the mark scheme explicitly says the diagram is not required.'
        when 'f6fe2e9a-ba11-4478-9af8-4aa0666faf51'::uuid then
            'Codex source-reviewed at operator request against official QP page 4 and MS pages 11-12. The Mechanics resultant classification and required source-diagram flag are accurate.'
        when '406d434c-6998-44ab-9028-b107903ee3fd'::uuid then
            'Codex source-reviewed at operator request against official QP page 5 and MS page 13. Replaced the kinematics-method wording with the required whole-system energy balance.'
        else metadata.reviewer_note
    end,
    updated_at = now()
where metadata.question_id in (
    'fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid,
    '34c2f758-fbee-498b-933a-6b737d314cb4'::uuid,
    '74471b59-675a-481b-baf4-cbb492e30242'::uuid,
    'ee33189f-ded4-4c5e-b662-ec2a895fc1d6'::uuid,
    '267bf081-b73d-4c3b-9ae5-4ba105e8082f'::uuid,
    '4cd99f3d-db70-4603-b6fb-e39d46c3b439'::uuid,
    '1890afc9-803f-4737-831e-fd60b6c6ab04'::uuid,
    '43ccbfa4-750d-470d-a892-29955a2ffe71'::uuid,
    'dde23047-a204-4df1-90ca-a37ee7a96591'::uuid,
    'f6fe2e9a-ba11-4478-9af8-4aa0666faf51'::uuid,
    '406d434c-6998-44ab-9028-b107903ee3fd'::uuid
);

insert into public.shamo_ingestion_issues (
    ingestion_run_id,
    severity,
    issue_code,
    document_type,
    question_number,
    part_path,
    message,
    resolved,
    resolution_note,
    resolved_at
)
select
    correction.ingestion_run_id,
    'warning',
    'POST_PUBLICATION_METADATA_CORRECTED',
    'question_paper',
    correction.question_number,
    null,
    correction.message,
    true,
    correction.resolution_note,
    now()
from (
    values
        (
            '414a7734-2afe-4bab-9896-02649106d027'::uuid,
            4,
            'Variant 12 Question 4 metadata contained the incorrect equation-solving branch tan(theta)=5/4.',
            'Replaced it with the official branches tan(theta)=0 and tan^2(theta)=2/5.'
        ),
        (
            '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
            7,
            'Variant 21 Question 7 was broadly classified as Algebra although its principal six-mark task is integration.',
            'Changed main_topic to Calculus and retained polynomial and partial-fraction detail in subtopics and methods.'
        ),
        (
            '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
            5,
            'Variant 32 Question 5 was classified as Calculus although it asks for root bracketing and fixed-point iteration.',
            'Changed main_topic to Numerical Methods.'
        ),
        (
            '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
            9,
            'Variant 32 Question 9 had diagram_required=true although no source-provided diagram must be interpreted.',
            'Set diagram_required=false, consistent with the official mark-scheme note that the diagram is not required.'
        ),
        (
            '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid,
            4,
            'Variant 41 Question 4 metadata named a kinematic method although the question explicitly requires an energy method.',
            'Replaced the method wording with the official whole-system work-energy balance.'
        )
) as correction(
    ingestion_run_id,
    question_number,
    message,
    resolution_note
)
where not exists (
    select 1
    from public.shamo_ingestion_issues as existing
    where existing.ingestion_run_id = correction.ingestion_run_id
      and existing.issue_code = 'POST_PUBLICATION_METADATA_CORRECTED'
      and existing.question_number = correction.question_number
      and existing.message = correction.message
);

commit;

-- Immediate summary. Expected: 11 approved rows, 0 pending low-confidence rows.
select
    count(*) as reviewed_rows,
    count(*) filter (where metadata.review_status = 'approved') as approved_rows,
    count(*) filter (
        where metadata.review_status = 'pending'
          and metadata.classification_confidence < 0.75
    ) as pending_low_confidence_rows
from public.shamo_question_metadata as metadata
where metadata.question_id in (
    'fdfebcd1-c90e-4b56-9e87-ed3a7b009923'::uuid,
    '34c2f758-fbee-498b-933a-6b737d314cb4'::uuid,
    '74471b59-675a-481b-baf4-cbb492e30242'::uuid,
    'ee33189f-ded4-4c5e-b662-ec2a895fc1d6'::uuid,
    '267bf081-b73d-4c3b-9ae5-4ba105e8082f'::uuid,
    '4cd99f3d-db70-4603-b6fb-e39d46c3b439'::uuid,
    '1890afc9-803f-4737-831e-fd60b6c6ab04'::uuid,
    '43ccbfa4-750d-470d-a892-29955a2ffe71'::uuid,
    'dde23047-a204-4df1-90ca-a37ee7a96591'::uuid,
    'f6fe2e9a-ba11-4478-9af8-4aa0666faf51'::uuid,
    '406d434c-6998-44ab-9028-b107903ee3fd'::uuid
);
