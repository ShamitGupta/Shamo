-- Shamo v2.1: final source-checked cleanup and review sign-off for the
-- first 9709 calibration batch.
--
-- This script:
--   1. removes duplicated Marks-column codes from paper 52, question 5
--      Guidance;
--   2. clears six invented Answer cells in paper 52, question 6 that are
--      blank in the official mark scheme;
--   3. resolves the five source-checked mark-coverage warnings on paper 52;
--   4. resolves two human-reviewed metadata-confidence warnings; and
--   5. refreshes both run-level validation summaries.
--
-- It does not publish either paper. Run the whole file once.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $$
declare
    matching_run_count integer;
    open_issue_count integer;
    target_warning_count integer;
    question_5_row_count integer;
    question_5_prefix_count integer;
    question_6_target_count integer;
begin
    select count(*)
    into matching_run_count
    from public.shamo_ingestion_runs
    where id in (
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    )
      and status = 'awaiting_review'
      and review_status = 'pending';

    if matching_run_count <> 2 then
        raise exception
            'Safety stop: both runs must still be awaiting_review/pending; found %',
            matching_run_count;
    end if;

    perform id
    from public.shamo_ingestion_runs
    where id in (
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    )
    order by id
    for update;

    select count(*)
    into open_issue_count
    from public.shamo_ingestion_issues
    where ingestion_run_id in (
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    )
      and resolved = false;

    select count(*)
    into target_warning_count
    from public.shamo_ingestion_issues
    where resolved = false
      and severity = 'warning'
      and (
          (
              ingestion_run_id =
                  '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
              and issue_code = 'MARK_CODE_COVERAGE_TOO_LOW'
              and question_number in (1, 2, 4, 5, 6)
          )
          or (
              ingestion_run_id =
                  '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
              and issue_code = 'LOW_METADATA_CONFIDENCE'
              and question_number = 5
          )
          or (
              ingestion_run_id =
                  '054f296f-e08c-4360-a27d-325d064b2496'::uuid
              and issue_code = 'LOW_METADATA_CONFIDENCE'
              and question_number = 3
          )
      );

    if open_issue_count <> 7 or target_warning_count <> 7 then
        raise exception
            'Safety stop: expected exactly the seven reviewed warnings; found % open issues and % matching warnings',
            open_issue_count,
            target_warning_count;
    end if;

    with question_5_rows as (
        select mark_item
        from public.shamo_ingestion_runs as run
        cross join lateral jsonb_array_elements(
            run.extraction_summary #> '{paper_bundle,questions}'
        ) as question
        cross join lateral jsonb_array_elements(
            question -> 'mark_scheme_items'
        ) as mark_item
        where run.id =
            '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
          and (question ->> 'question_number')::integer = 5
    )
    select
        count(*),
        count(*) filter (
            where (
                (mark_item ->> 'sequence_number')::integer = 1
                and mark_item ->> 'mark_code' = 'M1'
                and mark_item ->> 'guidance_markdown'
                    ~ '^M1[[:space:]]+'
            ) or (
                (mark_item ->> 'sequence_number')::integer = 2
                and mark_item ->> 'mark_code' = 'A1 AG'
                and mark_item ->> 'guidance_markdown'
                    ~ '^A1[[:space:]]+AG\.'
            ) or (
                (mark_item ->> 'sequence_number')::integer in (3, 4, 5)
                and mark_item ->> 'mark_code' = 'B1'
                and mark_item ->> 'guidance_markdown'
                    ~ '^B1[[:space:]]+'
            ) or (
                (mark_item ->> 'sequence_number')::integer in (6, 7)
                and mark_item ->> 'mark_code' = 'M1'
                and mark_item ->> 'guidance_markdown'
                    ~ '^M1[[:space:]]+'
            ) or (
                (mark_item ->> 'sequence_number')::integer = 8
                and mark_item ->> 'mark_code' = 'A1'
                and mark_item ->> 'guidance_markdown'
                    ~ '^A1[[:space:]]+'
            )
        )
    into question_5_row_count, question_5_prefix_count
    from question_5_rows;

    if question_5_row_count <> 8 or question_5_prefix_count <> 8 then
        raise exception
            'Safety stop: question 5 no longer matches the eight reviewed rows; found % rows and % duplicated prefixes',
            question_5_row_count,
            question_5_prefix_count;
    end if;

    select count(*)
    into question_6_target_count
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where run.id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and (question ->> 'question_number')::integer = 6
      and (mark_item ->> 'sequence_number')::integer
          in (9, 10, 14, 15, 19, 20)
      and mark_item ->> 'mark_code' = 'M1'
      and btrim(coalesce(mark_item ->> 'content_markdown', ''))
          like 'Apply%'
      and btrim(coalesce(mark_item ->> 'guidance_markdown', '')) <> '';

    if question_6_target_count <> 6 then
        raise exception
            'Safety stop: expected six reviewed question 6 Answer/Guidance rows; found %',
            question_6_target_count;
    end if;
end;
$$;

with rebuilt_questions as (
    select
        run.id,
        jsonb_agg(
            case
                when (question.item ->> 'question_number')::integer = 5
                then jsonb_set(
                    question.item,
                    '{mark_scheme_items}',
                    (
                        select jsonb_agg(
                            case
                                when (mark_item.item ->> 'sequence_number')::integer = 2
                                then mark_item.item || jsonb_build_object(
                                    'mark_code',
                                    'A1',
                                    'guidance_markdown',
                                    regexp_replace(
                                        coalesce(
                                            mark_item.item
                                                ->> 'guidance_markdown',
                                            ''
                                        ),
                                        '^A1[[:space:]]+',
                                        ''
                                    )
                                )
                                when (mark_item.item ->> 'sequence_number')::integer
                                    in (1, 6, 7)
                                then jsonb_set(
                                    mark_item.item,
                                    '{guidance_markdown}',
                                    to_jsonb(
                                        regexp_replace(
                                            coalesce(
                                                mark_item.item
                                                    ->> 'guidance_markdown',
                                                ''
                                            ),
                                            '^M1[[:space:]]+',
                                            ''
                                        )
                                    ),
                                    false
                                )
                                when (mark_item.item ->> 'sequence_number')::integer
                                    in (3, 4, 5)
                                then jsonb_set(
                                    mark_item.item,
                                    '{guidance_markdown}',
                                    to_jsonb(
                                        regexp_replace(
                                            coalesce(
                                                mark_item.item
                                                    ->> 'guidance_markdown',
                                                ''
                                            ),
                                            '^B1[[:space:]]+',
                                            ''
                                        )
                                    ),
                                    false
                                )
                                when (mark_item.item ->> 'sequence_number')::integer = 8
                                then jsonb_set(
                                    mark_item.item,
                                    '{guidance_markdown}',
                                    to_jsonb(
                                        regexp_replace(
                                            coalesce(
                                                mark_item.item
                                                    ->> 'guidance_markdown',
                                                ''
                                            ),
                                            '^A1[[:space:]]+',
                                            ''
                                        )
                                    ),
                                    false
                                )
                                else mark_item.item
                            end
                            order by mark_item.ordinal
                        )
                        from jsonb_array_elements(
                            question.item -> 'mark_scheme_items'
                        ) with ordinality as mark_item(item, ordinal)
                    ),
                    false
                )
                when (question.item ->> 'question_number')::integer = 6
                then jsonb_set(
                    question.item,
                    '{mark_scheme_items}',
                    (
                        select jsonb_agg(
                            case
                                when (mark_item.item ->> 'sequence_number')::integer
                                    in (9, 10, 14, 15, 19, 20)
                                then jsonb_set(
                                    mark_item.item,
                                    '{content_markdown}',
                                    to_jsonb(''::text),
                                    false
                                )
                                else mark_item.item
                            end
                            order by mark_item.ordinal
                        )
                        from jsonb_array_elements(
                            question.item -> 'mark_scheme_items'
                        ) with ordinality as mark_item(item, ordinal)
                    ),
                    false
                )
                else question.item
            end
            order by question.ordinal
        ) as questions
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) with ordinality as question(item, ordinal)
    where run.id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
    group by run.id
)
update public.shamo_ingestion_runs as run
set
    extraction_summary = jsonb_set(
        run.extraction_summary,
        '{paper_bundle,questions}',
        rebuilt.questions,
        false
    ) || jsonb_build_object(
        'final_source_signoff',
        jsonb_build_object(
            'version', 'v2.1',
            'reviewed_at', now(),
            'paper_variant', '52',
            'source',
                'Official 9709/52 February/March 2024 mark scheme',
            'questions_reviewed', jsonb_build_array(1, 2, 3, 4, 5, 6)
        )
    ),
    updated_at = now()
from rebuilt_questions as rebuilt
where run.id = rebuilt.id;

update public.shamo_ingestion_issues
set
    resolved = true,
    resolution_note = case
        when issue_code = 'MARK_CODE_COVERAGE_TOO_LOW' then
            'Resolved after row-by-row comparison with the official mark '
            || 'scheme. Missing or malformed Marks-column codes and method '
            || 'flags were corrected; the primary code total now equals '
            || 'the printed question total.'
        when ingestion_run_id =
            '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid then
            'Human-reviewed against the question and mark scheme. The '
            || 'Statistics, discrete-random-variable, probability, '
            || 'expectation and variance classification is appropriate.'
        else
            'Human-reviewed against the question and mark scheme. The '
            || 'Statistics, normal-distribution and confidence-interval '
            || 'classification is appropriate.'
    end,
    resolved_at = now()
where resolved = false
  and severity = 'warning'
  and (
      (
          ingestion_run_id =
              '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
          and issue_code = 'MARK_CODE_COVERAGE_TOO_LOW'
          and question_number in (1, 2, 4, 5, 6)
      )
      or (
          ingestion_run_id =
              '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
          and issue_code = 'LOW_METADATA_CONFIDENCE'
          and question_number = 5
      )
      or (
          ingestion_run_id =
              '054f296f-e08c-4360-a27d-325d064b2496'::uuid
          and issue_code = 'LOW_METADATA_CONFIDENCE'
          and question_number = 3
      )
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
    '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
    correction.severity,
    correction.issue_code,
    'mark_scheme',
    correction.question_number,
    correction.part_path,
    correction.message,
    true,
    correction.resolution_note,
    now()
from (
    values
        (
            'warning',
            'MARK_CODE_COPIED_INTO_GUIDANCE',
            5,
            null::text[],
            'Marks-column codes were repeated at the start of eight Guidance cells.',
            'Removed only the duplicated leading codes. Marks, Answer text and the remaining printed Guidance were preserved.'
        ),
        (
            'warning',
            'DUPLICATED_ANSWER_GUIDANCE_TEXT',
            6,
            array['c']::text[],
            'Six blank Answer cells were populated with paraphrases of their Guidance.',
            'Compared with official mark-scheme pages 16-17 and cleared only the six invented Answer values.'
        )
) as correction(
    severity,
    issue_code,
    question_number,
    part_path,
    message,
    resolution_note
)
where not exists (
    select 1
    from public.shamo_ingestion_issues as existing
    where existing.ingestion_run_id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and existing.issue_code = correction.issue_code
      and existing.question_number = correction.question_number
      and existing.message = correction.message
);

with target_runs(id) as (
    values
        ('754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid),
        ('054f296f-e08c-4360-a27d-325d064b2496'::uuid)
),
issue_rollup as (
    select
        target.id,
        count(issue.id) filter (
            where issue.resolved = false
        )::integer as open_issue_count,
        count(issue.id) filter (
            where issue.resolved = false
              and issue.severity = 'blocking'
        )::integer as blocking_issue_count,
        count(issue.id) filter (
            where issue.resolved = false
              and issue.severity = 'warning'
        )::integer as warning_count,
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'severity', issue.severity,
                    'issue_code', issue.issue_code,
                    'document_type', issue.document_type,
                    'page_number', issue.page_number,
                    'question_number', issue.question_number,
                    'part_path',
                        coalesce(to_jsonb(issue.part_path), '[]'::jsonb),
                    'message', issue.message
                )
                order by issue.id
            ) filter (
                where issue.id is not null
                  and issue.resolved = false
            ),
            '[]'::jsonb
        ) as open_issues
    from target_runs as target
    left join public.shamo_ingestion_issues as issue
        on issue.ingestion_run_id = target.id
    group by target.id
)
update public.shamo_ingestion_runs as run
set
    extraction_summary = jsonb_set(
        jsonb_set(
            jsonb_set(
                run.extraction_summary
                    || jsonb_build_object(
                        'ready_for_approval',
                        rollup.blocking_issue_count = 0
                    ),
                '{summary,issues}',
                to_jsonb(rollup.open_issue_count),
                true
            ),
            '{summary,blocking_issues}',
            to_jsonb(rollup.blocking_issue_count),
            true
        ),
        '{final_review_signoff}',
        jsonb_build_object(
            'version', 'v2.1',
            'reviewed_at', now(),
            'open_issue_count', rollup.open_issue_count,
            'result',
                case
                    when rollup.open_issue_count = 0 then 'PASS'
                    else 'REVIEW_REQUIRED'
                end
        ),
        true
    ),
    validation_report = coalesce(run.validation_report, '{}'::jsonb)
        || jsonb_build_object(
            'passed', rollup.blocking_issue_count = 0,
            'blocking_issue_count', rollup.blocking_issue_count,
            'warning_count', rollup.warning_count,
            'issues', rollup.open_issues
        ),
    verifier_report = coalesce(run.verifier_report, '{}'::jsonb)
        || jsonb_build_object(
            'passed', rollup.blocking_issue_count = 0
        ),
    updated_at = now()
from issue_rollup as rollup
where run.id = rollup.id;

commit;
