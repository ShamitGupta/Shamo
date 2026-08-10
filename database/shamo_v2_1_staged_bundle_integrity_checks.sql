-- Shamo v2.1 - Staged bundle integrity checks
--
-- Purpose:
--   Read-only deterministic checks over staged ingestion-run bundles, added after the
--   7 August 2026 batch-2 source review found defects in papers that had already passed
--   deterministic validation and reported ready_for_approval = true.
--
-- Scope:
--   Operates on shamo_ingestion_runs.extraction_summary->'paper_bundle', i.e. STAGED papers
--   that have not yet been published. Safe to run at any time; performs no writes.
--
-- Status:
--   These are audit queries, not yet part of the n8n deterministic validator. Until they are
--   ported into the validator (workflows/n8n/build_budget_v2_workflows.mjs), a staged paper can
--   still reach ready_for_approval = true while failing them. Porting is the follow-up work.
--
-- Coverage caveat:
--   These checks do NOT detect mathematical corruption inside an expression, e.g. the batch-2
--   cases where OCR rendered 2! as 2^2 and the divide sign as a plus. Those were traced to the
--   OCR layer and require a different technique (numeric self-consistency against printed
--   values). Passing every check here does not mean a paper is source-accurate.
--
-- Known regression cases (batch 2, verified live 7 August 2026):
--   Rule 1  expects 8 rows : 22 Q2, 22 Q5a, 31 Q9a, 31 Q9b, 31 Q9d, 51 Q3a, 51 Q6b, 51 Q7c
--   Rule 2  expects 1 row  : 11 Q11
--   Rule 3  expects 1 row  : 11 Q10
--   Rule 4  expects 1 row  : 11 Q5
--
-- Known blind spot, confirmed during verification:
--   Rule 1 does NOT catch the fabricated B1 on 62 Q7(b). That row was also wrongly flagged
--   is_alternative_method = true, so the rule excludes it and the part reconciles at 3 = 3.
--   A fabricated mark code that is simultaneously mis-flagged as an alternative is invisible
--   here. Closing this needs a separate rule keyed on the printed blank Marks cell, or a fix to
--   alternative-method classification upstream. Do not treat a clean Rule 1 as proof that mark
--   rows are correct.


-- Shared source: every staged (unpublished) run's bundle questions.
create or replace view shamo_staged_bundle_questions as
select
  r.id                                   as ingestion_run_id,
  p.id                                   as paper_id,
  p.syllabus_code,
  p.year,
  p.exam_session,
  p.paper_variant,
  (qq->>'question_number')::int          as question_number,
  qq                                     as question
from shamo_ingestion_runs r
join shamo_papers p on p.id = r.paper_id
cross join lateral jsonb_array_elements(
  coalesce(r.extraction_summary->'paper_bundle'->'questions', '[]'::jsonb)
) qq
where r.status = 'awaiting_review'
  -- Scope guard. Filtering on run status alone also matches superseded v1/diagnostic runs
  -- belonging to papers that were later published from a different run; those carry known
  -- historical defects (notably systematic duplicate mark rows) and are not publication
  -- candidates. Restrict to papers genuinely awaiting their first publication.
  and p.status = 'staging';

comment on view shamo_staged_bundle_questions is
  'Read-only expansion of staged ingestion-run bundles to one row per question, scoped to papers awaiting first publication. Supports the staged bundle integrity checks.';

revoke all on shamo_staged_bundle_questions from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Rule 1 - Mark reconciliation
--
-- The marks implied by a part's mark-scheme rows must equal the part's printed marks.
-- Alternative-method rows are excluded, because they re-award the same marks by another route.
--
-- Mark codes are parsed by summing every integer that follows a letter run, so that
-- 'B1 B1' = 2, 'B2' = 2, 'A1 FT' = 1, 'DM1' = 1, 'M1*' = 1.
--
-- Detects both directions:
--   negative gap - required rows wrongly flagged as alternatives, or rows missing entirely
--   positive gap - non-mark table content parsed as mark rows, or a fabricated mark code
-- ---------------------------------------------------------------------------
create or replace view shamo_check_mark_reconciliation as
with ms as (
  select
    ingestion_run_id, paper_variant, question_number,
    coalesce((select string_agg(x, '') from jsonb_array_elements_text(m->'part_path') x), '-') as part,
    coalesce((select sum(g[1]::int)
              from regexp_matches(m->>'mark_code', '[A-Z]+([0-9]+)', 'g') g), 0) as mk
  from shamo_staged_bundle_questions
  cross join lateral jsonb_array_elements(question->'mark_scheme_items') m
  where not coalesce((m->>'is_alternative_method')::bool, false)
),
pt as (
  select
    ingestion_run_id, paper_variant, question_number,
    coalesce((select string_agg(x, '') from jsonb_array_elements_text(p->'label_path') x), '-') as part,
    (p->>'marks')::int as mk
  from shamo_staged_bundle_questions
  cross join lateral jsonb_array_elements(question->'parts') p
  union all
  -- unparted questions reconcile against the question's own total
  select ingestion_run_id, paper_variant, question_number, '-', (question->>'total_marks')::int
  from shamo_staged_bundle_questions
  where jsonb_array_length(coalesce(question->'parts', '[]'::jsonb)) = 0
)
select
  coalesce(ms.ingestion_run_id, pt.ingestion_run_id) as ingestion_run_id,
  coalesce(ms.paper_variant,    pt.paper_variant)    as paper_variant,
  coalesce(ms.question_number,  pt.question_number)  as question_number,
  coalesce(ms.part,             pt.part)             as part,
  pt.mk                                              as printed_part_marks,
  sum(ms.mk)                                         as mark_scheme_row_marks,
  sum(ms.mk) - pt.mk                                 as gap,
  case
    when sum(ms.mk) is null then 'NO_MARK_ROWS_FOR_PART'
    when pt.mk       is null then 'MARK_ROWS_FOR_UNKNOWN_PART'
    when sum(ms.mk) < pt.mk  then 'UNDER_COUNT_CHECK_ALTERNATIVE_FLAGS'
    else                          'OVER_COUNT_CHECK_TABLE_ROWS_AND_SPECIAL_CASES'
  end as likely_cause
from ms
full join pt
  on  ms.ingestion_run_id = pt.ingestion_run_id
  and ms.question_number  = pt.question_number
  and ms.part             = pt.part
group by 1, 2, 3, 4, pt.mk
having pt.mk is distinct from sum(ms.mk);

comment on view shamo_check_mark_reconciliation is
  'Rule 1: per-part mark-scheme row marks must equal printed part marks (excluding alternative-method rows). Any row returned is a defect.';

revoke all on shamo_check_mark_reconciliation from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Rule 2 - Required diagram present
--
-- A question whose own metadata asserts diagram_required = true must carry at least one asset.
-- This is a self-contradiction check: the bundle is disagreeing with itself, so no external
-- source is needed to know something is wrong.
--
-- The text-mention arm is a broader net for cases where metadata also got it wrong: a stem or
-- prompt that refers to a diagram, on a question with no assets.
-- ---------------------------------------------------------------------------
create or replace view shamo_check_required_diagram_missing as
select
  ingestion_run_id,
  paper_variant,
  question_number,
  (question->'metadata'->>'diagram_required')::bool as metadata_says_required,
  jsonb_array_length(coalesce(question->'assets', '[]'::jsonb)) as asset_count,
  case
    when coalesce((question->'metadata'->>'diagram_required')::bool, false)
      then 'METADATA_REQUIRES_DIAGRAM_BUT_NO_ASSET'
    else 'TEXT_MENTIONS_DIAGRAM_BUT_NO_ASSET'
  end as reason
from shamo_staged_bundle_questions
where jsonb_array_length(coalesce(question->'assets', '[]'::jsonb)) = 0
  and (
    coalesce((question->'metadata'->>'diagram_required')::bool, false)
    or question->>'stem_markdown' ilike '%diagram%'
    or question->>'stem_markdown' ilike '%graph of%'
    or exists (
      select 1 from jsonb_array_elements(question->'parts') p
      where p->>'prompt_markdown' ilike '%diagram%'
    )
  );

comment on view shamo_check_required_diagram_missing is
  'Rule 2: a question needing a diagram must have an asset. METADATA_REQUIRES_DIAGRAM_BUT_NO_ASSET is a self-contradiction and always a defect; TEXT_MENTIONS_DIAGRAM_BUT_NO_ASSET needs a source check.';

revoke all on shamo_check_required_diagram_missing from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Additional checks - already validated against batch 2, included because they cost nothing
--
-- Rule 3 - fabricated part label on an unparted question.
--   A question with exactly one part labelled (a) is suspicious: Cambridge does not print a
--   lone (a). Either the question is unparted and the label was invented, or parts are missing.
--
-- Rule 4 - fabricated stem duplicating part (a).
--   A stem byte-identical to the first part's prompt means the prompt was copied upward into a
--   stem that the printed paper does not have.
-- ---------------------------------------------------------------------------
create or replace view shamo_check_structural_fabrication as
select ingestion_run_id, paper_variant, question_number,
       'SINGLE_PART_LABELLED_A' as reason,
       question->'parts'->0->>'prompt_markdown' as detail
from shamo_staged_bundle_questions
where jsonb_array_length(coalesce(question->'parts', '[]'::jsonb)) = 1
  and (question->'parts'->0->'label_path'->>0) = 'a'
union all
select ingestion_run_id, paper_variant, question_number,
       'STEM_DUPLICATES_PART_A',
       question->>'stem_markdown'
from shamo_staged_bundle_questions
where length(coalesce(question->>'stem_markdown', '')) > 0
  and question->>'stem_markdown' = (question->'parts'->0->>'prompt_markdown');

comment on view shamo_check_structural_fabrication is
  'Rules 3 and 4: structural fabrications - a lone (a) part on a likely-unparted question, and a stem copied from part (a).';

revoke all on shamo_check_structural_fabrication from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Combined report. Run this to audit every staged paper at once.
-- Zero rows means every staged paper passes these checks; it does NOT mean they are
-- source-accurate. See the coverage caveat at the top of this file.
-- ---------------------------------------------------------------------------
create or replace view shamo_staged_bundle_integrity_report as
select paper_variant, question_number, part as scope,
       'MARK_RECONCILIATION' as rule,
       format('printed %s vs rows %s (%s)', printed_part_marks, mark_scheme_row_marks, likely_cause) as detail
from shamo_check_mark_reconciliation
union all
select paper_variant, question_number, null, 'REQUIRED_DIAGRAM', reason
from shamo_check_required_diagram_missing
union all
select paper_variant, question_number, null, 'STRUCTURAL_FABRICATION', reason
from shamo_check_structural_fabrication
order by paper_variant, question_number, rule;

comment on view shamo_staged_bundle_integrity_report is
  'Combined staged-bundle integrity report. Any row is a defect requiring source review before publication.';

revoke all on shamo_staged_bundle_integrity_report from anon, authenticated;
