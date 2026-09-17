// Find Poisson/exponential series terms whose factorial the OCR dropped.
//
//   node workflows/n8n/harness/check_lost_factorials.mjs
//
// THE DEFECT
//
// Confirmed on 9709/61 O/N 2024 Q6(b). The printed mark scheme reads
//
//     e^-1.95 (1 + 1.95 + 1.95^2/2! + 1.95^3/3!)
//
// and the OCR stored
//
//     e^{-1.95}(1 + 1.95 + \frac{1.95^2}{2} + \frac{1.95^3}{3})
//
// Both factorials are gone. 2! = 2 so that term survives by luck; 3! = 6 does
// not, and 1.95^3/3 is 2.472 against a true 1.236.
//
// WHY IT IS DETECTABLE WITHOUT THE PDF
//
// The same cell usually prints the evaluated terms as an alternative, and here
// it lists 1.2358 -- which is 1.95^3/6, not /3. So the stored expression
// contradicts a number sitting beside it. That internal inconsistency is the
// signal, and it means this check needs no PDF text layer.
//
// The shape x^n / n for n >= 3 is essentially never a real series term: an
// exponential series has x^n / n!, and a bare x^3/3 would be an integration
// result that does not appear beside a lambda in a Poisson mark scheme. n = 2
// is deliberately excluded because 2! = 2 makes it indistinguishable and
// harmless.
//
// This is the class of corruption no other check sees: mark reconciliation
// passes (no marks change), prose fidelity passes (it is maths, not words), and
// the deterministic validator has no view of formula semantics. 9709/61 staged
// completely clean.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// TWO SOURCES, AND THE DISTINCTION IS THE POINT.
//
// The OCR pages are where the corruption ORIGINATES, and they are a historical
// record -- they are never rewritten, because what the provider returned is
// evidence. The staged bundle is what would actually be PUBLISHED, so it is the
// only thing that can block.
//
// Reporting only the OCR side would make this check permanent noise: once a
// paper is corrected the OCR still reads `/3` forever, the check keeps firing,
// and a reviewer learns to skim it. That is exactly how the spurious REORDERED
// verdict nearly cost this harness its credibility. So findings are split:
// OUTSTANDING (present in the staged bundle) versus CORRECTED DOWNSTREAM
// (present in OCR, already fixed in the bundle).
//
// Note the staged fixtures are a snapshot. After applying a correction, re-run
//     node workflows/n8n/harness/export_staged.mjs --batch v2.3-batch-NN
// or this check will keep reading the pre-correction bundle.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OCR = path.join(HERE, "fixtures", "ocr");
const STAGED = path.join(HERE, "fixtures", "staged");

// \frac{ <base> ^ <n> }{ <n> }   with optional braces around either exponent.
const FRAC_POWER = /\\frac\{([^{}]{1,16}?)\^\{?(\d)\}?\}\{(\d)\}/g;
// The inline form, e.g. 1.95^3/3
const INLINE_POWER = /([0-9.]{1,8})\^\{?(\d)\}?\s*\/\s*(\d)(?!\d|!)/g;

// THE SHAPE ALONE IS NOT ENOUGH, and a first version that assumed it was
// produced 36 findings across 14 papers of which essentially all were correct
// mathematics. x^3/3 is what integrating x^2 gives; 2t^3/3 likewise. Flagging
// every antiderivative as a lost factorial is the "108 findings on 138 rows"
// mistake this harness has already made once, and a check that noisy trains a
// reviewer to skim it.
//
// A Poisson or exponential series term lives inside e^{-lambda}( ... ). An
// integration result does not. Requiring that factor nearby is what separates
// the two, and it is the whole reason this check is worth running.
const SERIES_CONTEXT = /e\^\{?-/;
const CONTEXT_WINDOW = 160;

const verbose = process.argv.includes("--verbose");

function factorial(n) {
  let out = 1;
  for (let i = 2; i <= n; i += 1) out *= i;
  return out;
}

// Scan one blob of text and return every lost-factorial candidate in it.
function scan(text, where) {
  const out = [];
  for (const re of [FRAC_POWER, INLINE_POWER]) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const power = Number(match[2]);
      const denominator = Number(match[3]);
      if (power < 3 || power !== denominator) continue;

      // Must sit inside an exponential series, or it is an antiderivative.
      const from = Math.max(0, match.index - CONTEXT_WINDOW);
      const window = text.slice(from, match.index + match[0].length + CONTEXT_WINDOW);
      if (!SERIES_CONTEXT.test(window)) continue;

      // A symbolic base cannot be checked numerically and is far more likely to
      // be algebra than a series term.
      if (!Number.isFinite(Number(match[1]))) continue;

      out.push({
        ...where,
        expression: match[0],
        power,
        // What the term should evaluate to, so the reviewer can compare it
        // against any decimal printed in the same cell.
        asWritten: Number(match[1]) ** power / denominator,
        withFactorial: Number(match[1]) ** power / factorial(power),
      });
    }
  }
  return out;
}

function readJson(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
}

// ---- staged bundles: the publication gate -------------------------------
const staged = [];
for (const file of fs.readdirSync(STAGED).filter((f) => f.endsWith(".json"))) {
  const data = readJson(STAGED, file);
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
        staged.push(
          ...scan(String(row[field] ?? ""), {
            paper: data.paper_key,
            run: data.run_id,
            locus: `Q${question.question_number}${label} ${field.replace("_markdown", "")}`,
          }),
        );
      }
    }
  }
}

// ---- OCR pages: provenance ----------------------------------------------
const ocr = [];
for (const file of fs.readdirSync(OCR).filter((f) => f.endsWith(".json"))) {
  const data = readJson(OCR, file);
  for (const document of data.documents ?? []) {
    for (const page of document.pages ?? []) {
      ocr.push(
        ...scan(String(page.raw_markdown ?? page.markdown ?? ""), {
          paper: data.paper_key,
          run: data.ingestion_run_id,
          locus: `${document.document_type} p${page.page_number}`,
        }),
      );
    }
  }
}

function group(list) {
  const byPaper = new Map();
  for (const f of list) {
    if (!byPaper.has(f.paper)) byPaper.set(f.paper, []);
    byPaper.get(f.paper).push(f);
  }
  return [...byPaper].sort();
}

function print(list) {
  for (const [paper, items] of group(list)) {
    console.log(`  ${paper}  (${items.length})`);
    for (const f of items) {
      console.log(`      ${f.locus}: ${f.expression}`);
      console.log(
        `         as written = ${f.asWritten.toFixed(4)}   with ${f.power}! = ${f.withFactorial.toFixed(4)}`,
      );
      if (verbose) console.log(`         run ${f.run}`);
    }
  }
}

console.log("\nLost factorials -- x^n / n where n >= 3 inside e^-lambda(...), offline, no cost\n");

console.log("STAGED BUNDLES -- what would be published\n");
if (!staged.length) {
  console.log("  Clean. No lost factorial reaches publishable content.\n");
} else {
  print(staged);
  console.log(
    `\n  ${staged.length} OUTSTANDING occurrence(s) across ${group(staged).length} paper(s).\n` +
      "  Confirm against the printed page: compare the two values above with any\n" +
      "  decimal the same cell prints as an alternative. No other check sees this --\n" +
      "  marks still reconcile and prose still matches.\n",
  );
}

// Papers whose OCR carries the defect but whose bundle no longer does. Reported
// so the OCR record stays visible without being mistaken for outstanding work.
const stagedPapers = new Set(staged.map((f) => f.paper));
const correctedPapers = group(ocr)
  .map(([paper, items]) => [paper, items])
  .filter(([paper]) => !stagedPapers.has(paper));

console.log("OCR PAGES -- provenance, never rewritten\n");
if (!ocr.length) {
  console.log("  Clean across the OCR corpus.\n");
} else {
  print(ocr);
  if (correctedPapers.length) {
    console.log(
      `\n  Of these, ${correctedPapers.length} paper(s) are CORRECTED DOWNSTREAM -- the\n` +
        "  defect is in the OCR record but not in the staged bundle, so nothing is\n" +
        `  publishable from it: ${correctedPapers.map(([p]) => p).join(", ")}\n`,
    );
  }
  console.log("");
}

// Only publishable content can fail this check.
process.exitCode = staged.length ? 1 : 0;
