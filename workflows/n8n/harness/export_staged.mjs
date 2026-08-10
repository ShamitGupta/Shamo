// Export staged paper bundles to fixtures/staged/ for offline checking.
//
// The bundles live in shamo_ingestion_runs.extraction_summary->paper_bundle.
// Pulling them to disk once keeps every later check offline, and keeps the
// review reproducible after the run is published and the staging cleared.
//
//   node workflows/n8n/harness/export_staged.mjs --batch v2.2-batch-02
//   node workflows/n8n/harness/export_staged.mjs --run <uuid>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { select, paperKey } from "./supabase_client.mjs";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HARNESS, "fixtures", "staged");

const args = process.argv.slice(2);
const batch = args.includes("--batch") ? args[args.indexOf("--batch") + 1] : null;
const runId = args.includes("--run") ? args[args.indexOf("--run") + 1] : null;
if (!batch && !runId) {
  console.error("Pass --batch <fragment> or --run <uuid>.");
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const filter = runId
  ? `id=eq.${runId}`
  : `idempotency_key=like.*${encodeURIComponent(batch)}*`;

const runs = await select("shamo_ingestion_runs", {
  columns: "id,paper_id,idempotency_key,status,review_status,extraction_summary",
  filter,
});

if (!runs.length) {
  console.error("No runs matched.");
  process.exit(1);
}

const papers = await select("shamo_papers", {
  columns: "id,qualification,syllabus_code,subject,year,exam_session,paper_variant",
});
const paperById = new Map(papers.map((p) => [p.id, p]));

let written = 0;
for (const run of runs) {
  const bundle = run.extraction_summary?.paper_bundle;
  if (!bundle) {
    console.log(`  ${run.id}: no paper_bundle -- skipped`);
    continue;
  }
  const paper = paperById.get(run.paper_id);
  if (!paper) {
    console.log(`  ${run.id}: paper row missing -- skipped`);
    continue;
  }
  const key = paperKey(paper);
  const payload = {
    paper_key: key,
    run_id: run.id,
    idempotency_key: run.idempotency_key,
    status: run.status,
    review_status: run.review_status,
    paper_bundle: bundle,
  };
  const target = path.join(OUT, `${key}__${run.id.slice(0, 8)}.json`);
  fs.writeFileSync(target, JSON.stringify(payload));
  const size = fs.statSync(target).size / 1024;
  console.log(
    `  ${key}  ${bundle.questions?.length ?? 0} questions  ->  ${path.basename(target)} (${size.toFixed(0)} kB)`,
  );
  written += 1;
}

console.log(`\nwrote ${written} staged bundle(s) to fixtures/staged/`);
