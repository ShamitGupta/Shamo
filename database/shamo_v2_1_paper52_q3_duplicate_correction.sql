-- Shamo v2.1: correct duplicated Answer/Guidance text in paper 9709/52,
-- February/March 2024, question 3(a), mark-scheme sequences 3 and 4.
--
-- The official table has blank Answer cells for these two B1 rows; their
-- descriptions are printed in Guidance. This script preserves Marks and
-- Guidance and clears only the incorrectly invented Answer text.
--
-- Run the whole file once in the Supabase SQL editor.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $$
declare
    matching_row_count integer;
begin
    if not exists (
        select 1
        from public.shamo_ingestion_runs
        where id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
          and status = 'awaiting_review'
          and review_status = 'pending'
    ) then
        raise exception
            'Safety stop: paper 52 is no longer awaiting_review/pending.';
    end if;

    select count(*)
    into matching_row_count
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and (question ->> 'question_number')::integer = 3
      and (mark_item ->> 'sequence_number')::integer in (3, 4)
      and mark_item ->> 'mark_code' = 'B1'
      and btrim(coalesce(mark_item ->> 'content_markdown', '')) <> ''
      and btrim(coalesce(mark_item ->> 'guidance_markdown', '')) <> '';

    if matching_row_count <> 2 then
        raise exception
            'Safety stop: expected the two reviewed duplicated rows; found %',
            matching_row_count;
    end if;
end;
$$;

with rebuilt_bundle as (
    select
        run.id,
        jsonb_agg(
            case
                when (question.item ->> 'question_number')::integer = 3
                then jsonb_set(
                    question.item,
                    '{mark_scheme_items}',
                    (
                        select jsonb_agg(
                            case
                                when (mark_item.item ->> 'sequence_number')::integer
                                    in (3, 4)
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
    where run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
    group by run.id
)
update public.shamo_ingestion_runs as run
set
    extraction_summary = (
        jsonb_set(
            run.extraction_summary,
            '{paper_bundle,questions}',
            rebuilt.questions,
            false
        )
        || jsonb_build_object(
            'quality_correction',
            jsonb_build_object(
                'version', 'v2.1',
                'corrected_at', now(),
                'paper_variant', '52',
                'question_number', 3,
                'mark_scheme_sequences', jsonb_build_array(3, 4),
                'reason', 'Removed Answer text copied from printed Guidance'
            )
        )
    ),
    updated_at = now()
from rebuilt_bundle as rebuilt
where run.id = rebuilt.id;

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
    'DUPLICATED_ANSWER_GUIDANCE_TEXT',
    'mark_scheme',
    3,
    array['a']::text[],
    'Answer and Guidance were duplicated in mark-scheme sequence '
        || sequence_number || '.',
    true,
    'Compared with the official 9709/52 February/March 2024 mark scheme; '
        || 'the text belongs in Guidance and the printed Answer cell is blank.',
    now()
from (values (3), (4)) as corrected(sequence_number)
where not exists (
    select 1
    from public.shamo_ingestion_issues as existing
    where existing.ingestion_run_id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and existing.issue_code = 'DUPLICATED_ANSWER_GUIDANCE_TEXT'
      and existing.question_number = 3
      and existing.message =
          'Answer and Guidance were duplicated in mark-scheme sequence '
          || corrected.sequence_number || '.'
);

commit;

-- Expected: two rows, blank content_markdown, B1, nonblank Guidance.
select
    (question ->> 'question_number')::integer as question_number,
    (mark_item ->> 'sequence_number')::integer as sequence_number,
    mark_item -> 'part_path' as part_path,
    mark_item ->> 'mark_code' as mark_code,
    mark_item ->> 'content_markdown' as content_markdown,
    mark_item ->> 'guidance_markdown' as guidance_markdown
from public.shamo_ingestion_runs as run
cross join lateral jsonb_array_elements(
    run.extraction_summary #> '{paper_bundle,questions}'
) as question
cross join lateral jsonb_array_elements(
    question -> 'mark_scheme_items'
) as mark_item
where run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
  and (question ->> 'question_number')::integer = 3
  and (mark_item ->> 'sequence_number')::integer in (3, 4)
order by sequence_number;

