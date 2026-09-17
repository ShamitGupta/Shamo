import fs from "node:fs/promises";
import path from "node:path";

const directory = path.dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);

const files = [
  "shamo_budget_stage_one_math_paper.json",
  "shamo_budget_test2_six_paper_controller.json",
  "shamo_budget_approve_reviewed_paper.json",
];

const failures = [];
const workflows = [];

for (const file of files) {
  const fullPath = path.join(directory, file);
  const workflow = JSON.parse(await fs.readFile(fullPath, "utf8"));
  workflows.push({ file, workflow });
  const names = new Set(workflow.nodes.map((node) => node.name));

  if (names.size !== workflow.nodes.length) {
    failures.push(`${file}: node names are not unique`);
  }

  for (const node of workflow.nodes) {
    if (!node.id || !node.name || !node.type) {
      failures.push(`${file}: node is missing id, name or type`);
    }
    if (node.type === "n8n-nodes-base.code") {
      try {
        new Function(node.parameters.jsCode);
      } catch (error) {
        failures.push(`${file}/${node.name}: invalid Code-node syntax: ${error.message}`);
      }
    }
  }

  for (const [source, outputs] of Object.entries(workflow.connections)) {
    if (!names.has(source)) {
      failures.push(`${file}: connection source does not exist: ${source}`);
    }
    for (const output of outputs.main || []) {
      for (const connection of output || []) {
        if (!names.has(connection.node)) {
          failures.push(
            `${file}: ${source} connects to missing node ${connection.node}`,
          );
        }
      }
    }
  }
}

const child = workflows.find((entry) =>
  entry.file.includes("stage_one"),
).workflow;
const controller = workflows.find((entry) =>
  entry.file.includes("controller"),
).workflow;
const publisher = workflows.find((entry) =>
  entry.file.includes("approve"),
).workflow;

const serializedChild = JSON.stringify(child);
const serializedController = JSON.stringify(controller);
const serializedPublisher = JSON.stringify(publisher);

for (const forbiddenModel of [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.4-mini",
]) {
  if (
    serializedChild.includes(forbiddenModel) ||
    serializedController.includes(forbiddenModel)
  ) {
    failures.push(`guarded workflows contain forbidden bulk model ${forbiddenModel}`);
  }
}

if (!serializedChild.includes("gpt-5.4-nano")) {
  failures.push("one-paper workflow does not require gpt-5.4-nano");
}

for (const requiredControl of [
  "openai_reservation_usd: 0.25",
  "batch_budget_limit_usd: 1.00",
  "campaign_budget_limit_usd: 15.00",
  "max_papers_per_run: 6",
  "pause_after_papers: 5",
  "pause_minutes: 10",
  "database_safety_megabytes: 350",
]) {
  if (!serializedController.includes(requiredControl)) {
    failures.push(`controller is missing budget/safety control: ${requiredControl}`);
  }
}

for (const requiredRpc of [
  "shamo_reserve_api_budget",
  "shamo_finalize_api_cost_event",
]) {
  if (!serializedChild.includes(requiredRpc)) {
    failures.push(`one-paper workflow is missing ${requiredRpc}`);
  }
}

if (!serializedPublisher.includes("shamo_publish_paper_bundle_with_metadata")) {
  failures.push("publisher does not atomically publish question metadata");
}

const executeNode = controller.nodes.find(
  (node) => node.name === "Run One Paper Sub-workflow",
);
if (!executeNode || executeNode.parameters.workflowId?.value !== "") {
  failures.push(
    "controller child-workflow selector must remain blank for the user to select after import",
  );
}

const mistralNode = child.nodes.find(
  (node) => node.name === "Mistral OCR Both Documents",
);
if (!mistralNode || mistralNode.credentials) {
  failures.push(
    "Mistral node should require the user to select their existing header-auth credential",
  );
}

for (const { file, workflow } of workflows) {
  for (const node of workflow.nodes) {
    if (node.credentials?.openAiApi?.id !== undefined &&
        node.credentials.openAiApi.id !== "DS6la6WpBRQEKxEY") {
      failures.push(`${file}/${node.name}: unexpected OpenAI credential`);
    }
    if (node.credentials?.supabaseApi?.id !== undefined &&
        node.credentials.supabaseApi.id !== "ZOrMcplmMcgPYpOL") {
      failures.push(`${file}/${node.name}: unexpected Supabase credential`);
    }
  }
}

if (failures.length) {
  console.error("Budget workflow validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "Budget workflows passed JSON, Code-node syntax, graph, model, credential, and safety-control validation.",
  );
}
