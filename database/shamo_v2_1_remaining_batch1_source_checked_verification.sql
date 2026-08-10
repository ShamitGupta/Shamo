-- Shamo v2.1: verification after source-checked correction of papers
-- 12, 21, 32 and 41.
--
-- Run each numbered section separately in the Supabase SQL editor.
-- Every row/result should say PASS before publishing any of these papers.
-- This file is read-only and makes no API calls.

-- ---------------------------------------------------------------------------
-- Section 1: all four runs remain staged and have no unresolved issues.
-- Expected: four PASS rows.
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
         and run.extraction_summary
                #>> '{remaining_batch1_source_review,result}' = 'PASS'
         and count(issue.id) filter (
             where issue.resolved = false
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
-- Section 2: structural mark-scheme cleanup.
-- Expected: every numeric result is 0 and result says PASS.
-- ---------------------------------------------------------------------------

with mark_rows as (
    select mark_item
    from public.shamo_ingestion_runs as run
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
                '(Ã¢â‚¬|Ã¢â‚¬â€œ|Ã¢â‚¬â€|Ã‚|Ã¯Â¿Â½|ï¿½)'
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
        else 'FAIL'
    end as result
from checks;

-- ---------------------------------------------------------------------------
-- Section 3: exact primary mark coverage for all 36 questions.
-- Expected: 36 rows and every result says PASS.
-- Alternative/special-case rows may make all_code_marks larger.
-- ---------------------------------------------------------------------------

with questions as (
    select
        paper.paper_variant,
        question as question_json,
        (question ->> 'question_number')::integer as question_number,
        (question ->> 'total_marks')::integer as total_marks
    from public.shamo_ingestion_runs as run
    join public.shamo_papers as paper
      on paper.id = run.paper_id
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    where run.id in (
        '414a7734-2afe-4bab-9896-02649106d027'::uuid,
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
    )
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
    ) as alternative_or_special_case_rows,
    case
        when coalesce(
            sum(mark_value) filter (
                where is_alternative_method = false
            ),
            0
        ) = total_marks
        then 'PASS'
        else 'FAIL'
    end as result
from mark_rows
group by
    paper_variant,
    question_number,
    total_marks
order by
    paper_variant,
    question_number;

-- ---------------------------------------------------------------------------
-- Section 4: exact source-recovery and special-code checks.
-- Expected: every row says PASS.
-- ---------------------------------------------------------------------------

with checks as (
    select
        'Paper 12 Q7 dependency mark'::text as check_name,
        count(*)::integer as actual_count,
        1::integer as expected_count
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where run.id =
        '414a7734-2afe-4bab-9896-02649106d027'::uuid
      and (question ->> 'question_number')::integer = 7
      and mark_item ->> 'mark_code' = '*M1'
      and (mark_item ->> 'is_alternative_method')::boolean = false

    union all

    select
        'Paper 21 Q5(c) restored rows',
        count(*)::integer,
        3
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where run.id =
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
      and (question ->> 'question_number')::integer = 5
      and mark_item -> 'part_path' = '["c"]'::jsonb
      and mark_item ->> 'mark_code' in ('M1', 'A1')
      and mark_item -> 'source_page_numbers' = '[10]'::jsonb

    union all

    select
        'Paper 21 Q7 special-case mark',
        count(*)::integer,
        1
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where run.id =
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
      and (question ->> 'question_number')::integer = 7
      and mark_item ->> 'mark_code' = 'B1'
      and (mark_item ->> 'is_alternative_method')::boolean = true
      and mark_item ->> 'content_markdown'
          like 'Show that the remainder%'

    union all

    select
        'Paper 32 Q9(d) restored rows',
        count(*)::integer,
        3
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where run.id =
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
      and (question ->> 'question_number')::integer = 9
      and mark_item -> 'part_path' = '["d"]'::jsonb
      and mark_item ->> 'mark_code' in ('M1', 'A1')
      and mark_item -> 'source_page_numbers' = '[19]'::jsonb

    union all

    select
        'Paper 32 Q10 dependency mark',
        count(*)::integer,
        1
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as mark_item
    where run.id =
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
      and (question ->> 'question_number')::integer = 10
      and mark_item ->> 'mark_code' = '*M1'
      and (mark_item ->> 'is_alternative_method')::boolean = false
      -- Do not use LIKE here: its default backslash escape would interpret
      -- the LaTeX "\int" as "int" and incorrectly reject the source row.
      and strpos(
          mark_item ->> 'content_markdown',
          'Use $$\int'
      ) = 1
)
select
    check_name,
    actual_count,
    expected_count,
    case
        when actual_count = expected_count then 'PASS'
        else 'FAIL'
    end as result
from checks
order by check_name;

-- ---------------------------------------------------------------------------
-- Section 5: reviewed text and metadata corrections.
-- Expected: one PASS row.
-- ---------------------------------------------------------------------------

with selected_questions as (
    select
        run.id as ingestion_run_id,
        (question ->> 'question_number')::integer as question_number,
        question
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
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
            where ingestion_run_id =
                '414a7734-2afe-4bab-9896-02649106d027'::uuid
              and question_number = 4
              and question -> 'metadata' -> 'methods' @>
                  '["Use the identity to reduce the equation to tan(theta)=5/4, then apply the stated interval"]'::jsonb
        ) as paper12_q4_method,
        count(*) filter (
            where ingestion_run_id =
                '414a7734-2afe-4bab-9896-02649106d027'::uuid
              and question_number = 8
              and question -> 'metadata' ->> 'main_topic' = 'Algebra'
        ) as paper12_q8_topic,
        count(*) filter (
            where ingestion_run_id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
              and question_number = 3
              and question ->> 'stem_markdown' = ''
              and (question -> 'metadata'
                    ->> 'diagram_required')::boolean = false
        ) as paper21_q3_text_and_diagram,
        count(*) filter (
            where ingestion_run_id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
              and question_number = 4
              and question ->> 'stem_markdown' = ''
        ) as paper21_q4_text,
        count(*) filter (
            where ingestion_run_id =
                '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
              and question_number = 5
              and question -> 'metadata' -> 'methods' @>
                  '["Let x_n tend to L, take limits in the recurrence and rearrange to recover e^(2L)=5+cos(3L)"]'::jsonb
        ) as paper32_q5_method,
        count(*) filter (
            where ingestion_run_id =
                '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
              and question_number in (3, 4)
              and question -> 'metadata'
                    ->> 'question_style' = 'multi_step_problem'
        ) as paper41_styles
    from selected_questions
)
select
    *,
    case
        when paper12_q4_method = 1
         and paper12_q8_topic = 1
         and paper21_q3_text_and_diagram = 1
         and paper21_q4_text = 1
         and paper32_q5_method = 1
         and paper41_styles = 2
        then 'PASS'
        else 'FAIL'
    end as result
from checks;

-- ---------------------------------------------------------------------------
-- Section 6: resolved audit trail.
-- Expected: 22 rows (15 original warnings + 7 added audit records), all
-- resolved=true. This section is informational; inspect the notes.
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    issue.issue_code,
    issue.question_number,
    issue.part_path,
    issue.resolved,
    issue.resolution_note,
    issue.resolved_at
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
  and issue.resolved_at >= (
      run.extraction_summary
          #>> '{remaining_batch1_source_review,reviewed_at}'
  )::timestamptz - interval '1 second'
order by
    paper.paper_variant,
    issue.question_number nulls first,
    issue.issue_code;
