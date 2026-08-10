-- Shamo v2.1: focused audit of the remaining paper 52 and paper 61 warnings.
--
-- This file is read-only. Run each section separately and return the results.

-- ---------------------------------------------------------------------------
-- Section 1: recompute coverage with the v2.1 mark-code parser.
--
-- Interpretation:
--   all_code_marks < total_marks:
--       a mark code may be missing or malformed.
--   all_code_marks >= total_marks but primary_code_marks < total_marks:
--       one or more rows may be incorrectly labelled as an alternative method,
--       or the source genuinely provides alternative marking routes.
-- ---------------------------------------------------------------------------

with questions as (
    select
        paper.paper_variant,
        run.id as ingestion_run_id,
        question as question_json,
        (question ->> 'question_number')::integer as question_number,
        (question ->> 'total_marks')::integer as total_marks
    from public.shamo_ingestion_runs as run
    join public.shamo_papers as paper
        on paper.id = run.paper_id
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    where run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and (question ->> 'question_number')::integer in (1, 2, 4, 5, 6)
),
mark_rows as (
    select
        questions.paper_variant,
        questions.question_number,
        questions.total_marks,
        (mark_item ->> 'is_alternative_method')::boolean
            as is_alternative_method,
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
    from questions
    cross join lateral jsonb_array_elements(
        questions.question_json -> 'mark_scheme_items'
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
group by paper_variant, question_number, total_marks
order by question_number;

-- ---------------------------------------------------------------------------
-- Section 2: inspect every extracted mark-scheme row for the five questions.
-- Pay particular attention to rows where is_alternative_method = true.
-- ---------------------------------------------------------------------------

select
    (question ->> 'question_number')::integer as question_number,
    (mark_item ->> 'sequence_number')::integer as sequence_number,
    mark_item -> 'part_path' as part_path,
    mark_item ->> 'mark_code' as mark_code,
    (mark_item ->> 'is_alternative_method')::boolean
        as is_alternative_method,
    left(mark_item ->> 'content_markdown', 180) as content_preview,
    left(mark_item ->> 'guidance_markdown', 180) as guidance_preview,
    mark_item -> 'source_page_numbers' as source_page_numbers
from public.shamo_ingestion_runs as run
cross join lateral jsonb_array_elements(
    run.extraction_summary #> '{paper_bundle,questions}'
) as question
cross join lateral jsonb_array_elements(
    question -> 'mark_scheme_items'
) as mark_item
where run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
  and (question ->> 'question_number')::integer in (1, 2, 4, 5, 6)
order by question_number, sequence_number;

-- ---------------------------------------------------------------------------
-- Section 3: inspect the two low-confidence metadata records.
-- ---------------------------------------------------------------------------

select
    paper.paper_variant,
    (question ->> 'question_number')::integer as question_number,
    left(question ->> 'stem_markdown', 500) as question_preview,
    question -> 'metadata' ->> 'main_topic' as main_topic,
    question -> 'metadata' -> 'subtopics' as subtopics,
    question -> 'metadata' -> 'skills' as skills,
    question -> 'metadata' -> 'methods' as methods,
    question -> 'metadata' ->> 'question_style' as question_style,
    question -> 'metadata' ->> 'difficulty_level' as difficulty_level,
    question -> 'metadata' ->> 'classification_confidence'
        as classification_confidence
from public.shamo_ingestion_runs as run
join public.shamo_papers as paper
    on paper.id = run.paper_id
cross join lateral jsonb_array_elements(
    run.extraction_summary #> '{paper_bundle,questions}'
) as question
where (
    run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
    and (question ->> 'question_number')::integer = 5
) or (
    run.id = '054f296f-e08c-4360-a27d-325d064b2496'::uuid
    and (question ->> 'question_number')::integer = 3
)
order by paper.paper_variant;
