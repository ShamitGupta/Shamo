-- Private Storage bucket for backend_v2-generated media (currently: cached
-- Manim visual-artifact videos produced by /visualize).
--
-- Same security posture as past-paper-assets: public = false, no anon/
-- authenticated grants. storage.objects has RLS enabled repo-wide with zero
-- policies (verified live before this ran), so only the service role --
-- used exclusively by backend_v2/app/repository.py -- can read or write
-- objects in this bucket; browser roles cannot reach it at all.
--
-- Unlike past-paper-assets, file_size_limit and allowed_mime_types are set
-- from the start: CLAUDE.md already flags their absence on the older bucket
-- as something to fix deliberately rather than repeat here.
--
-- Applied live via mcp__supabase__apply_migration on 2026-08-13 and verified
-- by re-selecting the row immediately after (id, public, file_size_limit,
-- allowed_mime_types all matched). This file is the checked-in record of
-- that change, not a script that still needs to be run.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'shamo-generated-media',
    'shamo-generated-media',
    false,
    20971520, -- 20 MB: generous headroom over a short 480p15 clip (tens of KB-low hundreds of KB)
    array['video/mp4']
)
on conflict (id) do nothing;

commit;
