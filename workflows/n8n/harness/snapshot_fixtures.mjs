// Snapshot the live ingestion corpus into git-committed fixtures.
//
// WHY THIS EXISTS AND WHY IT IS URGENT
// -----------------------------------
// shamo_ingestion_pages holds the raw Mistral OCR markdown for every ingested
// paper. Those rows carry an expires_at and a cleanup operation exists to
// reclaim them. As of 2026-08-07, 494 of 695 rows are ALREADY past expires_at
// and survive only because the cleanup has not been run. That markdown is the
// input side of every accuracy measurement the harness makes -- without it the
// pipeline can only be tested by paying for OCR and extraction again.
//
// So: copy it to git. Git is the durable record; expires_at extensions are a
// convenience, not a backup.
//
// Read-only. Writes nothing to Supabase.
//
// Usage:
//   node workflows/n8n/harness/snapshot_fixtures.mjs
//   node workflows/n8n/harness/snapshot_fixtures.mjs --dry-run

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { select, loadConfig, describeKey, paperKey } from "./supabase_client.mjs";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HARNESS_DIR, "fixtures");
const DRY_RUN = process.argv.includes("--dry-run");

function writeJson(relativePath, value) {
  const target = path.join(FIXTURES, relativePath);
  const body = JSON.stringify(value, null, 2) + "\n";
  if (!DRY_RUN) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, "utf8");
  }
  return { relativePath, bytes: Buffer.byteLength(body) };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function main() {
  const { key } = loadConfig();
  const keyInfo = describeKey(key);
  if (keyInfo.role !== "service_role") {
    throw new Error(
      `Expected a service_role key, got role="${keyInfo.role}". ` +
        "The anon key cannot read shamo_ingestion_pages.",
    );
  }
  console.log(`service_role key OK (expires ${keyInfo.expiresAt?.slice(0, 10)})`);
  if (DRY_RUN) console.log("DRY RUN -- no files will be written\n");

  // ---- Pull everything up front -------------------------------------------
  console.log("Fetching...");
  const [papers, runs, pages, documents] = await Promise.all([
    select("shamo_papers", { order: "syllabus_code,year,exam_session,paper_variant" }),
    select("shamo_ingestion_runs", {
      columns:
        "id,paper_id,idempotency_key,mode,status,review_status,ocr_model,extraction_model," +
        "source_summary,extraction_summary,validation_report,verifier_report," +
        "question_count,question_part_count,asset_count,started_at,finished_at,created_at",
    }),
    select("shamo_ingestion_pages", { order: "ingestion_run_id,document_type,page_number" }),
    select("shamo_paper_documents"),
  ]);

  const [questions, parts, markItems, assets, metadata] = await Promise.all([
    select("shamo_questions", { order: "paper_id,question_number" }),
    select("shamo_question_parts", { order: "question_id,sort_order" }),
    select("shamo_mark_scheme_items", { order: "question_id,sequence_number" }),
    select("shamo_question_assets"),
    select("shamo_question_metadata"),
  ]);

  console.log(
    `  ${papers.length} papers, ${runs.length} runs, ${pages.length} OCR pages, ` +
      `${questions.length} published questions, ${markItems.length} published mark rows`,
  );

  const paperById = new Map(papers.map((p) => [p.id, p]));
  const pagesByRun = groupBy(pages, (r) => r.ingestion_run_id);
  const written = [];

  // ---- 1. OCR corpus, one file per ingestion run --------------------------
  // Keyed by run rather than paper: a paper can have several runs (v1
  // diagnostic, v2, v2.1) and each stored its own OCR. Keeping them separate
  // preserves the provenance that makes a diff interpretable.
  let runsWithOcr = 0;
  for (const run of runs) {
    const runPages = pagesByRun.get(run.id);
    if (!runPages?.length) continue;
    runsWithOcr += 1;
    const paper = paperById.get(run.paper_id);
    const documentTypes = [...new Set(runPages.map((p) => p.document_type))].sort();

    written.push(
      writeJson(`ocr/${paperKey(paper)}__${run.id}.json`, {
        paper_key: paperKey(paper),
        ingestion_run_id: run.id,
        idempotency_key: run.idempotency_key,
        run_status: run.status,
        paper_status: paper.status,
        ocr_model: run.ocr_model,
        source_documents: (run.source_summary?.documents ?? []).map((d) => ({
          document_type: d.document_type,
          source_url: d.source_url,
          page_count: d.page_count ?? null,
        })),
        documents: documentTypes.map((documentType) => ({
          document_type: documentType,
          pages: runPages
            .filter((p) => p.document_type === documentType)
            .sort((a, b) => a.page_number - b.page_number)
            .map((p) => ({
              page_number: p.page_number,
              raw_markdown: p.raw_markdown,
              ocr_confidence: p.ocr_confidence,
            })),
        })),
      }),
    );
  }

  // ---- 2. Staged bundles (the machine output to be scored) ----------------
  // Publication clears extraction_summary.paper_bundle, so the only surviving
  // bundles are the staged runs: the six batch-2 v2.1 runs and the six batch-1
  // v1 runs. Capture every run that still has one.
  let bundleCount = 0;
  for (const run of runs) {
    const bundle = run.extraction_summary?.paper_bundle;
    if (!bundle) continue;
    bundleCount += 1;
    const paper = paperById.get(run.paper_id);
    written.push(
      writeJson(`bundles/${paperKey(paper)}__${run.id}.json`, {
        paper_key: paperKey(paper),
        ingestion_run_id: run.id,
        idempotency_key: run.idempotency_key,
        pipeline_version: run.idempotency_key?.split(":")[0] ?? null,
        run_status: run.status,
        review_status: run.review_status,
        validation_report: run.validation_report ?? null,
        extraction_summary: run.extraction_summary,
      }),
    );
  }

  // ---- 3. Published content (ground truth, tiered) ------------------------
  // IMPORTANT: these rows are NOT uniformly trustworthy. The batch-1 reviews
  // corrected metadata only, so published mark rows are essentially unreviewed
  // model output -- Tier B, a reference to diff against, not truth. Question
  // and part structure passed explicit publication gates -- Tier A.
  const questionsByPaper = groupBy(questions, (q) => q.paper_id);
  const partsByQuestion = groupBy(parts, (p) => p.question_id);
  const marksByQuestion = groupBy(markItems, (m) => m.question_id);
  const assetsByQuestion = groupBy(assets, (a) => a.question_id);
  const metadataByQuestion = new Map(metadata.map((m) => [m.question_id, m]));

  let publishedCount = 0;
  for (const paper of papers.filter((p) => p.status === "published")) {
    const paperQuestions = questionsByPaper.get(paper.id) ?? [];
    if (!paperQuestions.length) continue;
    publishedCount += 1;
    written.push(
      writeJson(`published/${paperKey(paper)}.json`, {
        paper_key: paperKey(paper),
        paper: {
          qualification: paper.qualification,
          syllabus_code: paper.syllabus_code,
          subject: paper.subject,
          year: paper.year,
          exam_session: paper.exam_session,
          paper_variant: paper.paper_variant,
          status: paper.status,
        },
        current_ingestion_run_id: paper.current_ingestion_run_id,
        trust: {
          structure: "A",
          part_marks: "A",
          metadata: "A",
          // Stated explicitly so no scorer silently treats these as truth.
          mark_rows: "B -- never source-reviewed; agreement, not accuracy",
        },
        documents: documents
          .filter((d) => d.paper_id === paper.id)
          .map(({ document_type, source_url, page_count, ocr_model }) => ({
            document_type,
            source_url,
            page_count,
            ocr_model,
          })),
        questions: paperQuestions
          .sort((a, b) => a.question_number - b.question_number)
          .map((question) => ({
            question_number: question.question_number,
            stem_markdown: question.stem_markdown,
            total_marks: question.total_marks,
            source_page_numbers: question.source_page_numbers,
            parts: (partsByQuestion.get(question.id) ?? [])
              .sort((a, b) => a.sort_order - b.sort_order)
              .map(({ label_path, prompt_markdown, marks, source_page_numbers }) => ({
                label_path,
                prompt_markdown,
                marks,
                source_page_numbers,
              })),
            mark_scheme_items: (marksByQuestion.get(question.id) ?? [])
              .sort((a, b) => a.sequence_number - b.sequence_number)
              .map((m) => ({
                sequence_number: m.sequence_number,
                mark_code: m.mark_code,
                content_markdown: m.content_markdown,
                guidance_markdown: m.guidance_markdown,
                is_final_answer: m.is_final_answer,
                is_alternative_method: m.is_alternative_method,
                source_page_numbers: m.source_page_numbers,
              })),
            assets: (assetsByQuestion.get(question.id) ?? []).map((a) => ({
              source_page_number: a.source_page_number,
              source_image_index: a.source_image_index,
              asset_type: a.asset_type,
              storage_path: a.storage_path,
              required_to_solve: a.required_to_solve,
            })),
            metadata: metadataByQuestion.get(question.id)
              ? (({ main_topic, subtopics, skills, methods, question_style, difficulty_level,
                     calculator_required, diagram_required, classification_confidence,
                     review_status }) => ({ main_topic, subtopics, skills, methods, question_style,
                     difficulty_level, calculator_required, diagram_required,
                     classification_confidence, review_status }))(metadataByQuestion.get(question.id))
              : null,
          })),
      }),
    );
  }

  // ---- 4. Manifest --------------------------------------------------------
  const totalBytes = written.reduce((sum, f) => sum + f.bytes, 0);
  written.push(
    writeJson("MANIFEST.json", {
      generated_by: "workflows/n8n/harness/snapshot_fixtures.mjs",
      source_project: new URL(loadConfig().url).host,
      counts: {
        papers: papers.length,
        ingestion_runs: runs.length,
        runs_with_ocr: runsWithOcr,
        ocr_pages: pages.length,
        staged_bundles: bundleCount,
        published_papers: publishedCount,
        published_questions: questions.length,
        published_mark_rows: markItems.length,
      },
      note:
        "Snapshot of the live ingestion corpus. OCR pages are the input side of " +
        "every accuracy measurement; most were already past expires_at when this " +
        "was taken. Published mark rows are Tier B (unreviewed) -- see each " +
        "published/*.json trust block.",
    }),
  );

  console.log(`\n${DRY_RUN ? "Would write" : "Wrote"} ${written.length} files, ` +
    `${(totalBytes / 1024).toFixed(0)} kB total`);
  console.log(`  ocr/        ${runsWithOcr} runs`);
  console.log(`  bundles/    ${bundleCount} staged bundles`);
  console.log(`  published/  ${publishedCount} papers`);
}

main().catch((error) => {
  console.error(`\nsnapshot failed: ${error.message}`);
  process.exitCode = 1;
});
