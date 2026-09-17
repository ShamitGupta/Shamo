-- Shamo v2.1: correct two proven false-positive validation blockers.
--
-- This script does not change the schema, publish either paper, resolve any
-- warnings, or alter the legitimate blank Answer cells. It only:
--   1. verifies that the two exact staged source rows still match our review;
--   2. resolves the obsolete GUIDANCE_ONLY_ROW_HAS_MARK_CODE issues;
--   3. repairs two observed mojibake fragments in paper 52's staged JSON; and
--   4. refreshes the two run-level review summaries.
--
-- Run the whole file once in the Supabase SQL editor.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $$
declare
    matching_run_count integer;
    matching_issue_count integer;
    matching_issue_run_count integer;
    total_open_blocker_count integer;
    matching_source_row_count integer;
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
            'Safety stop: both target runs must still be awaiting_review/pending; found %',
            matching_run_count;
    end if;

    select count(*), count(distinct ingestion_run_id)
    into matching_issue_count, matching_issue_run_count
    from public.shamo_ingestion_issues
    where ingestion_run_id in (
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    )
      and severity = 'blocking'
      and issue_code = 'GUIDANCE_ONLY_ROW_HAS_MARK_CODE'
      and resolved = false;

    if matching_issue_count <> 2 or matching_issue_run_count <> 2 then
        raise exception
            'Safety stop: expected one false-positive blocker on each target run; found % issues across % runs',
            matching_issue_count,
            matching_issue_run_count;
    end if;

    select count(*)
    into total_open_blocker_count
    from public.shamo_ingestion_issues
    where ingestion_run_id in (
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    )
      and severity = 'blocking'
      and resolved = false;

    if total_open_blocker_count <> 2 then
        raise exception
            'Safety stop: target runs contain an unexpected open blocker; found % total blockers',
            total_open_blocker_count;
    end if;

    select count(*)
    into matching_source_row_count
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where (
        run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
        and (question ->> 'question_number')::integer = 3
        and (mark_item ->> 'sequence_number')::integer = 2
        and mark_item ->> 'mark_code' = 'A1'
        and btrim(coalesce(mark_item ->> 'content_markdown', '')) = ''
        and btrim(coalesce(mark_item ->> 'guidance_markdown', '')) =
            'All heights correct on graph (no FT).'
    ) or (
        run.id = '054f296f-e08c-4360-a27d-325d064b2496'::uuid
        and (question ->> 'question_number')::integer = 6
        and (mark_item ->> 'sequence_number')::integer = 8
        and mark_item ->> 'mark_code' = 'A1'
        and btrim(coalesce(mark_item ->> 'content_markdown', '')) = ''
        and btrim(coalesce(mark_item ->> 'guidance_markdown', '')) =
            'Wholly correct integration and limits.'
    );

    if matching_source_row_count <> 2 then
        raise exception
            'Safety stop: the two staged mark-scheme rows no longer match the reviewed source rows; found %',
            matching_source_row_count;
    end if;
end;
$$;

update public.shamo_ingestion_issues
set
    resolved = true,
    resolution_note =
        'Resolved by Shamo v2.1 review: Cambridge permits a blank Answer cell '
        || 'with a nonblank Marks cell and Guidance. The staged row faithfully '
        || 'preserves the printed mark scheme.',
    resolved_at = now()
where ingestion_run_id in (
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    )
  and severity = 'blocking'
  and issue_code = 'GUIDANCE_ONLY_ROW_HAS_MARK_CODE'
  and resolved = false;

-- Repair only the two exact corrupted fragments observed in paper 52.
update public.shamo_ingestion_runs
set
    extraction_summary = replace(
        replace(
            extraction_summary::text,
            'â€˜3rdâ€™',
            '‘3rd’'
        ),
        '30 â€“ 35',
        '30 – 35'
    )::jsonb,
    updated_at = now()
where id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid;

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
                    'part_path', coalesce(to_jsonb(issue.part_path), '[]'::jsonb),
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
        '{validation_correction}',
        jsonb_build_object(
            'version', 'v2.1',
            'corrected_at', now(),
            'reason', 'Removed obsolete blank-Answer-with-Mark blocker'
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
