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
  googleSheetsOAuth2Api: {
    id: "xzcR7RoAo3n5rpoV",
    name: "Google Sheets account",
  },
  openAiApi: {
    id: "DS6la6WpBRQEKxEY",
    name: "OpenAi account",
  },
  supabaseApi: {
    id: "ZOrMcplmMcgPYpOL",
    name: "Supabase account",
  },
};

const nullableString = {
  anyOf: [{ type: "string" }, { type: "null" }],
};

const nullableInteger = {
  anyOf: [{ type: "integer" }, { type: "null" }],
};

const nullableBoolean = {
  anyOf: [{ type: "boolean" }, { type: "null" }],
};

const mathematicalDetailsSchema = {
  type: "object",
  properties: {
    visible_labels: { type: "array", items: { type: "string" } },
    equations: { type: "array", items: { type: "string" } },
    coordinates: { type: "array", items: { type: "string" } },
    measurements: { type: "array", items: { type: "string" } },
    relationships: { type: "array", items: { type: "string" } },
  },
  required: [
    "visible_labels",
    "equations",
    "coordinates",
    "measurements",
    "relationships",
  ],
  additionalProperties: false,
};

const assetSchema = {
  type: "object",
  properties: {
    part_path: {
      type: "array",
      maxItems: 4,
      items: { type: "string", pattern: "^[A-Za-z0-9]+$" },
    },
    document_type: {
      type: "string",
      enum: ["question_paper", "mark_scheme"],
    },
    source_page_number: { type: "integer", minimum: 1 },
    source_image_index: { type: "integer", minimum: 0 },
    asset_type: {
      type: "string",
      enum: [
        "graph",
        "geometry_diagram",
        "mechanics_diagram",
        "table",
        "number_line",
        "coordinate_grid",
        "other_instructional",
      ],
    },
    bounding_box: {
      anyOf: [
        {
          type: "object",
          properties: {
            top_left_x: { type: "number" },
            top_left_y: { type: "number" },
            bottom_right_x: { type: "number" },
            bottom_right_y: { type: "number" },
          },
          required: [
            "top_left_x",
            "top_left_y",
            "bottom_right_x",
            "bottom_right_y",
          ],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    description: { type: "string" },
    mathematical_details: mathematicalDetailsSchema,
    required_to_solve: { type: "boolean" },
  },
  required: [
    "part_path",
    "document_type",
    "source_page_number",
    "source_image_index",
    "asset_type",
    "bounding_box",
    "description",
    "mathematical_details",
    "required_to_solve",
  ],
  additionalProperties: false,
};

const metadataSchema = {
  type: "object",
  properties: {
    main_topic: { type: "string" },
    subtopics: { type: "array", items: { type: "string" } },
    skills: { type: "array", items: { type: "string" } },
    methods: { type: "array", items: { type: "string" } },
    question_style: {
      type: "string",
      enum: [
        "routine_calculation",
        "multi_step_problem",
        "proof_or_show",
        "modelling",
        "interpretation",
        "mixed",
      ],
    },
    difficulty_level: nullableInteger,
    calculator_required: nullableBoolean,
    diagram_required: { type: "boolean" },
    classification_confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    metadata_model: { type: "string" },
    taxonomy_version: { type: "string" },
  },
  required: [
    "main_topic",
    "subtopics",
    "skills",
    "methods",
    "question_style",
    "difficulty_level",
    "calculator_required",
    "diagram_required",
    "classification_confidence",
    "metadata_model",
    "taxonomy_version",
  ],
  additionalProperties: false,
};

const partSchema = {
  type: "object",
  properties: {
    label_path: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string", pattern: "^[A-Za-z0-9]+$" },
    },
    prompt_markdown: { type: "string" },
    marks: nullableInteger,
    source_page_numbers: {
      type: "array",
      minItems: 1,
      items: { type: "integer", minimum: 1 },
    },
    sort_order: { type: "integer", minimum: 0 },
  },
  required: [
    "label_path",
    "prompt_markdown",
    "marks",
    "source_page_numbers",
    "sort_order",
  ],
  additionalProperties: false,
};

const markSchemeItemSchema = {
  type: "object",
  properties: {
    sequence_number: { type: "integer", minimum: 1 },
    part_path: {
      type: "array",
      maxItems: 4,
      items: { type: "string", pattern: "^[A-Za-z0-9]+$" },
    },
    mark_code: nullableString,
    content_markdown: { type: "string" },
    guidance_markdown: { type: "string" },
    is_final_answer: { type: "boolean" },
    is_alternative_method: { type: "boolean" },
    source_page_numbers: {
      type: "array",
      minItems: 1,
      items: { type: "integer", minimum: 1 },
    },
  },
  required: [
    "sequence_number",
    "part_path",
    "mark_code",
    "content_markdown",
    "guidance_markdown",
    "is_final_answer",
    "is_alternative_method",
    "source_page_numbers",
  ],
  additionalProperties: false,
};

const extractionSchema = {
  type: "object",
  properties: {
    paper_summary: {
      type: "object",
      properties: {
        question_count_from_source: nullableInteger,
        total_marks_from_source: nullableInteger,
      },
      required: ["question_count_from_source", "total_marks_from_source"],
      additionalProperties: false,
    },
    questions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          question_number: { type: "integer", minimum: 1 },
          stem_markdown: { type: "string" },
          total_marks: nullableInteger,
          source_page_numbers: {
            type: "array",
            minItems: 1,
            items: { type: "integer", minimum: 1 },
          },
          parts: { type: "array", items: partSchema },
          mark_scheme_items: {
            type: "array",
            minItems: 1,
            items: markSchemeItemSchema,
          },
          assets: { type: "array", items: assetSchema },
          metadata: metadataSchema,
        },
        required: [
          "question_number",
          "stem_markdown",
          "total_marks",
          "source_page_numbers",
          "parts",
          "mark_scheme_items",
          "assets",
          "metadata",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["paper_summary", "questions"],
  additionalProperties: false,
};

const mistralAssetSchema = {
  type: "object",
  properties: {
    asset_type: {
      type: "string",
      enum: [
        "graph",
        "geometry_diagram",
        "mechanics_diagram",
        "table",
        "number_line",
        "coordinate_grid",
        "decorative_or_irrelevant",
        "other_instructional",
      ],
    },
    description: { type: "string" },
    required_to_solve: { type: "boolean" },
    likely_question_number: nullableInteger,
    part_path: { type: "array", maxItems: 4, items: { type: "string" } },
    mathematical_details: mathematicalDetailsSchema,
  },
  required: [
    "asset_type",
    "description",
    "required_to_solve",
    "likely_question_number",
    "part_path",
    "mathematical_details",
  ],
  additionalProperties: false,
};

function codeNode(name, jsCode, position) {
  return {
    parameters: {
      mode: "runOnceForAllItems",
      jsCode,
    },
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position,
    id: idFor(name),
    name,
  };
}

function manualTrigger(name, position) {
  return {
    parameters: {},
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position,
    id: idFor(name),
    name,
  };
}

function subWorkflowTrigger(name, position) {
  return {
    parameters: {},
    type: "n8n-nodes-base.executeWorkflowTrigger",
    typeVersion: 1,
    position,
    id: idFor(name),
    name,
  };
}

function stickyNote(name, content, position, size = [460, 300]) {
  return {
    parameters: {
      content,
      height: size[1],
      width: size[0],
      color: 5,
    },
    type: "n8n-nodes-base.stickyNote",
    typeVersion: 1,
    position,
    id: idFor(name),
    name,
  };
}

function ifNode(name, leftValue, position) {
  return {
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
            id: idFor(name + "-condition"),
            leftValue,
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
    position,
    id: idFor(name),
    name,
  };
}

function supabaseRequest(
  name,
  method,
  url,
  jsonBody,
  position,
  extraHeaders = [],
  responseFormat = "json",
) {
  const parameters = {
    method,
    url,
    authentication: "predefinedCredentialType",
    nodeCredentialType: "supabaseApi",
    sendHeaders: true,
    headerParameters: { parameters: extraHeaders },
    options: {
      response: { response: { responseFormat } },
      timeout: 600000,
    },
  };
  if (jsonBody !== undefined) {
    parameters.sendBody = true;
    parameters.specifyBody = "json";
    parameters.jsonBody = jsonBody;
  }
  return {
    parameters,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position,
    id: idFor(name),
    name,
    alwaysOutputData: true,
    // Supabase calls are free and idempotent -- reads, and upserts keyed by a
    // unique column -- so a transient network blip should not end a batch that
    // has already spent money. Deliberately NOT extended to the OpenAI nodes or
    // the sub-workflow call, where a retry re-does paid work.
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    credentials: { supabaseApi: credentials.supabaseApi },
  };
}

function openAiRequest(name, jsonBody, position) {
  return {
    parameters: {
      method: "POST",
      url: "https://api.openai.com/v1/responses",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "openAiApi",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: "Idempotency-Key",
            value: "={{ $json.openai_idempotency_key }}",
          },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody,
      options: {
        response: { response: { responseFormat: "json" } },
        timeout: 600000,
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position,
    id: idFor(name),
    name,
    retryOnFail: true,
    maxTries: 5,
    waitBetweenTries: 10000,
    credentials: { openAiApi: credentials.openAiApi },
  };
}

function connect(connections, source, target, sourceOutput = 0, targetInput = 0) {
  if (!connections[source]) connections[source] = { main: [] };
  while (connections[source].main.length <= sourceOutput) {
    connections[source].main.push([]);
  }
  connections[source].main[sourceOutput].push({
    node: target,
    type: "main",
    index: targetInput,
  });
}

const validateChildInputCode = String.raw`
const input = $input.first().json;
if (!input || !input.config || !input.batch || !input.pair) {
  throw new Error('Expected config, batch and pair objects from the batch controller.');
}
const config = input.config;
const batch = input.batch;
const pair = input.pair;
if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(config.supabase_url || '')) {
  throw new Error('Set a valid Supabase project URL in the batch controller.');
}
if (config.openai_model !== 'gpt-5.4-nano') {
  throw new Error('The guarded workflow only permits gpt-5.4-nano for bulk extraction.');
}
if (Number(config.openai_reservation_usd) > 0.25) {
  throw new Error('Per-paper OpenAI reservation cannot exceed $0.25.');
}
if (!batch.id || !batch.batch_key) throw new Error('The Supabase batch row is missing.');
if (!Array.isArray(pair.documents) || pair.documents.length !== 2) {
  throw new Error('Each paper pair must contain exactly a question paper and mark scheme.');
}
const types = new Set(pair.documents.map((document) => document.document_type));
if (!types.has('question_paper') || !types.has('mark_scheme')) {
  throw new Error('The pair must contain one question paper and one mark scheme.');
}
for (const document of pair.documents) {
  if (!/^https:\/\//i.test(document.source_url || '')) {
    throw new Error('Every document needs an HTTPS source URL.');
  }
}
const sourceKey = [
  pair.qualification,
  pair.syllabus_code,
  pair.year,
  pair.exam_session,
  pair.paper_variant,
].join(':');
const idempotencyKey = [
  'budget-v1',
  batch.batch_key,
  sourceKey,
].join(':');
return [{
  json: {
    config,
    batch,
    pair,
    batch_position: input.batch_position,
    batch_size: input.batch_size,
    source_key: sourceKey,
    idempotency_key: idempotencyKey,
  },
}];
`.trim();

const inspectExistingRunCode = String.raw`
const response = $input.first().json;
const rows = Array.isArray(response) ? response : (response?.id ? [response] : []);
const state = $('Validate Paper Input').first().json;
if (!rows.length) return [{ json: { ...state, skip_existing: false } }];
const run = rows[0];
const finishedStatuses = [
  'awaiting_review',
  'approved',
  'published',
  'search_pending',
  'complete',
];
if (finishedStatuses.includes(run.status)) {
  return [{
    json: {
      ...state,
      skip_existing: true,
      existing_run: run,
    },
  }];
}
if (run.status === 'processing') {
  throw new Error(
    'This paper already has a processing run. Inspect ingestion run ' + run.id +
    ' before retrying to avoid duplicate API work.'
  );
}
return [{ json: { ...state, skip_existing: false, retry_run: run } }];
`.trim();

const existingResultCode = String.raw`
const state = $input.first().json;
return [{
  json: {
    success: true,
    skipped_existing: true,
    message: 'This paper was already staged or published, so no OCR or OpenAI call was made.',
    ingestion_run_id: state.existing_run.id,
    paper_id: state.existing_run.paper_id,
    batch_id: state.batch.id,
    batch_position: state.batch_position,
    batch_size: state.batch_size,
    config: state.config,
    actual_cost_usd: 0,
    ready_for_approval: state.existing_run.validation_report?.passed === true,
  },
}];
`.trim();

const preparePaperUpsertCode = String.raw`
const state = $input.first().json;
return [{
  json: {
    ...state,
    paper_row: {
      qualification: state.pair.qualification,
      syllabus_code: state.pair.syllabus_code,
      subject: state.pair.subject,
      year: state.pair.year,
      exam_session: state.pair.exam_session,
      paper_variant: state.pair.paper_variant,
      status: 'staging',
    },
  },
}];
`.trim();

const prepareRunCode = String.raw`
const response = $input.first().json;
const paper = Array.isArray(response) ? response[0] : response;
const state = $('Prepare Paper Upsert').first().json;
if (!paper?.id) throw new Error('Supabase did not return the paper row.');
return [{
  json: {
    ...state,
    paper_id: paper.id,
    run_body: {
      paper_id: paper.id,
      idempotency_key: state.idempotency_key,
      mode: 'production',
      status: 'processing',
      review_status: 'pending',
      source_key: state.source_key,
      ocr_model: state.config.ocr_model,
      extraction_model: state.config.openai_model,
      verifier_model: null,
      attempt_count: Number(state.retry_run?.attempt_count || 0) + 1,
      source_summary: {
        batch_id: state.batch.id,
        batch_key: state.batch.batch_key,
        batch_position: state.batch_position,
        documents: state.pair.documents,
      },
      extraction_summary: {},
      verifier_report: {},
      validation_report: {},
      started_at: new Date().toISOString(),
      finished_at: null,
    },
  },
}];
`.trim();

const expandDocumentsCode = String.raw`
const response = $input.first().json;
const run = Array.isArray(response) ? response[0] : response;
const state = $('Prepare Ingestion Run').first().json;
if (!run?.id) throw new Error('Supabase did not return the ingestion run.');
return state.pair.documents.map((document, index) => ({
  json: {
    config: state.config,
    batch: state.batch,
    pair: state.pair,
    batch_position: state.batch_position,
    batch_size: state.batch_size,
    paper_id: state.paper_id,
    ingestion_run_id: run.id,
    source_key: state.source_key,
    idempotency_key: state.idempotency_key,
    document,
    mistral_request: {
      model: state.config.ocr_model,
      document: {
        type: 'document_url',
        document_url: document.source_url,
      },
      bbox_annotation_format: {
        type: 'json_schema',
        json_schema: {
          name: 'shamo_instructional_asset',
          strict: true,
          schema: ${JSON.stringify(mistralAssetSchema)},
        },
      },
      include_image_base64: true,
      confidence_scores_granularity: 'page',
    },
  },
  pairedItem: { item: index },
}));
`.trim();

const attachOcrCode = String.raw`
const responses = $input.all();
const sources = $('Expand Paper Documents').all();
if (responses.length !== 2 || sources.length !== 2) {
  throw new Error('OCR must return exactly two document responses.');
}
return responses.map((item, index) => {
  const source = sources[index].json;
  const ocr = item.json;
  if (!Array.isArray(ocr.pages) || !ocr.pages.length) {
    throw new Error('Mistral OCR returned no pages for ' + source.document.document_type + '.');
  }
  return {
    json: {
      ...source,
      ocr_model_returned: ocr.model || source.config.ocr_model,
      ocr_usage: ocr.usage_info || {},
      pages: ocr.pages,
    },
  };
});
`.trim();

const buildOcrStateCode = String.raw`
const documents = $input.all().map((item) => item.json);
if (documents.length !== 2) throw new Error('Expected exactly two OCR documents.');
const first = documents[0];
const pageRows = [];
const compactDocuments = [];
for (const document of documents) {
  const compactPages = [];
  for (const page of document.pages) {
    const pageNumber = Number(page.index) + 1;
    pageRows.push({
      ingestion_run_id: document.ingestion_run_id,
      document_type: document.document.document_type,
      page_number: pageNumber,
      raw_markdown: page.markdown || '',
      ocr_confidence: page.confidence ?? page.confidence_score ?? null,
    });
    compactPages.push({
      page_number: pageNumber,
      markdown: page.markdown || '',
      images: (page.images || []).map((image, imageIndex) => ({
        source_image_index: imageIndex,
        id: image.id || null,
        top_left_x: image.top_left_x ?? null,
        top_left_y: image.top_left_y ?? null,
        bottom_right_x: image.bottom_right_x ?? null,
        bottom_right_y: image.bottom_right_y ?? null,
        image_annotation: image.image_annotation || null,
      })),
    });
  }
  compactDocuments.push({
    document_type: document.document.document_type,
    source_url: document.document.source_url,
    page_count: document.pages.length,
    ocr_model: document.ocr_model_returned,
    pages: compactPages,
  });
}
return [{
  json: {
    config: first.config,
    batch: first.batch,
    pair: first.pair,
    batch_position: first.batch_position,
    batch_size: first.batch_size,
    paper_id: first.paper_id,
    ingestion_run_id: first.ingestion_run_id,
    source_key: first.source_key,
    idempotency_key: first.idempotency_key,
    ocr_documents: documents,
    compact_documents: compactDocuments,
    known_documents: compactDocuments.map((document) => ({
      document_type: document.document_type,
      source_url: document.source_url,
      source_url_hash: null,
      page_count: document.page_count,
      ocr_model: document.ocr_model,
    })),
    ocr_page_rows: pageRows,
  },
}];
`.trim();

const prepareReservationCode = String.raw`
const state = $('Build OCR State').first().json;
const openaiIdempotencyKey = state.idempotency_key + ':extract';
return [{
  json: {
    ...state,
    openai_idempotency_key: openaiIdempotencyKey,
    reserve_body: {
      requested_batch_id: state.batch.id,
      requested_ingestion_run_id: state.ingestion_run_id,
      requested_idempotency_key: openaiIdempotencyKey,
      requested_provider: 'openai',
      requested_model: state.config.openai_model,
      requested_operation: 'paper_bundle_extraction',
      requested_reserved_usd: state.config.openai_reservation_usd,
    },
  },
}];
`.trim();

const buildExtractionRequestCode = String.raw`
const reservationResponse = $input.first().json;
const reservation = Array.isArray(reservationResponse)
  ? reservationResponse[0]
  : reservationResponse;
const state = $('Prepare Budget Reservation').first().json;
if (!reservation?.cost_event_id) {
  throw new Error('The database did not return an API cost reservation.');
}
const prompt = [
  'Extract one complete Cambridge Mathematics question paper and its matching mark scheme from OCR.',
  'Use only the supplied OCR pages. Never invent missing text, values, part labels, marks or examiner guidance.',
  'Return every main question in numerical order and every visibly printed part label.',
  'For unparted questions use parts=[] and keep the complete question in stem_markdown.',
  'Never place labels such as (a) inside question_number.',
  'Transcribe mathematical signs, brackets, powers, roots, limits, coordinates and inequalities exactly in Markdown/LaTeX.',
  'The mark scheme is a table. Preserve each separate Answer/Marks/Guidance row as one mark_scheme_item.',
  'content_markdown contains the Answer cell; guidance_markdown contains the complete Guidance cell.',
  'The Marks column alone determines mark_code. A blank Answer and Marks row may be guidance-only with mark_code=null.',
  'Preserve dependency asterisks and examiner abbreviations such as FT, OE, SC, CWO, AWRT and AG.',
  'Use 1-based PDF page numbers.',
  'Include only instructional images required to understand or solve a question.',
  'Every asset must reference an OCR image using its document_type, page_number and source_image_index.',
  'Classify each question using concise Cambridge Mathematics terminology.',
  'main_topic should be broad, such as Algebra, Calculus, Trigonometry, Vectors, Statistics or Mechanics.',
  'skills and methods should describe what a student must do, not merely repeat the question text.',
  'Difficulty is 1 (very routine) to 5 (unusually demanding), or null if uncertain.',
  'Set classification_confidence below 0.75 whenever the classification is uncertain.',
  'Use metadata_model=' + state.config.openai_model + ' and taxonomy_version=cambridge-maths-v1.',
  'This is extraction, not solution generation. Do not add worked solutions beyond the official mark scheme.',
].join('\n');
return [{
  json: {
    ...state,
    cost_event_id: reservation.cost_event_id,
    openai_request: {
      model: state.config.openai_model,
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 40000,
      input: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [{
            type: 'input_text',
            text: JSON.stringify({
              paper: {
                qualification: state.pair.qualification,
                syllabus_code: state.pair.syllabus_code,
                subject: state.pair.subject,
                year: state.pair.year,
                exam_session: state.pair.exam_session,
                paper_variant: state.pair.paper_variant,
              },
              documents: state.compact_documents,
            }),
          }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'shamo_budget_paper_extraction',
          strict: true,
          schema: ${JSON.stringify(extractionSchema)},
        },
      },
    },
  },
}];
`.trim();

const parseExtractionCode = String.raw`
const response = $input.first().json;
const state = $('Build Low Cost Extraction Request').first().json;
if (response.status === 'incomplete') {
  throw new Error('OpenAI extraction was incomplete: ' + JSON.stringify(response.incomplete_details || {}));
}
const message = (response.output || []).find((entry) => entry.type === 'message');
if (!message) throw new Error('OpenAI returned no message output.');
const refusal = (message.content || []).find((entry) => entry.type === 'refusal');
if (refusal) throw new Error('OpenAI refused extraction: ' + (refusal.refusal || 'unknown refusal'));
const outputText = (message.content || []).find((entry) => entry.type === 'output_text');
if (!outputText?.text) throw new Error('OpenAI returned no structured extraction.');
let extracted;
try {
  extracted = JSON.parse(outputText.text);
} catch (error) {
  throw new Error('Could not parse OpenAI extraction JSON: ' + error.message);
}
for (const question of extracted.questions || []) {
  question.metadata.metadata_model = state.config.openai_model;
  question.metadata.taxonomy_version = 'cambridge-maths-v1';
}
const usage = response.usage || {};
const inputTokens = Number(usage.input_tokens || 0);
const cachedInputTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
const outputTokens = Number(usage.output_tokens || 0);
const prices = state.config.openai_prices_per_million;
const actualCostUsd =
  Math.max(0, inputTokens - cachedInputTokens) * Number(prices.input) / 1000000 +
  cachedInputTokens * Number(prices.cached_input) / 1000000 +
  outputTokens * Number(prices.output) / 1000000;
return [{
  json: {
    ...state,
    paper_summary: extracted.paper_summary,
    paper_bundle: {
      documents: state.known_documents,
      questions: extracted.questions,
    },
    extraction_response_id: response.id || null,
    api_usage: {
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      actual_cost_usd: Number(actualCostUsd.toFixed(8)),
    },
    finalize_cost_body: {
      requested_cost_event_id: state.cost_event_id,
      requested_input_tokens: inputTokens,
      requested_cached_input_tokens: cachedInputTokens,
      requested_output_tokens: outputTokens,
      requested_actual_usd: Number(actualCostUsd.toFixed(8)),
      requested_provider_request_id: response.id || null,
    },
  },
}];
`.trim();

const restoreExtractionCode = String.raw`
return [{ json: $('Parse Low Cost Extraction').first().json }];
`.trim();

const deterministicValidationCode = String.raw`
const state = $input.first().json;
const bundle = state.paper_bundle;
const issues = [];
const addIssue = (severity, issue_code, message, extra = {}) => issues.push({
  severity,
  issue_code,
  document_type: extra.document_type || null,
  page_number: extra.page_number || null,
  question_number: extra.question_number || null,
  part_path: extra.part_path || [],
  message,
});
const questions = Array.isArray(bundle?.questions) ? bundle.questions : [];
if (!questions.length) {
  addIssue('blocking', 'NO_QUESTIONS_EXTRACTED', 'No questions were extracted.');
}
const numbers = questions.map((question) => Number(question.question_number));
const uniqueNumbers = new Set(numbers);
if (uniqueNumbers.size !== numbers.length) {
  addIssue('blocking', 'DUPLICATE_QUESTION_NUMBER', 'Duplicate question numbers were extracted.');
}
const maxNumber = numbers.length ? Math.max(...numbers) : 0;
for (let number = 1; number <= maxNumber; number++) {
  if (!uniqueNumbers.has(number)) {
    addIssue('blocking', 'MISSING_QUESTION_NUMBER', 'Question ' + number + ' is missing.', {
      question_number: number,
    });
  }
}
const statedQuestionCount = state.paper_summary?.question_count_from_source;
if (Number.isInteger(statedQuestionCount) && statedQuestionCount !== questions.length) {
  addIssue('blocking', 'QUESTION_COUNT_MISMATCH',
    'The source indicates ' + statedQuestionCount + ' questions but ' + questions.length + ' were extracted.');
}
const extractedMarks = questions.reduce((sum, question) => sum + Number(question.total_marks || 0), 0);
const statedMarks = state.paper_summary?.total_marks_from_source;
if (Number.isInteger(statedMarks) && statedMarks !== extractedMarks) {
  addIssue('blocking', 'PAPER_MARK_TOTAL_MISMATCH',
    'The source indicates ' + statedMarks + ' marks but extracted question totals add to ' + extractedMarks + '.');
}
const pageCounts = Object.fromEntries(
  state.known_documents.map((document) => [document.document_type, document.page_count])
);
const imageKeys = new Set();
const imageDataKeys = new Set();
for (const document of state.ocr_documents) {
  for (const page of document.pages) {
    (page.images || []).forEach((image, index) => {
      const key = [
        document.document.document_type,
        Number(page.index) + 1,
        index,
      ].join(':');
      imageKeys.add(key);
      if (image.image_base64) imageDataKeys.add(key);
    });
  }
}
const forbiddenPattern = /(DO NOT WRITE IN THIS MARGIN|0000800000|\*{1,2}\d{8,}\*{1,2})/i;
for (const question of questions) {
  const qn = Number(question.question_number);
  if (!(question.stem_markdown || '').trim() && !(question.parts || []).length) {
    addIssue('blocking', 'EMPTY_QUESTION_TEXT', 'Question has no stem or parts.', { question_number: qn });
  }
  if (forbiddenPattern.test(question.stem_markdown || '')) {
    addIssue('blocking', 'OCR_ARTIFACT_IN_QUESTION', 'Question text contains a margin or barcode artifact.', {
      question_number: qn,
    });
  }
  const questionPages = question.source_page_numbers || [];
  if (!questionPages.length || questionPages.some(
    (page) => page < 1 || page > Number(pageCounts.question_paper || 0)
  )) {
    addIssue('blocking', 'INVALID_QUESTION_PAGE', 'Question has an invalid source page.', {
      question_number: qn,
    });
  }
  const partPaths = new Set();
  let knownPartMarks = 0;
  let allPartMarksKnown = true;
  for (const part of question.parts || []) {
    const path = (part.label_path || []).join('.');
    if (!path || partPaths.has(path)) {
      addIssue('blocking', 'DUPLICATE_OR_EMPTY_PART_PATH', 'Question contains an empty or duplicate part path.', {
        question_number: qn,
        part_path: part.label_path || [],
      });
    }
    partPaths.add(path);
    if (part.marks === null) allPartMarksKnown = false;
    else knownPartMarks += Number(part.marks || 0);
    // A PARENT part legitimately has no prompt of its own. Cambridge prints
    // (b) as a bare label and puts the text in (b)(i) and (b)(ii) beneath it --
    // 9709/13 O/N 2025 Q11 is exactly that shape, and blocking on it demands a
    // human recover text the paper never printed.
    //
    // Only a LEAF with no prompt is a real defect, because that is a part a
    // student would be shown with nothing to answer. Note the contrast with the
    // sibling case: a parent that DOES carry shared context, like 9709/13 M/J
    // 2025 Q10(c), keeps its prompt and is unaffected either way.
    //
    // (No backticks in this comment: it lives inside a String.raw template.)
    const hasChildren = (question.parts || []).some((other) => {
      const own = part.label_path || [];
      const theirs = other.label_path || [];
      return theirs.length > own.length && own.every((seg, i) => theirs[i] === seg);
    });
    if (!(part.prompt_markdown || '').trim() && !hasChildren) {
      addIssue('blocking', 'EMPTY_PART_TEXT', 'A leaf question part has no prompt.', {
        question_number: qn,
        part_path: part.label_path || [],
      });
    }
  }
  if ((question.parts || []).length && allPartMarksKnown
      && question.total_marks !== null
      && knownPartMarks !== Number(question.total_marks)) {
    addIssue('blocking', 'QUESTION_MARK_TOTAL_MISMATCH',
      'Part marks add to ' + knownPartMarks + ' but the question total is ' + question.total_marks + '.', {
        question_number: qn,
      });
  }
  const markItems = question.mark_scheme_items || [];
  if (!markItems.length) {
    addIssue('blocking', 'MISSING_MARK_SCHEME', 'Question has no mark-scheme rows.', {
      question_number: qn,
    });
  }
  const sequenceNumbers = new Set();
  let primaryMarkCount = 0;
  for (const mark of markItems) {
    if (sequenceNumbers.has(mark.sequence_number)) {
      addIssue('blocking', 'DUPLICATE_MARK_SCHEME_SEQUENCE',
        'Duplicate mark-scheme sequence ' + mark.sequence_number + '.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    sequenceNumbers.add(mark.sequence_number);
    const partPath = (mark.part_path || []).join('.');
    if (partPath && !partPaths.has(partPath)) {
      addIssue('blocking', 'MARK_SCHEME_UNKNOWN_PART',
        'Mark scheme references missing part ' + partPath + '.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    const hasAnswer = (mark.content_markdown || '').trim().length > 0;
    const hasGuidance = (mark.guidance_markdown || '').trim().length > 0;
    if (!hasAnswer && !hasGuidance) {
      addIssue('blocking', 'EMPTY_MARK_SCHEME_ROW',
        'Mark-scheme row has neither answer nor guidance.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    if (!hasAnswer && mark.mark_code !== null) {
      addIssue('blocking', 'GUIDANCE_ONLY_ROW_HAS_MARK_CODE',
        'A guidance-only row must have mark_code=null.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    for (const page of mark.source_page_numbers || []) {
      if (page < 1 || page > Number(pageCounts.mark_scheme || 0)) {
        addIssue('blocking', 'INVALID_MARK_SCHEME_PAGE',
          'Mark-scheme row has an invalid page reference.', {
            question_number: qn,
            part_path: mark.part_path || [],
          });
      }
    }
    if (!mark.is_alternative_method && mark.mark_code) {
      primaryMarkCount += (
        String(mark.mark_code).match(/(?:\*?D?M1|A1|B1|B2|B3)/g) || []
      ).reduce((count, code) => {
        const value = Number(code.match(/\d+/)?.[0] || 1);
        return count + value;
      }, 0);
    }
  }
  if (question.total_marks !== null && primaryMarkCount < Number(question.total_marks)) {
    addIssue('blocking', 'MARK_CODE_COVERAGE_TOO_LOW',
      'Primary mark codes cover ' + primaryMarkCount +
      ' marks but the question is worth ' + question.total_marks + '.', {
        question_number: qn,
      });
  }
  const metadata = question.metadata || {};
  if (!(metadata.main_topic || '').trim() || !(metadata.skills || []).length) {
    addIssue('blocking', 'INCOMPLETE_QUESTION_METADATA',
      'Question needs a main topic and at least one skill.', { question_number: qn });
  }
  if (Number(metadata.classification_confidence || 0) < 0.75) {
    addIssue('warning', 'LOW_METADATA_CONFIDENCE',
      'Topic/skill classification confidence is below 0.75 and should be reviewed.', {
        question_number: qn,
      });
  }
  for (const asset of question.assets || []) {
    const key = [
      asset.document_type,
      asset.source_page_number,
      asset.source_image_index,
    ].join(':');
    if (!imageKeys.has(key)) {
      addIssue('blocking', 'ASSET_SOURCE_NOT_FOUND', 'Asset does not match an OCR image: ' + key + '.', {
        document_type: asset.document_type,
        page_number: asset.source_page_number,
        question_number: qn,
        part_path: asset.part_path || [],
      });
    } else if (!imageDataKeys.has(key)) {
      addIssue('blocking', 'ASSET_IMAGE_DATA_MISSING', 'OCR image data is missing: ' + key + '.', {
        document_type: asset.document_type,
        page_number: asset.source_page_number,
        question_number: qn,
        part_path: asset.part_path || [],
      });
    }
  }
}
const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;
return [{
  json: {
    ...state,
    validation_report: {
      passed: blockingCount === 0,
      question_count: questions.length,
      extracted_total_marks: extractedMarks,
      source_question_count: statedQuestionCount ?? null,
      source_total_marks: statedMarks ?? null,
      blocking_issue_count: blockingCount,
      warning_count: issues.filter((issue) => issue.severity === 'warning').length,
      issues,
    },
    verifier_report: {
      passed: blockingCount === 0,
      mode: 'manual_review_gate',
      independent_paid_verifier_used: false,
      note: 'Bulk mode uses deterministic checks and requires human review before publication.',
      issues: [],
    },
  },
}];
`.trim();

const prepareAssetsCode = String.raw`
const state = $input.first().json;
const imageMap = new Map();
for (const document of state.ocr_documents) {
  for (const page of document.pages) {
    (page.images || []).forEach((image, index) => {
      imageMap.set([
        document.document.document_type,
        Number(page.index) + 1,
        index,
      ].join(':'), image);
    });
  }
}
const output = [];
state.paper_bundle.questions.forEach((question, questionIndex) => {
  (question.assets || []).forEach((asset, assetIndex) => {
    const key = [
      asset.document_type,
      asset.source_page_number,
      asset.source_image_index,
    ].join(':');
    const image = imageMap.get(key);
    if (!image?.image_base64) return;
    const match = String(image.image_base64).match(
      /^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/s
    );
    const mimeType = match ? match[1] : 'image/png';
    const base64 = match ? match[2] : String(image.image_base64);
    const extension = mimeType.includes('jpeg')
      ? 'jpg'
      : (mimeType.split('/')[1] || 'png').replace('+xml', '');
    const partSuffix = (asset.part_path || []).length
      ? '-part-' + asset.part_path.join('-')
      : '';
    const storagePath = [
      state.pair.qualification,
      state.pair.syllabus_code,
      state.pair.year,
      state.pair.exam_session,
      state.pair.paper_variant,
      asset.document_type,
      'q' + question.question_number + partSuffix,
      'page-' + asset.source_page_number + '-image-' +
        asset.source_image_index + '.' + extension,
    ].join('/');
    output.push({
      json: {
        skip_upload: false,
        question_index: questionIndex,
        asset_index: assetIndex,
        storage_path: storagePath,
        storage_bucket: state.config.storage_bucket,
        mime_type: mimeType,
        byte_size: Math.floor(base64.length * 3 / 4),
        checksum: null,
      },
      binary: {
        data: {
          data: base64,
          mimeType,
          fileName: storagePath.split('/').pop(),
          fileExtension: extension,
        },
      },
    });
  });
});
if (!output.length) return [{ json: { skip_upload: true } }];
return output;
`.trim();

const collectUploadsCode = String.raw`
const prepared = $('Prepare Instructional Assets').all().filter(
  (item) => !item.json.skip_upload
);
const responses = $input.all();
if (responses.length !== prepared.length) {
  throw new Error('Supabase Storage response count does not match prepared assets.');
}
return [{
  json: {
    uploaded_assets: prepared.map((item, index) => ({
      ...item.json,
      upload_response: responses[index].json,
    })),
  },
}];
`.trim();

const noUploadsCode = String.raw`
return [{ json: { uploaded_assets: [] } }];
`.trim();

const finalizeStagingCode = String.raw`
const state = $('Deterministic Validation').first().json;
const branch = $input.first().json;
const uploaded = branch.uploaded_assets || [];
const bundle = JSON.parse(JSON.stringify(state.paper_bundle));
const extractedAssetCount = bundle.questions.reduce(
  (sum, question) => sum + (question.assets || []).length,
  0
);
for (const uploadedAsset of uploaded) {
  const asset = bundle.questions[uploadedAsset.question_index]
    .assets[uploadedAsset.asset_index];
  asset.storage_bucket = uploadedAsset.storage_bucket;
  asset.storage_path = uploadedAsset.storage_path;
  asset.mime_type = uploadedAsset.mime_type;
  asset.byte_size = uploadedAsset.byte_size || null;
  asset.checksum = uploadedAsset.checksum || null;
}
for (const question of bundle.questions) {
  question.assets = (question.assets || []).filter((asset) => asset.storage_path);
}
const issues = [...(state.validation_report.issues || [])];
if (uploaded.length !== extractedAssetCount) {
  issues.push({
    severity: 'blocking',
    issue_code: 'ASSET_UPLOAD_COUNT_MISMATCH',
    document_type: null,
    page_number: null,
    question_number: null,
    part_path: [],
    message: 'Extracted ' + extractedAssetCount + ' assets but uploaded ' + uploaded.length + '.',
  });
}
const seen = new Set();
const uniqueIssues = issues.filter((issue) => {
  const key = JSON.stringify([
    issue.severity,
    issue.issue_code,
    issue.document_type,
    issue.page_number,
    issue.question_number,
    issue.part_path,
    issue.message,
  ]);
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
const issueRows = uniqueIssues.map((issue) => ({
  ingestion_run_id: state.ingestion_run_id,
  severity: issue.severity,
  issue_code: issue.issue_code,
  document_type: issue.document_type || null,
  page_number: issue.page_number || null,
  question_number: issue.question_number || null,
  part_path: (issue.part_path || []).length ? issue.part_path : null,
  message: issue.message,
}));
const partCount = bundle.questions.reduce(
  (sum, question) => sum + (question.parts || []).length,
  0
);
const assetCount = bundle.questions.reduce(
  (sum, question) => sum + (question.assets || []).length,
  0
);
const hasBlocking = uniqueIssues.some((issue) => issue.severity === 'blocking');
const readyForApproval = state.validation_report.passed === true && !hasBlocking;
const summary = {
  questions: bundle.questions.length,
  parts: partCount,
  assets: assetCount,
  issues: issueRows.length,
  blocking_issues: issueRows.filter((issue) => issue.severity === 'blocking').length,
  openai_cost_usd: state.api_usage.actual_cost_usd,
};
return [{
  json: {
    config: state.config,
    batch: state.batch,
    pair: state.pair,
    batch_position: state.batch_position,
    batch_size: state.batch_size,
    paper_id: state.paper_id,
    ingestion_run_id: state.ingestion_run_id,
    paper_bundle: bundle,
    issue_rows: issueRows,
    ready_for_approval: readyForApproval,
    summary,
    api_usage: state.api_usage,
    update_body: {
      status: 'awaiting_review',
      review_status: 'pending',
      extraction_summary: {
        paper_bundle: bundle,
        extraction_response_id: state.extraction_response_id,
        ready_for_approval: readyForApproval,
        manual_review_required: true,
        independent_paid_verifier_used: false,
        api_usage: state.api_usage,
        staged_at: new Date().toISOString(),
        summary,
      },
      verifier_report: state.verifier_report,
      validation_report: {
        ...state.validation_report,
        passed: readyForApproval,
        issues: uniqueIssues,
      },
      question_count: bundle.questions.length,
      question_part_count: partCount,
      asset_count: assetCount,
      finished_at: new Date().toISOString(),
    },
  },
}];
`.trim();

const restoreFinalStateCode = String.raw`
return [{ json: $('Finalize Review Package').first().json }];
`.trim();

const finalChildResultCode = String.raw`
const state = $('Restore Final Review State').first().json;
return [{
  json: {
    success: true,
    skipped_existing: false,
    message: state.ready_for_approval
      ? 'Paper is staged for manual review.'
      : 'Paper is staged with issues that must be corrected.',
    ingestion_run_id: state.ingestion_run_id,
    paper_id: state.paper_id,
    batch_id: state.batch.id,
    batch_key: state.batch.batch_key,
    batch_position: state.batch_position,
    batch_size: state.batch_size,
    config: state.config,
    ready_for_approval: state.ready_for_approval,
    summary: state.summary,
    actual_cost_usd: state.api_usage.actual_cost_usd,
    next_step: 'Review this run in shamo_ingestion_review_queue. Do not publish automatically.',
  },
}];
`.trim();

const childNodes = [
  stickyNote(
    "Child workflow note",
    "## Guarded one-paper staging\nCalled by the batch controller. It performs two free OCR calls, one `gpt-5.4-nano` structured extraction, free deterministic checks, and then stops for human review.\n\nIt never publishes automatically.",
    [-760, -500],
    [520, 300],
  ),
  subWorkflowTrigger("When Called by Batch Controller", [-680, 0]),
  codeNode("Validate Paper Input", validateChildInputCode, [-440, 0]),
  supabaseRequest(
    "Check Existing Ingestion Run",
    "GET",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_ingestion_runs?idempotency_key=eq.' + encodeURIComponent($json.idempotency_key) + '&select=*' }}",
    undefined,
    [-200, 0],
  ),
  codeNode("Inspect Existing Ingestion Run", inspectExistingRunCode, [40, 0]),
  ifNode("Already Staged or Published", "={{ $json.skip_existing }}", [280, 0]),
  codeNode("Existing Paper Result", existingResultCode, [520, -180]),
  codeNode("Prepare Paper Upsert", preparePaperUpsertCode, [520, 80]),
  supabaseRequest(
    "Upsert Paper",
    "POST",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_papers?on_conflict=qualification,syllabus_code,year,exam_session,paper_variant&select=*' }}",
    "={{ $json.paper_row }}",
    [760, 80],
    [{ name: "Prefer", value: "resolution=merge-duplicates,return=representation" }],
  ),
  codeNode("Prepare Ingestion Run", prepareRunCode, [1000, 80]),
  supabaseRequest(
    "Create or Retry Ingestion Run",
    "POST",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_ingestion_runs?on_conflict=idempotency_key&select=*' }}",
    "={{ $json.run_body }}",
    [1240, 80],
    [{ name: "Prefer", value: "resolution=merge-duplicates,return=representation" }],
  ),
  codeNode("Expand Paper Documents", expandDocumentsCode, [1480, 80]),
  {
    parameters: {
      method: "POST",
      url: "https://api.mistral.ai/v1/ocr",
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ $json.mistral_request }}",
      options: {
        response: { response: { responseFormat: "json" } },
        timeout: 600000,
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [1720, 80],
    id: idFor("Mistral OCR Both Documents"),
    name: "Mistral OCR Both Documents",
    retryOnFail: true,
    maxTries: 5,
    waitBetweenTries: 10000,
  },
  codeNode("Attach OCR Results", attachOcrCode, [1960, 80]),
  codeNode("Build OCR State", buildOcrStateCode, [2200, 80]),
  supabaseRequest(
    "Store Temporary OCR Pages",
    "POST",
    "={{ $('Validate Paper Input').first().json.config.supabase_url + '/rest/v1/shamo_ingestion_pages?on_conflict=ingestion_run_id,document_type,page_number' }}",
    "={{ $json.ocr_page_rows }}",
    [2440, 80],
    [{ name: "Prefer", value: "resolution=merge-duplicates,return=minimal" }],
    "text",
  ),
  codeNode("Prepare Budget Reservation", prepareReservationCode, [2680, 80]),
  supabaseRequest(
    "Reserve OpenAI Budget",
    "POST",
    "={{ $json.config.supabase_url + '/rest/v1/rpc/shamo_reserve_api_budget' }}",
    "={{ $json.reserve_body }}",
    [2920, 80],
  ),
  codeNode("Build Low Cost Extraction Request", buildExtractionRequestCode, [3160, 80]),
  openAiRequest(
    "OpenAI One-Pass Paper Extraction",
    "={{ $json.openai_request }}",
    [3400, 80],
  ),
  codeNode("Parse Low Cost Extraction", parseExtractionCode, [3640, 80]),
  supabaseRequest(
    "Finalize OpenAI Cost",
    "POST",
    "={{ $json.config.supabase_url + '/rest/v1/rpc/shamo_finalize_api_cost_event' }}",
    "={{ $json.finalize_cost_body }}",
    [3880, 80],
  ),
  codeNode("Restore Extracted Paper", restoreExtractionCode, [4120, 80]),
  codeNode("Deterministic Validation", deterministicValidationCode, [4360, 80]),
  codeNode("Prepare Instructional Assets", prepareAssetsCode, [4600, 80]),
  ifNode("Has Instructional Assets", "={{ !$json.skip_upload }}", [4840, 80]),
  {
    parameters: {
      method: "POST",
      url: "={{ $('Validate Paper Input').first().json.config.supabase_url + '/storage/v1/object/' + $json.storage_bucket + '/' + $json.storage_path }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "x-upsert", value: "true" },
          { name: "Content-Type", value: "={{ $json.mime_type }}" },
        ],
      },
      sendBody: true,
      contentType: "binaryData",
      inputDataFieldName: "data",
      options: { response: { response: { responseFormat: "json" } } },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [5080, -40],
    id: idFor("Upload Instructional Assets"),
    name: "Upload Instructional Assets",
    credentials: { supabaseApi: credentials.supabaseApi },
  },
  codeNode("Collect Asset Uploads", collectUploadsCode, [5320, -40]),
  codeNode("No Instructional Assets", noUploadsCode, [5080, 200]),
  codeNode("Finalize Review Package", finalizeStagingCode, [5560, 80]),
  supabaseRequest(
    "Update Staged Ingestion Run",
    "PATCH",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_ingestion_runs?id=eq.' + $json.ingestion_run_id + '&select=*' }}",
    "={{ $json.update_body }}",
    [5800, 80],
    [{ name: "Prefer", value: "return=representation" }],
  ),
  codeNode("Restore Final Review State", restoreFinalStateCode, [6040, 80]),
  ifNode("Has Validation Issues", "={{ $json.issue_rows.length > 0 }}", [6280, 80]),
  supabaseRequest(
    "Store Validation Issues",
    "POST",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_ingestion_issues' }}",
    "={{ $json.issue_rows }}",
    [6520, -40],
    [{ name: "Prefer", value: "return=minimal" }],
    "text",
  ),
  codeNode("Paper Staging Result", finalChildResultCode, [6760, 80]),
];

const childConnections = {};
connect(childConnections, "When Called by Batch Controller", "Validate Paper Input");
connect(childConnections, "Validate Paper Input", "Check Existing Ingestion Run");
connect(childConnections, "Check Existing Ingestion Run", "Inspect Existing Ingestion Run");
connect(childConnections, "Inspect Existing Ingestion Run", "Already Staged or Published");
connect(childConnections, "Already Staged or Published", "Existing Paper Result", 0);
connect(childConnections, "Already Staged or Published", "Prepare Paper Upsert", 1);
connect(childConnections, "Prepare Paper Upsert", "Upsert Paper");
connect(childConnections, "Upsert Paper", "Prepare Ingestion Run");
connect(childConnections, "Prepare Ingestion Run", "Create or Retry Ingestion Run");
connect(childConnections, "Create or Retry Ingestion Run", "Expand Paper Documents");
connect(childConnections, "Expand Paper Documents", "Mistral OCR Both Documents");
connect(childConnections, "Mistral OCR Both Documents", "Attach OCR Results");
connect(childConnections, "Attach OCR Results", "Build OCR State");
connect(childConnections, "Build OCR State", "Store Temporary OCR Pages");
connect(childConnections, "Store Temporary OCR Pages", "Prepare Budget Reservation");
connect(childConnections, "Prepare Budget Reservation", "Reserve OpenAI Budget");
connect(childConnections, "Reserve OpenAI Budget", "Build Low Cost Extraction Request");
connect(childConnections, "Build Low Cost Extraction Request", "OpenAI One-Pass Paper Extraction");
connect(childConnections, "OpenAI One-Pass Paper Extraction", "Parse Low Cost Extraction");
connect(childConnections, "Parse Low Cost Extraction", "Finalize OpenAI Cost");
connect(childConnections, "Finalize OpenAI Cost", "Restore Extracted Paper");
connect(childConnections, "Restore Extracted Paper", "Deterministic Validation");
connect(childConnections, "Deterministic Validation", "Prepare Instructional Assets");
connect(childConnections, "Prepare Instructional Assets", "Has Instructional Assets");
connect(childConnections, "Has Instructional Assets", "Upload Instructional Assets", 0);
connect(childConnections, "Upload Instructional Assets", "Collect Asset Uploads");
connect(childConnections, "Collect Asset Uploads", "Finalize Review Package");
connect(childConnections, "Has Instructional Assets", "No Instructional Assets", 1);
connect(childConnections, "No Instructional Assets", "Finalize Review Package");
connect(childConnections, "Finalize Review Package", "Update Staged Ingestion Run");
connect(childConnections, "Update Staged Ingestion Run", "Restore Final Review State");
connect(childConnections, "Restore Final Review State", "Has Validation Issues");
connect(childConnections, "Has Validation Issues", "Store Validation Issues", 0);
connect(childConnections, "Store Validation Issues", "Paper Staging Result");
connect(childConnections, "Has Validation Issues", "Paper Staging Result", 1);

const childWorkflow = {
  name: "Shamo Budget v1 - Stage One Maths Paper",
  nodes: childNodes,
  pinData: {},
  connections: childConnections,
  active: false,
  settings: {
    executionOrder: "v1",
    saveManualExecutions: true,
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
  },
  versionId: idFor("budget-child-workflow-version"),
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

const controllerConfigCode = String.raw`
const config = {
  supabase_url: 'https://YOUR_PROJECT_REF.supabase.co',
  google_document_id: '14QHYH5T22qyGQJH-6SLW00q9yTuDhGwe1mEM7liaEbY',
  google_sheet_name: 'Test 2',
  qualification: 'a_level',
  syllabus_code: '9709',
  subject: 'Mathematics',
  campaign_key: 'a-level-9709-test2-pilot-v1',
  batch_number: 1,
  max_papers_per_run: 6,
  pause_after_papers: 5,
  pause_minutes: 10,
  // Lowered from 3.00 on 9 August 2026, and the reason is not caution for its
  // own sake. The caps are enforced against OUR ledger, and the ledger is
  // measurably low: on 9 August it recorded USD 0.065450 against a provider
  // dashboard reading of USD 0.17 for the same day, a factor of 2.6. Until that
  // is reconciled, a nominal $3 cap permits roughly $7.80 of real spend.
  //
  // At 1.00 the worst case is about $2.60 real per batch, which is inside the
  // original intent. Restore 3.00 once the ledger and the dashboard agree.
  batch_budget_limit_usd: 1.00,
  campaign_budget_limit_usd: 15.00,
  openai_reservation_usd: 0.25,
  database_safety_megabytes: 350,
  ocr_model: 'mistral-ocr-latest',
  openai_model: 'gpt-5.4-nano',
  openai_prices_per_million: {
    input: 0.20,
    cached_input: 0.02,
    output: 1.25,
  },
  storage_bucket: 'past-paper-assets',
};
if (config.supabase_url.includes('YOUR_PROJECT_REF')) {
  throw new Error('Replace YOUR_PROJECT_REF before running this workflow.');
}
if (config.max_papers_per_run > 6) {
  throw new Error('Safety stop: max_papers_per_run cannot exceed 6.');
}
if (config.batch_budget_limit_usd > 3) {
  throw new Error('Safety stop: the first-six batch budget cannot exceed $3.');
}
if (config.campaign_budget_limit_usd > 15) {
  throw new Error('Safety stop: the Test 2 pilot campaign cannot exceed $15.');
}
return [{ json: config }];
`.trim();

const checkDatabaseUsageCode = String.raw`
const response = $input.first().json;
const usage = Array.isArray(response) ? response[0] : response;
const config = $('Budget Configuration').first().json;
const megabytes = Number(usage?.database_megabytes);
if (!Number.isFinite(megabytes)) {
  throw new Error('Could not read shamo_database_usage from Supabase.');
}
if (megabytes >= Number(config.database_safety_megabytes)) {
  throw new Error(
    'Database safety stop: ' + megabytes + ' MB is at or above the ' +
    config.database_safety_megabytes + ' MB bulk-ingestion limit.'
  );
}
return [{ json: { ...config, database_megabytes_before: megabytes } }];
`.trim();

const pairTest2RowsCode = String.raw`
const rows = $input.all().map((item) => item.json).filter(
  (row) => row['Paper Link'] || row['Document type']
);
const config = $('Check Database Free-Tier Safety').first().json;
const normalizeDocumentType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'question paper') return 'question_paper';
  if (normalized === 'mark scheme') return 'mark_scheme';
  throw new Error('Unexpected Document type: ' + value);
};
const sessionMap = {
  'February/March': 'feb_march',
  'May/June': 'may_june',
  'October/November': 'oct_nov',
};
const parsed = rows.map((row, rowIndex) => {
  const url = String(row['Paper Link'] || '').trim();
  const match = url.match(/\/(\d{4})_([msw])(\d{2})_(qp|ms)_(\d{2})\.pdf$/i);
  if (!match) throw new Error('Could not parse paper identity from row ' + (rowIndex + 2) + ': ' + url);
  const year = 2000 + Number(match[3]);
  const sessionFromUrl = { m: 'feb_march', s: 'may_june', w: 'oct_nov' }[
    match[2].toLowerCase()
  ];
  const documentType = normalizeDocumentType(row['Document type']);
  const urlDocumentType = match[4].toLowerCase() === 'qp'
    ? 'question_paper'
    : 'mark_scheme';
  if (documentType !== urlDocumentType) {
    throw new Error('Document type does not match URL on row ' + (rowIndex + 2) + '.');
  }
  if (String(row.Grade || '').trim() !== 'A-levels') {
    throw new Error('Test 2 row ' + (rowIndex + 2) + ' is not A-levels.');
  }
  if (String(row.Subject || '').trim() !== config.subject) {
    throw new Error('Subject mismatch on row ' + (rowIndex + 2) + '.');
  }
  if (Number(row.Year) !== year) {
    throw new Error('Year mismatch on row ' + (rowIndex + 2) + '.');
  }
  if (sessionMap[String(row['Exam session'] || '').trim()] !== sessionFromUrl) {
    throw new Error('Exam-session mismatch on row ' + (rowIndex + 2) + '.');
  }
  if (String(row['Paper Variant'] || '').trim() !== match[5]) {
    throw new Error('Paper-variant mismatch on row ' + (rowIndex + 2) + '.');
  }
  return {
    qualification: config.qualification,
    syllabus_code: match[1],
    subject: config.subject,
    year,
    exam_session: sessionFromUrl,
    paper_variant: match[5],
    document_type: documentType,
    source_url: url,
  };
});
const grouped = new Map();
for (const row of parsed) {
  const key = [
    row.qualification,
    row.syllabus_code,
    row.year,
    row.exam_session,
    row.paper_variant,
  ].join(':');
  if (!grouped.has(key)) {
    grouped.set(key, {
      qualification: row.qualification,
      syllabus_code: row.syllabus_code,
      subject: row.subject,
      year: row.year,
      exam_session: row.exam_session,
      paper_variant: row.paper_variant,
      documents: [],
    });
  }
  grouped.get(key).documents.push({
    document_type: row.document_type,
    source_url: row.source_url,
  });
}
const sessionOrder = { feb_march: 0, may_june: 1, oct_nov: 2 };
const pairs = [...grouped.values()].sort((a, b) =>
  a.paper_variant.localeCompare(b.paper_variant) ||
  a.year - b.year ||
  sessionOrder[a.exam_session] - sessionOrder[b.exam_session]
);
for (const pair of pairs) {
  if (pair.documents.length !== 2) {
    throw new Error(
      'Paper ' + pair.year + '/' + pair.exam_session + '/' + pair.paper_variant +
      ' does not contain exactly two rows.'
    );
  }
  const types = new Set(pair.documents.map((document) => document.document_type));
  if (!types.has('question_paper') || !types.has('mark_scheme')) {
    throw new Error('A paper pair is missing its question paper or mark scheme.');
  }
}
// Selection must not be hardwired to the calibration set.
//
// This previously asserted exactly 24 pairs and exactly 4 per paper type, and
// indexed modulo 4. Those three assumptions meant a 25th paper in the Google
// Sheet made the controller THROW -- the pipeline could not ingest anything
// beyond the original calibration manifest, which is a hard blocker on scaling
// and was invisible because the sheet happened to hold exactly 24.
//
// The generalisation keeps every property that mattered -- deterministic,
// idempotent, balanced across paper types -- while accepting any manifest size.
// Build one stable global ordering by taking the first paper of each type, then
// the second of each type, and so on, then hand this batch its slice.
if (!pairs.length) {
  throw new Error('The manifest contains no complete question-paper/mark-scheme pairs.');
}
const byPaperType = new Map();
for (const pair of pairs) {
  const paperType = String(pair.paper_variant).charAt(0);
  if (!byPaperType.has(paperType)) byPaperType.set(paperType, []);
  byPaperType.get(paperType).push(pair);
}
const paperTypes = Array.from(byPaperType.keys()).sort();
for (const paperType of paperTypes) {
  byPaperType.get(paperType).sort((a, b) =>
    a.year - b.year ||
    sessionOrder[a.exam_session] - sessionOrder[b.exam_session] ||
    a.paper_variant.localeCompare(b.paper_variant)
  );
}
const deepest = Math.max.apply(null, paperTypes.map(function (t) { return byPaperType.get(t).length; }));
const ordered = [];
for (let depth = 0; depth < deepest; depth += 1) {
  for (const paperType of paperTypes) {
    const pair = byPaperType.get(paperType)[depth];
    if (pair) ordered.push(pair);
  }
}
const batchSize = Math.max(1, Number(config.max_papers_per_run) || 6);
const batchIndex = Math.max(1, Number(config.batch_number)) - 1;
const selected = ordered.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
if (!selected.length) {
  throw new Error(
    'Batch number ' + config.batch_number + ' is past the end of the manifest: ' +
    ordered.length + ' complete pairs across ' + paperTypes.length + ' paper types, ' +
    'batch size ' + batchSize + '.'
  );
}
const batchKey = config.campaign_key + '-batch-' +
  String(config.batch_number).padStart(2, '0');
return [{
  json: {
    config,
    batch_key: batchKey,
    pairs: selected,
    batch_body: {
      batch_key: batchKey,
      campaign_key: config.campaign_key,
      source_sheet: config.google_sheet_name,
      qualification: config.qualification,
      syllabus_code: config.syllabus_code,
      subject: config.subject,
      max_papers: config.max_papers_per_run,
      planned_papers: selected.length,
      batch_budget_limit_usd: config.batch_budget_limit_usd,
      campaign_budget_limit_usd: config.campaign_budget_limit_usd,
      status: 'planned',
    },
  },
}];
`.trim();

const expandBatchCode = String.raw`
const response = $input.first().json;
const batch = Array.isArray(response) ? response[0] : response;
const state = $('Pair and Select Test 2 Papers').first().json;
if (!batch?.id) throw new Error('Supabase did not return the ingestion batch.');
return state.pairs.map((pair, index) => ({
  json: {
    config: state.config,
    batch,
    pair,
    batch_position: index + 1,
    batch_size: state.pairs.length,
  },
  pairedItem: { item: index },
}));
`.trim();

const prepareBatchCompletionCode = String.raw`
const results = $input.all().map((item) => item.json);
if (!results.length) throw new Error('The batch produced no paper results.');
const first = results[0];
const failed = results.filter((result) => result.success !== true);
const updateBody = {
  status: failed.length ? 'failed' : 'awaiting_review',
  finished_at: new Date().toISOString(),
};
return [{
  json: {
    config: first.config,
    batch_id: first.batch_id,
    batch_key: first.batch_key || first.config.campaign_key,
    results,
    update_body: updateBody,
  },
}];
`.trim();

const finalBatchResultCode = String.raw`
const response = $input.first().json;
const budget = Array.isArray(response) ? response[0] : response;
const state = $('Prepare Batch Completion').first().json;
const processed = state.results.filter((result) => !result.skipped_existing);
const skipped = state.results.filter((result) => result.skipped_existing);
return [{
  json: {
    success: true,
    message: 'The guarded batch finished and all new papers are waiting for manual review.',
    batch_id: state.batch_id,
    paper_results: state.results,
    summary: {
      selected_papers: state.results.length,
      newly_processed: processed.length,
      skipped_existing: skipped.length,
      ready_for_approval: state.results.filter((result) => result.ready_for_approval).length,
      needs_correction: state.results.filter((result) => !result.ready_for_approval).length,
      actual_openai_cost_usd: Number(budget?.actual_usd || 0),
      reserved_openai_usd: Number(budget?.reserved_usd || 0),
      batch_budget_limit_usd: Number(budget?.batch_budget_limit_usd || 0),
      campaign_committed_usd: Number(budget?.campaign_committed_usd || 0),
      campaign_budget_limit_usd: Number(budget?.campaign_budget_limit_usd || 0),
    },
    next_step: 'Review every paper in shamo_ingestion_review_queue. Do not run another batch or publish until quality and actual cost are checked.',
  },
}];
`.trim();

const controllerNodes = [
  stickyNote(
    "First six only",
    "## Budget-controlled Test 2 pilot\nThis controller selects at most six complete paper pairs. It runs them sequentially, pauses for 10 minutes after paper 5, and stops at a $3 batch / $15 campaign OpenAI ceiling.\n\nAfter importing both workflows, select **Shamo Budget v1 - Stage One Maths Paper** inside **Run One Paper Sub-workflow**.",
    [-900, -520],
    [600, 340],
  ),
  manualTrigger("Run Guarded Batch Manually", [-820, 0]),
  codeNode("Budget Configuration", controllerConfigCode, [-580, 0]),
  supabaseRequest(
    "Read Database Usage",
    "GET",
    "={{ $json.supabase_url + '/rest/v1/shamo_database_usage?select=*' }}",
    undefined,
    [-340, 0],
  ),
  codeNode("Check Database Free-Tier Safety", checkDatabaseUsageCode, [-100, 0]),
  {
    parameters: {
      documentId: {
        __rl: true,
        value: "14QHYH5T22qyGQJH-6SLW00q9yTuDhGwe1mEM7liaEbY",
        mode: "list",
        cachedResultName: "Past paper data - Alevel Maths (final)",
        cachedResultUrl:
          "https://docs.google.com/spreadsheets/d/14QHYH5T22qyGQJH-6SLW00q9yTuDhGwe1mEM7liaEbY/edit",
      },
      sheetName: {
        __rl: true,
        value: "Test 2",
        mode: "list",
        cachedResultName: "Test 2",
      },
      options: {},
    },
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.7,
    position: [140, 0],
    id: idFor("Get Test 2 Rows"),
    name: "Get Test 2 Rows",
    credentials: { googleSheetsOAuth2Api: credentials.googleSheetsOAuth2Api },
    // Retry the manifest read. Google returned a bare "Service unavailable" on
    // 9 August and killed batch 4 thirty seconds in, before a single paper had
    // been selected.
    //
    // Retrying here is safe for the reason retrying a paid node is NOT: this is
    // a read. It costs nothing, returns the same 48 rows every time, and has no
    // side effect. The rule to hold to is that retries belong on free,
    // idempotent nodes only -- never on `Run One Paper Sub-workflow`, where a
    // retry would re-do OCR and every OpenAI stage and bill for all of it.
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
  },
  codeNode("Pair and Select Test 2 Papers", pairTest2RowsCode, [380, 0]),
  supabaseRequest(
    "Create or Reuse Ingestion Batch",
    "POST",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_ingestion_batches?on_conflict=batch_key&select=*' }}",
    "={{ $json.batch_body }}",
    [620, 0],
    [{ name: "Prefer", value: "resolution=merge-duplicates,return=representation" }],
  ),
  codeNode("Expand Selected Batch", expandBatchCode, [860, 0]),
  {
    parameters: { batchSize: 1, options: {} },
    type: "n8n-nodes-base.splitInBatches",
    typeVersion: 3,
    position: [1100, 0],
    id: idFor("Loop Through Papers"),
    name: "Loop Through Papers",
  },
  {
    parameters: {
      source: "database",
      workflowId: {
        __rl: true,
        value: "",
        mode: "list",
      },
      mode: "once",
      options: { waitForSubWorkflow: true },
    },
    type: "n8n-nodes-base.executeWorkflow",
    typeVersion: 1.1,
    position: [1340, 120],
    id: idFor("Run One Paper Sub-workflow"),
    name: "Run One Paper Sub-workflow",
  },
  ifNode(
    "Pause After Paper Five",
    "={{ $json.batch_position === $json.config.pause_after_papers && $json.batch_size > $json.config.pause_after_papers }}",
    [1580, 120],
  ),
  {
    parameters: {
      resume: "timeInterval",
      amount: "={{ $json.config.pause_minutes }}",
      unit: "minutes",
    },
    type: "n8n-nodes-base.wait",
    typeVersion: 1.1,
    position: [1820, 20],
    id: idFor("Ten Minute OCR Pause"),
    name: "Ten Minute OCR Pause",
    webhookId: idFor("Ten Minute OCR Pause Webhook"),
  },
  codeNode("Prepare Batch Completion", prepareBatchCompletionCode, [1340, -200]),
  supabaseRequest(
    "Mark Batch Awaiting Review",
    "PATCH",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_ingestion_batches?id=eq.' + $json.batch_id }}",
    "={{ $json.update_body }}",
    [1580, -200],
    [{ name: "Prefer", value: "return=minimal" }],
    "text",
  ),
  supabaseRequest(
    "Read Final Batch Budget",
    "GET",
    "={{ $('Prepare Batch Completion').first().json.config.supabase_url + '/rest/v1/shamo_api_budget_overview?batch_id=eq.' + $('Prepare Batch Completion').first().json.batch_id + '&select=*' }}",
    undefined,
    [1820, -200],
  ),
  codeNode("Guarded Batch Result", finalBatchResultCode, [2060, -200]),
];

const controllerConnections = {};
connect(controllerConnections, "Run Guarded Batch Manually", "Budget Configuration");
connect(controllerConnections, "Budget Configuration", "Read Database Usage");
connect(controllerConnections, "Read Database Usage", "Check Database Free-Tier Safety");
connect(controllerConnections, "Check Database Free-Tier Safety", "Get Test 2 Rows");
connect(controllerConnections, "Get Test 2 Rows", "Pair and Select Test 2 Papers");
connect(controllerConnections, "Pair and Select Test 2 Papers", "Create or Reuse Ingestion Batch");
connect(controllerConnections, "Create or Reuse Ingestion Batch", "Expand Selected Batch");
connect(controllerConnections, "Expand Selected Batch", "Loop Through Papers");
connect(controllerConnections, "Loop Through Papers", "Prepare Batch Completion", 0);
connect(controllerConnections, "Loop Through Papers", "Run One Paper Sub-workflow", 1);
connect(controllerConnections, "Run One Paper Sub-workflow", "Pause After Paper Five");
connect(controllerConnections, "Pause After Paper Five", "Ten Minute OCR Pause", 0);
connect(controllerConnections, "Ten Minute OCR Pause", "Loop Through Papers");
connect(controllerConnections, "Pause After Paper Five", "Loop Through Papers", 1);
connect(controllerConnections, "Prepare Batch Completion", "Mark Batch Awaiting Review");
connect(controllerConnections, "Mark Batch Awaiting Review", "Read Final Batch Budget");
connect(controllerConnections, "Read Final Batch Budget", "Guarded Batch Result");

const controllerWorkflow = {
  name: "Shamo Budget v1 - Test 2 Six Paper Controller",
  nodes: controllerNodes,
  pinData: {},
  connections: controllerConnections,
  active: false,
  settings: {
    executionOrder: "v1",
    saveManualExecutions: true,
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
  },
  versionId: idFor("budget-controller-workflow-version"),
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

const publishConfigCode = String.raw`
const config = {
  supabase_url: 'https://YOUR_PROJECT_REF.supabase.co',
  ingestion_run_id: 'PASTE_REVIEWED_INGESTION_RUN_ID_HERE',
};
if (config.supabase_url.includes('YOUR_PROJECT_REF')) {
  throw new Error('Replace YOUR_PROJECT_REF before publishing.');
}
if (config.ingestion_run_id.includes('PASTE_')) {
  throw new Error('Paste one reviewed ingestion_run_id before publishing.');
}
return [{ json: config }];
`.trim();

const inspectPublishRunCode = String.raw`
const response = $input.first().json;
const run = Array.isArray(response) ? response[0] : response;
if (!run?.id) throw new Error('Ingestion run was not found.');
if (run.status !== 'awaiting_review' || run.review_status !== 'pending') {
  throw new Error('Run must be awaiting_review/pending, but is ' + run.status + '/' + run.review_status + '.');
}
if (run.validation_report?.passed !== true) {
  throw new Error('Deterministic validation did not pass.');
}
if (run.extraction_summary?.manual_review_required !== true) {
  throw new Error('This is not a guarded bulk-ingestion run.');
}
if (!run.extraction_summary?.paper_bundle) {
  throw new Error('The staged paper bundle is missing.');
}
return [{
  json: {
    config: $('Publish Configuration').first().json,
    run,
    paper_bundle: run.extraction_summary.paper_bundle,
  },
}];
`.trim();

const checkBlockingCode = String.raw`
const response = $input.first().json;
const issues = Array.isArray(response) ? response : [];
const state = $('Inspect Reviewed Run').first().json;
if (issues.length) {
  throw new Error('Resolve all blocking issues before publishing: ' + JSON.stringify(issues));
}
return [{ json: state }];
`.trim();

const prepareCleanupCode = String.raw`
const publication = $input.first().json;
const state = $('Check Open Blocking Issues').first().json;
return [{
  json: {
    publication,
    ingestion_run_id: state.run.id,
    config: state.config,
    cleanup_body: {
      extraction_summary: {
        ready_for_approval: true,
        manual_review_required: true,
        published: true,
        published_at: new Date().toISOString(),
        publication_result: publication,
        metadata_result: publication.metadata_result || null,
      },
    },
  },
}];
`.trim();

const finalPublishCode = String.raw`
const state = $('Prepare Staging Cleanup').first().json;
return [{
  json: {
    success: true,
    message: 'Reviewed paper and its mathematical metadata were published.',
    ingestion_run_id: state.ingestion_run_id,
    publication: state.publication,
    metadata: state.publication.metadata_result || null,
    next_step: 'Inspect shamo_published_question_overview and shamo_question_metadata_review before generating embeddings.',
  },
}];
`.trim();

const publishNodes = [
  stickyNote(
    "Manual publication only",
    "## Human approval remains mandatory\nOpen the official question paper and mark scheme, review the staged extraction and topic labels, and resolve every blocking issue. Run this once for one approved ingestion run.",
    [-760, -480],
    [520, 300],
  ),
  manualTrigger("Approve One Reviewed Paper", [-680, 0]),
  codeNode("Publish Configuration", publishConfigCode, [-440, 0]),
  supabaseRequest(
    "Load Reviewed Ingestion Run",
    "GET",
    "={{ $json.supabase_url + '/rest/v1/shamo_ingestion_runs?id=eq.' + $json.ingestion_run_id + '&select=*' }}",
    undefined,
    [-200, 0],
  ),
  codeNode("Inspect Reviewed Run", inspectPublishRunCode, [40, 0]),
  supabaseRequest(
    "Load Open Blocking Issues",
    "GET",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_ingestion_issues?ingestion_run_id=eq.' + $json.run.id + '&severity=eq.blocking&resolved=eq.false&select=id,issue_code,message' }}",
    undefined,
    [280, 0],
  ),
  codeNode("Check Open Blocking Issues", checkBlockingCode, [520, 0]),
  supabaseRequest(
    "Publish Reviewed Paper and Metadata Atomically",
    "POST",
    "={{ $json.config.supabase_url + '/rest/v1/rpc/shamo_publish_paper_bundle_with_metadata' }}",
    "={{ ({ requested_ingestion_run_id: $json.run.id, paper_bundle: $json.paper_bundle }) }}",
    [760, 0],
  ),
  codeNode("Prepare Staging Cleanup", prepareCleanupCode, [1000, 0]),
  supabaseRequest(
    "Clear Temporary Staged Bundle",
    "PATCH",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_ingestion_runs?id=eq.' + $json.ingestion_run_id }}",
    "={{ $json.cleanup_body }}",
    [1240, 0],
    [{ name: "Prefer", value: "return=minimal" }],
    "text",
  ),
  codeNode("Reviewed Publication Result", finalPublishCode, [1480, 0]),
];

const publishConnections = {};
connect(publishConnections, "Approve One Reviewed Paper", "Publish Configuration");
connect(publishConnections, "Publish Configuration", "Load Reviewed Ingestion Run");
connect(publishConnections, "Load Reviewed Ingestion Run", "Inspect Reviewed Run");
connect(publishConnections, "Inspect Reviewed Run", "Load Open Blocking Issues");
connect(publishConnections, "Load Open Blocking Issues", "Check Open Blocking Issues");
connect(
  publishConnections,
  "Check Open Blocking Issues",
  "Publish Reviewed Paper and Metadata Atomically",
);
connect(
  publishConnections,
  "Publish Reviewed Paper and Metadata Atomically",
  "Prepare Staging Cleanup",
);
connect(publishConnections, "Prepare Staging Cleanup", "Clear Temporary Staged Bundle");
connect(publishConnections, "Clear Temporary Staged Bundle", "Reviewed Publication Result");

const publishWorkflow = {
  name: "Shamo Budget v1 - Approve Reviewed Paper and Metadata",
  nodes: publishNodes,
  pinData: {},
  connections: publishConnections,
  active: false,
  settings: {
    executionOrder: "v1",
    saveManualExecutions: true,
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
  },
  versionId: idFor("budget-publish-workflow-version"),
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

await Promise.all([
  fs.writeFile(
    path.join(outputDir, "shamo_budget_stage_one_math_paper.json"),
    JSON.stringify(childWorkflow, null, 2) + "\n",
  ),
  fs.writeFile(
    path.join(outputDir, "shamo_budget_test2_six_paper_controller.json"),
    JSON.stringify(controllerWorkflow, null, 2) + "\n",
  ),
  fs.writeFile(
    path.join(outputDir, "shamo_budget_approve_reviewed_paper.json"),
    JSON.stringify(publishWorkflow, null, 2) + "\n",
  ),
]);

console.log("Generated guarded Shamo batch-ingestion workflows.");
