-- Shamo v2.1: source review at operator request of the 22 remaining
-- batch-1 metadata rows with classification confidence at or above 0.75.
--
-- The agreed sample exceeded the correction expansion threshold, so every
-- remaining row was checked against the official question paper and, where
-- method or calculator use mattered, the official mark scheme.
--
-- This script preserves classification_confidence and changes only metadata
-- plus resolved audit issues. Question content, marks, assets, search text and
-- embeddings are not changed. Run this whole file once.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $higher_confidence_metadata_review_guard$
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
    where paper.status = 'published'
      and run.status = 'complete'
      and run.review_status = 'approved'
      and (
        (paper.id = 'df50b0d6-0483-47ab-8192-798e5083a88d'::uuid
          and run.id = '414a7734-2afe-4bab-9896-02649106d027'::uuid)
        or (paper.id = '4f105c50-6624-4e0a-a429-44c24d53d3e6'::uuid
          and run.id = '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid)
        or (paper.id = '3987e648-872d-4649-9fa1-e234ab2516c8'::uuid
          and run.id = '466116cc-75de-423e-9745-e2e401cfbe29'::uuid)
        or (paper.id = '03382be6-bf6d-420e-b356-6a899a11a88c'::uuid
          and run.id = '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid)
      );

    if matching_paper_count <> 4 then
        raise exception 'Safety stop: expected four current complete/approved papers; found %.', matching_paper_count;
    end if;

    perform metadata.question_id
    from public.shamo_question_metadata as metadata
    where metadata.question_id in (
        '96326150-b81f-4c20-9ca9-b4317c60a0c0'::uuid,
        '00aa07dd-ceb0-46cf-971a-6b91ab640abd'::uuid,
        '1b7d8beb-932d-408e-88dc-03a8ecba5cfd'::uuid,
        '87d8b57a-dfae-4bf7-8853-051b4b83501a'::uuid,
        'f4f2ad88-9166-4dfe-8c2d-11e09f3832e9'::uuid,
        '2a39e39c-d02e-464d-b2dc-eae61a4e9209'::uuid,
        '366aa272-dcdc-4d97-97b6-3115b17a4a48'::uuid,
        'ecfc4b1d-22c8-48ae-98c1-ea251a27478c'::uuid,
        '902e4396-9b17-4184-bbcc-abfc1122a036'::uuid,
        '007ce42b-5e1b-4028-8241-96ff15d62084'::uuid,
        '36317e70-9ea8-46d1-9a3d-4569a9a5fa0e'::uuid,
        '50e1e870-c433-445a-82e5-619533f0eed2'::uuid,
        'be072e3b-ecee-4299-a911-2b370380c680'::uuid,
        'cda867e2-e1f0-4623-8667-891e34fc86e1'::uuid,
        'cc3380cd-bc63-459f-a63b-4b3df48e375e'::uuid,
        '94b4d05d-df24-4682-a5c3-05f40bc6e59e'::uuid,
        '2bbc7a79-af1b-4233-8546-d123ea09df18'::uuid,
        'd127f0db-0ea5-418d-9504-ab66c0d13970'::uuid,
        '736807bb-ed6d-4034-93bd-7efed0905ada'::uuid,
        'c2a674fe-75d9-4982-b49a-55dbdbf3b999'::uuid,
        '1b545fe3-9a82-41e0-a1e1-85ca410ee68c'::uuid,
        '0ffba2e0-4cdd-4f25-8c26-44fbaefe5113'::uuid
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
        '96326150-b81f-4c20-9ca9-b4317c60a0c0'::uuid,
        '00aa07dd-ceb0-46cf-971a-6b91ab640abd'::uuid,
        '1b7d8beb-932d-408e-88dc-03a8ecba5cfd'::uuid,
        '87d8b57a-dfae-4bf7-8853-051b4b83501a'::uuid,
        'f4f2ad88-9166-4dfe-8c2d-11e09f3832e9'::uuid,
        '2a39e39c-d02e-464d-b2dc-eae61a4e9209'::uuid,
        '366aa272-dcdc-4d97-97b6-3115b17a4a48'::uuid,
        'ecfc4b1d-22c8-48ae-98c1-ea251a27478c'::uuid,
        '902e4396-9b17-4184-bbcc-abfc1122a036'::uuid,
        '007ce42b-5e1b-4028-8241-96ff15d62084'::uuid,
        '36317e70-9ea8-46d1-9a3d-4569a9a5fa0e'::uuid,
        '50e1e870-c433-445a-82e5-619533f0eed2'::uuid,
        'be072e3b-ecee-4299-a911-2b370380c680'::uuid,
        'cda867e2-e1f0-4623-8667-891e34fc86e1'::uuid,
        'cc3380cd-bc63-459f-a63b-4b3df48e375e'::uuid,
        '94b4d05d-df24-4682-a5c3-05f40bc6e59e'::uuid,
        '2bbc7a79-af1b-4233-8546-d123ea09df18'::uuid,
        'd127f0db-0ea5-418d-9504-ab66c0d13970'::uuid,
        '736807bb-ed6d-4034-93bd-7efed0905ada'::uuid,
        'c2a674fe-75d9-4982-b49a-55dbdbf3b999'::uuid,
        '1b545fe3-9a82-41e0-a1e1-85ca410ee68c'::uuid,
        '0ffba2e0-4cdd-4f25-8c26-44fbaefe5113'::uuid
    )
      and metadata.review_status = 'pending'
      and metadata.reviewer_note is null
      and metadata.classification_confidence >= 0.75;

    if matching_metadata_count <> 22 then
        raise exception 'Safety stop: expected exactly 22 pending higher-confidence rows; found %.', matching_metadata_count;
    end if;

    if not exists (
        select 1 from public.shamo_question_metadata
        where question_id = '1b7d8beb-932d-408e-88dc-03a8ecba5cfd'::uuid
          and main_topic = 'Coordinate Geometry'
    ) then
        raise exception 'Safety stop: variant 12 Question 5 no longer has the reviewed Coordinate Geometry topic.';
    end if;

    if not exists (
        select 1 from public.shamo_question_metadata
        where question_id = '007ce42b-5e1b-4028-8241-96ff15d62084'::uuid
          and diagram_required = true
    ) then
        raise exception 'Safety stop: variant 32 Question 1 no longer has diagram_required=true.';
    end if;

    if not exists (
        select 1 from public.shamo_question_metadata
        where question_id = '1b545fe3-9a82-41e0-a1e1-85ca410ee68c'::uuid
          and skills @> array['apply coefficient of restitution/impulse-style momentum relation using given post-collision velocity for particle B']::text[]
    ) then
        raise exception 'Safety stop: variant 41 Question 6 no longer has the reviewed incorrect collision skill.';
    end if;
end;
$higher_confidence_metadata_review_guard$;

-- Ten source-grounded corrections.
update public.shamo_question_metadata
set subtopics = array[
        'Integration from a derivative function',
        'Recovering a curve equation from its gradient',
        'Finding constants from given points'
    ]::text[],
    updated_at = now()
where question_id = '00aa07dd-ceb0-46cf-971a-6b91ab640abd'::uuid;

update public.shamo_question_metadata
set main_topic = 'Calculus', updated_at = now()
where question_id = '1b7d8beb-932d-408e-88dc-03a8ecba5cfd'::uuid;

update public.shamo_question_metadata
set diagram_required = false, updated_at = now()
where question_id in (
    '2a39e39c-d02e-464d-b2dc-eae61a4e9209'::uuid,
    '902e4396-9b17-4184-bbcc-abfc1122a036'::uuid,
    '007ce42b-5e1b-4028-8241-96ff15d62084'::uuid,
    'cda867e2-e1f0-4623-8667-891e34fc86e1'::uuid
);

update public.shamo_question_metadata
set skills = array[
        'Divide an improper rational expression or include its constant term',
        'Factorise the denominator into linear factors',
        'Solve for the partial-fraction coefficients'
    ]::text[],
    methods = array[
        'Use polynomial division, or start with a constant plus two proper partial fractions',
        'Factor 2x^2-5x-12 as (2x+3)(x-4)',
        'Substitute convenient values or equate coefficients to obtain the constants'
    ]::text[],
    updated_at = now()
where question_id = '36317e70-9ea8-46d1-9a3d-4569a9a5fa0e'::uuid;

update public.shamo_question_metadata
set subtopics = array[
        'Implicit differentiation',
        'Exponential functions',
        'Gradients of curves'
    ]::text[],
    skills = array[
        'Use the curve condition y=1 to solve for e^x',
        'Differentiate products involving y and exponential functions implicitly',
        'Evaluate dy/dx at the resulting point'
    ]::text[],
    methods = array[
        'Substitute y=1 into the curve equation and solve e^(2x)+e^x-6=0 to obtain e^x=2',
        'Differentiate ye^(2x)+y^2e^x=6 implicitly using product and chain rules',
        'Substitute y=1 and e^x=2 into the derivative equation and solve for dy/dx'
    ]::text[],
    updated_at = now()
where question_id = 'be072e3b-ecee-4299-a911-2b370380c680'::uuid;

update public.shamo_question_metadata
set skills = array[
        'Find the acceleration and pre-collision speed of A down the smooth incline',
        'Apply conservation of linear momentum with a consistent signed direction',
        'Use constant-acceleration kinematics to find the stopping distance after collision'
    ]::text[],
    methods = array[
        'Use a=g sin(alpha) and v=u+at to obtain the speed of A immediately before impact',
        'Use conservation of linear momentum with the stated velocities of A and B to obtain A''s post-collision speed',
        'Use v^2=u^2+2as with deceleration g sin(alpha) to find the distance A travels up the plane'
    ]::text[],
    updated_at = now()
where question_id = '1b545fe3-9a82-41e0-a1e1-85ca410ee68c'::uuid;

update public.shamo_question_metadata
set skills = array[
        'Resolve the inclined tension on B horizontally and apply Newton''s second law',
        'Use vertical equilibrium for A to find its normal reaction',
        'Apply Newton''s second law horizontally to A to find the friction force',
        'Use F=mu R to determine the coefficient of friction'
    ]::text[],
    methods = array[
        'For B, use T cos(15 degrees)=0.5(1.2) to find the tension',
        'For A, use 6 sin(20 degrees)+R=2g+T sin(15 degrees)',
        'For A horizontally, use 6 cos(20 degrees)-T cos(15 degrees)-F=2(1.2)',
        'Calculate mu=F/R'
    ]::text[],
    updated_at = now()
where question_id = '0ffba2e0-4cdd-4f25-8c26-44fbaefe5113'::uuid;

-- Resolve calculator flags and record the individual source-review decision.
update public.shamo_question_metadata as metadata
set calculator_required = decision.calculator_required,
    review_status = 'approved',
    reviewer_note = decision.reviewer_note,
    updated_at = now()
from (
    values
      ('96326150-b81f-4c20-9ca9-b4317c60a0c0'::uuid, false, 'Codex source-reviewed at operator request against official QP page 3 and MS page 6. Trigonometry and graph-transformation metadata is accurate; the source graph identifies the relevant minimum point.'),
      ('00aa07dd-ceb0-46cf-971a-6b91ab640abd'::uuid, false, 'Codex source-reviewed at operator request against official QP page 4 and MS page 7. Removed the inaccurate Differentiation subtopic; the assessed method is integration from a derivative followed by use of a known point.'),
      ('1b7d8beb-932d-408e-88dc-03a8ecba5cfd'::uuid, false, 'Codex source-reviewed at operator request against official QP page 6 and MS page 8. Corrected main_topic to Calculus because differentiation and the normal gradient are the principal method.'),
      ('87d8b57a-dfae-4bf7-8853-051b4b83501a'::uuid, false, 'Codex source-reviewed at operator request against official QP page 7 and MS page 9. Algebra/binomial coefficient-extraction metadata is accurate.'),
      ('f4f2ad88-9166-4dfe-8c2d-11e09f3832e9'::uuid, true, 'Codex source-reviewed at operator request against official QP pages 12-13 and MS pages 12-13. Coordinate geometry, circle and segment methods are accurate; the shaded source diagram is required.'),
      ('2a39e39c-d02e-464d-b2dc-eae61a4e9209'::uuid, false, 'Codex source-reviewed at operator request against official QP pages 14-15 and MS pages 13-14. Set diagram_required=false because the equation and text fully define the turning point, intercepts and bounded-area task.'),
      ('366aa272-dcdc-4d97-97b6-3115b17a4a48'::uuid, false, 'Codex source-reviewed at operator request against official QP page 3 and MS page 6. Implicit-differentiation metadata is accurate.'),
      ('ecfc4b1d-22c8-48ae-98c1-ea251a27478c'::uuid, true, 'Codex source-reviewed at operator request against official QP pages 8-9 and MS pages 9-10. Calculus, bracketing and fixed-point iteration metadata is accurate.'),
      ('902e4396-9b17-4184-bbcc-abfc1122a036'::uuid, true, 'Codex source-reviewed at operator request against official QP pages 10-11 and MS pages 10-11. Set diagram_required=false because the equation and explicit bounds define both tasks; trapezium-rule evaluation requires a calculator.'),
      ('007ce42b-5e1b-4028-8241-96ff15d62084'::uuid, false, 'Codex source-reviewed at operator request against official QP page 3 and MS page 6. Set diagram_required=false because the candidate is asked to draw the graph and no source diagram is supplied.'),
      ('36317e70-9ea8-46d1-9a3d-4569a9a5fa0e'::uuid, false, 'Codex source-reviewed at operator request against official QP page 4 and MS pages 7-8. Replaced inaccurate numerator-factorisation wording with polynomial division, denominator factorisation and coefficient solving.'),
      ('50e1e870-c433-445a-82e5-619533f0eed2'::uuid, false, 'Codex source-reviewed at operator request against official QP page 5 and MS page 9. Exponential/logarithmic linearisation metadata is accurate.'),
      ('be072e3b-ecee-4299-a911-2b370380c680'::uuid, false, 'Codex source-reviewed at operator request against official QP page 6 and MS pages 10-11. Removed the parametric label and added the required e^x=2 step before implicit differentiation.'),
      ('cda867e2-e1f0-4623-8667-891e34fc86e1'::uuid, false, 'Codex source-reviewed at operator request against official QP pages 8-9 and MS page 13. Set diagram_required=false because the equation and definition of M fully determine the exact tasks.'),
      ('cc3380cd-bc63-459f-a63b-4b3df48e375e'::uuid, false, 'Codex source-reviewed at operator request against official QP pages 10-11 and MS pages 14-15. Trigonometric identity and exact-integration metadata is accurate.'),
      ('94b4d05d-df24-4682-a5c3-05f40bc6e59e'::uuid, false, 'Codex source-reviewed at operator request against official QP pages 12-13 and MS pages 16-17. Three-dimensional vector-line, intersection and distance metadata is accurate.'),
      ('2bbc7a79-af1b-4233-8546-d123ea09df18'::uuid, true, 'Codex source-reviewed at operator request against official QP pages 16-17 and MS pages 19-20. Calculus, separation of variables and initial-condition methods are accurate.'),
      ('d127f0db-0ea5-418d-9504-ab66c0d13970'::uuid, false, 'Codex source-reviewed at operator request against official QP page 2 and MS page 9. Mechanics, Newton''s second law and P=Fv metadata is accurate.'),
      ('736807bb-ed6d-4034-93bd-7efed0905ada'::uuid, false, 'Codex source-reviewed at operator request against official QP page 3 and MS page 10. Conservation of linear momentum and kinetic-energy-loss metadata is accurate.'),
      ('c2a674fe-75d9-4982-b49a-55dbdbf3b999'::uuid, true, 'Codex source-reviewed at operator request against official QP page 6 and MS page 14. Limiting-friction and equilibrium metadata is accurate; the source force diagram is required.'),
      ('1b545fe3-9a82-41e0-a1e1-85ca410ee68c'::uuid, false, 'Codex source-reviewed at operator request against official QP page 7 and MS page 15. Replaced invented coefficient-of-restitution and energy wording with incline kinematics, conservation of linear momentum and stopping-distance kinematics.'),
      ('0ffba2e0-4cdd-4f25-8c26-44fbaefe5113'::uuid, true, 'Codex source-reviewed at operator request against official QP pages 10-11 and MS page 18. Replaced the inaccurate force description with the official equations for B, vertical equilibrium for A, horizontal Newton''s second law for A and mu=F/R.')
) as decision(question_id, calculator_required, reviewer_note)
where metadata.question_id = decision.question_id;

insert into public.shamo_ingestion_issues (
    ingestion_run_id, severity, issue_code, document_type, question_number,
    part_path, message, resolved, resolution_note, resolved_at
)
select correction.ingestion_run_id, 'warning', 'POST_PUBLICATION_METADATA_CORRECTED',
       'question_paper', correction.question_number, null, correction.message,
       true, correction.resolution_note, now()
from (
    values
      ('414a7734-2afe-4bab-9896-02649106d027'::uuid, 3, 'Variant 12 Question 3 metadata included Differentiation although the given derivative must be integrated.', 'Replaced the subtopics with integration from a derivative, recovery of the curve equation and use of a known point.'),
      ('414a7734-2afe-4bab-9896-02649106d027'::uuid, 5, 'Variant 12 Question 5 was broadly classified as Coordinate Geometry although differentiation and the normal gradient are the principal method.', 'Changed main_topic to Calculus while retaining coordinate geometry in the detailed metadata.'),
      ('414a7734-2afe-4bab-9896-02649106d027'::uuid, 11, 'Variant 12 Question 11 had diagram_required=true although the equation and text fully define the assessed tasks.', 'Set diagram_required=false under the workflow rule for merely illustrative source graphs.'),
      ('0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid, 6, 'Variant 21 Question 6 had diagram_required=true although the equation and explicit bounds fully define the assessed tasks.', 'Set diagram_required=false under the workflow rule for merely illustrative source graphs.'),
      ('466116cc-75de-423e-9745-e2e401cfbe29'::uuid, 1, 'Variant 32 Question 1 had diagram_required=true although the candidate is asked to draw the graph and no source diagram is supplied.', 'Set diagram_required=false.'),
      ('466116cc-75de-423e-9745-e2e401cfbe29'::uuid, 2, 'Variant 32 Question 2 metadata incorrectly described factorising the numerator and omitted the improper-fraction step.', 'Replaced the skills and methods with polynomial division or constant-term handling, denominator factorisation and coefficient solving.'),
      ('466116cc-75de-423e-9745-e2e401cfbe29'::uuid, 4, 'Variant 32 Question 4 metadata used an inaccurate parametric label and omitted solving e^x=2 before differentiating.', 'Corrected the subtopics, skills and methods to match the official implicit-differentiation solution.'),
      ('466116cc-75de-423e-9745-e2e401cfbe29'::uuid, 6, 'Variant 32 Question 6 had diagram_required=true although the equation and definition of M fully define the exact tasks.', 'Set diagram_required=false under the workflow rule for merely illustrative source graphs.'),
      ('98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid, 6, 'Variant 41 Question 6 metadata invented coefficient-of-restitution and energy methods not used by the official solution.', 'Replaced the skills and methods with incline kinematics, conservation of linear momentum and stopping-distance kinematics.'),
      ('98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid, 8, 'Variant 41 Question 8 metadata inaccurately described the force equations for the two connected bodies.', 'Replaced the skills and methods with the official horizontal equation for B, vertical equilibrium and horizontal dynamics for A, and mu=F/R.')
) as correction(ingestion_run_id, question_number, message, resolution_note)
where not exists (
    select 1
    from public.shamo_ingestion_issues as existing
    where existing.ingestion_run_id = correction.ingestion_run_id
      and existing.issue_code = 'POST_PUBLICATION_METADATA_CORRECTED'
      and existing.question_number = correction.question_number
      and existing.message = correction.message
);

commit;

select
    count(*) as reviewed_rows,
    count(*) filter (where review_status = 'approved') as approved_rows
from public.shamo_question_metadata
where question_id in (
    '96326150-b81f-4c20-9ca9-b4317c60a0c0'::uuid,
    '00aa07dd-ceb0-46cf-971a-6b91ab640abd'::uuid,
    '1b7d8beb-932d-408e-88dc-03a8ecba5cfd'::uuid,
    '87d8b57a-dfae-4bf7-8853-051b4b83501a'::uuid,
    'f4f2ad88-9166-4dfe-8c2d-11e09f3832e9'::uuid,
    '2a39e39c-d02e-464d-b2dc-eae61a4e9209'::uuid,
    '366aa272-dcdc-4d97-97b6-3115b17a4a48'::uuid,
    'ecfc4b1d-22c8-48ae-98c1-ea251a27478c'::uuid,
    '902e4396-9b17-4184-bbcc-abfc1122a036'::uuid,
    '007ce42b-5e1b-4028-8241-96ff15d62084'::uuid,
    '36317e70-9ea8-46d1-9a3d-4569a9a5fa0e'::uuid,
    '50e1e870-c433-445a-82e5-619533f0eed2'::uuid,
    'be072e3b-ecee-4299-a911-2b370380c680'::uuid,
    'cda867e2-e1f0-4623-8667-891e34fc86e1'::uuid,
    'cc3380cd-bc63-459f-a63b-4b3df48e375e'::uuid,
    '94b4d05d-df24-4682-a5c3-05f40bc6e59e'::uuid,
    '2bbc7a79-af1b-4233-8546-d123ea09df18'::uuid,
    'd127f0db-0ea5-418d-9504-ab66c0d13970'::uuid,
    '736807bb-ed6d-4034-93bd-7efed0905ada'::uuid,
    'c2a674fe-75d9-4982-b49a-55dbdbf3b999'::uuid,
    '1b545fe3-9a82-41e0-a1e1-85ca410ee68c'::uuid,
    '0ffba2e0-4cdd-4f25-8c26-44fbaefe5113'::uuid
);
