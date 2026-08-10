import fs from "node:fs/promises";
import path from "node:path";

const directory = path.dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const fileName = "shamo_pilot_generate_search_embeddings.json";
const workflow = JSON.parse(
  await fs.readFile(path.join(directory, fileName), "utf8"),
);

const errors = [];
const nodeNames = new Set(workflow.nodes.map((node) => node.name));

if (workflow.active !== false) {
  errors.push("Workflow must be inactive when imported.");
}

for (const requiredName of [
  "Index Published Questions Manually",
  "Search Configuration",
  "Load Pending Search Items",
  "Prepare Embedding Batch",
  "OpenAI Search Embeddings",
  "Validate Embedding Response",
  "Save Search Embeddings",
  "Search Indexing Result",
]) {
  if (!nodeNames.has(requiredName)) {
    errors.push(`Missing required node: ${requiredName}`);
  }
}

for (const [source, outputs] of Object.entries(workflow.connections)) {
  if (!nodeNames.has(source)) {
    errors.push(`Connection source does not exist: ${source}`);
  }
  for (const branch of outputs.main ?? []) {
    for (const connection of branch ?? []) {
      if (!nodeNames.has(connection.node)) {
        errors.push(`Connection target does not exist: ${connection.node}`);
      }
    }
  }
}

const serialized = JSON.stringify(workflow);
for (const secretPattern of [
  /sk-[A-Za-z0-9_-]{20,}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /service_role["']?\s*[:=]\s*["'][A-Za-z0-9._-]+/i,
]) {
  if (secretPattern.test(serialized)) {
    errors.push(`Possible embedded secret matching ${secretPattern}`);
  }
}

const embeddingNode = workflow.nodes.find(
  (node) => node.name === "OpenAI Search Embeddings",
);
if (embeddingNode?.parameters?.url !== "https://api.openai.com/v1/embeddings") {
  errors.push("The OpenAI node must call /v1/embeddings.");
}

const configNode = workflow.nodes.find(
  (node) => node.name === "Search Configuration",
);
if (!configNode?.parameters?.jsCode?.includes("embedding_dimensions: 512")) {
  errors.push("The workflow must request 512-dimension embeddings.");
}
if (!configNode?.parameters?.jsCode?.includes("max_estimated_cost_usd: 0.05")) {
  errors.push("The workflow must retain its $0.05 cost guard.");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${fileName}: valid`);
}
