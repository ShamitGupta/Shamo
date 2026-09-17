// The standing regression gate. One command, exit 1 on failure.
//
//   node workflows/n8n/harness/check.mjs
//
// Run this before deploying a workflow change and before spending anything on
// a paid run. Everything it does is offline and free.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const N8N = path.resolve(HARNESS, "..");

const steps = [
  ["Regenerate workflows from the generator", path.join(N8N, "build_budget_v2_workflows.mjs")],
  ["Static workflow validation", path.join(N8N, "validate_budget_v2_workflows.mjs")],
  ["Mark-scheme parser unit tests", path.join(N8N, "lib", "mark_scheme_parser.test.mjs")],
  ["Controller selection scales past the calibration set", path.join(HARNESS, "check_batch_selection.mjs")],
  ["Parser vs stored OCR (go/no-go gates)", path.join(HARNESS, "check_parser.mjs")],
  // Both are real gates, not reports. Asset resolution replaces a model's
  // judgement with code, so it has to keep agreeing with the model everywhere
  // the model was right; and the two papers that stopped batch 4 must stay
  // unblocked, or a later change silently reintroduces a manual step.
  ["Asset index resolution vs known-good assets", path.join(HARNESS, "check_asset_matching.mjs")],
  ["Papers that blocked in batch 4 stay unblocked", path.join(HARNESS, "check_blocked_papers.mjs")],
  // Report, not a gate. It is a regression floor for how many papers would need
  // a human, but the denominator is only the currently-staged batch, so a new
  // batch legitimately moves it. Watch the trend; do not fail a build on it.
  ["Papers that would need a human (regression floor)", path.join(HARNESS, "check_autonomy.mjs"), "report"],
  ["Offline replay of the generated graph", path.join(HARNESS, "replay.mjs")],
  // Reports rather than gates. OCR quality is a property of the source reading,
  // not of any code change, so a flag here is a review item for that paper --
  // it must not fail a workflow regression run.
  ["OCR vs PDF text layer (review triage)", path.join(HARNESS, "check_ocr_vs_pdf.mjs"), "report"],
  ["Staged content vs printed paper (review triage)", path.join(HARNESS, "check_content_vs_pdf.mjs"), "report"],
  ["OCR internal consistency (review triage)", path.join(HARNESS, "check_ocr_integrity.mjs"), "report"],
  // Lost factorials in exponential series. Report-only for the same reason as
  // the others -- it is a property of the OCR reading, not of any code change --
  // but it earns its place: it is the only check that saw a corrupted formula in
  // two papers that had staged completely clean, because marks still reconcile
  // and prose fidelity cannot judge maths.
  ["Lost factorials in OCR (review triage)", path.join(HARNESS, "check_lost_factorials.mjs"), "report"],
  ["Lost operators in OCR (review triage)", path.join(HARNESS, "check_lost_operators.mjs"), "report"],
  // The general version of the two checks above: evaluate whatever arithmetic
  // is stored and compare it against the value Cambridge prints beside it,
  // rather than looking for one specific corruption shape. Report-only for
  // the same reason -- it is a property of the source reading, not of any
  // code change -- but this is the check the operating plan named as the top
  // priority, because every defect found by hand in August was found exactly
  // this way and hand-reading does not scale.
  ["Numeric self-consistency: expression vs printed value (review triage)", path.join(HARNESS, "check_numeric_consistency.mjs"), "report"],
  ["Promised tables and diagrams are present", path.join(HARNESS, "check_promised_content.mjs"), "gate"],
  // Needs Supabase credentials rather than fixtures, because metadata lives only
  // in the database. Report-only: a topic disagreement is a review item for that
  // paper, never a reason to fail a workflow regression run.
  ["main_topic vs question evidence (review triage)", path.join(HARNESS, "check_metadata_topics.mjs"), "report"],
  ["subtopics/skills/methods/difficulty (review triage)", path.join(HARNESS, "check_metadata_fields.mjs"), "report"],
];

let failed = false;
for (const [label, script, mode] of steps) {
  const reportOnly = mode === "report";
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    const output = execFileSync(process.execPath, [script], { encoding: "utf8" });
    // Gate scripts report their own PASS/FAIL lines; surface any FAIL.
    if (!reportOnly && (/^\s*FAIL\s*$/m.test(output) || /"success":\s*false/.test(output))) {
      failed = true;
      process.stdout.write(output);
    } else {
      const tail = output.trimEnd().split("\n").slice(reportOnly ? -18 : -6).join("\n");
      process.stdout.write(`${tail}\n`);
    }
  } catch (error) {
    if (!reportOnly) failed = true;
    process.stdout.write(`${error.stdout ?? ""}${error.stderr ?? ""}\n`);
  }
}

process.stdout.write(`\n${failed ? "CHECK FAILED" : "ALL CHECKS PASSED"}\n`);
process.exitCode = failed ? 1 : 0;
