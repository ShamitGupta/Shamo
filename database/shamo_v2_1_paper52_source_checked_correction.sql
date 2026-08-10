-- Shamo v2.1: source-checked correction for the remaining 9709/52
-- February/March 2024 staged mark-scheme issues.
--
-- This script is based on a visual comparison with official mark-scheme
-- pages 6-17. It does not publish the paper or resolve the existing warnings.
-- It updates only ingestion run 754da6c9-7ee7-4699-9cd9-718e63dc1a15.
--
-- Corrections:
--   Q1: remove printed part totals; restore the missing second M1.
--   Q2: restore missing A1, A1 and M1 codes.
--   Q4: restore two missing M1 codes.
--   Q5: remove printed part totals, rebuild the probability table, and mark
--       the E(X) row as primary.
--   Q6: make Method 1 primary and restore two Method 4 M1 codes.
--
-- Run the whole file once in the Supabase SQL editor.

begin;

set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $$
declare
    staged_summary jsonb;
    staged_questions jsonb;
    rebuilt_questions jsonb := '[]'::jsonb;
    rebuilt_items jsonb;
    question_item jsonb;
    mark_item jsonb;
    question_number integer;
    old_sequence integer;
    new_sequence integer;
    matching_count integer;
    probability_table text :=
        '| $x$ | 0 | 1 | 2 | 3 | 4 | 5 | 6 |' || E'\n'
        || '|---:|---:|---:|---:|---:|---:|---:|---:|' || E'\n'
        || '| $P(X=x)$ | $0.008=\frac{1}{125}$ | '
        || '$0.036=\frac{9}{250}$ | $0.114$ | $0.207$ | $0.285$ | '
        || '$0.225=\frac{9}{40}$ | $0.125$ |';
begin
    select extraction_summary
    into staged_summary
    from public.shamo_ingestion_runs
    where id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid
      and status = 'awaiting_review'
      and review_status = 'pending'
    for update;

    if staged_summary is null then
        raise exception
            'Safety stop: paper 52 is no longer awaiting_review/pending.';
    end if;

    staged_questions := staged_summary #> '{paper_bundle,questions}';
    if jsonb_typeof(staged_questions) <> 'array' then
        raise exception 'Safety stop: the staged question array is missing.';
    end if;

    -- Confirm that every source-checked target still has its original value.
    select count(*)
    into matching_count
    from jsonb_array_elements(staged_questions) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as item
    where (
        (question ->> 'question_number')::integer = 1
        and (
            ((item ->> 'sequence_number')::integer = 2
             and item ->> 'content_markdown' = '**1**')
            or ((item ->> 'sequence_number')::integer = 4
                and item ->> 'mark_code' is null
                and item ->> 'content_markdown' = '**M1**')
            or ((item ->> 'sequence_number')::integer = 6
                and item ->> 'content_markdown' = '**3**')
        )
    ) or (
        (question ->> 'question_number')::integer = 2
        and (item ->> 'sequence_number')::integer in (2, 5, 12)
        and item ->> 'mark_code' is null
    ) or (
        (question ->> 'question_number')::integer = 4
        and (item ->> 'sequence_number')::integer in (12, 13)
        and item ->> 'mark_code' is null
    ) or (
        (question ->> 'question_number')::integer = 5
        and (
            ((item ->> 'sequence_number')::integer in (3, 7, 12)
             and item ->> 'mark_code' in ('2', '3'))
            or ((item ->> 'sequence_number')::integer = 8
                and item ->> 'mark_code' is null)
            or ((item ->> 'sequence_number')::integer = 9
                and (item ->> 'is_alternative_method')::boolean = true)
        )
    ) or (
        (question ->> 'question_number')::integer = 6
        and (
            ((item ->> 'sequence_number')::integer between 9 and 13
             and (item ->> 'is_alternative_method')::boolean = true)
            or ((item ->> 'sequence_number')::integer in (26, 27)
                and item ->> 'mark_code' is null)
        )
    );

    if matching_count <> 20 then
        raise exception
            'Safety stop: expected 20 exact correction targets; found %',
            matching_count;
    end if;

    for question_item in
        select value
        from jsonb_array_elements(staged_questions)
    loop
        question_number := (question_item ->> 'question_number')::integer;

        if question_number not in (1, 2, 4, 5, 6) then
            rebuilt_questions :=
                rebuilt_questions || jsonb_build_array(question_item);
            continue;
        end if;

        rebuilt_items := '[]'::jsonb;
        new_sequence := 1;

        for mark_item in
            select value
            from jsonb_array_elements(question_item -> 'mark_scheme_items')
            order by (value ->> 'sequence_number')::integer
        loop
            old_sequence := (mark_item ->> 'sequence_number')::integer;

            -- Printed totals are not mark-scheme rows.
            if (question_number = 1 and old_sequence in (2, 6))
               or (question_number = 5 and old_sequence in (3, 7, 12))
            then
                continue;
            end if;

            if question_number = 1 and old_sequence = 4 then
                mark_item := mark_item || jsonb_build_object(
                    'mark_code', 'M1',
                    'content_markdown', ''
                );
            elsif question_number = 2 and old_sequence in (2, 5) then
                mark_item := mark_item || jsonb_build_object(
                    'mark_code', 'A1'
                );
            elsif question_number = 2 and old_sequence = 12 then
                mark_item := mark_item || jsonb_build_object(
                    'mark_code', 'M1'
                );
            elsif question_number = 4 and old_sequence in (12, 13) then
                mark_item := mark_item || jsonb_build_object(
                    'mark_code', 'M1'
                );
            elsif question_number = 5 and old_sequence = 4 then
                mark_item := mark_item || jsonb_build_object(
                    'content_markdown', probability_table
                );
            elsif question_number = 5 and old_sequence in (5, 6) then
                mark_item := mark_item || jsonb_build_object(
                    'content_markdown', ''
                );
            elsif question_number = 5 and old_sequence = 8 then
                -- This fragment is now included in the complete table.
                continue;
            elsif question_number = 5 and old_sequence = 9 then
                mark_item := mark_item || jsonb_build_object(
                    'is_alternative_method', false
                );
            elsif question_number = 6 and old_sequence between 9 and 13 then
                mark_item := mark_item || jsonb_build_object(
                    'is_alternative_method', false
                );
            elsif question_number = 6 and old_sequence in (26, 27) then
                mark_item := mark_item || jsonb_build_object(
                    'mark_code', 'M1'
                );
            end if;

            mark_item := mark_item || jsonb_build_object(
                'sequence_number', new_sequence
            );
            rebuilt_items := rebuilt_items || jsonb_build_array(mark_item);
            new_sequence := new_sequence + 1;
        end loop;

        question_item := jsonb_set(
            question_item,
            '{mark_scheme_items}',
            rebuilt_items,
            false
        );
        rebuilt_questions :=
            rebuilt_questions || jsonb_build_array(question_item);
    end loop;

    staged_summary := jsonb_set(
        staged_summary,
        '{paper_bundle,questions}',
        rebuilt_questions,
        false
    );
    staged_summary := staged_summary || jsonb_build_object(
        'source_checked_correction',
        jsonb_build_object(
            'version', 'v2.1',
            'corrected_at', now(),
            'paper_variant', '52',
            'questions', jsonb_build_array(1, 2, 4, 5, 6),
            'source', 'Official 9709/52 February/March 2024 mark scheme'
        )
    );

    update public.shamo_ingestion_runs
    set
        extraction_summary = staged_summary,
        updated_at = now()
    where id = '754da6c9-7ee7-4699-9cd9-718e63dc1a15'::uuid;
end;
$$;

commit;
