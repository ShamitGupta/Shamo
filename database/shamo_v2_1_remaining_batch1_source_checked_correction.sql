-- Shamo v2.1: source-checked correction and review sign-off for the
-- remaining four papers in the first 9709 calibration batch.
--
-- Papers:
--   12: 9709 February/March 2024
--   21: 9709 May/June 2024
--   32: 9709 May/June 2024
--   41: 9709 October/November 2025
--
-- This script:
--   1. removes all 41 printed subtotal rows;
--   2. removes Markdown/parenthesis wrappers from Cambridge mark codes;
--   3. preserves dependency stars and normalizes compact FT/multiple codes;
--   4. classifies Paper 21 Question 7's SC B1 as a non-primary special case;
--   5. restores Paper 21 Question 5(c), omitted when extraction stopped one
--      mark-scheme page early;
--   6. restores Paper 32 Question 9(d), omitted for the same reason;
--   7. fixes two dependency marks incorrectly labelled as alternatives;
--   8. corrects the reviewed metadata and two stray question-number stems;
--   9. resolves all 15 source-reviewed warnings; and
--  10. refreshes the four run-level review summaries.
--
-- It does not publish any paper and makes no OCR/OpenAI/API calls.
-- Run the whole file once in the Supabase SQL editor.

begin;

set local statement_timeout = '45s';
set local lock_timeout = '5s';

do $shamo_fix$
declare
    run_record record;
    staged_summary jsonb;
    staged_questions jsonb;
    rebuilt_questions jsonb;
    rebuilt_items jsonb;
    question_item jsonb;
    mark_item jsonb;
    metadata_item jsonb;
    question_number integer;
    old_sequence integer;
    new_sequence integer;
    raw_code text;
    normalized_code text;
    paper_variant text;
    matching_run_count integer;
    open_issue_count integer;
    invalid_code_count integer;
    subtotal_count integer;
    empty_row_count integer;
    missing_target_row_count integer;
    incorrect_alternative_count integer;
    metadata_target_count integer;
    run_removed_subtotals integer;
    run_normalized_codes integer;
    run_added_rows integer;
    run_metadata_changes integer;
begin
    select count(*)
    into matching_run_count
    from public.shamo_ingestion_runs
    where (
        id = '414a7734-2afe-4bab-9896-02649106d027'::uuid
        and question_count = 11
        and question_part_count = 17
        and asset_count = 3
    ) or (
        id = '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
        and question_count = 7
        and question_part_count = 12
        and asset_count = 1
    ) or (
        id = '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
        and question_count = 10
        and question_part_count = 20
        and asset_count = 1
    ) or (
        id = '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
        and question_count = 8
        and question_part_count = 9
        and asset_count = 4
    );

    if matching_run_count <> 4 then
        raise exception
            'Safety stop: the four staged run identities/counts no longer match; found %',
            matching_run_count;
    end if;

    select count(*)
    into matching_run_count
    from public.shamo_ingestion_runs
    where id in (
        '414a7734-2afe-4bab-9896-02649106d027'::uuid,
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
    )
      and status = 'awaiting_review'
      and review_status = 'pending'
      and extraction_summary ->> 'ready_for_approval' = 'true'
      and validation_report ->> 'passed' = 'true'
      and verifier_report ->> 'passed' = 'true';

    if matching_run_count <> 4 then
        raise exception
            'Safety stop: all four runs must still be approved for manual review; found %',
            matching_run_count;
    end if;

    -- Lock in stable UUID order to avoid competing publication/review edits.
    perform id
    from public.shamo_ingestion_runs
    where id in (
        '414a7734-2afe-4bab-9896-02649106d027'::uuid,
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
    )
    order by id
    for update;

    select count(*)
    into open_issue_count
    from public.shamo_ingestion_issues
    where ingestion_run_id in (
        '414a7734-2afe-4bab-9896-02649106d027'::uuid,
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
    )
      and resolved = false;

    if open_issue_count <> 15 then
        raise exception
            'Safety stop: expected exactly 15 unresolved reviewed warnings; found %',
            open_issue_count;
    end if;

    select count(*)
    into open_issue_count
    from public.shamo_ingestion_issues
    where ingestion_run_id in (
        '414a7734-2afe-4bab-9896-02649106d027'::uuid,
        '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
        '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
        '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
    )
      and resolved = false
      and severity = 'warning'
      and issue_code in (
          'LOW_METADATA_CONFIDENCE',
          'MARK_CODE_COVERAGE_TOO_LOW'
      );

    if open_issue_count <> 15 then
        raise exception
            'Safety stop: one or more open issues are not among the 15 reviewed warnings.';
    end if;

    with mark_rows as (
        select selected_mark.item_json
        from public.shamo_ingestion_runs as run
        cross join lateral jsonb_array_elements(
            run.extraction_summary #> '{paper_bundle,questions}'
        ) as question
        cross join lateral jsonb_array_elements(
            question -> 'mark_scheme_items'
        ) as selected_mark(item_json)
        where run.id in (
            '414a7734-2afe-4bab-9896-02649106d027'::uuid,
            '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
            '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
            '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
        )
    )
    select
        count(*) filter (
            where item_json ->> 'mark_code' is not null
              and btrim(item_json ->> 'mark_code') !~*
                  '^\*?(D?M|A|B)[0-9]+([[:space:]]*FT)?'
                  '([[:space:]]+[A-Z][A-Z0-9]*)*$'
        ),
        count(*) filter (
            where btrim(coalesce(
                item_json ->> 'mark_code',
                ''
            )) ~ '^\*{0,2}[0-9]+\*{0,2}$'
              or (
                  lower(coalesce(
                      item_json ->> 'content_markdown',
                      ''
                  )) like 'total marks%'
                  and btrim(coalesce(
                      item_json ->> 'guidance_markdown',
                      ''
                  )) = ''
              )
        ),
        count(*) filter (
            where btrim(coalesce(
                item_json ->> 'content_markdown',
                ''
            )) = ''
              and btrim(coalesce(
                item_json ->> 'guidance_markdown',
                ''
            )) = ''
        )
    into invalid_code_count, subtotal_count, empty_row_count
    from mark_rows;

    if invalid_code_count <> 165
       or subtotal_count <> 41
       or empty_row_count <> 0
    then
        raise exception
            'Safety stop: expected invalid=165, subtotals=41, empty=0; found invalid=%, subtotals=%, empty=%',
            invalid_code_count,
            subtotal_count,
            empty_row_count;
    end if;

    -- Neither omitted source section may already have been added.
    select count(*)
    into missing_target_row_count
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as selected_mark(item_json)
    where (
        run.id = '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
        and (question ->> 'question_number')::integer = 5
        and selected_mark.item_json -> 'part_path' = '["c"]'::jsonb
    ) or (
        run.id = '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
        and (question ->> 'question_number')::integer = 9
        and selected_mark.item_json -> 'part_path' = '["d"]'::jsonb
    );

    if missing_target_row_count <> 0 then
        raise exception
            'Safety stop: one of the two omitted source sections is already present.';
    end if;

    select count(*)
    into incorrect_alternative_count
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    cross join lateral jsonb_array_elements(
        question -> 'mark_scheme_items'
    ) as selected_mark(item_json)
    where (
        run.id = '414a7734-2afe-4bab-9896-02649106d027'::uuid
        and (question ->> 'question_number')::integer = 7
        and (
            selected_mark.item_json ->> 'sequence_number'
        )::integer = 1
        and (
            selected_mark.item_json ->> 'is_alternative_method'
        )::boolean = true
    ) or (
        run.id = '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
        and (question ->> 'question_number')::integer = 10
        and (
            selected_mark.item_json ->> 'sequence_number'
        )::integer = 6
        and (
            selected_mark.item_json ->> 'is_alternative_method'
        )::boolean = true
    );

    if incorrect_alternative_count <> 2 then
        raise exception
            'Safety stop: expected the two reviewed dependency-mark flags; found %',
            incorrect_alternative_count;
    end if;

    select count(*)
    into metadata_target_count
    from public.shamo_ingestion_runs as run
    cross join lateral jsonb_array_elements(
        run.extraction_summary #> '{paper_bundle,questions}'
    ) as question
    where (
        run.id = '414a7734-2afe-4bab-9896-02649106d027'::uuid
        and (question ->> 'question_number')::integer = 4
        and question -> 'metadata' -> 'methods' @>
            '["Convert to tan(theta) and solve quadratic in tan"]'::jsonb
    ) or (
        run.id = '414a7734-2afe-4bab-9896-02649106d027'::uuid
        and (question ->> 'question_number')::integer = 8
        and question -> 'metadata' ->> 'main_topic' = 'Statistics'
    ) or (
        run.id = '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
        and (question ->> 'question_number')::integer = 3
        and btrim(question ->> 'stem_markdown') = '3'
        and (question -> 'metadata' ->> 'diagram_required')::boolean = true
    ) or (
        run.id = '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
        and (question ->> 'question_number')::integer = 4
        and btrim(question ->> 'stem_markdown') = '4'
    ) or (
        run.id = '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
        and (question ->> 'question_number')::integer = 5
        and question -> 'metadata' -> 'methods' @>
            '["Show the iteration is a contraction/monotone with convergence to the unique root"]'::jsonb
    ) or (
        run.id = '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
        and (question ->> 'question_number')::integer = 3
        and question -> 'metadata' ->> 'question_style' = 'proof_or_show'
    ) or (
        run.id = '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
        and (question ->> 'question_number')::integer = 4
        and question -> 'metadata' ->> 'question_style' = 'modelling'
    );

    if metadata_target_count <> 7 then
        raise exception
            'Safety stop: expected seven exact metadata/text correction targets; found %',
            metadata_target_count;
    end if;

    for run_record in
        select id, extraction_summary
        from public.shamo_ingestion_runs
        where id in (
            '414a7734-2afe-4bab-9896-02649106d027'::uuid,
            '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
            '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
            '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
        )
        order by id
    loop
        paper_variant := case run_record.id
            when '414a7734-2afe-4bab-9896-02649106d027'::uuid then '12'
            when '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid then '21'
            when '466116cc-75de-423e-9745-e2e401cfbe29'::uuid then '32'
            when '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid then '41'
        end;
        staged_summary := run_record.extraction_summary;
        staged_questions := staged_summary #> '{paper_bundle,questions}';
        rebuilt_questions := '[]'::jsonb;
        run_removed_subtotals := 0;
        run_normalized_codes := 0;
        run_added_rows := 0;
        run_metadata_changes := 0;

        if jsonb_typeof(staged_questions) <> 'array' then
            raise exception
                'Safety stop: paper % has no staged question array.',
                paper_variant;
        end if;

        for question_item in
            select value
            from jsonb_array_elements(staged_questions)
            order by (value ->> 'question_number')::integer
        loop
            question_number :=
                (question_item ->> 'question_number')::integer;
            rebuilt_items := '[]'::jsonb;
            new_sequence := 1;

            for mark_item in
                select value
                from jsonb_array_elements(
                    question_item -> 'mark_scheme_items'
                )
                order by (value ->> 'sequence_number')::integer
            loop
                old_sequence :=
                    (mark_item ->> 'sequence_number')::integer;
                raw_code := mark_item ->> 'mark_code';

                if raw_code is not null then
                    normalized_code := btrim(raw_code);

                    -- Markdown bold wrappers surround the printed code.
                    -- Three leading stars mean: two Markdown wrapper stars
                    -- plus one genuine Cambridge dependency star.
                    if left(normalized_code, 2) = '**' then
                        normalized_code :=
                            substr(normalized_code, 3);
                    end if;
                    if right(normalized_code, 2) = '**' then
                        normalized_code := left(
                            normalized_code,
                            greatest(length(normalized_code) - 2, 0)
                        );
                    end if;
                    normalized_code := btrim(normalized_code);

                    -- Parentheses denote an alternative route in the source;
                    -- that information already lives in the Boolean flag.
                    if normalized_code ~ '^\(.*\)$' then
                        normalized_code := btrim(
                            substr(
                                normalized_code,
                                2,
                                length(normalized_code) - 2
                            )
                        );
                    end if;

                    -- A pure number is a printed part/question subtotal, not
                    -- a mark-scheme instruction.
                    if normalized_code ~ '^[0-9]+$' then
                        run_removed_subtotals :=
                            run_removed_subtotals + 1;
                        continue;
                    end if;

                    normalized_code := upper(
                        regexp_replace(
                            regexp_replace(
                                normalized_code,
                                '([0-9])([A-Za-z])',
                                '\1 \2',
                                'g'
                            ),
                            '[[:space:]]+',
                            ' ',
                            'g'
                        )
                    );

                    -- SC is a special-case award, not an additional primary
                    -- mark. Preserve its meaning through the alternative flag.
                    if normalized_code ~ '^SC[[:space:]]+' then
                        normalized_code := regexp_replace(
                            normalized_code,
                            '^SC[[:space:]]+',
                            ''
                        );
                        mark_item := mark_item || jsonb_build_object(
                            'is_alternative_method',
                            true
                        );
                    end if;

                    if normalized_code !~*
                        '^\*?(D?M|A|B)[0-9]+([[:space:]]*FT)?'
                        '([[:space:]]+[A-Z][A-Z0-9]*)*$'
                    then
                        raise exception
                            'Safety stop: paper %, question %, sequence % has unrecognized normalized mark code "%".',
                            paper_variant,
                            question_number,
                            old_sequence,
                            normalized_code;
                    end if;

                    if normalized_code <> raw_code then
                        run_normalized_codes :=
                            run_normalized_codes + 1;
                    end if;
                    mark_item := jsonb_set(
                        mark_item,
                        '{mark_code}',
                        to_jsonb(normalized_code),
                        false
                    );
                end if;

                -- These are starred dependency marks in the official mark
                -- schemes, not alternative methods.
                if run_record.id =
                    '414a7734-2afe-4bab-9896-02649106d027'::uuid
                   and question_number = 7
                   and old_sequence = 1
                then
                    mark_item := mark_item || jsonb_build_object(
                        'is_alternative_method',
                        false
                    );
                elsif run_record.id =
                    '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
                   and question_number = 10
                   and old_sequence = 6
                then
                    mark_item := mark_item || jsonb_build_object(
                        'is_alternative_method',
                        false
                    );
                end if;

                mark_item := mark_item || jsonb_build_object(
                    'sequence_number',
                    new_sequence
                );
                rebuilt_items :=
                    rebuilt_items || jsonb_build_array(mark_item);
                new_sequence := new_sequence + 1;
            end loop;

            -- Paper 21 Q5(c), official mark-scheme page 10.
            if run_record.id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
               and question_number = 5
            then
                rebuilt_items := rebuilt_items || jsonb_build_array(
                    jsonb_build_object(
                        'sequence_number', new_sequence,
                        'part_path', jsonb_build_array('c'),
                        'mark_code', 'M1',
                        'content_markdown',
                            'Use the iteration '
                            || '$$x_{n+1}=\frac{1}{6}'
                            || '+\frac{1}{2}e^{-2x_n}$$ '
                            || 'correctly at least once.',
                        'guidance_markdown',
                            'Use the iterative process correctly at least once.',
                        'is_final_answer', false,
                        'is_alternative_method', false,
                        'source_page_numbers', jsonb_build_array(10)
                    ),
                    jsonb_build_object(
                        'sequence_number', new_sequence + 1,
                        'part_path', jsonb_build_array('c'),
                        'mark_code', 'A1',
                        'content_markdown',
                            'Obtain $$x=0.394$$ (3 significant figures).',
                        'guidance_markdown',
                            'The answer is required to exactly 3 significant figures.',
                        'is_final_answer', true,
                        'is_alternative_method', false,
                        'source_page_numbers', jsonb_build_array(10)
                    ),
                    jsonb_build_object(
                        'sequence_number', new_sequence + 2,
                        'part_path', jsonb_build_array('c'),
                        'mark_code', 'A1',
                        'content_markdown',
                            'Show sufficient iterations to 5 significant '
                            || 'figures to justify the answer, or show a sign '
                            || 'change in $$[0.3935,0.3945]$$.',
                        'guidance_markdown',
                            'There must be sufficient evidence for the stated '
                            || '3-significant-figure answer.',
                        'is_final_answer', false,
                        'is_alternative_method', false,
                        'source_page_numbers', jsonb_build_array(10)
                    )
                );
                new_sequence := new_sequence + 3;
                run_added_rows := run_added_rows + 3;
            end if;

            -- Paper 32 Q9(d), official mark-scheme page 19.
            if run_record.id =
                '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
               and question_number = 9
            then
                rebuilt_items := rebuilt_items || jsonb_build_array(
                    jsonb_build_object(
                        'sequence_number', new_sequence,
                        'part_path', jsonb_build_array('d'),
                        'mark_code', 'M1',
                        'content_markdown',
                            'Use the arguments from part (b): '
                            || '$$\arg(z\omega)=\arg z+\arg\omega'
                            || '=-\frac{\pi}{4}+\frac{2\pi}{3}'
                            || '=\frac{5\pi}{12}.$$',
                        'guidance_markdown',
                            'The working must show where '
                            || '$$\frac{5\pi}{12}$$ comes from.',
                        'is_final_answer', false,
                        'is_alternative_method', false,
                        'source_page_numbers', jsonb_build_array(19)
                    ),
                    jsonb_build_object(
                        'sequence_number', new_sequence + 1,
                        'part_path', jsonb_build_array('d'),
                        'mark_code', 'M1',
                        'content_markdown',
                            'Use the Cartesian form from part (a): '
                            || '$$\tan(\arg(z\omega))'
                            || '=\frac{3+3\sqrt{3}}{-3+3\sqrt{3}}.$$',
                        'guidance_markdown',
                            'Use a correct exact tangent ratio for the point '
                            || 'representing $$z\omega$$.',
                        'is_final_answer', false,
                        'is_alternative_method', false,
                        'source_page_numbers', jsonb_build_array(19)
                    ),
                    jsonb_build_object(
                        'sequence_number', new_sequence + 2,
                        'part_path', jsonb_build_array('d'),
                        'mark_code', 'A1',
                        'content_markdown',
                            'Hence obtain '
                            || '$$\tan\frac{5\pi}{12}=2+\sqrt{3}.$$',
                        'guidance_markdown',
                            'Obtain the given result from complete exact working.',
                        'is_final_answer', true,
                        'is_alternative_method', false,
                        'source_page_numbers', jsonb_build_array(19)
                    )
                );
                new_sequence := new_sequence + 3;
                run_added_rows := run_added_rows + 3;
            end if;

            question_item := jsonb_set(
                question_item,
                '{mark_scheme_items}',
                rebuilt_items,
                false
            );

            metadata_item := question_item -> 'metadata';

            if run_record.id =
                '414a7734-2afe-4bab-9896-02649106d027'::uuid
               and question_number = 4
            then
                metadata_item := metadata_item || jsonb_build_object(
                    'methods',
                    jsonb_build_array(
                        'Expand the numerator and use '
                        || 'sin^2(theta)+cos^2(theta)=1 to obtain 2tan(theta)',
                        'Use the identity to reduce the equation to '
                        || 'tan(theta)=5/4, then apply the stated interval'
                    )
                );
                run_metadata_changes := run_metadata_changes + 1;
            elsif run_record.id =
                '414a7734-2afe-4bab-9896-02649106d027'::uuid
               and question_number = 8
            then
                metadata_item := metadata_item || jsonb_build_object(
                    'main_topic',
                    'Algebra'
                );
                run_metadata_changes := run_metadata_changes + 1;
            elsif run_record.id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
               and question_number = 3
            then
                question_item := jsonb_set(
                    question_item,
                    '{stem_markdown}',
                    to_jsonb(''::text),
                    false
                );
                metadata_item := metadata_item || jsonb_build_object(
                    'diagram_required',
                    false
                );
                run_metadata_changes := run_metadata_changes + 1;
            elsif run_record.id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
               and question_number = 4
            then
                question_item := jsonb_set(
                    question_item,
                    '{stem_markdown}',
                    to_jsonb(''::text),
                    false
                );
                run_metadata_changes := run_metadata_changes + 1;
            elsif run_record.id =
                '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
               and question_number = 5
            then
                metadata_item := metadata_item || jsonb_build_object(
                    'skills',
                    jsonb_build_array(
                        'Locate a root using a sign change',
                        'Assume the sequence converges and take limits in '
                        || 'the recurrence',
                        'Use fixed-point iteration to find the root to the '
                        || 'required accuracy'
                    ),
                    'methods',
                    jsonb_build_array(
                        'Evaluate f(x)=e^(2x)-5-cos(3x) at 0.7 and 0.8',
                        'Let x_n tend to L, take limits in the recurrence '
                        || 'and rearrange to recover '
                        || 'e^(2L)=5+cos(3L)',
                        'Iterate from the supplied starting value, record '
                        || 'five decimal places and report the root to '
                        || 'three decimal places'
                    )
                );
                run_metadata_changes := run_metadata_changes + 1;
            elsif run_record.id =
                '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
               and question_number in (3, 4)
            then
                metadata_item := metadata_item || jsonb_build_object(
                    'question_style',
                    'multi_step_problem'
                );
                run_metadata_changes := run_metadata_changes + 1;
            end if;

            question_item := jsonb_set(
                question_item,
                '{metadata}',
                metadata_item,
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
        staged_summary := jsonb_set(
            staged_summary,
            '{remaining_batch1_source_review}',
            jsonb_build_object(
                'version', 'v2.1',
                'paper_variant', paper_variant,
                'reviewed_at', now(),
                'removed_subtotal_rows', run_removed_subtotals,
                'normalized_mark_codes', run_normalized_codes,
                'restored_source_rows', run_added_rows,
                'metadata_or_text_corrections', run_metadata_changes,
                'result', 'CORRECTED_AWAITING_VERIFICATION'
            ),
            true
        );

        update public.shamo_ingestion_runs
        set
            extraction_summary = staged_summary,
            updated_at = now()
        where id = run_record.id;
    end loop;
end;
$shamo_fix$;

-- Resolve only the 15 warnings that were explicitly reviewed.
update public.shamo_ingestion_issues
set
    resolved = true,
    resolution_note = case
        when issue_code = 'MARK_CODE_COVERAGE_TOO_LOW'
             and ingestion_run_id =
                '414a7734-2afe-4bab-9896-02649106d027'::uuid
        then
            'Compared with official mark-scheme page 9. The starred M1 is '
            || 'a dependency mark, not an alternative. It is now primary; '
            || 'the printed part totals were removed and coverage is 6/6.'
        when issue_code = 'MARK_CODE_COVERAGE_TOO_LOW'
             and ingestion_run_id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
        then
            'Compared with official mark-scheme pages 9-10. Question 5(c) '
            || 'was omitted because extraction stopped at page 9. Its '
            || 'M1+A1+A1 rows were restored; primary coverage is 9/9.'
        when issue_code = 'MARK_CODE_COVERAGE_TOO_LOW'
             and ingestion_run_id =
                '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
             and question_number = 9
        then
            'Compared with official mark-scheme pages 17-19. Question 9(d) '
            || 'was missing, so its M1+M1+A1 rows were restored; primary '
            || 'coverage is 10/10.'
        when issue_code = 'MARK_CODE_COVERAGE_TOO_LOW'
             and ingestion_run_id =
                '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
             and question_number = 10
        then
            'Compared with official mark-scheme pages 19-20. The starred M1 '
            || 'is a dependency mark, not an alternative. It is now primary '
            || 'and coverage is 10/10.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '414a7734-2afe-4bab-9896-02649106d027'::uuid
             and question_number = 4
        then
            'Human-reviewed. Trigonometry is correct; the method was fixed '
            || 'to solve tan(theta)=5/4 rather than a nonexistent quadratic.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '414a7734-2afe-4bab-9896-02649106d027'::uuid
             and question_number = 8
        then
            'Human-reviewed. The incorrect Statistics topic was changed to '
            || 'Algebra for arithmetic and geometric sequences/series.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '414a7734-2afe-4bab-9896-02649106d027'::uuid
             and question_number = 9
        then
            'Human-reviewed. Algebra, functions, composition, ranges and '
            || 'inverse functions accurately describe the question.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
             and question_number = 1
        then
            'Human-reviewed. Calculus, differentiation and stationary-point '
            || 'classification are appropriate.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
             and question_number = 3
        then
            'Human-reviewed. Algebra classification is appropriate. The '
            || 'stray stem number was removed and diagram_required was set '
            || 'false because the student is asked to draw the graph.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
             and question_number = 4
        then
            'Human-reviewed. Trigonometric identity/equation metadata is '
            || 'appropriate and the stray stem number was removed.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid
             and question_number = 7
        then
            'Human-reviewed. This is a mixed polynomial-division and '
            || 'integration problem; the existing Algebra-led metadata is '
            || 'appropriate.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
             and question_number = 5
        then
            'Human-reviewed. The methods were corrected: the question asks '
            || 'what follows if the sequence converges, not for a contraction '
            || 'or monotonicity proof.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '466116cc-75de-423e-9745-e2e401cfbe29'::uuid
             and question_number = 9
        then
            'Human-reviewed. Complex-number algebra, polar form, arguments '
            || 'and Argand geometry accurately describe the question.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
             and question_number = 3
        then
            'Human-reviewed. Mechanics/resultant-force metadata is correct; '
            || 'question_style was corrected to multi_step_problem.'
        when issue_code = 'LOW_METADATA_CONFIDENCE'
             and ingestion_run_id =
                '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
             and question_number = 4
        then
            'Human-reviewed. Mechanics/energy metadata is correct; '
            || 'question_style was corrected to multi_step_problem because '
            || 'the model and method are supplied.'
        else
            'Source-reviewed and corrected.'
    end,
    resolved_at = now()
where resolved = false
  and severity = 'warning'
  and ingestion_run_id in (
      '414a7734-2afe-4bab-9896-02649106d027'::uuid,
      '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
      '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
      '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid
  )
  and issue_code in (
      'LOW_METADATA_CONFIDENCE',
      'MARK_CODE_COVERAGE_TOO_LOW'
  );

-- Add resolved audit records for corrections that were not represented by
-- one of the original 15 warnings.
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
    correction.ingestion_run_id,
    'warning',
    correction.issue_code,
    correction.document_type,
    correction.question_number,
    correction.part_path,
    correction.message,
    true,
    correction.resolution_note,
    now()
from (
    values
        (
            '414a7734-2afe-4bab-9896-02649106d027'::uuid,
            'MARK_SCHEME_FORMAT_NORMALIZED',
            'mark_scheme',
            null::integer,
            null::text[],
            'Paper 12 contained Markdown-wrapped mark codes and printed subtotal rows.',
            'Normalized the mark codes and removed 11 subtotal rows without changing the official marking content.'
        ),
        (
            '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
            'MARK_SCHEME_FORMAT_NORMALIZED',
            'mark_scheme',
            null::integer,
            null::text[],
            'Paper 21 contained Markdown/parenthesis-wrapped mark codes and printed subtotal rows.',
            'Normalized the mark codes, removed 8 subtotal rows and preserved genuine alternative routes.'
        ),
        (
            '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
            'MARK_SCHEME_FORMAT_NORMALIZED',
            'mark_scheme',
            null::integer,
            null::text[],
            'Paper 32 contained Markdown/parenthesis-wrapped mark codes and printed subtotal rows.',
            'Normalized the mark codes, removed 20 subtotal rows and preserved genuine alternative routes.'
        ),
        (
            '98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid,
            'MARK_SCHEME_FORMAT_NORMALIZED',
            'mark_scheme',
            null::integer,
            null::text[],
            'Paper 41 contained Markdown-wrapped mark codes and printed subtotal rows.',
            'Normalized the mark codes and removed 2 subtotal rows without changing the official marking content.'
        ),
        (
            '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
            'SOURCE_PAGE_MARKS_RECOVERED',
            'mark_scheme',
            5,
            array['c']::text[],
            'Paper 21 Question 5(c) was absent because extraction stopped at mark-scheme page 9.',
            'Restored the official M1+A1+A1 rows from mark-scheme page 10.'
        ),
        (
            '466116cc-75de-423e-9745-e2e401cfbe29'::uuid,
            'SOURCE_PAGE_MARKS_RECOVERED',
            'mark_scheme',
            9,
            array['d']::text[],
            'Paper 32 Question 9(d) was absent because extraction stopped before mark-scheme page 19.',
            'Restored the official M1+M1+A1 rows from mark-scheme page 19.'
        ),
        (
            '0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid,
            'SPECIAL_CASE_MARK_CLASSIFIED',
            'mark_scheme',
            7,
            array['a']::text[],
            'Paper 21 Question 7 contained an SC B1 row counted as an additional primary mark.',
            'Stored the code as B1 and excluded the special-case award from primary mark coverage.'
        )
) as correction(
    ingestion_run_id,
    issue_code,
    document_type,
    question_number,
    part_path,
    message,
    resolution_note
)
where not exists (
    select 1
    from public.shamo_ingestion_issues as existing
    where existing.ingestion_run_id = correction.ingestion_run_id
      and existing.issue_code = correction.issue_code
      and existing.question_number is not distinct from
          correction.question_number
      and existing.message = correction.message
);

-- Refresh the public review summary from the actual unresolved issue rows.
with target_runs(id) as (
    values
        ('414a7734-2afe-4bab-9896-02649106d027'::uuid),
        ('0a03a500-c82c-473d-8f2f-8c8ebb126c0f'::uuid),
        ('466116cc-75de-423e-9745-e2e401cfbe29'::uuid),
        ('98e0a3fb-0b1d-4d92-82a0-813148cb7b71'::uuid)
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
        '{remaining_batch1_source_review,result}',
        to_jsonb(
            case
                when rollup.open_issue_count = 0 then
                    'PASS'
                else
                    'REVIEW_REQUIRED'
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
