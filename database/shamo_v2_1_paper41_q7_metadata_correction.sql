-- Shamo v2.1: targeted post-publication metadata correction for
-- Cambridge 9709 Oct-Nov 2025 variant 41, Question 7.
--
-- The question describes a particle moving in a straight line with velocity
-- given as a function of time. Its broad topic is Mechanics (kinematics), not
-- Algebra. This script changes only that published metadata row and adds one
-- resolved audit record. It does not change question text, parts, marks,
-- assets, publication state, search candidates or embeddings.
--
-- Run this whole file once.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $paper41_q7_metadata$
declare
    target_run_id constant uuid :=
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid;
    target_paper_id constant uuid :=
        '03382be6-bf6d-420e-b356-6a899a11a88c'::uuid;
    target_question_id constant uuid :=
        'bc29b2d6-e513-4aca-b1f9-875f211d046c'::uuid;
    matching_run_count integer;
    matching_metadata_count integer;
    existing_search_count integer;
    changed_count integer;
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
            'Safety stop: Paper 41 is not the expected published search_pending run.';
    end if;

    perform metadata.question_id
    from public.shamo_question_metadata as metadata
    join public.shamo_questions as question
      on question.id = metadata.question_id
    where metadata.question_id = target_question_id
      and metadata.ingestion_run_id = target_run_id
      and question.paper_id = target_paper_id
      and question.question_number = 7
    for update of metadata;

    select count(*)
    into matching_metadata_count
    from public.shamo_question_metadata as metadata
    join public.shamo_questions as question
      on question.id = metadata.question_id
    where metadata.question_id = target_question_id
      and metadata.ingestion_run_id = target_run_id
      and question.paper_id = target_paper_id
      and question.question_number = 7
      and question.total_marks = 9
      and question.stem_markdown like 'A particle $P$ starts from a point $O$%'
      and metadata.main_topic = 'Algebra'
      and metadata.subtopics @>
          array['Kinematics with polynomial functions']::text[]
      and metadata.review_status = 'pending'
      and metadata.reviewer_note is null;

    if matching_metadata_count <> 1 then
        raise exception
            'Safety stop: Paper 41 Question 7 metadata no longer matches the reviewed precondition.';
    end if;

    select count(*)
    into existing_search_count
    from public.shamo_question_search
    where ingestion_run_id = target_run_id;

    if existing_search_count <> 0 then
        raise exception
            'Safety stop: Paper 41 already has % stored search rows.',
            existing_search_count;
    end if;

    update public.shamo_question_metadata
    set
        main_topic = 'Mechanics',
        review_status = 'approved',
        reviewer_note =
            'Human-reviewed after publication. This is a Mechanics kinematics question about velocity, acceleration and displacement of a particle.',
        updated_at = now()
    where question_id = target_question_id
      and ingestion_run_id = target_run_id
      and main_topic = 'Algebra';

    get diagnostics changed_count = row_count;

    if changed_count <> 1 then
        raise exception
            'Safety stop: expected to update one metadata row; updated %.',
            changed_count;
    end if;
end;
$paper41_q7_metadata$;

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
    '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid,
    'warning',
    'POST_PUBLICATION_METADATA_CORRECTED',
    'question_paper',
    null,
    7,
    null,
    'Paper 41 Question 7 was classified as Algebra although it is a particle kinematics question.',
    true,
    'Changed main_topic to Mechanics, preserved the reviewed kinematics skills and methods, and marked the metadata row approved.',
    now(),
    now()
where not exists (
    select 1
    from public.shamo_ingestion_issues as existing
    where existing.ingestion_run_id =
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
      and existing.issue_code = 'POST_PUBLICATION_METADATA_CORRECTED'
      and existing.question_number = 7
      and existing.message =
          'Paper 41 Question 7 was classified as Algebra although it is a particle kinematics question.'
);

commit;

-- Immediate verification. Expected: one row with result=PASS.
select
    paper.paper_variant,
    question.question_number,
    metadata.main_topic,
    metadata.subtopics,
    metadata.review_status,
    metadata.reviewer_note,
    case
        when paper.paper_variant = '41'
         and question.question_number = 7
         and metadata.main_topic = 'Mechanics'
         and metadata.subtopics @>
             array['Kinematics with polynomial functions']::text[]
         and metadata.review_status = 'approved'
         and metadata.reviewer_note like
             'Human-reviewed after publication.%'
        then 'PASS'
        else 'FAIL'
    end as result
from public.shamo_question_metadata as metadata
join public.shamo_questions as question
  on question.id = metadata.question_id
join public.shamo_papers as paper
  on paper.id = question.paper_id
where metadata.ingestion_run_id =
    '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
  and question.id =
    'bc29b2d6-e513-4aca-b1f9-875f211d046c'::uuid;
