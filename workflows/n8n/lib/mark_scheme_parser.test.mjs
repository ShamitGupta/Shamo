// Unit tests for the deterministic mark-scheme parser.
//
// Each case reproduces a table structure that actually appears in the staged
// batch-2 OCR and that caused a real, documented defect. Cell counts, bold
// wrappers, alternative headers and the SC sentences are reproduced exactly;
// long LaTeX bodies are shortened, since the parser never inspects them.
//
// Integration tests against the verbatim stored OCR live in
// harness/fixtures/ocr/ and run from harness/check.mjs. These are the fast
// logic tests: no network, no database, milliseconds.
//
//   node workflows/n8n/lib/mark_scheme_parser.test.mjs

import assert from "node:assert/strict";
import {
  parseMarkSchemePages,
  stripBold,
  markValue,
  repairBackslashWordCorruption,
} from "./mark_scheme_parser.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message.split("\n")[0]}`);
  }
}

const page = (page_number, markdown) => ({ page_number, markdown });
const codesOf = (items) => items.map((i) => i.mark_code);

// ---------------------------------------------------------------------------
console.log("\nstripBold");
// ---------------------------------------------------------------------------

test("***M1** yields *M1 -- dependency asterisk survives", () => {
  assert.equal(stripBold("***M1**"), "*M1");
});

test("**(B2,1,0)** yields (B2,1,0) -- parenthesis survives", () => {
  assert.equal(stripBold("**(B2,1,0)**"), "(B2,1,0)");
});

test("a cell with two bold runs is left alone, not corrupted", () => {
  // Without the inner.includes("**") guard this returns
  // 'M1** ... scores **B1' and silently mangles the guidance text.
  const guidance = "**M1** for the method, then scores **B1**";
  assert.equal(stripBold(guidance), guidance);
});

test("markValue: B2,1,0 is 2, B1 B1 is 2, A1 FT is 1", () => {
  assert.equal(markValue("B2,1,0"), 2);
  assert.equal(markValue("B1 B1"), 2);
  assert.equal(markValue("A1 FT"), 1);
  assert.equal(markValue("*M1"), 1);
});

test("***M1*** yields M1* -- Cambridge marks dependency on both sides", () => {
  // 9709/62 page 11 prints M1*, not *M1. Rejecting the trailing form dropped
  // the row entirely and made 7(c) reconcile at 3 against a printed 4.
  assert.equal(stripBold("**M1***"), "M1*");
});

test("an unclosed bold marks cell still parses -- **M1FT", () => {
  // 9709/22 page 8: Mistral drops the closing **. Left unhandled, the whole
  // row collapsed into the answer column and Q4 lost 2 of its 7 marks.
  assert.equal(stripBold("**M1FT"), "M1FT");
});

test("an unclosed bold does NOT eat a lifted guidance code", () => {
  assert.equal(stripBold("**M1** Substitute the limits"), "**M1** Substitute the limits");
});

// ---------------------------------------------------------------------------
console.log("\nrepairBackslashWordCorruption -- Mistral spells \\ out as the word 'backslash'");
// ---------------------------------------------------------------------------

test("a known command collapses '\\backslash frac' to '\\frac', braces unescaped", () => {
  // Verbatim from 9709/31 M/J 2024 mark scheme page 7 (live, published).
  assert.equal(
    repairBackslashWordCorruption(String.raw`State or imply $r\; =\; \backslash frac\{5\}\{2\}$`),
    String.raw`State or imply $r\; =\; \frac{5}{2}$`,
  );
});

test("an unknown following token drops the backslash entirely -- imaginary unit", () => {
  // Verbatim from 9709/33 O/N 2024 Q6. Uncorrupted sibling rows in the same
  // corpus write the imaginary unit bare, with no backslash at all.
  assert.equal(
    repairBackslashWordCorruption(String.raw`Substitute $z\; =\; x\; +\; \backslash i\; y$`),
    String.raw`Substitute $z\; =\; x\; +\; i\; y$`,
  );
});

test("an unknown following token drops the backslash entirely -- bare variable", () => {
  assert.equal(repairBackslashWordCorruption(String.raw`Allow $-\backslash c$`), "Allow $-c$");
});

test("\\left\\{ and \\right\\} survive untouched -- they are correct LaTeX, not corruption", () => {
  const text = String.raw`$\left\{ \frac{1}{2} \right\}$`;
  assert.equal(repairBackslashWordCorruption(text), text);
});

test("a corrupted brace next to a genuine \\left\\{ is fixed without disturbing it", () => {
  assert.equal(
    repairBackslashWordCorruption(
      String.raw`\backslash left\{ \backslash frac\{1\}\{2\} \right\}`,
    ),
    String.raw`\left\{ \frac{1}{2} \right\}`,
  );
});

test("text with no corruption is returned unchanged", () => {
  const text = String.raw`$$\frac{1}{2} + \sqrt{3}$$`;
  assert.equal(repairBackslashWordCorruption(text), text);
});

// ---------------------------------------------------------------------------
console.log("\n9709/62 page 10 -- Marks column merged into Guidance");
// ---------------------------------------------------------------------------

const PAPER_62_PAGE_10 = `9709/62

# PUBLISHED

|  Question | Answer | Marks | Guidance  |
| --- | --- | --- | --- |
|  7(b) | $$A(0.83)$$ | $$A(0.84)$$ | **M1** Substitute correct limits into their integral. OR_{1}: integrate 0 to 0.83.  |
|   |  $$= 0.499$$ | $$= 0.504$$ | **A1** OR_{1}: 0.499 and 0.496. Both correct.  |
|   |  '0.499' < 0.5 < '0.504' hence median in range |   | **A1FT** FT their areas; dep 0.5 is between their areas OE.  |
|   |   |   | If 0 scored, **SC**: $$f(m) = 0.5$$ **B1** and $$m = 0.831$$, so $$0.83 < m < 0.84$$ **B1**.  |
|   |   |   | **3**  |

© Cambridge University Press & Assessment 2024`;

test("recovers the three real marks by lifting codes out of Guidance", () => {
  const { items } = parseMarkSchemePages([page(10, PAPER_62_PAGE_10)]);
  assert.deepEqual(codesOf(items).filter(Boolean), ["M1", "A1", "A1 FT"]);
});

test("does NOT fabricate a B1 from the SC guidance sentence", () => {
  // This is the regression test for the defect that reached the database.
  // The old pipeline read `**SC**: ... **B1** ... **B1**` and invented a B1,
  // then flagged it is_alternative_method, which hid it from reconciliation.
  const { items } = parseMarkSchemePages([page(10, PAPER_62_PAGE_10)]);
  assert.equal(
    items.some((i) => i.mark_code === "B1"),
    false,
    "a B1 was fabricated from the SC guidance row",
  );
});

test("keeps the SC row as legitimate guidance-only content", () => {
  const { items } = parseMarkSchemePages([page(10, PAPER_62_PAGE_10)]);
  const scRow = items.find((i) => i.guidance_markdown.startsWith("If 0 scored"));
  assert.ok(scRow, "the SC row should be preserved");
  assert.equal(scRow.mark_code, null);
});

test("captures the printed subtotal of 3, and the marks reconcile to it", () => {
  const { items, printedPartTotals } = parseMarkSchemePages([page(10, PAPER_62_PAGE_10)]);
  assert.equal(printedPartTotals["7|b"], 3);
  const primarySum = items
    .filter((i) => !i.is_alternative_method)
    .reduce((total, i) => total + markValue(i.mark_code), 0);
  assert.equal(primarySum, 3);
});

test("lift is counted as a diagnostic, so the degraded path is visible", () => {
  const { diagnostics } = parseMarkSchemePages([page(10, PAPER_62_PAGE_10)]);
  assert.equal(diagnostics.lifted_mark_code_count, 3);
});

// ---------------------------------------------------------------------------
console.log("\n9709/11 page 7 -- two tables, alternatives, B2,1,0");
// ---------------------------------------------------------------------------

const PAPER_11_PAGE_7 = `9709/11

|  Question | Answer | Marks | Guidance  |
| --- | --- | --- | --- |
|  2(a) | {Stretch} {factor 3} | **B2,1,0** | 2 out of 3 scores B1.  |
|   |  {Translation} $$(0,-2)$$ | **B2,1,0** | Accept shift.  |
|   |  **Alternative Method for Question 2(a)**  |   |   |
|   |  {Translation} $$(0,-2/3)$$ | **(B2,1,0)** | 2 out of 3 scores B1.  |
|   |  {Stretch} {factor 3} | **(B2,1,0)** |   |
|   |  | **4** |   |
|  2(b) | $$[f(x)] = -3\\sin x - 2$$ | **B1 B1** | No marks if extra terms seen.  |
|   |   | **2** |   |

|  Question | Answer | Marks | Guidance  |
| --- | --- | --- | --- |
|  3(a) | $$20 \\times 27 \\times a^3$$ | **M1** | Allow $$540a^3$$ for M1.  |
|   |  $$[a] = 2/3$$ | **A1** | Allow 0.667 AWRT. **SC B1** is $$a = 2/3$$ with no other working.  |
|   |   | **2** |   |

© Cambridge University Press & Assessment 2024`;

test("handles two separate tables on one page", () => {
  const { items } = parseMarkSchemePages([page(7, PAPER_11_PAGE_7)]);
  assert.deepEqual([...new Set(items.map((i) => i._question_number))], [2, 3]);
});

test("preserves B2,1,0 instead of silently rewriting it to B2", () => {
  const { items } = parseMarkSchemePages([page(7, PAPER_11_PAGE_7)]);
  assert.ok(items.some((i) => i.mark_code === "B2,1,0"));
});

test("marks the alternative block, and only the alternative block", () => {
  const { items } = parseMarkSchemePages([page(7, PAPER_11_PAGE_7)]);
  const partA = items.filter((i) => i._question_number === 2 && i.part_path[0] === "a");
  assert.equal(partA.filter((i) => !i.is_alternative_method).length, 2);
  assert.equal(partA.filter((i) => i.is_alternative_method).length, 2);
});

test("2(a) reconciles: primary marks sum to the printed 4", () => {
  const { items, printedPartTotals } = parseMarkSchemePages([page(7, PAPER_11_PAGE_7)]);
  assert.equal(printedPartTotals["2|a"], 4);
  const primarySum = items
    .filter((i) => i._question_number === 2 && i.part_path[0] === "a" && !i.is_alternative_method)
    .reduce((total, i) => total + markValue(i.mark_code), 0);
  assert.equal(primarySum, 4);
});

test("SC B1 inside a Guidance cell never becomes a mark row", () => {
  const { items } = parseMarkSchemePages([page(7, PAPER_11_PAGE_7)]);
  const q3 = items.filter((i) => i._question_number === 3);
  assert.deepEqual(codesOf(q3), ["M1", "A1"]);
});

test("an alternative group records its own mark value", () => {
  const { alternativeGroups } = parseMarkSchemePages([page(7, PAPER_11_PAGE_7)]);
  assert.equal(alternativeGroups.length, 1);
  assert.equal(alternativeGroups[0].mark_value, 4);
});

// ---------------------------------------------------------------------------
console.log("\n9709/51 page 7 -- 8-column ragged table with embedded sub-table");
// ---------------------------------------------------------------------------

const PAPER_51_PAGE_7 = `9709/51

|  Question | Answer |   |   |   |   | Marks | Guidance  |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  3(a) | cw | 20 | 10 | 10 | 5 | 20 | **M1** At least four frequency densities calculated.  |
|   |  fd | 0.8 | 3.2 | 7.6 | 12.8 | 0.6  |   |
|   |   | **A1** | All bar heights correct on graph, not FT.  |   |   |   |   |
|   |   |   |   |   |   |  **B1** | Bar ends at 150, 160, 170, 175, 195.  |
|   |   |   |   |   |   |  **B1** | Axes labelled frequency density.  |
|   |   |   |   |   |   | **4** |   |
|  3(b) | [LQ:] 160 to 170 [UQ:] 170 to 175 | **M1** | UQ and LQ classes seen.  |   |   |   |   |
|   |   |   |   |   |   |  **A1** | 175 - 160 = 15  |
|   |   |   |   |   |   |   | If M0 scored, **SC B1** for 175 - 160 = 15.  |
|   |   |   |   |   |   | **2** |   |

© Cambridge University Press & Assessment 2024`;

test("finds mark codes at index 2 and index 6 within the same block", () => {
  // The header says Marks is index 6, but the A1 row puts it at index 2.
  // This is why column resolution must be content-based.
  const { items } = parseMarkSchemePages([page(7, PAPER_51_PAGE_7)]);
  const partA = items.filter((i) => i.part_path[0] === "a");
  assert.deepEqual(codesOf(partA).filter(Boolean), ["M1", "A1", "B1", "B1"]);
});

test("3(a) reconciles to the printed 4 -- the staged bundle had 3", () => {
  const { items, printedPartTotals } = parseMarkSchemePages([page(7, PAPER_51_PAGE_7)]);
  assert.equal(printedPartTotals["3|a"], 4);
  const sum = items
    .filter((i) => i.part_path[0] === "a" && !i.is_alternative_method)
    .reduce((total, i) => total + markValue(i.mark_code), 0);
  assert.equal(sum, 4);
});

test("the embedded frequency table is folded into the answer, not made a mark row", () => {
  const { items } = parseMarkSchemePages([page(7, PAPER_51_PAGE_7)]);
  const first = items[0];
  assert.ok(first.content_markdown.includes("fd"), "fd row should be appended as a continuation");
  assert.equal(items.filter((i) => i.part_path[0] === "a").length, 4);
});

test("frequency values are not mistaken for printed subtotals", () => {
  const { printedPartTotals } = parseMarkSchemePages([page(7, PAPER_51_PAGE_7)]);
  assert.deepEqual(Object.keys(printedPartTotals).sort(), ["3|a", "3|b"]);
});

test("the SC B1 row is preserved with a null code -- same construct as 62 Q7(b)", () => {
  const { items } = parseMarkSchemePages([page(7, PAPER_51_PAGE_7)]);
  const scRow = items.find((i) => i.guidance_markdown.startsWith("If M0 scored"));
  assert.ok(scRow);
  assert.equal(scRow.mark_code, null);
});

// ---------------------------------------------------------------------------
console.log("\n9709/42 page 21 -- shifted rows and two alternative blocks");
// ---------------------------------------------------------------------------

const PAPER_42_PAGE_21 = `9709/42

|  Question | Answer | Marks | Guidance  |
| --- | --- | --- | --- |
|  7(b) | **Alternative Method for Question 7(b)**  |   |   |
|   |  For $BC$ Newton II | ***M1** | 3 terms; allow sign errors.  |
|   |  For $P$ displacement | **A1** | For either.  |
|   |  Or $Q$ has speed 2 after 0.5 s |  |   |
|   |  Equate displacements | **DM1** | For use of $s_P = s_Q$.  |
|   |  $t = 0.5$ so total time = 1 s | **A1** |   |
|   |  **Alternative Method 2 for Question 7(b): Using relative velocity**  |   |   |
|   |  For $BC$ Newton II | ***M1** | 3 terms; allow $g$ missing.  |
|   |  $Q$ has speed 2 and has moved 0.5 | **A1** | For both.  |
|   |  $t = 0.5/(3-2)$ | **DM1** | Attempt at relative velocity.  |
|  $t = 0.5$ so total time = 1 s | **A1** |   |   |
|   | **4** |   |   |

© Cambridge University Press & Assessment 2024`;

test("dependency asterisk survives into the stored mark code", () => {
  const { items } = parseMarkSchemePages([page(21, PAPER_42_PAGE_21)]);
  assert.equal(items.filter((i) => i.mark_code === "*M1").length, 2);
});

test("repairs the two rows shifted one cell left", () => {
  const { diagnostics } = parseMarkSchemePages([page(21, PAPER_42_PAGE_21)]);
  assert.equal(diagnostics.realigned_row_count, 2);
});

test("reads the printed subtotal off a shifted row", () => {
  const { printedPartTotals } = parseMarkSchemePages([page(21, PAPER_42_PAGE_21)]);
  assert.equal(printedPartTotals["7|b"], 4);
});

test("opens two distinct alternative groups", () => {
  const { alternativeGroups } = parseMarkSchemePages([page(21, PAPER_42_PAGE_21)]);
  assert.equal(alternativeGroups.length, 2);
  assert.deepEqual(alternativeGroups.map((g) => g.group_index), [1, 2]);
});

test("the bare 'Or ...' line continues the previous row instead of emitting one", () => {
  const { items } = parseMarkSchemePages([page(21, PAPER_42_PAGE_21)]);
  assert.equal(items.some((i) => i.content_markdown.includes("Or $Q$ has speed")), true);
  assert.equal(items.filter((i) => i.mark_code === null).length, 0);
});

// ---------------------------------------------------------------------------
console.log("\n9709/22 p9 -- an embedded numeric working grid is not mark rows");
// ---------------------------------------------------------------------------

// Verbatim OCR. Cambridge prints the synthetic-division working as three
// 5-column rows inside a 4-column table. They award nothing, so per-part
// reconciliation stayed balanced while three junk rows sat in the database --
// this is the case that made `is_alternative_method` read 12 against 9 printed.
const SYNTHETIC_DIVISION = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 5(a) | Carry out division at least as far as $$3x^2 + k_1x$$ | **M1** | Or equivalent (inspection, ...). |
| **Alternative Method for Question 5(a)** |
| Synthetic division | **(M1)** |  |
| $$-2/3$$ | 9 | 18 | 5 | 4 |
|  |  | $$-6$$ | 8 | $$-2$$ |
|  | 9 | 12 | $$-3$$ | 6 |
| Obtain quotient $$3x^2 + 4x - 1$$ | **(A1)** |  |
|  |  | **3** |  |`;

test("the working grid is dropped, not stored as codeless mark rows", () => {
  const { items, diagnostics } = parseMarkSchemePages([page(9, SYNTHETIC_DIVISION)]);
  assert.equal(items.filter((i) => i.mark_code === null).length, 0);
  assert.equal(diagnostics.table_debris_row_count, 3);
});

test("the real marks around the grid survive intact", () => {
  const { items } = parseMarkSchemePages([page(9, SYNTHETIC_DIVISION)]);
  assert.deepEqual(
    items.map((i) => i.mark_code),
    ["M1", "M1", "A1"],
  );
  // Only the two inside the Alternative Method block are flagged.
  assert.deepEqual(
    items.map((i) => i.is_alternative_method),
    [false, true, true],
  );
});

test("a codeless row WITH prose is still kept -- the 62 Q7(b) special case", () => {
  const specialCase = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 7(b) | Obtain 0.83 | **A1** |  |
|  |  |  | If 0 scored, **SC**: $$m = 0.831$$ so $$0.83 < m < 0.84$$ **B1**. |`;
  const { items, diagnostics } = parseMarkSchemePages([page(10, specialCase)]);
  const codeless = items.filter((i) => i.mark_code === null);
  assert.equal(codeless.length, 1);
  assert.match(codeless[0].guidance_markdown, /If 0 scored/);
  assert.equal(diagnostics.table_debris_row_count, 0);
});

// ---------------------------------------------------------------------------
console.log("\nAlternative blocks capped by a \"for first N marks\" qualifier");
// ---------------------------------------------------------------------------

// Verbatim shape of 9709/12 M/J 2024 page 17. The header caps the block at 4
// marks; the closing B1 carrying the final answer is SHARED with the primary
// method and must not be absorbed. Absorbing it staged 4 primary marks against
// a printed 5.
// String.raw, not a plain template literal: `` in `rac` is a form feed and
// would silently corrupt the fixture into `<FF>rac`.
const cappedBlock = String.raw`| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 6(b) | **Alternative Method 2 for first 4 marks of Question 6(b)** | | |
|  | Subtract and then integrate | **(M1)** | If terms have moved |
|  | $$[\pm] \left( \frac{4}{6} x^2 \right)$$ | **(B2,1,0)** | B2 for 3 correct terms |
|  | $$[\pm] \left( 16^2 - 4^2 \right)$$ | **(M1)** |  |
|  | $$\frac{32}{3}$$ or 10.7 | **B1** | AWRT |
|  |  | **5** | Condone the inclusion of pi |`;

test("rows beyond the capped Nth mark stay primary, not alternative", () => {
  const { items, printedPartTotals, diagnostics } = parseMarkSchemePages([page(17, cappedBlock)]);
  const rows = items.filter((i) => i._question_number === 6);
  assert.equal(rows.length, 4);

  const alternative = rows.filter((r) => r.is_alternative_method);
  const primary = rows.filter((r) => !r.is_alternative_method);
  // M1 + B2,1,0 + M1 = 4, exactly the cap.
  assert.equal(alternative.reduce((t, r) => t + markValue(r.mark_code), 0), 4);
  // The final answer row is shared and therefore primary.
  assert.equal(primary.length, 1);
  assert.match(primary[0].content_markdown, /frac\{32\}\{3\}/);

  // And the whole point: the part now reconciles against the printed subtotal.
  assert.equal(printedPartTotals["6|b"], 5);
  assert.equal(
    primary.reduce((t, r) => t + markValue(r.mark_code), 0) +
      alternative.reduce((t, r) => t + markValue(r.mark_code), 0),
    5,
  );
  assert.equal(diagnostics.alternative_block_capped_count, 1);
});

test("Cambridge also spells the count as a word", () => {
  const worded = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 8(b) | **Alternative Method 1 for first two marks of Question 8(b)** | | |
|  | Attempt something | **(M1)** |  |
|  | Obtain something | **(A1)** |  |
|  | Final shared answer | **A1** |  |
|  |  | **3** |  |`;
  const { items } = parseMarkSchemePages([page(11, worded)]);
  const rows = items.filter((i) => i._question_number === 8);
  assert.equal(rows.filter((r) => r.is_alternative_method).length, 2);
  assert.equal(rows.filter((r) => !r.is_alternative_method).length, 1);
});

test("an uncapped alternative header still runs to the end of its block", () => {
  // The common case must not regress: with no qualifier, every row in the
  // block is alternative.
  const uncapped = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 5(a) | **Alternative Method for Question 5(a)** | | |
|  | First step | **(M1)** |  |
|  | Second step | **(A1)** |  |
|  | Third step | **(A1)** |  |`;
  const { items, diagnostics } = parseMarkSchemePages([page(9, uncapped)]);
  const rows = items.filter((i) => i._question_number === 5);
  assert.equal(rows.length, 3);
  assert.equal(rows.every((r) => r.is_alternative_method), true);
  assert.equal(diagnostics.alternative_block_capped_count, 0);
});

// ---------------------------------------------------------------------------
console.log("\nOne answer awarded several marks");
// ---------------------------------------------------------------------------

test("blank rows beneath an answer inherit it instead of storing nothing", () => {
  // 9709/11 O/N 2025 Q4(a), verbatim from the PDF text layer. Cambridge prints
  // the answer once and gives it three B1s, one per braced element. Stored as
  // printed, rows 2 and 3 are empty -- which is useless to a student and raised
  // a blocking EMPTY_MARK_SCHEME_ROW that stopped the whole paper.
  const shared = String.raw`| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 4(a) | {10} – (x {+} {3})^{2} | **B1** |   |
|   |   |  **B1** |   |
|   |   |  **B1** |   |
|   |   |  **3** |   |`;
  const { items, diagnostics, printedPartTotals } = parseMarkSchemePages([page(11, shared)]);
  const rows = items.filter((i) => i._question_number === 4);
  assert.equal(rows.length, 3);
  assert.equal(rows.every((r) => r.mark_code === "B1"), true);
  // Every row now carries the printed answer -- inherited, never invented.
  assert.equal(rows.every((r) => r.content_markdown === rows[0].content_markdown), true);
  assert.equal(rows[0].content_markdown.includes("{10}"), true);
  assert.equal(diagnostics.shared_answer_row_count, 2);
  // The marks are untouched, so the part still reconciles against its printed 3.
  assert.equal(printedPartTotals["4|a"], 3);
});

test("a blank row with nothing above it to inherit is still dropped", () => {
  // The guard that keeps EMPTY_MARK_SCHEME_ROW meaningful: inheritance needs a
  // real answer above it IN THE SAME PART, so a genuinely empty leading row is
  // not silently given text from a previous part.
  const orphan = String.raw`| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 6(a) | Some answer | **B1** |   |
| 6(b) |   |  **B1** |   |`;
  const { items, diagnostics } = parseMarkSchemePages([page(4, orphan)]);
  const partB = items.filter((i) => i.part_path.join(".") === "b");
  assert.equal(partB.length, 1);
  assert.equal(partB[0].content_markdown, "");
  assert.equal(diagnostics.shared_answer_row_count, 0);
});

// ---------------------------------------------------------------------------
console.log("\nMarks cells OCR emits in an unexpected shape");
// ---------------------------------------------------------------------------

test("two codes run together in one cell are both counted", () => {
  // 9709/61 O/N 2025 Q6(a). Requiring whitespace between codes meant `B1B1`
  // was not recognised as a Marks cell at all: the text was appended to the
  // answer and both marks vanished, reconciling 3 against a printed 5.
  const runTogether = String.raw`| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
|  6(a) | N(2.5 + 0.8 , 0.05+ 0.02) = N(3.3, 0.07) | **B1B1** | SOI  |
|   |  [= 0.945] | **M1** | For standardising.  |
|   |  1 - phi | **M1** | For area.  |
|   |  = 0.172 | **A1** |   |
|   |   | **5** |   |`;
  const { items, printedPartTotals } = parseMarkSchemePages([page(13, runTogether)]);
  const rows = items.filter((i) => i.part_path.join(".") === "a");
  assert.equal(rows.length, 4);
  assert.equal(rows[0].mark_code, "B1B1");
  assert.equal(markValue(rows[0].mark_code), 2);
  const primary = rows.reduce((sum, r) => sum + markValue(r.mark_code), 0);
  assert.equal(primary, 5);
  assert.equal(printedPartTotals["6|a"], 5);
});

test("a row reduced to code plus guidance still yields its mark", () => {
  // 9709/52 M/J Q6(b). The printed Answer cell is blank, so OCR dropped the
  // leading empty columns and emitted two cells in a four-column table. The
  // shift repair could not help -- it shifts right and needs a trailing empty
  // cell -- so the row was dropped and one mark was silently lost.
  const shortRow = String.raw`| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 6(b) | **Method 1** |
| $$1 - (C_8)$$ | **M1** | One term. |
| **A1** | Correct unsimplified expression. |
| $$= 0.180$$ | **B1** | Range. |
|  |  | **3** |  |`;
  const { items, printedPartTotals } = parseMarkSchemePages([page(14, shortRow)]);
  const rows = items.filter((i) => i.part_path.join(".") === "b");
  assert.equal(rows.map((r) => r.mark_code).join(","), "M1,A1,B1");
  // The Answer cell really is blank here; the guidance is what carries meaning,
  // so this must NOT be mistaken for an empty row or for a shared answer.
  const a1 = rows.find((r) => r.mark_code === "A1");
  assert.equal(a1.content_markdown, "");
  assert.equal(a1.guidance_markdown.startsWith("Correct unsimplified"), true);
  assert.equal(rows.reduce((s, r) => s + markValue(r.mark_code), 0), 3);
  assert.equal(printedPartTotals["6|b"], 3);
});

test("a bare integer in the first cell is still not a Marks cell", () => {
  // The guard on the rule above: `2` in cell 0 is ambiguous with a question
  // number, so only mark CODES may claim the first column.
  const ambiguous = String.raw`| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 7 | Some answer | **M1** | Guidance. |
| 2 | 3 | 5 |`;
  const { items } = parseMarkSchemePages([page(6, ambiguous)]);
  assert.equal(items.filter((i) => i._question_number === 7).length, 1);
});

// ---------------------------------------------------------------------------
console.log("\nNegative fixtures -- boilerplate must yield nothing");
// ---------------------------------------------------------------------------

test("an Annotation table is not a mark scheme, even though it contains DM1", () => {
  // Paper 31's generic material runs to page 8 and this table mentions real
  // mark codes. It has no question-label row, which is the discriminator.
  const annotation = `# Mark Scheme Notes

| Annotation | Meaning  |
| --- | --- |
| **DM1** | Dependent method mark  |
| **A1** | Accuracy mark  |`;
  const { items } = parseMarkSchemePages([page(8, annotation)]);
  assert.equal(items.length, 0);
});

test("an Abbreviations table yields nothing", () => {
  const abbreviations = `| AEF / OE | Any Equivalent Form  |
| --- | --- |
| AG | Answer Given  |`;
  const { items } = parseMarkSchemePages([page(5, abbreviations)]);
  assert.equal(items.length, 0);
});

test("a page with no tables at all yields nothing", () => {
  const prose = `# Generic Marking Principles

Marks must be awarded positively.`;
  const { items } = parseMarkSchemePages([page(2, prose)]);
  assert.equal(items.length, 0);
});

// ---------------------------------------------------------------------------
console.log("\nA bare \"Alternative\" header, with no Method/Solution qualifier");
// ---------------------------------------------------------------------------

test("a bare 'Alternative' header opens a block instead of bleeding into the prior row", () => {
  // IGCSE 0606 s25 P12 Q11, verbatim shape from source review (20 August
  // 2026): the printed header is the single word "Alternative", which
  // ALT_HEADER's "alternative method|solution" pattern does not match. Before
  // the fix, the header text was appended onto the PRECEDING row's own
  // content_markdown by the multi-line continuation step, corrupting a
  // correct final answer into "...OR=... \nAlternative".
  const bareHeader = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 11 | Main-method final answer | **A1** |  |
|  | Alternative |  |  |
|  | Alt-method step | **M1** |  |
|  | Alt-method final answer | **A1** |  |`;
  const { items } = parseMarkSchemePages([page(9, bareHeader)]);
  const rows = items.filter((i) => i._question_number === 11);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].content_markdown, "Main-method final answer");
  assert.equal(rows[0].is_alternative_method, false);
  assert.deepEqual(
    rows.slice(1).map((r) => r.is_alternative_method),
    [true, true],
  );
});

test("a numbered bare header ('Alternative 2') and 'Alternative version' both open a block", () => {
  const numbered = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 6 | Primary step | **B1** |  |
|  | Alternative 2 |  |  |
|  | Alt step | **M1** |  |`;
  const { items: numberedItems } = parseMarkSchemePages([page(3, numbered)]);
  assert.equal(numberedItems.filter((i) => i.is_alternative_method).length, 1);

  const versioned = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 2 | Primary step | **B1** |  |
|  | Alternative version |  |  |
|  | Alt step | **M1** |  |`;
  const { items: versionedItems } = parseMarkSchemePages([page(4, versioned)]);
  assert.equal(versionedItems.filter((i) => i.is_alternative_method).length, 1);
});

test("prose that merely starts with the word 'alternative' is not mistaken for a header", () => {
  const prose = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 3 | Alternative forms of the answer are accepted, oe | **A1** |  |`;
  const { items } = parseMarkSchemePages([page(5, prose)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].content_markdown, "Alternative forms of the answer are accepted, oe");
});

// ---------------------------------------------------------------------------
console.log("\nA bundled multi-mark row printed as one bare number");
// ---------------------------------------------------------------------------

test("a merged 2-mark row with a bolded embedded code recovers the full value, not just 1", () => {
  // IGCSE 0606 m24 P22, verbatim shape from source review (20 August 2026):
  // Cambridge prints one row worth 2 marks in the Marks column, with the
  // breakdown only in prose ("M1 for ..."). Before the fix, LIFT recovered
  // the bolded M1 at its own face value (1) and the printed "2" was never
  // consulted at all -- 2 questions' Q1/Q3/Q4/Q5 all lost a mark this way.
  const merged = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 1 | Critical values 2.5 and 1 | **2** | **M1** for factorises or solves a 3-term quadratic |`;
  const { items } = parseMarkSchemePages([page(6, merged)]);
  const rows = items.filter((i) => i._question_number === 1);
  assert.equal(rows.length, 1);
  assert.equal(markValue(rows[0].mark_code), 2);
});

test("a merged row with an UNBOLDED embedded code still recovers the full value", () => {
  // Same defect class, but LIFT cannot even see the code because Mistral did
  // not bold it this time -- confirmed on a separate paper in the same
  // review. The value must still be recovered, not silently dropped to 0.
  const unbolded = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 5 | y = 1/2 ln(4/3) oe, y = 1/2 ln2 oe | **2** | B1 for one correct solution B1 for both solutions and no extra solution |`;
  const { items } = parseMarkSchemePages([page(9, unbolded)]);
  const rows = items.filter((i) => i._question_number === 5);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mark_code, "B2");
  assert.equal(markValue(rows[0].mark_code), 2);
});

test("an unrelated large bare number in a ragged embedded-data row is never treated as a bundled mark", () => {
  // Regression guard for the 9709/51 frequency-table shape above: a bare "20"
  // sitting in the layout's Marks column there is class-width DATA, not a
  // merged mark value, and must never bump a correctly-lifted M1 into "M20".
  const { items } = parseMarkSchemePages([page(7, PAPER_51_PAGE_7)]);
  const partA = items.filter((i) => i.part_path[0] === "a");
  assert.deepEqual(codesOf(partA).filter(Boolean), ["M1", "A1", "B1", "B1"]);
});

test("a genuine printed subtotal on its own blank row is still untouched by the merge step", () => {
  // The clean case (step 3) must not regress: a bare subtotal with nothing
  // else on its row is still pure reconciliation ground truth, not a row.
  const clean = `| Question | Answer | Marks | Guidance |
| --- | --- | --- | --- |
| 9 | Step one | **M1** |  |
| 9 | Step two | **A1** |  |
|  |  | **2** |  |`;
  const { items, printedPartTotals } = parseMarkSchemePages([page(3, clean)]);
  const rows = items.filter((i) => i._question_number === 9);
  assert.equal(rows.length, 2);
  assert.equal(printedPartTotals["9|"], 2);
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exitCode = 1;
