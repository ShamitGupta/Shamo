-- Shamo v2.1 batch 2: resolve two source-checked false-positive
-- duplicated Answer/Guidance validation blockers.
--
-- This script does not publish content and does not rewrite the staged
-- mark-scheme rows. It resolves only the two reviewed false-positive
-- DUPLICATED_ANSWER_GUIDANCE_TEXT blockers:
--   - 9709/31 Oct/Nov 2025 Question 7 sequence 6
--   - 9709/42 Feb/Mar 2024 Question 7(a) sequence 6
--
-- The official mark schemes contain separate Answer and Guidance cells for
-- both rows. They share mathematical expressions, so the v2.1 near-duplicate
-- detector correctly routed them for source review but should not block
-- publication after review.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $do$
declare
    target_run_count integer;
    target_blocker_count integer;
    total_blocker_count integer;
    reviewed_source_row_count integer;
begin
    select count(*)
    into target_run_count
    from public.shamo_ingestion_runs
    where id in (
        '38aa9576-9519-49bd-81ce-34275525f985'::uuid,
        '38103a22-dc31-4060-aead-7bad9b77a174'::uuid
    )
      and status = 'awaiting_review'
      and review_status = 'pending';

    if target_run_count <> 2 then
        raise exception
            'Safety stop: both target runs must be awaiting_review/pending; found %',
            target_run_count;
    end if;

    select count(*)
    into target_blocker_count
    from public.shamo_ingestion_issues
    where ingestion_run_id in (
        '38aa9576-9519-49bd-81ce-34275525f985'::uuid,
        '38103a22-dc31-4060-aead-7bad9b77a174'::uuid
    )
      and severity = 'blocking'
      and issue_code = 'DUPLICATED_ANSWER_GUIDANCE_TEXT'
      and question_number = 7
      and resolved = false;

    if target_blocker_count <> 2 then
        raise exception
            'Safety stop: expected exactly two unresolved Q7 duplicate-guidance blockers; found %',
            target_blocker_count;
    end if;

    select count(*)
    into total_blocker_count
    from public.shamo_ingestion_issues
    where ingestion_run_id in (
        '38aa9576-9519-49bd-81ce-34275525f985'::uuid,
        '38103a22-dc31-4060-aead-7bad9b77a174'::uuid
    )
      and severity = 'blocking'
      and resolved = false;

    if total_blocker_count <> 2 then
        raise exception
            'Safety stop: target runs have unexpected unresolved blockers; found %',
            total_blocker_count;
    end if;

    select count(*)
    into reviewed_source_row_count
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where (
        run.id = '38aa9576-9519-49bd-81ce-34275525f985'::uuid
        and (question ->> 'question_number')::integer = 7
        and (mark_item ->> 'sequence_number')::integer = 6
        and mark_item -> 'part_path' = '[]'::jsonb
        and mark_item ->> 'mark_code' = 'B1'
        and position('Obtain $$x' in (mark_item ->> 'content_markdown')) = 1
        and position('1-2y' in (mark_item ->> 'content_markdown')) > 0
        and position('2y' in (mark_item ->> 'content_markdown')) > 0
        and position('OE, e.g.' in (mark_item ->> 'guidance_markdown')) = 1
        and position('1-2y' in (mark_item ->> 'guidance_markdown')) > 0
    ) or (
        run.id = '38103a22-dc31-4060-aead-7bad9b77a174'::uuid
        and (question ->> 'question_number')::integer = 7
        and (mark_item ->> 'sequence_number')::integer = 6
        and mark_item -> 'part_path' = '["a"]'::jsonb
        and mark_item ->> 'mark_code' = 'A1'
        and position('0.75' in (mark_item ->> 'content_markdown')) > 0
        and position('or $$3' in (mark_item ->> 'content_markdown')) > 0
        and position('AG. Allow A2' in (mark_item ->> 'guidance_markdown')) = 1
        and position('0.75' in (mark_item ->> 'guidance_markdown')) > 0
    );

    if reviewed_source_row_count <> 2 then
        raise exception
            'Safety stop: reviewed source rows no longer match; found %',
            reviewed_source_row_count;
    end if;
end;
$do$;

update public.shamo_ingestion_issues
set
    resolved = true,
    resolution_note =
        case ingestion_run_id
            when '38aa9576-9519-49bd-81ce-34275525f985'::uuid then
                'Source-checked against official 9709/31 Oct/Nov 2025 mark scheme page 15: '
                || 'Question 7 sequence 6 has separate Answer and Guidance cells that share '
                || 'the inverse-function expression; this is a validator false positive.'
            when '38103a22-dc31-4060-aead-7bad9b77a174'::uuid then
                'Source-checked against official 9709/42 Feb/Mar 2024 mark scheme page 17: '
                || 'Question 7(a) sequence 6 has separate Answer and Guidance cells that share '
                || 'the printed AG expression; this is a validator false positive.'
        end,
    resolved_at = now()
where ingestion_run_id in (
        '38aa9576-9519-49bd-81ce-34275525f985'::uuid,
        '38103a22-dc31-4060-aead-7bad9b77a174'::uuid
    )
  and severity = 'blocking'
  and issue_code = 'DUPLICATED_ANSWER_GUIDANCE_TEXT'
  and question_number = 7
  and resolved = false;

with target_runs(id) as (
    values
        ('38aa9576-9519-49bd-81ce-34275525f985'::uuid),
        ('38103a22-dc31-4060-aead-7bad9b77a174'::uuid)
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
            'reason', 'Resolved source-checked duplicate Answer/Guidance false positives',
            'affected_questions', jsonb_build_array(
                jsonb_build_object(
                    'ingestion_run_id',
                    '38aa9576-9519-49bd-81ce-34275525f985',
                    'paper_variant',
                    '31',
                    'question_number',
                    7,
                    'mark_scheme_sequence',
                    6
                ),
                jsonb_build_object(
                    'ingestion_run_id',
                    '38103a22-dc31-4060-aead-7bad9b77a174',
                    'paper_variant',
                    '42',
                    'question_number',
                    7,
                    'part_path',
                    jsonb_build_array('a'),
                    'mark_scheme_sequence',
                    6
                )
            )
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
