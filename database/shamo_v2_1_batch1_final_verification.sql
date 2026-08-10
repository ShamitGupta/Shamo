-- Verification for shamo_v2_1_batch1_final_cleanup_and_signoff.sql.
-- Run each numbered section separately.

-- ---------------------------------------------------------------------------
-- Section 1: both staged runs are clean and ready.
-- Expected: two rows and every result = PASS.
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    run.status,
    run.review_status,
    run.extraction_summary ->> 'ready_for_approval'
        as ready_for_approval,
    run.validation_report ->> 'passed' as validation_passed,
    run.verifier_report ->> 'passed' as verifier_passed,
    count(issue.id) filter (
        where issue.resolved = false
    ) as unresolved_issue_count,
    case
        when run.status = 'awaiting_review'
         and run.review_status = 'pending'
         and run.extraction_summary ->> 'ready_for_approval' = 'true'
         and run.validation_report ->> 'passed' = 'true'
         and run.verifier_report ->> 'passed' = 'true'
         and count(issue.id) filter (
             where issue.resolved = false
         ) = 0
        then 'PASS'
        else 'FAIL'
    end as result
from public.shamo_ingestion_runs as run
join public.shamo_papers as paper
  on paper.id = run.paper_id
left join public.shamo_ingestion_issues as issue
  on issue.ingestion_run_id = run.id
where run.id in (
    '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid,
    '054f296f-e08c-4360-a27d-325d064b2496'::uuid
)
group by
    paper.paper_variant,
    run.status,
    run.review_status,
    run.extraction_summary,
    run.validation_report,
    run.verifier_report
order by paper.paper_variant;

-- ---------------------------------------------------------------------------
-- Section 2: paper 52, question 5 no longer duplicates mark codes.
-- Expected: eight rows; sequence 2 mark_code=A1; every prefix_result=PASS.
-- ---------------------------------------------------------------------------

select
    (mark_item ->> 'sequence_number')::integer as sequence_number,
    mark_item -> 'part_path' as part_path,
    mark_item ->> 'mark_code' as mark_code,
    left(mark_item ->> 'guidance_markdown', 150) as guidance_preview,
    case
        when starts_with(
            upper(btrim(coalesce(
                mark_item ->> 'guidance_markdown',
                ''
            ))),
            upper(mark_item ->> 'mark_code') || ' '
        )
          or starts_with(
              upper(btrim(coalesce(
                  mark_item ->> 'guidance_markdown',
                  ''
              ))),
              upper(mark_item ->> 'mark_code') || '.'
          )
          or starts_with(
              upper(btrim(coalesce(
                  mark_item ->> 'guidance_markdown',
                  ''
              ))),
              upper(mark_item ->> 'mark_code') || ':'
          )
        then 'FAIL'
        else 'PASS'
    end as prefix_result
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
order by sequence_number;

-- ---------------------------------------------------------------------------
-- Section 3: paper 52, question 6 blank Answer cells.
-- Expected: six rows and every result=PASS.
-- ---------------------------------------------------------------------------

select
    (mark_item ->> 'sequence_number')::integer as sequence_number,
    mark_item ->> 'mark_code' as mark_code,
    (mark_item ->> 'is_alternative_method')::boolean
        as is_alternative_method,
    mark_item ->> 'content_markdown' as content_markdown,
    left(mark_item ->> 'guidance_markdown', 150) as guidance_preview,
    case
        when btrim(coalesce(mark_item ->> 'content_markdown', '')) = ''
         and btrim(coalesce(mark_item ->> 'guidance_markdown', '')) <> ''
         and mark_item ->> 'mark_code' = 'M1'
        then 'PASS'
        else 'FAIL'
    end as result
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
order by sequence_number;

-- ---------------------------------------------------------------------------
-- Section 4: final paper 52 structural checks.
-- Expected: every count=0 and result=PASS.
-- ---------------------------------------------------------------------------

with mark_rows as (
    select
        (question ->> 'question_number')::integer as question_number,
        mark_item
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where run.id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
),
checks as (
    select
        count(*) filter (
            where mark_item ->> 'mark_code' is not null
              and btrim(mark_item ->> 'mark_code')
                  !~* '^\*?(D?M|A|B)[0-9]+(\s+[A-Z][A-Z0-9]*)*$'
        ) as invalid_mark_codes,
        count(*) filter (
            where mark_item ->> 'mark_code' is null
              and btrim(coalesce(
                  mark_item ->> 'guidance_markdown',
                  ''
              )) = ''
              and btrim(coalesce(
                  mark_item ->> 'content_markdown',
                  ''
              )) ~ '^\*{0,2}[0-9]{1,3}\*{0,2}$'
        ) as standalone_subtotals,
        count(*) filter (
            where mark_item ->> 'mark_code' is not null
              and (
                  starts_with(
                      upper(btrim(coalesce(
                          mark_item ->> 'guidance_markdown',
                          ''
                      ))),
                      upper(mark_item ->> 'mark_code') || ' '
                  )
                  or starts_with(
                      upper(btrim(coalesce(
                          mark_item ->> 'guidance_markdown',
                          ''
                      ))),
                      upper(mark_item ->> 'mark_code') || '.'
                  )
                  or starts_with(
                      upper(btrim(coalesce(
                          mark_item ->> 'guidance_markdown',
                          ''
                      ))),
                      upper(mark_item ->> 'mark_code') || ':'
                  )
              )
        ) as mark_codes_copied_into_guidance,
        count(*) filter (
            where btrim(coalesce(
                mark_item ->> 'content_markdown',
                ''
            )) <> ''
              and btrim(coalesce(
                mark_item ->> 'guidance_markdown',
                ''
            )) <> ''
              and lower(btrim(mark_item ->> 'content_markdown')) =
                  lower(btrim(mark_item ->> 'guidance_markdown'))
        ) as exact_answer_guidance_duplicates
    from mark_rows
)
select
    *,
    case
        when invalid_mark_codes = 0
         and standalone_subtotals = 0
         and mark_codes_copied_into_guidance = 0
         and exact_answer_guidance_duplicates = 0
        then 'PASS'
        else 'FAIL'
    end as result
from checks;

-- ---------------------------------------------------------------------------
-- Section 5: all seven reviewed warnings have an audit trail.
-- Expected: seven rows; resolved=true; resolution_note is populated.
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    issue.issue_code,
    issue.question_number,
    issue.resolved,
    issue.resolution_note,
    issue.resolved_at
from public.shamo_ingestion_issues as issue
join public.shamo_ingestion_runs as run
  on run.id = issue.ingestion_run_id
join public.shamo_papers as paper
  on paper.id = run.paper_id
where (
    issue.ingestion_run_id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
    and issue.issue_code = 'MARK_CODE_COVERAGE_TOO_LOW'
    and issue.question_number in (1, 2, 4, 5, 6)
) or (
    issue.ingestion_run_id =
        '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
    and issue.issue_code = 'LOW_METADATA_CONFIDENCE'
    and issue.question_number = 5
) or (
    issue.ingestion_run_id =
        '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    and issue.issue_code = 'LOW_METADATA_CONFIDENCE'
    and issue.question_number = 3
)
order by paper.paper_variant, issue.question_number, issue.issue_code;
