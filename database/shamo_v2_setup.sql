-- Shamo v2 past-paper database
-- Run this file ONCE in the Supabase SQL Editor as the postgres role.
--
-- This setup:
--   * leaves public.documents and public."A_level Math" unchanged
--   * stores IGCSE and A-level papers in one normalized structure
--   * keeps raw OCR pages temporary to protect the 500 MB Free Plan allowance
--   * enables RLS on every new public table
--   * grants ingestion access only to service_role
--   * creates a 512-dimension vector column, but does not generate embeddings
--
-- The past-paper image bucket is created separately in the Supabase Dashboard.

begin;

create schema if not exists extensions;
create schema if not exists shamo_private;

revoke all on schema shamo_private from public;
revoke all on schema shamo_private from anon;
revoke all on schema shamo_private from authenticated;

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Private validation and utility functions
-- ---------------------------------------------------------------------------

create or replace function shamo_private.valid_positive_int_array(values_to_check integer[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
    select
        values_to_check is not null
        and cardinality(values_to_check) > 0
        and not exists (
            select 1
            from unnest(values_to_check) as item
            where item <= 0
        );
$$;

create or replace function shamo_private.valid_part_path(values_to_check text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
    select
        values_to_check is not null
        and cardinality(values_to_check) between 1 and 4
        and not exists (
            select 1
            from unnest(values_to_check) as item
            where item is null
               or btrim(item) = ''
               or item !~ '^[A-Za-z0-9]+$'
        );
$$;

create or replace function shamo_private.jsonb_to_int_array(value_to_convert jsonb)
returns integer[]
language sql
immutable
security invoker
set search_path = ''
as $$
    select coalesce(
        array_agg(item::integer order by item_order),
        array[]::integer[]
    )
    from jsonb_array_elements_text(
        coalesce(value_to_convert, '[]'::jsonb)
    ) with ordinality as values_list(item, item_order);
$$;

create or replace function shamo_private.jsonb_to_text_array(value_to_convert jsonb)
returns text[]
language sql
immutable
security invoker
set search_path = ''
as $$
    select coalesce(
        array_agg(btrim(item) order by item_order),
        array[]::text[]
    )
    from jsonb_array_elements_text(
        coalesce(value_to_convert, '[]'::jsonb)
    ) with ordinality as values_list(item, item_order);
$$;

create or replace function shamo_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Paper identity and ingestion tracking
-- ---------------------------------------------------------------------------

create table public.shamo_papers (
    id uuid primary key default gen_random_uuid(),
    qualification text not null
        check (qualification in ('igcse', 'a_level')),
    syllabus_code text not null
        check (syllabus_code ~ '^[0-9]{4}$'),
    subject text not null
        check (btrim(subject) <> ''),
    year smallint not null
        check (year between 1990 and 2100),
    exam_session text not null
        check (exam_session in ('feb_march', 'may_june', 'oct_nov')),
    paper_variant text not null
        check (
            btrim(paper_variant) <> ''
            and char_length(paper_variant) <= 20
        ),
    status text not null default 'staging'
        check (status in ('staging', 'published', 'failed', 'archived')),
    current_ingestion_run_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (
        qualification,
        syllabus_code,
        year,
        exam_session,
        paper_variant
    )
);

create table public.shamo_ingestion_runs (
    id uuid primary key default gen_random_uuid(),
    paper_id uuid not null
        references public.shamo_papers(id) on delete restrict,
    idempotency_key text not null unique
        check (btrim(idempotency_key) <> ''),
    mode text not null
        check (mode in ('pilot', 'production')),
    status text not null default 'queued'
        check (
            status in (
                'queued',
                'processing',
                'awaiting_review',
                'approved',
                'published',
                'search_pending',
                'complete',
                'failed',
                'rejected'
            )
        ),
    review_status text not null default 'pending'
        check (
            review_status in (
                'pending',
                'approved',
                'rejected',
                'not_required'
            )
        ),
    source_key text not null
        check (btrim(source_key) <> ''),
    ocr_model text,
    extraction_model text,
    verifier_model text,
    embedding_model text,
    attempt_count smallint not null default 1
        check (attempt_count between 1 and 10),
    source_summary jsonb not null default '{}'::jsonb
        check (jsonb_typeof(source_summary) = 'object'),
    extraction_summary jsonb not null default '{}'::jsonb
        check (jsonb_typeof(extraction_summary) = 'object'),
    verifier_report jsonb not null default '{}'::jsonb
        check (jsonb_typeof(verifier_report) = 'object'),
    validation_report jsonb not null default '{}'::jsonb
        check (jsonb_typeof(validation_report) = 'object'),
    question_count integer
        check (question_count is null or question_count >= 0),
    question_part_count integer
        check (question_part_count is null or question_part_count >= 0),
    asset_count integer
        check (asset_count is null or asset_count >= 0),
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (finished_at is null or finished_at >= started_at),
    check (published_at is null or published_at >= started_at)
);

alter table public.shamo_papers
    add constraint shamo_papers_current_ingestion_run_fk
    foreign key (current_ingestion_run_id)
    references public.shamo_ingestion_runs(id)
    on delete set null;

create table public.shamo_ingestion_issues (
    id bigint generated always as identity primary key,
    ingestion_run_id uuid not null
        references public.shamo_ingestion_runs(id) on delete cascade,
    severity text not null
        check (severity in ('warning', 'blocking')),
    issue_code text not null
        check (issue_code ~ '^[A-Z0-9_]+$'),
    document_type text
        check (
            document_type is null
            or document_type in ('question_paper', 'mark_scheme')
        ),
    page_number integer
        check (page_number is null or page_number > 0),
    question_number integer
        check (question_number is null or question_number > 0),
    part_path text[],
    message text not null
        check (btrim(message) <> ''),
    resolved boolean not null default false,
    resolution_note text,
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    check (
        part_path is null
        or shamo_private.valid_part_path(part_path)
    ),
    check (
        (resolved = false and resolved_at is null)
        or resolved = true
    )
);

-- Temporary OCR text used during review. n8n should call the cleanup function
-- after publication and periodically for expired rows.
create table public.shamo_ingestion_pages (
    id bigint generated always as identity primary key,
    ingestion_run_id uuid not null
        references public.shamo_ingestion_runs(id) on delete cascade,
    document_type text not null
        check (document_type in ('question_paper', 'mark_scheme')),
    page_number integer not null
        check (page_number > 0),
    raw_markdown text not null,
    ocr_confidence real
        check (
            ocr_confidence is null
            or ocr_confidence between 0 and 1
        ),
    expires_at timestamptz not null default (now() + interval '7 days'),
    created_at timestamptz not null default now(),
    unique (ingestion_run_id, document_type, page_number)
);

-- ---------------------------------------------------------------------------
-- Published paper content
-- ---------------------------------------------------------------------------

create table public.shamo_paper_documents (
    id uuid primary key default gen_random_uuid(),
    paper_id uuid not null
        references public.shamo_papers(id) on delete cascade,
    ingestion_run_id uuid not null
        references public.shamo_ingestion_runs(id) on delete restrict,
    document_type text not null
        check (document_type in ('question_paper', 'mark_scheme')),
    source_url text not null
        check (source_url ~ '^https?://'),
    source_url_hash text,
    page_count integer not null
        check (page_count > 0),
    ocr_model text not null
        check (btrim(ocr_model) <> ''),
    created_at timestamptz not null default now(),
    unique (paper_id, ingestion_run_id, document_type)
);

create table public.shamo_questions (
    id uuid primary key default gen_random_uuid(),
    paper_id uuid not null
        references public.shamo_papers(id) on delete cascade,
    ingestion_run_id uuid not null
        references public.shamo_ingestion_runs(id) on delete restrict,
    question_number integer not null
        check (question_number > 0),
    stem_markdown text not null default '',
    total_marks integer
        check (total_marks is null or total_marks >= 0),
    source_page_numbers integer[] not null,
    created_at timestamptz not null default now(),
    check (
        shamo_private.valid_positive_int_array(source_page_numbers)
    ),
    unique (paper_id, ingestion_run_id, question_number)
);

create table public.shamo_question_parts (
    id uuid primary key default gen_random_uuid(),
    question_id uuid not null
        references public.shamo_questions(id) on delete cascade,
    ingestion_run_id uuid not null
        references public.shamo_ingestion_runs(id) on delete restrict,
    label_path text[] not null,
    prompt_markdown text not null
        check (btrim(prompt_markdown) <> ''),
    marks integer
        check (marks is null or marks >= 0),
    source_page_numbers integer[] not null,
    sort_order integer not null
        check (sort_order >= 0),
    created_at timestamptz not null default now(),
    check (shamo_private.valid_part_path(label_path)),
    check (
        shamo_private.valid_positive_int_array(source_page_numbers)
    ),
    unique (question_id, label_path)
);

create table public.shamo_mark_scheme_items (
    id uuid primary key default gen_random_uuid(),
    question_id uuid not null
        references public.shamo_questions(id) on delete cascade,
    question_part_id uuid
        references public.shamo_question_parts(id) on delete cascade,
    ingestion_run_id uuid not null
        references public.shamo_ingestion_runs(id) on delete restrict,
    sequence_number integer not null
        check (sequence_number > 0),
    mark_code text
        check (
            mark_code is null
            or char_length(mark_code) <= 30
        ),
    content_markdown text not null,
    guidance_markdown text not null default '',
    is_final_answer boolean not null default false,
    is_alternative_method boolean not null default false,
    source_page_numbers integer[] not null,
    created_at timestamptz not null default now(),
    check (
        shamo_private.valid_positive_int_array(source_page_numbers)
    ),
    check (
        btrim(content_markdown) <> ''
        or btrim(guidance_markdown) <> ''
    )
);

create table public.shamo_question_assets (
    id uuid primary key default gen_random_uuid(),
    question_id uuid not null
        references public.shamo_questions(id) on delete cascade,
    question_part_id uuid
        references public.shamo_question_parts(id) on delete set null,
    paper_document_id uuid not null
        references public.shamo_paper_documents(id) on delete cascade,
    ingestion_run_id uuid not null
        references public.shamo_ingestion_runs(id) on delete restrict,
    source_page_number integer not null
        check (source_page_number > 0),
    source_image_index integer not null
        check (source_image_index >= 0),
    asset_type text not null
        check (
            asset_type in (
                'graph',
                'geometry_diagram',
                'mechanics_diagram',
                'table',
                'number_line',
                'coordinate_grid',
                'other_instructional'
            )
        ),
    bounding_box jsonb
        check (
            bounding_box is null
            or jsonb_typeof(bounding_box) = 'object'
        ),
    storage_bucket text not null default 'past-paper-assets',
    storage_path text not null
        check (btrim(storage_path) <> ''),
    mime_type text not null
        check (mime_type like 'image/%'),
    byte_size integer
        check (byte_size is null or byte_size > 0),
    checksum text,
    description text not null
        check (btrim(description) <> ''),
    mathematical_details jsonb not null default '{}'::jsonb
        check (jsonb_typeof(mathematical_details) = 'object'),
    required_to_solve boolean not null default true,
    created_at timestamptz not null default now(),
    unique (
        ingestion_run_id,
        paper_document_id,
        source_page_number,
        source_image_index
    )
);

create or replace function
    shamo_private.normalize_question_asset_bounding_box()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if new.bounding_box = 'null'::jsonb then
        new.bounding_box := null;
    end if;

    return new;
end;
$$;

create trigger shamo_question_assets_normalize_bounding_box
before insert or update of bounding_box
on public.shamo_question_assets
for each row
execute function
    shamo_private.normalize_question_asset_bounding_box();

revoke execute on function
    shamo_private.normalize_question_asset_bounding_box()
from public, anon, authenticated;

grant execute on function
    shamo_private.normalize_question_asset_bounding_box()
to service_role;

-- One row per searchable question or part. Embedding remains NULL until the
-- pilot is approved and the search-indexing branch runs.
create table public.shamo_question_search (
    id uuid primary key default gen_random_uuid(),
    question_id uuid not null
        references public.shamo_questions(id) on delete cascade,
    question_part_id uuid
        references public.shamo_question_parts(id) on delete cascade,
    ingestion_run_id uuid not null
        references public.shamo_ingestion_runs(id) on delete restrict,
    content_kind text not null default 'question'
        check (content_kind in ('question', 'mark_scheme')),
    content text not null
        check (btrim(content) <> ''),
    full_text_search tsvector generated always as (
        to_tsvector('english', content)
    ) stored,
    embedding extensions.vector(512),
    embedding_model text,
    content_hash text not null
        check (btrim(content_hash) <> ''),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (
        (embedding is null and embedding_model is null)
        or (embedding is not null and embedding_model is not null)
    )
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index shamo_papers_exact_lookup_idx
    on public.shamo_papers (
        qualification,
        syllabus_code,
        year,
        exam_session,
        paper_variant
    )
    where status = 'published';

create index shamo_ingestion_runs_status_idx
    on public.shamo_ingestion_runs (status, review_status, created_at);

create index shamo_ingestion_runs_paper_idx
    on public.shamo_ingestion_runs (paper_id, created_at desc);

create index shamo_ingestion_issues_open_idx
    on public.shamo_ingestion_issues (
        ingestion_run_id,
        severity
    )
    where resolved = false;

create index shamo_ingestion_pages_expiry_idx
    on public.shamo_ingestion_pages (expires_at);

create index shamo_paper_documents_current_idx
    on public.shamo_paper_documents (
        paper_id,
        ingestion_run_id,
        document_type
    );

create index shamo_questions_lookup_idx
    on public.shamo_questions (
        paper_id,
        ingestion_run_id,
        question_number
    );

create index shamo_question_parts_question_idx
    on public.shamo_question_parts (
        question_id,
        sort_order
    );

create index shamo_mark_scheme_question_idx
    on public.shamo_mark_scheme_items (
        question_id,
        question_part_id,
        sequence_number
    );

create unique index shamo_mark_scheme_sequence_unique_idx
    on public.shamo_mark_scheme_items (
        question_id,
        coalesce(question_part_id, '00000000-0000-0000-0000-000000000000'::uuid),
        sequence_number
    );

create index shamo_question_assets_question_idx
    on public.shamo_question_assets (
        question_id,
        question_part_id
    );

create index shamo_question_search_fts_idx
    on public.shamo_question_search
    using gin (full_text_search);

create unique index shamo_question_search_content_unique_idx
    on public.shamo_question_search (
        question_id,
        coalesce(question_part_id, '00000000-0000-0000-0000-000000000000'::uuid),
        ingestion_run_id,
        content_kind,
        content_hash
    );

-- Creating this while the table is empty is inexpensive. It will be populated
-- only after embeddings are added following pilot approval.
create index shamo_question_search_embedding_hnsw_idx
    on public.shamo_question_search
    using hnsw (embedding extensions.vector_cosine_ops)
    where embedding is not null;

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------

create trigger shamo_papers_set_updated_at
before update on public.shamo_papers
for each row execute function shamo_private.set_updated_at();

create trigger shamo_ingestion_runs_set_updated_at
before update on public.shamo_ingestion_runs
for each row execute function shamo_private.set_updated_at();

create trigger shamo_question_search_set_updated_at
before update on public.shamo_question_search
for each row execute function shamo_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Review and monitoring views
-- ---------------------------------------------------------------------------

create view public.shamo_ingestion_review_queue
with (security_invoker = true)
as
select
    run.id as ingestion_run_id,
    run.mode,
    run.status,
    run.review_status,
    paper.qualification,
    paper.syllabus_code,
    paper.subject,
    paper.year,
    paper.exam_session,
    paper.paper_variant,
    run.question_count,
    run.question_part_count,
    run.asset_count,
    count(issue.id) filter (
        where issue.resolved = false
          and issue.severity = 'blocking'
    ) as open_blocking_issues,
    count(issue.id) filter (
        where issue.resolved = false
          and issue.severity = 'warning'
    ) as open_warnings,
    run.verifier_report,
    run.validation_report,
    run.started_at,
    run.finished_at
from public.shamo_ingestion_runs as run
join public.shamo_papers as paper
    on paper.id = run.paper_id
left join public.shamo_ingestion_issues as issue
    on issue.ingestion_run_id = run.id
where run.status in (
    'awaiting_review',
    'approved',
    'failed',
    'rejected'
)
group by run.id, paper.id;

create view public.shamo_published_question_overview
with (security_invoker = true)
as
select
    paper.id as paper_id,
    paper.qualification,
    paper.syllabus_code,
    paper.subject,
    paper.year,
    paper.exam_session,
    paper.paper_variant,
    question.id as question_id,
    question.question_number,
    question.total_marks,
    cardinality(question.source_page_numbers) as source_page_count,
    count(distinct part.id) as part_count,
    count(distinct mark_item.id) as mark_scheme_item_count,
    count(distinct asset.id) as asset_count
from public.shamo_papers as paper
join public.shamo_questions as question
    on question.paper_id = paper.id
   and question.ingestion_run_id = paper.current_ingestion_run_id
left join public.shamo_question_parts as part
    on part.question_id = question.id
   and part.ingestion_run_id = paper.current_ingestion_run_id
left join public.shamo_mark_scheme_items as mark_item
    on mark_item.question_id = question.id
   and mark_item.ingestion_run_id = paper.current_ingestion_run_id
left join public.shamo_question_assets as asset
    on asset.question_id = question.id
   and asset.ingestion_run_id = paper.current_ingestion_run_id
where paper.status = 'published'
group by paper.id, question.id;

create view public.shamo_database_usage
with (security_invoker = true)
as
select
    pg_database_size(current_database()) as database_bytes,
    round(
        pg_database_size(current_database())::numeric
        / 1024 / 1024,
        2
    ) as database_megabytes,
    500::numeric as free_plan_limit_megabytes,
    round(
        (
            pg_database_size(current_database())::numeric
            / 1024 / 1024
        ) / 500 * 100,
        2
    ) as free_plan_percent_used;

-- ---------------------------------------------------------------------------
-- Read functions used by the future backend and search indexer
-- ---------------------------------------------------------------------------

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
                            'content_markdown', mark_item.content_markdown,
                            'guidance_markdown',
                                mark_item.guidance_markdown,
                            'is_final_answer', mark_item.is_final_answer,
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

create or replace function public.shamo_get_pending_search_items(
    requested_limit integer default 100
)
returns table (
    question_id uuid,
    question_part_id uuid,
    ingestion_run_id uuid,
    content text
)
language sql
stable
security invoker
set search_path = ''
as $$
    with candidate_items as (
        select
            question.id as question_id,
            null::uuid as question_part_id,
            question.ingestion_run_id,
            question.stem_markdown as content
        from public.shamo_questions as question
        join public.shamo_papers as paper
            on paper.id = question.paper_id
           and paper.current_ingestion_run_id = question.ingestion_run_id
        where paper.status = 'published'
          and btrim(question.stem_markdown) <> ''

        union all

        select
            question.id,
            part.id,
            part.ingestion_run_id,
            concat_ws(
                E'\n\n',
                nullif(btrim(question.stem_markdown), ''),
                part.prompt_markdown
            )
        from public.shamo_question_parts as part
        join public.shamo_questions as question
            on question.id = part.question_id
           and question.ingestion_run_id = part.ingestion_run_id
        join public.shamo_papers as paper
            on paper.id = question.paper_id
           and paper.current_ingestion_run_id = part.ingestion_run_id
        where paper.status = 'published'
    )
    select
        candidate.question_id,
        candidate.question_part_id,
        candidate.ingestion_run_id,
        candidate.content
    from candidate_items as candidate
    where not exists (
        select 1
        from public.shamo_question_search as search_item
        where search_item.question_id = candidate.question_id
          and search_item.question_part_id
              is not distinct from candidate.question_part_id
          and search_item.ingestion_run_id =
              candidate.ingestion_run_id
          and search_item.content_kind = 'question'
          and search_item.embedding is not null
    )
    order by
        candidate.ingestion_run_id,
        candidate.question_id,
        candidate.question_part_id nulls first
  limit greatest(1, least(coalesce(requested_limit, 100), 500));
$$;

create or replace function public.shamo_match_similar_questions(
    query_embedding extensions.vector(512),
    requested_limit integer default 10,
    requested_qualification text default null,
    requested_syllabus_code text default null,
    excluded_question_id uuid default null
)
returns table (
    question_id uuid,
    question_part_id uuid,
    qualification text,
    syllabus_code text,
    year smallint,
    exam_session text,
    paper_variant text,
    question_number integer,
    similarity double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
    -- The vector extension and its operators are installed in `extensions`.
    -- Schema-qualifying the operator keeps this function compatible with the
    -- intentionally empty search_path.
    select
        search_item.question_id,
        search_item.question_part_id,
        paper.qualification,
        paper.syllabus_code,
        paper.year,
        paper.exam_session,
        paper.paper_variant,
        question.question_number,
        1 - (
            search_item.embedding
            operator(extensions.<=>)
            query_embedding
        ) as similarity
    from public.shamo_question_search as search_item
    join public.shamo_questions as question
        on question.id = search_item.question_id
       and question.ingestion_run_id = search_item.ingestion_run_id
    join public.shamo_papers as paper
        on paper.id = question.paper_id
       and paper.current_ingestion_run_id =
           search_item.ingestion_run_id
    where paper.status = 'published'
      and search_item.content_kind = 'question'
      and search_item.embedding is not null
      and (
          requested_qualification is null
          or paper.qualification = requested_qualification
      )
      and (
          requested_syllabus_code is null
          or paper.syllabus_code = requested_syllabus_code
      )
      and (
          excluded_question_id is null
          or search_item.question_id <> excluded_question_id
      )
    order by
        search_item.embedding
        operator(extensions.<=>)
        query_embedding
  limit greatest(1, least(coalesce(requested_limit, 10), 50));
$$;

-- ---------------------------------------------------------------------------
-- Atomic publication function used by n8n
-- ---------------------------------------------------------------------------

create or replace function public.shamo_publish_paper_bundle(
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
    selected_run public.shamo_ingestion_runs%rowtype;
    selected_paper public.shamo_papers%rowtype;
    document_json jsonb;
    question_json jsonb;
    part_json jsonb;
    mark_json jsonb;
    asset_json jsonb;
    created_question_id uuid;
    selected_part_id uuid;
    selected_document_id uuid;
    selected_part_path text[];
    inserted_question_count integer := 0;
    inserted_part_count integer := 0;
    inserted_mark_count integer := 0;
    inserted_asset_count integer := 0;
    distinct_document_types integer;
    supplied_question_count integer;
    distinct_question_count integer;
begin
    if paper_bundle is null
       or jsonb_typeof(paper_bundle) <> 'object' then
        raise exception 'paper_bundle must be a JSON object';
    end if;

    select *
    into selected_run
    from public.shamo_ingestion_runs
    where id = requested_ingestion_run_id
    for update;

    if not found then
        raise exception
            'Unknown ingestion run: %',
            requested_ingestion_run_id;
    end if;

    select *
    into selected_paper
    from public.shamo_papers
    where id = selected_run.paper_id
    for update;

    if selected_run.status <> 'approved' then
        raise exception
            'Ingestion run % must have status approved before publication',
            requested_ingestion_run_id;
    end if;

    if selected_run.mode = 'pilot'
       and selected_run.review_status <> 'approved' then
        raise exception
            'Pilot ingestion run % requires manual approval',
            requested_ingestion_run_id;
    end if;

    if selected_run.mode = 'production'
       and selected_run.review_status not in (
           'approved',
           'not_required'
       ) then
        raise exception
            'Production ingestion run % has invalid review status',
            requested_ingestion_run_id;
    end if;

    if coalesce(
        (selected_run.verifier_report ->> 'passed')::boolean,
        false
    ) = false then
        raise exception
            'Verifier report has not passed for ingestion run %',
            requested_ingestion_run_id;
    end if;

    if coalesce(
        (selected_run.validation_report ->> 'passed')::boolean,
        false
    ) = false then
        raise exception
            'Validation report has not passed for ingestion run %',
            requested_ingestion_run_id;
    end if;

    if exists (
        select 1
        from public.shamo_ingestion_issues
        where ingestion_run_id = requested_ingestion_run_id
          and severity = 'blocking'
          and resolved = false
    ) then
        raise exception
            'Ingestion run % still has unresolved blocking issues',
            requested_ingestion_run_id;
    end if;

    if jsonb_typeof(paper_bundle -> 'documents') <> 'array'
       or jsonb_array_length(paper_bundle -> 'documents') <> 2 then
        raise exception
            'paper_bundle.documents must contain exactly two documents';
    end if;

    select count(distinct document_item ->> 'document_type')
    into distinct_document_types
    from jsonb_array_elements(
        paper_bundle -> 'documents'
    ) as document_item;

    if distinct_document_types <> 2
       or not exists (
           select 1
           from jsonb_array_elements(
               paper_bundle -> 'documents'
           ) as document_item
           where document_item ->> 'document_type' =
               'question_paper'
       )
       or not exists (
           select 1
           from jsonb_array_elements(
               paper_bundle -> 'documents'
           ) as document_item
           where document_item ->> 'document_type' =
               'mark_scheme'
       ) then
        raise exception
            'paper_bundle must contain one question_paper and one mark_scheme';
    end if;

    if jsonb_typeof(paper_bundle -> 'questions') <> 'array'
       or jsonb_array_length(paper_bundle -> 'questions') = 0 then
        raise exception
            'paper_bundle.questions must be a non-empty array';
    end if;

    select
        count(*),
        count(distinct (question_item ->> 'question_number')::integer)
    into supplied_question_count, distinct_question_count
    from jsonb_array_elements(
        paper_bundle -> 'questions'
    ) as question_item;

    if supplied_question_count <> distinct_question_count then
        raise exception
            'paper_bundle contains duplicate question numbers';
    end if;

    -- Makes the function safe to call again for the same run.
    delete from public.shamo_questions
    where paper_id = selected_run.paper_id
      and ingestion_run_id = requested_ingestion_run_id;

    delete from public.shamo_paper_documents
    where paper_id = selected_run.paper_id
      and ingestion_run_id = requested_ingestion_run_id;

    for document_json in
        select value
        from jsonb_array_elements(
            paper_bundle -> 'documents'
        )
    loop
        insert into public.shamo_paper_documents (
            paper_id,
            ingestion_run_id,
            document_type,
            source_url,
            source_url_hash,
            page_count,
            ocr_model
        )
        values (
            selected_run.paper_id,
            requested_ingestion_run_id,
            document_json ->> 'document_type',
            document_json ->> 'source_url',
            nullif(document_json ->> 'source_url_hash', ''),
            (document_json ->> 'page_count')::integer,
            document_json ->> 'ocr_model'
        );
    end loop;

    for question_json in
        select value
        from jsonb_array_elements(
            paper_bundle -> 'questions'
        )
    loop
        insert into public.shamo_questions (
            paper_id,
            ingestion_run_id,
            question_number,
            stem_markdown,
            total_marks,
            source_page_numbers
        )
        values (
            selected_run.paper_id,
            requested_ingestion_run_id,
            (question_json ->> 'question_number')::integer,
            coalesce(question_json ->> 'stem_markdown', ''),
            nullif(question_json ->> 'total_marks', '')::integer,
            shamo_private.jsonb_to_int_array(
                question_json -> 'source_page_numbers'
            )
        )
        returning id into created_question_id;

        inserted_question_count := inserted_question_count + 1;

        for part_json in
            select value
            from jsonb_array_elements(
                coalesce(
                    question_json -> 'parts',
                    '[]'::jsonb
                )
            )
        loop
            insert into public.shamo_question_parts (
                question_id,
                ingestion_run_id,
                label_path,
                prompt_markdown,
                marks,
                source_page_numbers,
                sort_order
            )
            values (
                created_question_id,
                requested_ingestion_run_id,
                shamo_private.jsonb_to_text_array(
                    part_json -> 'label_path'
                ),
                part_json ->> 'prompt_markdown',
                nullif(part_json ->> 'marks', '')::integer,
                shamo_private.jsonb_to_int_array(
                    part_json -> 'source_page_numbers'
                ),
                (part_json ->> 'sort_order')::integer
            );

            inserted_part_count := inserted_part_count + 1;
        end loop;

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
            selected_part_id := null;

            if cardinality(selected_part_path) > 0 then
                select id
                into selected_part_id
                from public.shamo_question_parts
                where question_id = created_question_id
                  and label_path = selected_part_path;

                if selected_part_id is null then
                    raise exception
                        'Mark-scheme item references missing part % for question %',
                        selected_part_path,
                        question_json ->> 'question_number';
                end if;
            end if;

            insert into public.shamo_mark_scheme_items (
                question_id,
                question_part_id,
                ingestion_run_id,
                sequence_number,
                mark_code,
                content_markdown,
                guidance_markdown,
                is_final_answer,
                is_alternative_method,
                source_page_numbers
            )
            values (
                created_question_id,
                selected_part_id,
                requested_ingestion_run_id,
                (mark_json ->> 'sequence_number')::integer,
                nullif(mark_json ->> 'mark_code', ''),
                mark_json ->> 'content_markdown',
                coalesce(mark_json ->> 'guidance_markdown', ''),
                coalesce(
                    (mark_json ->> 'is_final_answer')::boolean,
                    false
                ),
                coalesce(
                    (mark_json ->> 'is_alternative_method')::boolean,
                    false
                ),
                shamo_private.jsonb_to_int_array(
                    mark_json -> 'source_page_numbers'
                )
            );

            inserted_mark_count := inserted_mark_count + 1;
        end loop;

        for asset_json in
            select value
            from jsonb_array_elements(
                coalesce(
                    question_json -> 'assets',
                    '[]'::jsonb
                )
            )
        loop
            selected_part_path :=
                shamo_private.jsonb_to_text_array(
                    asset_json -> 'part_path'
                );
            selected_part_id := null;

            if cardinality(selected_part_path) > 0 then
                select id
                into selected_part_id
                from public.shamo_question_parts
                where question_id = created_question_id
                  and label_path = selected_part_path;

                if selected_part_id is null then
                    raise exception
                        'Asset references missing part % for question %',
                        selected_part_path,
                        question_json ->> 'question_number';
                end if;
            end if;

            select id
            into selected_document_id
            from public.shamo_paper_documents
            where paper_id = selected_run.paper_id
              and ingestion_run_id = requested_ingestion_run_id
              and document_type =
                  asset_json ->> 'document_type';

            if selected_document_id is null then
                raise exception
                    'Asset references unknown document type %',
                    asset_json ->> 'document_type';
            end if;

            insert into public.shamo_question_assets (
                question_id,
                question_part_id,
                paper_document_id,
                ingestion_run_id,
                source_page_number,
                source_image_index,
                asset_type,
                bounding_box,
                storage_bucket,
                storage_path,
                mime_type,
                byte_size,
                checksum,
                description,
                mathematical_details,
                required_to_solve
            )
            values (
                created_question_id,
                selected_part_id,
                selected_document_id,
                requested_ingestion_run_id,
                (asset_json ->> 'source_page_number')::integer,
                (asset_json ->> 'source_image_index')::integer,
                asset_json ->> 'asset_type',
                nullif(
                    asset_json -> 'bounding_box',
                    'null'::jsonb
                ),
                coalesce(
                    nullif(asset_json ->> 'storage_bucket', ''),
                    'past-paper-assets'
                ),
                asset_json ->> 'storage_path',
                asset_json ->> 'mime_type',
                nullif(asset_json ->> 'byte_size', '')::integer,
                nullif(asset_json ->> 'checksum', ''),
                asset_json ->> 'description',
                coalesce(
                    asset_json -> 'mathematical_details',
                    '{}'::jsonb
                ),
                coalesce(
                    (asset_json ->> 'required_to_solve')::boolean,
                    true
                )
            );

            inserted_asset_count := inserted_asset_count + 1;
        end loop;
    end loop;

    update public.shamo_papers
    set
        current_ingestion_run_id = requested_ingestion_run_id,
        status = 'published'
    where id = selected_run.paper_id;

    update public.shamo_ingestion_runs
    set
        status = 'search_pending',
        question_count = inserted_question_count,
        question_part_count = inserted_part_count,
        asset_count = inserted_asset_count,
        published_at = now(),
        finished_at = coalesce(finished_at, now())
    where id = requested_ingestion_run_id;

    update public.shamo_ingestion_pages
    set expires_at = least(
        expires_at,
        now() + interval '7 days'
    )
    where ingestion_run_id = requested_ingestion_run_id;

    return jsonb_build_object(
        'paper_id', selected_run.paper_id,
        'ingestion_run_id', requested_ingestion_run_id,
        'questions_inserted', inserted_question_count,
        'parts_inserted', inserted_part_count,
        'mark_scheme_items_inserted', inserted_mark_count,
        'assets_inserted', inserted_asset_count,
        'next_status', 'search_pending'
    );
end;
$$;

create or replace function public.shamo_cleanup_expired_ingestion_pages()
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
    removed_count integer;
begin
    delete from public.shamo_ingestion_pages
    where expires_at < now();

    get diagnostics removed_count = row_count;
    return removed_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and privileges
-- ---------------------------------------------------------------------------

alter table public.shamo_papers enable row level security;
alter table public.shamo_ingestion_runs enable row level security;
alter table public.shamo_ingestion_issues enable row level security;
alter table public.shamo_ingestion_pages enable row level security;
alter table public.shamo_paper_documents enable row level security;
alter table public.shamo_questions enable row level security;
alter table public.shamo_question_parts enable row level security;
alter table public.shamo_mark_scheme_items enable row level security;
alter table public.shamo_question_assets enable row level security;
alter table public.shamo_question_search enable row level security;

revoke all on table public.shamo_papers from anon, authenticated;
revoke all on table public.shamo_ingestion_runs from anon, authenticated;
revoke all on table public.shamo_ingestion_issues from anon, authenticated;
revoke all on table public.shamo_ingestion_pages from anon, authenticated;
revoke all on table public.shamo_paper_documents from anon, authenticated;
revoke all on table public.shamo_questions from anon, authenticated;
revoke all on table public.shamo_question_parts from anon, authenticated;
revoke all on table public.shamo_mark_scheme_items from anon, authenticated;
revoke all on table public.shamo_question_assets from anon, authenticated;
revoke all on table public.shamo_question_search from anon, authenticated;

grant select, insert, update, delete
on table
    public.shamo_papers,
    public.shamo_ingestion_runs,
    public.shamo_ingestion_issues,
    public.shamo_ingestion_pages,
    public.shamo_paper_documents,
    public.shamo_questions,
    public.shamo_question_parts,
    public.shamo_mark_scheme_items,
    public.shamo_question_assets,
    public.shamo_question_search
to service_role;

grant usage, select
on sequence
    public.shamo_ingestion_issues_id_seq,
    public.shamo_ingestion_pages_id_seq
to service_role;

grant usage on schema shamo_private to service_role;

grant execute on function
    shamo_private.valid_positive_int_array(integer[]),
    shamo_private.valid_part_path(text[]),
    shamo_private.jsonb_to_int_array(jsonb),
    shamo_private.jsonb_to_text_array(jsonb),
    shamo_private.set_updated_at()
to service_role;

revoke all on
    public.shamo_ingestion_review_queue,
    public.shamo_published_question_overview,
    public.shamo_database_usage
from anon, authenticated;

grant select on
    public.shamo_ingestion_review_queue,
    public.shamo_published_question_overview,
    public.shamo_database_usage
to service_role;

revoke execute on function public.shamo_get_question_context(
    text, text, integer, text, text, integer
) from public, anon, authenticated;

revoke execute on function public.shamo_get_pending_search_items(integer)
from public, anon, authenticated;

revoke execute on function public.shamo_match_similar_questions(
    extensions.vector, integer, text, text, uuid
) from public, anon, authenticated;

revoke execute on function public.shamo_publish_paper_bundle(uuid, jsonb)
from public, anon, authenticated;

revoke execute on function public.shamo_cleanup_expired_ingestion_pages()
from public, anon, authenticated;

grant execute on function public.shamo_get_question_context(
    text, text, integer, text, text, integer
) to service_role;

grant execute on function public.shamo_get_pending_search_items(integer)
to service_role;

grant execute on function public.shamo_match_similar_questions(
    extensions.vector, integer, text, text, uuid
) to service_role;

grant execute on function public.shamo_publish_paper_bundle(uuid, jsonb)
to service_role;

grant execute on function public.shamo_cleanup_expired_ingestion_pages()
to service_role;

commit;
