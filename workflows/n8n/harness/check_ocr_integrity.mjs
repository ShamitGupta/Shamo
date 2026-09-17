// Measure the OCR corruption rate across the whole stored corpus.
//
// WHY
// ---
// Some defects are not extraction failures at all: the information was already
// wrong when Mistral handed it over. 9709/62 alone showed `2!` read as `2^2`,
// `÷` read as `+`, and `5.5^5` read as `5.5^4`. No parser or validator change
// can reach those, so they are the floor on achievable accuracy -- and the
// reason sampled human review cannot go to zero.
//
// One paper is an anecdote. This measures all 13 so the rate can inform whether
// ingesting hundreds more papers is sensible.
//
// Reads local fixtures only. No network, no cost, no database.
//
//   node workflows/n8n/harness/check_ocr_integrity.mjs
//   node workflows/n8n/harness/check_ocr_integrity.mjs --samples 40
//
// EVERY CHECK HERE IS A HEURISTIC. A flag is a candidate, not a confirmed
// defect. The output reports flags and requires a hand-verified sample before
// any rate is quoted as real.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const args = process.argv.slice(2);
const SAMPLE_LIMIT = args.includes("--samples") ? Number(args[args.indexOf("--samples") + 1]) : 12;

// ---------------------------------------------------------------------------
// Check 1: factorial read as a power
// ---------------------------------------------------------------------------
// Cambridge prints Poisson and binomial series as x^k / k!. Mistral sometimes
// renders the `!` as a repeat of the base, giving k^k. A denominator whose base
// equals its exponent is almost never real mathematics -- 2^2, 3^3, 5^5 in a
// divisor position are the signature.
function findFactorialAsPower(text) {
  const hits = [];
  const patterns = [
    /\\frac\{[^{}]{1,40}\}\{(\d{1,2})\^\{?\1\}?\}/g, // \frac{x^3}{3^3}
    /\/\s*(\d{1,2})\^\{?\1\}?(?![\d])/g, // ... / 3^3
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      // k^k is legitimate for k=1 and visually plausible for large numbers in
      // other contexts; the factorial confusion is overwhelmingly 2..9.
      const k = Number(match[1]);
      if (k >= 2 && k <= 9) hits.push({ excerpt: match[0], suspected: `${k}!` });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Check 2: follow-through quote mangled
// ---------------------------------------------------------------------------
// Cambridge wraps follow-through values in quotes: Phi('0.457'). Mistral
// sometimes turns the opening quote into \cdot, which renders as multiplication
// and silently changes the meaning.
function findMangledQuotes(text) {
  const hits = [];
  for (const match of text.matchAll(/\(\s*\\cdot\s*[\d.]+\s*['’]/g)) {
    hits.push({ excerpt: match[0], suspected: "opening follow-through quote" });
  }
  // An odd number of follow-through quotes on a line means one was lost.
  for (const line of text.split(/\r?\n/)) {
    const quotes = (line.match(/['’](?=[\d.])|(?<=[\d.])['’]/g) ?? []).length;
    if (quotes % 2 === 1 && /FT|follow/i.test(line)) {
      hits.push({ excerpt: line.replace(/\s+/g, " ").slice(0, 70), suspected: "unbalanced FT quotes" });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Check 3: numeric self-consistency
// ---------------------------------------------------------------------------
// The strongest signal available. Mark schemes routinely print an expression
// AND its evaluated value: `\pm \frac{150.5-145}{\sqrt{145}}$$ [= $$\pm 0.457`.
// Evaluate the expression and compare. A mismatch means one of the two was
// corrupted -- which is exactly the class no other check can see.
function latexToJs(latex) {
  let s = latex;
  // Only a restricted, safe subset is convertible. Anything with a symbol,
  // function or unresolved macro is rejected below.
  s = s.replace(/\\left|\\right|\\,|\\;|\\!|\s/g, "");
  s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "(($1)/($2))");
  s = s.replace(/\\sqrt\{([^{}]+)\}/g, "Math.sqrt($1)");
  s = s.replace(/\\sqrt(\d+)/g, "Math.sqrt($1)");
  s = s.replace(/\\times/g, "*").replace(/\\div/g, "/").replace(/\\cdot/g, "*");
  s = s.replace(/\^\{([^{}]+)\}/g, "**($1)").replace(/\^(-?\d+(?:\.\d+)?)/g, "**($1)");
  s = s.replace(/\{/g, "(").replace(/\}/g, ")");
  return s;
}

function safeEval(expression) {
  // Reject anything that is not pure arithmetic. No identifiers survive except
  // the Math.sqrt we introduced ourselves.
  const stripped = expression.replace(/Math\.sqrt/g, "");
  if (/[A-Za-z\\]/.test(stripped)) return null;
  if (!/[\d]/.test(stripped)) return null;
  try {
    const value = Function(`"use strict";return (${expression});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function findNumericInconsistency(text) {
  const hits = [];
  // Work cell by cell, then segment by segment. The first version captured
  // non-greedily and produced only false positives: given `3000\sqrt{3} =
  // 5196.15` it grabbed `\sqrt{3}` alone, dropped the coefficient, and reported
  // a mismatch that was purely its own doing. Capture the WHOLE left-hand side
  // and reject anything containing a symbol.
  for (const line of text.split(/\r?\n/)) {
    for (const cell of line.split("|")) {
      // A cell may chain several steps: `a = b = c`. Compare each adjacent pair.
      const segments = cell
        .split(/=/)
        .map((part) => part.replace(/\$\$|\[|\]|\\pm|±|\\approx|~/g, "").trim())
        .filter(Boolean);
      if (segments.length < 2) continue;

      for (let i = 0; i < segments.length - 1; i += 1) {
        const left = segments[i];
        const right = segments[i + 1];
        // Right-hand side must be a bare number, otherwise there is nothing to
        // check against.
        if (!/^-?\d+(?:\.\d+)?$/.test(right)) continue;
        // Left-hand side must contain an operator, or there is no arithmetic.
        if (!/[+\-*/^]|\\frac|\\sqrt|\\times|\\div/.test(left)) continue;
        const computed = safeEval(latexToJs(left));
        if (computed === null) continue;

        const stated = Number(right);
        const a = Math.abs(computed);
        const b = Math.abs(stated);
        if (a === 0 && b === 0) continue;
        // Mark schemes round heavily and often quote to 3 significant figures,
        // so only a clear disagreement is worth a flag.
        const relative = Math.abs(a - b) / Math.max(a, b, 1e-9);
        if (relative > 0.02) {
          hits.push({
            excerpt: `${left.replace(/\s+/g, " ").slice(0, 56)} = ${stated}`,
            suspected: `evaluates to ${computed.toPrecision(4)}`,
          });
        }
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const CHECKS = [
  { name: "factorial read as power", fn: findFactorialAsPower },
  { name: "follow-through quote mangled", fn: findMangledQuotes },
  { name: "numeric self-inconsistency", fn: findNumericInconsistency },
];

const files = fs
  .readdirSync(path.join(FIXTURES, "ocr"))
  .filter((f) => f.endsWith(".json"))
  .sort();

// One run per paper, preferring the newest, so the same paper is not counted
// twice through its superseded v1/diagnostic runs.
const byPaper = new Map();
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, "ocr", file), "utf8"));
  const existing = byPaper.get(data.paper_key);
  if (!existing || file > existing.file) byPaper.set(data.paper_key, { file, data });
}

const rows = [];
const samples = [];
let totalPages = 0;

for (const [paperKey, { data }] of [...byPaper.entries()].sort()) {
  const counts = Object.fromEntries(CHECKS.map((c) => [c.name, 0]));
  let pages = 0;
  for (const document of data.documents) {
    for (const page of document.pages) {
      pages += 1;
      for (const check of CHECKS) {
        for (const hit of check.fn(page.raw_markdown ?? "")) {
          counts[check.name] += 1;
          if (samples.length < SAMPLE_LIMIT * CHECKS.length) {
            samples.push({
              paper: paperKey,
              document: document.document_type,
              page: page.page_number,
              check: check.name,
              ...hit,
            });
          }
        }
      }
    }
  }
  totalPages += pages;
  rows.push({ paperKey, pages, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
}

console.log("\nOCR integrity scan - all stored papers, local fixtures only, no cost\n");
console.log("paper                        pages   fact^pow   FT-quote   numeric   total");
console.log("-".repeat(78));
for (const row of rows) {
  console.log(
    row.paperKey.padEnd(29) +
      String(row.pages).padStart(5) +
      String(row.counts["factorial read as power"]).padStart(11) +
      String(row.counts["follow-through quote mangled"]).padStart(11) +
      String(row.counts["numeric self-inconsistency"]).padStart(10) +
      String(row.total).padStart(8),
  );
}
console.log("-".repeat(78));
const totals = CHECKS.map((c) => rows.reduce((sum, r) => sum + r.counts[c.name], 0));
console.log(
  "TOTAL".padEnd(29) +
    String(totalPages).padStart(5) +
    String(totals[0]).padStart(11) +
    String(totals[1]).padStart(11) +
    String(totals[2]).padStart(10) +
    String(totals.reduce((a, b) => a + b, 0)).padStart(8),
);

console.log(`\nFlags per paper: ${(totals.reduce((a, b) => a + b, 0) / rows.length).toFixed(1)} across ${rows.length} papers.`);
console.log("\nThese are HEURISTIC flags, not confirmed defects. Hand-verify the");
console.log("samples below against the printed papers before quoting a rate.\n");

for (const check of CHECKS) {
  const forCheck = samples.filter((s) => s.check === check.name).slice(0, SAMPLE_LIMIT);
  if (!forCheck.length) continue;
  console.log(`--- ${check.name} (${forCheck.length} shown) ---`);
  for (const sample of forCheck) {
    console.log(`  ${sample.paper} ${sample.document.slice(0, 2)} p${sample.page}`);
    console.log(`    ${sample.excerpt}`);
    console.log(`    -> ${sample.suspected}`);
  }
  console.log("");
}
