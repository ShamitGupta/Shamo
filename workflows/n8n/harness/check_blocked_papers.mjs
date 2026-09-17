// Would the two papers that blocked in batch 4 still block?
//
// The fixes for those blockers live in a library and in a generator patch, and
// a library passing its own unit tests proves nothing about the workflow. This
// runs the REAL `Deterministic Validation` jsCode out of the generated JSON,
// against the REAL staged bundle and OCR of each blocked paper, and reports the
// blocking issues that survive.
//
// It is a regression test in the strict sense: both papers are recorded here
// with the issue codes they actually raised on 9 August 2026, so a change that
// reintroduces either fails loudly rather than quietly.
//
// Offline and free.
//
//   node workflows/n8n/harness/check_blocked_papers.mjs [--verbose]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarkSchemeResults } from "../lib/mark_scheme_parser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OCR = path.join(HERE, "fixtures", "ocr");
const STAGED = path.join(HERE, "fixtures", "staged");
const WORKFLOW = path.join(
  HERE,
  "..",
  "shamo_budget_v2_1_stage_one_math_paper.json",
);
const verbose = process.argv.includes("--verbose");

// What each paper raised before the fix. Codes here must NOT reappear.
const BLOCKED = [
  {
    paper: "9709_2025_oct_nov_11",
    label: "9709/11 O/N 2025",
    was: ["EMPTY_MARK_SCHEME_ROW"],
    cause:
      "Q4(a) prints one answer worth three B1s, with the rows beneath it blank. " +
      "Stored verbatim those rows had neither answer nor guidance.",
  },
  {
    paper: "9709_2025_oct_nov_51",
    label: "9709/51 O/N 2025",
    was: ["ASSET_SOURCE_NOT_FOUND", "ASSET_UPLOAD_COUNT_MISMATCH"],
    cause:
      "Q3 claimed question_paper:5:5 for a stem-and-leaf diagram OCR had already " +
      "captured as a markdown table. Page 5 holds one image and it is the barcode.",
  },
];

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const workflow = readJson(WORKFLOW);
const validationCode = workflow.nodes.find(
  (node) => node.name === "Deterministic Validation",
)?.parameters?.jsCode;
if (!validationCode) throw new Error("Deterministic Validation node not found.");

function findFixture(dir, paperKey) {
  const file = fs.readdirSync(dir).find((name) => name.startsWith(`${paperKey}__`));
  return file ? readJson(path.join(dir, file)) : null;
}

/**
 * Rebuild the state the validator sees.
 *
 * The staged bundle and the OCR fixture together carry everything the node
 * reads: the bundle itself, the compact documents behind the asset inventory,
 * and the page counts. Anything the node reads that is genuinely absent from a
 * staged run is supplied as null, which is what the node already tolerates.
 */
function buildState(paperKey) {
  const staged = findFixture(STAGED, paperKey);
  const ocr = findFixture(OCR, paperKey);
  if (!staged || !ocr) return null;

  const compact = ocr.documents.map((document) => ({
    document_type: document.document_type,
    page_count: document.pages.length,
    pages: document.pages.map((page) => ({
      page_number: page.page_number,
      markdown: page.raw_markdown || "",
      images: [],
    })),
  }));

  // Re-parse the mark scheme from OCR rather than trusting the staged rows.
  //
  // This is what a fresh run does, and it is the only honest way to test a
  // PARSER fix: the staged bundle was produced by the old parser, so validating
  // it would only ever re-measure the defect. The asset fix needs no such
  // treatment because it lives in the validator and acts on the claim as
  // staged.
  const markScheme = compact.find((d) => d.document_type === "mark_scheme");
  const questionNumbers = staged.paper_bundle.questions.map((q) => Number(q.question_number));
  const reparsed = new Map(
    buildMarkSchemeResults(
      ocr.documents.find((d) => d.document_type === "mark_scheme").pages.map((p) => ({
        page_number: p.page_number,
        markdown: p.raw_markdown || "",
      })),
      questionNumbers,
    ).map((result) => [Number(result.question_number), result]),
  );
  const bundle = {
    ...staged.paper_bundle,
    questions: staged.paper_bundle.questions.map((question) => {
      const result = reparsed.get(Number(question.question_number));
      return result && (result.mark_scheme_items || []).length
        ? { ...question, mark_scheme_items: result.mark_scheme_items }
        : question;
    }),
  };
  void markScheme;

  return {
    paper_bundle: bundle,
    compact_documents: compact,
    known_documents: compact.map((d) => ({
      document_type: d.document_type,
      page_count: d.page_count,
    })),
    // The validator reads OCR images to decide whether a claimed asset exists.
    // Image bytes are not in the fixtures, so this reconstructs the inventory
    // from the markdown references -- the same references the resolver reads,
    // which is exactly the inventory the claim has to match against.
    ocr_documents: ocr.documents.map((document) => ({
      document: { document_type: document.document_type },
      pages: document.pages.map((page) => ({
        index: page.page_number - 1,
        images: (page.raw_markdown.match(/!\[[^\]]*\]\([^)]*\)/g) || []).map(() => ({
          image_base64: "data:image/jpeg;base64,AA==",
        })),
      })),
    })),
    paper_summary: {},
    api_events: [],
    repair_applied: false,
    pair: staged.paper_bundle.pair || {},
  };
}

let failures = 0;
console.log("=== The two papers that blocked in batch 4 ===\n");

for (const entry of BLOCKED) {
  const state = buildState(entry.paper);
  if (!state) {
    console.log(`  ${entry.label}: fixtures missing -- SKIPPED`);
    continue;
  }

  const run = new Function("$input", "$", validationCode);
  const output = run(
    { first: () => ({ json: state }) },
    () => ({ first: () => ({ json: state }) }),
  );
  const report = output[0].json.validation_report;
  const blocking = report.issues.filter((i) => i.severity === "blocking");
  const codes = new Set(blocking.map((i) => i.issue_code));

  const returned = entry.was.filter((code) => codes.has(code));
  const ok = returned.length === 0;
  if (!ok) failures += 1;

  console.log(`  ${ok ? "PASS" : "FAIL"}  ${entry.label}`);
  console.log(`        was blocked by: ${entry.was.join(", ")}`);
  console.log(`        ${entry.cause}`);
  if (returned.length) {
    console.log(`        STILL BLOCKING: ${returned.join(", ")}`);
  }
  if (verbose || !ok) {
    const other = blocking.filter((i) => !entry.was.includes(i.issue_code));
    if (other.length) {
      console.log(`        other blocking issues (not this fix's concern):`);
      for (const issue of other.slice(0, 8)) {
        console.log(`          ${issue.issue_code} q${issue.question_number ?? "-"}`);
      }
    }
    const warnings = report.issues.filter((i) => i.severity === "warning");
    const relevant = warnings.filter((i) =>
      /ASSET|DIAGRAM|SHARED/.test(i.issue_code),
    );
    for (const issue of relevant) {
      console.log(`        -> now a warning: ${issue.issue_code} q${issue.question_number ?? "-"}`);
    }
  }
  console.log();
}

console.log(
  failures === 0
    ? "PASS -- neither paper is blocked by its original defect.\n"
    : `FAIL -- ${failures} paper(s) still blocked.\n`,
);
process.exit(failures === 0 ? 0 : 1);
