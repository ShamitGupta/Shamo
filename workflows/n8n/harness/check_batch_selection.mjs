// Does the controller's paper selection actually scale past the calibration set?
//
// WHY
// ---
// The original selection asserted `pairs.length === 24` and exactly four papers
// per paper type, and indexed modulo 4. A 25th row in the Google Sheet made the
// controller throw before spending a penny -- the pipeline could not ingest
// anything beyond the original manifest. Nothing caught it because the sheet
// held exactly 24 rows, so every real run satisfied the assertion.
//
// This drives the REAL generated node code with synthetic manifests of several
// sizes, so the constraint cannot come back unnoticed.
//
//   node workflows/n8n/harness/check_batch_selection.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const N8N = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controller = JSON.parse(
  fs.readFileSync(path.join(N8N, "shamo_budget_v2_1_test2_six_paper_controller.json"), "utf8"),
);
const node = controller.nodes.find((n) => /Pair and Select/i.test(n.name));
const selectionCode = node.parameters.jsCode;

const SESSIONS = ["February/March", "May/June", "October/November"];
const SESSION_LETTER = { "February/March": "m", "May/June": "s", "October/November": "w" };

/** Build a sheet the way the real manifest is shaped. */
function manifest(papersPerType, paperTypes = 6) {
  const rows = [];
  for (let type = 1; type <= paperTypes; type += 1) {
    for (let index = 0; index < papersPerType; index += 1) {
      const session = SESSIONS[index % 3];
      const yy = String(20 + index).padStart(2, "0");
      const variant = `${type}${index + 1}`;
      for (const [docType, code] of [
        ["Question paper", "qp"],
        ["Mark scheme", "ms"],
      ]) {
        rows.push({
          Grade: "A-levels",
          Subject: "Mathematics",
          Year: String(2000 + Number(yy)),
          "Exam session": session,
          "Paper Variant": variant,
          "Document type": docType,
          "Paper Link": `https://x/9709_${SESSION_LETTER[session]}${yy}_${code}_${variant}.pdf`,
        });
      }
    }
  }
  return rows;
}

function select({ papersPerType, batchNumber, batchSize, paperTypes = 6 }) {
  const rows = manifest(papersPerType, paperTypes);
  const config = {
    campaign_key: "test-campaign",
    workflow_version: "v9",
    batch_number: batchNumber,
    max_papers_per_run: batchSize,
    google_sheet_name: "Test 2",
    qualification: "a_level",
    syllabus_code: "9709",
    subject: "Mathematics",
  };
  const items = rows.map((json) => ({ json }));
  const $input = { all: () => items, first: () => items[0] };
  const $ = () => ({ first: () => ({ json: config }), all: () => [{ json: config }] });
  const run = new Function("$input", "$", selectionCode);
  return run($input, $)[0].json.pairs.map((p) => p.paper_variant);
}

let failed = 0;
const check = (label, condition, detail) => {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!condition) failed += 1;
};

console.log("\nController paper selection -- scale behaviour\n");

// 1. The calibration layout still works, and four batches still cover all 24
//    papers exactly once with one paper per type per batch.
const calibration = [1, 2, 3, 4].map((b) => select({ papersPerType: 4, batchNumber: b, batchSize: 6 }));
const covered = new Set(calibration.flat());
check("24-paper manifest: batches 1-4 cover all 24 papers", covered.size === 24, `got ${covered.size}`);
check(
  "24-paper manifest: every batch takes one paper of each type",
  calibration.every((batch) => new Set(batch.map((v) => v[0])).size === 6),
  calibration.map((b) => b.join("/")).join("  |  "),
);

// 2. The case that used to throw. This is the whole point of the change.
let over = null;
try {
  over = select({ papersPerType: 5, batchNumber: 1, batchSize: 6 });
} catch (error) {
  over = `THREW: ${error.message}`;
}
check("30-paper manifest is accepted (used to throw on !== 24)", Array.isArray(over), String(over));

// 3. A manifest that is not a multiple of the batch size, and an uneven one.
const uneven = (() => {
  try {
    return select({ papersPerType: 3, batchNumber: 2, batchSize: 6, paperTypes: 5 });
  } catch (error) {
    return `THREW: ${error.message}`;
  }
})();
check("15-paper manifest across 5 paper types is accepted", Array.isArray(uneven), String(uneven));

// 4. Batch size is honoured rather than hardcoded to six.
const big = select({ papersPerType: 5, batchNumber: 1, batchSize: 12 });
check("batch size 12 returns 12 papers", big.length === 12, `got ${big.length}`);

// 5. Running past the end must fail loudly, not return an empty batch that
//    would look like a successful no-op run.
let pastEnd = "no throw";
try {
  select({ papersPerType: 2, batchNumber: 3, batchSize: 6 });
} catch (error) {
  pastEnd = error.message;
}
check("running past the end of the manifest throws", pastEnd !== "no throw", pastEnd.slice(0, 70));

// 6. Selection must be deterministic -- the same batch twice is the same papers,
//    or idempotency keys stop protecting against duplicate paid work.
const first = select({ papersPerType: 4, batchNumber: 2, batchSize: 6 }).join(",");
const again = select({ papersPerType: 4, batchNumber: 2, batchSize: 6 }).join(",");
check("selection is deterministic", first === again, first);

console.log(`\n${failed ? "FAIL" : "PASS"} -- ${failed} failing check(s)\n`);
process.exitCode = failed ? 1 : 0;
