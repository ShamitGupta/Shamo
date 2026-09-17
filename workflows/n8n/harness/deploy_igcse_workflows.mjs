// Deploy (or update) the IGCSE 0606 2024-2025 campaign workflows to the local
// n8n instance. Mirrors deploy_harness.mjs's approach: only ever touches
// workflows whose name starts with the IGCSE prefix below, restores
// credential references the generator cannot bake in (Mistral OCR's generic
// header-auth credential is never serialised into generated JSON), patches
// the Budget Configuration node's real Supabase URL, and links the
// controller's sub-workflow call to the newly created child.
//
//   node workflows/n8n/harness/deploy_igcse_workflows.mjs
//
// SAFETY
// - Refuses to touch any workflow whose name doesn't start with
//   "Shamo Budget v2.1 - IGCSE" -- the 9709 production workflows are never
//   read for writing and never targeted for creation/update by this script.
// - Existing workflow is updated (PUT) only if its name matches exactly;
//   otherwise a new one is created (POST). Safe to re-run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const N8N_DIR = path.resolve(HARNESS, "..");

const DEPLOYABLE_PREFIX = "Shamo Budget v2.1 - IGCSE";
const PRODUCTION_CHILD_ID = "YnY7rMfDFvfqzdvG"; // read-only credential source
const SUPABASE_URL = "https://exjfaggqphjkxniyshfl.supabase.co";

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

const toPayload = (workflow) => ({
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings ?? { executionOrder: "v1" },
});

async function upsert(fileName, { patchSupabaseUrl, linkSubWorkflowTo, credentialsByNode } = {}) {
  const workflow = JSON.parse(fs.readFileSync(path.join(N8N_DIR, fileName), "utf8"));
  if (!workflow.name.startsWith(DEPLOYABLE_PREFIX)) {
    throw new Error(`Refusing to deploy "${workflow.name}": name must start with "${DEPLOYABLE_PREFIX}".`);
  }
  const { data: existing } = await api("GET", "/workflows?limit=250");
  const match = existing.find((w) => w.name === workflow.name);
  const payload = toPayload(workflow);

  let restored = 0;
  for (const node of payload.nodes) {
    const live = credentialsByNode?.get(node.name);
    if (!live) continue;
    const hasAny = node.credentials && Object.values(node.credentials).some((c) => c?.id);
    if (!hasAny) {
      node.credentials = live;
      restored += 1;
    }
  }
  if (restored) console.log(`  restored ${restored} credential reference(s) from the production child`);

  if (patchSupabaseUrl) {
    const budgetNode = payload.nodes.find((node) => node.name === "Budget Configuration");
    if (budgetNode && budgetNode.parameters?.jsCode?.includes("YOUR_PROJECT_REF")) {
      budgetNode.parameters.jsCode = budgetNode.parameters.jsCode.replace(
        "https://YOUR_PROJECT_REF.supabase.co",
        SUPABASE_URL,
      );
      console.log(`  patched Budget Configuration supabase_url -> ${SUPABASE_URL}`);
    }
  }

  if (linkSubWorkflowTo) {
    const executeNode = payload.nodes.find((node) => node.type === "n8n-nodes-base.executeWorkflow");
    if (executeNode) {
      executeNode.parameters.workflowId = { __rl: true, value: linkSubWorkflowTo, mode: "id" };
      console.log(`  linked sub-workflow -> ${linkSubWorkflowTo}`);
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

console.log("\nDeploying IGCSE 0606 2024-2025 workflows to", BASE);

let credentialsByNode = new Map();
try {
  const productionChild = await api("GET", `/workflows/${PRODUCTION_CHILD_ID}`);
  credentialsByNode = new Map(
    productionChild.nodes
      .filter((node) => node.credentials && Object.keys(node.credentials).length)
      .map((node) => [node.name, node.credentials]),
  );
  console.log(`  read ${credentialsByNode.size} credentialed node(s) from the production 9709 child (read-only)`);
} catch (error) {
  console.log(`  note: could not read the production child for credentials (${error.message.slice(0, 80)})`);
}

const childId = await upsert("shamo_budget_igcse_0606_2024_2025_v2_1_stage_one_paper.json", {
  credentialsByNode,
});
const controllerId = await upsert("shamo_budget_igcse_0606_2024_2025_v2_1_controller.json", {
  patchSupabaseUrl: true,
  linkSubWorkflowTo: childId,
  credentialsByNode,
});

const child = await api("GET", `/workflows/${childId}`);
const controller = await api("GET", `/workflows/${controllerId}`);
const credentialTypes = new Set();
let missing = 0;
for (const node of [...child.nodes, ...controller.nodes]) {
  for (const [type, value] of Object.entries(node.credentials ?? {})) {
    credentialTypes.add(type);
    if (!value?.id) missing += 1;
  }
}
console.log(`\n  credential types referenced: ${[...credentialTypes].join(", ") || "none"}`);
if (missing) console.log(`  WARNING: ${missing} credential reference(s) have no id and must be set in the UI.`);

console.log(`\n  child      ${childId}   (inactive by default)`);
console.log(`  controller ${controllerId}   (inactive by default)`);
console.log(`  Both workflows are created INACTIVE. Nothing runs until manually triggered in the n8n UI.`);
