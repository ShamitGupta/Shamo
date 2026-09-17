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

// TWO CLAIMS RESOLVING TO ONE IMAGE.
//
// The resolver maps a claim to a content image, so two claims on the same
// question can legitimately resolve to the SAME file -- and then a student sees
// one diagram rendered twice. Found on 9709/32 M/J 2025 Q11, where the model
// described the graph once as a whole and once as its "number line / axis
// element": page 18 carries exactly one content image, so both claims landed on
// it. The image was right; the record was doubled.
//
// This is invisible to every other check. The asset exists, has a storage path,
// has a description and a non-zero size, and the counts reconcile -- because
// there really are two rows.
const byQuestionPath = new Map();
for (const r of uploaded) {
  const key = `${r.paper}|Q${r.question}|${r.asset.storage_path}`;
  if (!byQuestionPath.has(key)) byQuestionPath.set(key, []);
  byQuestionPath.get(key).push(r);
}
const duplicates = [...byQuestionPath.entries()].filter(([, list]) => list.length > 1);

console.log(`\n=== One image claimed twice on the same question (${duplicates.length}) ===\n`);
if (!duplicates.length) {
  console.log("  None. Every asset on a question points at a distinct image.");
} else {
  for (const [key, list] of duplicates) {
    const [paper, question] = key.split("|");
    console.log(`  ${paper} ${question}  ${list.length} claims -> ${list[0].asset.storage_path}`);
    for (const r of list) {
      console.log(`      idx=${r.asset.source_image_index}  ${String(r.asset.description ?? "").slice(0, 72)}`);
    }
  }
  console.log(
    "\n  One of each group is spurious. Keep the description that matches the\n" +
      "  printed diagram and drop the rest; a duplicate renders the same image twice.",
  );
}

// TWO CLAIMS ON THE SAME SOURCE POSITION, EVEN WITH DIFFERENT STORAGE PATHS.
//
// The check above catches a duplicate only when both claims resolved to the
// SAME uploaded file. It missed 9709/42 O/N 2025 Q7: the model claimed
// question_paper page 10 image 1 (Fig 7.1) TWICE -- once scoped to part (a),
// once to part (b), because Fig 7.1 is genuinely referenced by both -- and
// uploaded each under a different storage path (.../q7-part-a/... and
// .../q7-part-b/...). Different files, same source image.
//
// That reached the database, where shamo_question_assets enforces uniqueness
// on (ingestion_run_id, paper_document_id, source_page_number,
// source_image_index) -- one row per physical image per paper, full stop --
// and the atomic publish RPC rejected it with a 409 conflict. The bundle-level
// check above is a proxy for that constraint; this one is the constraint
// itself, checked BEFORE publication rather than by it.
//
// Scoped to the whole PAPER, not to one question, because the database
// constraint is paper-wide: two different questions cannot each claim their
// own copy of the same page+index slot either.
const byPosition = new Map();
for (const r of uploaded) {
  const key = `${r.paper}|${r.asset.document_type}|${r.asset.source_page_number}|${r.asset.source_image_index}`;
  if (!byPosition.has(key)) byPosition.set(key, []);
  byPosition.get(key).push(r);
}
const positionClashes = [...byPosition.entries()].filter(([, list]) => list.length > 1);

console.log(`\n=== One source position claimed twice, any storage path (${positionClashes.length}) ===\n`);
if (!positionClashes.length) {
  console.log("  None. Every (page, index) position is claimed at most once per paper.");
} else {
  for (const [key, list] of positionClashes) {
    const [paper, doc, page, idx] = key.split("|");
    console.log(`  ${paper}  ${doc} p${page} idx=${idx}  ${list.length} claims:`);
    for (const r of list) {
      console.log(`      Q${r.question}  ${r.asset.storage_path}`);
    }
  }
  console.log(
    "\n  This is the shape the database's own uniqueness constraint rejects at\n" +
      "  publish time. If both claims genuinely apply (the diagram serves more than\n" +
      "  one part), merge into ONE record with part_path reflecting all of them --\n" +
      "  do not upload the same image twice under different paths.",
  );
}

const failed = disagree.length > 0 || duplicates.length > 0 || positionClashes.length > 0;
console.log(
  `\n${failed ? "FAIL" : "PASS"} -- resolver ${disagree.length ? "contradicts" : "reproduces"} ` +
    `every asset the pipeline already matched` +
    (duplicates.length ? `, ${duplicates.length} image(s) claimed twice by storage path` : "") +
    (positionClashes.length ? `, ${positionClashes.length} position(s) claimed twice by page/index` : "") +
    `.`
);
process.exitCode = failed ? 1 : 0;
