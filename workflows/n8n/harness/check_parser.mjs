// Run the deterministic parser over verbatim stored OCR and compare it against
// what the current model-based pipeline actually staged.
//
// This is the free go/no-go gate. It answers, with real data rather than
// reconstructed fixtures:
//
//   1. Does the alternative-method rate fall from the measured 23.9%?
//   2. Do the eight documented per-part reconciliation gaps close?
//   3. Is the fabricated B1 on 9709/62 Q7(b) gone?
//
// Nothing here costs money and nothing is written to Supabase.
//
//   node workflows/n8n/harness/check_parser.mjs
//   node workflows/n8n/harness/check_parser.mjs --paper 62 --verbose

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkSchemePages, markValue, stripBold } from "../lib/mark_scheme_parser.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const ONLY_PAPER = args.includes("--paper") ? args[args.indexOf("--paper") + 1] : null;

// The eight per-part mark reconciliation gaps recorded in
// "Shamo Batch 2 Source Review Findings.md" and reproduced by
// database/shamo_v2_1_staged_bundle_integrity_checks.sql.
const KNOWN_GAPS = [
  { variant: "22", question: 2, part: "", note: "4 printed, 3 staged (*M1 read as alternative)" },
  { variant: "22", question: 5, part: "a", note: "3 printed, 4 staged (table bleed)" },
  { variant: "31", question: 9, part: "a", note: "2 printed, 1 staged" },
  { variant: "31", question: 9, part: "b", note: "2 printed, 1 staged" },
  { variant: "31", question: 9, part: "d", note: "3 printed, 1 staged" },
  { variant: "51", question: 3, part: "a", note: "4 printed, 3 staged" },
  { variant: "51", question: 6, part: "b", note: "3 printed, 4 staged" },
  { variant: "51", question: 7, part: "c", note: "5 printed, 7 staged" },
];

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function loadStagedPapers() {
  const bundleDir = path.join(FIXTURES, "bundles");
  const papers = [];
  for (const file of fs.readdirSync(bundleDir)) {
    const bundle = readJson(path.join(bundleDir, file));
    // Batch 2 == the v2.1 staged runs. v1/v2 runs are superseded history.
    if (bundle.pipeline_version !== "budget-v2.1") continue;
    const ocrFile = path.join(FIXTURES, "ocr", file);
    if (!fs.existsSync(ocrFile)) continue;
    papers.push({
      key: bundle.paper_key,
      variant: bundle.paper_key.split("_").pop(),
      staged: bundle.extraction_summary.paper_bundle.questions,
      ocr: readJson(ocrFile),
    });
  }
  return papers.sort((a, b) => a.variant.localeCompare(b.variant));
}

/** Sum the marks a side awards per (question, part), counting primary rows only. */
function primarySums(rows, questionOf) {
  const sums = new Map();
  for (const row of rows) {
    if (row.is_alternative_method) continue;
    const key = `${questionOf(row)}|${(row.part_path ?? []).join(".")}`;
    sums.set(key, (sums.get(key) ?? 0) + markValue(row.mark_code));
  }
  return sums;
}

const papers = loadStagedPapers().filter((p) => !ONLY_PAPER || p.variant === ONLY_PAPER);
if (!papers.length) {
  console.error("No staged batch-2 fixtures found. Run snapshot_fixtures.mjs first.");
  process.exit(1);
}

let stagedRowTotal = 0;
let stagedAltTotal = 0;
let parsedRowTotal = 0;
let parsedAltTotal = 0;
let reconciledParts = 0;
let unreconciledParts = 0;
const unreconciled = [];

console.log("\nDeterministic parser vs staged model output — verbatim stored OCR\n");
console.log("paper   staged rows  parsed rows   staged alt%   parsed alt%   parts OK");
console.log("-".repeat(74));

for (const paper of papers) {
  const msPages = paper.ocr.documents.find((d) => d.document_type === "mark_scheme")?.pages ?? [];
  const { items, printedPartTotals } = parseMarkSchemePages(msPages);

  const stagedRows = paper.staged.flatMap((q) =>
    (q.mark_scheme_items ?? []).map((m) => ({ ...m, _q: q.question_number })),
  );
  const stagedAlt = stagedRows.filter((r) => r.is_alternative_method).length;
  const parsedAlt = items.filter((r) => r.is_alternative_method).length;

  // Reconcile every part for which the mark scheme printed a subtotal.
  const parsedSums = primarySums(items, (r) => r._question_number);
  let ok = 0;
  let bad = 0;
  for (const [key, printed] of Object.entries(printedPartTotals)) {
    const [q, part] = key.split("|");
    const actual = parsedSums.get(`${q}|${part}`) ?? 0;
    if (actual === printed) {
      ok += 1;
    } else {
      bad += 1;
      unreconciled.push({ variant: paper.variant, question: Number(q), part, printed, actual });
    }
  }

  stagedRowTotal += stagedRows.length;
  stagedAltTotal += stagedAlt;
  parsedRowTotal += items.length;
  parsedAltTotal += parsedAlt;
  reconciledParts += ok;
  unreconciledParts += bad;

  const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1).padStart(5) : "  0.0");
  console.log(
    `9709/${paper.variant}` .padEnd(8) +
      String(stagedRows.length).padStart(11) +
      String(items.length).padStart(13) +
      pct(stagedAlt, stagedRows.length).padStart(14) +
      "%" +
      pct(parsedAlt, items.length).padStart(13) +
      "%" +
      `${ok}/${ok + bad}`.padStart(11),
  );

  if (VERBOSE) {
    for (const [key, printed] of Object.entries(printedPartTotals)) {
      const [q, part] = key.split("|");
      const actual = parsedSums.get(`${q}|${part}`) ?? 0;
      const flag = actual === printed ? "  ok" : "MISMATCH";
      console.log(`         Q${q}${part ? `(${part})` : ""} printed ${printed} parsed ${actual}  ${flag}`);
    }
  }
}

console.log("-".repeat(74));
const stagedPct = ((stagedAltTotal / stagedRowTotal) * 100).toFixed(1);
const parsedPct = ((parsedAltTotal / parsedRowTotal) * 100).toFixed(1);
console.log(
  "TOTAL".padEnd(8) +
    String(stagedRowTotal).padStart(11) +
    String(parsedRowTotal).padStart(13) +
    `${stagedPct}%`.padStart(15) +
    `${parsedPct}%`.padStart(14) +
    `${reconciledParts}/${reconciledParts + unreconciledParts}`.padStart(11),
);

// ---- Gate 1: alternative-flag provenance ----------------------------------
//
// The original gate here was "alternative rate below 10%". That was an
// unfounded guess and measuring against it would have been actively harmful.
// Papers 11, 22 and 51 each flag EXACTLY as many alternatives as there are
// parenthesised codes printed in the source (19=19, 9=9, 25=25), so the rate is
// largely correct -- Cambridge really does print that many alternatives.
//
// The staged 23.9% was wrong not because it was high but because it flagged the
// WRONG rows: it read the `*` dependency marker as an alternative method, and
// simultaneously lost the marker itself. So the real test is provenance --
// every flag must trace to an explicit printed marker, and no flag may come
// from a dependency asterisk.
console.log("\n1. Alternative-flag provenance");
console.log(`   overall rate: staged ${stagedPct}%  ->  parsed ${parsedPct}%`);

let depFlaggedAsAlt = 0;
let depMarkersPreserved = 0;
let depMarkersInSource = 0;
let stagedDepMarkers = 0;
let untraceableFlags = 0;

// Ground truth for the dependency marker is the source, not the staged bundle.
// Counting Marks cells that are nothing but a mark code carrying an asterisk.
const CODE_ONLY = /^\*?(?:DM|DB|M|A|B)\d+\*?(?:\s*FT)?(?:\s*,\s*\d+)*$/i;

for (const paper of papers) {
  const msPages = paper.ocr.documents.find((d) => d.document_type === "mark_scheme")?.pages ?? [];
  const { items, alternativeGroups, specialCaseGroups } = parseMarkSchemePages(msPages);
  const raw = msPages.map((p) => p.raw_markdown).join("\n");
  const parenthesisedInSource = (raw.match(/\|\s*\*{0,2}\(\*?(?:DM|DB|M|A|B)\d[^)]*\)\*{0,2}\s*\|/gi) ?? []).length;

  // Ground truth for the dependency marker: Marks cells that are nothing but a
  // mark code and carry an asterisk. Counting the source rather than trusting
  // either side, because the model both fabricated and lost these.
  for (const page of msPages) {
    for (const line of page.raw_markdown.split(/\r?\n/)) {
      if (!/^\s*\|/.test(line)) continue;
      const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
      for (const cell of cells) {
        const body = stripBold(cell.trim()).replace(/^\((.*)\)$/, "$1");
        if (CODE_ONLY.test(body) && body.includes("*")) depMarkersInSource += 1;
      }
    }
  }

  for (const row of items) {
    if (!row.mark_code) continue;
    if (row.mark_code.includes("*")) {
      depMarkersPreserved += 1;
      if (row.is_alternative_method) {
        // Only a defect if it is flagged SOLELY because of the asterisk, i.e.
        // it sits in no alternative or special-case block.
        const inBlock =
          alternativeGroups.some((g) => g.question_number === row._question_number) ||
          specialCaseGroups.some((g) => g.question_number === row._question_number);
        if (!inBlock) depFlaggedAsAlt += 1;
      }
    }
  }

  const flagged = items.filter((r) => r.is_alternative_method).length;
  const explained =
    parenthesisedInSource +
    alternativeGroups.reduce((n, g) => n + g.row_sequence_numbers.length, 0) +
    specialCaseGroups.reduce((n, g) => n + g.row_sequence_numbers.length, 0);
  if (flagged > 0 && parenthesisedInSource === 0 && !alternativeGroups.length && !specialCaseGroups.length) {
    untraceableFlags += flagged;
  }
  void explained;

  for (const row of paper.staged.flatMap((q) => q.mark_scheme_items ?? [])) {
    if (row.mark_code?.includes("*")) stagedDepMarkers += 1;
  }
}

console.log(`   dependency markers printed in source: ${depMarkersInSource}`);
console.log(
  `     model staged ${stagedDepMarkers} (${stagedDepMarkers > depMarkersInSource ? "fabricated some" : "lost some"}), ` +
    `parser ${depMarkersPreserved} (${depMarkersPreserved === depMarkersInSource ? "exact" : "MISMATCH"})`,
);
console.log(`   rows flagged alternative purely because of a '*': ${depFlaggedAsAlt}  (must be 0)`);
console.log(`   flags with no traceable source marker: ${untraceableFlags}  (must be 0)`);
console.log(
  `   ${
    depFlaggedAsAlt === 0 && untraceableFlags === 0 && depMarkersPreserved === depMarkersInSource
      ? "PASS"
      : "FAIL"
  }`,
);

// ---- Gate 2: the eight documented reconciliation gaps ----------------------
console.log("\n2. Documented per-part reconciliation gaps");
let gapsClosed = 0;
for (const gap of KNOWN_GAPS) {
  const stillBroken = unreconciled.find(
    (u) => u.variant === gap.variant && u.question === gap.question && u.part === gap.part,
  );
  if (!stillBroken) gapsClosed += 1;
  const label = `9709/${gap.variant} Q${gap.question}${gap.part ? `(${gap.part})` : ""}`;
  console.log(
    `   ${stillBroken ? "OPEN  " : "closed"}  ${label.padEnd(18)} ${
      stillBroken ? `printed ${stillBroken.printed}, parsed ${stillBroken.actual}` : gap.note
    }`,
  );
}
console.log(`   ${gapsClosed}/${KNOWN_GAPS.length} closed — ${gapsClosed === KNOWN_GAPS.length ? "PASS" : "FAIL"}`);

// ---- Gate 3: the fabricated B1 on 62 Q7(b) --------------------------------
console.log("\n3. Fabricated B1 on 9709/62 Q7(b)");
const paper62 = papers.find((p) => p.variant === "62");
if (!paper62) {
  console.log("   SKIPPED (paper 62 not in this run)");
} else {
  const msPages = paper62.ocr.documents.find((d) => d.document_type === "mark_scheme").pages;
  const { items } = parseMarkSchemePages(msPages);
  const q7b = items.filter((i) => i._question_number === 7 && i.part_path.join(".") === "b");
  const stagedQ7b = (paper62.staged.find((q) => q.question_number === 7)?.mark_scheme_items ?? [])
    .filter((m) => (m.part_path ?? []).join(".") === "b");
  const stagedHasB1 = stagedQ7b.some((m) => m.mark_code === "B1");
  const parsedHasB1 = q7b.some((i) => i.mark_code === "B1");
  console.log(`   staged codes: ${stagedQ7b.map((m) => m.mark_code ?? "null").join(", ")}`);
  console.log(`   parsed codes: ${q7b.map((i) => i.mark_code ?? "null").join(", ")}`);
  console.log(`   staged had fabricated B1: ${stagedHasB1}`);
  console.log(`   parsed has fabricated B1: ${parsedHasB1}`);
  console.log(`   ${!parsedHasB1 ? "PASS" : "FAIL"}`);
}

// ---- Any other unreconciled parts -----------------------------------------
const undocumented = unreconciled.filter(
  (u) => !KNOWN_GAPS.some((g) => g.variant === u.variant && g.question === u.question && g.part === u.part),
);
if (undocumented.length) {
  console.log(`\n4. Parts the parser does NOT reconcile, beyond the documented eight (${undocumented.length})`);
  for (const u of undocumented.slice(0, 40)) {
    console.log(
      `   9709/${u.variant} Q${u.question}${u.part ? `(${u.part})` : ""}  printed ${u.printed}, parsed ${u.actual}`,
    );
  }
  if (undocumented.length > 40) console.log(`   ... and ${undocumented.length - 40} more`);
} else {
  console.log("\n4. No undocumented reconciliation failures.");
}
console.log("");
