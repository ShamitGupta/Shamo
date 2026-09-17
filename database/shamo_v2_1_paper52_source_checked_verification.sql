-- Verification for shamo_v2_1_paper52_source_checked_correction.sql.
-- Run each section separately.

-- ---------------------------------------------------------------------------
-- Section 1: recomputed coverage.
-- Expected:
--   Q1  primary=4,  all=4
--   Q2  primary=8,  all=13
--   Q4  primary=12, all=12
--   Q5  primary=8,  all=8
--   Q6  primary=10, all=22
-- Every audit_result should be PASS.
-- ---------------------------------------------------------------------------

with questions as (
    select
        question as question_json,
        (question ->> 'question_number')::integer as question_number,
        (question ->> 'total_marks')::integer as total_marks
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    where run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and (question ->> 'question_number')::integer in (1, 2, 4, 5, 6)
),
mark_rows as (
    select
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
    question_number,
    total_marks,
    coalesce(sum(mark_value) filter (
        where is_alternative_method = false
    ), 0) as primary_code_marks,
    sum(mark_value) as all_code_marks,
    case
        when question_number = 1
         and coalesce(sum(mark_value) filter (
             where is_alternative_method = false
         ), 0) = 4
         and sum(mark_value) = 4 then 'PASS'
        when question_number = 2
         and coalesce(sum(mark_value) filter (
             where is_alternative_method = false
         ), 0) = 8
         and sum(mark_value) = 13 then 'PASS'
        when question_number = 4
         and coalesce(sum(mark_value) filter (
             where is_alternative_method = false
         ), 0) = 12
         and sum(mark_value) = 12 then 'PASS'
        when question_number = 5
         and coalesce(sum(mark_value) filter (
             where is_alternative_method = false
         ), 0) = 8
         and sum(mark_value) = 8 then 'PASS'
        when question_number = 6
         and coalesce(sum(mark_value) filter (
             where is_alternative_method = false
         ), 0) = 10
         and sum(mark_value) = 22 then 'PASS'
        else 'FAIL'
    end as audit_result
from mark_rows
group by question_number, total_marks
order by question_number;

-- ---------------------------------------------------------------------------
-- Section 2: no invalid mark codes or standalone subtotal rows.
-- Expected: both counts are 0.
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
    where run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
)
select
    count(*) filter (
        where mark_item ->> 'mark_code' is not null
          and btrim(mark_item ->> 'mark_code')
              !~* '^\*?(D?M|A|B)[0-9]+(\s+[A-Z][A-Z0-9]*)*$'
    ) as invalid_mark_code_count,
    count(*) filter (
        where mark_item ->> 'mark_code' is null
          and btrim(coalesce(mark_item ->> 'guidance_markdown', '')) = ''
          and btrim(coalesce(mark_item ->> 'content_markdown', ''))
              ~ '^\*{0,2}[0-9]{1,3}\*{0,2}$'
    ) as standalone_subtotal_row_count
from mark_rows;

-- ---------------------------------------------------------------------------
-- Section 3: reconstructed question 5 probability table and primary E(X).
-- Expected:
--   one Markdown table row group;
--   sequences 3 and 4 have blank Answer cells;
--   the E(X) M1 row has is_alternative_method=false;
--   no mark_code values "2" or "3".
-- ---------------------------------------------------------------------------

select
    (mark_item ->> 'sequence_number')::integer as sequence_number,
    mark_item -> 'part_path' as part_path,
    mark_item ->> 'mark_code' as mark_code,
    (mark_item ->> 'is_alternative_method')::boolean
        as is_alternative_method,
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
  and (question ->> 'question_number')::integer = 5
order by sequence_number;

-- ---------------------------------------------------------------------------
-- Section 4: question 6(c) method flags and restored codes.
-- Expected:
--   Method 1 rows are false;
--   Methods 2-4 are true;
--   the two formerly blank Method 4 marks are M1.
-- ---------------------------------------------------------------------------

select
    (mark_item ->> 'sequence_number')::integer as sequence_number,
    mark_item ->> 'mark_code' as mark_code,
    (mark_item ->> 'is_alternative_method')::boolean
        as is_alternative_method,
    left(mark_item ->> 'content_markdown', 120) as content_preview,
    left(mark_item ->> 'guidance_markdown', 120) as guidance_preview
from public.shamo_ingestion_runs as run
cross join lateral jsonb_array_elements(
    run.extraction_summary #> '{paper_bundle,questions}'
) as question
cross join lateral jsonb_array_elements(
    question -> 'mark_scheme_items'
) as mark_item
where run.id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
  and (question ->> 'question_number')::integer = 6
  and mark_item -> 'part_path' = '["c"]'::jsonb
order by sequence_number;

