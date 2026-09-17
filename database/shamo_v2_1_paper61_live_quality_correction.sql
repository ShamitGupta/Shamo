-- Shamo v2.1: source-checked live quality correction for published
-- Cambridge 9709/61 May/June 2024.
--
-- This corrects:
--   * 14 valid mark codes that were wrapped in Markdown bold markers;
--   * four printed subtotal cells that were emitted as answer rows;
--   * Question 4's hypothesis-test taxonomy; and
--   * Question 6's broad topic and diagram_required flag.
--
-- A1FT and B1FT are legitimate Cambridge follow-through mark codes and are
-- deliberately preserved without modification.
--
-- It then records human approval for all seven metadata rows.
-- It does not call an API, create embeddings, or alter question/mark totals.
-- Run the whole file once.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $$
declare
    pending_metadata_count integer;
    wrapped_code_count integer;
    legitimate_wrapped_code_count integer;
    subtotal_row_count integer;
begin
    if not exists (
        select 1
        from public.shamo_ingestion_runs as run
        join public.shamo_papers as paper
          on paper.id = run.paper_id
        where run.id =
            '054f296f-e08c-4360-a27d-325d064b2496'::uuid
          and run.status = 'search_pending'
          and run.review_status = 'approved'
          and paper.id =
            '2f718302-24c2-48ee-b6bb-ee2ec932b722'::uuid
          and paper.status = 'published'
          and paper.current_ingestion_run_id = run.id
    ) then
        raise exception
            'Safety stop: paper 61 is not the expected current publication.';
    end if;

    perform id
    from public.shamo_ingestion_runs
    where id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    for update;

    select count(*)
    into pending_metadata_count
    from public.shamo_question_metadata as metadata
    join public.shamo_questions as question
      on question.id = metadata.question_id
     and question.ingestion_run_id = metadata.ingestion_run_id
    where metadata.ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
      and metadata.review_status = 'pending'
      and question.question_number between 1 and 7;

    if pending_metadata_count <> 7 then
        raise exception
            'Safety stop: expected seven pending metadata rows; found %.',
            pending_metadata_count;
    end if;

    select count(*)
    into wrapped_code_count
    from public.shamo_mark_scheme_items as mark_item
    join public.shamo_questions as question
      on question.id = mark_item.question_id
     and question.ingestion_run_id = mark_item.ingestion_run_id
    where mark_item.ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
      and question.question_number in (2, 4)
      and mark_item.mark_code ~ '^\*\*.+\*\*$';

    if wrapped_code_count <> 18 then
        raise exception
            'Safety stop: expected 18 Markdown-wrapped mark cells; found %.',
            wrapped_code_count;
    end if;

    select count(*)
    into legitimate_wrapped_code_count
    from public.shamo_mark_scheme_items as mark_item
    join public.shamo_questions as question
      on question.id = mark_item.question_id
     and question.ingestion_run_id = mark_item.ingestion_run_id
    where mark_item.ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
      and (
          (
              question.question_number = 2
              and mark_item.sequence_number in (1, 2, 3, 4, 5)
              and mark_item.mark_code in (
                  '**B1**',
                  '**M1**',
                  '**A1**'
              )
          )
          or (
              question.question_number = 4
              and mark_item.sequence_number
                  in (1, 2, 3, 5, 6, 7, 8, 9, 11)
              and mark_item.mark_code in (
                  '**B1**',
                  '**M1**',
                  '**A1**',
                  '**A1FT**'
              )
          )
      );

    if legitimate_wrapped_code_count <> 14 then
        raise exception
            'Safety stop: expected 14 wrapped real mark codes; found %.',
            legitimate_wrapped_code_count;
    end if;

    select count(*)
    into subtotal_row_count
    from public.shamo_mark_scheme_items as mark_item
    join public.shamo_questions as question
      on question.id = mark_item.question_id
     and question.ingestion_run_id = mark_item.ingestion_run_id
    where mark_item.ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
      and (
          (
              question.question_number = 2
              and mark_item.sequence_number = 6
              and mark_item.mark_code = '**5**'
          )
          or (
              question.question_number = 4
              and (
                  (
                      mark_item.sequence_number = 4
                      and mark_item.mark_code = '**3**'
                  )
                  or (
                      mark_item.sequence_number = 10
                      and mark_item.mark_code = '**5**'
                  )
                  or (
                      mark_item.sequence_number = 12
                      and mark_item.mark_code = '**1**'
                  )
              )
          )
      )
      and lower(mark_item.content_markdown) like 'total marks%'
      and btrim(mark_item.guidance_markdown) = '';

    if subtotal_row_count <> 4 then
        raise exception
            'Safety stop: expected four emitted subtotal rows; found %.',
            subtotal_row_count;
    end if;
end;
$$;

delete from public.shamo_mark_scheme_items as mark_item
using public.shamo_questions as question
where question.id = mark_item.question_id
  and question.ingestion_run_id = mark_item.ingestion_run_id
  and mark_item.ingestion_run_id =
      '054f296f-e08c-4360-a27d-325d064b2496'::uuid
  and lower(mark_item.content_markdown) like 'total marks%'
  and btrim(mark_item.guidance_markdown) = ''
  and (
      (
          question.question_number = 2
          and mark_item.sequence_number = 6
          and mark_item.mark_code = '**5**'
      )
      or (
          question.question_number = 4
          and (
              (
                  mark_item.sequence_number = 4
                  and mark_item.mark_code = '**3**'
              )
              or (
                  mark_item.sequence_number = 10
                  and mark_item.mark_code = '**5**'
              )
              or (
                  mark_item.sequence_number = 12
                  and mark_item.mark_code = '**1**'
              )
          )
      )
  );

update public.shamo_mark_scheme_items as mark_item
set mark_code = regexp_replace(
    mark_item.mark_code,
    '^\*\*|\*\*$',
    '',
    'g'
)
from public.shamo_questions as question
where question.id = mark_item.question_id
  and question.ingestion_run_id = mark_item.ingestion_run_id
  and mark_item.ingestion_run_id =
      '054f296f-e08c-4360-a27d-325d064b2496'::uuid
  and (
      (
          question.question_number = 2
          and mark_item.sequence_number in (1, 2, 3, 4, 5)
      )
      or (
          question.question_number = 4
          and mark_item.sequence_number
              in (1, 2, 3, 5, 6, 7, 8, 9, 11)
      )
  )
  and mark_item.mark_code ~ '^\*\*.+\*\*$';

update public.shamo_question_metadata as metadata
set
    main_topic = case
        when question.question_number = 6
            then 'Statistics'
        else metadata.main_topic
    end,
    subtopics = case question.question_number
        when 4 then array[
            'Sampling and estimation',
            'Unbiased estimators of mean and variance',
            'Hypothesis testing for a population mean',
            'Central limit theorem',
            'One-tailed significance tests'
        ]::text[]
        else metadata.subtopics
    end,
    methods = case question.question_number
        when 6 then array[
            'Use the area of a quarter circle to normalize the density',
            'Derive the density from the equation of the circle',
            'Compute E(X) by integrating x f(x) over the support'
        ]::text[]
        else metadata.methods
    end,
    diagram_required = case
        when question.question_number = 6 then true
        else metadata.diagram_required
    end,
    review_status = 'approved',
    reviewer_note = case question.question_number
        when 3 then
            'Human-reviewed against the official paper and mark scheme. '
            || 'The confidence-interval classification is correct despite '
            || 'the model confidence of 0.74.'
        when 4 then
            'Human-reviewed against the official paper and mark scheme. '
            || 'Removed the misleading t-test label: the question uses a '
            || 'normal test with known population standard deviation and '
            || 'the large-sample central limit theorem.'
        when 6 then
            'Human-reviewed against the official paper and mark scheme. '
            || 'Corrected the broad topic from Calculus to Statistics and '
            || 'set diagram_required to true because the supplied '
            || 'quarter-circle density graph is essential.'
        else
            'Human-reviewed against the official question paper and mark '
            || 'scheme; classification approved without correction.'
    end,
    updated_at = now()
from public.shamo_questions as question
where question.id = metadata.question_id
  and question.ingestion_run_id = metadata.ingestion_run_id
  and metadata.ingestion_run_id =
      '054f296f-e08c-4360-a27d-325d064b2496'::uuid
  and question.question_number between 1 and 7;

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
    '054f296f-e08c-4360-a27d-325d064b2496'::uuid,
    correction.severity,
    correction.issue_code,
    'mark_scheme',
    correction.question_number,
    null::text[],
    correction.message,
    true,
    correction.resolution_note,
    now()
from (
    values
        (
            'warning',
            'MARK_CODE_MARKDOWN_WRAPPER',
            2,
            'Question 2 mark codes included Markdown bold wrappers.',
            'Removed ** wrappers from the five source mark codes; the '
            || 'underlying B1, M1 and A1 values were preserved.'
        ),
        (
            'warning',
            'MARK_CODE_MARKDOWN_WRAPPER',
            4,
            'Question 4 mark codes included Markdown bold wrappers.',
            'Removed ** wrappers from the nine source mark codes; A1FT was '
            || 'preserved as the official follow-through code.'
        ),
        (
            'warning',
            'MARK_SCHEME_TOTAL_ROW_EMITTED',
            2,
            'Question 2 included a printed five-mark subtotal as an answer row.',
            'Deleted the non-instructional subtotal row after comparison '
            || 'with official mark-scheme page 6.'
        ),
        (
            'warning',
            'MARK_SCHEME_TOTAL_ROW_EMITTED',
            4,
            'Question 4 included three printed part subtotals as answer rows.',
            'Deleted the 3-, 5- and 1-mark subtotal rows after comparison '
            || 'with official mark-scheme pages 8 and 9.'
        )
) as correction(
    severity,
    issue_code,
    question_number,
    message,
    resolution_note
)
where not exists (
    select 1
    from public.shamo_ingestion_issues as existing
    where existing.ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
      and existing.issue_code = correction.issue_code
      and existing.question_number = correction.question_number
);

do $$
declare
    final_mark_row_count integer;
    invalid_mark_code_count integer;
    approved_metadata_count integer;
    remaining_subtotal_count integer;
begin
    select count(*)
    into final_mark_row_count
    from public.shamo_mark_scheme_items
    where ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid;

    if final_mark_row_count <> 51 then
        raise exception
            'Verification stop: expected 51 instructional mark rows; found %.',
            final_mark_row_count;
    end if;

    select count(*)
    into invalid_mark_code_count
    from public.shamo_mark_scheme_items
    where ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
      and mark_code is not null
      and btrim(mark_code) !~*
          '^\*?(D?M|A|B)[0-9]+([[:space:]]*FT)?'
          '([[:space:]]+[A-Z][A-Z0-9]*)*$';

    if invalid_mark_code_count <> 0 then
        raise exception
            'Verification stop: % invalid mark codes remain.',
            invalid_mark_code_count;
    end if;

    select count(*)
    into approved_metadata_count
    from public.shamo_question_metadata
    where ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
      and review_status = 'approved';

    if approved_metadata_count <> 7 then
        raise exception
            'Verification stop: expected seven approved metadata rows; found %.',
            approved_metadata_count;
    end if;

    select count(*)
    into remaining_subtotal_count
    from public.shamo_mark_scheme_items
    where ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
      and (
          btrim(coalesce(mark_code, '')) ~ '^\*{0,2}[0-9]+\*{0,2}$'
          or (
              lower(content_markdown) like 'total marks%'
              and btrim(guidance_markdown) = ''
          )
      );

    if remaining_subtotal_count <> 0 then
        raise exception
            'Verification stop: % subtotal rows remain.',
            remaining_subtotal_count;
    end if;
end;
$$;

commit;
