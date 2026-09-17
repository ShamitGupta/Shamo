-- Shamo v2: mathematical metadata and guarded API-budget tracking
--
-- Run this once in the Supabase SQL editor after the existing Shamo v2 setup
-- and guidance patches. The migration is additive: it does not alter or delete
-- any published paper data.

begin;

create or replace function shamo_private.valid_nonempty_text_array(values_to_check text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
    select
        values_to_check is not null
        and not exists (
            select 1
            from unnest(values_to_check) as value
            where btrim(value) = ''
        );
$$;

create table if not exists public.shamo_ingestion_batches (
    id uuid primary key default gen_random_uuid(),
    batch_key text not null unique
        check (btrim(batch_key) <> ''),
    campaign_key text not null
        check (btrim(campaign_key) <> ''),
    source_sheet text not null
        check (btrim(source_sheet) <> ''),
    qualification text not null
        check (qualification in ('igcse', 'a_level')),
    syllabus_code text not null
        check (syllabus_code ~ '^[0-9]{4}$'),
    subject text not null
        check (btrim(subject) <> ''),
    max_papers smallint not null default 6
        check (max_papers between 1 and 6),
    planned_papers smallint not null
        check (planned_papers between 1 and 6),
    batch_budget_limit_usd numeric(12, 6) not null
        check (batch_budget_limit_usd > 0),
    campaign_budget_limit_usd numeric(12, 6) not null
        check (campaign_budget_limit_usd > 0),
    reserved_usd numeric(12, 6) not null default 0
        check (reserved_usd >= 0),
    actual_usd numeric(12, 6) not null default 0
        check (actual_usd >= 0),
    status text not null default 'planned'
        check (
            status in (
                'planned',
                'processing',
                'awaiting_review',
                'complete',
                'budget_exhausted',
                'failed',
                'cancelled'
            )
        ),
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (planned_papers <= max_papers),
    check (batch_budget_limit_usd <= campaign_budget_limit_usd),
    check (finished_at is null or started_at is null or finished_at >= started_at)
);

create table if not exists public.shamo_api_cost_events (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null
        references public.shamo_ingestion_batches(id) on delete restrict,
    ingestion_run_id uuid
        references public.shamo_ingestion_runs(id) on delete set null,
    idempotency_key text not null unique
        check (btrim(idempotency_key) <> ''),
    provider text not null
        check (provider in ('openai', 'mistral', 'other')),
    model text not null
        check (btrim(model) <> ''),
    operation text not null
        check (btrim(operation) <> ''),
    status text not null default 'reserved'
        check (status in ('reserved', 'finalized', 'released', 'failed')),
    reserved_usd numeric(12, 6) not null
        check (reserved_usd >= 0),
    actual_usd numeric(12, 6) not null default 0
        check (actual_usd >= 0),
    input_tokens bigint
        check (input_tokens is null or input_tokens >= 0),
    cached_input_tokens bigint
        check (cached_input_tokens is null or cached_input_tokens >= 0),
    output_tokens bigint
        check (output_tokens is null or output_tokens >= 0),
    provider_request_id text,
    error_message text,
    reserved_at timestamptz not null default now(),
    finalized_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (cached_input_tokens is null or input_tokens is null or cached_input_tokens <= input_tokens)
);

create table if not exists public.shamo_question_metadata (
    question_id uuid primary key
        references public.shamo_questions(id) on delete cascade,
    ingestion_run_id uuid not null
        references public.shamo_ingestion_runs(id) on delete restrict,
    main_topic text not null
        check (btrim(main_topic) <> ''),
    subtopics text[] not null default '{}'::text[],
    skills text[] not null default '{}'::text[],
    methods text[] not null default '{}'::text[],
    question_style text not null
        check (
            question_style in (
                'routine_calculation',
                'multi_step_problem',
                'proof_or_show',
                'modelling',
                'interpretation',
                'mixed'
            )
        ),
    difficulty_level smallint
        check (difficulty_level is null or difficulty_level between 1 and 5),
    calculator_required boolean,
    diagram_required boolean not null default false,
    classification_confidence real not null
        check (classification_confidence between 0 and 1),
    metadata_model text not null
        check (btrim(metadata_model) <> ''),
    taxonomy_version text not null default 'cambridge-maths-v1'
        check (btrim(taxonomy_version) <> ''),
    review_status text not null default 'pending'
        check (review_status in ('pending', 'approved', 'needs_correction')),
    reviewer_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (shamo_private.valid_nonempty_text_array(subtopics)),
    check (shamo_private.valid_nonempty_text_array(skills)),
    check (shamo_private.valid_nonempty_text_array(methods))
);

create index if not exists shamo_ingestion_batches_campaign_status_idx
    on public.shamo_ingestion_batches (campaign_key, status);

create index if not exists shamo_api_cost_events_batch_status_idx
    on public.shamo_api_cost_events (batch_id, status);

create index if not exists shamo_api_cost_events_run_idx
    on public.shamo_api_cost_events (ingestion_run_id)
    where ingestion_run_id is not null;

create index if not exists shamo_question_metadata_run_idx
    on public.shamo_question_metadata (ingestion_run_id);

create index if not exists shamo_question_metadata_topic_idx
    on public.shamo_question_metadata (main_topic, difficulty_level);

create index if not exists shamo_question_metadata_subtopics_gin_idx
    on public.shamo_question_metadata using gin (subtopics);

create index if not exists shamo_question_metadata_skills_gin_idx
    on public.shamo_question_metadata using gin (skills);

create index if not exists shamo_question_metadata_methods_gin_idx
    on public.shamo_question_metadata using gin (methods);

drop trigger if exists shamo_ingestion_batches_set_updated_at
on public.shamo_ingestion_batches;
create trigger shamo_ingestion_batches_set_updated_at
before update on public.shamo_ingestion_batches
for each row execute function shamo_private.set_updated_at();

drop trigger if exists shamo_api_cost_events_set_updated_at
on public.shamo_api_cost_events;
create trigger shamo_api_cost_events_set_updated_at
before update on public.shamo_api_cost_events
for each row execute function shamo_private.set_updated_at();

drop trigger if exists shamo_question_metadata_set_updated_at
on public.shamo_question_metadata;
create trigger shamo_question_metadata_set_updated_at
before update on public.shamo_question_metadata
for each row execute function shamo_private.set_updated_at();

create or replace function public.shamo_reserve_api_budget(
    requested_batch_id uuid,
    requested_ingestion_run_id uuid,
    requested_idempotency_key text,
    requested_provider text,
    requested_model text,
    requested_operation text,
    requested_reserved_usd numeric
)
returns table (
    cost_event_id uuid,
    batch_reserved_usd numeric,
    batch_actual_usd numeric,
    batch_limit_usd numeric,
    campaign_committed_usd numeric,
    campaign_limit_usd numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_batch public.shamo_ingestion_batches%rowtype;
    existing_event public.shamo_api_cost_events%rowtype;
    selected_event_id uuid;
    committed_before numeric(12, 6);
begin
    if requested_reserved_usd <= 0 then
        raise exception 'The requested API reservation must be greater than zero.';
    end if;

    if btrim(coalesce(requested_idempotency_key, '')) = '' then
        raise exception 'An API cost-event idempotency key is required.';
    end if;

    select *
    into selected_batch
    from public.shamo_ingestion_batches
    where id = requested_batch_id
    for update;

    if not found then
        raise exception 'Ingestion batch % was not found.', requested_batch_id;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(selected_batch.campaign_key, 0)
    );

    select *
    into existing_event
    from public.shamo_api_cost_events
    where idempotency_key = requested_idempotency_key;

    if found then
        if existing_event.batch_id <> requested_batch_id then
            raise exception 'The API idempotency key is already assigned to another batch.';
        end if;

        select coalesce(sum(batch.reserved_usd + batch.actual_usd), 0)
        into committed_before
        from public.shamo_ingestion_batches as batch
        where batch.campaign_key = selected_batch.campaign_key
          and batch.status <> 'cancelled';

        return query
        select
            existing_event.id,
            selected_batch.reserved_usd,
            selected_batch.actual_usd,
            selected_batch.batch_budget_limit_usd,
            committed_before,
            selected_batch.campaign_budget_limit_usd;
        return;
    end if;

    if selected_batch.status not in ('planned', 'processing') then
        raise exception
            'Batch % cannot reserve API budget while status is %.',
            selected_batch.batch_key,
            selected_batch.status;
    end if;

    if selected_batch.reserved_usd
       + selected_batch.actual_usd
       + requested_reserved_usd
       > selected_batch.batch_budget_limit_usd then
        update public.shamo_ingestion_batches
        set status = 'budget_exhausted'
        where id = selected_batch.id;

        raise exception
            'Batch API budget would be exceeded: committed $%, requested $%, limit $%.',
            selected_batch.reserved_usd + selected_batch.actual_usd,
            requested_reserved_usd,
            selected_batch.batch_budget_limit_usd;
    end if;

    select coalesce(sum(batch.reserved_usd + batch.actual_usd), 0)
    into committed_before
    from public.shamo_ingestion_batches as batch
    where batch.campaign_key = selected_batch.campaign_key
      and batch.status <> 'cancelled';

    if committed_before + requested_reserved_usd
       > selected_batch.campaign_budget_limit_usd then
        update public.shamo_ingestion_batches
        set status = 'budget_exhausted'
        where id = selected_batch.id;

        raise exception
            'Campaign API budget would be exceeded: committed $%, requested $%, limit $%.',
            committed_before,
            requested_reserved_usd,
            selected_batch.campaign_budget_limit_usd;
    end if;

    insert into public.shamo_api_cost_events (
        batch_id,
        ingestion_run_id,
        idempotency_key,
        provider,
        model,
        operation,
        reserved_usd
    )
    values (
        requested_batch_id,
        requested_ingestion_run_id,
        requested_idempotency_key,
        requested_provider,
        requested_model,
        requested_operation,
        requested_reserved_usd
    )
    returning id into selected_event_id;

    update public.shamo_ingestion_batches
    set
        reserved_usd = reserved_usd + requested_reserved_usd,
        status = 'processing',
        started_at = coalesce(started_at, now())
    where id = requested_batch_id
    returning * into selected_batch;

    return query
    select
        selected_event_id,
        selected_batch.reserved_usd,
        selected_batch.actual_usd,
        selected_batch.batch_budget_limit_usd,
        committed_before + requested_reserved_usd,
        selected_batch.campaign_budget_limit_usd;
end;
$$;

create or replace function public.shamo_finalize_api_cost_event(
    requested_cost_event_id uuid,
    requested_input_tokens bigint,
    requested_cached_input_tokens bigint,
    requested_output_tokens bigint,
    requested_actual_usd numeric,
    requested_provider_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_event public.shamo_api_cost_events%rowtype;
    selected_batch public.shamo_ingestion_batches%rowtype;
    campaign_committed numeric(12, 6);
begin
    if requested_actual_usd < 0 then
        raise exception 'Actual API cost cannot be negative.';
    end if;

    select *
    into selected_event
    from public.shamo_api_cost_events
    where id = requested_cost_event_id
    for update;

    if not found then
        raise exception 'API cost event % was not found.', requested_cost_event_id;
    end if;

    if selected_event.status = 'finalized' then
        return jsonb_build_object(
            'cost_event_id', selected_event.id,
            'status', selected_event.status,
            'actual_usd', selected_event.actual_usd,
            'idempotent_replay', true
        );
    end if;

    if selected_event.status <> 'reserved' then
        raise exception
            'API cost event % cannot be finalized from status %.',
            selected_event.id,
            selected_event.status;
    end if;

    select *
    into selected_batch
    from public.shamo_ingestion_batches
    where id = selected_event.batch_id
    for update;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(selected_batch.campaign_key, 0)
    );

    update public.shamo_api_cost_events
    set
        status = 'finalized',
        actual_usd = requested_actual_usd,
        input_tokens = requested_input_tokens,
        cached_input_tokens = requested_cached_input_tokens,
        output_tokens = requested_output_tokens,
        provider_request_id = requested_provider_request_id,
        finalized_at = now()
    where id = selected_event.id;

    update public.shamo_ingestion_batches
    set
        reserved_usd = greatest(0, reserved_usd - selected_event.reserved_usd),
        actual_usd = actual_usd + requested_actual_usd
    where id = selected_batch.id
    returning * into selected_batch;

    select coalesce(sum(batch.reserved_usd + batch.actual_usd), 0)
    into campaign_committed
    from public.shamo_ingestion_batches as batch
    where batch.campaign_key = selected_batch.campaign_key
      and batch.status <> 'cancelled';

    if selected_batch.reserved_usd + selected_batch.actual_usd
       >= selected_batch.batch_budget_limit_usd
       or campaign_committed >= selected_batch.campaign_budget_limit_usd then
        update public.shamo_ingestion_batches
        set status = 'budget_exhausted'
        where id = selected_batch.id;
    end if;

    return jsonb_build_object(
        'cost_event_id', selected_event.id,
        'status', 'finalized',
        'actual_usd', requested_actual_usd,
        'batch_actual_usd', selected_batch.actual_usd,
        'batch_reserved_usd', selected_batch.reserved_usd,
        'batch_limit_usd', selected_batch.batch_budget_limit_usd,
        'campaign_committed_usd', campaign_committed,
        'campaign_limit_usd', selected_batch.campaign_budget_limit_usd,
        'idempotent_replay', false
    );
end;
$$;

create or replace function public.shamo_release_api_budget(
    requested_cost_event_id uuid,
    requested_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_event public.shamo_api_cost_events%rowtype;
    selected_batch public.shamo_ingestion_batches%rowtype;
begin
    select *
    into selected_event
    from public.shamo_api_cost_events
    where id = requested_cost_event_id
    for update;

    if not found then
        raise exception 'API cost event % was not found.', requested_cost_event_id;
    end if;

    if selected_event.status in ('released', 'failed') then
        return jsonb_build_object(
            'cost_event_id', selected_event.id,
            'status', selected_event.status,
            'idempotent_replay', true
        );
    end if;

    if selected_event.status = 'finalized' then
        raise exception 'A finalized API cost event cannot be released.';
    end if;

    select *
    into selected_batch
    from public.shamo_ingestion_batches
    where id = selected_event.batch_id
    for update;

    update public.shamo_api_cost_events
    set
        status = case
            when btrim(coalesce(requested_error_message, '')) = ''
                then 'released'
            else 'failed'
        end,
        error_message = requested_error_message,
        finalized_at = now()
    where id = selected_event.id;

    update public.shamo_ingestion_batches
    set reserved_usd = greatest(0, reserved_usd - selected_event.reserved_usd)
    where id = selected_batch.id
    returning * into selected_batch;

    return jsonb_build_object(
        'cost_event_id', selected_event.id,
        'status', case
            when btrim(coalesce(requested_error_message, '')) = ''
                then 'released'
            else 'failed'
        end,
        'batch_reserved_usd', selected_batch.reserved_usd,
        'batch_actual_usd', selected_batch.actual_usd,
        'idempotent_replay', false
    );
end;
$$;

create or replace function public.shamo_store_question_metadata(
    requested_ingestion_run_id uuid,
    paper_bundle jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    selected_run public.shamo_ingestion_runs%rowtype;
    question_json jsonb;
    metadata_json jsonb;
    selected_question_id uuid;
    stored_count integer := 0;
begin
    if jsonb_typeof(paper_bundle) <> 'object'
       or jsonb_typeof(paper_bundle -> 'questions') <> 'array' then
        raise exception 'paper_bundle.questions must be a JSON array.';
    end if;

    select *
    into selected_run
    from public.shamo_ingestion_runs
    where id = requested_ingestion_run_id;

    if not found then
        raise exception 'Ingestion run % was not found.', requested_ingestion_run_id;
    end if;

    if selected_run.status not in ('published', 'search_pending', 'complete') then
        raise exception
            'Question metadata can only be stored after publication; run status is %.',
            selected_run.status;
    end if;

    for question_json in
        select value
        from jsonb_array_elements(paper_bundle -> 'questions')
    loop
        metadata_json := question_json -> 'metadata';
        if metadata_json is null or jsonb_typeof(metadata_json) <> 'object' then
            continue;
        end if;

        select question.id
        into selected_question_id
        from public.shamo_questions as question
        where question.ingestion_run_id = requested_ingestion_run_id
          and question.question_number =
              (question_json ->> 'question_number')::integer;

        if not found then
            raise exception
                'Published question % was not found for ingestion run %.',
                question_json ->> 'question_number',
                requested_ingestion_run_id;
        end if;

        insert into public.shamo_question_metadata (
            question_id,
            ingestion_run_id,
            main_topic,
            subtopics,
            skills,
            methods,
            question_style,
            difficulty_level,
            calculator_required,
            diagram_required,
            classification_confidence,
            metadata_model,
            taxonomy_version,
            review_status
        )
        values (
            selected_question_id,
            requested_ingestion_run_id,
            metadata_json ->> 'main_topic',
            coalesce(
                shamo_private.jsonb_to_text_array(metadata_json -> 'subtopics'),
                '{}'::text[]
            ),
            coalesce(
                shamo_private.jsonb_to_text_array(metadata_json -> 'skills'),
                '{}'::text[]
            ),
            coalesce(
                shamo_private.jsonb_to_text_array(metadata_json -> 'methods'),
                '{}'::text[]
            ),
            metadata_json ->> 'question_style',
            nullif(metadata_json ->> 'difficulty_level', '')::smallint,
            nullif(metadata_json ->> 'calculator_required', '')::boolean,
            coalesce((metadata_json ->> 'diagram_required')::boolean, false),
            (metadata_json ->> 'classification_confidence')::real,
            metadata_json ->> 'metadata_model',
            coalesce(
                nullif(metadata_json ->> 'taxonomy_version', ''),
                'cambridge-maths-v1'
            ),
            'pending'
        )
        on conflict (question_id)
        do update set
            ingestion_run_id = excluded.ingestion_run_id,
            main_topic = excluded.main_topic,
            subtopics = excluded.subtopics,
            skills = excluded.skills,
            methods = excluded.methods,
            question_style = excluded.question_style,
            difficulty_level = excluded.difficulty_level,
            calculator_required = excluded.calculator_required,
            diagram_required = excluded.diagram_required,
            classification_confidence = excluded.classification_confidence,
            metadata_model = excluded.metadata_model,
            taxonomy_version = excluded.taxonomy_version,
            review_status = 'pending',
            reviewer_note = null;

        stored_count := stored_count + 1;
    end loop;

    return jsonb_build_object(
        'ingestion_run_id', requested_ingestion_run_id,
        'metadata_rows_stored', stored_count
    );
end;
$$;

create or replace function public.shamo_publish_paper_bundle_with_metadata(
    requested_ingestion_run_id uuid,
    paper_bundle jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    publication_result jsonb;
    metadata_result jsonb;
begin
    -- Both calls share this RPC transaction. If metadata validation fails,
    -- publication is rolled back as well, so a paper cannot be left half
    -- published.
    publication_result :=
        public.shamo_publish_paper_bundle_v2(
            requested_ingestion_run_id,
            paper_bundle
        );

    metadata_result :=
        public.shamo_store_question_metadata(
            requested_ingestion_run_id,
            paper_bundle
        );

    return publication_result || jsonb_build_object(
        'metadata_result',
        metadata_result
    );
end;
$$;

create or replace view public.shamo_api_budget_overview
with (security_invoker = true)
as
select
    batch.id as batch_id,
    batch.batch_key,
    batch.campaign_key,
    batch.status,
    batch.planned_papers,
    batch.batch_budget_limit_usd,
    batch.reserved_usd,
    batch.actual_usd,
    batch.batch_budget_limit_usd
        - batch.reserved_usd
        - batch.actual_usd as batch_budget_remaining_usd,
    batch.campaign_budget_limit_usd,
    sum(batch.reserved_usd + batch.actual_usd)
        over (partition by batch.campaign_key) as campaign_committed_usd,
    batch.campaign_budget_limit_usd
        - sum(batch.reserved_usd + batch.actual_usd)
            over (partition by batch.campaign_key) as campaign_budget_remaining_usd,
    count(cost_event.id) filter (
        where cost_event.status = 'finalized'
    ) as finalized_api_calls,
    batch.created_at,
    batch.updated_at
from public.shamo_ingestion_batches as batch
left join public.shamo_api_cost_events as cost_event
    on cost_event.batch_id = batch.id
group by batch.id;

create or replace view public.shamo_question_metadata_review
with (security_invoker = true)
as
select
    paper.qualification,
    paper.syllabus_code,
    paper.year,
    paper.exam_session,
    paper.paper_variant,
    question.question_number,
    metadata.question_id,
    metadata.main_topic,
    metadata.subtopics,
    metadata.skills,
    metadata.methods,
    metadata.question_style,
    metadata.difficulty_level,
    metadata.calculator_required,
    metadata.diagram_required,
    metadata.classification_confidence,
    metadata.metadata_model,
    metadata.taxonomy_version,
    metadata.review_status,
    metadata.reviewer_note
from public.shamo_question_metadata as metadata
join public.shamo_questions as question
    on question.id = metadata.question_id
join public.shamo_papers as paper
    on paper.id = question.paper_id
   and paper.current_ingestion_run_id = metadata.ingestion_run_id;

alter table public.shamo_ingestion_batches enable row level security;
alter table public.shamo_api_cost_events enable row level security;
alter table public.shamo_question_metadata enable row level security;

revoke all on table
    public.shamo_ingestion_batches,
    public.shamo_api_cost_events,
    public.shamo_question_metadata
from anon, authenticated;

grant select, insert, update
on table
    public.shamo_ingestion_batches,
    public.shamo_api_cost_events,
    public.shamo_question_metadata
to service_role;

revoke all on
    public.shamo_api_budget_overview,
    public.shamo_question_metadata_review
from anon, authenticated;

grant select on
    public.shamo_api_budget_overview,
    public.shamo_question_metadata_review
to service_role;

grant execute
on function shamo_private.valid_nonempty_text_array(text[])
to service_role;

revoke execute on function public.shamo_reserve_api_budget(
    uuid, uuid, text, text, text, text, numeric
) from public, anon, authenticated;

revoke execute on function public.shamo_finalize_api_cost_event(
    uuid, bigint, bigint, bigint, numeric, text
) from public, anon, authenticated;

revoke execute on function public.shamo_release_api_budget(
    uuid, text
) from public, anon, authenticated;

revoke execute on function public.shamo_store_question_metadata(
    uuid, jsonb
) from public, anon, authenticated;

revoke execute on function public.shamo_publish_paper_bundle_with_metadata(
    uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.shamo_reserve_api_budget(
    uuid, uuid, text, text, text, text, numeric
) to service_role;

grant execute on function public.shamo_finalize_api_cost_event(
    uuid, bigint, bigint, bigint, numeric, text
) to service_role;

grant execute on function public.shamo_release_api_budget(
    uuid, text
) to service_role;

grant execute on function public.shamo_store_question_metadata(
    uuid, jsonb
) to service_role;

grant execute on function public.shamo_publish_paper_bundle_with_metadata(
    uuid, jsonb
) to service_role;

commit;
