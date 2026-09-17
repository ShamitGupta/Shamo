-- Clear a run stranded at 'processing' that DOES hold a budget reservation.
--
-- Companion to shamo_v2_3_clear_stuck_runs.sql, which deliberately refuses this
-- case. That file handles a run that died before its first paid stage and so has
-- nothing to reconcile. This one handles the harder shape.
--
-- THE CASE
--
-- 9709/13 Oct/Nov 2025, run 50f6d75e-a0d6-4fcb-9ed1-3c9552cc5043, batch 14.
-- It reached `Parse Targeted Repair` and threw:
--
--     OpenAI repair was incomplete. [line 4]
--
-- Repair had already been CALLED and paid for, but the node refuses a response
-- that does not cover every requested question -- correctly, because staging a
-- half-repaired paper is worse than stopping. So the run holds:
--
--     targeted_question_repair : reserved     <-- live, must not be touched
--     four earlier stages      : finalized
--
-- WHY THE RESERVATION IS LEFT ALONE
--
-- This is the 8 August lesson, and it cost a retry then. Releasing a stranded
-- reservation is NOT neutral cleanup: `shamo_finalize_api_cost_event` requires
-- the event to still be 'reserved', and the retry re-makes the provider call and
-- finalizes against the same idempotency key. Setting it to 'released' made the
-- retry fail one node later at the finalize step.
--
-- So: clear the RUN, leave the EVENT. The file asserts the reservation is still
-- 'reserved' afterwards, so a future edit cannot quietly break that.
--
-- Cost note: the repair call was made, so its money is spent but not yet
-- recorded as actual. The ledger therefore under-reports this run until the
-- retry finalizes it. Under-reporting, never over-reporting -- the direction
-- already documented for a crash between a provider call and its finalize step.

begin;

do $$
declare
  v_run_id uuid := '50f6d75e-a0d6-4fcb-9ed1-3c9552cc5043';
  v_status text;
  v_reserved integer;
  v_finalized integer;
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

  select count(*) filter (where status = 'reserved'),
         count(*) filter (where status = 'finalized')
    into v_reserved, v_finalized
  from shamo_api_cost_events where ingestion_run_id = v_run_id;

  if v_reserved <> 1 then
    raise exception
      'Expected exactly 1 reserved event, found %. Inspect before clearing.', v_reserved;
  end if;

  -- Never clear a run that has already published content.
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

  insert into shamo_ingestion_issues (
    ingestion_run_id, severity, issue_code, question_number, part_path,
    message, resolved, resolution_note, resolved_at
  )
  select
    v_run_id, 'warning', 'REPAIR_RESPONSE_INCOMPLETE', null, null,
    'Parse Targeted Repair rejected an OpenAI response that did not cover every requested question.',
    true,
    'Run cleared from processing to failed by '
    'database/shamo_v2_3_clear_run_with_live_reservation.sql so the paper can be retried. '
    'The targeted_question_repair reservation was deliberately LEFT reserved: '
    'shamo_finalize_api_cost_event requires that state, and releasing it breaks the retry '
    '(observed 8 August 2026).',
    now()
  where not exists (
    select 1 from shamo_ingestion_issues
    where ingestion_run_id = v_run_id and issue_code = 'REPAIR_RESPONSE_INCOMPLETE'
  );

  -- Assert the reservation survived this transaction.
  select count(*) into v_reserved
  from shamo_api_cost_events where ingestion_run_id = v_run_id and status = 'reserved';
  if v_reserved <> 1 then
    raise exception 'The reservation was altered (% reserved). Aborting.', v_reserved;
  end if;

  raise notice
    'Run % cleared. % finalized event(s) kept, 1 reservation left reserved for the retry.',
    v_run_id, v_finalized;
end $$;

commit;

-- Verification: run is failed, reservation still reserved, nothing stuck.
select 'run status' as check, status as value from shamo_ingestion_runs
where id = '50f6d75e-a0d6-4fcb-9ed1-3c9552cc5043'
union all
select 'reserved events (must be 1)', count(*)::text from shamo_api_cost_events
where ingestion_run_id = '50f6d75e-a0d6-4fcb-9ed1-3c9552cc5043' and status = 'reserved'
union all
select 'v2.3 runs still processing (must be 0)', count(*)::text from shamo_ingestion_runs
where idempotency_key ~ 'v2\.3-batch-' and status = 'processing';
