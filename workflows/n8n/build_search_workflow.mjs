import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const outputDir = path.dirname(
  new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);

function idFor(name) {
  const hash = crypto.createHash("sha256").update(name).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

const credentials = {
  openAiApi: {
    id: "DS6la6WpBRQEKxEY",
    name: "OpenAi account",
  },
  supabaseApi: {
    id: "ZOrMcplmMcgPYpOL",
    name: "Supabase account",
  },
};

const nodes = [
  {
    parameters: {
      content:
        "## Shamo search indexing\n\nRun only after a paper has been approved and published. This workflow batches all pending pilot search items into one inexpensive OpenAI embedding request, validates every 512-dimension vector, and saves the batch atomically through Supabase.\n\nThe default safety limit is 100 items and an estimated $0.05 maximum embedding cost.",
      height: 300,
      width: 520,
      color: 5,
    },
    type: "n8n-nodes-base.stickyNote",
    typeVersion: 1,
    position: [-520, -260],
    id: idFor("Search indexing note"),
    name: "Search indexing note",
  },
  {
    parameters: {},
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [-420, 40],
    id: idFor("Index Published Questions Manually"),
    name: "Index Published Questions Manually",
  },
  {
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: `return [{
  json: {
    supabase_url: 'https://YOUR_PROJECT_REF.supabase.co',
    embedding_model: 'text-embedding-3-small',
    embedding_dimensions: 512,
    requested_limit: 100,
    price_per_million_tokens_usd: 0.02,
    max_estimated_cost_usd: 0.05,
  },
}];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [-180, 40],
    id: idFor("Search Configuration"),
    name: "Search Configuration",
  },
  {
    parameters: {
      method: "POST",
      url: "={{ $json.supabase_url + '/rest/v1/rpc/shamo_get_pending_search_items' }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      sendHeaders: true,
      headerParameters: { parameters: [] },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ ({ requested_limit: $json.requested_limit }) }}",
      options: {
        response: { response: { responseFormat: "json" } },
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [60, 40],
    id: idFor("Load Pending Search Items"),
    name: "Load Pending Search Items",
    alwaysOutputData: true,
    credentials: {
      supabaseApi: credentials.supabaseApi,
    },
  },
  {
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: `const config = $('Search Configuration').first().json;
const searchItems = $input
  .all()
  .flatMap((item) => Array.isArray(item.json) ? item.json : [item.json])
  .filter((item) => item.question_id && item.ingestion_run_id && item.content);

if (searchItems.length > config.requested_limit) {
  throw new Error(
    'Supabase returned more search items than the configured safety limit.',
  );
}

const estimatedTokens = Math.ceil(
  searchItems.reduce((sum, item) => sum + String(item.content).length, 0) / 4,
);
const estimatedCostUsd =
  estimatedTokens / 1_000_000 * config.price_per_million_tokens_usd;

if (estimatedCostUsd > config.max_estimated_cost_usd) {
  throw new Error(
    'Estimated embedding cost $' + estimatedCostUsd.toFixed(6) +
    ' exceeds the configured $' +
    config.max_estimated_cost_usd.toFixed(2) + ' safety limit.',
  );
}

return [{
  json: {
    config,
    search_items: searchItems,
    has_pending_items: searchItems.length > 0,
    item_count: searchItems.length,
    estimated_tokens: estimatedTokens,
    estimated_cost_usd: Number(estimatedCostUsd.toFixed(8)),
    embedding_request: {
      model: config.embedding_model,
      input: searchItems.map((item) => item.content),
      dimensions: config.embedding_dimensions,
      encoding_format: 'float',
    },
  },
}];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [300, 40],
    id: idFor("Prepare Embedding Batch"),
    name: "Prepare Embedding Batch",
  },
  {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
          version: 2,
        },
        conditions: [
          {
            id: idFor("Pending items condition"),
            leftValue: "={{ $json.has_pending_items }}",
            rightValue: true,
            operator: {
              type: "boolean",
              operation: "true",
              singleValue: true,
            },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
    position: [540, 40],
    id: idFor("Pending Items Found"),
    name: "Pending Items Found",
  },
  {
    parameters: {
      method: "POST",
      url: "https://api.openai.com/v1/embeddings",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "openAiApi",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ $json.embedding_request }}",
      options: {
        response: { response: { responseFormat: "json" } },
        timeout: 600000,
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [800, -80],
    id: idFor("OpenAI Search Embeddings"),
    name: "OpenAI Search Embeddings",
    credentials: {
      openAiApi: credentials.openAiApi,
    },
  },
  {
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: `const response = $input.first().json;
const batch = $('Prepare Embedding Batch').first().json;
const vectors = Array.isArray(response.data)
  ? [...response.data].sort((a, b) => a.index - b.index)
  : [];

if (vectors.length !== batch.search_items.length) {
  throw new Error(
    'OpenAI returned ' + vectors.length + ' embeddings for ' +
    batch.search_items.length + ' search items.',
  );
}

const embeddedItems = batch.search_items.map((item, index) => {
  const vector = vectors[index]?.embedding;
  if (!Array.isArray(vector) ||
      vector.length !== batch.config.embedding_dimensions ||
      vector.some((value) => !Number.isFinite(value))) {
    throw new Error(
      'Embedding ' + index + ' is not a valid ' +
      batch.config.embedding_dimensions + '-dimension vector.',
    );
  }

  return {
    question_id: item.question_id,
    question_part_id: item.question_part_id || null,
    ingestion_run_id: item.ingestion_run_id,
    content: item.content,
    embedding: vector,
  };
});

const actualTokens = Number(
  response.usage?.total_tokens ?? response.usage?.prompt_tokens ?? 0,
);
const actualCostUsd =
  actualTokens / 1_000_000 *
  batch.config.price_per_million_tokens_usd;

return [{
  json: {
    config: batch.config,
    item_count: embeddedItems.length,
    estimated_tokens: batch.estimated_tokens,
    estimated_cost_usd: batch.estimated_cost_usd,
    actual_tokens: actualTokens,
    actual_cost_usd: Number(actualCostUsd.toFixed(8)),
    embedded_items: embeddedItems,
  },
}];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1040, -80],
    id: idFor("Validate Embedding Response"),
    name: "Validate Embedding Response",
  },
  {
    parameters: {
      method: "POST",
      url: "={{ $json.config.supabase_url + '/rest/v1/rpc/shamo_store_question_embeddings' }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      sendHeaders: true,
      headerParameters: { parameters: [] },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        "={{ ({ requested_model: $json.config.embedding_model, embedded_items: $json.embedded_items }) }}",
      options: {
        response: { response: { responseFormat: "json" } },
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [1280, -80],
    id: idFor("Save Search Embeddings"),
    name: "Save Search Embeddings",
    alwaysOutputData: true,
    credentials: {
      supabaseApi: credentials.supabaseApi,
    },
  },
  {
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: `const saved = $input.first().json;
const prepared = $('Validate Embedding Response').first().json;

return [{
  json: {
    success: true,
    message: 'Published questions were indexed successfully.',
    item_count: prepared.item_count,
    embedding_model: prepared.config.embedding_model,
    embedding_dimensions: prepared.config.embedding_dimensions,
    actual_tokens: prepared.actual_tokens,
    actual_cost_usd: prepared.actual_cost_usd,
    estimated_cost_usd: prepared.estimated_cost_usd,
    database_result: saved,
    next_step:
      'Run database/shamo_v2_search_verification.sql section by section.',
  },
}];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [1520, -80],
    id: idFor("Search Indexing Result"),
    name: "Search Indexing Result",
  },
  {
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: `return [{
  json: {
    success: true,
    message: 'No published search items are waiting for embeddings.',
    item_count: 0,
    actual_cost_usd: 0,
  },
}];`,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [800, 160],
    id: idFor("Nothing to Index"),
    name: "Nothing to Index",
  },
];

const connections = {
  "Index Published Questions Manually": {
    main: [[{ node: "Search Configuration", type: "main", index: 0 }]],
  },
  "Search Configuration": {
    main: [[{ node: "Load Pending Search Items", type: "main", index: 0 }]],
  },
  "Load Pending Search Items": {
    main: [[{ node: "Prepare Embedding Batch", type: "main", index: 0 }]],
  },
  "Prepare Embedding Batch": {
    main: [[{ node: "Pending Items Found", type: "main", index: 0 }]],
  },
  "Pending Items Found": {
    main: [
      [{ node: "OpenAI Search Embeddings", type: "main", index: 0 }],
      [{ node: "Nothing to Index", type: "main", index: 0 }],
    ],
  },
  "OpenAI Search Embeddings": {
    main: [[{ node: "Validate Embedding Response", type: "main", index: 0 }]],
  },
  "Validate Embedding Response": {
    main: [[{ node: "Save Search Embeddings", type: "main", index: 0 }]],
  },
  "Save Search Embeddings": {
    main: [[{ node: "Search Indexing Result", type: "main", index: 0 }]],
  },
};

const workflow = {
  name: "Shamo Pilot - Generate Search Embeddings",
  nodes,
  pinData: {},
  connections,
  active: false,
  settings: {
    executionOrder: "v1",
    saveManualExecutions: true,
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
  },
  versionId: idFor("Shamo Pilot - Generate Search Embeddings v1"),
  meta: {
    templateCredsSetupCompleted: false,
  },
  tags: [],
};

await fs.writeFile(
  path.join(outputDir, "shamo_pilot_generate_search_embeddings.json"),
  `${JSON.stringify(workflow, null, 2)}\n`,
  "utf8",
);

console.log("Generated shamo_pilot_generate_search_embeddings.json");
