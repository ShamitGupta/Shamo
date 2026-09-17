-- Shamo v2.1: source-review correction for two published metadata rows
-- on Cambridge 9709 variant 12.
--
-- Corrections:
--   * Question 1 evaluates an improper integral directly; it does not use
--     the comparison test.
--   * Question 7 uses an ellipse-type curve and a repeated-root condition;
--     it is not a circle question.
--
-- This script changes only shamo_question_metadata and adds two resolved
-- audit records. It does not change questions, parts, mark schemes, assets,
-- publication state, search candidates or embeddings.
--
-- Run this whole file once in the Supabase SQL editor.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $paper12_metadata_review$
declare
    target_run_id constant uuid :=
        '414a7734-2afe-4bab-9896-02649106d027'::uuid;
    target_paper_id constant uuid :=
        'df50b0d6-0483-47ab-8192-798e5083a88d'::uuid;
    matching_run_count integer;
    matching_metadata_count integer;
    question_1_precondition_count integer;
    question_7_precondition_count integer;
    existing_search_count integer;
begin
    select count(*)
    into matching_run_count
    from public.shamo_ingestion_runs as run
    join public.shamo_papers as paper
      on paper.id = run.paper_id
    where run.id = target_run_id
      and paper.id = target_paper_id
      and run.status = 'search_pending'
      and run.review_status = 'approved'
      and run.published_at is not null
      and paper.status = 'published'
      and paper.current_ingestion_run_id = target_run_id;

    if matching_run_count <> 1 then
        raise exception
            'Safety stop: Paper 12 is not the expected published search_pending run.';
    end if;

    perform metadata.question_id
    from public.shamo_question_metadata as metadata
    join public.shamo_questions as question
      on question.id = metadata.question_id
    where metadata.ingestion_run_id = target_run_id
      and question.question_number in (1, 7)
    order by question.question_number
    for update of metadata;

    select count(*)
    into matching_metadata_count
    from public.shamo_question_metadata as metadata
    join public.shamo_questions as question
      on question.id = metadata.question_id
    where metadata.ingestion_run_id = target_run_id
      and question.question_number in (1, 7);

    if matching_metadata_count <> 2 then
        raise exception
            'Safety stop: expected exactly two target metadata rows; found %.',
            matching_metadata_count;
    end if;

    select count(*)
    into question_1_precondition_count
    from public.shamo_question_metadata as metadata
    join public.shamo_questions as question
      on question.id = metadata.question_id
    where metadata.ingestion_run_id = target_run_id
      and question.question_number = 1
      and metadata.main_topic = 'Calculus'
      and metadata.methods @>
          array['Limit comparison at infinity']::text[];

    if question_1_precondition_count <> 1 then
        raise exception
            'Safety stop: Question 1 metadata no longer matches the reviewed precondition.';
    end if;

    select count(*)
    into question_7_precondition_count
    from public.shamo_question_metadata as metadata
    join public.shamo_questions as question
      on question.id = metadata.question_id
    where metadata.ingestion_run_id = target_run_id
      and question.question_number = 7
      and metadata.main_topic = 'Algebra'
      and metadata.subtopics @> array['Circles']::text[]
      and metadata.skills @>
          array['Substitute line into circle equation']::text[];

    if question_7_precondition_count <> 1 then
        raise exception
            'Safety stop: Question 7 metadata no longer matches the reviewed precondition.';
    end if;

    select count(*)
    into existing_search_count
    from public.shamo_question_search
    where ingestion_run_id = target_run_id;

    if existing_search_count <> 0 then
        raise exception
            'Safety stop: Paper 12 already has % stored search rows.',
            existing_search_count;
    end if;
end;
$paper12_metadata_review$;

update public.shamo_question_metadata as metadata
set
    methods = array[
        'Direct integration',
        'Introduce a finite upper limit, evaluate the definite integral and take the limit as the upper bound approaches infinity'
    ]::text[],
    review_status = 'approved',
    reviewer_note =
        'Human-reviewed after publication. The question directly evaluates an improper integral; it does not use the comparison test.',
    updated_at = now()
from public.shamo_questions as question
where question.id = metadata.question_id
  and metadata.ingestion_run_id =
      '414a7734-2afe-4bab-9896-02649106d027'::uuid
  and question.question_number = 1;

update public.shamo_question_metadata as metadata
set
    subtopics = array[
        'Tangency and intersections of curves and lines',
        'Quadratic equations',
        'Repeated roots and the discriminant'
    ]::text[],
    skills = array[
        'Substitute the line equation into the curve equation',
        'Use the single-intersection condition by setting the discriminant to zero',
        'Solve for the constant and the coordinates of the repeated intersection'
    ]::text[],
    methods = array[
        'Substitute y=x+5 into 2x^2+3y^2=k',
        'Use the discriminant-zero condition and solve the resulting quadratic'
    ]::text[],
    review_status = 'approved',
    reviewer_note =
        'Human-reviewed after publication. The curve is ellipse-type, not a circle; the solution uses substitution and a repeated-root condition.',
    updated_at = now()
from public.shamo_questions as question
where question.id = metadata.question_id
  and metadata.ingestion_run_id =
      '414a7734-2afe-4bab-9896-02649106d027'::uuid
  and question.question_number = 7;

insert into public.shamo_ingestion_issues (
    ingestion_run_id,
    severity,
    issue_code,
    document_type,
    page_number,
    question_number,
    part_path,
    message,
    resolved,
    resolution_note,
    created_at,
    resolved_at
)
select
    correction.ingestion_run_id,
    'warning',
    'POST_PUBLICATION_METADATA_CORRECTED',
    'question_paper',
    null,
    correction.question_number,
    null,
    correction.message,
    true,
    correction.resolution_note,
    now(),
    now()
from (
    values
        (
            '414a7734-2afe-4bab-9896-02649106d027'::uuid,
            1,
            'Question 1 metadata incorrectly named the limit comparison test.',
            'Replaced the comparison-test method with direct improper-integral evaluation and marked the reviewed metadata approved.'
        ),
        (
            '414a7734-2afe-4bab-9896-02649106d027'::uuid,
            7,
            'Question 7 metadata incorrectly described 2x^2+3y^2=k as a circle.',
            'Replaced circle terminology with curve-line intersection, substitution and repeated-root/discriminant metadata and marked the reviewed metadata approved.'
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
      and existing.issue_code =
          'POST_PUBLICATION_METADATA_CORRECTED'
      and existing.question_number = correction.question_number
      and existing.message = correction.message
);

commit;

-- Immediate verification. Expected: two rows and every result=PASS.
select
    question.question_number,
    metadata.main_topic,
    metadata.subtopics,
    metadata.skills,
    metadata.methods,
    metadata.review_status,
    metadata.reviewer_note,
    case
        when question.question_number = 1
         and metadata.methods @> array[
             'Introduce a finite upper limit, evaluate the definite integral and take the limit as the upper bound approaches infinity'
         ]::text[]
         and not (
             metadata.methods @>
                 array['Limit comparison at infinity']::text[]
         )
         and metadata.review_status = 'approved'
        then 'PASS'
        when question.question_number = 7
         and metadata.subtopics @> array[
             'Repeated roots and the discriminant'
         ]::text[]
         and not (
             metadata.subtopics @> array['Circles']::text[]
         )
         and not (
             metadata.skills @>
                 array['Substitute line into circle equation']::text[]
         )
         and metadata.review_status = 'approved'
        then 'PASS'
        else 'FAIL'
    end as result
from public.shamo_question_metadata as metadata
join public.shamo_questions as question
  on question.id = metadata.question_id
where metadata.ingestion_run_id =
    '414a7734-2afe-4bab-9896-02649106d027'::uuid
  and question.question_number in (1, 7)
order by question.question_number;
