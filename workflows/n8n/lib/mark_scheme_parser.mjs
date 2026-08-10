// Deterministic parser for Cambridge mark-scheme tables.
//
// WHY THIS REPLACES A MODEL CALL
// ------------------------------
// Mistral OCR already emits mark schemes as markdown tables with the printed
// Question / Answer / Marks / Guidance columns intact. The pipeline used to
// discard that structure and pay gpt-5.4-nano to reconstruct it from raw text,
// one call per question. Every mark-row defect class observed in batches 1 and
// 2 came from that: answer/marks bleeding into guidance, table body rows
// counted as mark rows, fabricated mark codes, wrong part paths, and mishandled
// blank Marks cells.
//
// A parser cannot hallucinate a mark code. That is the whole argument.
//
// This module is authored as a real ES module so it can be unit-tested in
// milliseconds, and is inlined into the n8n Code node `Parse Mark Scheme
// Tables` by build_budget_v2_workflows.mjs via lib/inline_module.mjs. The
// static validator asserts the inlined text matches this file byte for byte,
// so the two can never drift.
//
// Verified against real OCR from all six staged batch-2 papers. The five
// structures below are not hypothetical -- each one appears in the corpus and
// each one caused a real defect.

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

// One printed Cambridge mark code.
//
// Deliberately permissive in three places, each learned from real OCR:
//   - `B2,1,0` (award 2, 1 or 0) is real; the old regex rejected it and the
//     model silently rewrote it to `B2`.
//   - The dependency asterisk appears on BOTH sides. `*M1` is the common form,
//     but 9709/62 page 11 prints `M1*`. Rejecting the trailing form dropped a
//     whole mark row and made 7(c) reconcile at 3 against a printed 4.
//   - `FT` may be attached (`A1FT`) or spaced (`A1 FT`).
// DA is as real as DM and DB. Cambridge's own generic marking principles define
// "DM or DA" as a method or accuracy mark dependent on a previous mark, and
// 9709/63 M/J 2024 Q6(b) prints a bare DA1. Its absence here blocked that whole
// paper on INVALID_MARK_CODE against a correctly-read printed code, and targeted
// repair could not clear it because there was nothing wrong with the extraction.
//
// Longer alternatives must precede shorter ones, so DM/DB/DA are tried before
// the single letters and DA1 stays one code rather than parsing as D + A1.
const ONE_CODE = String.raw`\*?(?:DM|DB|DA|M|A|B)\d+\*?(?:\s*FT)?(?:\s*,\s*\d+)*`;

// A whole Marks cell: one or more codes, e.g. `M1`, `*M1`, `A1 FT`, `B1 B1`.
//
// The separator is `\s*`, not `\s+`, because Cambridge also prints them run
// together. 9709/61 O/N 2025 Q6(a) awards two marks in one cell as `B1B1`, and
// requiring a space meant the cell was not recognised as a Marks cell at all --
// so the codes were appended to the answer text and TWO MARKS WERE LOST, with
// the part reconciling at 3 against a printed 5.
//
// Safe because the pattern is anchored to a whole cell. `M1A1B1` appearing in
// the middle of a Special Case sentence is not a whole cell and still cannot
// match. `DB1` stays one code, since the alternation tries `DM` and `DB` before
// the single letters.
const CODE_BODY = new RegExp(`^${ONE_CODE}(?:\\s*${ONE_CODE})*$`, "i");

// A printed per-part subtotal: a bare integer alone in the Marks column.
const SUBTOTAL = /^\d{1,2}$/;

// A Question cell: `7`, `7(b)`, `9(a)(ii)`. The main number is an integer and
// never enters part_path.
const QUESTION_CELL = /^(\d{1,2})((?:\s*\([A-Za-z0-9]{1,3}\))*)$/;

// Opens an alternative block. `Method 1` explicitly CLOSES one -- it marks the
// primary method, not an alternative.
const ALT_HEADER = /^(?:alternative\s+(?:method|solution)|method\s*(\d+))\b/i;

// A qualifier limiting how far the alternative block reaches:
//
//   Alternative Method 2 for first 4 marks of Question 6(b)
//   Alternative Method 1 for first two marks of Question 8(b)
//
// This is load-bearing, not decoration. Rows beyond the Nth are SHARED by every
// method -- typically the final answer -- so absorbing them into the alternative
// block removes them from the primary sum and silently loses a mark. That is
// exactly what happened to 9709/12 M/J 2024 Q6(b): 4 primary marks staged
// against a printed 5, because the closing `32/3` answer row was swallowed.
//
// Cambridge writes the count as a digit or a word, so both are accepted.
const ALT_MARK_CAP = /\bfor\s+(?:the\s+)?first\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+marks?\b/i;
const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Read the "for first N marks" cap from a block header, or null if absent. */
function alternativeMarkCap(header) {
  const match = String(header ?? "").match(ALT_MARK_CAP);
  if (!match) return null;
  const token = match[1].toLowerCase();
  return WORD_NUMBERS[token] ?? Number(token);
}

// Opens a Special Case block: `Special Case if no integration seen. Maximum
// M1A1B1 for 3 marks`. Structurally identical to an alternative header -- empty
// Marks cell, announcement in the Answer column, awards on the rows beneath.
//
// Semantically it is NOT an alternative method. An SC is a capped consolation
// award for a wrong approach, and the repository convention is explicit that
// special-case marks must not inflate primary mark coverage. Both kinds are
// therefore excluded from the primary sum, but they are tracked separately in
// `special_case_groups` so the validator can tell them apart and so the
// distinction survives if an is_special_case column is added later.
const SC_HEADER = /^special\s+case\b/i;

// A Marks code that OCR pushed to the front of the Guidance cell, because the
// printed table had more columns than Mistral emitted. Anchored, so a code
// mentioned mid-sentence ("If 0 scored, SC: ... B1") never matches.
const LIFT = new RegExp(`^\\*\\*\\s*(${ONE_CODE}(?:\\s+${ONE_CODE})*)\\s*\\*\\*\\s*`, "i");

// Page furniture that is never table content.
const PAGE_NOISE = [
  /^\d{4}\/\d{2}$/,
  /^Cambridge International/i,
  /^©/,
  /^Page \d+ of \d+$/i,
  /^#+\s*PUBLISHED\s*$/i,
  /^PUBLISHED$/i,
  /^#/,
];

/**
 * Strip markdown bold from a whole table cell.
 *
 * Cell-bounded stripping is what makes the dependency asterisk unambiguous.
 * `***M1**` inside a pipe-delimited cell can only be `**` + `*M1` + `**`, so it
 * resolves to `*M1` with the dependency marker intact. The old code sliced
 * prefixes and suffixes off model output, after the cell boundary was already
 * gone, and lost the asterisk.
 *
 * The `inner.includes("**")` guard is load-bearing: without it a guidance cell
 * like `**M1** ... scores **B1**` strips to `M1** ... scores **B1` and corrupts
 * the text.
 */
export function stripBold(raw) {
  let text = String(raw ?? "").trim();
  for (;;) {
    if (text.length > 4 && text.startsWith("**") && text.endsWith("**")) {
      const inner = text.slice(2, -2);
      if (inner.includes("**")) break;
      text = inner.trim();
      continue;
    }
    if (text.length > 4 && text.startsWith("__") && text.endsWith("__")) {
      text = text.slice(2, -2).trim();
      continue;
    }
    break;
  }
  // Unclosed bold. Mistral sometimes drops the closing `**`, e.g. paper 22
  // page 8 emits `**M1FT` where the paper prints `M1FT`. Only safe when there
  // is no later `**` in the cell -- otherwise this is a Guidance cell whose
  // leading code belongs to the LIFT path, and eating the marker here would
  // destroy the signal that the Marks column was merged in.
  if (text.startsWith("**") && !text.slice(2).includes("**")) {
    text = text.slice(2).trim();
  }
  return text;
}

/** Total mark value of a code cell. `B2,1,0` -> 2, `B1 B1` -> 2, `A1 FT` -> 1. */
export function markValue(code) {
  if (!code) return 0;
  return [...String(code).matchAll(/\*?(?:DM|DB|M|A|B)(\d+)/gi)].reduce(
    (total, match) => total + Number(match[1] || 1),
    0,
  );
}

/**
 * Does a cell contain human prose, as opposed to bare maths or table debris?
 *
 * This is the test that separates two superficially identical shapes, both of
 * which arrive with no mark code:
 *
 *   legitimate  Marks cell genuinely blank, Guidance carries a real instruction
 *               ("If 0 scored, **SC**: ... **B1**") -- 9709/62 Q7(b)
 *   debris      an embedded numeric sub-table row ("$$-2/3$$ | 9 | 18" / "5")
 *               or a bare separator ("**Or:**") -- 9709/22 Q5(a), 9709/12 Q10
 *
 * Maths is stripped before the test because `\frac` and `\sqrt` would otherwise
 * read as words and make every equation look like prose.
 */
function hasProse(text) {
  if (!text) return false;
  const withoutMaths = String(text)
    .replace(/\$\$?[^$]*\$\$?/g, " ")
    .replace(/\\[A-Za-z]+/g, " ");
  return /[A-Za-z]{3,}/.test(withoutMaths);
}

/** Canonical stored form. Matches the existing distribution: `A1`, `*M1`, `B1 FT`, `DM1`. */
function normalizeCode(body) {
  return body
    .replace(/([0-9])\s*(FT)\b/gi, "$1 $2")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Classify a stripped cell. Parenthesised codes signal an alternative method. */
function kindOf(stripped) {
  if (!stripped) return "empty";
  const parenthesised = stripped.match(/^\(([^()]*)\)$/);
  const body = parenthesised ? parenthesised[1].trim() : stripped;
  if (CODE_BODY.test(body)) return parenthesised ? "code_alt" : "code";
  if (SUBTOTAL.test(body)) return "int";
  return "text";
}

function codeBodyOf(stripped) {
  const parenthesised = stripped.match(/^\(([^()]*)\)$/);
  return parenthesised ? parenthesised[1].trim() : stripped;
}

function splitCells(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line.trim());
const isSeparatorRow = (cells) => cells.every((cell) => /^:?-{2,}:?$/.test(cell));

// ---------------------------------------------------------------------------
// Block detection
// ---------------------------------------------------------------------------

/**
 * Split a page into maximal runs of table lines, then keep only the runs that
 * are actually mark-scheme tables.
 *
 * Structural classification, not page-number heuristics. Boilerplate does not
 * reliably end on page 3 -- paper 31's generic material runs to page 8, and the
 * `Annotation | Meaning` table there contains real-looking codes like `DM1`.
 * What it lacks is a question-label row, which is the discriminator.
 */
function findTableBlocks(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (isTableLine(trimmed)) {
      if (!current) current = [];
      current.push(trimmed);
      continue;
    }
    if (current) {
      blocks.push(current);
      current = null;
    }
    if (PAGE_NOISE.some((pattern) => pattern.test(trimmed))) continue;
  }
  if (current) blocks.push(current);
  return blocks;
}

/** Header layout, or null when the block has no recognisable header. */
function readHeader(cells) {
  const normalized = cells.map((cell) => stripBold(cell).toLowerCase());
  if (normalized[0] !== "question") return null;
  const marksIndex = normalized.findIndex((cell) => cell === "marks");
  if (marksIndex === -1) return null;
  const guidanceIndex = normalized.findIndex((cell) => cell === "guidance");
  return {
    width: cells.length,
    marksIndex,
    guidanceIndex: guidanceIndex === -1 ? marksIndex + 1 : guidanceIndex,
  };
}

/**
 * A headerless block is a mark-scheme continuation only if it both looks like
 * question content and carries at least one mark code. Requiring both keeps the
 * Abbreviations and Annotation tables out.
 */
function looksLikeMarkSchemeBody(rows) {
  const hasQuestionLabel = rows.some((cells) => QUESTION_CELL.test(stripBold(cells[0] ?? "")));
  const hasMarkCode = rows.some((cells) =>
    cells.some((cell) => ["code", "code_alt"].includes(kindOf(stripBold(cell)))),
  );
  return hasQuestionLabel && hasMarkCode;
}

// ---------------------------------------------------------------------------
// Column resolution
// ---------------------------------------------------------------------------

/**
 * Find the Marks column for one row by CONTENT, never by position.
 *
 * Positional parsing is impossible in this corpus. Paper 51 emits 8-column
 * tables because the Answer column contains an embedded frequency table, and
 * within a single block the mark code appears at index 2 on one row and index 6
 * on the next. The header says 6.
 */
function resolveMarksIndex(stripped, layout) {
  const kinds = stripped.map(kindOf);
  const allOtherCellsEmpty = (index) =>
    stripped.every((cell, i) => i === index || cell === "");

  // 1. The header position, when it holds a code.
  if (layout && ["code", "code_alt"].includes(kinds[layout.marksIndex])) {
    return layout.marksIndex;
  }
  // 2. Any code cell, rightmost first. Prefers `**(A1)**` over a bare `2`.
  for (let index = stripped.length - 1; index >= 1; index -= 1) {
    if (["code", "code_alt"].includes(kinds[index])) return index;
  }
  // 2b. A code in the FIRST cell, when the printed Answer cell was blank and
  // OCR dropped the empty leading columns with it.
  //
  // 9709/52 M/J Q6(b) emits `| **A1** | Correct unsimplified expression. |` --
  // two cells in a four-column table, because the row's Question and Answer
  // cells are both empty in the source. The existing shift repair cannot help:
  // it shifts right by one and requires a trailing empty cell, and this row has
  // neither. Without this the row was dropped entirely and the part reconciled
  // at 2 against a printed 3 -- a silently lost mark, on both the primary route
  // and its alternative.
  //
  // Restricted to mark codes on purpose. A bare integer in cell 0 is ambiguous
  // with a question number and stays excluded; `A1` is not, because a question
  // label must match QUESTION_CELL, which requires a leading digit.
  if (["code", "code_alt"].includes(kinds[0])) return 0;
  // 3. An integer in the layout's Marks column, with every cell BEFORE it
  // empty, is a printed subtotal. Guidance after it is allowed: 9709/12 M/J
  // page 17 prints the 6(b) subtotal as `|  |  | **(5)** | Condone the
  // inclusion of pi ... |`, and requiring the whole row to be empty meant that
  // part had no reconciliation anchor at all -- which is precisely why its lost
  // mark went unnoticed.
  //
  // Paper 51's frequency values (`| 1,2,5 | ... | 2 |`) are still excluded,
  // because their Question and Answer cells are not empty.
  const cellsBeforeEmpty = (index) => stripped.every((cell, i) => i >= index || cell === "");
  if (layout && kinds[layout.marksIndex] === "int" && cellsBeforeEmpty(layout.marksIndex)) {
    return layout.marksIndex;
  }
  // 4. No layout to trust, so fall back to the strict rule.
  for (let index = stripped.length - 1; index >= 1; index -= 1) {
    if (kinds[index] === "int" && allOtherCellsEmpty(index)) return index;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parse every mark-scheme page of one paper.
 *
 * @param {Array<{page_number:number, markdown?:string, raw_markdown?:string}>} pages
 * @returns {{items:Array, printedPartTotals:Object, alternativeGroups:Array, diagnostics:Object}}
 */
export function parseMarkSchemePages(pages) {
  const items = [];
  const printedPartTotals = {};
  const alternativeGroups = [];
  const specialCaseGroups = [];
  const diagnostics = {
    realigned_row_count: 0,
    lifted_mark_code_count: 0,
    unparsed_row_count: 0,
    subtotal_row_count: 0,
    table_debris_row_count: 0,
    alternative_block_capped_count: 0,
    shared_answer_row_count: 0,
    table_block_count: 0,
    skipped_block_count: 0,
  };
  // Per-question diagnostics matter as much as the totals: the fallback
  // decision is made per question, and attributing a paper-wide count to every
  // question would send a whole paper to the paid model because of one bad row.
  const perQuestion = new Map();
  const bump = (questionNumber, field) => {
    if (questionNumber === null || questionNumber === undefined) return;
    if (!perQuestion.has(questionNumber)) {
      perQuestion.set(questionNumber, {
        realigned_row_count: 0,
        lifted_mark_code_count: 0,
        unparsed_row_count: 0,
        subtotal_row_count: 0,
        table_debris_row_count: 0,
        alternative_block_capped_count: 0,
        shared_answer_row_count: 0,
      });
    }
    perQuestion.get(questionNumber)[field] += 1;
  };

  let layout = null;
  let question = null;
  let partPath = [];
  let altMode = false;
  let scMode = false;
  // True once a "for first N marks" block has awarded its N. While set, rows
  // are primary even if Cambridge keeps parenthesising their codes. Cleared by
  // anything that ends the block: a table header, a new question label, another
  // block header, or a printed subtotal.
  let capSatisfied = false;
  let altGroupIndex = 0;
  let pendingRow = null;

  const partKey = () => partPath.join(".");
  const totalsKey = (q, key) => `${q}|${key}`;

  const sortedPages = [...(pages ?? [])].sort((a, b) => a.page_number - b.page_number);

  for (const page of sortedPages) {
    const markdown = page.markdown ?? page.raw_markdown ?? "";

    for (const block of findTableBlocks(markdown)) {
      const rows = block.map(splitCells).filter((cells) => !isSeparatorRow(cells));
      if (!rows.length) continue;

      const header = readHeader(rows[0]);
      const body = header ? rows.slice(1) : rows;
      if (!body.length) continue;

      if (header) {
        layout = header;
        // A fresh header ends any alternative or special-case block.
        altMode = false;
        scMode = false;
        capSatisfied = false;
        pendingRow = null;
      } else if (!looksLikeMarkSchemeBody(body)) {
        diagnostics.skipped_block_count += 1;
        continue;
      }
      diagnostics.table_block_count += 1;

      for (const rawCells of body) {
        let cells = rawCells;
        let stripped = cells.map(stripBold);
        let marksIndex = resolveMarksIndex(stripped, layout);

        // --- Shift repair -------------------------------------------------
        // Six rows across the batch are shifted one cell left, e.g. paper 42
        // page 21 emits `| $t = 0.5$ ... | **A1** |  |  |`. Retry the row
        // shifted right and accept the alignment that lands a code or subtotal
        // on the header's Marks index.
        const firstCellIsLabel = QUESTION_CELL.test(stripped[0] ?? "");
        const looksShifted =
          layout &&
          marksIndex !== layout.marksIndex &&
          !firstCellIsLabel &&
          stripped[stripped.length - 1] === "";
        if (looksShifted) {
          const shiftedCells = ["", ...cells.slice(0, -1)];
          const shiftedStripped = shiftedCells.map(stripBold);
          const shiftedIndex = resolveMarksIndex(shiftedStripped, layout);
          if (shiftedIndex === layout.marksIndex) {
            cells = shiftedCells;
            stripped = shiftedStripped;
            marksIndex = shiftedIndex;
            diagnostics.realigned_row_count += 1;
            bump(question, "realigned_row_count");
          }
        }

        // --- 1. Question / part label ---------------------------------------
        const labelMatch = stripped[0] ? stripped[0].match(QUESTION_CELL) : null;
        if (labelMatch) {
          question = Number(labelMatch[1]);
          partPath = [...labelMatch[2].matchAll(/\(([A-Za-z0-9]{1,3})\)/g)].map((m) =>
            m[1].toLowerCase(),
          );
          altMode = false;
          scMode = false;
          capSatisfied = false;
          altGroupIndex = 0;
          pendingRow = null;
        }

        if (question === null) continue;

        // Include cell 0 when it holds content rather than a question label.
        // Mistral drops the leading empty cell on continuation rows, e.g.
        // 9709/22 page 9 emits `| Obtain quotient ... | **A1** | |`. Slicing
        // from index 1 unconditionally silently discarded that answer text.
        const answerStart = labelMatch || !stripped[0] ? 1 : 0;
        // When there is no Marks cell the answer must still stop before the
        // Guidance column. Running to the end of the row swallowed the guidance
        // text into the answer, so a guidance-only row came out with identical
        // content and guidance -- which then tripped the duplicate-text rule on
        // every legitimate blank-Answer special-case row.
        const answerEnd = marksIndex === null ? layout?.guidanceIndex ?? undefined : marksIndex;
        const answerCells = stripped.slice(answerStart, answerEnd).filter(Boolean);
        let answerText = answerCells.join(" | ");

        // --- 2. Alternative-method or Special-Case header --------------------
        // Runs AFTER the label step, because paper 42 puts the question label
        // and the block header on the same row.
        const headerCandidate = stripBold(answerCells[0] ?? "");
        // An alternative header can arrive as the ONLY cell on its row, with no
        // leading empty Question cell -- 9709/22 page 9 emits
        // `| **Alternative Method for Question 5(a)** |`. Without this the
        // header was mistaken for content and its block never opened, so every
        // row beneath it counted as a primary mark.

        if (SC_HEADER.test(headerCandidate) && marksIndex === null) {
          scMode = true;
          altMode = false;
          capSatisfied = false;
          specialCaseGroups.push({
            question_number: question,
            part_path: [...partPath],
            heading: headerCandidate,
            mark_value: 0,
            row_sequence_numbers: [],
            _rows: [],
          });
          pendingRow = null;
          continue;
        }

        const altMatch = headerCandidate.match(ALT_HEADER);
        if (altMatch && marksIndex === null) {
          // `Method 1` is the primary method and closes alternative mode.
          scMode = false;
          capSatisfied = false;
          if (altMatch[1] === "1") {
            altMode = false;
          } else {
            altMode = true;
            altGroupIndex += 1;
            alternativeGroups.push({
              question_number: question,
              part_path: [...partPath],
              group_index: altGroupIndex,
              heading: headerCandidate,
              // null means "runs until the next header or part change", which
              // is the common case. A number means the block covers only that
              // many marks and everything after is shared with the primary.
              mark_cap: alternativeMarkCap(headerCandidate),
              mark_value: 0,
              row_sequence_numbers: [],
              _rows: [],
            });
          }
          pendingRow = null;
          continue;
        }

        const marksCellStripped = marksIndex === null ? "" : stripped[marksIndex];
        const marksKind = marksIndex === null ? "empty" : kindOf(marksCellStripped);

        // --- 3. Printed subtotal --------------------------------------------
        // The single most valuable thing the old pipeline threw away: the
        // examiner's own per-part total, printed in the Marks column. It is
        // reconciliation ground truth that does not depend on the question
        // paper being extracted correctly.
        if (marksKind === "int") {
          // codeBodyOf, not the raw cell: a subtotal inside an alternative
          // block is printed parenthesised, and Number("(5)") is NaN.
          const key = totalsKey(question, partKey());
          const printed = Number(codeBodyOf(marksCellStripped));
          const isParenthesised = marksCellStripped !== codeBodyOf(marksCellStripped);
          // A bare subtotal is the official per-part figure and always wins. A
          // parenthesised one is recorded only when nothing better is known.
          if (!isParenthesised || printedPartTotals[key] === undefined) {
            printedPartTotals[key] = printed;
          }
          diagnostics.subtotal_row_count += 1;
          bump(question, "subtotal_row_count");
          altMode = false;
          scMode = false;
          capSatisfied = false;
          pendingRow = null;
          continue;
        }

        const guidanceRaw =
          marksIndex === null
            ? cells[layout?.guidanceIndex ?? cells.length - 1] ?? ""
            : cells.slice(marksIndex + 1).find((cell) => cell.trim()) ?? "";
        let guidanceText = String(guidanceRaw).trim();

        let markCode = null;
        // Both alternative and special-case awards are kept out of the primary
        // sum. They are distinguished by the groups they belong to.
        let isAlternative = altMode || scMode;
        // Set when this row's answer was inherited from the row above rather
        // than printed on the row itself -- see the shared-answer step below.
        let sharedAnswer = false;

        if (marksKind === "code" || marksKind === "code_alt") {
          markCode = normalizeCode(codeBodyOf(marksCellStripped));
          // A capped block that has awarded its N marks yields to the printed
          // qualifier, even though Cambridge keeps parenthesising the rows that
          // follow. 9709/12 M/J Q6(b) prints the shared final answer as
          // `**(B1)**` at the foot of Alternative Method 2, and reading that
          // parenthesis as "still alternative" is precisely what lost the mark.
          // The header said "for first 4 marks" and it means it.
          if (marksKind === "code_alt" && capSatisfied) {
            isAlternative = false;
          } else if (marksKind === "code_alt") {
            isAlternative = true;
            // A parenthesised code is its own alternative marker and often
            // appears without a printed header. Open an implicit group so the
            // row is attributable: the validator treats an alternative row that
            // belongs to no group as a blocking issue, which is what stops a
            // stray flag from hiding a row from reconciliation.
            if (!altMode) {
              altMode = true;
              altGroupIndex += 1;
              alternativeGroups.push({
                question_number: question,
                part_path: [...partPath],
                group_index: altGroupIndex,
                mark_value: 0,
                implicit: true,
                row_sequence_numbers: [],
                _rows: [],
              });
            }
          }
        } else {
          // --- 4. Guidance lift --------------------------------------------
          // Paper 62 page 10: the printed table has five columns, Mistral
          // emitted four, and the Marks column landed at the front of Guidance.
          // Anchored so `If 0 scored, **SC**: ... **B1**` does NOT match -- that
          // sentence is exactly what the model misread as a real B1.
          const lifted = guidanceText.match(LIFT);
          if (lifted) {
            markCode = normalizeCode(lifted[1]);
            guidanceText = guidanceText.slice(lifted[0].length).trim();
            diagnostics.lifted_mark_code_count += 1;
            bump(question, "lifted_mark_code_count");
          }
        }

        // --- 5. Multi-line cell continuation ---------------------------------
        if (markCode === null && !guidanceText && answerText && pendingRow) {
          pendingRow.content_markdown = `${pendingRow.content_markdown}\n${answerText}`.trim();
          continue;
        }

        // A row that yielded neither a code nor any text is genuinely
        // unparsed. Counting it here rather than earlier means shifted content
        // rows and block headers -- both of which ARE understood -- no longer
        // inflate the count and push a whole question to the paid model.
        if (markCode === null && !guidanceText && !answerText && stripped.some(Boolean)) {
          diagnostics.unparsed_row_count += 1;
          bump(question, "unparsed_row_count");
        }

        // --- 5b. Shared answer across several marks ---------------------------
        // Cambridge awards one answer several marks by printing it once and
        // leaving the rows beneath it blank apart from their codes:
        //
        //   | 4(a) | {10} - (x {+}{3})^2 | **B1** |  |
        //   |      |                     | **B1** |  |
        //   |      |                     | **B1** |  |
        //   |      |                     | **3**  |  |
        //
        // The braces mark the three elements each B1 pays for. Stored verbatim
        // those rows are blank, which is both useless to a student and a
        // blocking EMPTY_MARK_SCHEME_ROW -- it stopped 9709/11 O/N 2025 dead.
        // Carrying the answer forward keeps every row meaningful without
        // inventing a word: the text is the printed text, and the marks are
        // unchanged, so reconciliation still sees 3 against a printed 3.
        //
        // Deliberately NOT a relaxation of EMPTY_MARK_SCHEME_ROW. A blank row
        // with nothing above it to inherit from is still a real defect and
        // still blocks.
        if (
          markCode !== null &&
          !answerText &&
          !guidanceText &&
          pendingRow &&
          pendingRow.part_path.join(".") === partPath.join(".") &&
          pendingRow.content_markdown
        ) {
          answerText = pendingRow.content_markdown;
          sharedAnswer = true;
          diagnostics.shared_answer_row_count += 1;
          bump(question, "shared_answer_row_count");
        }

        // --- 6. Emit ----------------------------------------------------------
        // A row with no mark code but real guidance is legitimate source
        // content, not a defect: the printed Marks cell is genuinely blank.
        if (markCode === null && !guidanceText && !answerText) continue;

        // ...but a codeless row carrying no prose at all is layout, not an
        // award. Cambridge embeds numeric working grids inside the Answer cell
        // (synthetic division on 9709/22 Q5(a) arrives as three 5-column rows
        // in a 4-column table) and prints bare `**Or:**` separators. Both were
        // being stored as mark rows. They contribute no marks, so reconciliation
        // stayed balanced and never saw them -- which is exactly why this needs
        // its own rule rather than relying on the totals.
        if (markCode === null && !hasProse(answerText) && !hasProse(guidanceText)) {
          diagnostics.table_debris_row_count += 1;
          bump(question, "table_debris_row_count");
          continue;
        }

        const row = {
          sequence_number: 0, // assigned per question after the full pass
          part_path: [...partPath],
          mark_code: markCode,
          content_markdown: answerText,
          guidance_markdown: guidanceText,
          is_final_answer: false,
          is_alternative_method: isAlternative,
          source_page_numbers: [page.page_number],
          _question_number: question,
        };
        items.push(row);
        // A shared-answer row must NOT become the next row's pendingRow source,
        // or a run of blank rows would each inherit from the last and the chain
        // would outlive the printed answer it came from. Keep pointing at the
        // row that actually carried the text.
        if (!sharedAnswer) pendingRow = row;

        // Hold the row itself; sequence numbers are only assigned after the
        // full pass, so row_sequence_numbers is filled in at the end. Leaving
        // it empty made every alternative row look ungrouped to the validator.
        if (scMode && specialCaseGroups.length) {
          const group = specialCaseGroups[specialCaseGroups.length - 1];
          group.mark_value += markValue(markCode);
          group._rows.push(row);
        } else if (altMode && alternativeGroups.length) {
          const group = alternativeGroups[alternativeGroups.length - 1];
          group.mark_value += markValue(markCode);
          group._rows.push(row);

          // "for first N marks": once the block has awarded its N, the rows
          // that follow belong to every method, not to this one. Close the
          // block so they count as primary.
          //
          // Closed AFTER pushing, because the row that reaches the cap is the
          // last one genuinely inside the alternative. Closing before would
          // hand that row back to the primary sum and double-count it.
          if (group.mark_cap !== null && group.mark_value >= group.mark_cap) {
            group.capped = true;
            diagnostics.alternative_block_capped_count += 1;
            bump(question, "alternative_block_capped_count");
            altMode = false;
            capSatisfied = true;
          }
        }
      }
    }
  }

  // Sequence per main question, in visible order.
  const seenPerQuestion = new Map();
  for (const row of items) {
    const next = (seenPerQuestion.get(row._question_number) ?? 0) + 1;
    seenPerQuestion.set(row._question_number, next);
    row.sequence_number = next;
  }

  // Now that sequence numbers exist, publish them on each group and drop the
  // private row references so the emitted shape stays JSON-clean.
  for (const group of [...alternativeGroups, ...specialCaseGroups]) {
    group.row_sequence_numbers = group._rows.map((row) => row.sequence_number);
    delete group._rows;
  }

  // is_final_answer: the last primary A/B award within each part.
  const lastAwardByPart = new Map();
  for (const row of items) {
    if (row.is_alternative_method || !row.mark_code) continue;
    if (!/[AB]\d/i.test(row.mark_code)) continue;
    lastAwardByPart.set(`${row._question_number}|${row.part_path.join(".")}`, row);
  }
  for (const row of lastAwardByPart.values()) row.is_final_answer = true;

  return {
    items,
    printedPartTotals,
    alternativeGroups,
    specialCaseGroups,
    diagnostics,
    perQuestionDiagnostics: perQuestion,
  };
}

/**
 * Group parsed rows into the per-question `mark_scheme_results` shape that
 * `Merge Paper Bundle` already consumes, so nothing downstream changes.
 */
export function buildMarkSchemeResults(pages, questionNumbers) {
  const { items, printedPartTotals, alternativeGroups, specialCaseGroups, perQuestionDiagnostics } =
    parseMarkSchemePages(pages);

  return (questionNumbers ?? [...new Set(items.map((i) => i._question_number))].sort((a, b) => a - b))
    .map((questionNumber) => {
      const questionItems = items
        .filter((item) => item._question_number === questionNumber)
        .map(({ _question_number, ...rest }) => rest);
      const perQuestion = perQuestionDiagnostics.get(questionNumber) ?? {
        realigned_row_count: 0,
        lifted_mark_code_count: 0,
        unparsed_row_count: 0,
        subtotal_row_count: 0,
        table_debris_row_count: 0,
        alternative_block_capped_count: 0,
        shared_answer_row_count: 0,
      };

      const totals = {};
      for (const [key, value] of Object.entries(printedPartTotals)) {
        const [q, partKey] = key.split("|");
        if (Number(q) === questionNumber) totals[partKey] = value;
      }

      return {
        question_number: questionNumber,
        source: "ocr_table",
        used_full_mark_scheme_fallback: false,
        removed_subtotal_count: perQuestion.subtotal_row_count,
        unwrapped_mark_code_count: 0,
        realigned_row_count: perQuestion.realigned_row_count,
        lifted_mark_code_count: perQuestion.lifted_mark_code_count,
        unparsed_row_count: perQuestion.unparsed_row_count,
        table_debris_row_count: perQuestion.table_debris_row_count ?? 0,
        alternative_block_capped_count: perQuestion.alternative_block_capped_count ?? 0,
        shared_answer_row_count: perQuestion.shared_answer_row_count ?? 0,
        printed_part_totals: totals,
        alternative_groups: alternativeGroups.filter((g) => g.question_number === questionNumber),
        special_case_groups: specialCaseGroups.filter((g) => g.question_number === questionNumber),
        mark_scheme_items: questionItems,
        source_page_numbers: [...new Set(questionItems.flatMap((i) => i.source_page_numbers))].sort(
          (a, b) => a - b,
        ),
      };
    });
}
