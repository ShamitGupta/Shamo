-- Shamo v2.5 -- allow a genuinely blank prompt_markdown on a PARENT question
-- part that has children, matching the deterministic validator's own
-- documented, deliberate rule.
--
-- WHY
-- ---
-- Cambridge often prints a bare part label (e.g. "(a)") with no text of its
-- own, putting the real prompts under its children ((a)(i), (a)(ii), ...).
-- lib/build_budget_v2_workflows.mjs's `Deterministic Validation` node already
-- encodes this deliberately: EMPTY_PART_TEXT only fires for a LEAF part with
-- no prompt and no children -- a parent with children is explicitly exempt.
--
-- The stored CHECK constraint on shamo_question_parts never matched that
-- rule: it required every row's prompt_markdown to be non-blank, with no
-- exception for parents. This was latent until 20 August 2026, when
-- publishing 0606/12 O/N 2024 (Q4 part "a", a genuine parent with four real
-- children (a)(i)-(a)(iv)) hit
-- `23514 shamo_question_parts_prompt_markdown_check` and stopped the whole
-- paper's atomic publish. A corpus-wide check found four more staged IGCSE
-- papers with the identical shape, so this is a class, not a one-off.
--
-- FIX
-- ---
-- Widen the constraint to accept NULL as well as non-blank text -- Postgres
-- CHECK constraints already treat a NULL evaluation as satisfied, so this is
-- purely additive: every row that satisfied the old constraint still does.
-- The publish RPC (or a follow-up correction, see the verification file)
-- must store NULL, not '', for a legitimately promptless parent -- an empty
-- string does not carry that meaning under this project's own convention
-- ("null and empty string are not interchangeable where source blankness has
-- meaning").

alter table public.shamo_question_parts
  drop constraint shamo_question_parts_prompt_markdown_check;

alter table public.shamo_question_parts
  add constraint shamo_question_parts_prompt_markdown_check
  check (prompt_markdown is null or btrim(prompt_markdown) <> '');

-- The column also carried its own NOT NULL, independent of the CHECK above --
-- caught only because the first attempt at this fix still failed with 23502
-- ("null value ... violates not-null constraint") rather than 23514.
alter table public.shamo_question_parts
  alter column prompt_markdown drop not null;
