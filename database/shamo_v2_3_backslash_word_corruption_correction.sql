-- Un-mangle backslash-escaped LaTeX: Mistral OCR spelling the escape
-- character out as the word "backslash" instead of emitting `\`, and
-- separately double-escaping grouping braces.
--
-- THE DEFECT
-- ----------
-- Confirmed present in the raw Mistral OCR record itself -- not introduced
-- downstream -- verbatim on 9709/31 M/J 2024 mark scheme page 7 and 9709/12
-- O/N 2024 page 21. A stored cell such as
--
--     $r\; =\; \backslash frac\{5\}\{2\}$
--
-- is the literal text of a LaTeX fraction rather than something that renders
-- as one: the real backslash before "frac" survives, but the word
-- "backslash" sits redundantly in front of it and both grouping braces have
-- been escaped as if they needed to render literally. Values are correct --
-- this is presentation, not mathematics -- but it is exactly what a student
-- sees. `frontend/src/utils/sanitizeLatex.js` had no handling for it.
--
-- SCOPE, MEASURED LIVE ON 13 AUGUST 2026
-- ---------------------------------------
-- 79 rows of shamo_mark_scheme_items across 18 already-PUBLISHED papers: 73
-- in content_markdown, 27 in guidance_markdown (some rows carry it in both).
-- shamo_question_parts.prompt_markdown and shamo_questions.stem_markdown
-- carry zero occurrences. Searched with strpos(), never LIKE -- a LIKE
-- pattern containing a backslash is silently misinterpreted because Postgres
-- LIKE treats backslash as its own escape character.
--
-- THE FIX, VALIDATED AGAINST EVERY AFFECTED LIVE ROW BEFORE THIS FILE WAS
-- WRITTEN (read-only regexp_replace SELECTs, not blind pattern authorship)
-- ------------------------------------------------------------------------
--   1. `\backslash <command>` collapses to `\<command>` when the following
--      word is a real LaTeX command that needs the backslash (frac, sqrt,
--      theta, text, left, right, ln, times, mu, tan, pm, div, pi, log, sin,
--      cos, leq, geq, cdot, circ, and the handful of Greek letters/symbols
--      also observed). The word "backslash" and one trailing space are
--      deleted; the real backslash already present in the source survives.
--   2. Anything else -- `\backslash i` (the imaginary unit), `\backslash c`
--      (a bare variable), `\backslash their` (the follow-through word),
--      `\backslash \theta` (already correctly single-escaped, corrupted only
--      by an adjacent spurious "backslash") -- has no command to keep, so the
--      whole `\backslash ` span is deleted, leaving the following character
--      as plain text. Confirmed against uncorrupted sibling rows in the same
--      corpus that write these bare, e.g. "...+ i" with no backslash at all.
--   3. Any remaining escaped `\{` / `\}` is unescaped back to a plain
--      grouping brace -- EXCEPT immediately after `\left` / `\right`, where
--      an escaped brace is correct LaTeX for a literal brace DELIMITER and
--      is left untouched. `\left\{ ... \right\}` appears throughout this
--      same corpus as legitimate, uncorrupted notation; unescaping it
--      unconditionally would trade one corruption for another. Protected via
--      a control-character placeholder rather than a printable one, so it
--      cannot collide with real content.
--
-- Mechanically reversible, matching the standing operating-plan note: no
-- content is invented, no value changes, only presentation is repaired. The
-- separate `\;`/`\,` thin-space forms noted in that same item are
-- deliberately NOT touched here -- they are ambiguous (a stray comma stands
-- in for a thin space in places) and need their own sampled review.
--
-- ONE ROW IS DELIBERATELY LEFT PARTIALLY UNRESOLVED, ON PURPOSE
-- ---------------------------------------------------------------
-- 9709/41 O/N 2025, row id 0fb584ce-8af7-456c-a985-827740f4cd0e, content:
--   $v\; =\; -9.6\; \backslash cspace\; 0.3t^2\; -\; 0.8t\; -\; 17.1\; =\; 0$
-- "cspace" is not a recognised command and is not a bare variable/letter
-- either -- it does not match the shape of any other occurrence in this
-- batch. The mechanical fix still applies (word "backslash" removed), but
-- the leftover bare word "cspace" is left in place rather than guessed at,
-- because a plausible reading (a lost sentence break, a lost `$...$ $...$`
-- boundary) is not the only plausible reading. Flagged in a separate issue
-- row for a human to check against the printed page; this file does not
-- invent a separator that was never confirmed.
--
-- PIPELINE FIX, SEPARATE FROM THIS BACKFILL
-- ------------------------------------------
-- workflows/n8n/lib/mark_scheme_parser.mjs now runs the identical repair
-- (repairBackslashWordCorruption) on every table cell before any other
-- parsing step, so a future batch cannot carry this into the database again.
-- This file is the one-time correction for content already published.

begin;

create temporary table backslash_affected_rows as
select m.id, m.question_id, m.content_markdown as before_content, m.guidance_markdown as before_guidance
from shamo_mark_scheme_items m
where strpos(m.content_markdown, 'backslash') > 0
   or strpos(m.guidance_markdown, 'backslash') > 0;

do $$
declare
  v_affected int;
begin
  select count(*) into v_affected from backslash_affected_rows;
  if v_affected <> 79 then
    raise exception 'Expected 79 affected mark-scheme rows, found %. Nothing changed. '
      'Re-measure with strpos() before adjusting this assertion -- a mismatch means '
      'either a fresh batch introduced more, or a prior partial run already fixed some.',
      v_affected;
  end if;
end $$;

with known(cmd) as (
  values ('frac'), ('dfrac'), ('tfrac'), ('times'), ('text'), ('left'), ('right'),
         ('ln'), ('sqrt'), ('mu'), ('theta'), ('tan'), ('pm'), ('div'), ('pi'), ('log'),
         ('sin'), ('cos'), ('leq'), ('geq'), ('cdot'), ('circ'), ('leqslant'), ('geqslant'),
         ('neq'), ('approx'), ('alpha'), ('beta'), ('gamma'), ('lambda'), ('sigma'),
         ('phi'), ('Phi'), ('Sigma'), ('infty'), ('int'), ('sum'), ('Rightarrow')
),
pattern as (
  select string_agg(cmd, '|') as alt from known
),
step1 as (
  -- Known command: collapse "\backslash <command>" to "\<command>".
  select id,
    regexp_replace(before_content, '\\backslash ?(' || (select alt from pattern) || ')\y', E'\\\\\\1', 'g') as c1,
    regexp_replace(before_guidance, '\\backslash ?(' || (select alt from pattern) || ')\y', E'\\\\\\1', 'g') as g1
  from backslash_affected_rows
),
step2 as (
  -- Anything else: drop the whole "\backslash " span outright.
  select id,
    regexp_replace(c1, '\\backslash ?', '', 'g') as c2,
    regexp_replace(g1, '\\backslash ?', '', 'g') as g2
  from step1
),
protected as (
  -- Shield genuine "\left\{" / "\right\}" delimiters with a control-character
  -- placeholder before the brace unescape below, so they are never touched.
  select id,
    replace(replace(c2, '\left\{', E'\x01LB\x01'), '\right\}', E'\x01RB\x01') as c2p,
    replace(replace(g2, '\left\{', E'\x01LB\x01'), '\right\}', E'\x01RB\x01') as g2p
  from step2
),
unescaped as (
  select id,
    regexp_replace(regexp_replace(c2p, '\\\{', '{', 'g'), '\\\}', '}', 'g') as c3,
    regexp_replace(regexp_replace(g2p, '\\\{', '{', 'g'), '\\\}', '}', 'g') as g3
  from protected
),
final as (
  select id,
    replace(replace(c3, E'\x01LB\x01', '\left\{'), E'\x01RB\x01', '\right\}') as c_final,
    replace(replace(g3, E'\x01LB\x01', '\left\{'), E'\x01RB\x01', '\right\}') as g_final
  from unescaped
)
update shamo_mark_scheme_items m
set content_markdown = final.c_final,
    guidance_markdown = final.g_final
from final
where m.id = final.id;

-- Scoped to the 79 rows this file touched, not the whole table. Cambridge
-- separately uses `\{ ... \}` on its own, correct terms to bracket discrete
-- answer-elements in a shared multi-mark row (see mark_scheme_parser.mjs's
-- own "One answer awarded several marks" comment, e.g.
-- `\{-16x^{-3}\}\{+40(2x-3)^{-3}\}`) -- pre-existing, unrelated to this
-- defect, present on rows that never contained the word "backslash", and
-- must not be flagged here.
do $$
declare
  v_remaining_word int;
  v_remaining_brace int;
begin
  select count(*) into v_remaining_word
  from shamo_mark_scheme_items m
  join backslash_affected_rows bar on bar.id = m.id
  where strpos(m.content_markdown, 'backslash') > 0
     or strpos(m.guidance_markdown, 'backslash') > 0;
  if v_remaining_word <> 0 then
    raise exception 'Expected 0 of the 79 touched rows still containing the word "backslash", found %.',
      v_remaining_word;
  end if;

  select count(*) into v_remaining_brace
  from (
    select
      replace(replace(m.content_markdown, '\left\{', ''), '\right\}', '') as cs,
      replace(replace(m.guidance_markdown, '\left\{', ''), '\right\}', '') as gs
    from shamo_mark_scheme_items m
    join backslash_affected_rows bar on bar.id = m.id
  ) stripped
  where strpos(cs, '\{') > 0 or strpos(cs, '\}') > 0
     or strpos(gs, '\{') > 0 or strpos(gs, '\}') > 0;
  if v_remaining_brace <> 0 then
    raise exception 'Expected 0 of the 79 touched rows with an unexplained escaped brace outside \left\{/\right\}, found %.',
      v_remaining_brace;
  end if;
end $$;

-- Resolved audit trail, one row per affected question (a question with
-- several affected mark rows gets one summary row, not one per row).
insert into shamo_ingestion_issues
  (ingestion_run_id, severity, issue_code, document_type, page_number,
   question_number, part_path, message, resolved, resolution_note, resolved_at)
select distinct
  q.ingestion_run_id, 'warning', 'LATEX_BACKSLASH_WORD_CORRECTED',
  'mark_scheme', null::integer, q.question_number, null::text[],
  'One or more mark-scheme rows stored the LaTeX escape character spelled out '
    || 'as the word "backslash", with grouping braces escaped, instead of rendering.',
  true,
  'Corrected by database/shamo_v2_3_backslash_word_corruption_correction.sql: '
    || 'the word "backslash" is removed (keeping one real backslash before a '
    || 'recognised command, dropping it entirely otherwise), and escaped grouping '
    || 'braces are unescaped except immediately after \left/\right. Values unchanged.',
  now()
from backslash_affected_rows bar
join shamo_questions q on q.id = bar.question_id;

-- The one row this correction could not fully resolve, flagged unresolved
-- rather than folded into the generic resolved note above.
insert into shamo_ingestion_issues
  (ingestion_run_id, severity, issue_code, document_type, page_number,
   question_number, part_path, message, resolved, resolution_note, resolved_at)
select q.ingestion_run_id, 'warning', 'LATEX_BACKSLASH_WORD_CORRUPTION_RESIDUAL',
       'mark_scheme', null::integer, q.question_number, null::text[],
       'After the mechanical backslash/brace correction, this row still contains the '
         || 'bare leftover word "cspace" mid-expression: '
         || '"$v\; =\; -9.6\; cspace\; 0.3t^2\; -\; 0.8t\; -\; 17.1\; =\; 0$". '
         || 'This token matched no recognised LaTeX command and no plausible bare '
         || 'variable, so it was deliberately not guessed at. Needs a human check '
         || 'against the printed 9709/41 O/N 2025 mark scheme to determine the real '
         || 'separator (candidates: a lost sentence break, a lost inline-math boundary).',
       false, null::text, null::timestamptz
from shamo_mark_scheme_items m
join shamo_questions q on q.id = m.question_id
where m.id = '0fb584ce-8af7-456c-a985-827740f4cd0e';

commit;
