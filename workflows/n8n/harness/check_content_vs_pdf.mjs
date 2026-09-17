// Does every staged question and part actually appear in the printed paper?
//
// WHY
// ---
// This is the other half of source review, and the half that catches the worst
// defects seen so far:
//
//   dropped content   9709/62 Q2 lost an entire stem block (n = 30, Sigma x =
//                     610, Sigma x^2 = 12405), which made parts (b) and (c)
//                     unanswerable. Nothing noticed, because the mark rows all
//                     reconciled perfectly against a question that had been
//                     silently truncated.
//   invented content  9709/11 Q5 fabricated a stem by duplicating part (a);
//                     9709/11 Q10 invented a part label on an unparted question.
//
// Neither is visible to any internal check: the bundle is self-consistent. The
// only witness is the printed paper. This compares against the PDF text layer.
//
// METHOD
// ------
// Exact matching is hopeless -- PDF extraction reorders superscripts and drops
// fraction bars, and the staged text is LaTeX. So both sides are reduced to a
// bag of lowercase alphabetic words, maths and punctuation discarded, and the
// staged item is scored on how much of it the printed paper contains. Prose
// survives that reduction on both sides; mathematics does not, which is why
// this checks TEXT fidelity and the symbol check handles the maths.
//
// A staged item made mostly of mathematics has too few words to match on and is
// reported as `unverifiable` rather than passed, so the gap stays visible.
//
// Offline and free. Needs a run id or --batch.
//
//   node workflows/n8n/harness/check_content_vs_pdf.mjs --bundles <dir>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HARNESS, "fixtures");
const args = process.argv.slice(2);
const bundleDir = args.includes("--bundles")
  ? args[args.indexOf("--bundles") + 1]
  : path.join(FIXTURES, "staged");
const verbose = args.includes("--verbose");
const MIN_WORDS = 5;

/** Reduce either representation to comparable prose. */
function words(text) {
  let out = String(text ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Staged text is LaTeX; strip maths wholesale rather than try to render it.
    // All three delimiter styles appear in the real bundles -- missing the
    // `\( ... \)` form left `dy` and `dx` behind and reported them as invented.
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]*\$/g, " ")
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\\[A-Za-z]+/g, " ")
    .replace(/\*\*/g, " ");
  // Environment and argument names survive command stripping as bare words --
  // `\begin{pmatrix}` leaves "pmatrix", `\overrightarrow{OD}` leaves "od".
  for (let pass = 0; pass < 3; pass += 1) out = out.replace(/\{[^{}]*\}/g, " ");
  return out
    // PDF extraction glues words to numbers and splits them across lines.
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

/**
 * What fraction of the staged item's words occur anywhere in the printed paper?
 *
 * The first version of this looked for a contiguous word run and produced seven
 * findings that were all artefacts. PDF extraction interleaves the variable
 * letters INTO the prose -- `3(y + a)^2 + b` extracts as a bare `yab` sitting
 * between "form" and "where" -- while the staged LaTeX strips them entirely. So
 * the same sentence yields two different word SEQUENCES from the two sources,
 * and contiguity can never hold.
 *
 * Set coverage is immune to that: order and interleaving stop mattering, and a
 * word the staged text has but the paper does not is exactly the signal wanted.
 *
 * SCOPE. This detects INVENTED text (staged content absent from the source) --
 * the 9709/11 Q5 fabricated stem class. It cannot detect DROPPED text, because
 * a question that is missing a block simply has fewer words to check and every
 * one of them still matches. That needs question-region alignment and is not
 * built; 9709/62 Q2's lost stem would still slip through here.
 */
function coverage(haystackSet, needleWords) {
  if (needleWords.length < MIN_WORDS) return { status: "unverifiable", absent: [] };
  const absent = needleWords.filter((word) => !haystackSet.has(word));
  const ratio = 1 - absent.length / needleWords.length;
  // One stray word is normal -- hyphenation and line-break artefacts. A quarter
  // of the sentence missing is not.
  if (ratio >= 0.8) return { status: "found", absent };
  return { status: "missing", absent: [...new Set(absent)] };
}

/**
 * The mark sequence the question paper prints.
 *
 * Every assessable part ends with its mark allocation in square brackets, in
 * reading order. That gives an independent, ordered, exact ground truth for the
 * paper's structure -- and it is the only check here that can see DROPPED
 * content, because a lost part removes an entry from the staged sequence while
 * the printed one still has it.
 *
 * On 9709/62 this yields 16 values summing to 50; on 9709/11, 23 summing to 75.
 */
function printedMarkSequence(pages) {
  const text = pages.map((p) => p.text).join("\n");
  return [...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
}

/**
 * The equivalent sequence from the staged bundle.
 *
 * An unparted question prints one allocation and stages as a question with no
 * parts, so its own total stands in for a leaf part. A labelled parent that
 * only supplies shared context carries no marks and must not contribute.
 */
function stagedMarkSequence(bundle) {
  const sequence = [];
  for (const question of bundle?.questions ?? []) {
    const parts = (question.parts ?? []).filter((p) => p.marks !== null && p.marks !== undefined);
    if (parts.length === 0) {
      if (question.total_marks) sequence.push(Number(question.total_marks));
      continue;
    }
    // Do NOT sort by sort_order. It is scoped PER NESTING LEVEL, not globally
    // within the question, so a flat sort interleaves children with their
    // siblings and invents a reordering that is not in the data:
    //
    //   Q1 parts   (a)  (b)  (b)(i)  (b)(ii)
    //   sort_order  1    2     1        2
    //   flat sort: (a) (b)(i) (b) (b)(ii)   <-- wrong
    //
    // That produced a REORDERED verdict on 9709/12 O/N 2024 whose staged
    // sequence is in fact identical to the printed one, position for position.
    // The bundle already arrives in document order because the extraction walks
    // the paper top to bottom, so preserving that order is both correct and the
    // smallest change. A false REORDERED is worse than no check: this is the
    // report a reviewer is meant to trust for dropped or misplaced parts, and
    // one spurious flag is enough to teach them to skim it.
    for (const part of parts) {
      sequence.push(Number(part.marks));
    }
  }
  return sequence;
}

// ---------------------------------------------------------------------------
function loadPdfText() {
  const dir = path.join(FIXTURES, "pdf_text");
  const byPaper = new Map();
  if (!fs.existsSync(dir)) return byPaper;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const qp = data.documents.find((d) => d.document_type === "question_paper");
    byPaper.set(data.paper_key, {
      words: new Set(words((qp?.pages ?? []).map((p) => p.text).join("\n"))),
      marks: printedMarkSequence(qp?.pages ?? []),
    });
  }
  return byPaper;
}

const pdfWords = loadPdfText();
if (!pdfWords.size) {
  console.error("No PDF text fixtures. Run extract_pdf_text.py first.");
  process.exit(1);
}
if (!fs.existsSync(bundleDir)) {
  console.error(`No staged bundles at ${bundleDir}. Export them first.`);
  process.exit(1);
}

const findings = [];
const rows = [];

for (const file of fs.readdirSync(bundleDir).filter((f) => f.endsWith(".json")).sort()) {
  const staged = JSON.parse(fs.readFileSync(path.join(bundleDir, file), "utf8"));
  const haystack = pdfWords.get(staged.paper_key);
  if (!haystack) {
    console.log(`  no PDF text for ${staged.paper_key} -- skipped`);
    continue;
  }

  let checked = 0;
  let missing = 0;
  let unverifiable = 0;

  for (const question of staged.paper_bundle?.questions ?? []) {
    const targets = [
      { label: "stem", text: question.stem_markdown },
      ...(question.parts ?? []).map((part) => ({
        label: `(${(part.label_path ?? []).join(")(")})`,
        text: part.prompt_markdown,
      })),
    ];
    for (const target of targets) {
      if (!String(target.text ?? "").trim()) continue;
      checked += 1;
      const result = coverage(haystack.words, words(target.text));
      if (result.status === "unverifiable") {
        unverifiable += 1;
        continue;
      }
      if (result.status === "missing") {
        missing += 1;
        findings.push({
          paper: staged.paper_key,
          question: question.question_number,
          label: target.label,
          excerpt: String(target.text).replace(/\s+/g, " ").slice(0, 80),
          absent: result.absent.slice(0, 8).join(", "),
        });
      }
    }
  }
  const printed = haystack.marks;
  const stagedMarks = stagedMarkSequence(staged.paper_bundle);
  rows.push({
    paper: staged.paper_key,
    checked,
    missing,
    unverifiable,
    printedCount: printed.length,
    stagedCount: stagedMarks.length,
    printedSum: printed.reduce((a, b) => a + b, 0),
    stagedSum: stagedMarks.reduce((a, b) => a + b, 0),
    sequenceMatches: JSON.stringify(printed) === JSON.stringify(stagedMarks),
  });
}

console.log("\nStaged content vs PDF text layer -- prose fidelity, offline, no cost\n");
console.log("paper                          checked   not found   maths-only");
console.log("-".repeat(62));
for (const row of rows) {
  console.log(
    row.paper.padEnd(31) +
      String(row.checked).padStart(7) +
      String(row.missing).padStart(12) +
      String(row.unverifiable).padStart(13),
  );
}
console.log("-".repeat(62));
const totals = rows.reduce(
  (a, r) => ({
    checked: a.checked + r.checked,
    missing: a.missing + r.missing,
    unverifiable: a.unverifiable + r.unverifiable,
  }),
  { checked: 0, missing: 0, unverifiable: 0 },
);
console.log(
  "TOTAL".padEnd(31) +
    String(totals.checked).padStart(7) +
    String(totals.missing).padStart(12) +
    String(totals.unverifiable).padStart(13),
);

const shown = verbose ? findings : findings.slice(0, 25);
if (shown.length) {
  console.log(`\nSTAGED TEXT NOT FOUND IN THE PRINTED PAPER (${shown.length} of ${findings.length}):\n`);
  for (const finding of shown) {
    console.log(`  ${finding.paper}  Q${finding.question} ${finding.label}`);
    console.log(`      ${finding.excerpt}`);
    console.log(`      words not in the printed paper: ${finding.absent}`);
  }
}

console.log("\nPrinted mark allocations vs staged parts -- catches DROPPED content\n");
console.log("paper                          printed      staged   sum      order");
console.log("-".repeat(66));
let structureFailures = 0;
for (const row of rows) {
  const countOk = row.printedCount === row.stagedCount;
  const sumOk = row.printedSum === row.stagedSum;
  if (!countOk || !sumOk || !row.sequenceMatches) structureFailures += 1;
  console.log(
    row.paper.padEnd(31) +
      `${row.printedCount}`.padStart(7) +
      `${row.stagedCount}`.padStart(12) +
      `${row.printedSum}/${row.stagedSum}`.padStart(8) +
      (row.sequenceMatches ? "  exact" : countOk && sumOk ? "  REORDERED" : "  MISMATCH"),
  );
}
console.log("-".repeat(66));
console.log(`${structureFailures} paper(s) disagree with the printed mark allocations.`);

console.log(
  `\n${totals.unverifiable} items were too mathematical to check as prose -- they are NOT passes.\n` +
    "The symbol check covers the maths; this covers the words.\n",
);
process.exitCode = totals.missing > 0 || structureFailures > 0 ? 1 : 0;
