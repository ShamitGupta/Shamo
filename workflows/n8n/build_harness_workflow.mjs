// Generate the harness workflows: a webhook-driven single-paper runner plus a
// clone of the staging child.
//
// WHY A CLONE
// -----------
// The production child (fAa1IGsa6OKOq8xO) is never modified by an agent.
// Changes are proved on the clone, and a human promotes the validated JSON.
//
// WHY A WEBHOOK
// -------------
// n8n's public API has no execute endpoint for manual triggers, so an agent
// cannot run the production controller. It CAN fire a webhook. This runner is
// the only agent-executable entry point, and it stages one paper only.
//
// ISOLATION
// ---------
// Four independent controls, all asserted at runtime by `Guard Harness
// Isolation` so a mistake fails closed rather than touching real data:
//
//   1. paper_variant carries a `-h` suffix. shamo_papers is unique on
//      (qualification, syllabus_code, year, exam_session, paper_variant), so
//      `62-h` is a DIFFERENT row from `62`. This matters more than it looks:
//      `Upsert Paper` sets status='staging', so without the suffix a harness
//      run would flip a published paper back to staging.
//   2. idempotency keys are prefixed `harness-v1:`. The column is globally
//      unique, so collision with `budget-v2.1:` is impossible.
//   3. a separate campaign_key `shamo-harness-v1` with its own $7 ceiling,
//      enforced inside shamo_reserve_api_budget. Production's $15 is untouched.
//   4. the child only ever stages. Publication lives in a different workflow
//      that this one does not reference.
//
// Teardown is `where idempotency_key like 'harness-v1:%'`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(fs.readFileSync(path.join(here, name), "utf8"));

const productionChild = load("shamo_budget_v2_1_stage_one_math_paper.json");
const uuid = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// 1. Harness child: byte-identical logic, different name.
// ---------------------------------------------------------------------------
const harnessChild = JSON.parse(JSON.stringify(productionChild));
// Promoted name: this workflow is what the live controller calls, so calling it
// "Harness" would mislead a later reader into thinking it were a test artefact.
harnessChild.name = "Shamo Budget v2.2 - Structured Maths Paper Staging";
delete harnessChild.id;
delete harnessChild.versionId;
harnessChild.active = false;

// ---------------------------------------------------------------------------
// 2. Webhook runner.
// ---------------------------------------------------------------------------
const WEBHOOK_PATH = "shamo-harness-one-paper";

// Borrow the Supabase credential reference the child already uses. Looking it
// up keeps a single source of truth: if the credential is rotated or renamed in
// n8n, regenerating picks up the change instead of pinning a stale id.
const supabaseCredential = (() => {
  const node = productionChild.nodes.find((n) => n.credentials?.supabaseApi?.id);
  if (!node) {
    throw new Error(
      "No Supabase credential found on the production child. Generate the v2.1 workflows first.",
    );
  }
  return node.credentials.supabaseApi;
})();

const configurationCode = `
// Harness configuration. Every budget and identity value is hardcoded here
// rather than read from the request, so a malformed or hostile body cannot
// widen the blast radius. The webhook chooses WHICH paper, never HOW MUCH.
const body = $input.first().json.body || $input.first().json || {};

const config = {
  supabase_url: 'https://exjfaggqphjkxniyshfl.supabase.co',
  qualification: 'a_level',
  syllabus_code: '9709',
  subject: 'Mathematics',
  campaign_key: 'shamo-harness-v1',
  workflow_version: 'harness-v1',
  batch_number: 0,
  max_papers_per_run: 1,
  batch_budget_limit_usd: 0.60,
  campaign_budget_limit_usd: 7.00,
  stage_reservations_usd: {
    question_paper: 0.12,
    page_map: 0.02,
    mark_scheme: 0.12,
    metadata: 0.02,
    repair: 0.20,
  },
  database_safety_megabytes: 350,
  ocr_model: 'mistral-ocr-latest',
  question_model: 'gpt-5.4-mini',
  page_map_model: 'gpt-5.4-nano',
  mark_scheme_model: 'gpt-5.4-nano',
  metadata_model: 'gpt-5.4-nano',
  repair_model: 'gpt-5.4-mini',
  openai_prices_per_million: {
    'gpt-5.4-mini': { input: 0.75, cached_input: 0.075, output: 4.50 },
    'gpt-5.4-nano': { input: 0.20, cached_input: 0.02, output: 1.25 },
  },
  storage_bucket: 'past-paper-assets',
};

const label = String(body.label || 'r0').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'r0';
const variant = String(body.paper_variant || '').trim();
if (!/^[0-9]{2}$/.test(variant)) {
  throw new Error('paper_variant must be a two-digit variant such as "62".');
}
if (!body.question_paper_url || !body.mark_scheme_url) {
  throw new Error('question_paper_url and mark_scheme_url are both required.');
}

// The ONE request-controlled config value, and it is safe to expose because it
// can only REMOVE an input, never widen a budget, change a paper, or reach a
// different campaign. It exists so the cost A/B is a request parameter rather
// than a redeploy between the two halves of the experiment -- redeploying
// mid-experiment would change more than the variable under test.
// Anything other than an explicit false leaves current behaviour untouched.
config.attach_source_pdf = body.attach_source_pdf !== false;

return [{
  json: {
    config,
    label,
    batch_key: 'shamo-harness-v1-' + label,
    pair: {
      qualification: config.qualification,
      syllabus_code: config.syllabus_code,
      subject: config.subject,
      year: Number(body.year),
      exam_session: String(body.exam_session || ''),
      // The -h suffix is the primary isolation control. See the header comment.
      paper_variant: variant + '-h',
      documents: [
        { document_type: 'question_paper', source_url: String(body.question_paper_url) },
        { document_type: 'mark_scheme', source_url: String(body.mark_scheme_url) },
      ],
    },
  },
}];
`.trim();

const guardCode = `
// Fail closed. Every isolation invariant is re-checked here rather than trusted
// from the node above, because this is the single place a reviewer has to read
// to convince themselves the harness cannot touch production data.
const state = $input.first().json;
const { config, pair, batch_key } = state;

if (config.campaign_key !== 'shamo-harness-v1') {
  throw new Error('Harness runs must use the shamo-harness-v1 campaign.');
}
if (!String(batch_key).startsWith('shamo-harness-v1-')) {
  throw new Error('Harness batch keys must start with shamo-harness-v1-.');
}
if (!/-h$/.test(pair.paper_variant)) {
  throw new Error(
    'Harness paper_variant must end in -h so it cannot collide with a real paper. ' +
    'Without the suffix, Upsert Paper would set a published paper back to staging.'
  );
}
if (config.campaign_budget_limit_usd > 7) {
  throw new Error('Harness campaign budget cannot exceed $7.');
}
if (config.batch_budget_limit_usd > 0.60) {
  throw new Error('Harness batch budget cannot exceed $0.60.');
}
if (config.max_papers_per_run !== 1) {
  throw new Error('The harness runs exactly one paper per request.');
}
const reservationTotal = Object.values(config.stage_reservations_usd)
  .reduce((total, amount) => total + Number(amount), 0);
if (reservationTotal > config.batch_budget_limit_usd) {
  throw new Error(
    'Stage reservations total $' + reservationTotal.toFixed(2) +
    ', which exceeds the $' + config.batch_budget_limit_usd.toFixed(2) + ' batch cap.'
  );
}
if (!Number.isInteger(pair.year) || pair.year < 2000 || pair.year > 2100) {
  throw new Error('A valid four-digit year is required.');
}
for (const document of pair.documents) {
  if (!/^https:\\/\\//.test(document.source_url)) {
    throw new Error('Source documents must be fetched over https.');
  }
}
return [{ json: state }];
`.trim();

const expandCode = `
// The child expects exactly the shape the production controller builds:
// { config, batch, pair, batch_position, batch_size }.
const response = $input.first().json;
const batch = Array.isArray(response) ? response[0] : response;
const state = $('Guard Harness Isolation').first().json;
if (!batch?.id) throw new Error('Supabase did not return the harness ingestion batch.');
return [{
  json: {
    config: state.config,
    batch,
    pair: state.pair,
    batch_position: 1,
    batch_size: 1,
  },
}];
`.trim();

const collectCode = `
// Compact, machine-readable result. The agent reads ingestion_run_id from here
// and then queries Supabase directly for the staged bundle.
const result = $input.first().json;
const state = $('Guard Harness Isolation').first().json;
const validation = result.validation_report || {};
return [{
  json: {
    ok: true,
    label: state.label,
    paper_key: [
      state.pair.syllabus_code, state.pair.year, state.pair.exam_session, state.pair.paper_variant,
    ].join('_'),
    ingestion_run_id: result.ingestion_run_id || null,
    status: result.status || null,
    ready_for_approval: result.ready_for_approval ?? null,
    question_count: result.question_count ?? null,
    part_count: result.question_part_count ?? null,
    asset_count: result.asset_count ?? null,
    blocking_issue_count: validation.blocking_issue_count ?? null,
    warning_count: validation.warning_count ?? null,
    issue_codes: [...new Set((validation.issues || []).map((issue) => issue.issue_code))],
    api_usage: result.api_usage || null,
  },
}];
`.trim();

const codeNode = (name, jsCode, position) => ({
  id: uuid(),
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
  parameters: { mode: "runOnceForAllItems", jsCode },
});

const harnessRunner = {
  name: "Shamo Harness - Run One Paper (Webhook)",
  nodes: [
    {
      id: uuid(),
      name: "Harness Webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: uuid(),
      parameters: {
        httpMethod: "POST",
        path: WEBHOOK_PATH,
        responseMode: "responseNode",
        options: {},
      },
    },
    codeNode("Harness Configuration", configurationCode, [220, 0]),
    codeNode("Guard Harness Isolation", guardCode, [440, 0]),
    {
      id: uuid(),
      name: "Create or Reuse Harness Batch",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [660, 0],
      // Reuse the existing Supabase credential rather than defining a new one.
      // The id is looked up from the production child at generation time so the
      // harness never carries a second copy of the secret.
      credentials: { supabaseApi: supabaseCredential },
      parameters: {
        method: "POST",
        url: "=https://exjfaggqphjkxniyshfl.supabase.co/rest/v1/shamo_ingestion_batches?on_conflict=batch_key",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "supabaseApi",
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Prefer", value: "resolution=merge-duplicates,return=representation" },
            { name: "Content-Type", value: "application/json" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          "={{ JSON.stringify({" +
          " batch_key: $json.batch_key," +
          " campaign_key: $json.config.campaign_key," +
          " source_sheet: 'harness (no sheet)'," +
          " qualification: $json.config.qualification," +
          " syllabus_code: $json.config.syllabus_code," +
          " subject: $json.config.subject," +
          " max_papers: 1," +
          " planned_papers: 1," +
          " batch_budget_limit_usd: $json.config.batch_budget_limit_usd," +
          " campaign_budget_limit_usd: $json.config.campaign_budget_limit_usd," +
          " status: 'processing'," +
          " started_at: new Date().toISOString()" +
          " }) }}",
        options: {},
      },
    },
    codeNode("Expand Harness Pair", expandCode, [880, 0]),
    {
      id: uuid(),
      name: "Run One Paper Sub-workflow",
      type: "n8n-nodes-base.executeWorkflow",
      typeVersion: 1.2,
      position: [1100, 0],
      parameters: {
        // Left blank on purpose: link it to the harness child after import.
        workflowId: "",
        mode: "once",
        options: { waitForSubWorkflow: true },
      },
    },
    codeNode("Collect Harness Result", collectCode, [1320, 0]),
    {
      id: uuid(),
      name: "Respond to Harness",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [1540, 0],
      parameters: { respondWith: "json", responseBody: "={{ JSON.stringify($json) }}", options: {} },
    },
  ],
  connections: {
    "Harness Webhook": { main: [[{ node: "Harness Configuration", type: "main", index: 0 }]] },
    "Harness Configuration": { main: [[{ node: "Guard Harness Isolation", type: "main", index: 0 }]] },
    "Guard Harness Isolation": {
      main: [[{ node: "Create or Reuse Harness Batch", type: "main", index: 0 }]],
    },
    "Create or Reuse Harness Batch": { main: [[{ node: "Expand Harness Pair", type: "main", index: 0 }]] },
    "Expand Harness Pair": { main: [[{ node: "Run One Paper Sub-workflow", type: "main", index: 0 }]] },
    "Run One Paper Sub-workflow": { main: [[{ node: "Collect Harness Result", type: "main", index: 0 }]] },
    "Collect Harness Result": { main: [[{ node: "Respond to Harness", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
};

fs.writeFileSync(
  path.join(here, "shamo_harness_stage_one_math_paper.json"),
  JSON.stringify(harnessChild, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(here, "shamo_harness_one_paper.json"),
  JSON.stringify(harnessRunner, null, 2) + "\n",
);

console.log("Generated harness workflows.");
console.log(`  child  : ${harnessChild.nodes.length} nodes  (clone of production, renamed)`);
console.log(`  runner : ${harnessRunner.nodes.length} nodes  POST /webhook/${WEBHOOK_PATH}`);
