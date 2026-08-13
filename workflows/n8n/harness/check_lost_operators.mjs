// Find operators the OCR replaced with the wrong symbol.
//
//   node workflows/n8n/harness/check_lost_operators.mjs [--verbose]
//
// THE DEFECT CLASS
//
// Cambridge routinely prints a quantity beside an equivalent form of itself,
// separated by a COMMA:
//
//     P(HRR) = 1/4 x 4/6 x 4/6 = 16/144, 4/36
//     P(TBB) = 3/4 x 4/7 x 3/6 = 36/168, 6/28, 3/14
//
// The OCR stored every one of those commas as `\cdot`, which reads as
// multiplication. 16/144 x 4/36 = 0.0123 where the printed value is 0.1111.
//
// WHY EQUALITY IS THE SIGNAL, AND WHY IT IS ALMOST NOISE-FREE
//
// The operands either side of the separator are numerically EQUAL -- they are
// the same number written two ways. That is what makes this detectable without
// the PDF: a product of two equal quantities is neither of them, and a sum of
// two equal quantities is double them. So whenever a `\cdot`, `+` or `-` joins
// operands that evaluate to the same value, the operator is almost certainly a
// corrupted list separator.
//
// Genuine multiplication of equal quantities does occur -- x * x -- but not
// between two DIFFERENT literal fractions, which is what this looks for. It
// requires at least one operand to be a fraction of integers and the operands
// to be written differently, so `\frac{1}{2} \cdot \frac{1}{2}` (a real square)
// is not flagged while `\frac{16}{144} \cdot \frac{4}{36}` is.
//
// This is deliberately NOT a general expression evaluator. The lesson from
// check_metadata_fields.mjs and the first version of check_lost_factorials.mjs
// is that a broad check yielding mostly-wrong findings gets skimmed and then
// ignored. This one asks a single narrow question with an arithmetic answer.
//
// SCOPE AND BLIND SPOT, STATED PLAINLY
//
// It catches a corrupted separator between equal quantities. It does NOT catch
// a corrupted operator between UNequal quantities -- `8.1 + \sqrt{140}` for a
// printed `8.1 / \sqrt{140}` is invisible here, because nothing in the
// expression contradicts itself. That case needs the printed value in the same
// cell, or the PDF text layer, which is what check_ocr_vs_pdf.mjs provides.
// Run both.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGED = path.join(HERE, "fixtures", "staged");

const verbose = process.argv.includes("--verbose");

// A single operand: \frac{int}{int}, or a bare decimal/integer.
const FRAC = String.raw`\\d?frac\{\s*(\d+)\s*\}\{\s*(\d+)\s*\}`;
const NUM = String.raw`\d+(?:\.\d+)?`;
const OPERAND = `(?:${FRAC}|${NUM})`;
// Two operands joined by a suspect separator. Captured groups let us evaluate
// each side. `\cdot` and `\times` are the corrupted-comma cases; a bare `-` or
// `+` between equal literal fractions is the same shape.
const JOINED = new RegExp(
  String.raw`(${OPERAND})\s*(\\cdot|\\times|\+|-)\s*(${OPERAND})`,
  "g",
);

function evaluate(text) {
  const frac = text.match(new RegExp(`^${FRAC}$`));
  if (frac) {
    const [, a, b] = frac;
    return Number(b) === 0 ? null : Number(a) / Number(b);
  }
  if (new RegExp(`^${NUM}$`).test(text)) return Number(text);
  return null;
}

// Two operands are "the same number written differently" only if their text
// differs. 1/2 * 1/2 is a real square; 16/144 * 4/36 is a corrupted comma.
function writtenDifferently(a, b) {
  return a.replace(/\s+/g, "") !== b.replace(/\s+/g, "");
}

// ADJUDICATED: corrected in the DATABASE, but the fixture here is stale.
//
// fixtures/staged holds a snapshot per paper, and export_staged.mjs refreshes
// only papers still in a v2.3 staged batch. A paper that has since been
// PUBLISHED keeps its old snapshot forever, so a defect corrected in
// shamo_mark_scheme_items still shows up here. Leaving it to re-raise every run
// is the noise trap this harness has been bitten by before -- a report that
// cries wolf gets skimmed -- so corrected published rows are listed and
// suppressed, with the correction named so the claim is checkable.
//
// Same convention as the ADJUDICATED lists in check_metadata_topics.mjs.
const ADJUDICATED = new Map([
  [
    "9709_2025_oct_nov_51|Q7",
    "Corrected in published content on 2026-08-12 by " +
      "database/shamo_v2_3_published_math_corrections.sql (content and guidance). " +
      "Verified live: 0 rows still hold the product. The fixture is a pre-publication " +
      "snapshot and cannot be refreshed by export_staged.mjs.",
  ],
]);

const findings = [];
const suppressed = [];
for (const file of fs.readdirSync(STAGED).filter((f) => f.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(STAGED, file), "utf8"));
  const bundle = data.paper_bundle ?? {};
  for (const question of bundle.questions ?? []) {
    const rows = [
      ...(question.mark_scheme_items ?? []).map((m) => ["", m]),
      ...(question.parts ?? []).flatMap((p) =>
        (p.mark_scheme_items ?? []).map((m) => [`(${(p.label_path ?? []).join(")(")})`, m]),
      ),
    ];
    for (const [label, row] of rows) {
      for (const field of ["content_markdown", "guidance_markdown"]) {
        const text = String(row[field] ?? "");
        JOINED.lastIndex = 0;
        for (const m of text.matchAll(JOINED)) {
          const [whole, left, , , operator, right] = m;
          const lv = evaluate(left);
          const rv = evaluate(right);
          if (lv === null || rv === null) continue;
          if (!writtenDifferently(left, right)) continue;

          // BOTH sides must be written fractions, and this restriction is
          // load-bearing rather than cautious. Requiring only one produced a
          // false positive on 9709/42 M/J 2024 Q7: `\frac{1}{2} \times 0.5` is
          // genuine multiplication -- s = 1/2 a t^2 with a = 0.5 -- where the
          // two operands are equal purely by coincidence. A decimal is a
          // measured quantity; a second literal fraction of integers written
          // differently from the first is a restatement, which is the shape
          // this check exists to find. Every confirmed defect is frac-op-frac.
          if (!/frac/.test(left) || !/frac/.test(right)) continue;
          // Equal to within rounding of a printed 3sf alternative.
          if (Math.abs(lv - rv) > 1e-6 * Math.max(1, Math.abs(lv))) continue;

          const adjudicationKey = `${data.paper_key}|Q${question.question_number}`;
          const target = ADJUDICATED.has(adjudicationKey) ? suppressed : findings;
          target.push({
            paper: data.paper_key,
            run: data.run_id,
            locus: `Q${question.question_number}${label} ${field.replace("_markdown", "")}`,
            expression: whole.replace(/\s+/g, " "),
            operator,
            value: lv,
            note: ADJUDICATED.get(adjudicationKey),
          });
        }
      }
    }
  }
}

console.log("\nOperators OCR replaced with the wrong symbol -- offline, no cost\n");

if (!findings.length) {
  console.log("  Clean. No operator joins two equal literal quantities.\n");
} else {
  const byPaper = new Map();
  for (const f of findings) {
    if (!byPaper.has(f.paper)) byPaper.set(f.paper, []);
    byPaper.get(f.paper).push(f);
  }
  for (const [paper, list] of [...byPaper].sort()) {
    console.log(`  ${paper}  (${list.length})`);
    for (const f of list) {
      console.log(`      ${f.locus}: ${f.expression}`);
      console.log(
        `         both sides = ${f.value.toPrecision(6)}, so "${f.operator}" cannot be an operator here`,
      );
      if (verbose) console.log(`         run ${f.run}`);
    }
  }
  console.log(
    `\n  ${findings.length} occurrence(s) across ${byPaper.size} paper(s).\n\n` +
      "  Each is a printed list separator -- almost always a comma -- stored as an\n" +
      "  operator. Confirm against the printed page, then correct the stored text.\n" +
      "  Marks are unaffected, so no other check sees these.\n",
  );
}

if (suppressed.length) {
  const papers = [...new Set(suppressed.map((f) => f.paper))];
  console.log(
    `  ${suppressed.length} further occurrence(s) across ${papers.length} paper(s) are ADJUDICATED\n` +
      "  -- already corrected in the database, stale only in the fixture:\n",
  );
  for (const paper of papers) {
    console.log(`    ${paper}`);
    console.log(`      ${suppressed.find((f) => f.paper === paper).note}`);
  }
  console.log("");
}

process.exitCode = findings.length ? 1 : 0;
