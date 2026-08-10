// Deploy a FREE dry-run of the controller's paper selection.
//
//   node workflows/n8n/harness/deploy_selection_preflight.mjs
//
// Then, for each batch number you want to inspect:
//
//   curl -s -X POST http://localhost:5678/webhook/shamo-preflight-selection \
//     -H "Content-Type: application/json" \
//     -d '{"sheet_name":"Batch 5","batch_number":1}'
//
// WHY
//
// The controller's manifest read and paper selection sit upstream of every paid
// stage, so a bad manifest fails for free. But if selection SUCCEEDS the
// controller proceeds straight into OCR and five OpenAI stages -- there is no
// way to ask "what would batch N pick?" without committing to the batch.
//
// The documented guard for this has been "inspect the Pair and Select output
// before clicking Execute", which requires already having run it. This closes
// that gap: same sheet, same credential, same selection code, no paid nodes.
//
// FIDELITY IS THE WHOLE POINT
//
// The selection node is copied VERBATIM out of the generated controller JSON at
// deploy time, not reimplemented. A reimplementation would drift and then the
// preflight would be confidently wrong -- worse than having none, because it
// would be trusted. The config node is named "Check Database Free-Tier Safety"
// for the same reason: that is the node the selection code reads its config
// from via $(), so keeping the name lets the real code run unmodified.
//
// SAFETY
//
// Contains no OpenAI node, no Mistral node, no Supabase write, and no
// sub-workflow call. It reads a Google Sheet and does arithmetic. It cannot
// stage, publish, or spend.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const N8N_DIR = path.resolve(HARNESS, "..");

const CONTROLLER_JSON = "shamo_budget_v2_1_test2_six_paper_controller.json";
const WORKFLOW_NAME = "Shamo Harness - Selection Preflight (free, no paid nodes)";
const WEBHOOK_PATH = "shamo-preflight-selection";

// Live controller values, so the preflight resolves the same sheet and campaign.
// Deliberately NOT read from the live workflow: this file is the record of what
// the preflight assumes, and a silent change upstream should show up as a
// mismatch rather than be absorbed.
const LIVE = {
  google_document_id: "14QHYH5T22qyGQJH-6SLW00q9yTuDhGwe1mEM7liaEbY",
  google_sheets_credential_id: "xzcR7RoAo3n5rpoV",
  google_sheets_credential_name: "Google Sheets account",
  qualification: "a_level",
  syllabus_code: "9709",
  subject: "Mathematics",
  campaign_key: "a-level-9709-test2-pilot-v1",
  workflow_version: "v2.2",
};

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
    throw new Error(`${method} ${endpoint} -> ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

const controller = JSON.parse(fs.readFileSync(path.join(N8N_DIR, CONTROLLER_JSON), "utf8"));
const selectionNode = controller.nodes.find((n) => n.name === "Pair and Select Test 2 Papers");
if (!selectionNode?.parameters?.jsCode) {
  throw new Error(`Could not find the selection node in ${CONTROLLER_JSON}.`);
}
const SELECTION_CODE = selectionNode.parameters.jsCode;

// Config, from the webhook body where supplied. Mirrors the live controller's
// shape closely enough for the selection code, and omits every field that only
// matters to paid stages (models, prices, reservations) -- if selection ever
// starts reading one of those, this will throw rather than guess.
const CONFIG_CODE = `const body = $input.first().json.body || {};
const sheetName = String(body.sheet_name || 'Test 2');
const batchNumber = Number(body.batch_number || 1);
const batchSize = Number(body.max_papers_per_run || 6);
if (!Number.isInteger(batchNumber) || batchNumber < 1) {
  throw new Error('batch_number must be a positive integer.');
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 6) {
  throw new Error('max_papers_per_run must be between 1 and 6.');
}
return [{ json: {
  google_document_id: ${JSON.stringify(LIVE.google_document_id)},
  google_sheet_name: sheetName,
  qualification: ${JSON.stringify(LIVE.qualification)},
  syllabus_code: ${JSON.stringify(LIVE.syllabus_code)},
  subject: ${JSON.stringify(LIVE.subject)},
  campaign_key: ${JSON.stringify(LIVE.campaign_key)},
  workflow_version: ${JSON.stringify(LIVE.workflow_version)},
  batch_number: batchNumber,
  max_papers_per_run: batchSize,
  batch_budget_limit_usd: 1.00,
  campaign_budget_limit_usd: 15.00,
  // Selection never reads this. Present only because the real config node
  // emits it, so the shape stays recognisable next to the controller's.
  database_megabytes_before: null,
  preflight: true,
} }];`;

// Reports the whole manifest, not just this batch's slice. Without the totals a
// selection result is uninterpretable: six sensible-looking papers tell you
// nothing about whether they are the six you wanted, how many batches the sheet
// holds, or whether the tab contains papers you already ingested.
const REPORT_CODE = `const selection = $input.first().json;
const pairs = selection.pairs || [];
const identity = (p) => p.syllabus_code + '/' + p.paper_variant + ' ' + p.year + ' ' + p.exam_session;

// Recount the manifest straight from the sheet rows. Deliberately independent
// of the selection code so a disagreement is visible rather than absorbed.
const rows = $('Get Manifest Rows').all().map((i) => i.json);
const seen = new Map();
for (const row of rows) {
  const url = String(row['Paper Link'] || '');
  const m = url.match(/\\/(\\d{4})_([msw])(\\d{2})_(qp|ms)_(\\d{2})\\.pdf$/i);
  if (!m) continue;
  const sess = { m: 'feb_march', s: 'may_june', w: 'oct_nov' }[m[2].toLowerCase()];
  const key = (2000 + Number(m[3])) + ':' + sess + ':' + m[5];
  if (!seen.has(key)) seen.set(key, new Set());
  seen.get(key).add(m[4].toLowerCase());
}
const completePairs = [...seen.entries()].filter(([, docs]) => docs.size === 2);
const incomplete = [...seen.entries()].filter(([, docs]) => docs.size !== 2).map(([k]) => k);
const byComponent = {};
for (const [key] of completePairs) {
  const component = key.split(':')[2].charAt(0);
  byComponent[component] = (byComponent[component] || 0) + 1;
}
const sittings = [...new Set(completePairs.map(([k]) => k.split(':').slice(0, 2).join(' ')))].sort();

return [{ json: {
  preflight: true,
  cost: 'none -- this workflow contains no paid node',
  sheet_name: selection.config.google_sheet_name,
  manifest: {
    sheet_rows: rows.length,
    complete_pairs: completePairs.length,
    incomplete_identities: incomplete,
    pairs_per_component: byComponent,
    sittings_present: sittings,
    batches_available: Math.ceil(completePairs.length / selection.config.max_papers_per_run),
  },
  batch_number: selection.config.batch_number,
  batch_key_that_would_be_used: selection.batch_key,
  selected_count: pairs.length,
  selected: pairs.map((p) => ({
    identity: identity(p),
    paper_component: String(p.paper_variant).charAt(0),
    year: p.year,
    exam_session: p.exam_session,
    paper_variant: p.paper_variant,
    question_paper_url: (p.documents.find((d) => d.document_type === 'question_paper') || {}).source_url,
    mark_scheme_url: (p.documents.find((d) => d.document_type === 'mark_scheme') || {}).source_url,
  })),
  components_covered: [...new Set(pairs.map((p) => String(p.paper_variant).charAt(0)))].sort(),
  note: 'Cross-check these identities against published papers before running the real batch.',
} }];`;

const nodes = [
  {
    parameters: {
      httpMethod: "POST",
      path: WEBHOOK_PATH,
      responseMode: "lastNode",
      options: {},
    },
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [0, 0],
    id: "preflight-webhook",
    name: "Preflight Webhook",
    webhookId: "shamo-preflight-selection",
  },
  {
    parameters: { jsCode: CONFIG_CODE },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [220, 0],
    id: "preflight-config",
    // Named for the selection code's $() lookup. See the header note.
    name: "Check Database Free-Tier Safety",
  },
  {
    parameters: {
      documentId: {
        __rl: true,
        value: LIVE.google_document_id,
        mode: "id",
      },
      sheetName: {
        __rl: true,
        value: "={{ $json.google_sheet_name }}",
        mode: "name",
      },
      options: {},
    },
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.7,
    position: [440, 0],
    id: "preflight-sheet",
    name: "Get Manifest Rows",
    credentials: {
      googleSheetsOAuth2Api: {
        id: LIVE.google_sheets_credential_id,
        name: LIVE.google_sheets_credential_name,
      },
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
  },
  {
    parameters: { jsCode: SELECTION_CODE },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [660, 0],
    id: "preflight-select",
    name: "Pair and Select Test 2 Papers",
  },
  {
    parameters: { jsCode: REPORT_CODE },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [880, 0],
    id: "preflight-report",
    name: "Preflight Report",
  },
];

const connections = {
  "Preflight Webhook": { main: [[{ node: "Check Database Free-Tier Safety", type: "main", index: 0 }]] },
  "Check Database Free-Tier Safety": { main: [[{ node: "Get Manifest Rows", type: "main", index: 0 }]] },
  "Get Manifest Rows": { main: [[{ node: "Pair and Select Test 2 Papers", type: "main", index: 0 }]] },
  "Pair and Select Test 2 Papers": { main: [[{ node: "Preflight Report", type: "main", index: 0 }]] },
};

async function main() {
  const PAID_TYPES = ["openAi", "executeWorkflow", "httpRequest"];
  const offenders = nodes.filter((n) => PAID_TYPES.some((t) => n.type.includes(t)));
  if (offenders.length) {
    throw new Error(
      `Refusing to deploy: preflight must contain no paid or sub-workflow node, found ${offenders
        .map((n) => n.name)
        .join(", ")}.`,
    );
  }

  const existing = (await api("GET", "/workflows?limit=250")).data.find((w) => w.name === WORKFLOW_NAME);
  const body = { name: WORKFLOW_NAME, nodes, connections, settings: { executionOrder: "v1" } };

  let workflow;
  if (existing) {
    workflow = await api("PUT", `/workflows/${existing.id}`, body);
    console.log(`Updated ${WORKFLOW_NAME} (${workflow.id})`);
  } else {
    workflow = await api("POST", "/workflows", body);
    console.log(`Created ${WORKFLOW_NAME} (${workflow.id})`);
  }

  if (!workflow.active) {
    await api("POST", `/workflows/${workflow.id}/activate`);
    console.log("Activated (required for the webhook to accept requests).");
  }

  console.log(`\nSelection code copied verbatim from ${CONTROLLER_JSON} (${SELECTION_CODE.length} bytes).`);
  console.log("Paid nodes: 0. Supabase writes: 0. Sub-workflow calls: 0.\n");
  console.log(`POST http://localhost:5678/webhook/${WEBHOOK_PATH}`);
  console.log(`  {"sheet_name":"Batch 5","batch_number":1}`);
}

main().then(
  () => {},
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
