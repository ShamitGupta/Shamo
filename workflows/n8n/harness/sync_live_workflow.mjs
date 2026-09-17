// Compare a live n8n workflow's Code nodes against the generated repo JSON, and
// optionally push the repo version live.
//
//   node workflows/n8n/harness/sync_live_workflow.mjs                 # report drift
//   node workflows/n8n/harness/sync_live_workflow.mjs --apply         # push all drifted nodes
//   node workflows/n8n/harness/sync_live_workflow.mjs --apply --node "Pair and Select Test 2 Papers"
//
// WHY THIS EXISTS
//
// On 10 August the live controller was found still running the OLD paper
// selection code -- the one with `if (pairs.length !== 24) throw` and `% 4`
// indexing. The fix had been written into the generator on 8 August, validated
// by check_batch_selection.mjs, recorded as done, and never deployed. Adding a
// single row to the manifest would have thrown; batch_number 5 would have
// wrapped around onto already-published papers.
//
// Repo JSON is not evidence of what is running. That was already written down,
// but nothing measured it, so the drift sat there silently for two days. This
// measures it.
//
// SAFETY
//
// - Reports by default. Writing requires --apply.
// - Refuses any workflow not named "Shamo Budget" or "Shamo Harness".
// - Backs the live workflow up to a timestamped file before every write.
// - Sends only name/nodes/connections/settings, with settings filtered to keys
//   the public API accepts. Writing an unfiltered body silently DROPS unknown
//   settings keys (binaryMode and availableInMCP were lost this way on
//   8 August), so the filter is what makes a write non-destructive.
// - Copies credentials through untouched: they live on the live node and are
//   absent from generated JSON, so a naive node replacement would strip them.
//   That would break every HTTP node in the workflow.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const N8N_DIR = path.resolve(HARNESS, "..");

// Live workflow id -> generated JSON that is meant to define it.
const TARGETS = {
  KYZZfrDq0nwN96PJ: "shamo_budget_v2_1_test2_six_paper_controller.json",
  YnY7rMfDFvfqzdvG: "shamo_budget_v2_1_stage_one_math_paper.json",
};

const ALLOWED_NAME_PREFIXES = ["Shamo Budget", "Shamo Harness"];

// Nodes that are SUPPOSED to differ from the generated JSON, because they hold
// live operational state rather than logic. Syncing these would be actively
// destructive:
//
//   Budget Configuration -- live carries the real Supabase project URL, the
//   current batch_number and the deployed workflow_version. The generated
//   template carries a YOUR_PROJECT_REF placeholder that the workflow's own
//   guard throws on, so pushing it would break the controller outright and
//   also silently reset which papers the next batch selects.
//
// Drift here is reported as expected, never as a defect.
const NEVER_SYNC = new Set(["Budget Configuration"]);

// n8n's public API rejects or silently drops settings keys outside this set.
const SETTINGS_KEYS = [
  "saveExecutionProgress",
  "saveManualExecutions",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "executionTimeout",
  "errorWorkflow",
  "timezone",
  "executionOrder",
];

function n8nApiKey() {
  if (process.env.N8N_API_KEY) return process.env.N8N_API_KEY;
  const claudeConfig = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".claude.json");
  if (fs.existsSync(claudeConfig)) {
    const match = fs.readFileSync(claudeConfig, "utf8").match(/"N8N_API_KEY"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
  }
  throw new Error("No n8n API key. Set N8N_API_KEY or add it to ~/.claude.json.");
}

const BASE = process.env.N8N_API_URL ?? "http://localhost:5678/api/v1";
const KEY = n8nApiKey();

async function api(method, endpoint, body) {
  const response = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${endpoint} -> ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

function codeOf(node) {
  return node?.parameters?.jsCode ?? null;
}

/** First line that differs, so a report says WHERE rather than just "differs". */
function firstDifference(a, b) {
  const left = a.split("\n");
  const right = b.split("\n");
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) {
      return {
        line: i + 1,
        live: (left[i] ?? "(end of file)").trim().slice(0, 100),
        repo: (right[i] ?? "(end of file)").trim().slice(0, 100),
      };
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const onlyNode = args.includes("--node") ? args[args.indexOf("--node") + 1] : null;

  let drifted = 0;

  for (const [workflowId, generatedFile] of Object.entries(TARGETS)) {
    const generatedPath = path.join(N8N_DIR, generatedFile);
    if (!fs.existsSync(generatedPath)) {
      console.log(`SKIP  ${workflowId}: ${generatedFile} not found`);
      continue;
    }

    const generated = JSON.parse(fs.readFileSync(generatedPath, "utf8"));
    const live = await api("GET", `/workflows/${workflowId}`);

    console.log(`\n=== ${live.name}  (${workflowId}) ===`);
    console.log(`    generated from: ${generatedFile}`);
    console.log(`    live nodes: ${live.nodes.length}   generated nodes: ${generated.nodes.length}`);

    if (!ALLOWED_NAME_PREFIXES.some((prefix) => live.name.startsWith(prefix))) {
      console.log(`    REFUSING: name does not start with ${ALLOWED_NAME_PREFIXES.join(" or ")}`);
      continue;
    }

    const generatedByName = new Map(generated.nodes.map((node) => [node.name, node]));
    const changes = [];

    for (const liveNode of live.nodes) {
      if (onlyNode && liveNode.name !== onlyNode) continue;
      const liveCode = codeOf(liveNode);
      if (liveCode === null) continue; // not a Code node

      const generatedNode = generatedByName.get(liveNode.name);
      if (!generatedNode) {
        console.log(`    live-only node (no generated counterpart): ${liveNode.name}`);
        continue;
      }
      const generatedCode = codeOf(generatedNode);
      if (generatedCode === null || liveCode === generatedCode) continue;

      if (NEVER_SYNC.has(liveNode.name)) {
        console.log(`    expected drift (never synced): ${liveNode.name}`);
        continue;
      }

      const diff = firstDifference(liveCode, generatedCode);
      console.log(`    DRIFT  ${liveNode.name}`);
      console.log(`           live ${liveCode.length}B vs repo ${generatedCode.length}B`);
      if (diff) {
        console.log(`           first difference at line ${diff.line}:`);
        console.log(`             live: ${diff.live}`);
        console.log(`             repo: ${diff.repo}`);
      }
      changes.push({ name: liveNode.name, code: generatedCode });
      drifted += 1;
    }

    if (!changes.length) {
      console.log("    in sync");
      continue;
    }
    if (!apply) {
      console.log(`    ${changes.length} node(s) would be updated. Re-run with --apply.`);
      continue;
    }

    const stamp = live.updatedAt?.replace(/[:.]/g, "-") ?? "unknown";
    const backup = path.join(HARNESS, `backup_${workflowId}_${stamp}.json`);
    fs.writeFileSync(backup, JSON.stringify(live, null, 2));
    console.log(`    backup: ${path.relative(process.cwd(), backup)}`);

    // Replace only jsCode. Everything else on the live node -- credentials,
    // retry settings, position, id -- is preserved by construction.
    const nameToCode = new Map(changes.map((change) => [change.name, change.code]));
    const nodes = live.nodes.map((node) =>
      nameToCode.has(node.name)
        ? { ...node, parameters: { ...node.parameters, jsCode: nameToCode.get(node.name) } }
        : node,
    );

    const settings = {};
    for (const key of SETTINGS_KEYS) {
      if (live.settings && key in live.settings) settings[key] = live.settings[key];
    }

    await api("PUT", `/workflows/${workflowId}`, {
      name: live.name,
      nodes,
      connections: live.connections,
      settings,
    });

    const after = await api("GET", `/workflows/${workflowId}`);
    const credentialsBefore = live.nodes.filter((n) => n.credentials).length;
    const credentialsAfter = after.nodes.filter((n) => n.credentials).length;
    let verified = 0;
    for (const change of changes) {
      const node = after.nodes.find((n) => n.name === change.name);
      if (codeOf(node) === change.code) verified += 1;
    }
    console.log(`    applied: ${verified}/${changes.length} node(s) verified byte-identical`);
    console.log(`    nodes ${live.nodes.length} -> ${after.nodes.length}`);
    console.log(`    credentials preserved: ${credentialsBefore} -> ${credentialsAfter}`);
    if (verified !== changes.length || credentialsAfter !== credentialsBefore) {
      throw new Error("Post-write verification failed. Restore from the backup above.");
    }
  }

  console.log();
  if (!drifted) {
    console.log("PASS -- live workflows match the generated JSON.");
    return 0;
  }
  if (!process.argv.includes("--apply")) {
    console.log(`DRIFT -- ${drifted} node(s) differ from the repo. Nothing was written.`);
    return 1;
  }
  console.log(`APPLIED -- ${drifted} node(s) synced.`);
  return 0;
}

// process.exitCode rather than process.exit(): an immediate exit while fetch
// handles are still closing trips a libuv assertion on Windows, which reads
// like a crash in the middle of an otherwise clean report.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
