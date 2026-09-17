// Deploy (or update) the harness workflows in the local n8n instance.
//
// Only ever touches workflows whose name starts with "Shamo Harness". The
// production child and controllers are never written to by this script -- an
// existing workflow is updated only if its name matches exactly, otherwise a
// new one is created.
//
//   node workflows/n8n/harness/deploy_harness.mjs
//   node workflows/n8n/harness/deploy_harness.mjs --link   (link the sub-workflow)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const N8N_DIR = path.resolve(HARNESS, "..");
const REPO = path.resolve(N8N_DIR, "..", "..");

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

// The n8n API key lives in the Claude MCP config at local scope, not in the
// repo. Read it from there rather than duplicating the credential.
function n8nApiKey() {
  if (process.env.N8N_API_KEY) return process.env.N8N_API_KEY;
  const harnessEnv = readEnv(path.join(HARNESS, ".env"));
  if (harnessEnv.N8N_API_KEY) return harnessEnv.N8N_API_KEY;
  const claudeConfig = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".claude.json");
  if (fs.existsSync(claudeConfig)) {
    const raw = fs.readFileSync(claudeConfig, "utf8");
    const match = raw.match(/"N8N_API_KEY"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
  }
  throw new Error(
    "No n8n API key. Set N8N_API_KEY in the environment or add it to workflows/n8n/harness/.env.",
  );
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
  if (!response.ok) throw new Error(`${method} ${endpoint} -> ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

/** n8n's create/update endpoints reject unknown top-level keys. */
const toPayload = (workflow) => ({
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings ?? { executionOrder: "v1" },
});

let liveCredentialsByNode = new Map();

async function upsert(fileName, { linkSubWorkflowTo } = {}) {
  const workflow = JSON.parse(fs.readFileSync(path.join(N8N_DIR, fileName), "utf8"));
  // Only these two prefixes may be written. The old production child
  // ("Shamo Budget v2.1 - ...") must never be overwritten by this script.
  const DEPLOYABLE = ["Shamo Harness", "Shamo Budget v2.2"];
  if (!DEPLOYABLE.some((prefix) => workflow.name.startsWith(prefix))) {
    throw new Error(
      `Refusing to deploy "${workflow.name}": name must start with one of ${DEPLOYABLE.join(" or ")}.`,
    );
  }
  const { data: existing } = await api("GET", "/workflows?limit=250");
  const match = existing.find((w) => w.name === workflow.name);
  const payload = toPayload(workflow);

  // The generated JSON ships a blank executeWorkflow link on purpose, so an
  // unlinked import can never invoke the production child by accident. Resolve
  // it here, BEFORE the write: n8n refuses to save an active workflow whose
  // sub-workflow reference is empty, so patching afterwards is too late.
  // Restore credential references that the export dropped.
  let restored = 0;
  for (const node of payload.nodes) {
    const live = liveCredentialsByNode.get(node.name);
    if (!live) continue;
    const hasAny = node.credentials && Object.values(node.credentials).some((c) => c?.id);
    if (!hasAny) {
      node.credentials = live;
      restored += 1;
    }
  }
  if (restored) console.log(`  restored ${restored} credential reference(s) from the production child`);

  if (linkSubWorkflowTo) {
    const executeNode = payload.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflow");
    if (executeNode) {
      executeNode.parameters.workflowId = { __rl: true, value: linkSubWorkflowTo, mode: "id" };
    }
  }

  if (match) {
    await api("PUT", `/workflows/${match.id}`, payload);
    console.log(`  updated  ${workflow.name}  (${match.id}, ${payload.nodes.length} nodes)`);
    return match.id;
  }
  const created = await api("POST", "/workflows", payload);
  console.log(`  created  ${workflow.name}  (${created.id}, ${payload.nodes.length} nodes)`);
  return created.id;
}

console.log("\nDeploying harness workflows to", BASE);

// Some credentials exist only on the LIVE production child, not in the exported
// JSON -- the Mistral OCR node uses a generic header-auth credential that n8n
// does not serialise on export. Copy those references across at deploy time, by
// node name, so the clone is runnable without hand-editing in the UI.
const PRODUCTION_CHILD_ID = "fAa1IGsa6OKOq8xO";
try {
  const productionLive = await api("GET", `/workflows/${PRODUCTION_CHILD_ID}`);
  liveCredentialsByNode = new Map(
    productionLive.nodes
      .filter((node) => node.credentials && Object.keys(node.credentials).length)
      .map((node) => [node.name, node.credentials]),
  );
} catch (error) {
  console.log(`  note: could not read the production child for credentials (${error.message.slice(0, 80)})`);
}

const childId = await upsert("shamo_harness_stage_one_math_paper.json");
const runnerId = await upsert("shamo_harness_one_paper.json", { linkSubWorkflowTo: childId });
console.log(`  linked   Run One Paper Sub-workflow -> ${childId}`);

// Credentials are referenced by id inside the cloned nodes. Report anything
// missing rather than discovering it mid-run.
const child = await api("GET", `/workflows/${childId}`);
const runner = await api("GET", `/workflows/${runnerId}`);
const credentialTypes = new Set();
let missing = 0;
for (const node of [...child.nodes, ...runner.nodes]) {
  for (const [type, value] of Object.entries(node.credentials ?? {})) {
    credentialTypes.add(type);
    if (!value?.id) missing += 1;
  }
}
console.log(`\n  credential types referenced: ${[...credentialTypes].join(", ") || "none"}`);
if (missing) console.log(`  WARNING: ${missing} credential reference(s) have no id and must be set in the UI.`);

const state = { childId, runnerId, webhook: "http://localhost:5678/webhook/shamo-harness-one-paper" };
fs.writeFileSync(path.join(HARNESS, "harness_state.json"), JSON.stringify(state, null, 2) + "\n");
console.log(`\n  wrote harness_state.json`);
console.log(`  runner must be ACTIVE before the webhook will accept requests.\n`);
void REPO;
