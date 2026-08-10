// Publish a reviewed batch's papers and index them, in one command.
//
//   node workflows/n8n/harness/publish_batch.mjs --batch v2.3-batch-04
//   node workflows/n8n/harness/publish_batch.mjs --batch v2.3-batch-04 --apply
//   node workflows/n8n/harness/publish_batch.mjs --batch v2.3-batch-04 --apply --skip-embed
//
// WHAT IT REPLACES
//
// Publishing a six-paper batch was six webhook calls plus one or two indexing
// calls, each checked by hand against the staged counts. Fine once; it is the
// largest piece of per-batch manual work, and it grows linearly with the corpus
// while the API cost does not. Ten batches is eighty calls.
//
// WHAT IT DOES NOT DO
//
// It does not approve anything. The publish RPC requires verifier_report.passed,
// which is the recorded human sign-off, and this script REFUSES to publish a run
// without it rather than working around it. Automating the clicking is fine;
// automating the judgement is not, and the two are easy to confuse when the
// clicking is what hurts.
//
// It also never writes to the database directly. Every publication goes through
// the existing publisher workflow, so the same six downstream guards apply --
// run is reviewed, no unresolved blockers, atomic RPC, staging cleanup.
//
// HOW IT FAILS
//
// Smallest paper first, and STOP on the first mismatch. Publication is atomic
// per paper, so stopping leaves a coherent database: N papers published and
// verified, the rest still staged. Continuing past a mismatch would turn one
// bad paper into a partly-published batch nobody can reason about.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { select, rpc } from "./supabase_client.mjs";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));

const N8N_BASE = process.env.N8N_WEBHOOK_BASE ?? "http://localhost:5678/webhook";
const PUBLISH_HOOK = `${N8N_BASE}/shamo-publish-paper`;
const EMBED_HOOK = `${N8N_BASE}/shamo-generate-embeddings`;

// The indexer handles a bounded number of items per call, so it is driven until
// the pending queue is empty. The cap is a runaway guard, not a batch size: if
// pending never reaches zero something is wrong and looping forever would hide
// it behind a spinner.
const MAX_EMBED_PASSES = 12;

const args = process.argv.slice(2);
const batch = args.includes("--batch") ? args[args.indexOf("--batch") + 1] : null;
const apply = args.includes("--apply");
const skipEmbed = args.includes("--skip-embed");

if (!batch) {
  console.error("Pass --batch <key fragment>, e.g. --batch v2.3-batch-04");
  process.exit(1);
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Leave parsed null; the raw text is more useful in the error below.
  }
  if (!response.ok) {
    throw new Error(`POST ${url} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  return parsed;
}

/** Counts a staged bundle should produce, so the publisher's reply can be checked. */
function expectedFromBundle(bundle) {
  const questions = bundle?.questions ?? [];
  let parts = 0;
  let markRows = 0;
  for (const question of questions) {
    const questionParts = question.parts ?? [];
    parts += questionParts.length;
    markRows += (question.root_mark_scheme ?? []).length;
    for (const part of questionParts) {
      markRows += (part.mark_scheme_items ?? []).length;
    }
  }
  return {
    questions: questions.length,
    parts,
    mark_rows: markRows,
    assets: (bundle?.assets ?? []).length,
  };
}

function pickCount(publication, names) {
  for (const name of names) {
    const value = publication?.[name];
    if (typeof value === "number") return value;
  }
  return null;
}

async function main() {
  const runs = await select("shamo_ingestion_runs", {
    columns:
      "id,paper_id,idempotency_key,status,review_status,extraction_summary,validation_report,verifier_report,question_count,question_part_count,asset_count",
    filter: `idempotency_key=like.*${encodeURIComponent(batch)}*`,
  });

  if (!runs.length) {
    console.error(`No ingestion runs matched "${batch}".`);
    return 1;
  }

  const papers = await select("shamo_papers", {
    columns: "id,paper_variant,year,exam_session,status",
  });
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const label = (run) => {
    const paper = paperById.get(run.paper_id);
    return paper
      ? `${paper.paper_variant} ${paper.year} ${paper.exam_session}`
      : `run ${run.id.slice(0, 8)}`;
  };

  const issues = await select("shamo_ingestion_issues", {
    columns: "ingestion_run_id,severity,issue_code,resolved",
    filter: `ingestion_run_id=in.(${runs.map((r) => r.id).join(",")})`,
  });
  const openBlockers = new Map();
  for (const issue of issues) {
    if (issue.resolved) continue;
    if (String(issue.severity).toLowerCase() !== "blocking") continue;
    const list = openBlockers.get(issue.ingestion_run_id) ?? [];
    list.push(issue.issue_code);
    openBlockers.set(issue.ingestion_run_id, list);
  }

  console.log(`Batch "${batch}": ${runs.length} run(s)\n`);

  const publishable = [];
  for (const run of runs) {
    const bundle = run.extraction_summary?.paper_bundle;
    const ready = String(run.extraction_summary?.ready_for_approval) === "true";
    const verified = String(run.verifier_report?.passed) === "true";
    const blockers = openBlockers.get(run.id) ?? [];
    const paper = paperById.get(run.paper_id);
    const alreadyPublished = paper?.status === "published" && !bundle;

    const reasons = [];
    if (alreadyPublished) reasons.push("already published");
    if (!bundle && !alreadyPublished) reasons.push("no staged bundle");
    if (!ready) reasons.push("not ready_for_approval");
    if (!verified) reasons.push("verifier_report.passed is not true (needs your sign-off)");
    if (blockers.length) reasons.push(`${blockers.length} open blocker(s): ${blockers.join(", ")}`);

    if (reasons.length) {
      console.log(`  SKIP    ${label(run)}  -- ${reasons.join("; ")}`);
      continue;
    }
    publishable.push({ run, bundle, expected: expectedFromBundle(bundle) });
  }

  if (!publishable.length) {
    console.log("\nNothing publishable.");
    console.log(
      "If a run is otherwise clean but blocked on verifier_report.passed, that is the\n" +
        "human review gate and this script will not move it. Approve it, then re-run.",
    );
    return 1;
  }

  // Smallest first: if the publisher or the RPC contract has broken, it breaks
  // on the cheapest paper rather than the largest.
  publishable.sort((a, b) => a.expected.questions - b.expected.questions);

  console.log(`\n${publishable.length} paper(s) ready:`);
  for (const item of publishable) {
    const e = item.expected;
    console.log(
      `  ${label(item.run).padEnd(24)} expect ${e.questions}q / ${e.parts}p / ${e.mark_rows}m / ${e.assets}a`,
    );
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to publish and index.");
    return 0;
  }

  console.log("\n--- publishing ---");
  const published = [];
  for (const item of publishable) {
    const name = label(item.run);
    process.stdout.write(`  ${name.padEnd(24)} `);
    let result;
    try {
      result = await post(PUBLISH_HOOK, { ingestion_run_id: item.run.id });
    } catch (error) {
      console.log("FAILED");
      console.log(`\n  ${error.message}`);
      console.log(`\nSTOPPED. ${published.length} paper(s) published before this.`);
      return 1;
    }

    const publication = result?.publication ?? {};
    const actual = {
      questions: pickCount(publication, ["question_count", "published_questions", "questions"]),
      parts: pickCount(publication, ["question_part_count", "published_parts", "parts"]),
      mark_rows: pickCount(publication, [
        "mark_scheme_item_count",
        "published_mark_scheme_items",
        "mark_rows",
      ]),
      assets: pickCount(publication, ["asset_count", "published_assets", "assets"]),
    };

    const mismatches = [];
    for (const key of ["questions", "parts", "mark_rows", "assets"]) {
      if (actual[key] === null) continue; // publisher did not report this count
      if (actual[key] !== item.expected[key]) {
        mismatches.push(`${key}: expected ${item.expected[key]}, published ${actual[key]}`);
      }
    }
    const reported = Object.values(actual).filter((v) => v !== null).length;

    if (mismatches.length) {
      console.log("COUNT MISMATCH");
      for (const mismatch of mismatches) console.log(`      ${mismatch}`);
      console.log(
        `\nSTOPPED. ${published.length} paper(s) published and verified before this one.\n` +
          "Publication is atomic per paper, so the database is coherent: inspect this\n" +
          "paper against its staged bundle before continuing.",
      );
      return 1;
    }

    console.log(
      reported > 0
        ? `ok  ${actual.questions ?? "?"}q / ${actual.parts ?? "?"}p / ${actual.mark_rows ?? "?"}m / ${actual.assets ?? "?"}a`
        : "ok  (publisher reported no counts to verify)",
    );
    if (reported === 0) {
      console.log(
        "      NOTE: nothing was cross-checked for this paper. Verify it by hand.",
      );
    }
    published.push(item);
  }

  console.log(`\n${published.length} paper(s) published, all counts matched.`);

  if (skipEmbed) {
    console.log("\n--skip-embed given; search rows NOT generated. Questions are not searchable yet.");
    return 0;
  }

  console.log("\n--- indexing ---");
  let passes = 0;
  let pending = await countPending();
  console.log(`  pending search candidates: ${pending}`);
  while (pending > 0 && passes < MAX_EMBED_PASSES) {
    passes += 1;
    const result = await post(EMBED_HOOK, {});
    const before = pending;
    pending = await countPending();
    console.log(
      `  pass ${passes}: ${before} -> ${pending}` +
        (result?.items_indexed ? `  (${result.items_indexed} indexed)` : ""),
    );
    if (pending === before) {
      console.log("\n  Pending count did not move. Stopping rather than looping.");
      console.log("  Check the indexer's last execution in n8n.");
      return 1;
    }
  }
  if (pending > 0) {
    console.log(`\n  Still ${pending} pending after ${MAX_EMBED_PASSES} passes. Stopping.`);
    return 1;
  }

  console.log("\n--- verifying ---");
  const checks = await finalChecks();
  let failed = 0;
  for (const check of checks) {
    console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
    if (!check.ok) failed += 1;
  }

  console.log();
  if (failed) {
    console.log(`FAIL -- ${failed} verification check(s) failed after publishing.`);
    return 1;
  }
  console.log(`PASS -- ${published.length} paper(s) published, indexed and verified.`);
  return 0;
}

// The pending queue is defined by the RPC's own logic, not by a column, so it
// has to be asked rather than inferred from a table filter.
//
// requested_limit MUST be passed explicitly. It defaults to 100, so calling
// with no argument caps the answer at 100 and reports a 144-item queue as 100 --
// which would make the progress check below compare two capped numbers and
// conclude the indexer had stalled. Ask for far more than a batch can produce.
const PENDING_QUERY_LIMIT = 5000;

async function countPending() {
  try {
    const items = await rpc("shamo_get_pending_search_items", {
      requested_limit: PENDING_QUERY_LIMIT,
    });
    const count = Array.isArray(items) ? items.length : 0;
    if (count >= PENDING_QUERY_LIMIT) {
      throw new Error(
        `pending queue reached the query limit of ${PENDING_QUERY_LIMIT}; raise PENDING_QUERY_LIMIT`,
      );
    }
    return count;
  } catch (error) {
    // A changed RPC signature must not read as "nothing pending" -- that would
    // silently report an unindexed batch as complete.
    throw new Error(
      `Could not read shamo_get_pending_search_items (${error.message}). ` +
        "Refusing to treat that as a pending count of 0.",
    );
  }
}

async function finalChecks() {
  const search = await select("shamo_question_search", {
    columns: "id,question_id,question_part_id,embedding",
  });
  const nullVectors = search.filter((row) => !row.embedding).length;
  const identities = new Set(
    search.map((row) => `${row.question_id}:${row.question_part_id ?? ""}`),
  );
  const pending = await countPending();

  return [
    {
      name: "pending search candidates",
      ok: pending === 0,
      detail: `${pending}`,
    },
    {
      name: "null embeddings",
      ok: nullVectors === 0,
      detail: `${nullVectors} of ${search.length} search rows`,
    },
    {
      name: "duplicate search identities",
      ok: identities.size === search.length,
      detail: `${search.length - identities.size}`,
    },
  ];
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
