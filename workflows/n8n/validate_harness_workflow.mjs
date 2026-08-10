// Static checks for the harness workflows.
//
// The harness can spend money and write to Supabase, so its isolation controls
// are asserted here rather than trusted. Run alongside
// validate_budget_v2_workflows.mjs.
//
//   node workflows/n8n/validate_harness_workflow.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(fs.readFileSync(path.join(here, name), "utf8"));

const runner = load("shamo_harness_one_paper.json");
const harnessChild = load("shamo_harness_stage_one_math_paper.json");
const productionChild = load("shamo_budget_v2_1_stage_one_math_paper.json");

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// ---- The clone must be logically identical to production -------------------
// Divergence here would mean the harness proves nothing about the real
// pipeline. Names differ by design; node graphs must not.
check(
  harnessChild.nodes.length === productionChild.nodes.length,
  `harness child has ${harnessChild.nodes.length} nodes, production has ${productionChild.nodes.length}`,
);
const productionByName = new Map(productionChild.nodes.map((n) => [n.name, n]));
for (const node of harnessChild.nodes) {
  const twin = productionByName.get(node.name);
  check(Boolean(twin), `harness child has an extra node: ${node.name}`);
  if (twin && node.type === "n8n-nodes-base.code") {
    check(
      node.parameters.jsCode === twin.parameters.jsCode,
      `harness child node "${node.name}" has drifted from production`,
    );
  }
}
check(
  JSON.stringify(harnessChild.connections) === JSON.stringify(productionChild.connections),
  "harness child connections differ from production",
);
// The child was promoted on 8 August 2026 and renamed, because the live
// controller now calls it -- a workflow named "Harness" doing production work
// is a trap for a later reader. The deploy script accepts both prefixes and
// refuses everything else, so the old production child cannot be overwritten.
check(
  ["Shamo Harness", "Shamo Budget v2.2"].some((prefix) => harnessChild.name.startsWith(prefix)),
  `harness child name "${harnessChild.name}" is not one the deploy script will accept`,
);

// ---- Runner shape ----------------------------------------------------------
const runnerNames = new Set(runner.nodes.map((n) => n.name));
for (const required of [
  "Harness Webhook",
  "Harness Configuration",
  "Guard Harness Isolation",
  "Create or Reuse Harness Batch",
  "Run One Paper Sub-workflow",
  "Respond to Harness",
]) {
  check(runnerNames.has(required), `runner: missing ${required}`);
}

const webhook = runner.nodes.find((n) => n.type === "n8n-nodes-base.webhook");
check(webhook?.parameters?.httpMethod === "POST", "runner: the webhook must be POST");
check(
  webhook?.parameters?.responseMode === "responseNode",
  "runner: the webhook must respond from the response node, so the caller gets the run result",
);

// The exported sub-workflow link is blank on purpose: an unlinked import must
// never be able to invoke the production child. deploy_harness.mjs resolves it.
const executeNode = runner.nodes.find((n) => n.type === "n8n-nodes-base.executeWorkflow");
check(Boolean(executeNode), "runner: missing the executeWorkflow node");
check(
  !executeNode?.parameters?.workflowId,
  "runner: the exported sub-workflow link must stay blank so an unlinked import cannot call production",
);
check(
  executeNode?.parameters?.options?.waitForSubWorkflow === true,
  "runner: must wait for the sub-workflow, otherwise the response carries no result",
);

// ---- Isolation controls ----------------------------------------------------
const guard = runner.nodes.find((n) => n.name === "Guard Harness Isolation")?.parameters?.jsCode ?? "";
for (const [fragment, description] of [
  ["shamo-harness-v1", "campaign key"],
  ["/-h$/", "the -h paper_variant suffix"],
  ["campaign_budget_limit_usd > 7", "the $7 campaign ceiling"],
  ["batch_budget_limit_usd > 0.60", "the $0.60 batch ceiling"],
  ["max_papers_per_run !== 1", "the one-paper-per-request limit"],
]) {
  check(guard.includes(fragment), `runner: the isolation guard does not assert ${description}`);
}

const configuration =
  runner.nodes.find((n) => n.name === "Harness Configuration")?.parameters?.jsCode ?? "";
check(
  configuration.includes("campaign_key: 'shamo-harness-v1'"),
  "runner: the campaign key must be hardcoded, not taken from the request body",
);
check(
  configuration.includes("variant + '-h'"),
  "runner: paper_variant must be suffixed so a harness run cannot touch a real paper row",
);
check(
  !/body\.(campaign_key|batch_budget|campaign_budget|stage_reservations)/.test(configuration),
  "runner: budget and campaign values must never be read from the request body",
);

// The harness stages only. Publication must not be reachable from here.
const serialized = JSON.stringify(runner) + JSON.stringify(harnessChild);
check(
  !serialized.includes("shamo_publish_paper_bundle"),
  "harness: publication must not be reachable from the harness path",
);

if (failures.length) {
  console.error("FAIL");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      success: true,
      harness_child_nodes: harnessChild.nodes.length,
      runner_nodes: runner.nodes.length,
      clone_matches_production: true,
      isolation_controls: ["-h variant suffix", "harness campaign", "$7 ceiling", "staging only"],
    },
    null,
    2,
  ),
);
