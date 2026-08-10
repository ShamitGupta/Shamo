import fs from "node:fs";
import { inlineModule } from "./lib/inline_module.mjs";
import { TOPICS_BY_DOMAIN } from "./lib/validation_rules.mjs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (name) =>
  JSON.parse(fs.readFileSync(path.join(here, name), "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));

const v1Child = readJson("shamo_budget_stage_one_math_paper.json");
const v1Controller = readJson("shamo_budget_test2_six_paper_controller.json");
const pilot = readJson("shamo_pilot_extract_and_stage.json");

const findNode = (workflow, name) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing source node: ${name}`);
  return node;
};

const fresh = (node, name, position) => ({
  ...clone(node),
  id: randomUUID(),
  name,
  position,
});

const codeTemplate = findNode(v1Child, "Prepare Budget Reservation");
const reserveTemplate = findNode(v1Child, "Reserve OpenAI Budget");
const finalizeTemplate = findNode(v1Child, "Finalize OpenAI Cost");
const openAiTemplate = findNode(v1Child, "OpenAI One-Pass Paper Extraction");
const ifTemplate = findNode(v1Child, "Already Staged or Published");

const codeNode = (name, jsCode, position) => {
  const node = fresh(codeTemplate, name, position);
  node.parameters = { mode: "runOnceForAllItems", jsCode };
  delete node.alwaysOutputData;
  delete node.credentials;
  return node;
};

const reserveNode = (name, position) => {
  const node = fresh(reserveTemplate, name, position);
  node.parameters.jsonBody = "={{ $json.reserve_body }}";
  return node;
};

const finalizeNode = (name, position) => {
  const node = fresh(finalizeTemplate, name, position);
  node.parameters.jsonBody = "={{ $json.finalize_cost_body }}";
  return node;
};

const openAiNode = (name, bodyField, idempotencyField, position) => {
  const node = fresh(openAiTemplate, name, position);
  node.parameters.jsonBody = `={{ $json.${bodyField} }}`;
  node.parameters.headerParameters = {
    parameters: [
      {
        name: "Idempotency-Key",
        value: `={{ $json.${idempotencyField} }}`,
      },
    ],
  };
  node.retryOnFail = true;
  node.maxTries = 5;
  node.waitBetweenTries = 15000;
  return node;
};

const ifNode = (name, expression, position) => {
  const node = fresh(ifTemplate, name, position);
  node.parameters.conditions.conditions = [
    {
      id: randomUUID(),
      leftValue: expression,
      rightValue: true,
      operator: {
        type: "boolean",
        operation: "true",
        singleValue: true,
      },
    },
  ];
  return node;
};

const extractJsonObjectAfter = (source, marker) => {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Schema marker not found: ${marker}`);
  const start = source.indexOf("{", markerIndex + marker.length);
  if (start < 0) throw new Error(`Schema object not found after: ${marker}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth++;
    if (character === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }
  throw new Error(`Unclosed schema object after: ${marker}`);
};

const qpSchema = extractJsonObjectAfter(
  findNode(pilot, "Build Question Paper Request").parameters.jsCode,
  "schema:"
);
const markSchemeSchema = extractJsonObjectAfter(
  findNode(pilot, "Build Mark Scheme Requests").parameters.jsCode,
  "schema:"
);
const repairSchema = extractJsonObjectAfter(
  findNode(pilot, "Build Targeted Repair Request").parameters.jsCode,
  "schema:"
);
// Widened after auditing real OCR. Cambridge prints `B2,1,0` (award 2, 1 or 0)
// and puts the dependency asterisk on BOTH sides -- `*M1` and `M1*`. The old
// pattern rejected both, so the model silently rewrote `B2,1,0` to `B2`, and a
// whole `M1*` row was dropped from 9709/62 Q7(c), leaving it 3 against a
// printed 4.
const validCambridgeMarkCodePattern =
  "^\\*?(?:DM|DB|M|A|B)[0-9]+\\*?(?:\\s*FT)?(?:\\s*,\\s*[0-9]+)*" +
  "(?:\\s+\\*?(?:DM|DB|M|A|B)[0-9]+\\*?(?:\\s*FT)?(?:\\s*,\\s*[0-9]+)*)*$";
markSchemeSchema.properties.mark_scheme_items.items.properties
  .mark_code.anyOf[0].pattern = validCambridgeMarkCodePattern;
repairSchema.properties.corrected_questions.items.properties
  .mark_scheme_items.items.properties.mark_code.anyOf[0].pattern =
    validCambridgeMarkCodePattern;

// Controlled vocabulary for main_topic. Enforced in the JSON schema so the
// model cannot emit an off-vocabulary value, and again in the validator so the
// repair path -- which does not carry the metadata schema -- cannot reintroduce
// one. Batch 1 classified every component 5/6 question as `Statistics`; batch 2
// produced `Probability`, `Statistics` and even `Algebra` for the same
// components, because the field was unconstrained free text.
//
// Imported rather than duplicated. The previous copy carried a "keep this in
// sync" comment, which is a drift hazard written down as a instruction: the
// schema the model is given and the vocabulary the validator enforces must be
// the same list or a paper can pass one and fail the other.
const MAIN_TOPIC_VOCABULARY = [
  ...TOPICS_BY_DOMAIN["Pure Mathematics"],
  ...TOPICS_BY_DOMAIN.Mechanics,
  ...TOPICS_BY_DOMAIN["Probability and Statistics"],
];

const pageMapSchema = {
  type: "object",
  properties: {
    source_question_count: {
      anyOf: [{ type: "integer" }, { type: "null" }],
    },
    source_total_marks: {
      anyOf: [{ type: "integer" }, { type: "null" }],
    },
    question_pages: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          question_number: { type: "integer", minimum: 1 },
          page_numbers: {
            type: "array",
            minItems: 1,
            items: { type: "integer", minimum: 1 },
          },
        },
        required: ["question_number", "page_numbers"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "source_question_count",
    "source_total_marks",
    "question_pages",
  ],
  additionalProperties: false,
};

const metadataSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          question_number: { type: "integer", minimum: 1 },
          main_topic: { type: "string", enum: MAIN_TOPIC_VOCABULARY },
          subtopics: { type: "array", items: { type: "string" } },
          skills: { type: "array", minItems: 1, items: { type: "string" } },
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
          difficulty_level: {
            anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }],
          },
          calculator_required: {
            anyOf: [{ type: "boolean" }, { type: "null" }],
          },
          diagram_required: { type: "boolean" },
          classification_confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
          },
        },
        required: [
          "question_number",
          "main_topic",
          "subtopics",
          "skills",
          "methods",
          "question_style",
          "difficulty_level",
          "calculator_required",
          "diagram_required",
          "classification_confidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const validateInputCode = String.raw`
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
const permittedModels = new Set(['gpt-5.4-mini', 'gpt-5.4-nano']);
for (const field of ['question_model', 'page_map_model', 'mark_scheme_model', 'metadata_model', 'repair_model']) {
  if (!permittedModels.has(config[field])) {
    throw new Error('Unsupported guarded model in config.' + field + ': ' + config[field]);
  }
}
const reservations = config.stage_reservations_usd || {};
for (const [stage, amount] of Object.entries(reservations)) {
  if (!(Number(amount) > 0) || Number(amount) > 0.25) {
    throw new Error('Each stage reservation must be greater than $0 and no more than $0.25: ' + stage);
  }
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
const paperType = String(pair.paper_variant || '').charAt(0);
const expectedTotalMarks = ['1', '3'].includes(paperType) ? 75 : 50;
const sourceKey = [
  pair.qualification,
  pair.syllabus_code,
  pair.year,
  pair.exam_session,
  pair.paper_variant,
].join(':');
const idempotencyKey = ['budget-v2.1', batch.batch_key, sourceKey].join(':');
return [{
  json: {
    config,
    batch,
    pair,
    batch_position: input.batch_position,
    batch_size: input.batch_size,
    source_key: sourceKey,
    idempotency_key: idempotencyKey,
    expected_total_marks: expectedTotalMarks,
  },
}];`;

const prepareReservationCode = (stateNode, stage, modelField, reservationField) =>
  String.raw`
const state = $('${stateNode}').first().json;
const openaiIdempotencyKey = state.idempotency_key + ':${stage}';
return [{
  json: {
    ...state,
    openai_idempotency_key: openaiIdempotencyKey,
    reserve_body: {
      requested_batch_id: state.batch.id,
      requested_ingestion_run_id: state.ingestion_run_id,
      requested_idempotency_key: openaiIdempotencyKey,
      requested_provider: 'openai',
      requested_model: state.config.${modelField},
      requested_operation: '${stage}',
      requested_reserved_usd: state.config.stage_reservations_usd.${reservationField},
    },
  },
}];`;

// The recorded cost has been running 4-7x under the provider dashboard with no
// other activity on the account, which means the batch and campaign caps are
// being enforced against a number that is wrong. The arithmetic below is not
// the problem -- every stored event recomputes to the cent from its own stored
// tokens. The tokens are the problem.
//
// Prime suspect: these requests attach the whole PDF via `input_file`, and the
// reported `input_tokens` are far too small to include it -- 12,136 for a
// 20-page paper, of which 11,648 were cached (the fixed prompt and schema). So
// the file is billed but is not visible in the usage we read.
//
// Rather than guess, capture EVERYTHING the provider returns. `usage_raw` keeps
// the untouched usage object so the next batch can be reconciled field by field
// against the dashboard, and `unaccounted_tokens` names the gap directly when
// total_tokens exceeds the parts we price.
//
// UPDATE, 9 August 2026. `unaccounted_tokens` came back 0 on all 23 batch-3
// events, so total_tokens really does equal input + output: the file is not
// hiding inside the usage object, it is absent from it. Three further facts,
// all checked rather than assumed:
//
//   * the attached URL is live and returns a 3.36 MB, 20-page PDF, so the file
//     IS fetched -- the "silent fetch failure" hypothesis is dead;
//   * the same request ALSO carries the complete OCR text, so ~9.9k reported
//     input tokens per paper is the prompt plus OCR and nothing else. Twenty
//     page images would be 15-30k tokens on their own;
//   * the two stages that attach a PDF account for 93% of recorded spend
//     ($0.288 of $0.309), while the three that do not total $0.021.
//
// RESULT, measured 9 August 2026 on 9709/62 M/J, cost $0.065450.
//
//   The file is only PARTIALLY reported. Attaching it added 3,808 input tokens
//   to the reported usage (7,535 with, 3,727 without) -- but the provider
//   dashboard for that day shows 260,375 tokens against the 70,297 we recorded.
//   The 190,078 unrecorded tokens bill at about $0.55 per million, which is
//   input-rate, not output-rate. Run A attached 35 PDF pages (12 for question
//   extraction, 12 + 11 for repair) and run B attached none, so the unrecorded
//   volume works out at roughly 5,400 tokens per PDF page. That is page-image
//   processing, billed in full and reported only in part.
//
//   Retries do NOT fit. A duplicated call bills at roughly $1.97 per million
//   because it repeats the expensive output tokens; the unrecorded spend bills
//   at $0.55 per million. Retries would push the effective rate up, not down.
//
//   So the real cost of a PDF-attaching run is several times its ledger entry,
//   not the 26% the reported tokens suggest. Correct the caps for this before
//   scaling, not the price table.
//
//   The file is NOT redundant. Without it the model DROPPED a printed
//   context sentence on Q6(b) -- "Later the inspector carries out a similar
//   test at the 2.5% significance level, using the same hypotheses and another
//   120 randomly chosen cereal boxes." Confirmed against the PDF text layer.
//   Losing it leaves part (b) unanswerable: no significance level, no sample
//   size. Everything else differed only in LaTeX cosmetics (Po vs \mathrm{Po}).
//
// So `attach_source_pdf` MUST stay true. It is kept as a flag only so the
// experiment is repeatable, not because turning it off is an option. Removing
// the PDF would save about 26% of the question-extraction stage and silently
// corrupt questions, which is the worst trade available.
//
// The dashboard gap therefore remains unexplained and is NOT the PDF. The live
// candidate is n8n provider retries: up to 5 attempts, every one billed, only
// the last recorded. Test that by comparing the dashboard against this dated
// window -- 2026-08-09 01:23:08Z to 01:34:51Z, recorded total $0.065450.
//
// The flag guards ONLY question-paper extraction. Targeted repair keeps both
// PDFs unconditionally: its entire job is to recover what the OCR and the model
// got wrong, so taking away the visual source would defeat it.
const usageCalculation = String.raw`
const usage = response.usage || {};
const inputTokens = Number(usage.input_tokens || 0);
const cachedInputTokens = Number(usage.input_tokens_details?.cached_tokens || 0);
const outputTokens = Number(usage.output_tokens || 0);
const reportedTotalTokens = Number(usage.total_tokens || 0);
// Any token the provider counts but we do not price is unbilled in our ledger.
const unaccountedTokens = reportedTotalTokens > 0
  ? Math.max(0, reportedTotalTokens - inputTokens - outputTokens)
  : 0;
const prices = state.config.openai_prices_per_million[model];
if (!prices) throw new Error('No price configuration exists for ' + model + '.');
const actualCostUsd =
  Math.max(0, inputTokens - cachedInputTokens) * Number(prices.input) / 1000000 +
  cachedInputTokens * Number(prices.cached_input) / 1000000 +
  outputTokens * Number(prices.output) / 1000000;
const usageAudit = {
  usage_raw: usage,
  reported_total_tokens: reportedTotalTokens,
  unaccounted_tokens: unaccountedTokens,
  priced_input_tokens: inputTokens,
  priced_output_tokens: outputTokens,
  response_id: response.id || null,
  model_reported: response.model || null,
};`;

const buildQuestionPaperRequestCode = String.raw`
const reservationResponse = $input.first().json;
const reservation = Array.isArray(reservationResponse) ? reservationResponse[0] : reservationResponse;
const state = $('Prepare Question Paper Reservation').first().json;
if (!reservation?.cost_event_id) throw new Error('Question-paper budget reservation was not returned.');
const questionPaper = state.compact_documents.find((document) => document.document_type === 'question_paper');
if (!questionPaper) throw new Error('Question-paper OCR document is missing.');
const prompt = [
  'Extract only the question paper from this official Cambridge Mathematics paper.',
  'The paper identity is supplied in the request. Its expected total is ' + state.expected_total_marks + ' marks.',
  'Use the PDF as the visual source of truth and OCR JSON as a page-indexed aid.',
  'Return every main question in numerical order and make question totals add exactly to the expected paper total.',
  'Transcribe every mathematical sign, exponent, radical, limit, coordinate and inequality exactly.',
  'A main question number is an integer. Never put labels such as (a) in question_number.',
  'Create a part only when a label such as (a), (b), (i) or (ii) is visibly printed.',
  'For nested parts use paths such as ["a","i"]. Never include the main question number in label_path.',
  'For an unparted question use parts=[] and put the complete question in stem_markdown.',
  'Do not duplicate an instruction between stem_markdown and a part prompt.',
  'When a parent part has child parts, keep its shared prompt but set its marks to null unless a separate mark value is visibly printed for the parent.',
  'Use 1-based PDF page numbers. Ignore answer lines, barcodes, footers and margin instructions.',
  'Include only diagrams, graphs and tables needed to understand or solve a question.',
  'Every asset must match an OCR image using its exact page number and zero-based source_image_index.',
  'Do not extract mark-scheme content or topic metadata in this call.',
].join('\n');
return [{
  json: {
    ...state,
    cost_event_id: reservation.cost_event_id,
    question_paper_request: {
      model: state.config.question_model,
      reasoning: { effort: 'medium' },
      store: false,
      max_output_tokens: 22000,
      input: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                paper: {
                  qualification: state.pair.qualification,
                  syllabus_code: state.pair.syllabus_code,
                  subject: state.pair.subject,
                  year: state.pair.year,
                  exam_session: state.pair.exam_session,
                  paper_variant: state.pair.paper_variant,
                  expected_total_marks: state.expected_total_marks,
                },
                question_paper_ocr: questionPaper,
              }),
            },
            ...(state.config.attach_source_pdf === false
              ? []
              : [{ type: 'input_file', file_url: questionPaper.source_url }]),
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'shamo_v2_question_paper',
          strict: true,
          schema: ${JSON.stringify(qpSchema)},
        },
      },
    },
  },
}];`;

const parseQuestionPaperCode = String.raw`
const response = $input.first().json;
const state = $('Build Question Paper Request').first().json;
if (response.status === 'incomplete') {
  throw new Error('Question-paper extraction was incomplete: ' + JSON.stringify(response.incomplete_details || {}));
}
const message = (response.output || []).find((entry) => entry.type === 'message');
if (!message) throw new Error('Question-paper extraction returned no message output.');
const refusal = (message.content || []).find((entry) => entry.type === 'refusal');
if (refusal) throw new Error('Question-paper extraction refused: ' + (refusal.refusal || 'unknown refusal'));
const outputText = (message.content || []).find((entry) => entry.type === 'output_text');
if (!outputText?.text) throw new Error('Question-paper extraction returned no structured text.');
const extracted = JSON.parse(outputText.text);
if (!Array.isArray(extracted.questions) || !extracted.questions.length) {
  throw new Error('Question-paper extraction has no questions.');
}
const model = state.config.question_model;
${usageCalculation}
return [{
  json: {
    ...state,
    question_paper_questions: extracted.questions,
    extraction_response_ids: [response.id || null],
    api_events: [{
      operation: 'question_paper_extraction',
      model,
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      actual_cost_usd: Number(actualCostUsd.toFixed(8)),
      usage_audit: usageAudit,
    }],
    finalize_cost_body: {
      requested_cost_event_id: state.cost_event_id,
      requested_input_tokens: inputTokens,
      requested_cached_input_tokens: cachedInputTokens,
      requested_output_tokens: outputTokens,
      requested_actual_usd: Number(actualCostUsd.toFixed(8)),
      requested_provider_request_id: response.id || null,
    },
  },
}];`;

const restoreCode = (nodeName) =>
  `return [{ json: $('${nodeName}').first().json }];`;

const buildPageMapRequestCode = String.raw`
const reservationResponse = $input.first().json;
const reservation = Array.isArray(reservationResponse) ? reservationResponse[0] : reservationResponse;
const state = $('Prepare Page Map Reservation').first().json;
if (!reservation?.cost_event_id) throw new Error('Page-map budget reservation was not returned.');
const markScheme = state.compact_documents.find((document) => document.document_type === 'mark_scheme');
if (!markScheme) throw new Error('Mark-scheme OCR document is missing.');
const prompt = [
  'Map the official Cambridge mark scheme by main question number.',
  'This is routing only: do not transcribe answers and do not solve anything.',
  'For every visible main question, return every 1-based PDF page on which its mark-scheme table continues.',
  'A page can belong to two questions when one ends and the next begins on that page.',
  'Do not confuse part labels, mark values, page numbers or totals with main question numbers.',
  'Use the printed paper total when visible. Otherwise return source_total_marks=null.',
].join('\n');
return [{
  json: {
    ...state,
    cost_event_id: reservation.cost_event_id,
    page_map_request: {
      model: state.config.page_map_model,
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 3000,
      input: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [{
            type: 'input_text',
            text: JSON.stringify({
              paper_variant: state.pair.paper_variant,
              expected_question_numbers: state.question_paper_questions.map((question) => question.question_number),
              mark_scheme_ocr: markScheme,
            }),
          }],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'shamo_v2_mark_scheme_page_map',
          strict: true,
          schema: ${JSON.stringify(pageMapSchema)},
        },
      },
    },
  },
}];`;

const parsePageMapCode = String.raw`
const response = $input.first().json;
const state = $('Build Page Map Request').first().json;
if (response.status === 'incomplete') throw new Error('Page-map extraction was incomplete.');
const message = (response.output || []).find((entry) => entry.type === 'message');
const outputText = (message?.content || []).find((entry) => entry.type === 'output_text');
if (!outputText?.text) throw new Error('Page-map extraction returned no structured text.');
const extracted = JSON.parse(outputText.text);
const pageMap = {};
for (const entry of extracted.question_pages || []) {
  const number = Number(entry.question_number);
  const pages = [...new Set((entry.page_numbers || []).map(Number))].sort((a, b) => a - b);
  if (pageMap[number]) throw new Error('Page map contains duplicate question ' + number + '.');
  pageMap[number] = pages;
}
const model = state.config.page_map_model;
${usageCalculation}
return [{
  json: {
    ...state,
    mark_scheme_page_map: pageMap,
    paper_summary: {
      question_count_from_source: Number.isInteger(extracted.source_question_count)
        ? extracted.source_question_count
        : null,
      total_marks_from_source: state.expected_total_marks,
      mark_scheme_total_marks_reported: Number.isInteger(extracted.source_total_marks)
        ? extracted.source_total_marks
        : null,
    },
    extraction_response_ids: [...(state.extraction_response_ids || []), response.id || null],
    api_events: [...(state.api_events || []), {
      operation: 'mark_scheme_page_map',
      model,
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      actual_cost_usd: Number(actualCostUsd.toFixed(8)),
      usage_audit: usageAudit,
    }],
    finalize_cost_body: {
      requested_cost_event_id: state.cost_event_id,
      requested_input_tokens: inputTokens,
      requested_cached_input_tokens: cachedInputTokens,
      requested_output_tokens: outputTokens,
      requested_actual_usd: Number(actualCostUsd.toFixed(8)),
      requested_provider_request_id: response.id || null,
    },
  },
}];`;

const buildMarkSchemeRequestsCode = String.raw`
const reservationResponse = $input.first().json;
const reservation = Array.isArray(reservationResponse) ? reservationResponse[0] : reservationResponse;
const state = $('Prepare Mark Scheme Reservation').first().json;
if (!reservation?.cost_event_id) throw new Error('Mark-scheme budget reservation was not returned.');
const fallbackOnly = new Set((state.mark_scheme_fallback_question_numbers || []).map(Number));
const markScheme = state.compact_documents.find((document) => document.document_type === 'mark_scheme');
if (!markScheme) throw new Error('Mark-scheme OCR document is missing.');
const pageByNumber = new Map(markScheme.pages.map((page) => [Number(page.page_number), page]));
const prompt = [
  'Extract exactly one main question from an official Cambridge Mathematics mark scheme.',
  'Use only the supplied pages and the supplied question-paper structure.',
  'The table columns are Question, Answer, Marks and Guidance.',
  'Return one item for every visible source row that contains Answer, Marks or Guidance information.',
  'Do not merge rows with different Marks cells or different Guidance cells.',
  'content_markdown contains the complete Answer cell. guidance_markdown contains the complete Guidance cell.',
  'Only the Marks column determines mark_code. Preserve dependency asterisks exactly.',
  'A non-null mark_code must be plain text, never Markdown-bold, and must contain a printed Cambridge code such as M1, A1, B1, A1FT, B1FT, DM1 or *M1. Never put a subtotal such as 2, 3 or 4 in mark_code.',
  'Preserve algebraic and combinatorial variable names exactly. When Guidance defines a, b, h or another placeholder, verify that every subscript and stated range uses the matching variable.',
  'Do not emit the standalone question-part total printed at the bottom of the Marks column as a mark_scheme_item.',
  'If the printed Answer cell is blank but Marks and Guidance are populated, preserve content_markdown="", keep the printed mark_code, and preserve Guidance exactly. This is a valid source row.',
  'Never invent Answer text, never copy Guidance into content_markdown, and never repeat the Marks code at the start of guidance_markdown.',
  'If both Answer and Marks are blank but Guidance is present, use content_markdown="", mark_code=null and preserve all guidance.',
  'When the source shows Method 1, Method 2 and later alternatives for the same part, Method 1 rows use is_alternative_method=false and later method rows use true. Never mark every method as alternative.',
  'A leading dependency star such as *M1 does not by itself make a row an alternative method. An SC mark is a special-case award and must not be counted as an additional primary mark.',
  'Never include the main question number in part_path. Use only part paths present in question_structure.',
  'When question_structure.parts is empty, every part_path must be [].',
  'Preserve alternatives, examiner abbreviations, conditions, signs, factors, brackets and exponents.',
  'Use 1-based PDF page numbers and sequence rows in visible source order.',
].join('\n');
const outputs = [];
for (const question of state.question_paper_questions) {
  const questionNumber = Number(question.question_number);
  // Only the questions the deterministic parser could not resolve.
  if (fallbackOnly.size && !fallbackOnly.has(questionNumber)) continue;
  const mapped = state.mark_scheme_page_map[String(questionNumber)] || state.mark_scheme_page_map[questionNumber] || [];
  const requestedPages = mapped.length ? mapped : markScheme.pages.map((page) => Number(page.page_number));
  const pages = requestedPages.map((pageNumber) => pageByNumber.get(Number(pageNumber))).filter(Boolean);
  if (!pages.length) throw new Error('No mark-scheme OCR pages are available for question ' + questionNumber + '.');
  outputs.push({
    json: {
      ...state,
      cost_event_id: reservation.cost_event_id,
      question_number: questionNumber,
      expected_pages: requestedPages,
      used_full_mark_scheme_fallback: mapped.length === 0,
      mark_scheme_idempotency_key: state.idempotency_key + ':mark-scheme:q' + questionNumber,
      mark_scheme_request: {
        model: state.config.mark_scheme_model,
        reasoning: { effort: 'low' },
        store: false,
        max_output_tokens: 6500,
        input: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: [{
              type: 'input_text',
              text: JSON.stringify({
                paper: {
                  syllabus_code: state.pair.syllabus_code,
                  year: state.pair.year,
                  exam_session: state.pair.exam_session,
                  paper_variant: state.pair.paper_variant,
                },
                question_number: questionNumber,
                question_structure: {
                  stem_markdown: question.stem_markdown,
                  total_marks: question.total_marks,
                  parts: question.parts,
                },
                mark_scheme_ocr_pages: pages,
              }),
            }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'shamo_v2_mark_scheme_question',
            strict: true,
            schema: ${JSON.stringify(markSchemeSchema)},
          },
        },
      },
    },
    pairedItem: { item: 0 },
  });
}
return outputs;`;

const parseMarkSchemeResponsesCode = String.raw`
const responses = $input.all();
const sources = $('Build Mark Scheme Requests').all();
const state = $('Prepare Mark Scheme Reservation').first().json;
if (responses.length !== sources.length) {
  throw new Error('Mark-scheme response count does not match request count.');
}
const results = [];
const responseIds = [];
let inputTokens = 0;
let cachedInputTokens = 0;
let outputTokens = 0;
let reportedTotalTokens = 0;
const usageSamples = [];
for (let index = 0; index < responses.length; index++) {
  const response = responses[index].json;
  const source = sources[index].json;
  if (response.status === 'incomplete') {
    throw new Error('Mark-scheme extraction was incomplete for question ' + source.question_number + '.');
  }
  const message = (response.output || []).find((entry) => entry.type === 'message');
  const outputText = (message?.content || []).find((entry) => entry.type === 'output_text');
  if (!outputText?.text) {
    throw new Error('Mark-scheme extraction returned no structured text for question ' + source.question_number + '.');
  }
  const extracted = JSON.parse(outputText.text);
  if (Number(extracted.question_number) !== Number(source.question_number)) {
    throw new Error('Mark-scheme response returned the wrong question number.');
  }
  let removedSubtotalCount = 0;
  let unwrappedMarkCodeCount = 0;
  const items = (extracted.mark_scheme_items || [])
    .map((item) => {
      const rawMarkCode = item.mark_code === null
        ? null
        : String(item.mark_code).trim();
      let markCode = rawMarkCode;
      let isAlternativeMethod = Boolean(item.is_alternative_method);
      if (markCode?.startsWith('**')) markCode = markCode.slice(2);
      if (markCode?.endsWith('**')) markCode = markCode.slice(0, -2);
      markCode = markCode?.trim() ?? null;
      const parenthesized = markCode?.match(/^\((.*)\)$/);
      if (parenthesized) {
        markCode = parenthesized[1].trim();
        isAlternativeMethod = true;
      }
      if (/^\d+$/.test(markCode || '')) {
        removedSubtotalCount++;
        return null;
      }
      if (/^SC\s+/i.test(markCode || '')) {
        markCode = markCode.replace(/^SC\s+/i, '');
        isAlternativeMethod = true;
      }
      if (markCode !== null) {
        markCode = markCode
          .replace(/([0-9])([A-Za-z])/g, '$1 $2')
          .replace(/\s+/g, ' ')
          .trim()
          .toUpperCase();
      }
      if (markCode !== rawMarkCode) unwrappedMarkCodeCount++;
      return {
        ...item,
        mark_code: markCode,
        is_alternative_method: isAlternativeMethod,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(left.sequence_number) - Number(right.sequence_number))
    .map((item, itemIndex) => ({ ...item, sequence_number: itemIndex + 1 }));
  if (!items.length) throw new Error('Question ' + source.question_number + ' has no mark-scheme items.');
  results.push({
    question_number: Number(source.question_number),
    expected_pages: source.expected_pages,
    used_full_mark_scheme_fallback: source.used_full_mark_scheme_fallback,
    removed_subtotal_count: removedSubtotalCount,
    unwrapped_mark_code_count: unwrappedMarkCodeCount,
    mark_scheme_items: items,
  });
  const usage = response.usage || {};
  inputTokens += Number(usage.input_tokens || 0);
  cachedInputTokens += Number(usage.input_tokens_details?.cached_tokens || 0);
  outputTokens += Number(usage.output_tokens || 0);
  reportedTotalTokens += Number(usage.total_tokens || 0);
  usageSamples.push(usage);
  responseIds.push(response.id || null);
}
const model = state.config.mark_scheme_model;
const prices = state.config.openai_prices_per_million[model];
const actualCostUsd =
  Math.max(0, inputTokens - cachedInputTokens) * Number(prices.input) / 1000000 +
  cachedInputTokens * Number(prices.cached_input) / 1000000 +
  outputTokens * Number(prices.output) / 1000000;
// This stage makes one request per question and accumulates, so it cannot use
// the shared usageCalculation block -- it needs its own audit over the whole
// set. Omitting it is what broke 9709/52 on batch 3: the audit field was added
// to every stage's event but defined in only four of the five, and this is the
// one path that fires rarely enough to survive both the syntax check and the
// offline replay.
const usageAudit = {
  usage_raw: usageSamples,
  reported_total_tokens: reportedTotalTokens,
  unaccounted_tokens: reportedTotalTokens > 0
    ? Math.max(0, reportedTotalTokens - inputTokens - outputTokens)
    : 0,
  priced_input_tokens: inputTokens,
  priced_output_tokens: outputTokens,
  response_id: responseIds.filter(Boolean),
  model_reported: model,
};
results.sort((left, right) => left.question_number - right.question_number);
const costEventId = sources[0]?.json?.cost_event_id;
// Merge, do not replace. The deterministic parser already produced results for
// every question it could resolve; this stage only ran for the ones it could
// not. Stamping source='model' keeps the degraded path visible downstream --
// the validator relaxes the alternative-block rules for model rows, because a
// model result has no parsed block structure to check against.
const mergedResults = new Map(
  (state.mark_scheme_results || []).map((result) => [Number(result.question_number), result])
);
for (const result of results) {
  // Carry the parser's printed_part_totals across. The parser DID read the
  // printed subtotal for this question -- it only fell back because it could
  // not classify an alternative block. Dropping the subtotal here would leave
  // the question with nothing to reconcile against, which is how 9709/31 Q7
  // staged at double its printed marks and still reported passed = true.
  const parsed = mergedResults.get(Number(result.question_number));
  mergedResults.set(Number(result.question_number), {
    ...result,
    source: 'model',
    printed_part_totals: parsed?.printed_part_totals || result.printed_part_totals || {},
  });
}
const combinedResults = [...mergedResults.values()]
  .sort((left, right) => Number(left.question_number) - Number(right.question_number));
return [{
  json: {
    ...state,
    mark_scheme_results: combinedResults,
    extraction_response_ids: [...(state.extraction_response_ids || []), ...responseIds],
    api_events: [...(state.api_events || []), {
      operation: 'mark_scheme_question_extraction',
      model,
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      actual_cost_usd: Number(actualCostUsd.toFixed(8)),
      usage_audit: usageAudit,
    }],
    finalize_cost_body: {
      requested_cost_event_id: costEventId,
      requested_input_tokens: inputTokens,
      requested_cached_input_tokens: cachedInputTokens,
      requested_output_tokens: outputTokens,
      requested_actual_usd: Number(actualCostUsd.toFixed(8)),
      requested_provider_request_id: responseIds.filter(Boolean).join(',').slice(0, 500) || null,
    },
  },
}];`;


const parseMarkSchemeTablesCode = [
  inlineModule("mark_scheme_parser.mjs"),
  String.raw`
// --- n8n wiring -------------------------------------------------------------
// Replaces the per-question OpenAI mark-scheme call as the primary path. The
// model stage below remains wired behind an IF and fires only for questions
// this parser cannot resolve confidently.
const state = $('Restore Page Map State').first().json;
const markScheme = state.compact_documents.find((document) => document.document_type === 'mark_scheme');
if (!markScheme) throw new Error('Mark-scheme OCR document is missing.');

const questionNumbers = state.question_paper_questions.map((question) => Number(question.question_number));
const results = buildMarkSchemeResults(markScheme.pages, questionNumbers);
const partMarksByQuestion = new Map(
  state.question_paper_questions.map((question) => [
    Number(question.question_number),
    new Map((question.parts || []).map((part) => [(part.label_path || []).join('.'), part.marks])),
  ])
);

// A question falls back to the model when the parser cannot vouch for its own
// output: no rows at all, unparsed rows, or a part whose primary sum matches
// neither the printed subtotal nor the question paper. Deferring is the point
// -- guessing at an ambiguous mark scheme is how silent wrong data is created.
const fallbackQuestionNumbers = [];
for (const result of results) {
  const rows = result.mark_scheme_items || [];
  let needsFallback = rows.length === 0 || Number(result.unparsed_row_count || 0) > 0;
  if (!needsFallback) {
    const primaryByPart = new Map();
    for (const item of rows) {
      if (item.is_alternative_method) continue;
      const partKey = (item.part_path || []).join('.');
      const value = [...String(item.mark_code || '').matchAll(/\*?(?:DM|DB|M|A|B)(\d+)/gi)]
        .reduce((total, match) => total + Number(match[1] || 1), 0);
      primaryByPart.set(partKey, (primaryByPart.get(partKey) || 0) + value);
    }
    const qpParts = partMarksByQuestion.get(Number(result.question_number)) || new Map();
    for (const [partKey, printed] of Object.entries(result.printed_part_totals || {})) {
      const actual = primaryByPart.get(partKey) || 0;
      const qpMarks = qpParts.get(partKey);
      if (actual !== printed && actual !== qpMarks) needsFallback = true;
    }
  }
  if (needsFallback) fallbackQuestionNumbers.push(Number(result.question_number));
}

return [{
  json: {
    ...state,
    mark_scheme_results: results,
    mark_scheme_fallback_needed: fallbackQuestionNumbers.length > 0,
    mark_scheme_fallback_question_numbers: fallbackQuestionNumbers,
  },
}];`,
].join("\n\n");

const mergePaperBundleCode = String.raw`
const state = $input.first().json;
const markSchemeByQuestion = new Map(
  state.mark_scheme_results.map((result) => [Number(result.question_number), result.mark_scheme_items])
);
const questions = [...state.question_paper_questions]
  .sort((left, right) => Number(left.question_number) - Number(right.question_number))
  .map((question) => {
    const markSchemeItems = markSchemeByQuestion.get(Number(question.question_number));
    if (!markSchemeItems) {
      throw new Error('No mark-scheme result exists for question ' + question.question_number + '.');
    }
    return { ...question, mark_scheme_items: markSchemeItems };
  });
return [{
  json: {
    ...state,
    paper_bundle: { documents: state.known_documents, questions },
  },
}];`;

const buildMetadataRequestCode = String.raw`
const reservationResponse = $input.first().json;
const reservation = Array.isArray(reservationResponse) ? reservationResponse[0] : reservationResponse;
const state = $('Prepare Metadata Reservation').first().json;
if (!reservation?.cost_event_id) throw new Error('Metadata budget reservation was not returned.');
// Show the model only the topics valid for THIS paper's family. The schema enum
// still permits the whole vocabulary, but a Mechanics paper should never be
// offered a Normal Distribution topic as a candidate in the first place.
// Narrowing the prompt is what makes MAIN_TOPIC_OUTSIDE_PAPER_DOMAIN satisfiable
// rather than a rule the model is set up to fail.
// (No backticks in comments here -- this block sits inside a template literal.)
const TOPICS_BY_DOMAIN = ${JSON.stringify(TOPICS_BY_DOMAIN)};
const DOMAIN_BY_COMPONENT = ${JSON.stringify({
  1: "Pure Mathematics",
  2: "Pure Mathematics",
  3: "Pure Mathematics",
  4: "Mechanics",
  5: "Probability and Statistics",
  6: "Probability and Statistics",
})};
const paperDomain = DOMAIN_BY_COMPONENT[Number(String(state.pair.paper_variant || '').charAt(0))] || null;
const allowedTopics = paperDomain
  ? TOPICS_BY_DOMAIN[paperDomain]
  : Object.keys(TOPICS_BY_DOMAIN).reduce((all, key) => all.concat(TOPICS_BY_DOMAIN[key]), []);
const prompt = [
  'Classify each Cambridge Mathematics question for student search and recommendation.',
  'Use concise, consistent syllabus terminology.',
  paperDomain ? 'This is a ' + paperDomain + ' paper (component ' + String(state.pair.paper_variant).charAt(0) + ').' : '',
  'main_topic must be exactly one of: ' + allowedTopics.join(', ') + '.',
  'main_topic is the content topic of the principal method the question requires. It is never the paper family: do not answer "Mechanics" or "Statistics", which describe the paper, not the mathematics.',
  // Every rule below is a confusion MEASURED on the first 138 published rows,
  // not a guess about what a model might get wrong. Sixteen were wrong, and
  // all but three fell into these four classes. Narrowing the candidate list
  // by paper family did not help, because every one of these is a mistake
  // BETWEEN two topics that are both valid for that family.
  'Disambiguation rules, which override any general impression:',
  '- A question about an arithmetic or geometric progression is Series, not Algebra, however much algebraic manipulation it needs.',
  '- In a component 1 paper, expanding a bracket to a positive integer power and reading off a coefficient is Series. In a component 3 paper, expanding to a rational or negative power belongs with partial fractions under Algebra. The correct answer differs by component.',
  '- Describing or applying transformations of a graph is Functions, decided by the assessed skill and not by the curve being transformed. A stretch and a translation applied to y = sin x is Functions, not Trigonometry.',
  '- Differential Equations requires a differential equation to be printed in the question. Showing that a derivative equals an expression is Calculus. Connected rates of change is Calculus.',
  '- When a question declares a distribution such as X ~ Po(3.1), B(10, 0.7) or N(2.5, 0.05), that distribution is the topic. Do not answer Probability merely because the question asks for a probability.',
  '- A probability density function, its cumulative distribution function, or an expectation found by integration is Continuous Random Variables, not Probability.',
  '- In a component 3 paper, the modulus function and inequalities involving it are Algebra. Functions covers domain, range, inverse and composite.',
  'When a question genuinely spans two topics, choose the one carrying the most marks, and record the other in subtopics.',
  'skills and methods describe what a student must do, not just words copied from the question.',
  'Describe only what the question actually asks. Do not claim interpolation, proof, modelling or another operation merely because it is a possible extension.',
  'diagram_required is true only when a source-provided diagram, graph or table must be interpreted to answer the question. An optional diagram method or a request to draw a graph does not by itself make it true.',
  'Difficulty is 1 for very routine through 5 for unusually demanding, or null when uncertain.',
  'Use confidence below 0.75 whenever the classification is genuinely uncertain.',
  'Return exactly one metadata record per supplied question number.',
].join('\n');
const compactQuestions = state.paper_bundle.questions.map((question) => ({
  question_number: question.question_number,
  stem_markdown: question.stem_markdown,
  parts: question.parts,
  total_marks: question.total_marks,
  has_instructional_asset: (question.assets || []).length > 0,
}));
return [{
  json: {
    ...state,
    cost_event_id: reservation.cost_event_id,
    metadata_request: {
      model: state.config.metadata_model,
      reasoning: { effort: 'low' },
      store: false,
      max_output_tokens: 6000,
      input: [
        { role: 'system', content: prompt },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(compactQuestions) }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'shamo_v2_question_metadata',
          strict: true,
          schema: ${JSON.stringify(metadataSchema)},
        },
      },
    },
  },
}];`;

const parseMetadataCode = String.raw`
const response = $input.first().json;
const state = $('Build Metadata Request').first().json;
if (response.status === 'incomplete') throw new Error('Metadata classification was incomplete.');
const message = (response.output || []).find((entry) => entry.type === 'message');
const outputText = (message?.content || []).find((entry) => entry.type === 'output_text');
if (!outputText?.text) throw new Error('Metadata classification returned no structured text.');
const extracted = JSON.parse(outputText.text);
const metadataByNumber = new Map((extracted.questions || []).map((item) => [Number(item.question_number), item]));
if (metadataByNumber.size !== state.paper_bundle.questions.length) {
  throw new Error('Metadata response did not contain exactly one row per question.');
}
const questions = state.paper_bundle.questions.map((question) => {
  const item = metadataByNumber.get(Number(question.question_number));
  if (!item) throw new Error('Metadata omitted question ' + question.question_number + '.');
  const { question_number, ...metadata } = item;
  return {
    ...question,
    metadata: {
      ...metadata,
      metadata_model: state.config.metadata_model,
      taxonomy_version: 'cambridge-maths-v1',
    },
  };
});
const model = state.config.metadata_model;
${usageCalculation}
return [{
  json: {
    ...state,
    paper_bundle: { ...state.paper_bundle, questions },
    extraction_response_ids: [...(state.extraction_response_ids || []), response.id || null],
    api_events: [...(state.api_events || []), {
      operation: 'question_metadata',
      model,
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      actual_cost_usd: Number(actualCostUsd.toFixed(8)),
      usage_audit: usageAudit,
    }],
    finalize_cost_body: {
      requested_cost_event_id: state.cost_event_id,
      requested_input_tokens: inputTokens,
      requested_cached_input_tokens: cachedInputTokens,
      requested_output_tokens: outputTokens,
      requested_actual_usd: Number(actualCostUsd.toFixed(8)),
      requested_provider_request_id: response.id || null,
    },
  },
}];`;

let deterministicValidationCode =
  findNode(v1Child, "Deterministic Validation").parameters.jsCode;
deterministicValidationCode = deterministicValidationCode.replace(
  "  let knownPartMarks = 0;\n  let allPartMarksKnown = true;",
  String.raw`  let knownPartMarks = 0;
  let allPartMarksKnown = true;
  const rawParts = question.parts || [];
  const isLeafPart = (candidate) => !rawParts.some((other) =>
    other !== candidate &&
    (other.label_path || []).length > (candidate.label_path || []).length &&
    (candidate.label_path || []).every((label, index) => other.label_path[index] === label)
  );`
);
deterministicValidationCode = deterministicValidationCode.replace(
  "    if (part.marks === null) allPartMarksKnown = false;\n    else knownPartMarks += Number(part.marks || 0);",
  String.raw`    if ((part.label_path || [])[0] === String(qn)) {
      addIssue('blocking', 'QUESTION_NUMBER_INSIDE_PART_PATH',
        'A part path incorrectly includes the main question number.', {
          question_number: qn,
          part_path: part.label_path || [],
        });
    }
    if (isLeafPart(part)) {
      if (part.marks === null) allPartMarksKnown = false;
      else knownPartMarks += Number(part.marks || 0);
    }`
);
deterministicValidationCode = deterministicValidationCode.replace(
  "const issues = [];",
  String.raw`const issues = [];
for (const result of state.mark_scheme_results || []) {
  if (result.used_full_mark_scheme_fallback) {
    issues.push({
      severity: 'warning',
      issue_code: 'MARK_SCHEME_PAGE_MAP_FALLBACK',
      document_type: 'mark_scheme',
      page_number: null,
      question_number: result.question_number,
      part_path: [],
      message: 'The page mapper missed this question, so extraction used the complete mark scheme.',
    });
  }
  if (Number(result.unwrapped_mark_code_count || 0) > 0) {
    issues.push({
      severity: 'warning',
      issue_code: 'MARK_CODE_FORMAT_NORMALIZED',
      document_type: 'mark_scheme',
      page_number: null,
      question_number: result.question_number,
      part_path: [],
      message: 'Normalized Markdown wrappers, parentheses, compact suffixes or special-case prefixes in ' +
        result.unwrapped_mark_code_count + ' mark-code cells before validation.',
    });
  }
  // Removing printed subtotal rows is not a defect -- it is the parser working.
  // The subtotal is read first and kept as the reconciliation anchor, then the
  // row is dropped because a printed total is not an instructional award. Once
  // per question, that produced 49 of batch 2's 61 warnings and buried the
  // handful that meant something. The per-question count stays in
  // mark_scheme_results.removed_subtotal_count for anyone who wants it, and the
  // case actually worth flagging -- no printed subtotal to reconcile against --
  // is already reported as PART_TOTAL_NOT_FOUND.
  if (Number(result.table_debris_row_count || 0) > 0) {
    issues.push({
      severity: 'warning',
      issue_code: 'MARK_SCHEME_TABLE_DEBRIS_REMOVED',
      document_type: 'mark_scheme',
      page_number: null,
      question_number: result.question_number,
      part_path: [],
      message: 'Dropped ' + result.table_debris_row_count +
        ' codeless rows carrying no prose (embedded working grid or separator).',
    });
  }
}`
);
deterministicValidationCode = deterministicValidationCode.replace(
  "const statedMarks = state.paper_summary?.total_marks_from_source;",
  "const statedMarks = state.expected_total_marks;"
);
deterministicValidationCode = deterministicValidationCode.replace(
  "const forbiddenPattern = /(DO NOT WRITE IN THIS MARGIN|0000800000|\\*{1,2}\\d{8,}\\*{1,2})/i;",
  String.raw`const forbiddenPattern = /(DO NOT WRITE IN THIS MARGIN|0000800000|\*{1,2}\d{8,}\*{1,2})/i;
const encodingCorruptionPattern = /(?:â€|â€“|â€”|Â|ï¿½|�)/;
const normalizedSourceText = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();`
);
deterministicValidationCode = deterministicValidationCode.replace(
  "  const questionPages = question.source_page_numbers || [];",
  String.raw`  if (encodingCorruptionPattern.test(question.stem_markdown || '')) {
    addIssue('blocking', 'TEXT_ENCODING_CORRUPTION',
      'Question text contains corrupted character encoding.', { question_number: qn });
  }
  const questionPages = question.source_page_numbers || [];`
);
deterministicValidationCode = deterministicValidationCode.replace(
  "    }\n  }\n  if ((question.parts || []).length && allPartMarksKnown",
  String.raw`    }
    if (encodingCorruptionPattern.test(part.prompt_markdown || '')) {
      addIssue('blocking', 'TEXT_ENCODING_CORRUPTION',
        'Question-part text contains corrupted character encoding.', {
          question_number: qn,
          part_path: part.label_path || [],
        });
    }
  }
  if ((question.parts || []).length && allPartMarksKnown`
);
deterministicValidationCode = deterministicValidationCode.replace(
  "  let primaryMarkCount = 0;",
  "  let primaryMarkCount = 0;\n  let allMarkCount = 0;\n  const markedRowsByPart = new Map();"
);
deterministicValidationCode = deterministicValidationCode.replace(
  String.raw`    if (!hasAnswer && mark.mark_code !== null) {
      addIssue('blocking', 'GUIDANCE_ONLY_ROW_HAS_MARK_CODE',
        'A guidance-only row must have mark_code=null.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
`,
  ""
);
deterministicValidationCode = deterministicValidationCode.replace(
  "    for (const page of mark.source_page_numbers || []) {",
  String.raw`    const normalizedAnswer = normalizedSourceText(mark.content_markdown);
    const normalizedGuidance = normalizedSourceText(mark.guidance_markdown);
    const answerTokens = new Set(normalizedAnswer.match(/[a-z0-9]+/g) || []);
    const guidanceTokens = new Set(normalizedGuidance.match(/[a-z0-9]+/g) || []);
    const sharedTokenCount = [...answerTokens].filter((token) =>
      guidanceTokens.has(token)
    ).length;
    const smallerTokenCount = Math.min(answerTokens.size, guidanceTokens.size);
    const tokenOverlap = smallerTokenCount
      ? sharedTokenCount / smallerTokenCount
      : 0;
    const duplicateAnswerGuidance =
      normalizedAnswer.length >= 20 &&
      normalizedAnswer === normalizedGuidance;
    const nearDuplicateAnswerGuidance =
      normalizedAnswer.length >= 60 &&
      normalizedGuidance.length >= 60 &&
      smallerTokenCount >= 10 &&
      tokenOverlap >= 0.90;
    // Downgraded from blocking to warning.
    //
    // This rule existed to catch a model copying the Answer cell into Guidance.
    // With deterministic parsing the two now come from distinct printed columns
    // by construction, so similarity reflects the source rather than an
    // extraction error -- an "answer given" row legitimately repeats the same
    // expression in both cells. Batch 2 source-checked exactly two of these
    // (9709/31 Q7 and 9709/42 Q7a) and confirmed both were false positives that
    // had to be cleared by hand before publication. Keeping it blocking would
    // reproduce that manual work every batch.
    if (duplicateAnswerGuidance || nearDuplicateAnswerGuidance) {
      addIssue('warning', 'DUPLICATED_ANSWER_GUIDANCE_TEXT',
        'Answer and Guidance are identical or unusually similar; compare this row with the source mark scheme.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    // This pattern MUST accept everything CODE_BODY in lib/mark_scheme_parser.mjs
    // accepts, or the parser reads a code the validator then rejects and the
    // paper blocks on its own correct output. That is exactly what happened
    // with B1B1 on 9709/61 O/N 2025 Q6(a): teaching the parser to read two
    // run-together codes fixed a two-mark loss and immediately raised
    // INVALID_MARK_CODE instead. The code separator is zero-or-more whitespace
    // in both. validate_budget_v2_workflows.mjs asserts the two agree on a
    // fixed corpus of real printed codes, so they cannot drift apart silently.
    // (No backticks in this comment: it lives inside a String.raw template.)
    if (mark.mark_code !== null && String(mark.mark_code).trim() !== '' &&
        !/^\*?(?:DM|DB|DA|M|A|B)\d+\*?(?:\s*FT)?(?:\s*,\s*\d+)*(?:\s*\*?(?:DM|DB|DA|M|A|B)\d+\*?(?:\s*FT)?(?:\s*,\s*\d+)*)*$/i
          .test(String(mark.mark_code).trim())) {
      addIssue('blocking', 'INVALID_MARK_CODE',
        'Mark code is not a valid printed Cambridge mark code: ' + mark.mark_code + '.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    const printedMarkCode = String(mark.mark_code || '').trim().toUpperCase();
    const upperGuidance = normalizedGuidance.toUpperCase();
    const guidanceStartsWithMarkCode = printedMarkCode && (
      upperGuidance === printedMarkCode ||
      upperGuidance.startsWith(printedMarkCode + ' ') ||
      upperGuidance.startsWith(printedMarkCode + '.') ||
      upperGuidance.startsWith(printedMarkCode + ':')
    );
    if (guidanceStartsWithMarkCode) {
      addIssue('blocking', 'MARK_CODE_COPIED_INTO_GUIDANCE',
        'Guidance begins with a duplicate of the separate Marks-column code.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    if (mark.mark_code === null && !hasGuidance &&
        /^\*{0,2}\d{1,3}\*{0,2}$/.test((mark.content_markdown || '').trim())) {
      addIssue('blocking', 'MARK_SCHEME_TOTAL_ROW_EMITTED',
        'A standalone Marks-column subtotal was emitted as a mark-scheme row.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    if (encodingCorruptionPattern.test(mark.content_markdown || '') ||
        encodingCorruptionPattern.test(mark.guidance_markdown || '')) {
      addIssue('blocking', 'TEXT_ENCODING_CORRUPTION',
        'Mark-scheme text contains corrupted character encoding.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    for (const page of mark.source_page_numbers || []) {`
);
deterministicValidationCode = deterministicValidationCode.replace(
  String.raw`    if (!mark.is_alternative_method && mark.mark_code) {
      primaryMarkCount += (
        String(mark.mark_code).match(/(?:\*?D?M1|A1|B1|B2|B3)/g) || []
      ).reduce((count, code) => {
        const value = Number(code.match(/\d+/)?.[0] || 1);
        return count + value;
      }, 0);
    }`,
  String.raw`    if (mark.mark_code) {
      const markValue = [...String(mark.mark_code).matchAll(/\*?(?:D?M|A|B)(\d+)/gi)]
        .reduce((count, match) => count + Number(match[1] || 1), 0);
      allMarkCount += markValue;
      if (!mark.is_alternative_method) primaryMarkCount += markValue;
      const markedPartPath = (mark.part_path || []).join('.');
      if (!markedRowsByPart.has(markedPartPath)) markedRowsByPart.set(markedPartPath, []);
      markedRowsByPart.get(markedPartPath).push(mark);
    }`
);
deterministicValidationCode = deterministicValidationCode.replace(
  String.raw`  if (question.total_marks !== null && primaryMarkCount < Number(question.total_marks)) {
    addIssue('blocking', 'MARK_CODE_COVERAGE_TOO_LOW',
      'Primary mark codes cover ' + primaryMarkCount +
      ' marks but the question is worth ' + question.total_marks + '.', {
        question_number: qn,
      });
  }`,
  String.raw`  for (const [markedPartPath, markedRows] of markedRowsByPart.entries()) {
    if (markedRows.length && markedRows.every((row) => row.is_alternative_method === true)) {
      addIssue('blocking', 'ALL_METHODS_MARKED_ALTERNATIVE',
        'Every marked row for this question part was labelled as an alternative method.', {
          question_number: qn,
          part_path: markedPartPath ? markedPartPath.split('.') : [],
        });
    }
  }
  if (question.total_marks !== null && allMarkCount < Number(question.total_marks)) {
    addIssue('blocking', 'MARK_CODE_COVERAGE_TOO_LOW',
      'All extracted mark codes cover ' + allMarkCount +
      ' marks but the question is worth ' + question.total_marks + '.', {
        question_number: qn,
      });
  } else if (question.total_marks !== null &&
      primaryMarkCount < Number(question.total_marks) &&
      allMarkCount >= Number(question.total_marks)) {
    // Blocking, promoted from warning on 9 August 2026 after it caught a real
    // lost mark and was ignored because it was only a warning. On 9709/12 M/J
    // 2024 Q6(b) it reported primary coverage of 8 of 9 marks; the paper still
    // passed, published, and needed a correction afterwards.
    //
    // The failure mode it detects is specific and always wrong: every printed
    // mark is accounted for, yet the primary route alone does not reach the
    // question total. A candidate following the main method could not score
    // full marks, which no Cambridge mark scheme permits. It means rows were
    // misfiled as alternative -- so the rate rules cannot replace it, because
    // the count can be perfectly normal while the classification is wrong.
    addIssue('blocking', 'MARK_CODE_ALTERNATIVE_CLASSIFICATION',
      'All mark codes cover the question total, but rows marked as alternative reduce primary coverage to ' +
      primaryMarkCount + ' of ' + question.total_marks + ' marks. A candidate using the ' +
      'primary method could not reach full marks, so some rows are misclassified as alternative.', {
        question_number: qn,
      });
  }`
);
deterministicValidationCode = deterministicValidationCode.replace(
  "return [{\n  json: {\n    ...state,",
  String.raw`const apiEvents = state.api_events || [];
const aggregateUsage = apiEvents.reduce((totals, event) => ({
  input_tokens: totals.input_tokens + Number(event.input_tokens || 0),
  cached_input_tokens: totals.cached_input_tokens + Number(event.cached_input_tokens || 0),
  output_tokens: totals.output_tokens + Number(event.output_tokens || 0),
  actual_cost_usd: totals.actual_cost_usd + Number(event.actual_cost_usd || 0),
  // Tokens the provider counted but we never priced. If this is non-zero, the
  // ledger under-reports by construction and the budget caps are not binding.
  unaccounted_tokens: totals.unaccounted_tokens + Number(event.usage_audit?.unaccounted_tokens || 0),
  paid_calls: totals.paid_calls + 1,
}), { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, actual_cost_usd: 0, unaccounted_tokens: 0, paid_calls: 0 });
return [{
  json: {
    ...state,
    extraction_response_id: state.extraction_response_ids || [],
    api_usage: {
      ...aggregateUsage,
      actual_cost_usd: Number(aggregateUsage.actual_cost_usd.toFixed(8)),
      events: apiEvents,
    },`
);

// Asset resolution, injected AHEAD of the asset rules so they judge a corrected
// claim rather than a guessed one.
//
// The extraction model has to name each diagram as `document:page:index`, where
// index is its position in Mistral's per-page image list -- an ordinal it
// cannot see and therefore guesses. When the guess misses, three blocking
// issues fire at once (ASSET_SOURCE_NOT_FOUND, then ASSET_UPLOAD_COUNT_MISMATCH
// from the uploader silently skipping it, then REPAIR_DID_NOT_CLEAR_BLOCKERS)
// and the paper needs a human. That single guessed integer is the largest
// contributor to papers stopping mid-batch: it blocked 9709/32 in batch 3 and
// 9709/51 in batch 4.
//
// `bundle` is `state.paper_bundle` by reference, so rewriting the index here
// also reaches `Prepare Instructional Assets` downstream -- the validator and
// the uploader must agree, or a resolved asset validates and then fails to
// upload.
deterministicValidationCode = deterministicValidationCode.replace(
  "const questions = Array.isArray(bundle?.questions) ? bundle.questions : [];",
  [
    inlineModule("asset_matching.mjs"),
    String.raw`
const questions = Array.isArray(bundle?.questions) ? bundle.questions : [];
const assetInventory = buildImageInventory(state.compact_documents || []);
const assetResolutions = [];
const unsupportedAssetKeys = new Set();
for (const question of questions) {
  for (const asset of question.assets || []) {
    const resolution = resolveAssetImage(asset, assetInventory);
    assetResolutions.push({
      question_number: Number(question.question_number),
      claimed: asset.document_type + ':' + asset.source_page_number + ':' + asset.source_image_index,
      status: resolution.status,
      resolved_index: resolution.index,
    });
    if (resolution.status !== 'exact' && resolution.index !== null) {
      asset.source_image_index = resolution.index;
      asset.index_resolution = resolution.status;
    }
  }
}
state.asset_resolutions = assetResolutions;`,
  ].join("\n")
);

// A claim that resolution could not attach to any image is dropped rather than
// blocked, and this is the judgement call in this change, so it is written down
// rather than buried.
//
// `no_content_image` means Mistral detected no figure region anywhere on that
// page -- only furniture, or nothing. Two things could produce it: OCR silently
// lost a printed diagram, or the model invented a reference. Those need
// opposite handling, so the split has to rest on evidence rather than caution.
//
// The evidence says invention. Across 46 runs and 410 image references there is
// no case of Mistral dropping a printed figure; the one diagram that ever went
// missing (9709/11 M/J Q11) was in the OCR and was lost by a pipeline bug since
// fixed. Meanwhile invented references are measured twice -- 9709/32 Q5 claimed
// a mark-scheme image for an Argand diagram the CANDIDATE draws, and 9709/51 Q3
// claimed page 5 index 5 for a stem-and-leaf that OCR captured perfectly as a
// markdown table.
//
// The residual risk is real and is left visible rather than argued away: if OCR
// ever does drop a figure, this downgrades a stop into a warning. Two things
// bound it. TEXT_MENTIONS_DIAGRAM_WITHOUT_ASSET still fires when the question
// text refers to a printed diagram, so the case surfaces in review triage. And
// ASSET_IMAGE_DATA_MISSING stays blocking, because a content image that exists
// with no bytes behind it IS positive evidence of a loss.
deterministicValidationCode = deterministicValidationCode.replace(
  String.raw`    if (!imageKeys.has(key)) {
      addIssue('blocking', 'ASSET_SOURCE_NOT_FOUND', 'Asset does not match an OCR image: ' + key + '.', {`,
  String.raw`    const assetResolution = (state.asset_resolutions || []).find(
      (entry) => entry.question_number === qn && entry.claimed === key
    );
    if (!imageKeys.has(key) && assetResolution && assetResolution.status === 'no_content_image') {
      unsupportedAssetKeys.add(qn + '|' + key);
      addIssue('warning', 'ASSET_CLAIM_UNSUPPORTED_BY_OCR',
        'The model claimed ' + key + ' but OCR found no figure on that page, only page furniture. ' +
        'The claim is dropped. If the question text refers to a printed diagram, ' +
        'TEXT_MENTIONS_DIAGRAM_WITHOUT_ASSET will also fire.', {
          document_type: asset.document_type,
          page_number: asset.source_page_number,
          question_number: qn,
          part_path: asset.part_path || [],
        });
    } else if (!imageKeys.has(key)) {
      addIssue('blocking', 'ASSET_SOURCE_NOT_FOUND', 'Asset does not match an OCR image: ' + key + '.', {`
);

// Drop the unsupported claims after the loop that judged them. Removing them
// mid-iteration would skip the next asset, and leaving them in would raise
// ASSET_UPLOAD_COUNT_MISMATCH downstream -- the uploader cannot upload an image
// that does not exist, so the count would disagree by exactly the number of
// claims this rule just forgave.
deterministicValidationCode = deterministicValidationCode.replace(
  "const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;",
  String.raw`if (unsupportedAssetKeys.size) {
  for (const question of questions) {
    const qn = Number(question.question_number);
    question.assets = (question.assets || []).filter((asset) => !unsupportedAssetKeys.has(
      qn + '|' + [asset.document_type, asset.source_page_number, asset.source_image_index].join(':')
    ));
  }
}
const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;`
);

// Extended rules. Every one corresponds to a defect found by human source
// review in batch 1 or 2. Ported here so the class cannot recur silently --
// previously each review produced correction SQL and nothing that would catch
// the same shape next time.
//
// Injected immediately before blockingCount is computed, so the rules
// contribute to validation_report.passed and therefore to ready_for_approval.
// A paper failing any of them can no longer reach the approval queue.
deterministicValidationCode = deterministicValidationCode.replace(
  "const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;",
  [
    inlineModule("validation_rules.mjs"),
    String.raw`
applyExtendedValidationRules({ bundle, state, addIssue });
const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;
if (state.repair_applied === true && blockingCount > 0) {
  addIssue(
    'blocking',
    'REPAIR_DID_NOT_CLEAR_BLOCKERS',
    'Targeted repair ran but ' + blockingCount + ' blocking issues remain. There is no second ' +
      'repair pass, so this paper needs human correction before approval.',
    {}
  );
}`,
  ].join("\n")
);

let buildRepairRequestCode =
  findNode(pilot, "Build Targeted Repair Request").parameters.jsCode;
buildRepairRequestCode = buildRepairRequestCode
  .replaceAll("state.config.verifier_model", "state.config.repair_model")
  .replace("reasoning: { effort: 'high' }", "reasoning: { effort: 'medium' }")
  .replace(
    "max_output_tokens: 30000",
    "max_output_tokens: 22000"
  )
  .replace(
    "name: 'shamo_targeted_question_repairs'",
    "name: 'shamo_v2_targeted_question_repairs'"
  )
  .replace(
    'For a source row with blank Answer and Marks but non-empty Guidance, use content_markdown="", mark_code=null and is_final_answer=false.',
  'For a source row with blank Answer and Marks but non-empty Guidance, use content_markdown="", mark_code=null and is_final_answer=false. A source row may also have blank Answer but nonblank Marks and Guidance: preserve content_markdown="", keep the printed mark_code, and preserve Guidance exactly. Never invent Answer text, copy Guidance into content_markdown, or repeat a Marks code at the start of guidance_markdown. Do not emit standalone part-total numbers from the bottom of the Marks column. A non-null mark_code must be plain text without Markdown bold wrappers and must begin with M, DM, A or B and its printed number; preserve FT suffixes such as A1FT and B1FT. Preserve every algebraic and combinatorial variable exactly, and verify that subscripts and stated ranges use the same placeholder. For multiple printed methods, Method 1 is primary and later methods are alternatives; never mark every method as alternative. A leading dependency star such as *M1 does not by itself make a row an alternative method. An SC mark is a special-case award and must not be counted as an additional primary mark.'
  );

const prepareRepairReservationCode = String.raw`
const state = $input.first().json;
const openaiIdempotencyKey = state.idempotency_key + ':targeted-repair';
return [{
  json: {
    ...state,
    openai_idempotency_key: openaiIdempotencyKey,
    reserve_body: {
      requested_batch_id: state.batch.id,
      requested_ingestion_run_id: state.ingestion_run_id,
      requested_idempotency_key: openaiIdempotencyKey,
      requested_provider: 'openai',
      requested_model: state.config.repair_model,
      requested_operation: 'targeted_question_repair',
      requested_reserved_usd: state.config.stage_reservations_usd.repair,
    },
  },
}];`;

const attachRepairReservationCode = String.raw`
const response = $input.first().json;
const reservation = Array.isArray(response) ? response[0] : response;
const state = $('Prepare Repair Reservation').first().json;
if (!reservation?.cost_event_id) throw new Error('Repair budget reservation was not returned.');
return [{ json: { ...state, cost_event_id: reservation.cost_event_id } }];`;

const parseRepairCode = String.raw`
const response = $input.first().json;
const state = $('Attach Repair Reservation').first().json;
if (response.status === 'incomplete') throw new Error('OpenAI repair was incomplete.');
const message = (response.output || []).find((entry) => entry.type === 'message');
const outputText = (message?.content || []).find((entry) => entry.type === 'output_text');
if (!outputText?.text) throw new Error('OpenAI repair returned no structured text.');
const repaired = JSON.parse(outputText.text);
const expectedNumbers = [...new Set((state.repair_question_numbers || []).map(Number))]
  .sort((left, right) => left - right);
const expectedNumberSet = new Set(expectedNumbers);
if (!expectedNumbers.length) throw new Error('No repair question numbers were available.');

const stableStringify = (value) => {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + stableStringify(value[key])
    ).join(',') + '}';
  }
  return JSON.stringify(value);
};

const normalizedCandidates = (repaired.corrected_questions || []).map((question) => {
  let removedSubtotalCount = 0;
  let unwrappedMarkCodeCount = 0;
  const markSchemeItems = (question.mark_scheme_items || [])
    .map((item) => {
      const rawMarkCode = item.mark_code === null
        ? null
        : String(item.mark_code).trim();
      let markCode = rawMarkCode;
      let isAlternativeMethod = Boolean(item.is_alternative_method);
      if (markCode?.startsWith('**')) markCode = markCode.slice(2);
      if (markCode?.endsWith('**')) markCode = markCode.slice(0, -2);
      markCode = markCode?.trim() ?? null;
      const parenthesized = markCode?.match(/^\((.*)\)$/);
      if (parenthesized) {
        markCode = parenthesized[1].trim();
        isAlternativeMethod = true;
      }
      if (/^\d+$/.test(markCode || '')) {
        removedSubtotalCount++;
        return null;
      }
      if (/^SC\s+/i.test(markCode || '')) {
        markCode = markCode.replace(/^SC\s+/i, '');
        isAlternativeMethod = true;
      }
      if (markCode !== null) {
        markCode = markCode
          .replace(/([0-9])([A-Za-z])/g, '$1 $2')
          .replace(/\s+/g, ' ')
          .trim()
          .toUpperCase();
      }
      if (markCode !== rawMarkCode) unwrappedMarkCodeCount++;
      return {
        ...item,
        mark_code: markCode,
        is_alternative_method: isAlternativeMethod,
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(left.sequence_number) - Number(right.sequence_number))
    .map((item, index) => ({ ...item, sequence_number: index + 1 }));
  return {
    number: Number(question.question_number),
    question: { ...question, mark_scheme_items: markSchemeItems },
    normalization: {
      removed_subtotal_count: removedSubtotalCount,
      unwrapped_mark_code_count: unwrappedMarkCodeCount,
    },
  };
});

const candidatesByNumber = new Map();
for (const candidate of normalizedCandidates) {
  if (!Number.isInteger(candidate.number)) {
    throw new Error('Repair returned a question with an invalid question_number.');
  }
  const existing = candidatesByNumber.get(candidate.number);
  if (!existing) {
    candidatesByNumber.set(candidate.number, candidate);
    continue;
  }
  if (stableStringify(existing.question) !== stableStringify(candidate.question)) {
    throw new Error(
      'Repair returned conflicting duplicate entries for question ' + candidate.number + '.'
    );
  }
}

const actualNumbers = normalizedCandidates.map((candidate) => candidate.number);
const actualUniqueNumbers = [...new Set(actualNumbers)].sort((left, right) => left - right);
const missingNumbers = expectedNumbers.filter((number) => !candidatesByNumber.has(number));
if (missingNumbers.length) {
  throw new Error(
    'Repair omitted requested questions. Expected ' + expectedNumbers.join(', ') +
    '; received ' + actualUniqueNumbers.join(', ') +
    '; missing ' + missingNumbers.join(', ') + '.'
  );
}
const duplicateNumbers = actualUniqueNumbers.filter(
  (number) => actualNumbers.filter((actual) => actual === number).length > 1
);
const ignoredQuestionNumbers = actualUniqueNumbers.filter(
  (number) => !expectedNumberSet.has(number)
);
const correctedQuestions = expectedNumbers.map(
  (number) => candidatesByNumber.get(number).question
);
const repairNormalizationByQuestion = new Map(
  expectedNumbers.map((number) => [
    number,
    candidatesByNumber.get(number).normalization,
  ])
);
const originalByNumber = new Map(
  state.paper_bundle.questions.map((question) => [Number(question.question_number), question])
);
const correctedByNumber = new Map(
  correctedQuestions.map((question) => [Number(question.question_number), question])
);
const mergedQuestions = state.paper_bundle.questions.map((question) => {
  const corrected = correctedByNumber.get(Number(question.question_number));
  if (!corrected) return question;
  const original = originalByNumber.get(Number(question.question_number));
  // Previously this discarded corrected.assets unconditionally, which made a
  // dropped diagram permanently unrecoverable: repair could not fix the
  // 9709/11 Q11 missing-graph case even in principle. Prefer a repaired asset
  // list when the model supplies one, otherwise keep the original.
  return {
    ...corrected,
    assets:
      corrected.assets && corrected.assets.length ? corrected.assets : original.assets || [],
    metadata: original.metadata,
  };
});
const markSchemeResults = (state.mark_scheme_results || []).map((result) => {
  const normalization =
    repairNormalizationByQuestion.get(Number(result.question_number));
  if (!normalization) return result;
  return {
    ...result,
    removed_subtotal_count:
      Number(result.removed_subtotal_count || 0) +
      normalization.removed_subtotal_count,
    unwrapped_mark_code_count:
      Number(result.unwrapped_mark_code_count || 0) +
      normalization.unwrapped_mark_code_count,
  };
});
const model = state.config.repair_model;
${usageCalculation}
return [{
  json: {
    ...state,
    mark_scheme_results: markSchemeResults,
    paper_bundle: { ...state.paper_bundle, questions: mergedQuestions },
    repair_applied: true,
    repair_response_id: response.id || null,
    repair_returned_question_numbers: actualUniqueNumbers,
    repair_duplicate_question_numbers: duplicateNumbers,
    repair_ignored_question_numbers: ignoredQuestionNumbers,
    extraction_response_ids: [...(state.extraction_response_ids || []), response.id || null],
    api_events: [...(state.api_events || []), {
      operation: 'targeted_question_repair',
      model,
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      actual_cost_usd: Number(actualCostUsd.toFixed(8)),
      usage_audit: usageAudit,
    }],
    finalize_cost_body: {
      requested_cost_event_id: state.cost_event_id,
      requested_input_tokens: inputTokens,
      requested_cached_input_tokens: cachedInputTokens,
      requested_output_tokens: outputTokens,
      requested_actual_usd: Number(actualCostUsd.toFixed(8)),
      requested_provider_request_id: response.id || null,
    },
  },
}];`;

const prefixNames = [
  "Child workflow note",
  "When Called by Batch Controller",
  "Validate Paper Input",
  "Check Existing Ingestion Run",
  "Inspect Existing Ingestion Run",
  "Already Staged or Published",
  "Existing Paper Result",
  "Prepare Paper Upsert",
  "Upsert Paper",
  "Prepare Ingestion Run",
  "Create or Retry Ingestion Run",
  "Expand Paper Documents",
  "Mistral OCR Both Documents",
  "Attach OCR Results",
  "Build OCR State",
  "Store Temporary OCR Pages",
];
const tailNames = [
  "Prepare Instructional Assets",
  "Has Instructional Assets",
  "Upload Instructional Assets",
  "Collect Asset Uploads",
  "No Instructional Assets",
  "Finalize Review Package",
  "Update Staged Ingestion Run",
  "Restore Final Review State",
  "Has Validation Issues",
  "Store Validation Issues",
  "Paper Staging Result",
];

const childNodes = [
  ...prefixNames.map((name) => clone(findNode(v1Child, name))),
  codeNode(
    "Prepare Question Paper Reservation",
    prepareReservationCode("Build OCR State", "question_paper_extraction", "question_model", "question_paper"),
    [2680, 80]
  ),
  reserveNode("Reserve Question Paper Budget", [2920, 80]),
  codeNode("Build Question Paper Request", buildQuestionPaperRequestCode, [3160, 80]),
  openAiNode("OpenAI Question Paper", "question_paper_request", "openai_idempotency_key", [3400, 80]),
  codeNode("Parse Question Paper", parseQuestionPaperCode, [3640, 80]),
  finalizeNode("Finalize Question Paper Cost", [3880, 80]),
  codeNode("Restore Question Paper State", restoreCode("Parse Question Paper"), [4120, 80]),

  codeNode(
    "Prepare Page Map Reservation",
    prepareReservationCode("Restore Question Paper State", "mark_scheme_page_map", "page_map_model", "page_map"),
    [4360, 80]
  ),
  reserveNode("Reserve Page Map Budget", [4600, 80]),
  codeNode("Build Page Map Request", buildPageMapRequestCode, [4840, 80]),
  openAiNode("OpenAI Mark Scheme Page Map", "page_map_request", "openai_idempotency_key", [5080, 80]),
  codeNode("Parse Page Map", parsePageMapCode, [5320, 80]),
  finalizeNode("Finalize Page Map Cost", [5560, 80]),
  codeNode("Restore Page Map State", restoreCode("Parse Page Map"), [5800, 80]),

  // The deterministic parser is the primary mark-scheme path. The OpenAI stage
  // below still exists but now fires only for questions the parser defers on.
  codeNode("Parse Mark Scheme Tables", parseMarkSchemeTablesCode, [5920, 80]),
  ifNode("Mark Scheme Fallback Needed", "={{ $json.mark_scheme_fallback_needed }}", [5980, 80]),

  codeNode(
    "Prepare Mark Scheme Reservation",
    prepareReservationCode("Mark Scheme Fallback Needed", "mark_scheme_question_extraction", "mark_scheme_model", "mark_scheme"),
    [6040, 80]
  ),
  reserveNode("Reserve Mark Scheme Budget", [6280, 80]),
  codeNode("Build Mark Scheme Requests", buildMarkSchemeRequestsCode, [6520, 80]),
  openAiNode("OpenAI Mark Scheme Questions", "mark_scheme_request", "mark_scheme_idempotency_key", [6760, 80]),
  codeNode("Parse Mark Scheme Responses", parseMarkSchemeResponsesCode, [7000, 80]),
  finalizeNode("Finalize Mark Scheme Cost", [7240, 80]),
  codeNode("Restore Mark Scheme State", restoreCode("Parse Mark Scheme Responses"), [7480, 80]),
  codeNode("Merge Paper Bundle", mergePaperBundleCode, [7720, 80]),

  codeNode(
    "Prepare Metadata Reservation",
    prepareReservationCode("Merge Paper Bundle", "question_metadata", "metadata_model", "metadata"),
    [7960, 80]
  ),
  reserveNode("Reserve Metadata Budget", [8200, 80]),
  codeNode("Build Metadata Request", buildMetadataRequestCode, [8440, 80]),
  openAiNode("OpenAI Question Metadata", "metadata_request", "openai_idempotency_key", [8680, 80]),
  codeNode("Parse Metadata", parseMetadataCode, [8920, 80]),
  finalizeNode("Finalize Metadata Cost", [9160, 80]),
  codeNode("Restore Metadata State", restoreCode("Parse Metadata"), [9400, 80]),
  codeNode("Deterministic Validation Before Repair", deterministicValidationCode, [9640, 80]),
  codeNode("Build Targeted Repair Request", buildRepairRequestCode, [9880, 80]),
  ifNode("Repair Needed", "={{ $json.repair_needed }}", [10120, 80]),
  codeNode("Prepare Repair Reservation", prepareRepairReservationCode, [10360, -80]),
  reserveNode("Reserve Repair Budget", [10600, -80]),
  codeNode("Attach Repair Reservation", attachRepairReservationCode, [10840, -80]),
  openAiNode("OpenAI Targeted Repair", "repair_request", "openai_idempotency_key", [11080, -80]),
  codeNode("Parse Targeted Repair", parseRepairCode, [11320, -80]),
  finalizeNode("Finalize Repair Cost", [11560, -80]),
  codeNode("Restore Repaired State", restoreCode("Parse Targeted Repair"), [11800, -80]),
  codeNode("Deterministic Validation", deterministicValidationCode, [12040, 80]),
  ...tailNames.map((name) => clone(findNode(v1Child, name))),
];

for (const node of childNodes) {
  if (node.name === "Validate Paper Input") node.parameters.jsCode = validateInputCode;
  if (node.name === "Prepare Ingestion Run") {
    node.parameters.jsCode = node.parameters.jsCode.replace(
      "state.config.openai_model",
      "state.config.question_model"
    );
  }
  if (node.name === "Expand Paper Documents") {
    node.parameters.jsCode = node.parameters.jsCode.replace(
      "    idempotency_key: state.idempotency_key,\n    document,",
      "    idempotency_key: state.idempotency_key,\n    expected_total_marks: state.expected_total_marks,\n    document,"
    );
  }
  if (node.name === "Build OCR State") {
    node.parameters.jsCode = node.parameters.jsCode.replace(
      "    idempotency_key: first.idempotency_key,\n    ocr_documents:",
      "    idempotency_key: first.idempotency_key,\n    expected_total_marks: first.expected_total_marks,\n    ocr_documents:"
    );
  }
  if (tailNames.includes(node.name)) {
    const offset = {
      "Prepare Instructional Assets": [12280, 80],
      "Has Instructional Assets": [12520, 80],
      "Upload Instructional Assets": [12760, -40],
      "Collect Asset Uploads": [13000, -40],
      "No Instructional Assets": [12760, 200],
      "Finalize Review Package": [13240, 80],
      "Update Staged Ingestion Run": [13480, 80],
      "Restore Final Review State": [13720, 80],
      "Has Validation Issues": [13960, 80],
      "Store Validation Issues": [14200, -40],
      "Paper Staging Result": [14440, 80],
    }[node.name];
    node.position = offset;
  }
}
findNode(
  { nodes: childNodes },
  "OpenAI Mark Scheme Questions"
).parameters.options.batching = {
  batch: {
    batchSize: 1,
    batchInterval: 2000,
  },
};

const childConnections = {};
const connect = (from, to, output = 0) => {
  if (!childConnections[from]) childConnections[from] = { main: [] };
  while (childConnections[from].main.length <= output) {
    childConnections[from].main.push([]);
  }
  childConnections[from].main[output].push({ node: to, type: "main", index: 0 });
};

connect("When Called by Batch Controller", "Validate Paper Input");
connect("Validate Paper Input", "Check Existing Ingestion Run");
connect("Check Existing Ingestion Run", "Inspect Existing Ingestion Run");
connect("Inspect Existing Ingestion Run", "Already Staged or Published");
connect("Already Staged or Published", "Existing Paper Result", 0);
connect("Already Staged or Published", "Prepare Paper Upsert", 1);
connect("Prepare Paper Upsert", "Upsert Paper");
connect("Upsert Paper", "Prepare Ingestion Run");
connect("Prepare Ingestion Run", "Create or Retry Ingestion Run");
connect("Create or Retry Ingestion Run", "Expand Paper Documents");
connect("Expand Paper Documents", "Mistral OCR Both Documents");
connect("Mistral OCR Both Documents", "Attach OCR Results");
connect("Attach OCR Results", "Build OCR State");
connect("Build OCR State", "Store Temporary OCR Pages");
connect("Store Temporary OCR Pages", "Prepare Question Paper Reservation");
connect("Prepare Question Paper Reservation", "Reserve Question Paper Budget");
connect("Reserve Question Paper Budget", "Build Question Paper Request");
connect("Build Question Paper Request", "OpenAI Question Paper");
connect("OpenAI Question Paper", "Parse Question Paper");
connect("Parse Question Paper", "Finalize Question Paper Cost");
connect("Finalize Question Paper Cost", "Restore Question Paper State");
connect("Restore Question Paper State", "Prepare Page Map Reservation");
connect("Prepare Page Map Reservation", "Reserve Page Map Budget");
connect("Reserve Page Map Budget", "Build Page Map Request");
connect("Build Page Map Request", "OpenAI Mark Scheme Page Map");
connect("OpenAI Mark Scheme Page Map", "Parse Page Map");
connect("Parse Page Map", "Finalize Page Map Cost");
connect("Finalize Page Map Cost", "Restore Page Map State");
connect("Restore Page Map State", "Parse Mark Scheme Tables");
connect("Parse Mark Scheme Tables", "Mark Scheme Fallback Needed");
// true  -> the model stage runs, but only for the deferred questions
// false -> straight to the bundle: no OpenAI call, no cost event at all
connect("Mark Scheme Fallback Needed", "Prepare Mark Scheme Reservation", 0);
connect("Mark Scheme Fallback Needed", "Merge Paper Bundle", 1);
connect("Prepare Mark Scheme Reservation", "Reserve Mark Scheme Budget");
connect("Reserve Mark Scheme Budget", "Build Mark Scheme Requests");
connect("Build Mark Scheme Requests", "OpenAI Mark Scheme Questions");
connect("OpenAI Mark Scheme Questions", "Parse Mark Scheme Responses");
connect("Parse Mark Scheme Responses", "Finalize Mark Scheme Cost");
connect("Finalize Mark Scheme Cost", "Restore Mark Scheme State");
connect("Restore Mark Scheme State", "Merge Paper Bundle");
connect("Merge Paper Bundle", "Prepare Metadata Reservation");
connect("Prepare Metadata Reservation", "Reserve Metadata Budget");
connect("Reserve Metadata Budget", "Build Metadata Request");
connect("Build Metadata Request", "OpenAI Question Metadata");
connect("OpenAI Question Metadata", "Parse Metadata");
connect("Parse Metadata", "Finalize Metadata Cost");
connect("Finalize Metadata Cost", "Restore Metadata State");
connect("Restore Metadata State", "Deterministic Validation Before Repair");
connect("Deterministic Validation Before Repair", "Build Targeted Repair Request");
connect("Build Targeted Repair Request", "Repair Needed");
connect("Repair Needed", "Prepare Repair Reservation", 0);
connect("Repair Needed", "Deterministic Validation", 1);
connect("Prepare Repair Reservation", "Reserve Repair Budget");
connect("Reserve Repair Budget", "Attach Repair Reservation");
connect("Attach Repair Reservation", "OpenAI Targeted Repair");
connect("OpenAI Targeted Repair", "Parse Targeted Repair");
connect("Parse Targeted Repair", "Finalize Repair Cost");
connect("Finalize Repair Cost", "Restore Repaired State");
connect("Restore Repaired State", "Deterministic Validation");
connect("Deterministic Validation", "Prepare Instructional Assets");
connect("Prepare Instructional Assets", "Has Instructional Assets");
connect("Has Instructional Assets", "Upload Instructional Assets", 0);
connect("Has Instructional Assets", "No Instructional Assets", 1);
connect("Upload Instructional Assets", "Collect Asset Uploads");
connect("Collect Asset Uploads", "Finalize Review Package");
connect("No Instructional Assets", "Finalize Review Package");
connect("Finalize Review Package", "Update Staged Ingestion Run");
connect("Update Staged Ingestion Run", "Restore Final Review State");
connect("Restore Final Review State", "Has Validation Issues");
connect("Has Validation Issues", "Store Validation Issues", 0);
connect("Has Validation Issues", "Paper Staging Result", 1);
connect("Store Validation Issues", "Paper Staging Result");

const child = {
  ...clone(v1Child),
  name: "Shamo Budget v2.1 - Structured Maths Paper Staging",
  versionId: "85b559c4-3a0e-448c-82f1-bc54bca7d059",
  nodes: childNodes,
  connections: childConnections,
  pinData: {},
  meta: {
    ...clone(v1Child.meta || {}),
    templateCredsSetupCompleted: true,
  },
};
findNode(child, "Child workflow note").parameters.content =
  "## Budget v2.1 structured extraction\nQuestion paper → mark-scheme page map → one request per question → metadata → deterministic validation → optional targeted repair.\n\nLegitimate blank-Answer rows with Marks and Guidance are preserved. Encoding corruption and duplicated Answer/Guidance are checked. Every paid stage is reserved and finalized in Supabase.";

const controller = clone(v1Controller);
controller.name = "Shamo Budget v2.1 - Test 2 Six Paper Calibration";
controller.versionId = "037475a2-20e9-460f-872d-9df4e8447926";
findNode(controller, "First six only").parameters.content =
  "## Budget-v2.1 calibration\nDefaults to batch 2 so the already-staged first six papers are not reprocessed. Select **Shamo Budget v2.1 - Structured Maths Paper Staging** in the sub-workflow node.";
let configurationCode =
  findNode(controller, "Budget Configuration").parameters.jsCode;
configurationCode = configurationCode
  .replace(
    "campaign_key: 'a-level-9709-test2-pilot-v1',",
    "campaign_key: 'a-level-9709-test2-pilot-v1',\n  workflow_version: 'v2.1',"
  )
  .replace("batch_number: 1,", "batch_number: 2,")
  .replace(
    "openai_reservation_usd: 0.25,",
    String.raw`stage_reservations_usd: {
    question_paper: 0.12,
    page_map: 0.02,
    mark_scheme: 0.12,
    metadata: 0.02,
    repair: 0.20,
  },`
  )
  .replace(
    "openai_model: 'gpt-5.4-nano',",
    String.raw`question_model: 'gpt-5.4-mini',
  page_map_model: 'gpt-5.4-nano',
  mark_scheme_model: 'gpt-5.4-nano',
  metadata_model: 'gpt-5.4-nano',
  repair_model: 'gpt-5.4-mini',`
  )
  .replace(
    String.raw`openai_prices_per_million: {
    input: 0.20,
    cached_input: 0.02,
    output: 1.25,
  },`,
    String.raw`openai_prices_per_million: {
    'gpt-5.4-mini': { input: 0.75, cached_input: 0.075, output: 4.50 },
    'gpt-5.4-nano': { input: 0.20, cached_input: 0.02, output: 1.25 },
  },`
  );
findNode(controller, "Budget Configuration").parameters.jsCode = configurationCode;
const pairNode = findNode(controller, "Pair and Select Test 2 Papers");
pairNode.parameters.jsCode = pairNode.parameters.jsCode.replace(
  "const batchKey = config.campaign_key + '-batch-' +",
  "const batchKey = config.campaign_key + '-' + config.workflow_version + '-batch-' +"
);
findNode(controller, "Guarded Batch Result").parameters.jsCode =
  findNode(controller, "Guarded Batch Result").parameters.jsCode.replace(
    "The guarded batch finished and all new papers are waiting for manual review.",
    "The budget-v2.1 calibration finished and all new papers are waiting for manual review."
  );

fs.writeFileSync(
  path.join(here, "shamo_budget_v2_1_stage_one_math_paper.json"),
  JSON.stringify(child, null, 2) + "\n"
);
fs.writeFileSync(
  path.join(here, "shamo_budget_v2_1_test2_six_paper_controller.json"),
  JSON.stringify(controller, null, 2) + "\n"
);

console.log("Generated Shamo budget v2.1 workflows.");
