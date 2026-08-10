// Does deterministic asset resolution reproduce what the model got right, and
// recover what it got wrong?
//
// The bar for replacing a model's judgement with code is that the code agrees
// with the model everywhere the model was correct. Every asset that reached
// Storage is a case the model got right, so those 18 are the regression set: if
// the resolver disagrees with any of them it is worse than what it replaces,
// whatever it does for the failures.
//
// Offline and free -- reads the committed OCR and staged fixtures only.
//
//   node workflows/n8n/harness/check_asset_matching.mjs [--verbose]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildImageInventory,
  resolveAssetImage,
  RESOLVED_STATUSES,
} from "../lib/asset_matching.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OCR = path.join(HERE, "fixtures", "ocr");
const STAGED = path.join(HERE, "fixtures", "staged");
const verbose = process.argv.includes("--verbose");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Staged bundles hold the assets; OCR fixtures hold the images. Join on run id,
// which is in both filenames.
const ocrByRun = new Map();
for (const file of fs.readdirSync(OCR)) {
  const runId = file.replace(/\.json$/, "").split("__")[1];
  if (runId) ocrByRun.set(runId, path.join(OCR, file));
}

const results = [];
for (const file of fs.readdirSync(STAGED)) {
  const staged = readJson(path.join(STAGED, file));
  const runPrefix = staged.run_id;
  const ocrFile =
    ocrByRun.get(runPrefix) ||
    [...ocrByRun.entries()].find(([id]) => id.startsWith(runPrefix.slice(0, 8)))?.[1];
  if (!ocrFile) continue;

  const ocr = readJson(ocrFile);
  const inventory = buildImageInventory(ocr.documents);

  for (const question of staged.paper_bundle.questions || []) {
    for (const asset of question.assets || []) {
      const resolution = resolveAssetImage(asset, inventory);
      results.push({
        paper: staged.paper_key,
        question: question.question_number,
        asset,
        resolution,
        // An asset carrying a storage_path was uploaded, which means the
        // model's own index hit a real image with data behind it.
        uploaded: Boolean(asset.storage_path),
      });
    }
  }
}

const uploaded = results.filter((r) => r.uploaded);
const agree = uploaded.filter((r) => r.resolution.index === Number(r.asset.source_image_index));
const disagree = uploaded.filter((r) => r.resolution.index !== Number(r.asset.source_image_index));

console.log("=== Deterministic resolution vs the assets that already work ===\n");
console.log(`  assets that reached Storage        ${uploaded.length}`);
console.log(`  resolver agrees                    ${agree.length}`);
console.log(`  resolver DISAGREES                 ${disagree.length}`);

if (verbose || disagree.length) {
  for (const r of disagree) {
    console.log(
      `    ${r.paper} Q${r.question}  model=${r.asset.source_image_index} ` +
        `resolver=${r.resolution.index} (${r.resolution.status})`
    );
  }
}

if (verbose) {
  console.log("\n  per-asset detail:");
  for (const r of uploaded) {
    console.log(
      `    ${r.paper.padEnd(26)} Q${String(r.question).padEnd(3)} ` +
        `p${r.asset.source_page_number} idx=${r.asset.source_image_index} ` +
        `-> ${r.resolution.index} ${r.resolution.status}` +
        ``
    );
  }
}

// The failures are the point of the exercise: claims the pipeline could not
// match. Each should now either resolve, or be reported as having no candidate
// image so a rule can decide whether that is a loss or a phantom.
const unmatched = results.filter((r) => !r.uploaded);
console.log(`\n=== Claims that did not reach Storage (${unmatched.length}) ===\n`);
for (const r of unmatched) {
  console.log(
    `  ${r.paper} Q${r.question}  claimed ${r.asset.document_type}:` +
      `${r.asset.source_page_number}:${r.asset.source_image_index}  ->  ${r.resolution.status}` +
      (r.resolution.index !== null ? ` (index ${r.resolution.index})` : "")
  );
}

const failed = disagree.length > 0;
console.log(
  `\n${failed ? "FAIL" : "PASS"} -- resolver ${failed ? "contradicts" : "reproduces"} ` +
    `every asset the pipeline already matched.`
);
process.exit(failed ? 1 : 0);
