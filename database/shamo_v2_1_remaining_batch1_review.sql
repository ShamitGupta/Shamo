-- Shamo v2.1: read-only review of the four remaining staged batch papers.
--
-- Papers: Cambridge 9709 variants 12, 21, 32 and 41.
-- Run each numbered section separately in the Supabase SQL editor.
-- This script makes no OCR, OpenAI or embedding API calls.

-- ---------------------------------------------------------------------------
-- Section 1: readiness overview.
-- Expected: four rows. Each should have zero open blockers and a PASS result.
-- Warnings are deliberately retained until source review is complete.
-- ---------------------------------------------------------------------------

with targets as (
    select *
    from (
        values
            (
                '12'::text,
                '414a7734-2afe-4bab-9896-02649106d027'::uuid
            ),
            (
                '21'::text,
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
            ),
            (
                '32'::text,
                '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
            ),
            (
                '41'::text,
                '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
            )
    ) as selected(paper_variant, ingestion_run_id)
)
select
    target.paper_variant,
    run.id as ingestion_run_id,
    run.status,
    run.review_status,
    run.extraction_summary ->> 'ready_for_approval'
        as ready_for_approval,
    run.validation_report ->> 'passed' as validation_passed,
    run.verifier_report ->> 'passed' as verifier_passed,
    run.question_count,
    run.question_part_count,
    run.asset_count,
    count(issue.id) filter (
        where issue.resolved = false
          and issue.severity = 'blocking'
    ) as open_blockers,
    count(issue.id) filter (
        where issue.resolved = false
          and issue.severity = 'warning'
    ) as open_warnings,
    case
        when run.status = 'awaiting_review'
         and run.review_status = 'pending'
         and run.extraction_summary ->> 'ready_for_approval' = 'true'
         and run.validation_report ->> 'passed' = 'true'
         and run.verifier_report ->> 'passed' = 'true'
         and count(issue.id) filter (
             where issue.resolved = false
               and issue.severity = 'blocking'
         ) = 0
        then 'PASS'
        else 'FAIL'
    end as result
from targets as target
join public.shamo_ingestion_runs as run
  on run.id = target.ingestion_run_id
left join public.shamo_ingestion_issues as issue
  on issue.ingestion_run_id = run.id
group by
    target.paper_variant,
    run.id
order by target.paper_variant;

-- ---------------------------------------------------------------------------
-- Section 2: every unresolved warning.
-- Return this result even if it matches an earlier audit.
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    issue.severity,
    issue.issue_code,
    issue.question_number,
    issue.part_path,
    issue.message
from public.shamo_ingestion_issues as issue
join public.shamo_ingestion_runs as run
  on run.id = issue.ingestion_run_id
join public.shamo_papers as paper
  on paper.id = run.paper_id
where issue.ingestion_run_id in (
    '414a7734-2afe-4bab-9896-02649106d027'::uuid,
    '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
    '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
    '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
)
  and issue.resolved = false
order by
    paper.paper_variant,
    issue.severity desc,
    issue.question_number,
    issue.issue_code;

-- ---------------------------------------------------------------------------
-- Section 3: recompute mark-code coverage for every warned question.
--
-- all_code_marks < total_marks:
--   a mark code may be missing, malformed or stored as a subtotal.
-- primary_code_marks < total_marks but all_code_marks >= total_marks:
--   inspect alternative-method flags.
-- ---------------------------------------------------------------------------

with warned_questions as (
    select distinct
        issue.ingestion_run_id,
        issue.question_number
    from public.shamo_ingestion_issues as issue
    where issue.ingestion_run_id in (
        '414a7734-2afe-4bab-9896-02649106d027'::uuid,
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
    )
      and issue.issue_code = 'MARK_CODE_COVERAGE_TOO_LOW'
      and issue.resolved = false
),
questions as (
    select
        paper.paper_variant,
        run.id as ingestion_run_id,
        question as question_json,
        (question ->> 'question_number')::integer as question_number,
        (question ->> 'total_marks')::integer as total_marks
    from public.shamo_ingestion_runs as run
    join public.shamo_papers as paper
      on paper.id = run.paper_id
    join warned_questions as warned
      on warned.ingestion_run_id = run.id
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    where (question ->> 'question_number')::integer =
        warned.question_number
),
mark_rows as (
    select
        question.paper_variant,
        question.question_number,
        question.total_marks,
        coalesce(
            (mark_item ->> 'is_alternative_method')::boolean,
            false
        ) as is_alternative_method,
        coalesce(
            (
                select sum((found.captures)[2]::integer)
                from regexp_matches(
                    coalesce(mark_item ->> 'mark_code', ''),
                    '\*?(D?M|A|B)([0-9]+)',
                    'gi'
                ) as found(captures)
            ),
            0
        ) as mark_value
    from questions as question
    cross join lateral jsonb_array_elements(
        question.question_json -> 'mark_scheme_items'
    ) as mark_item
)
select
    paper_variant,
    question_number,
    total_marks,
    coalesce(
        sum(mark_value) filter (
            where is_alternative_method = false
        ),
        0
    ) as primary_code_marks,
    sum(mark_value) as all_code_marks,
    count(*) filter (
        where is_alternative_method = true
    ) as alternative_rows,
    case
        when sum(mark_value) < total_marks
            then 'CHECK_MISSING_OR_MALFORMED_CODE'
        when coalesce(
            sum(mark_value) filter (
                where is_alternative_method = false
            ),
            0
        ) < total_marks
            then 'CHECK_ALTERNATIVE_FLAGS'
        else 'COVERAGE_OK'
    end as audit_result
from mark_rows
group by
    paper_variant,
    question_number,
    total_marks
order by
    paper_variant,
    question_number;

-- ---------------------------------------------------------------------------
-- Section 4: every mark-scheme row for the coverage-warning questions.
-- Attach this result as a text file because it may be long.
-- ---------------------------------------------------------------------------

with warned_questions as (
    select distinct
        issue.ingestion_run_id,
        issue.question_number
    from public.shamo_ingestion_issues as issue
    where issue.ingestion_run_id in (
        '414a7734-2afe-4bab-9896-02649106d027'::uuid,
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
    )
      and issue.issue_code = 'MARK_CODE_COVERAGE_TOO_LOW'
      and issue.resolved = false
)
select
    paper.paper_variant,
    (question ->> 'question_number')::integer as question_number,
    (mark_item ->> 'sequence_number')::integer as sequence_number,
    mark_item -> 'part_path' as part_path,
    mark_item ->> 'mark_code' as mark_code,
    (mark_item ->> 'is_alternative_method')::boolean
        as is_alternative_method,
    mark_item ->> 'content_markdown' as content_markdown,
    mark_item ->> 'guidance_markdown' as guidance_markdown,
    mark_item -> 'source_page_numbers' as source_page_numbers
from public.shamo_ingestion_runs as run
join public.shamo_papers as paper
  on paper.id = run.paper_id
join warned_questions as warned
  on warned.ingestion_run_id = run.id
cross join lateral jsonb_array_elements(
    run.extraction_summary #> '{paper_bundle,questions}'
) as question
cross join lateral jsonb_array_elements(
    question -> 'mark_scheme_items'
) as mark_item
where (question ->> 'question_number')::integer =
    warned.question_number
order by
    paper.paper_variant,
    question_number,
    sequence_number;

-- ---------------------------------------------------------------------------
-- Section 5: every low-confidence metadata record with its question text.
-- Attach this result as a text file if needed.
-- ---------------------------------------------------------------------------

with warned_questions as (
    select distinct
        issue.ingestion_run_id,
        issue.question_number
    from public.shamo_ingestion_issues as issue
    where issue.ingestion_run_id in (
        '414a7734-2afe-4bab-9896-02649106d027'::uuid,
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
    )
      and issue.issue_code = 'LOW_METADATA_CONFIDENCE'
      and issue.resolved = false
)
select
    paper.paper_variant,
    (question ->> 'question_number')::integer as question_number,
    left(
        concat_ws(
            E'\n\n',
            nullif(question ->> 'stem_markdown', ''),
            (
                select string_agg(
                    part ->> 'prompt_markdown',
                    E'\n\n'
                    order by part_index
                )
                from jsonb_array_elements(
                    coalesce(question -> 'parts', '[]'::jsonb)
                ) with ordinality as selected_part(part, part_index)
            )
        ),
        1200
    ) as question_preview,
    question -> 'metadata' ->> 'main_topic' as main_topic,
    question -> 'metadata' -> 'subtopics' as subtopics,
    question -> 'metadata' -> 'skills' as skills,
    question -> 'metadata' -> 'methods' as methods,
    question -> 'metadata' ->> 'question_style' as question_style,
    question -> 'metadata' ->> 'difficulty_level'
        as difficulty_level,
    question -> 'metadata' ->> 'calculator_required'
        as calculator_required,
    question -> 'metadata' ->> 'diagram_required'
        as diagram_required,
    question -> 'metadata' ->> 'classification_confidence'
        as classification_confidence
from public.shamo_ingestion_runs as run
join public.shamo_papers as paper
  on paper.id = run.paper_id
join warned_questions as warned
  on warned.ingestion_run_id = run.id
cross join lateral jsonb_array_elements(
    run.extraction_summary #> '{paper_bundle,questions}'
) as question
where (question ->> 'question_number')::integer =
    warned.question_number
order by
    paper.paper_variant,
    question_number;

-- ---------------------------------------------------------------------------
-- Section 6: structural anomaly audit over all four staged bundles.
-- Expected: every numeric result is 0 and result says PASS.
-- ---------------------------------------------------------------------------

with mark_rows as (
    select
        paper.paper_variant,
        mark_item
    from public.shamo_ingestion_runs as run
    join public.shamo_papers as paper
      on paper.id = run.paper_id
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where run.id in (
        '414a7734-2afe-4bab-9896-02649106d027'::uuid,
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
    )
),
checks as (
    select
        count(*) filter (
            where mark_item ->> 'mark_code' is not null
              and btrim(mark_item ->> 'mark_code') !~*
                  '^\*?(D?M|A|B)[0-9]+([[:space:]]*FT)?'
                  '([[:space:]]+[A-Z][A-Z0-9]*)*$'
        ) as invalid_mark_codes,
        count(*) filter (
            where btrim(coalesce(
                mark_item ->> 'mark_code',
                ''
            )) ~ '^\*{0,2}[0-9]+\*{0,2}$'
              or (
                  lower(coalesce(
                      mark_item ->> 'content_markdown',
                      ''
                  )) like 'total marks%'
                  and btrim(coalesce(
                      mark_item ->> 'guidance_markdown',
                      ''
                  )) = ''
              )
        ) as standalone_subtotals,
        count(*) filter (
            where btrim(coalesce(
                mark_item ->> 'content_markdown',
                ''
            )) = ''
              and btrim(coalesce(
                mark_item ->> 'guidance_markdown',
                ''
            )) = ''
        ) as completely_empty_rows,
        count(*) filter (
            where length(btrim(coalesce(
                mark_item ->> 'content_markdown',
                ''
            ))) >= 20
              and lower(regexp_replace(
                  btrim(mark_item ->> 'content_markdown'),
                  '\s+',
                  ' ',
                  'g'
              )) = lower(regexp_replace(
                  btrim(mark_item ->> 'guidance_markdown'),
                  '\s+',
                  ' ',
                  'g'
              ))
        ) as exact_answer_guidance_duplicates,
        count(*) filter (
            where coalesce(mark_item::text, '') ~
                '(â€|â€“|â€”|Â|ï¿½|�)'
        ) as corrupted_text_rows
    from mark_rows
)
select
    *,
    case
        when invalid_mark_codes = 0
         and standalone_subtotals = 0
         and completely_empty_rows = 0
         and exact_answer_guidance_duplicates = 0
         and corrupted_text_rows = 0
        then 'PASS'
        else 'CHECK'
    end as result
from checks;
