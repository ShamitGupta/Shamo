-- Shamo v2.1: source-checked live quality correction for published
-- Cambridge 9709/52 February/March 2024.
--
-- This corrects:
--   * one OCR error in Question 5 mark-scheme Guidance;
--   * Question 1's diagram_required flag;
--   * Question 3's lower-quartile skill/method wording; and
--   * Question 6's topic taxonomy and arrangement descriptions.
--
-- It then records human approval for all six metadata rows.
-- It does not call an API, create embeddings, or alter question/mark totals.
-- Run the whole file once.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $$
declare
    matching_metadata_count integer;
    matching_guidance_count integer;
begin
    if not exists (
        select 1
        from public.shamo_ingestion_runs as run
        join public.shamo_papers as paper
          on paper.id = run.paper_id
        where run.id =
            '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
          and run.status = 'search_pending'
          and run.review_status = 'approved'
          and paper.id =
            '664037d1-538d-4929-9da4-789a828a0395'::uuid
          and paper.status = 'published'
          and paper.current_ingestion_run_id = run.id
    ) then
        raise exception
            'Safety stop: paper 52 is not the expected current publication.';
    end if;

    perform id
    from public.shamo_ingestion_runs
    where id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
    for update;

    select count(*)
    into matching_metadata_count
    from public.shamo_question_metadata as metadata
    join public.shamo_questions as question
      on question.id = metadata.question_id
     and question.ingestion_run_id = metadata.ingestion_run_id
    where metadata.ingestion_run_id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and metadata.review_status = 'pending'
      and question.question_number between 1 and 6;

    if matching_metadata_count <> 6 then
        raise exception
            'Safety stop: expected six pending metadata rows; found %.',
            matching_metadata_count;
    end if;

    select count(*)
    into matching_guidance_count
    from public.shamo_mark_scheme_items as mark_item
    join public.shamo_questions as question
      on question.id = mark_item.question_id
     and question.ingestion_run_id = mark_item.ingestion_run_id
    where mark_item.ingestion_run_id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and question.question_number = 5
      and mark_item.sequence_number = 1
      and mark_item.mark_code = 'M1'
      and mark_item.guidance_markdown like '%³Cₕ%'
      and mark_item.guidance_markdown like '%b = 1, 2, 3.%';

    if matching_guidance_count <> 1 then
        raise exception
            'Safety stop: the reviewed Question 5 OCR row no longer matches.';
    end if;
end;
$$;

update public.shamo_mark_scheme_items as mark_item
set
    guidance_markdown =
        '$0.5 \times 0.2^2 \times {}^3C_a$ (or 3) + $x$; '
        || '$0 < x < 1$; $a = 1, 2$. Or '
        || '$0.3^2 \times 0.2 \times {}^3C_b$ (or 3) + $y$; '
        || '$0 < y < 1$; $b = 1, 2$. Or '
        || '$0.5 \times 0.2^2 \times a '
        || '+ 0.3^2 \times 0.2 \times b$; $a, b = 1, 2, 3$.'
from public.shamo_questions as question
where question.id = mark_item.question_id
  and question.ingestion_run_id = mark_item.ingestion_run_id
  and mark_item.ingestion_run_id =
      '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
  and question.question_number = 5
  and mark_item.sequence_number = 1
  and mark_item.mark_code = 'M1';

update public.shamo_question_metadata as metadata
set
    diagram_required = case
        when question.question_number = 1 then false
        else metadata.diagram_required
    end,
    main_topic = case
        when question.question_number = 6
            then 'Statistics'
        else metadata.main_topic
    end,
    subtopics = case question.question_number
        when 3 then array[
            'Data presentation',
            'Histogram',
            'Estimation of mean',
            'Quartiles'
        ]::text[]
        when 6 then array[
            'Permutations and combinations',
            'Combinations with restrictions',
            'Permutations with blocks',
            'Restricted arrangements in two rows'
        ]::text[]
        else metadata.subtopics
    end,
    skills = case question.question_number
        when 3 then array[
            'Construct a histogram from grouped frequency data',
            'Estimate a mean using class midpoints',
            'Locate the lower-quartile class using cumulative frequency'
        ]::text[]
        when 6 then array[
            'Count selections satisfying minimum-category constraints',
            'Arrange distinct groups as blocks',
            'Count arrangements where two specified people are adjacent in a specified row'
        ]::text[]
        else metadata.skills
    end,
    methods = case question.question_number
        when 3 then array[
            'Frequency-density histogram',
            'Grouped-data midpoint estimate',
            'Cumulative-frequency position for the lower quartile'
        ]::text[]
        when 6 then array[
            'Casework or complementary counting for restricted selections',
            'Block method for the men and women groups',
            'Block or position method for adjacent people in the front row'
        ]::text[]
        else metadata.methods
    end,
    review_status = 'approved',
    reviewer_note = case question.question_number
        when 1 then
            'Human-reviewed against the official paper. Corrected '
            || 'diagram_required to false; no source diagram is needed.'
        when 3 then
            'Human-reviewed against the official paper. Corrected the '
            || 'quartile skill to locating the class by cumulative '
            || 'frequency; interpolation is not requested.'
        when 6 then
            'Human-reviewed against the official paper. Standardised the '
            || 'subtopics and methods to Cambridge '
            || 'permutations-and-combinations terminology while retaining '
            || 'Statistics as the broad topic.'
        else
            'Human-reviewed against the official question paper and mark '
            || 'scheme; classification approved without correction.'
    end,
    updated_at = now()
from public.shamo_questions as question
where question.id = metadata.question_id
  and question.ingestion_run_id = metadata.ingestion_run_id
  and metadata.ingestion_run_id =
      '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
  and question.question_number between 1 and 6;

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
    '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
    'warning',
    'OCR_GUIDANCE_SYMBOL_ERROR',
    'mark_scheme',
    5,
    array['a']::text[],
    'Question 5(a) Guidance misread C_b as C_h and changed the associated b range.',
    true,
    'Corrected against official mark-scheme page 13: the second '
        || 'combination term is C_b with b = 1, 2.',
    now()
where not exists (
    select 1
    from public.shamo_ingestion_issues as existing
    where existing.ingestion_run_id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and existing.issue_code = 'OCR_GUIDANCE_SYMBOL_ERROR'
      and existing.question_number = 5
);

commit;
