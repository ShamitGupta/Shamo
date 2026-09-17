-- Shamo v2: validated visual artifact cache.
--
-- Additive only. This table stores server-validated Desmos/GeoGebra visual
-- specs for reuse by the backend. It is intentionally not exposed to browser
-- roles; the student app receives visuals only through backend_v2 /visualize.

begin;

create table if not exists public.shamo_visual_artifacts (
    id uuid primary key default gen_random_uuid(),
    question_id uuid not null
        references public.shamo_questions(id) on delete cascade,
    question_part_id uuid
        references public.shamo_question_parts(id) on delete set null,
    artifact_kind text not null
        check (
            artifact_kind in (
                'desmos_2d',
                'desmos_3d',
                'geogebra_graphing',
                'geogebra_geometry',
                'geogebra_3d',
                'manim_template_video',
                'none'
            )
        ),
    visual_spec_version text not null
        check (visual_spec_version = 'visual-v1'),
    student_prompt_hash text not null
        check (student_prompt_hash ~ '^[0-9a-f]{64}$'),
    spec_hash text not null
        check (spec_hash ~ '^[0-9a-f]{64}$'),
    spec_jsonb jsonb not null
        check (jsonb_typeof(spec_jsonb) = 'object'),
    message_markdown text not null
        check (btrim(message_markdown) <> ''),
    fallback_markdown text not null
        check (btrim(fallback_markdown) <> ''),
    accessibility_text text not null default '',
    generator_model text not null
        check (btrim(generator_model) <> ''),
    prompt_version text not null
        check (btrim(prompt_version) <> ''),
    validation_status text not null
        check (
            validation_status in (
                'validated',
                'render_failed',
                'pending_review',
                'approved',
                'rejected'
            )
        ),
    reviewed_by uuid,
    reviewed_at timestamptz,
    review_notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (question_id, student_prompt_hash, spec_hash)
);

alter table public.shamo_visual_artifacts enable row level security;

revoke all on table public.shamo_visual_artifacts from anon;
revoke all on table public.shamo_visual_artifacts from authenticated;
grant all on table public.shamo_visual_artifacts to service_role;

create index if not exists shamo_visual_artifacts_question_cache_idx
on public.shamo_visual_artifacts (
    question_id,
    student_prompt_hash,
    visual_spec_version,
    created_at desc
)
where validation_status in ('validated', 'approved');

create index if not exists shamo_visual_artifacts_review_idx
on public.shamo_visual_artifacts (
    validation_status,
    created_at desc
);

do $$
begin
    if exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'shamo_private'
          and p.proname = 'set_updated_at'
    ) and not exists (
        select 1
        from pg_trigger
        where tgname = 'shamo_visual_artifacts_set_updated_at'
    ) then
        execute 'create trigger shamo_visual_artifacts_set_updated_at
            before update on public.shamo_visual_artifacts
            for each row execute function shamo_private.set_updated_at()';
    end if;
end $$;

commit;
