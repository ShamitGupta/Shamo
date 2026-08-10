-- Shamo v2: atomic search-embedding storage
--
-- Run this complete file once in the Supabase SQL Editor as the postgres role.
-- It is additive and does not alter or delete the published paper content.

begin;

create or replace function public.shamo_store_question_embeddings(
    requested_model text,
    embedded_items jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
    item jsonb;
    selected_question_id uuid;
    selected_question_part_id uuid;
    selected_ingestion_run_id uuid;
    supplied_content text;
    expected_content text;
    selected_embedding extensions.vector(512);
    touched_run_ids uuid[] := '{}'::uuid[];
    touched_run_id uuid;
    processed_item_count integer := 0;
    completed_run_count integer := 0;
    expected_item_count integer;
    embedded_item_count integer;
begin
    if requested_model is null or btrim(requested_model) = '' then
        raise exception 'requested_model must not be blank';
    end if;

    if embedded_items is null
       or jsonb_typeof(embedded_items) <> 'array'
       or jsonb_array_length(embedded_items) = 0 then
        raise exception 'embedded_items must be a non-empty JSON array';
    end if;

    if jsonb_array_length(embedded_items) > 500 then
        raise exception 'A single embedding save may contain at most 500 items';
    end if;

    for item in
        select value
        from jsonb_array_elements(embedded_items)
    loop
        selected_question_id :=
            nullif(item ->> 'question_id', '')::uuid;
        selected_question_part_id :=
            nullif(item ->> 'question_part_id', '')::uuid;
        selected_ingestion_run_id :=
            nullif(item ->> 'ingestion_run_id', '')::uuid;
        supplied_content := item ->> 'content';

        if selected_question_id is null
           or selected_ingestion_run_id is null
           or supplied_content is null
           or btrim(supplied_content) = '' then
            raise exception
                'Each embedded item needs question_id, ingestion_run_id and content';
        end if;

        if item -> 'embedding' is null
           or jsonb_typeof(item -> 'embedding') <> 'array' then
            raise exception
                'Embedding is missing for question %',
                selected_question_id;
        end if;

        -- Casting to vector(512) rejects both malformed vectors and a wrong
        -- number of dimensions.
        selected_embedding :=
            (item -> 'embedding')::text::extensions.vector(512);

        if selected_question_part_id is null then
            select question.stem_markdown
            into expected_content
            from public.shamo_questions as question
            join public.shamo_papers as paper
                on paper.id = question.paper_id
               and paper.current_ingestion_run_id =
                   question.ingestion_run_id
            where question.id = selected_question_id
              and question.ingestion_run_id =
                  selected_ingestion_run_id
              and paper.status = 'published';
        else
            select concat_ws(
                E'\n\n',
                nullif(btrim(question.stem_markdown), ''),
                part.prompt_markdown
            )
            into expected_content
            from public.shamo_question_parts as part
            join public.shamo_questions as question
                on question.id = part.question_id
               and question.ingestion_run_id =
                   part.ingestion_run_id
            join public.shamo_papers as paper
                on paper.id = question.paper_id
               and paper.current_ingestion_run_id =
                   part.ingestion_run_id
            where question.id = selected_question_id
              and part.id = selected_question_part_id
              and part.ingestion_run_id =
                  selected_ingestion_run_id
              and paper.status = 'published';
        end if;

        if expected_content is null then
            raise exception
                'Search item does not belong to the current published paper: question %, part %',
                selected_question_id,
                selected_question_part_id;
        end if;

        if supplied_content <> expected_content then
            raise exception
                'Search content changed after the embedding request for question %, part %',
                selected_question_id,
                selected_question_part_id;
        end if;

        -- A rerun replaces an earlier incomplete or stale row for the same
        -- published question/part. It never touches another ingestion run.
        delete from public.shamo_question_search
        where question_id = selected_question_id
          and question_part_id is not distinct from
              selected_question_part_id
          and ingestion_run_id = selected_ingestion_run_id
          and content_kind = 'question';

        insert into public.shamo_question_search (
            question_id,
            question_part_id,
            ingestion_run_id,
            content_kind,
            content,
            embedding,
            embedding_model,
            content_hash
        )
        values (
            selected_question_id,
            selected_question_part_id,
            selected_ingestion_run_id,
            'question',
            expected_content,
            selected_embedding,
            requested_model,
            md5(expected_content)
        );

        processed_item_count := processed_item_count + 1;

        if array_position(
            touched_run_ids,
            selected_ingestion_run_id
        ) is null then
            touched_run_ids :=
                array_append(
                    touched_run_ids,
                    selected_ingestion_run_id
                );
        end if;
    end loop;

    foreach touched_run_id in array touched_run_ids
    loop
        select count(*)
        into expected_item_count
        from (
            select
                question.id as question_id,
                null::uuid as question_part_id
            from public.shamo_questions as question
            join public.shamo_papers as paper
                on paper.id = question.paper_id
               and paper.current_ingestion_run_id =
                   question.ingestion_run_id
            where question.ingestion_run_id = touched_run_id
              and paper.status = 'published'
              and btrim(question.stem_markdown) <> ''

            union all

            select
                question.id,
                part.id
            from public.shamo_question_parts as part
            join public.shamo_questions as question
                on question.id = part.question_id
               and question.ingestion_run_id =
                   part.ingestion_run_id
            join public.shamo_papers as paper
                on paper.id = question.paper_id
               and paper.current_ingestion_run_id =
                   part.ingestion_run_id
            where part.ingestion_run_id = touched_run_id
              and paper.status = 'published'
        ) as expected_items;

        select count(*)
        into embedded_item_count
        from public.shamo_question_search as search_item
        where search_item.ingestion_run_id = touched_run_id
          and search_item.content_kind = 'question'
          and search_item.embedding is not null;

        if expected_item_count > 0
           and embedded_item_count = expected_item_count then
            update public.shamo_ingestion_runs
            set
                status = 'complete',
                embedding_model = requested_model,
                finished_at = coalesce(finished_at, now())
            where id = touched_run_id
              and status in ('search_pending', 'complete');

            if found then
                completed_run_count := completed_run_count + 1;
            end if;
        end if;
    end loop;

    return jsonb_build_object(
        'processed_items', processed_item_count,
        'completed_runs', completed_run_count,
        'embedding_model', requested_model
    );
end;
$$;

revoke execute on function public.shamo_store_question_embeddings(
    text,
    jsonb
) from public, anon, authenticated;

grant execute on function public.shamo_store_question_embeddings(
    text,
    jsonb
) to service_role;

commit;

-- Verification: this should return service_role only.
select
    routine.routine_name,
    has_function_privilege(
        'service_role',
        'public.shamo_store_question_embeddings(text,jsonb)',
        'execute'
    ) as service_role_can_execute,
    has_function_privilege(
        'anon',
        'public.shamo_store_question_embeddings(text,jsonb)',
        'execute'
    ) as anon_can_execute,
    has_function_privilege(
        'authenticated',
        'public.shamo_store_question_embeddings(text,jsonb)',
        'execute'
    ) as authenticated_can_execute
from information_schema.routines as routine
where routine.routine_schema = 'public'
  and routine.routine_name =
      'shamo_store_question_embeddings';
