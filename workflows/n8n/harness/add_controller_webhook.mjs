// Give the production controller a webhook trigger alongside its manual one.
//
// WHY
// ---
// The controller's only trigger is `manualTrigger`, and n8n's public API has no
// execute endpoint for those -- a batch can be started only by a human clicking
// Execute in the UI. That is a real operational limit for scale, not just an
// inconvenience for an agent: it means no scheduled or programmatic batch runs.
//
// Adding a second trigger wired into the same first node leaves the manual path
// untouched -- the operator can still click Execute exactly as before -- while
// making the same batch startable over HTTP.
//
// SAFETY. This does not weaken any guard. The controller's own budget caps,
// database-size admission check, published-paper skip and one-per-type paper
// selection all run identically whichever trigger fired. The webhook carries no
// parameters, so a caller cannot raise a cap or choose different papers.
//
//   node workflows/n8n/harness/add_controller_webhook.mjs            (dry run)
//   node workflows/n8n/harness/add_controller_webhook.mjs --apply
//   node workflows/n8n/harness/add_controller_webhook.mjs --restore <backup.json>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const BACKUPS = path.join(HARNESS, "backups");

const CONTROLLER_ID = "KYZZfrDq0nwN96PJ";
const WEBHOOK_PATH = "shamo-run-batch";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const restore = args.includes("--restore") ? args[args.indexOf("--restore") + 1] : null;
const setVersion = args.includes("--version") ? args[args.indexOf("--version") + 1] : null;

function apiKey() {
  if (process.env.N8N_API_KEY) return process.env.N8N_API_KEY;
  const envFile = path.join(HARNESS, ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const [k, ...rest] = line.split("=");
      if (k?.trim() === "N8N_API_KEY") return rest.join("=").trim();
    }
  }
  const claude = path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".claude.json");
  if (fs.existsSync(claude)) {
    const match = fs.readFileSync(claude, "utf8").match(/"N8N_API_KEY"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
  }
  throw new Error("No n8n API key found.");
}

const BASE = process.env.N8N_API_URL ?? "http://localhost:5678/api/v1";
const KEY = apiKey();

async function api(method, endpoint, body) {
  const response = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: { "X-N8N-API-KEY": KEY, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint} -> ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

// n8n rejects unknown settings keys on write, and silently drops ones it does
// not recognise -- send only what it accepts.
const ALLOWED_SETTINGS = new Set([
  "executionOrder",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "saveManualExecutions",
  "saveExecutionProgress",
  "executionTimeout",
  "errorWorkflow",
  "timezone",
]);

const toPayload = (wf) => ({
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  settings: Object.fromEntries(
    Object.entries(wf.settings ?? { executionOrder: "v1" }).filter(([k]) => ALLOWED_SETTINGS.has(k)),
  ),
});

if (restore) {
  const saved = JSON.parse(fs.readFileSync(restore, "utf8"));
  await api("PUT", `/workflows/${CONTROLLER_ID}`, toPayload(saved));
  console.log(`Restored ${saved.name} from ${path.basename(restore)}`);
  process.exit(0);
}

const workflow = await api("GET", `/workflows/${CONTROLLER_ID}`);
console.log(`\n${workflow.name}  (${workflow.id}, ${workflow.nodes.length} nodes, active=${workflow.active})`);

const manual = workflow.nodes.find((n) => n.type === "n8n-nodes-base.manualTrigger");
if (!manual) throw new Error("No manual trigger found -- refusing to guess the entry point.");
const downstream = workflow.connections[manual.name];
if (!downstream) throw new Error(`Manual trigger "${manual.name}" has no outgoing connection.`);
console.log(`  manual trigger: ${manual.name} -> ${downstream.main?.[0]?.map((c) => c.node).join(", ")}`);

const existing = workflow.nodes.find((n) => n.type === "n8n-nodes-base.webhook");
if (existing) {
  console.log(`  webhook trigger already present: ${existing.name} (${existing.parameters?.path})`);
}

const configNode = workflow.nodes.find((n) => /Budget Configuration/i.test(n.name));
const currentVersion = configNode?.parameters?.jsCode?.match(/workflow_version:\s*'([^']+)'/)?.[1];
console.log(`  workflow_version: ${currentVersion}${setVersion ? ` -> ${setVersion}` : ""}`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write.\n");
  process.exit(0);
}

fs.mkdirSync(BACKUPS, { recursive: true });
const stamp = workflow.updatedAt?.replace(/[:.]/g, "-") ?? "unknown";
const backup = path.join(BACKUPS, `controller_${CONTROLLER_ID}_${stamp}.json`);
fs.writeFileSync(backup, JSON.stringify(workflow, null, 2));
console.log(`\n  backup -> ${path.relative(process.cwd(), backup)}`);

const payload = toPayload(workflow);

if (!existing) {
  payload.nodes.push({
    parameters: {
      httpMethod: "POST",
      path: WEBHOOK_PATH,
      responseMode: "lastNode",
      options: {},
    },
    id: "webhook-batch-trigger",
    name: "Batch Webhook",
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [manual.position[0], manual.position[1] + 220],
    webhookId: "shamo-run-batch-webhook",
  });
  // Same first node as the manual trigger, so both paths run identical logic.
  payload.connections["Batch Webhook"] = JSON.parse(JSON.stringify(downstream));
  console.log(`  added Batch Webhook -> POST /webhook/${WEBHOOK_PATH}`);
}

if (setVersion && configNode) {
  const target = payload.nodes.find((n) => n.name === configNode.name);
  const before = target.parameters.jsCode;
  target.parameters.jsCode = before.replace(
    /workflow_version:\s*'[^']+'/,
    `workflow_version: '${setVersion}'`,
  );
  if (target.parameters.jsCode === before) throw new Error("workflow_version not found to replace.");
  console.log(`  workflow_version set to ${setVersion}`);
}

await api("PUT", `/workflows/${CONTROLLER_ID}`, payload);
console.log("  saved");

if (!workflow.active) {
  await api("POST", `/workflows/${CONTROLLER_ID}/activate`);
  console.log("  activated (required for the webhook to accept requests)");
}

console.log(`\nTrigger with:  curl -X POST http://localhost:5678/webhook/${WEBHOOK_PATH}\n`);
