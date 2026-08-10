// Drive several ingestion batches unattended, checking each one before the next.
//
//   node workflows/n8n/harness/run_batches.mjs --batches 5,6,7 --dry-run
//   node workflows/n8n/harness/run_batches.mjs --batches 5,6,7,8,9,10,11,13,14 --apply
//
// WHY
//
// A six-paper batch takes ~50 minutes measured, so ten batches is ~8.5 hours of
// firing a webhook and waiting. That is the largest remaining piece of manual
// work per batch and it scales with the corpus while the API cost does not.
//
// WHAT IT ADDS BEYOND A LOOP
//
// Each batch is checked before the next one starts, so a systemic break stops
// the run instead of repeating nine more times. The checks are the existing free
// ones -- staged counts, printed mark allocations, prose fidelity, OCR against
// the PDF text layer -- driven automatically instead of by hand.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It stages only. It does not publish, does not approve, and does not embed.
// Publication needs verifier_report.passed, which is the human sign-off, and
// making an 8-hour unattended script able to publish would put 59 papers into
// student-visible content with nobody having looked. Use publish_batch.mjs
// afterwards, per batch, once you have reviewed.
//
// HONEST LIMIT ON "CHECKING QUALITY"
//
// These checks catch defect classes someone has already met and written a rule
// for. 59 unseen papers will probably surface something new, and no check here
// will see it -- that is exactly why this run is also the first honest autonomy
// measurement. A clean report means "nothing we know how to detect", not
// "correct".

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { select } from "./supabase_client.mjs";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
// harness -> n8n -> workflows -> repo root. THREE levels, not two.
//
// This was `resolve(HARNESS, "..", "..")`, which lands on workflows/ and made
// every spawned check resolve to workflows/workflows/n8n/harness/... So all six
// checks failed with MODULE_NOT_FOUND on batches 4 and 5, and the run reported
// "6 check(s) reported something" for two batches whose data was in fact fine.
// A gate that fails open is worse than no gate; a gate that fails LOUD but for
// the wrong reason trains you to ignore it, which is worse still.
const REPO = path.resolve(HARNESS, "..", "..", "..");
const PDF_DIR = path.join(REPO, "tmp", "pdfs");

const N8N_BASE = process.env.N8N_WEBHOOK_BASE ?? "http://localhost:5678/webhook";
const BATCH_HOOK = `${N8N_BASE}/shamo-run-batch`;
const PREFLIGHT_HOOK = `${N8N_BASE}/shamo-preflight-selection`;

const VERSION_TAG = "v2.3";
const SHEET_NAME = "Batch 5";

// Guards. Each one stops the run rather than continuing into a worse state.
const LIMITS = {
  batchTimeoutMinutes: 120, // measured ~50; 120 means genuinely stuck
  minPapersStaged: 4, // fewer than this out of 6 is systemic, not bad luck
  databaseMegabytes: 320, // the workflow's own admission stop is 350
  campaignUsd: 12.0, // ledger; the DB-enforced campaign cap is 15
  pollSeconds: 60,
};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const batchList = (args.includes("--batches") ? args[args.indexOf("--batches") + 1] : "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

if (!batchList.length) {
  console.error("Pass --batches 5,6,7 (comma separated).");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString().slice(11, 19) + "Z";

async function post(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`POST ${url} -> ${response.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function run(command, commandArgs, label) {
  try {
    const output = execFileSync(command, commandArgs, {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, output };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}` || `${label} failed: ${error.message}`,
    };
  }
}

const batchKeyFor = (n) =>
  `a-level-9709-test2-pilot-v1-${VERSION_TAG}-batch-${String(n).padStart(2, "0")}`;

async function batchRow(n) {
  const rows = await select("shamo_ingestion_batches", {
    columns: "batch_key,status,planned_papers,actual_usd,reserved_usd,finished_at",
    filter: `batch_key=eq.${batchKeyFor(n)}`,
  });
  return rows[0] ?? null;
}

async function runsFor(n) {
  const runs = await select("shamo_ingestion_runs", {
    columns:
      "id,paper_id,status,review_status,question_count,question_part_count,asset_count,extraction_summary,started_at,finished_at",
    filter: `idempotency_key=like.*${encodeURIComponent(`${VERSION_TAG}-batch-${String(n).padStart(2, "0")}`)}*`,
  });
  const papers = await select("shamo_papers", {
    columns: "id,paper_variant,year,exam_session,status",
  });
  const byId = new Map(papers.map((p) => [p.id, p]));
  return runs.map((r) => {
    const paper = byId.get(r.paper_id);
    return {
      ...r,
      label: paper ? `${paper.paper_variant} ${paper.year} ${paper.exam_session.slice(0, 3)}` : r.id.slice(0, 8),
    };
  });
}

async function guardsOk() {
  const usage = await select("shamo_database_usage", { columns: "database_megabytes" });
  const megabytes = Number(usage[0]?.database_megabytes ?? 0);
  const batches = await select("shamo_ingestion_batches", { columns: "campaign_key,actual_usd" });
  const spend = batches
    .filter((b) => b.campaign_key === "a-level-9709-test2-pilot-v1")
    .reduce((total, b) => total + Number(b.actual_usd ?? 0), 0);

  const problems = [];
  if (megabytes >= LIMITS.databaseMegabytes) {
    problems.push(`database ${megabytes.toFixed(1)} MB >= limit ${LIMITS.databaseMegabytes} MB`);
  }
  if (spend >= LIMITS.campaignUsd) {
    problems.push(`campaign ledger $${spend.toFixed(6)} >= limit $${LIMITS.campaignUsd}`);
  }
  return { ok: !problems.length, problems, megabytes, spend };
}

/** Download this batch's PDFs under their Cambridge filenames, skipping any already present. */
async function fetchPdfs(batchNumber) {
  const preflight = await post(PREFLIGHT_HOOK, {
    sheet_name: SHEET_NAME,
    batch_number: batchNumber,
  });
  fs.mkdirSync(PDF_DIR, { recursive: true });
  let downloaded = 0;
  let skipped = 0;
  for (const paper of preflight.selected ?? []) {
    for (const url of [paper.question_paper_url, paper.mark_scheme_url]) {
      if (!url) continue;
      const name = url.split("/").pop();
      const target = path.join(PDF_DIR, name);
      if (fs.existsSync(target) && fs.statSync(target).size > 10_000) {
        skipped += 1;
        continue;
      }
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`      could not fetch ${name}: ${response.status}`);
        continue;
      }
      fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
      downloaded += 1;
    }
  }
  return { downloaded, skipped, papers: (preflight.selected ?? []).length };
}

/** The free offline checks, driven for one batch. Returns findings, not a verdict. */
async function qualityGate(batchNumber) {
  const tag = `${VERSION_TAG}-batch-${String(batchNumber).padStart(2, "0")}`;
  const findings = [];

  console.log(`   ${stamp()} caching PDFs`);
  try {
    const pdfs = await fetchPdfs(batchNumber);
    console.log(`      ${pdfs.downloaded} downloaded, ${pdfs.skipped} already cached`);
  } catch (error) {
    findings.push(`PDF download failed: ${error.message}`);
  }

  const steps = [
    ["snapshot OCR", "node", ["workflows/n8n/harness/snapshot_fixtures.mjs"]],
    ["export staged bundles", "node", ["workflows/n8n/harness/export_staged.mjs", "--batch", tag]],
    ["extract PDF text", "python", ["workflows/n8n/harness/extract_pdf_text.py", PDF_DIR]],
    ["content vs PDF", "node", ["workflows/n8n/harness/check_content_vs_pdf.mjs"]],
    ["OCR vs PDF", "node", ["workflows/n8n/harness/check_ocr_vs_pdf.mjs"]],
    ["autonomy replay", "node", ["workflows/n8n/harness/check_autonomy.mjs"]],
  ];

  for (const [label, command, commandArgs] of steps) {
    console.log(`   ${stamp()} ${label}`);
    const result = run(command, commandArgs, label);
    const tail = result.output.trim().split("\n").slice(-4).join("\n      ");
    console.log(`      ${tail || "(no output)"}`);
    if (!result.ok) findings.push(`${label} reported a problem`);
  }
  return findings;
}

async function waitForBatch(batchNumber) {
  const deadline = Date.now() + LIMITS.batchTimeoutMinutes * 60_000;
  let lastReport = "";
  while (Date.now() < deadline) {
    const row = await batchRow(batchNumber);
    const runs = await runsFor(batchNumber);
    const done = runs.filter((r) => r.finished_at).length;
    const report = `${row?.status ?? "no batch row"}  ${done}/${row?.planned_papers ?? "?"} papers finished`;
    if (report !== lastReport) {
      console.log(`   ${stamp()} ${report}`);
      lastReport = report;
    }
    if (row && row.status !== "processing" && row.status !== "planned") return row;
    await sleep(LIMITS.pollSeconds * 1000);
  }
  return null;
}

async function main() {
  console.log(`Sheet "${SHEET_NAME}", version ${VERSION_TAG}`);
  console.log(`Batches: ${batchList.join(", ")}`);
  console.log(`Mode: ${apply ? "APPLY -- will stage papers and spend" : "dry run"}\n`);

  const preGuards = await guardsOk();
  console.log(
    `Guards: database ${preGuards.megabytes.toFixed(1)} MB, campaign ledger $${preGuards.spend.toFixed(6)}`,
  );
  if (!preGuards.ok) {
    console.log(`STOP before starting: ${preGuards.problems.join("; ")}`);
    return 1;
  }

  // Show every batch's papers up front, so an unattended run is auditable
  // afterwards against what it was asked to do.
  console.log("\nPlanned:");
  for (const n of batchList) {
    try {
      const preflight = await post(PREFLIGHT_HOOK, { sheet_name: SHEET_NAME, batch_number: n });
      const labels = (preflight.selected ?? []).map((s) => s.identity.replace("9709/", "")).join(", ");
      console.log(`  batch ${String(n).padStart(2)}: ${labels}`);
    } catch (error) {
      console.log(`  batch ${String(n).padStart(2)}: preflight FAILED -- ${error.message}`);
      return 1;
    }
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to stage.");
    return 0;
  }

  const summary = [];
  for (const n of batchList) {
    console.log(`\n${"=".repeat(64)}\nBATCH ${n}   ${stamp()}\n${"=".repeat(64)}`);

    const guards = await guardsOk();
    if (!guards.ok) {
      console.log(`STOP: ${guards.problems.join("; ")}`);
      summary.push({ n, outcome: "stopped by guard", detail: guards.problems.join("; ") });
      break;
    }

    // Fire ONLY when nothing is already running or finished for this batch.
    //
    // An earlier version read `if (existing && existing.status !== "processing")`
    // as "already ran, skip" -- which sent a batch that WAS processing down the
    // else branch and fired a second controller execution on top of the first.
    // The child's own "paper already has a processing run" guard caught it before
    // any paid stage, so it cost nothing, but the guard is the backstop and this
    // condition is the actual fix.
    const existing = await batchRow(n);
    const alreadyRunning = existing?.status === "processing";
    const alreadyFinished = existing && !["processing", "planned"].includes(existing.status);

    if (alreadyRunning) {
      console.log(`   ${stamp()} already running -- not firing again, waiting on it`);
    } else if (alreadyFinished) {
      console.log(`   ${stamp()} already ran (${existing.status}) -- not firing, checking it anyway`);
    } else {
      console.log(`   ${stamp()} firing controller`);
      // Fire and do not await: the webhook holds the connection for the whole
      // ~50-minute run, and the database is the authoritative progress signal.
      post(BATCH_HOOK, { batch_number: n }).catch((error) => {
        console.log(`   ${stamp()} webhook connection ended: ${error.message}`);
      });
      await sleep(15_000);
    }

    const row = await waitForBatch(n);
    if (!row) {
      console.log(`STOP: batch ${n} did not finish within ${LIMITS.batchTimeoutMinutes} minutes.`);
      summary.push({ n, outcome: "timed out" });
      break;
    }

    const runs = await runsFor(n);
    const staged = runs.filter((r) => r.finished_at);
    const ready = staged.filter((r) => String(r.extraction_summary?.ready_for_approval) === "true");
    console.log(`\n   staged ${staged.length}/${row.planned_papers}, ready ${ready.length}`);
    for (const r of staged) {
      const ok = String(r.extraction_summary?.ready_for_approval) === "true";
      console.log(
        `      ${ok ? "clean  " : "BLOCKED"} ${r.label.padEnd(20)} ${r.question_count ?? "?"}q / ${r.question_part_count ?? "?"}p / ${r.asset_count ?? "?"}a`,
      );
    }
    console.log(`   cost $${Number(row.actual_usd ?? 0).toFixed(6)}`);

    if (staged.length < LIMITS.minPapersStaged) {
      console.log(`\nSTOP: only ${staged.length} of ${row.planned_papers} papers staged.`);
      summary.push({ n, outcome: "too few staged", staged: staged.length });
      break;
    }

    const findings = await qualityGate(n);
    summary.push({
      n,
      outcome: "staged",
      staged: staged.length,
      ready: ready.length,
      usd: Number(row.actual_usd ?? 0),
      findings,
    });
    if (findings.length) {
      console.log(`\n   ${findings.length} check(s) reported something -- continuing, review later:`);
      for (const finding of findings) console.log(`      ${finding}`);
    }
  }

  console.log(`\n${"=".repeat(64)}\nSUMMARY\n${"=".repeat(64)}`);
  let totalUsd = 0;
  let totalReady = 0;
  let totalStaged = 0;
  for (const item of summary) {
    totalUsd += item.usd ?? 0;
    totalReady += item.ready ?? 0;
    totalStaged += item.staged ?? 0;
    console.log(
      `  batch ${String(item.n).padStart(2)}: ${item.outcome}` +
        (item.staged !== undefined ? `  ${item.ready ?? 0}/${item.staged} clean` : "") +
        (item.usd ? `  $${item.usd.toFixed(6)}` : "") +
        (item.findings?.length ? `  ${item.findings.length} finding(s)` : ""),
    );
  }
  console.log(`\n  ${totalReady}/${totalStaged} papers staged clean, ledger $${totalUsd.toFixed(6)}`);
  console.log(
    "\n  NOTHING WAS PUBLISHED. Review, set verifier_report.passed, then:\n" +
      `    node workflows/n8n/harness/publish_batch.mjs --batch ${VERSION_TAG}-batch-NN --apply`,
  );
  return summary.some((s) => s.outcome !== "staged") ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  },
);
