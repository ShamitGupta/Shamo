-- Clear every v2.3 ingestion run stranded at 'processing' with no spend.
--
-- SUPERSEDES shamo_v2_3_clear_stuck_run_after_mistral_402.sql, which named one
-- run id. That was the wrong shape: each failed OCR attempt strands a further
-- run, so by the second retry there were two and the single-id file could only
-- clear one. Re-runnable and count-agnostic is the right shape for a recovery
-- file whose trigger repeats.
--
-- WHEN TO RUN IT
--
-- After any batch dies part-way -- an OCR provider refusing requests, a
-- credential misconfiguration, n8n restarting. The run row is created before
-- the first provider call, so a crash there leaves it at 'processing', and the
-- child then refuses to retry that paper:
--
--     'This paper already has a processing run. Inspect ingestion run <id>
--      before retrying to avoid duplicate API work.'
--
-- That guard is what prevents duplicate paid work and must not be weakened. It
-- does mean a crashed run blocks its own retry until cleared, which is this
-- file's whole job.
--
-- THE SAFETY PROPERTY
--
-- It clears ONLY runs with zero cost events. A run that has already spent money
-- may hold a reserved budget event, and clearing it without handling that
-- reservation is how the 8 August retry broke: the reservation was 'released',
-- and the retry then failed at Finalize because
-- shamo_finalize_api_cost_event requires the event to still be 'reserved'. Any
-- such run is reported and left alone for a human.
--
-- Scope is limited to the v2.3 expansion so it cannot touch older campaigns.

begin;

do $$
declare
  v_run record;
  v_cleared integer := 0;
  v_skipped integer := 0;
begin
  for v_run in
    select r.id, r.status, p.paper_variant, p.year, p.exam_session,
           (select count(*) from shamo_api_cost_events e where e.ingestion_run_id = r.id) as cost_events
    from shamo_ingestion_runs r
    join shamo_papers p on p.id = r.paper_id
    where r.idempotency_key ~ 'v2\.3-batch-'
      and r.status = 'processing'
    order by r.started_at
    for update of r
  loop
    if v_run.cost_events <> 0 then
      raise warning
        'LEFT ALONE: %/% % has % cost event(s). Handle its reservation before clearing.',
        v_run.paper_variant, v_run.year, v_run.exam_session, v_run.cost_events;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    update shamo_ingestion_runs
       set status = 'failed',
           finished_at = coalesce(finished_at, now()),
           updated_at = now()
     where id = v_run.id;

    -- One audit row per run, guarded so repeated runs of this file do not
    -- accumulate duplicates.
    insert into shamo_ingestion_issues (
      ingestion_run_id, severity, issue_code, question_number, part_path,
      message, resolved, resolution_note, resolved_at
    )
    select
      v_run.id, 'warning', 'RUN_STRANDED_BEFORE_FIRST_PAID_STAGE', null, null,
      'Run was left at status processing when the batch died before its first paid stage.',
      true,
      'Marked failed by database/shamo_v2_3_clear_stuck_runs.sql so the paper can be retried. '
      'Zero cost events existed, so no budget reservation needed releasing.',
      now()
    where not exists (
      select 1 from shamo_ingestion_issues
      where ingestion_run_id = v_run.id
        and issue_code = 'RUN_STRANDED_BEFORE_FIRST_PAID_STAGE'
    );

    raise notice 'cleared %/% % (run %)',
      v_run.paper_variant, v_run.year, v_run.exam_session, v_run.id;
    v_cleared := v_cleared + 1;
  end loop;

  raise notice 'Done. % run(s) cleared, % left alone.', v_cleared, v_skipped;

  if v_cleared = 0 and v_skipped = 0 then
    raise notice 'Nothing was stuck. Safe to retry.';
  end if;
end $$;

commit;

-- Verification: both should return zero rows.
select 'still stuck' as problem, r.id, p.paper_variant, p.year
from shamo_ingestion_runs r join shamo_papers p on p.id = r.paper_id
where r.idempotency_key ~ 'v2\.3-batch-' and r.status = 'processing';

select 'reservation left dangling' as problem, e.id, e.operation, e.status
from shamo_api_cost_events e
join shamo_ingestion_runs r on r.id = e.ingestion_run_id
where r.idempotency_key ~ 'v2\.3-batch-' and e.status = 'reserved';
