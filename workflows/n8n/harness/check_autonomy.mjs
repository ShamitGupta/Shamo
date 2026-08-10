// How many papers would stop and wait for a human?
//
// This is the question the project actually needs answered before ingesting at
// volume, and until now it was only answerable in arrears, one batch at a time,
// by running a paid batch and counting. Papers arriving clean went 6 of 6, then
// 5 of 6, then 4 of 6 across batches 2 to 4 -- a trend, but each batch was a
// different set of papers, so it was never a controlled comparison.
//
// This replays EVERY staged paper in the corpus through the CURRENT generated
// validator and counts what still blocks. Same papers, same OCR, one code
// version: a controlled measurement, offline and free.
//
// WHAT IT IS NOT
// --------------
// It is not a prediction for unseen papers. Every fix in the pipeline was
// written with these papers in view, so this measures "would the defects we
// have already met still stop us", not "will the next batch be clean". The
// honest use is as a regression floor: it must not get worse.
//
//   node workflows/n8n/harness/check_autonomy.mjs [--verbose]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMarkSchemeResults } from "../lib/mark_scheme_parser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OCR = path.join(HERE, "fixtures", "ocr");
const STAGED = path.join(HERE, "fixtures", "staged");
const WORKFLOW = path.join(HERE, "..", "shamo_budget_v2_1_stage_one_math_paper.json");
const verbose = process.argv.includes("--verbose");

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const workflow = readJson(WORKFLOW);
const validationCode = workflow.nodes.find(
  (n) => n.name === "Deterministic Validation",
)?.parameters?.jsCode;
if (!validationCode) throw new Error("Deterministic Validation node not found.");

const ocrFiles = fs.readdirSync(OCR);

function buildState(staged) {
  const ocrFile = ocrFiles.find((f) => f.includes(staged.run_id));
  if (!ocrFile) return null;
  const ocr = readJson(path.join(OCR, ocrFile));

  const compact = ocr.documents.map((d) => ({
    document_type: d.document_type,
    page_count: d.pages.length,
    pages: d.pages.map((p) => ({
      page_number: p.page_number,
      markdown: p.raw_markdown || "",
      images: [],
    })),
  }));

  // Re-parse the mark scheme, because the staged rows came from whichever
  // parser version was live when the paper ran. Measuring those would compare
  // today's validator against yesterday's parser and attribute fixed defects to
  // the current code.
  const msPages = ocr.documents
    .find((d) => d.document_type === "mark_scheme")
    ?.pages.map((p) => ({ page_number: p.page_number, markdown: p.raw_markdown || "" }));
  const numbers = staged.paper_bundle.questions.map((q) => Number(q.question_number));
  const reparsed = msPages
    ? new Map(
        buildMarkSchemeResults(msPages, numbers).map((r) => [Number(r.question_number), r]),
      )
    : new Map();

  const bundle = {
    ...staged.paper_bundle,
    questions: staged.paper_bundle.questions.map((q) => {
      const r = reparsed.get(Number(q.question_number));
      return r && (r.mark_scheme_items || []).length
        ? { ...q, mark_scheme_items: r.mark_scheme_items }
        : q;
    }),
  };

  return {
    paper_bundle: bundle,
    compact_documents: compact,
    known_documents: compact.map((d) => ({
      document_type: d.document_type,
      page_count: d.page_count,
    })),
    ocr_documents: ocr.documents.map((d) => ({
      document: { document_type: d.document_type },
      pages: d.pages.map((p) => ({
        index: p.page_number - 1,
        images: (p.raw_markdown.match(/!\[[^\]]*\]\([^)]*\)/g) || []).map(() => ({
          image_base64: "data:image/jpeg;base64,AA==",
        })),
      })),
    })),
    paper_summary: {},
    api_events: [],
    repair_applied: false,
  };
}

// SCOPE, and it is deliberately narrow.
//
// Only the papers in `staged/` -- the twelve from batches 3 and 4, all produced
// by the current v2.2 child. Widening to `bundles/` was tried and rejected: it
// pulls in superseded budget-v1 runs whose defects belong to a pipeline that no
// longer exists (9709/52 F/M alone raises 87 blockers under v1), and batch-2
// bundles staged before the 9709-v3 taxonomy, which raise
// MAIN_TOPIC_NOT_IN_VOCABULARY for rows already re-classified in the database
// months later. Both would inflate the failure count with history rather than
// measuring today's pipeline, and the resulting "52% clean" headline would be
// simply wrong.
//
// Twelve papers is a small denominator. That is a real limit on how much weight
// this number carries, and it is better than a large misleading one.
const candidates = new Map();
for (const file of fs.readdirSync(STAGED)) {
  const raw = readJson(path.join(STAGED, file));
  if (!raw.paper_key.includes("-h")) candidates.set(raw.paper_key, { payload: raw });
}

const rows = [];
const byCode = new Map();

for (const { payload: staged } of candidates.values()) {
  if (!staged.paper_bundle?.questions) continue;
  const state = buildState(staged);
  if (!state) continue;

  const run = new Function("$input", "$", validationCode);
  const report = run(
    { first: () => ({ json: state }) },
    () => ({ first: () => ({ json: state }) }),
  )[0].json.validation_report;

  const blocking = report.issues.filter((i) => i.severity === "blocking");
  for (const issue of blocking) {
    byCode.set(issue.issue_code, (byCode.get(issue.issue_code) ?? 0) + 1);
  }
  rows.push({
    paper: staged.paper_key,
    blocking: blocking.length,
    warnings: report.issues.length - blocking.length,
    codes: [...new Set(blocking.map((i) => i.issue_code))],
  });
}

rows.sort((a, b) => b.blocking - a.blocking || a.paper.localeCompare(b.paper));
const clean = rows.filter((r) => r.blocking === 0);

console.log("=== Would this paper stop and wait for a human? ===\n");
console.log(`  papers replayed                    ${rows.length}`);
console.log(`  would stage clean                  ${clean.length}`);
console.log(`  would need a human                 ${rows.length - clean.length}`);
console.log(
  `  clean rate                         ${((clean.length / rows.length) * 100).toFixed(0)}%\n`,
);

if (byCode.size) {
  console.log("  blocking issues by code:");
  for (const [code, n] of [...byCode].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}x  ${code}`);
  }
  console.log();
}

const blocked = rows.filter((r) => r.blocking > 0);
if (blocked.length) {
  console.log("  papers that would still stop:");
  for (const r of blocked) {
    console.log(`    ${r.paper.padEnd(28)} ${r.blocking} blocking  ${r.codes.join(", ")}`);
  }
  console.log();
}

if (verbose) {
  console.log("  every paper:");
  for (const r of rows) {
    console.log(
      `    ${r.paper.padEnd(28)} ${String(r.blocking).padStart(2)} blocking  ` +
        `${String(r.warnings).padStart(2)} warnings`,
    );
  }
  console.log();
}

console.log(
  "Read this as a regression floor, not a forecast. Every fix in the pipeline\n" +
    "was written with these papers in view, so it measures whether defects we\n" +
    "have already met would still stop a batch -- not whether the next six will\n" +
    "be clean. The number to watch is that it never falls.\n",
);
