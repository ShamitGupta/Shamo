-- Shamo v2: preserve the official mark-scheme Guidance column separately.
--
-- Run this entire file once in the Supabase SQL Editor as the postgres role.
-- It is additive and does not publish, delete, or rewrite staged paper bundles.

begin;

alter table public.shamo_mark_scheme_items
    add column if not exists guidance_markdown text not null default '';

comment on column public.shamo_mark_scheme_items.guidance_markdown is
    'Complete examiner guidance associated with this mark-scheme row. '
    'An empty string means the source Guidance cell was blank.';

-- Return answer/method text and examiner guidance as separate fields to the
-- future chatbot backend.
create or replace function public.shamo_get_question_context(
    requested_qualification text,
    requested_syllabus_code text,
    requested_year integer,
    requested_exam_session text,
    requested_paper_variant text,
    requested_question_number integer
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select jsonb_build_object(
        'paper',
        jsonb_build_object(
            'id', paper.id,
            'qualification', paper.qualification,
            'syllabus_code', paper.syllabus_code,
            'subject', paper.subject,
            'year', paper.year,
            'exam_session', paper.exam_session,
            'paper_variant', paper.paper_variant
        ),
        'documents',
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'document_type', document.document_type,
                        'source_url', document.source_url,
                        'page_count', document.page_count
                    )
                    order by document.document_type
                )
                from public.shamo_paper_documents as document
                where document.paper_id = paper.id
                  and document.ingestion_run_id =
                      paper.current_ingestion_run_id
            ),
            '[]'::jsonb
        ),
        'question',
        jsonb_build_object(
            'id', question.id,
            'question_number', question.question_number,
            'stem_markdown', question.stem_markdown,
            'total_marks', question.total_marks,
            'source_page_numbers', question.source_page_numbers,
            'root_mark_scheme',
            coalesce(
                (
                    select jsonb_agg(
                        jsonb_build_object(
                            'sequence_number', mark_item.sequence_number,
                            'mark_code', mark_item.mark_code,
                            'content_markdown',
                                mark_item.content_markdown,
                            'guidance_markdown',
                                mark_item.guidance_markdown,
                            'is_final_answer',
                                mark_item.is_final_answer,
                            'is_alternative_method',
                                mark_item.is_alternative_method,
                            'source_page_numbers',
                                mark_item.source_page_numbers
                        )
                        order by mark_item.sequence_number
                    )
                    from public.shamo_mark_scheme_items as mark_item
                    where mark_item.question_id = question.id
                      and mark_item.question_part_id is null
                      and mark_item.ingestion_run_id =
                          paper.current_ingestion_run_id
                ),
                '[]'::jsonb
            ),
            'parts',
            coalesce(
                (
                    select jsonb_agg(
                        jsonb_build_object(
                            'id', part.id,
                            'label_path', part.label_path,
                            'prompt_markdown', part.prompt_markdown,
                            'marks', part.marks,
                            'source_page_numbers',
                                part.source_page_numbers,
                            'mark_scheme_items',
                            coalesce(
                                (
                                    select jsonb_agg(
                                        jsonb_build_object(
                                            'sequence_number',
                                                part_mark.sequence_number,
                                            'mark_code',
                                                part_mark.mark_code,
                                            'content_markdown',
                                                part_mark.content_markdown,
                                            'guidance_markdown',
                                                part_mark.guidance_markdown,
                                            'is_final_answer',
                                                part_mark.is_final_answer,
                                            'is_alternative_method',
                                                part_mark.is_alternative_method,
                                            'source_page_numbers',
                                                part_mark.source_page_numbers
                                        )
                                        order by part_mark.sequence_number
                                    )
                                    from public.shamo_mark_scheme_items
                                        as part_mark
                                    where part_mark.question_part_id = part.id
                                      and part_mark.ingestion_run_id =
                                          paper.current_ingestion_run_id
                                ),
                                '[]'::jsonb
                            )
                        )
                        order by part.sort_order, part.label_path
                    )
                    from public.shamo_question_parts as part
                    where part.question_id = question.id
                      and part.ingestion_run_id =
                          paper.current_ingestion_run_id
                ),
                '[]'::jsonb
            ),
            'assets',
            coalesce(
                (
                    select jsonb_agg(
                        jsonb_build_object(
                            'id', asset.id,
                            'question_part_id', asset.question_part_id,
                            'source_page_number',
                                asset.source_page_number,
                            'asset_type', asset.asset_type,
                            'storage_bucket', asset.storage_bucket,
                            'storage_path', asset.storage_path,
                            'description', asset.description,
                            'mathematical_details',
                                asset.mathematical_details,
                            'required_to_solve',
                                asset.required_to_solve
                        )
                        order by
                            asset.source_page_number,
                            asset.source_image_index
                    )
                    from public.shamo_question_assets as asset
                    where asset.question_id = question.id
                      and asset.ingestion_run_id =
                          paper.current_ingestion_run_id
                ),
                '[]'::jsonb
            )
        )
    )
    from public.shamo_papers as paper
    join public.shamo_questions as question
        on question.paper_id = paper.id
       and question.ingestion_run_id = paper.current_ingestion_run_id
    where paper.qualification = requested_qualification
      and paper.syllabus_code = requested_syllabus_code
      and paper.year = requested_year
      and paper.exam_session = requested_exam_session
      and paper.paper_variant = requested_paper_variant
      and paper.status = 'published'
      and question.question_number = requested_question_number
    limit 1;
$$;

-- The original publication function remains the transaction-safe source of
-- truth for all existing columns. This v2 wrapper calls it and then writes the
-- separate Guidance values inside the same database transaction.
create or replace function public.shamo_publish_paper_bundle_v2(
    requested_ingestion_run_id uuid,
    paper_bundle jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
    publication_result jsonb;
    publication_bundle jsonb;
    selected_paper_id uuid;
    selected_run_status text;
    selected_review_status text;
    question_json jsonb;
    mark_json jsonb;
    selected_question_id uuid;
    selected_question_part_id uuid;
    selected_part_path text[];
    question_index integer;
    mark_index integer;
    mark_items jsonb;
    affected_rows integer;
    guidance_items_updated integer := 0;
begin
    if paper_bundle is null
       or jsonb_typeof(paper_bundle) <> 'object' then
        raise exception 'paper_bundle must be a JSON object';
    end if;

    if exists (
        select 1
        from jsonb_array_elements(
            coalesce(paper_bundle -> 'questions', '[]'::jsonb)
        ) as question_item(value)
        cross join lateral jsonb_array_elements(
            coalesce(
                question_item.value -> 'mark_scheme_items',
                '[]'::jsonb
            )
        ) as mark_item(value)
        where not (mark_item.value ? 'guidance_markdown')
           or jsonb_typeof(
               mark_item.value -> 'guidance_markdown'
           ) <> 'string'
    ) then
        raise exception
            'Every mark-scheme item must contain string guidance_markdown';
    end if;

    select paper_id, status, review_status
    into
        selected_paper_id,
        selected_run_status,
        selected_review_status
    from public.shamo_ingestion_runs
    where id = requested_ingestion_run_id
    for update;

    if not found then
        raise exception
            'Unknown ingestion run: %',
            requested_ingestion_run_id;
    end if;

    -- Approval and publication belong to this one RPC transaction. This also
    -- permits recovery from the earlier workflow version, which could commit
    -- approval before its separate publication request failed.
    if selected_run_status = 'awaiting_review'
       and selected_review_status = 'pending' then
        update public.shamo_ingestion_runs
        set
            status = 'approved',
            review_status = 'approved'
        where id = requested_ingestion_run_id;
    elsif selected_run_status = 'approved'
          and selected_review_status = 'approved' then
        null;
    else
        raise exception
            'Ingestion run % must be awaiting review or approved, not %/%',
            requested_ingestion_run_id,
            selected_run_status,
            selected_review_status;
    end if;

    publication_bundle := paper_bundle;

    -- The live v1 publication function predates guidance_markdown. A
    -- guidance-only source row would therefore be inserted momentarily with
    -- both text fields blank and fail the table check before this wrapper
    -- could copy its Guidance value. Give only those rows a transaction-local
    -- placeholder, then replace both fields atomically below.
    if jsonb_typeof(publication_bundle -> 'questions') = 'array' then
        for question_index in
            0..jsonb_array_length(
                publication_bundle -> 'questions'
            ) - 1
        loop
            mark_items :=
                publication_bundle #> array[
                    'questions',
                    question_index::text,
                    'mark_scheme_items'
                ];

            if jsonb_typeof(mark_items) = 'array' then
                for mark_index in
                    0..jsonb_array_length(mark_items) - 1
                loop
                    mark_json :=
                        paper_bundle #> array[
                            'questions',
                            question_index::text,
                            'mark_scheme_items',
                            mark_index::text
                        ];

                    if btrim(
                        coalesce(
                            mark_json ->> 'content_markdown',
                            ''
                        )
                    ) = ''
                       and btrim(
                           coalesce(
                               mark_json ->> 'guidance_markdown',
                               ''
                           )
                       ) <> '' then
                        publication_bundle :=
                            jsonb_set(
                                publication_bundle,
                                array[
                                    'questions',
                                    question_index::text,
                                    'mark_scheme_items',
                                    mark_index::text,
                                    'content_markdown'
                                ],
                                to_jsonb(
                                    '[Guidance-only row pending publication]'
                                    ::text
                                ),
                                false
                            );
                    end if;
                end loop;
            end if;
        end loop;
    end if;

    publication_result :=
        public.shamo_publish_paper_bundle(
            requested_ingestion_run_id,
            publication_bundle
        );

    for question_json in
        select value
        from jsonb_array_elements(paper_bundle -> 'questions')
    loop
        select id
        into selected_question_id
        from public.shamo_questions
        where paper_id = selected_paper_id
          and ingestion_run_id = requested_ingestion_run_id
          and question_number =
              (question_json ->> 'question_number')::integer;

        if selected_question_id is null then
            raise exception
                'Published question % was not found for guidance update',
                question_json ->> 'question_number';
        end if;

        for mark_json in
            select value
            from jsonb_array_elements(
                coalesce(
                    question_json -> 'mark_scheme_items',
                    '[]'::jsonb
                )
            )
        loop
            selected_part_path :=
                shamo_private.jsonb_to_text_array(
                    mark_json -> 'part_path'
                );
            selected_question_part_id := null;

            if cardinality(selected_part_path) > 0 then
                select id
                into selected_question_part_id
                from public.shamo_question_parts
                where question_id = selected_question_id
                  and ingestion_run_id = requested_ingestion_run_id
                  and label_path = selected_part_path;

                if selected_question_part_id is null then
                    raise exception
                        'Published part % was not found for question %',
                        selected_part_path,
                        question_json ->> 'question_number';
                end if;
            end if;

            update public.shamo_mark_scheme_items
            set
                content_markdown =
                    mark_json ->> 'content_markdown',
                guidance_markdown =
                    mark_json ->> 'guidance_markdown'
            where question_id = selected_question_id
              and ingestion_run_id = requested_ingestion_run_id
              and question_part_id is not distinct from
                  selected_question_part_id
              and sequence_number =
                  (mark_json ->> 'sequence_number')::integer;

            get diagnostics affected_rows = row_count;

            if affected_rows <> 1 then
                raise exception
                    'Expected one guidance row for question %, sequence %, '
                    'but updated %',
                    question_json ->> 'question_number',
                    mark_json ->> 'sequence_number',
                    affected_rows;
            end if;

            guidance_items_updated :=
                guidance_items_updated + 1;
        end loop;
    end loop;

    return publication_result || jsonb_build_object(
        'guidance_items_updated',
        guidance_items_updated
    );
end;
$$;

revoke all on function public.shamo_publish_paper_bundle_v2(uuid, jsonb)
    from public, anon, authenticated;

grant execute
on function public.shamo_publish_paper_bundle_v2(uuid, jsonb)
to service_role;

commit;

-- Verification: run after the transaction succeeds.
select
    column_name,
    data_type,
    is_nullable,
    column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shamo_mark_scheme_items'
  and column_name in ('content_markdown', 'guidance_markdown')
order by ordinal_position;

select
    routine_name,
    routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
      'shamo_get_question_context',
      'shamo_publish_paper_bundle_v2'
  )
order by routine_name;

select
    position(
        '[Guidance-only row pending publication]'
        in pg_get_functiondef(
            'public.shamo_publish_paper_bundle_v2(uuid,jsonb)'
            ::regprocedure
        )
    ) > 0 as guidance_only_publication_fixed,
    position(
        'selected_run_status = ''awaiting_review'''
        in pg_get_functiondef(
            'public.shamo_publish_paper_bundle_v2(uuid,jsonb)'
            ::regprocedure
        )
    ) > 0 as atomic_approval_enabled;
