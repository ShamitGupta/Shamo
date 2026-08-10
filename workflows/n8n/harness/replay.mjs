// Replay the mark-scheme and validation segment of the real generated workflow
// against stored OCR, offline and free.
//
// This executes the ACTUAL jsCode from shamo_budget_v2_1_stage_one_math_paper
// .json -- not a copy -- so a green run here means the deployed node behaves
// this way too.
//
// The paid upstream stages (question-paper extraction, metadata) are replayed
// from the staged batch-2 bundles rather than re-called: their output is
// already recorded in fixtures/bundles/. That is what makes this cost nothing.
// The mark-scheme stage is no longer paid at all, which is the point of the
// change being tested.
//
//   node workflows/n8n/harness/replay.mjs
//   node workflows/n8n/harness/replay.mjs --paper 62 --trace

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGraph, asItems } from "./node_runtime.mjs";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HARNESS, "fixtures");
const WORKFLOW = JSON.parse(
  fs.readFileSync(path.join(HARNESS, "..", "shamo_budget_v2_1_stage_one_math_paper.json"), "utf8"),
);

const args = process.argv.slice(2);
const TRACE = args.includes("--trace");
const ONLY = args.includes("--paper") ? args[args.indexOf("--paper") + 1] : null;

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

/**
 * Rebuild the node state as it would exist at `Restore Page Map State`, using
 * the recorded staged bundle for the upstream model stages and the stored OCR
 * for the document text.
 */
function buildEntryState(bundle, ocr) {
  const questions = bundle.extraction_summary.paper_bundle.questions;
  const pageMap = {};
  for (const question of questions) {
    const pages = new Set();
    for (const item of question.mark_scheme_items ?? []) {
      for (const page of item.source_page_numbers ?? []) pages.add(Number(page));
    }
    if (pages.size) pageMap[String(question.question_number)] = [...pages].sort((a, b) => a - b);
  }

  return {
    pair: {
      qualification: "a_level",
      syllabus_code: bundle.paper_key.split("_")[0],
      year: Number(bundle.paper_key.split("_")[1]),
      exam_session: bundle.paper_key.split("_").slice(2, -1).join("_"),
      paper_variant: bundle.paper_key.split("_").pop(),
    },
    config: {
      question_model: "gpt-5.4-mini",
      page_map_model: "gpt-5.4-nano",
      mark_scheme_model: "gpt-5.4-nano",
      metadata_model: "gpt-5.4-nano",
      repair_model: "gpt-5.4-mini",
      openai_prices_per_million: {
        "gpt-5.4-nano": { input: 0.2, cached_input: 0.02, output: 1.25 },
        "gpt-5.4-mini": { input: 0.75, cached_input: 0.075, output: 4.5 },
      },
      stage_reservations_usd: {
        question_paper: 0.12,
        page_map: 0.02,
        mark_scheme: 0.12,
        metadata: 0.02,
        repair: 0.2,
      },
    },
    idempotency_key: `harness-replay:${bundle.paper_key}`,
    // Present only so the reservation node can build its request body. No
    // reservation is actually made -- the handler stubs the HTTP call.
    batch: { id: "harness-replay-batch" },
    ingestion_run_id: bundle.ingestion_run_id,
    known_documents: bundle.extraction_summary.paper_bundle.documents ?? [],
    compact_documents: ocr.documents.map((document) => ({
      document_type: document.document_type,
      pages: document.pages.map((page) => ({
        page_number: page.page_number,
        markdown: page.raw_markdown,
        images: [],
      })),
    })),
    // Upstream model output, replayed from the recorded bundle.
    question_paper_questions: questions.map(({ mark_scheme_items, ...rest }) => rest),
    mark_scheme_page_map: pageMap,
    page_counts: {
      question_paper: ocr.documents.find((d) => d.document_type === "question_paper")?.pages.length ?? 0,
      mark_scheme: ocr.documents.find((d) => d.document_type === "mark_scheme")?.pages.length ?? 0,
    },
    expected_total_marks: questions.reduce((sum, q) => sum + Number(q.total_marks || 0), 0),
    paper_summary: { question_count_from_source: questions.length },
    // Left empty deliberately. The snapshot stores OCR text, not the base64
    // image data, so asset-resolution checks cannot pass here. Rather than
    // synthesise fake image keys -- which would test nothing and can mask a
    // real failure -- ASSET_SOURCE_NOT_FOUND and ASSET_IMAGE_DATA_MISSING are
    // recorded as replay artefacts and excluded from the counts below.
    ocr_documents: [],
    api_events: [],
    extraction_response_ids: [],
  };
}

const bundles = fs
  .readdirSync(path.join(FIXTURES, "bundles"))
  .map((file) => ({ file, bundle: readJson(path.join(FIXTURES, "bundles", file)) }))
  .filter(({ bundle }) => bundle.pipeline_version === "budget-v2.1")
  .filter(({ bundle }) => !ONLY || bundle.paper_key.endsWith(`_${ONLY}`))
  .sort((a, b) => a.bundle.paper_key.localeCompare(b.bundle.paper_key));

if (!bundles.length) {
  console.error("No staged batch-2 bundles found. Run snapshot_fixtures.mjs first.");
  process.exit(1);
}

console.log("\nOffline replay of the generated workflow — mark scheme through validation\n");
console.log("paper     rows  fallback Qs   blocking   warnings   ready   issue codes");
console.log("-".repeat(96));

let anyModelCall = false;
let totalBlocking = 0;
const allCodes = new Map();

// Asset resolution needs base64 image data that the OCR snapshot does not
// store. These two codes are therefore expected here and say nothing about the
// pipeline; they are excluded from the counts rather than silently tolerated.
const ARTEFACT_CODES = new Set(["ASSET_SOURCE_NOT_FOUND", "ASSET_IMAGE_DATA_MISSING"]);

for (const { file, bundle } of bundles) {
  const ocr = readJson(path.join(FIXTURES, "ocr", file));
  const state = buildEntryState(bundle, ocr);
  const questions = bundle.extraction_summary.paper_bundle.questions;

  // Handlers for every non-Code node on this path. Reaching the OpenAI node
  // means the parser deferred at least one question -- record it loudly rather
  // than stubbing it away, because in production that costs money.
  const handlers = {
    "Restore Page Map State": (items) => items,
    "Reserve Mark Scheme Budget": () => {
      anyModelCall = true;
      return asItems([{ cost_event_id: "harness-stub" }]);
    },
    "OpenAI Mark Scheme Questions": () => {
      throw new Error(
        "Replay reached the paid OpenAI mark-scheme node. The parser deferred a question; " +
          "inspect mark_scheme_fallback_question_numbers.",
      );
    },
    "Finalize Mark Scheme Cost": () => asItems([{ idempotent_replay: true }]),

    // Metadata is a genuine model stage. Replay the recorded classification
    // from the staged bundle in the exact OpenAI envelope Parse Metadata
    // expects, so the real parse and validation code still runs over it.
    "Reserve Metadata Budget": () => asItems([{ cost_event_id: "harness-stub" }]),
    "OpenAI Question Metadata": () =>
      asItems([
        {
          status: "completed",
          id: "resp_harness_stub",
          usage: { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0 } },
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    questions: questions.map((question) => ({
                      question_number: question.question_number,
                      ...(question.metadata ?? {}),
                    })),
                  }),
                },
              ],
            },
          ],
        },
      ]),
    "Finalize Metadata Cost": () => asItems([{ idempotent_replay: true }]),
  };

  let result;
  let reachedModel = false;
  try {
    result = runGraph({
      workflow: WORKFLOW,
      startNode: "Restore Page Map State",
      initialItems: asItems([state]),
      handlers,
      trace: TRACE,
      // Stop once validation has produced its report; the asset/upload tail
      // needs Storage and is not what this replay is testing.
      maxSteps: 60,
    });
  } catch (error) {
    result = error.partial ? { outputs: error.partial.outputs } : undefined;
    if (/paid OpenAI mark-scheme node/.test(error.message)) {
      reachedModel = true;
    } else if (!/No handler for/.test(error.message)) {
      console.log(`${bundle.paper_key.padEnd(22)} ERROR  ${error.message.slice(0, 70)}`);
      continue;
    }
  }

  const validation =
    result?.outputs?.["Deterministic Validation"]?.[0]?.json?.validation_report ??
    result?.outputs?.["Deterministic Validation Before Repair"]?.[0]?.json?.validation_report;
  const parsed = result?.outputs?.["Parse Mark Scheme Tables"]?.[0]?.json;

  const rows = (parsed?.mark_scheme_results ?? []).reduce(
    (n, r) => n + (r.mark_scheme_items?.length ?? 0),
    0,
  );
  const fallbackQs = parsed?.mark_scheme_fallback_question_numbers ?? [];
  const blocking = validation ? undefined : "-";
  const warnings = validation?.warning_count ?? "-";
  const ready = validation ? (validation.passed ? "yes" : "NO") : "-";

  const realIssues = (validation?.issues ?? []).filter((issue) => !ARTEFACT_CODES.has(issue.issue_code));
  for (const issue of realIssues) {
    allCodes.set(issue.issue_code, (allCodes.get(issue.issue_code) ?? 0) + 1);
  }
  const realBlocking = realIssues.filter((issue) => issue.severity === "blocking").length;
  totalBlocking += realBlocking;

  const codes = [...new Set(realIssues.map((i) => i.issue_code))].slice(0, 3).join(", ");
  console.log(
    bundle.paper_key.split("_").pop().padStart(5).padEnd(10) +
      String(rows).padStart(5) +
      (fallbackQs.length ? ` ${fallbackQs.join(",")}`.padStart(13) : "none".padStart(13)) +
      String(validation ? realBlocking : "-").padStart(11) +
      String(warnings).padStart(11) +
      ready.padStart(8) +
      "   " +
      (reachedModel ? "(deferred to model)" : codes),
  );
}

console.log("-".repeat(96));
console.log(`\nIssue codes raised across the batch:`);
for (const [code, count] of [...allCodes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}x  ${code}`);
}
console.log(`\nTotal blocking issues: ${totalBlocking}`);
console.log(`Paid mark-scheme stage reached: ${anyModelCall ? "YES" : "no — every question parsed deterministically"}\n`);
