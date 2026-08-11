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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OCR = path.join(HERE, "fixtures", "ocr");

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

const findings = [];
for (const file of fs.readdirSync(OCR).filter((f) => f.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(OCR, file), "utf8"));
  for (const document of data.documents ?? []) {
    for (const page of document.pages ?? []) {
      const text = page.raw_markdown ?? page.markdown ?? "";
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

          // A symbolic base cannot be checked numerically and is far more
          // likely to be algebra than a series term.
          if (!Number.isFinite(Number(match[1]))) continue;
          findings.push({
            paper: data.paper_key,
            run: data.ingestion_run_id,
            document: document.document_type,
            page: page.page_number,
            expression: match[0],
            base: match[1],
            power,
            // What the term should evaluate to, so the reviewer can compare it
            // against any decimal printed in the same cell.
            asWritten: Number(match[1]) ** power / denominator,
            withFactorial: Number(match[1]) ** power / factorial(power),
          });
        }
      }
    }
  }
}

function factorial(n) {
  let out = 1;
  for (let i = 2; i <= n; i += 1) out *= i;
  return out;
}

console.log("\nLost factorials in OCR -- x^n / n where n >= 3, offline, no cost\n");

if (!findings.length) {
  console.log("None found across the OCR corpus.\n");
  process.exitCode = 0;
} else {
  const byPaper = new Map();
  for (const f of findings) {
    if (!byPaper.has(f.paper)) byPaper.set(f.paper, []);
    byPaper.get(f.paper).push(f);
  }
  for (const [paper, list] of [...byPaper].sort()) {
    console.log(`  ${paper}  (${list.length})`);
    for (const f of list) {
      console.log(`      ${f.document} p${f.page}: ${f.expression}`);
      console.log(
        `         as written = ${f.asWritten.toFixed(4)}   with ${f.power}! = ${f.withFactorial.toFixed(4)}`,
      );
      if (verbose) console.log(`         run ${f.run}`);
    }
  }
  console.log(
    `\n${findings.length} occurrence(s) across ${byPaper.size} paper(s).\n\n` +
      "Each is a CANDIDATE. Confirm against the printed page: compare the two\n" +
      "values above with any decimal the same cell prints as an alternative.\n" +
      "No other check sees this -- marks still reconcile and prose still matches.\n",
  );
  process.exitCode = 1;
}
