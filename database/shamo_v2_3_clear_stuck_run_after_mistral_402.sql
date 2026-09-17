-- Clear the run left in `processing` when Mistral OCR returned 402.
--
-- WHAT HAPPENED
--
-- On 10 August 2026 at 14:09 UTC, batch 9 paper 3 (9709/31 May/June 2025)
-- reached `Mistral OCR Both Documents` and got:
--
--     402 Payment required
--     {"detail":"Check your subscription on https://admin.mistral.ai/subscription"}
--
-- The node retried 5 times over 22 seconds, then failed. That failed the child
-- execution, which failed the controller. Batches 10, 11, 13 and 14 never ran.
--
-- WHY THIS FILE IS NEEDED
--
-- The run row was created before the OCR call, so it is stranded at
-- status = 'processing'. The child's own guard then refuses to retry that paper:
--
--     'This paper already has a processing run. Inspect ingestion run <id>
--      before retrying to avoid duplicate API work.'
--
-- That guard is correct and should not be weakened -- it is what prevents
-- duplicate paid work. But it means a crashed run blocks its own retry until
-- the status is cleared, which is what this file does.
--
-- WHY NOTHING ELSE NEEDS UNDOING
--
-- Verified before writing:
--   * ZERO cost events exist for this run, so no reservation is stranded and
--     nothing was billed. The failure happened before the first paid stage.
--   * Campaign reserved_usd is 0.000000 across every batch, so no other run
--     left a reservation behind either.
--
-- Note the deliberate contrast with the 8 August incident: there, a stranded
-- reservation was 'released', and the retry then failed one node later because
-- shamo_finalize_api_cost_event requires the event to still be 'reserved'. The
-- recorded lesson was to clear the RUN status and leave reservations alone.
-- Here there is no reservation at all, so only the status changes.
--
-- The run is set to 'failed' rather than deleted: it is the record of what
-- happened, and the paper can be re-staged under the same idempotency key,
-- which `Create or Retry Ingestion Run` upserts.

begin;

do $$
declare
  v_run_id uuid := '4ed329cd-be33-4056-a5ac-ca9fff4a1745';
  v_status text;
  v_cost_events integer;
  v_questions integer;
begin
  select status into v_status
  from shamo_ingestion_runs where id = v_run_id
  for update;

  if v_status is null then
    raise exception 'Run % not found.', v_run_id;
  end if;

  if v_status <> 'processing' then
    raise exception 'Expected status processing, found %. Nothing to clear.', v_status;
  end if;

  -- Refuse to touch a run that actually spent money: that would need the
  -- reservation handled first, and getting the order wrong is how the 8 August
  -- retry broke.
  select count(*) into v_cost_events
  from shamo_api_cost_events where ingestion_run_id = v_run_id;

  if v_cost_events <> 0 then
    raise exception
      'Run has % cost event(s). This file only handles a run that failed before '
      'any paid stage. Inspect the reservations before clearing.', v_cost_events;
  end if;

  -- And refuse if it somehow published content.
  select count(*) into v_questions
  from shamo_questions where ingestion_run_id = v_run_id;

  if v_questions <> 0 then
    raise exception 'Run has % published question(s); do not clear it.', v_questions;
  end if;

  update shamo_ingestion_runs
     set status = 'failed',
         finished_at = coalesce(finished_at, now()),
         updated_at = now()
   where id = v_run_id;

  -- Idempotent: this file is expected to run more than once. Every retry
  -- attempted while Mistral still returns 402 strands the same run at
  -- 'processing' again, so the file has to be safely re-runnable rather than
  -- accumulating a duplicate issue row each time.
  insert into shamo_ingestion_issues (
    ingestion_run_id, severity, issue_code, question_number, part_path,
    message, resolved, resolution_note, resolved_at
  )
  select
    v_run_id,
    'warning',
    'OCR_PROVIDER_PAYMENT_REQUIRED',
    null,
    null,
    'Mistral OCR returned HTTP 402 Payment required; the run failed before any paid OpenAI stage.',
    true,
    'Run marked failed by database/shamo_v2_3_clear_stuck_run_after_mistral_402.sql so the '
    'paper can be retried once Mistral accepts requests again. Zero cost events existed, '
    'so no reservation needed releasing.',
    now()
  where not exists (
    select 1 from shamo_ingestion_issues
    where ingestion_run_id = v_run_id
      and issue_code = 'OCR_PROVIDER_PAYMENT_REQUIRED'
  );

  raise notice 'Run % cleared from processing to failed. Retry once Mistral is restored.', v_run_id;
end $$;

commit;
