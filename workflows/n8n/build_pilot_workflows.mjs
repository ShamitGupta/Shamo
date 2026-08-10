import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const outputDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

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

const nullableDocumentType = {
  anyOf: [
    { type: "string", enum: ["question_paper", "mark_scheme"] },
    { type: "null" },
  ],
};

const boundingBoxSchema = {
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

const partSchema = {
  type: "object",
  properties: {
    label_path: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string", pattern: "^[A-Za-z0-9]+$" },
    },
    prompt_markdown: { type: "string", minLength: 1 },
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

const extractedAssetSchema = {
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
    bounding_box: boundingBoxSchema,
    description: { type: "string", minLength: 1 },
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

const extractionQuestionSchema = {
  type: "object",
  properties: {
    question_number: { type: "integer", minimum: 1 },
    stem_markdown: { type: "string" },
    total_marks: { type: "integer", minimum: 0 },
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
    assets: { type: "array", items: extractedAssetSchema },
  },
  required: [
    "question_number",
    "stem_markdown",
    "total_marks",
    "source_page_numbers",
    "parts",
    "mark_scheme_items",
    "assets",
  ],
  additionalProperties: false,
};

const extractionSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      items: extractionQuestionSchema,
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const questionPaperQuestionSchema = {
  type: "object",
  properties: {
    question_number: extractionQuestionSchema.properties.question_number,
    stem_markdown: extractionQuestionSchema.properties.stem_markdown,
    total_marks: extractionQuestionSchema.properties.total_marks,
    source_page_numbers:
      extractionQuestionSchema.properties.source_page_numbers,
    parts: extractionQuestionSchema.properties.parts,
    assets: extractionQuestionSchema.properties.assets,
  },
  required: [
    "question_number",
    "stem_markdown",
    "total_marks",
    "source_page_numbers",
    "parts",
    "assets",
  ],
  additionalProperties: false,
};

const questionPaperExtractionSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      minItems: 1,
      items: questionPaperQuestionSchema,
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const markSchemeQuestionSchema = {
  type: "object",
  properties: {
    question_number: { type: "integer", minimum: 1 },
    mark_scheme_items: {
      type: "array",
      minItems: 1,
      items: markSchemeItemSchema,
    },
  },
  required: ["question_number", "mark_scheme_items"],
  additionalProperties: false,
};

const repairSchema = {
  type: "object",
  properties: {
    corrected_questions: {
      type: "array",
      minItems: 1,
      items: extractionQuestionSchema,
    },
  },
  required: ["corrected_questions"],
  additionalProperties: false,
};

const finalAssetSchema = {
  type: "object",
  properties: {
    ...extractedAssetSchema.properties,
    storage_bucket: { type: "string", minLength: 1 },
    storage_path: { type: "string", minLength: 1 },
    mime_type: { type: "string", pattern: "^image/" },
    byte_size: nullableInteger,
    checksum: nullableString,
  },
  required: [
    ...extractedAssetSchema.required,
    "storage_bucket",
    "storage_path",
    "mime_type",
    "byte_size",
    "checksum",
  ],
  additionalProperties: false,
};

const finalQuestionSchema = {
  ...extractionQuestionSchema,
  properties: {
    ...extractionQuestionSchema.properties,
    assets: { type: "array", items: finalAssetSchema },
  },
};

const documentSchema = {
  type: "object",
  properties: {
    document_type: {
      type: "string",
      enum: ["question_paper", "mark_scheme"],
    },
    source_url: { type: "string", pattern: "^https?://" },
    source_url_hash: nullableString,
    page_count: { type: "integer", minimum: 1 },
    ocr_model: { type: "string", minLength: 1 },
  },
  required: [
    "document_type",
    "source_url",
    "source_url_hash",
    "page_count",
    "ocr_model",
  ],
  additionalProperties: false,
};

const paperBundleSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Shamo paper publication bundle",
  type: "object",
  properties: {
    documents: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: documentSchema,
    },
    questions: {
      type: "array",
      minItems: 1,
      items: finalQuestionSchema,
    },
  },
  required: ["documents", "questions"],
  additionalProperties: false,
};

const verifierIssueSchema = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["warning", "blocking"] },
    issue_code: {
      type: "string",
      pattern: "^[A-Z0-9_]+$",
    },
    document_type: nullableDocumentType,
    page_number: nullableInteger,
    question_number: nullableInteger,
    part_path: {
      type: "array",
      maxItems: 4,
      items: { type: "string", pattern: "^[A-Za-z0-9]+$" },
    },
    message: { type: "string", minLength: 1 },
  },
  required: [
    "severity",
    "issue_code",
    "document_type",
    "page_number",
    "question_number",
    "part_path",
    "message",
  ],
  additionalProperties: false,
};

const verifierSchema = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    summary: { type: "string", minLength: 1 },
    paper_identity_correct: { type: "boolean" },
    question_numbering_complete: { type: "boolean" },
    marks_consistent: { type: "boolean" },
    question_text_faithful: { type: "boolean" },
    mark_scheme_faithful: { type: "boolean" },
    asset_references_correct: { type: "boolean" },
    issues: { type: "array", items: verifierIssueSchema },
  },
  required: [
    "passed",
    "summary",
    "paper_identity_correct",
    "question_numbering_complete",
    "marks_consistent",
    "question_text_faithful",
    "mark_scheme_faithful",
    "asset_references_correct",
    "issues",
  ],
  additionalProperties: false,
};

function schemaForOpenAi(value) {
  if (Array.isArray(value)) return value.map(schemaForOpenAi);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["minLength", "maxLength"].includes(key))
      .map(([key, nestedValue]) => [key, schemaForOpenAi(nestedValue)]),
  );
}

const bboxAnnotationSchema = {
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
    part_path: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
    },
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

const configurationCode = String.raw`
const config = {
  supabase_url: 'https://YOUR_PROJECT_REF.supabase.co',
  google_document_id: '14QHYH5T22qyGQJH-6SLW00q9yTuDhGwe1mEM7liaEbY',
  google_sheet_name: 'Test',
  qualification: 'a_level',
  syllabus_code: '9709',
  subject: 'Mathematics',
  year: 2025,
  exam_session: 'feb_march',
  paper_variant: '12',
  expected_question_count: 11,
  expected_total_marks: 75,
  expected_page_counts: {
    question_paper: 16,
    mark_scheme: 22,
  },
  mark_scheme_question_pages: {
    1: [9],
    2: [9, 10],
    3: [10, 11],
    4: [11],
    5: [12],
    6: [13],
    7: [14],
    8: [15, 16],
    9: [17, 18],
    10: [19, 20, 21],
    11: [21, 22],
  },
  ocr_model: 'mistral-ocr-latest',
  extraction_model: 'gpt-5.6-terra',
  mark_scheme_extraction_model: 'gpt-5.6-sol',
  verifier_model: 'gpt-5.6-sol',
  storage_bucket: 'past-paper-assets',
};

if (config.supabase_url.includes('YOUR_PROJECT_REF')) {
  throw new Error('Edit this node and replace YOUR_PROJECT_REF with your Supabase project reference before running.');
}

return [{ json: config }];
`.trim();

const pairAndValidateCode = String.raw`
const rows = $input.all().map((item) => item.json);
const config = $('Pilot Configuration').first().json;
const nonEmpty = rows.filter((row) => row['Paper Link'] || row['Document type']);

if (nonEmpty.length !== 2) {
  throw new Error('The Test sheet must contain exactly two data rows: one Question Paper and one Mark Scheme.');
}

const normalizeDocumentType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'question paper') return 'question_paper';
  if (normalized === 'mark scheme') return 'mark_scheme';
  throw new Error('Unexpected Document type: ' + value);
};

const normalizedRows = nonEmpty.map((row) => ({
  grade: String(row.Grade || '').trim(),
  subject: String(row.Subject || '').trim(),
  exam_session: String(row['Exam session'] || '').trim(),
  document_type: normalizeDocumentType(row['Document type']),
  paper_variant: String(row['Paper Variant'] || '').trim(),
  source_url: String(row['Paper Link'] || '').trim(),
  year: Number(row.Year),
}));

const documentTypes = new Set(normalizedRows.map((row) => row.document_type));
if (!documentTypes.has('question_paper') || !documentTypes.has('mark_scheme')) {
  throw new Error('The pilot pair must contain one Question Paper and one Mark Scheme.');
}

for (const row of normalizedRows) {
  if (row.grade !== 'A-levels') throw new Error('Pilot Grade must be A-levels.');
  if (row.subject !== config.subject) throw new Error('Pilot Subject does not match the configuration.');
  if (row.exam_session !== 'February/March') throw new Error('Pilot Exam session must be February/March.');
  if (row.paper_variant !== config.paper_variant) throw new Error('Both rows must use Paper Variant 12.');
  if (row.year !== config.year) throw new Error('Both rows must use Year 2025.');
  if (!/^https:\/\/.+9709_m25_(qp|ms)_12\.pdf$/i.test(row.source_url)) {
    throw new Error('Unexpected or mismatched paper URL: ' + row.source_url);
  }
  if (row.document_type === 'question_paper' && !/_qp_12\.pdf$/i.test(row.source_url)) {
    throw new Error('Question Paper row points to the wrong document.');
  }
  if (row.document_type === 'mark_scheme' && !/_ms_12\.pdf$/i.test(row.source_url)) {
    throw new Error('Mark Scheme row points to the wrong document.');
  }
}

const sourceKey = [
  config.qualification,
  config.syllabus_code,
  config.year,
  config.exam_session,
  config.paper_variant,
].join(':');

return [{
  json: {
    config,
    source_key: sourceKey,
    paper_row: {
      qualification: config.qualification,
      syllabus_code: config.syllabus_code,
      subject: config.subject,
      year: config.year,
      exam_session: config.exam_session,
      paper_variant: config.paper_variant,
    },
    documents: normalizedRows
      .sort((a, b) => a.document_type.localeCompare(b.document_type))
      .map((row) => ({
        document_type: row.document_type,
        source_url: row.source_url,
        expected_page_count: config.expected_page_counts[row.document_type],
      })),
  },
}];
`.trim();

const attachPaperCode = String.raw`
const response = $input.first().json;
const paper = Array.isArray(response) ? response[0] : response;
if (!paper || !paper.id) throw new Error('Supabase did not return the upserted paper row.');
const state = $('Pair and Validate Pilot').first().json;
return [{ json: { ...state, paper_id: paper.id } }];
`.trim();

const createRunBodyCode = String.raw`
const state = $input.first().json;
const executionId = String($execution.id);
return [{
  json: {
    ...state,
    run_body: {
      paper_id: state.paper_id,
      idempotency_key: 'pilot:' + state.source_key + ':execution:' + executionId,
      mode: 'pilot',
      status: 'processing',
      review_status: 'pending',
      source_key: state.source_key,
      ocr_model: state.config.ocr_model,
      extraction_model:
        state.config.extraction_model +
        ' + ' +
        state.config.mark_scheme_extraction_model,
      verifier_model: state.config.verifier_model,
      attempt_count: 1,
      source_summary: {
        google_sheet: state.config.google_sheet_name,
        workflow_execution_id: executionId,
        documents: state.documents,
      },
    },
  },
}];
`.trim();

const expandDocumentsCode = String.raw`
const response = $input.first().json;
const run = Array.isArray(response) ? response[0] : response;
if (!run || !run.id) throw new Error('Supabase did not return the ingestion run.');
const state = $('Prepare Ingestion Run').first().json;
return state.documents.map((document, index) => {
  const mistralRequest = {
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
        schema: BBOX_ANNOTATION_SCHEMA_PLACEHOLDER,
      },
    },
    include_image_base64: true,
    confidence_scores_granularity: 'page',
  };

  return {
    json: {
      config: state.config,
      paper_id: state.paper_id,
      ingestion_run_id: run.id,
      source_key: state.source_key,
      document,
      mistral_request: mistralRequest,
    },
    pairedItem: { item: index },
  };
});
`
  .replace(
    "BBOX_ANNOTATION_SCHEMA_PLACEHOLDER",
    JSON.stringify(bboxAnnotationSchema),
  )
  .trim();

const attachOcrCode = String.raw`
const responses = $input.all();
const sourceItems = $('Expand Pilot Documents').all();
if (responses.length !== sourceItems.length) {
  throw new Error('OCR response count does not match the two pilot documents.');
}
return responses.map((item, index) => {
  const source = sourceItems[index].json;
  const ocr = item.json;
  if (!Array.isArray(ocr.pages)) {
    throw new Error('Mistral OCR did not return a pages array for ' + source.document.document_type);
  }
  if (ocr.pages.length !== source.document.expected_page_count) {
    throw new Error(
      source.document.document_type + ' expected ' +
      source.document.expected_page_count + ' pages but OCR returned ' +
      ocr.pages.length
    );
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

const buildExtractionStateCode = String.raw`
const documents = $input.all().map((item) => item.json);
if (documents.length !== 2) throw new Error('Expected OCR output for exactly two documents.');
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

const knownDocuments = compactDocuments.map((document) => ({
  document_type: document.document_type,
  source_url: document.source_url,
  source_url_hash: null,
  page_count: document.page_count,
  ocr_model: document.ocr_model,
}));

return [{
  json: {
    config: first.config,
    paper_id: first.paper_id,
    ingestion_run_id: first.ingestion_run_id,
    source_key: first.source_key,
    ocr_documents: documents,
    compact_documents: compactDocuments,
    known_documents: knownDocuments,
    ocr_page_rows: pageRows,
  },
}];
`.trim();

const restoreExtractionStateCode = String.raw`
return [{ json: $('Build Extraction State').first().json }];
`.trim();

const buildQuestionPaperRequestCode = String.raw`
const state = $input.first().json;
const questionPaper = state.compact_documents.find(
  (document) => document.document_type === 'question_paper'
);
if (!questionPaper) throw new Error('Question-paper OCR document is missing.');

const prompt = [
  'Extract only the question paper for Cambridge 9709/12 February/March 2025.',
  'Return exactly 11 main questions worth 75 marks in total.',
  'Use the question-paper PDF as the visual source of truth and OCR JSON as a page-indexed aid.',
  'Transcribe every mathematical sign, exponent, radical, limit, coordinate and inequality exactly.',
  'Represent question 4 part (a) as question_number 4 and label_path ["a"].',
  'Never place part labels inside question_number.',
  'Create a part only when a label such as (a), (b) or (i) is visibly printed in the source.',
  'For an unparted question, return parts=[] and put the complete question in stem_markdown.',
  'Never invent a single part (a) merely because the question has one instruction or one mark allocation.',
  'Never repeat the same instruction in both stem_markdown and a part prompt.',
  'Separate shared question text into stem_markdown and part-specific text into parts.',
  'Use 1-based PDF page numbers.',
  'Ignore answer lines, barcodes, copyright footers and DO NOT WRITE IN THIS MARGIN text.',
  'Include only instructional diagrams or tables in assets.',
  'For every asset, use the exact page number and zero-based source_image_index from the OCR JSON.',
  'Do not extract any mark-scheme content in this call.',
].join('\n');

return [{
  json: {
    ...state,
    question_paper_request: {
      model: state.config.extraction_model,
      reasoning: { effort: 'medium' },
      store: false,
      max_output_tokens: 18000,
      input: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Question-paper metadata and OCR JSON:\n' + JSON.stringify({
                qualification: state.config.qualification,
                syllabus_code: state.config.syllabus_code,
                subject: state.config.subject,
                year: state.config.year,
                exam_session: state.config.exam_session,
                paper_variant: state.config.paper_variant,
                document: questionPaper,
              }),
            },
            {
              type: 'input_file',
              file_url: questionPaper.source_url,
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'shamo_question_paper_extraction',
          strict: true,
          schema: QUESTION_PAPER_SCHEMA_PLACEHOLDER,
        },
      },
    },
  },
}];
`
  .replace(
    "QUESTION_PAPER_SCHEMA_PLACEHOLDER",
    JSON.stringify(schemaForOpenAi(questionPaperExtractionSchema)),
  )
  .trim();

const parseQuestionPaperResponseCode = String.raw`
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
if (!outputText || !outputText.text) throw new Error('Question-paper extraction returned no structured text.');
let extracted;
try {
  extracted = JSON.parse(outputText.text);
} catch (error) {
  throw new Error('Could not parse question-paper JSON: ' + error.message);
}
if (!Array.isArray(extracted.questions)) {
  throw new Error('Question-paper extraction has no questions array.');
}

return [{
  json: {
    ...state,
    extraction_response_id: response.id || null,
    question_paper_questions: extracted.questions,
  },
}];
`.trim();

const buildMarkSchemeRequestsCode = String.raw`
const state = $input.first().json;
const markScheme = state.compact_documents.find(
  (document) => document.document_type === 'mark_scheme'
);
if (!markScheme) throw new Error('Mark-scheme OCR document is missing.');

const questionByNumber = new Map(
  state.question_paper_questions.map((question) => [
    question.question_number,
    question,
  ])
);
const pageByNumber = new Map(
  markScheme.pages.map((page) => [page.page_number, page])
);

const prompt = [
  'Extract exactly one question from the official Cambridge mark scheme.',
  'The source is a table with Question, Answer, Marks and Guidance columns.',
  'Return one mark_scheme_item for every visible source row containing Answer, Marks or Guidance information.',
  'Do not combine rows that have different Marks cells or different Guidance cells.',
  'content_markdown must contain only the complete Answer cell or marking step.',
  'guidance_markdown must contain the complete associated Guidance cell without summarising or omitting text.',
  'The Marks column alone determines mark_code. Never copy SCB1, B1 or another award written only inside Guidance into mark_code.',
  'For a guidance-only source row with blank Answer and Marks cells, return content_markdown="", mark_code=null, is_final_answer=false and preserve the complete Guidance cell.',
  'If the source Guidance cell is genuinely blank, return an empty string.',
  'Preserve examiner shorthand exactly, including OE, FT, CWO, AWRT, AG, SC, implied, condone, allow and special-case conditions.',
  'Preserve every sign, factor, bracket, exponent and dependency asterisk exactly.',
  'A missing factor, negative exponent or leading asterisk in a mark code is a blocking mathematical error.',
  'Use semantic angle notation such as \\angle OAB; never turn a printed angle symbol into overbar notation.',
  'Use only the question-paper part paths supplied in the request.',
  'When question_structure.parts is empty, every mark_scheme_item must have part_path=[].',
  'Use 1-based PDF page numbers from the supplied OCR pages.',
  'Number sequence_number from 1 in visible source order for this question.',
  'Mark separate alternative solutions with is_alternative_method=true.',
  'Do not invent guidance that is not visible in the supplied OCR.',
].join('\n');

const outputs = [];
for (
  let questionNumber = 1;
  questionNumber <= state.config.expected_question_count;
  questionNumber++
) {
  const question = questionByNumber.get(questionNumber);
  if (!question) {
    throw new Error('Question ' + questionNumber + ' is missing before mark-scheme extraction.');
  }
  const requestedPages =
    state.config.mark_scheme_question_pages[String(questionNumber)] ||
    state.config.mark_scheme_question_pages[questionNumber];
  if (!Array.isArray(requestedPages) || !requestedPages.length) {
    throw new Error('No mark-scheme page map exists for question ' + questionNumber + '.');
  }
  const pages = requestedPages.map((pageNumber) => {
    const page = pageByNumber.get(pageNumber);
    if (!page) {
      throw new Error(
        'Mark-scheme OCR page ' + pageNumber +
        ' is missing for question ' + questionNumber + '.'
      );
    }
    return page;
  });

  outputs.push({
    json: {
      question_number: questionNumber,
      expected_pages: requestedPages,
      mark_scheme_request: {
        model: state.config.mark_scheme_extraction_model,
        reasoning: { effort: 'medium' },
        store: false,
        max_output_tokens: 6000,
        input: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                  paper: {
                    syllabus_code: state.config.syllabus_code,
                    year: state.config.year,
                    exam_session: state.config.exam_session,
                    paper_variant: state.config.paper_variant,
                  },
                  question_number: questionNumber,
                  question_structure: {
                    stem_markdown: question.stem_markdown,
                    total_marks: question.total_marks,
                    parts: question.parts,
                  },
                  mark_scheme_ocr_pages: pages,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'shamo_mark_scheme_question',
            strict: true,
            schema: MARK_SCHEME_SCHEMA_PLACEHOLDER,
          },
        },
      },
    },
    pairedItem: { item: 0 },
  });
}

return outputs;
`
  .replace(
    "MARK_SCHEME_SCHEMA_PLACEHOLDER",
    JSON.stringify(schemaForOpenAi(markSchemeQuestionSchema)),
  )
  .trim();

const parseMarkSchemeResponsesCode = String.raw`
const responses = $input.all();
const sources = $('Build Mark Scheme Requests').all();
const state = $('Parse Question Paper').first().json;
if (responses.length !== sources.length) {
  throw new Error(
    'Mark-scheme response count ' + responses.length +
    ' does not match request count ' + sources.length + '.'
  );
}

const results = [];
const responseIds = [];
for (let index = 0; index < responses.length; index++) {
  const response = responses[index].json;
  const source = sources[index].json;
  if (response.status === 'incomplete') {
    throw new Error(
      'Mark-scheme extraction for question ' + source.question_number +
      ' was incomplete: ' + JSON.stringify(response.incomplete_details || {})
    );
  }
  const message = (response.output || []).find((entry) => entry.type === 'message');
  if (!message) {
    throw new Error(
      'Mark-scheme extraction returned no message for question ' +
      source.question_number + '.'
    );
  }
  const refusal = (message.content || []).find((entry) => entry.type === 'refusal');
  if (refusal) {
    throw new Error(
      'Mark-scheme extraction refused question ' + source.question_number +
      ': ' + (refusal.refusal || 'unknown refusal')
    );
  }
  const outputText = (message.content || []).find(
    (entry) => entry.type === 'output_text'
  );
  if (!outputText || !outputText.text) {
    throw new Error(
      'Mark-scheme extraction returned no structured text for question ' +
      source.question_number + '.'
    );
  }
  let extracted;
  try {
    extracted = JSON.parse(outputText.text);
  } catch (error) {
    throw new Error(
      'Could not parse mark-scheme JSON for question ' +
      source.question_number + ': ' + error.message
    );
  }
  if (extracted.question_number !== source.question_number) {
    throw new Error(
      'Mark-scheme response expected question ' + source.question_number +
      ' but returned question ' + extracted.question_number + '.'
    );
  }
  const items = (extracted.mark_scheme_items || [])
    .sort((left, right) => left.sequence_number - right.sequence_number)
    .map((item, itemIndex) => ({
      ...item,
      sequence_number: itemIndex + 1,
    }));
  if (!items.length) {
    throw new Error(
      'Question ' + source.question_number + ' has no mark-scheme items.'
    );
  }
  results.push({
    question_number: source.question_number,
    expected_pages: source.expected_pages,
    mark_scheme_items: items,
  });
  responseIds.push(response.id || null);
}

results.sort((left, right) => left.question_number - right.question_number);
return [{
  json: {
    ...state,
    mark_scheme_results: results,
    mark_scheme_response_ids: responseIds,
  },
}];
`.trim();

const mergePaperBundleCode = String.raw`
const state = $input.first().json;
const markSchemeByQuestion = new Map(
  state.mark_scheme_results.map((result) => [
    result.question_number,
    result.mark_scheme_items,
  ])
);

const questions = state.question_paper_questions
  .sort((left, right) => left.question_number - right.question_number)
  .map((question) => {
    const markSchemeItems = markSchemeByQuestion.get(question.question_number);
    if (!markSchemeItems) {
      throw new Error(
        'No mark-scheme result exists for question ' + question.question_number + '.'
      );
    }
    return {
      ...question,
      mark_scheme_items: markSchemeItems,
    };
  });

return [{
  json: {
    ...state,
    paper_bundle: {
      documents: state.known_documents,
      questions,
    },
  },
}];
`.trim();

const deterministicValidationCode = String.raw`
const state = $input.first().json;
const bundle = state.paper_bundle;
const config = state.config;
const issues = [];
const addIssue = (severity, issue_code, message, extra = {}) => {
  issues.push({
    severity,
    issue_code,
    document_type: extra.document_type || null,
    page_number: extra.page_number || null,
    question_number: extra.question_number || null,
    part_path: extra.part_path || [],
    message,
  });
};

if (!bundle || !Array.isArray(bundle.questions)) {
  throw new Error('The extracted paper bundle is missing its questions array.');
}

const numbers = bundle.questions.map((question) => question.question_number);
const uniqueNumbers = new Set(numbers);
if (numbers.length !== config.expected_question_count) {
  addIssue('blocking', 'QUESTION_COUNT_MISMATCH',
    'Expected ' + config.expected_question_count + ' questions but extracted ' + numbers.length + '.');
}
if (uniqueNumbers.size !== numbers.length) {
  addIssue('blocking', 'DUPLICATE_QUESTION_NUMBER', 'Duplicate question numbers were extracted.');
}
for (let number = 1; number <= config.expected_question_count; number++) {
  if (!uniqueNumbers.has(number)) {
    addIssue('blocking', 'MISSING_QUESTION_NUMBER', 'Question ' + number + ' is missing.', {
      question_number: number,
    });
  }
}

const totalMarks = bundle.questions.reduce((sum, question) => sum + Number(question.total_marks || 0), 0);
if (totalMarks !== config.expected_total_marks) {
  addIssue('blocking', 'PAPER_MARK_TOTAL_MISMATCH',
    'Expected ' + config.expected_total_marks + ' marks but extracted ' + totalMarks + '.');
}

const forbiddenPattern = /(DO NOT WRITE IN THIS MARGIN|0000800000|\*{1,2}\d{8,}\*{1,2})/i;
  const imageKeys = new Set();
  const imageDataKeys = new Set();
for (const document of state.ocr_documents) {
  for (const page of document.pages) {
    (page.images || []).forEach((image, imageIndex) => {
      const imageKey = [
        document.document.document_type,
        Number(page.index) + 1,
        imageIndex,
      ].join(':');
      imageKeys.add(imageKey);
      if (image.image_base64) imageDataKeys.add(imageKey);
    });
  }
}

for (const question of bundle.questions) {
  const qn = question.question_number;
  if ((!question.stem_markdown || !question.stem_markdown.trim()) && (!question.parts || question.parts.length === 0)) {
    addIssue('blocking', 'EMPTY_QUESTION_TEXT', 'Question has no stem or parts.', { question_number: qn });
  }
  if (forbiddenPattern.test(question.stem_markdown || '')) {
    addIssue('blocking', 'OCR_ARTIFACT_IN_QUESTION', 'Question text contains a margin or barcode artifact.', {
      question_number: qn,
    });
  }
  const qpPages = question.source_page_numbers || [];
  if (!qpPages.length || qpPages.some((page) => page < 1 || page > config.expected_page_counts.question_paper)) {
    addIssue('blocking', 'INVALID_QUESTION_PAGE', 'Question has an invalid question-paper page reference.', {
      question_number: qn,
    });
  }

  const partPaths = new Set();
  let partMarkTotal = 0;
  for (const part of question.parts || []) {
    const pathKey = part.label_path.join('.');
    if (partPaths.has(pathKey)) {
      addIssue('blocking', 'DUPLICATE_PART_PATH', 'Duplicate part path ' + pathKey + '.', {
        question_number: qn,
        part_path: part.label_path,
      });
    }
    partPaths.add(pathKey);
    partMarkTotal += Number(part.marks || 0);
    if (forbiddenPattern.test(part.prompt_markdown || '')) {
      addIssue('blocking', 'OCR_ARTIFACT_IN_PART', 'Part text contains a margin or barcode artifact.', {
        question_number: qn,
        part_path: part.label_path,
      });
    }
  }
  if ((question.parts || []).length > 0 && partMarkTotal !== Number(question.total_marks)) {
    addIssue('blocking', 'QUESTION_MARK_TOTAL_MISMATCH',
      'Part marks total ' + partMarkTotal + ' but question total_marks is ' + question.total_marks + '.', {
        question_number: qn,
      });
  }

  const markItems = question.mark_scheme_items || [];
  if (!markItems.length) {
    addIssue('blocking', 'MISSING_MARK_SCHEME', 'Question has no mark-scheme items.', {
      question_number: qn,
    });
  }
  const markSequenceNumbers = new Set();
  let primaryMarkCodeCount = 0;
  let nonEmptyGuidanceCount = 0;
  for (const mark of markItems) {
    if (markSequenceNumbers.has(mark.sequence_number)) {
      addIssue('blocking', 'DUPLICATE_MARK_SCHEME_SEQUENCE',
        'Duplicate mark-scheme sequence number ' + mark.sequence_number + '.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    markSequenceNumbers.add(mark.sequence_number);
    const partKey = (mark.part_path || []).join('.');
    if (partKey && !partPaths.has(partKey)) {
      addIssue('blocking', 'MARK_SCHEME_UNKNOWN_PART',
        'Mark-scheme item references missing part ' + partKey + '.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    const pages = mark.source_page_numbers || [];
    if (!pages.length || pages.some((page) => page < 1 || page > config.expected_page_counts.mark_scheme)) {
      addIssue('blocking', 'INVALID_MARK_SCHEME_PAGE',
        'Mark-scheme item has an invalid mark-scheme page reference.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    const hasAnswer =
      typeof mark.content_markdown === 'string' &&
      mark.content_markdown.trim().length > 0;
    const hasGuidance =
      typeof mark.guidance_markdown === 'string' &&
      mark.guidance_markdown.trim().length > 0;
    if (!hasAnswer && !hasGuidance) {
      addIssue('blocking', 'EMPTY_MARK_SCHEME_ROW',
        'Mark-scheme item has neither Answer nor Guidance content.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    if (typeof mark.guidance_markdown !== 'string') {
      addIssue('blocking', 'MISSING_MARK_SCHEME_GUIDANCE_FIELD',
        'Mark-scheme item does not contain guidance_markdown.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    } else if (mark.guidance_markdown.trim()) {
      nonEmptyGuidanceCount++;
    }
    if (!hasAnswer && mark.mark_code !== null) {
      addIssue('blocking', 'GUIDANCE_ONLY_ROW_HAS_MARK_CODE',
        'A guidance-only row must have mark_code=null because its source Marks cell is blank.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    if (!hasAnswer && mark.is_final_answer) {
      addIssue('blocking', 'GUIDANCE_ONLY_ROW_IS_FINAL_ANSWER',
        'A guidance-only row cannot be marked as a final-answer row.', {
          question_number: qn,
          part_path: mark.part_path || [],
        });
    }
    if (!mark.is_alternative_method && mark.mark_code) {
      const codes = String(mark.mark_code).match(/(?:\*?D?M1|A1|B1)/g) || [];
      primaryMarkCodeCount += codes.length;
    }
  }
  if (nonEmptyGuidanceCount === 0) {
    addIssue('blocking', 'QUESTION_MARK_SCHEME_GUIDANCE_EMPTY',
      'No examiner guidance was captured for this question.', {
        question_number: qn,
      });
  }
  if (primaryMarkCodeCount < Number(question.total_marks)) {
    addIssue('blocking', 'MARK_CODE_COVERAGE_TOO_LOW',
      'Primary mark codes account for ' + primaryMarkCodeCount +
      ' marks but the question is worth ' + question.total_marks + '.', {
        question_number: qn,
      });
  }

  for (const asset of question.assets || []) {
    const key = [asset.document_type, asset.source_page_number, asset.source_image_index].join(':');
    if (!imageKeys.has(key)) {
      addIssue('blocking', 'ASSET_SOURCE_NOT_FOUND',
        'Asset does not match an OCR image: ' + key + '.', {
          document_type: asset.document_type,
          page_number: asset.source_page_number,
          question_number: qn,
          part_path: asset.part_path || [],
        });
    } else if (!imageDataKeys.has(key)) {
      addIssue('blocking', 'ASSET_IMAGE_DATA_MISSING',
        'OCR found the asset but did not return its image data: ' + key + '.', {
          document_type: asset.document_type,
          page_number: asset.source_page_number,
          question_number: qn,
          part_path: asset.part_path || [],
        });
    }
  }
}

const blockingCount = issues.filter((issue) => issue.severity === 'blocking').length;
const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
return [{
  json: {
    ...state,
    validation_report: {
      passed: blockingCount === 0,
      expected_question_count: config.expected_question_count,
      actual_question_count: bundle.questions.length,
      expected_total_marks: config.expected_total_marks,
      actual_total_marks: totalMarks,
      blocking_issue_count: blockingCount,
      warning_count: warningCount,
      issues,
    },
  },
}];
`.trim();

const buildVerifierRequestCode = String.raw`
const state = $input.first().json;
const qp = state.paper_bundle.documents.find((document) => document.document_type === 'question_paper');
const ms = state.paper_bundle.documents.find((document) => document.document_type === 'mark_scheme');
const prompt = [
  'Independently verify this extracted Cambridge 9709/12 February/March 2025 paper bundle.',
  'Compare it directly against both PDFs.',
  'Check all 11 questions, all part labels, mathematical expressions, mark allocations, mark-scheme steps, page references, and instructional diagram references.',
  'A question is unparted unless a part label is visibly printed; synthetic single parts and duplicated prompts are blocking issues.',
  'For every mark-scheme row, compare content_markdown with the Answer column and guidance_markdown with the complete Guidance column.',
  'The Marks column alone determines mark_code, including any leading dependency asterisk.',
  'A guidance-only source row with blank Answer and Marks is valid only as content_markdown="", mark_code=null, is_final_answer=false with complete guidance.',
  'Treat any omitted examiner condition, acceptance rule, follow-through restriction, special case, implied-mark rule, sign or exponent as a blocking issue.',
  'A blank guidance_markdown is acceptable only when the corresponding source Guidance cell is blank.',
  'The paper total must be 75 marks.',
  'Do not rewrite or silently correct the bundle. Report every discrepancy as an issue.',
  'Set passed=false if any blocking issue exists.',
].join('\n');

return [{
  json: {
    ...state,
    verifier_request: {
      model: state.config.verifier_model,
      reasoning: { effort: 'high' },
      store: false,
      max_output_tokens: 10000,
      input: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Extracted bundle to verify:\n' + JSON.stringify(state.paper_bundle),
            },
            { type: 'input_file', file_url: qp.source_url },
            { type: 'input_file', file_url: ms.source_url },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'shamo_paper_verification',
          strict: true,
          schema: VERIFIER_SCHEMA_PLACEHOLDER,
        },
      },
    },
  },
}];
`
  .replace(
    "VERIFIER_SCHEMA_PLACEHOLDER",
    JSON.stringify(schemaForOpenAi(verifierSchema)),
  )
  .trim();

const parseVerifierCode = String.raw`
const response = $input.first().json;
const state = $('Build Verifier Request').first().json;
if (response.status === 'incomplete') {
  throw new Error('OpenAI verification was incomplete: ' + JSON.stringify(response.incomplete_details || {}));
}
const message = (response.output || []).find((entry) => entry.type === 'message');
if (!message) throw new Error('OpenAI verifier returned no message output.');
const refusal = (message.content || []).find((entry) => entry.type === 'refusal');
if (refusal) throw new Error('OpenAI verifier refused: ' + (refusal.refusal || 'unknown refusal'));
const outputText = (message.content || []).find((entry) => entry.type === 'output_text');
if (!outputText || !outputText.text) throw new Error('OpenAI verifier returned no structured text.');
let verifierReport;
try {
  verifierReport = JSON.parse(outputText.text);
} catch (error) {
  throw new Error('Could not parse verifier JSON: ' + error.message);
}
if ((verifierReport.issues || []).some((issue) => issue.severity === 'blocking')) {
  verifierReport.passed = false;
}
return [{
  json: {
    ...state,
    verifier_response_id: response.id || null,
    verifier_report: verifierReport,
  },
}];
`.trim();

const buildRepairRequestCode = String.raw`
const state = $input.first().json;
const blockingIssues = [
  ...(state.validation_report?.issues || []),
  ...(state.verifier_report?.issues || []),
].filter((issue) => issue.severity === 'blocking');

const initialState = {
  ...state,
  initial_validation_report: state.validation_report,
  initial_verifier_report: state.verifier_report,
  initial_verifier_response_id: state.verifier_response_id || null,
};

if (!blockingIssues.length) {
  return [{
    json: {
      ...initialState,
      repair_needed: false,
      repair_question_numbers: [],
      repair_response_id: null,
    },
  }];
}

const allQuestionNumbers = state.paper_bundle.questions.map(
  (question) => question.question_number
);
const issueQuestionNumbers = blockingIssues
  .map((issue) => issue.question_number)
  .filter((value) => Number.isInteger(value));
const repairQuestionNumbers =
  issueQuestionNumbers.length === blockingIssues.length
    ? [...new Set(issueQuestionNumbers)].sort((a, b) => a - b)
    : allQuestionNumbers;

const qp = state.paper_bundle.documents.find(
  (document) => document.document_type === 'question_paper'
);
const ms = state.paper_bundle.documents.find(
  (document) => document.document_type === 'mark_scheme'
);
const affectedQuestions = state.paper_bundle.questions.filter(
  (question) => repairQuestionNumbers.includes(question.question_number)
);

const prompt = [
  'Repair only the listed questions in an extracted Cambridge past-paper bundle.',
  'Use both official PDFs as the source of truth and independently confirm every reported issue.',
  'Return exactly one complete corrected question for every requested question number and no other questions.',
  'Do not remove correct mark-scheme rows, alternatives, examiner guidance, page references or instructional assets.',
  'A part exists only if its label is visibly printed. For an unparted question use parts=[] and mark-scheme part_path=[].',
  'Never repeat an unparted instruction in both stem_markdown and a synthetic part.',
  'The Marks column alone determines mark_code. Preserve leading dependency asterisks exactly.',
  'For a source row with blank Answer and Marks but non-empty Guidance, use content_markdown="", mark_code=null and is_final_answer=false.',
  'Preserve every factor, sign, bracket, exponent, angle symbol and examiner condition.',
  'Use semantic LaTeX such as \\angle OAB for an angle; never use an overbar for a printed angle symbol.',
  'Correct the data, not the issue report. Do not merely copy suggested wording without checking the PDFs.',
].join('\n');

return [{
  json: {
    ...initialState,
    repair_needed: true,
    repair_question_numbers: repairQuestionNumbers,
    repair_request: {
      model: state.config.verifier_model,
      reasoning: { effort: 'high' },
      store: false,
      max_output_tokens: 30000,
      input: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify({
                requested_question_numbers: repairQuestionNumbers,
                blocking_issues: blockingIssues,
                questions_to_repair: affectedQuestions,
              }),
            },
            { type: 'input_file', file_url: qp.source_url },
            { type: 'input_file', file_url: ms.source_url },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'shamo_targeted_question_repairs',
          strict: true,
          schema: REPAIR_SCHEMA_PLACEHOLDER,
        },
      },
    },
  },
}];
`
  .replace(
    "REPAIR_SCHEMA_PLACEHOLDER",
    JSON.stringify(schemaForOpenAi(repairSchema)),
  )
  .trim();

const parseRepairCode = String.raw`
const response = $input.first().json;
const state = $('Build Targeted Repair Request').first().json;
if (response.status === 'incomplete') {
  throw new Error('OpenAI repair was incomplete: ' + JSON.stringify(response.incomplete_details || {}));
}
const message = (response.output || []).find((entry) => entry.type === 'message');
if (!message) throw new Error('OpenAI repair returned no message output.');
const refusal = (message.content || []).find((entry) => entry.type === 'refusal');
if (refusal) throw new Error('OpenAI repair refused: ' + (refusal.refusal || 'unknown refusal'));
const outputText = (message.content || []).find((entry) => entry.type === 'output_text');
if (!outputText || !outputText.text) throw new Error('OpenAI repair returned no structured text.');

let repaired;
try {
  repaired = JSON.parse(outputText.text);
} catch (error) {
  throw new Error('Could not parse repair JSON: ' + error.message);
}

const correctedQuestions = repaired.corrected_questions || [];
const expectedNumbers = state.repair_question_numbers;
const actualNumbers = correctedQuestions.map(
  (question) => question.question_number
);
if (actualNumbers.length !== expectedNumbers.length) {
  throw new Error(
    'Repair returned ' + actualNumbers.length +
    ' questions but expected ' + expectedNumbers.length + '.'
  );
}
if (new Set(actualNumbers).size !== actualNumbers.length) {
  throw new Error('Repair returned duplicate question numbers.');
}
for (const expectedNumber of expectedNumbers) {
  if (!actualNumbers.includes(expectedNumber)) {
    throw new Error('Repair omitted question ' + expectedNumber + '.');
  }
}
for (const actualNumber of actualNumbers) {
  if (!expectedNumbers.includes(actualNumber)) {
    throw new Error('Repair unexpectedly returned question ' + actualNumber + '.');
  }
}

const originalByNumber = new Map(
  state.paper_bundle.questions.map((question) => [
    question.question_number,
    question,
  ])
);
const correctedByNumber = new Map(
  correctedQuestions.map((question) => [
    question.question_number,
    question,
  ])
);
const mergedQuestions = state.paper_bundle.questions.map((question) => {
  const corrected = correctedByNumber.get(question.question_number);
  if (!corrected) return question;
  return {
    ...corrected,
    assets: originalByNumber.get(question.question_number).assets || [],
  };
});

return [{
  json: {
    ...state,
    paper_bundle: {
      ...state.paper_bundle,
      questions: mergedQuestions,
    },
    repair_applied: true,
    repair_response_id: response.id || null,
  },
}];
`.trim();

const useOriginalVerifiedBundleCode = String.raw`
return [{
  json: {
    ...$input.first().json,
    repair_applied: false,
  },
}];
`.trim();

const parseFinalVerifierCode = parseVerifierCode.replace(
  "$('Build Verifier Request').first().json",
  "$('Build Final Verifier Request').first().json",
);

const selectFinalValidationStateCode = String.raw`
return [{ json: $input.first().json }];
`.trim();

const prepareAssetsCode = String.raw`
const state = $input.first().json;
const imageMap = new Map();
for (const document of state.ocr_documents) {
  for (const page of document.pages) {
    (page.images || []).forEach((image, imageIndex) => {
      imageMap.set([
        document.document.document_type,
        Number(page.index) + 1,
        imageIndex,
      ].join(':'), image);
    });
  }
}

const output = [];
state.paper_bundle.questions.forEach((question, questionIndex) => {
  (question.assets || []).forEach((asset, assetIndex) => {
    const key = [asset.document_type, asset.source_page_number, asset.source_image_index].join(':');
    const image = imageMap.get(key);
    if (!image || !image.image_base64) return;
    const match = String(image.image_base64).match(/^data:(image\/[A-Za-z0-9.+-]+);base64,(.+)$/s);
    const mimeType = match ? match[1] : 'image/png';
    const base64 = match ? match[2] : String(image.image_base64);
    const extension = mimeType.includes('jpeg') ? 'jpg' : mimeType.split('/')[1].replace('+xml', '') || 'png';
    const partSuffix = (asset.part_path || []).length ? '-part-' + asset.part_path.join('-') : '';
    const storagePath = [
      state.config.qualification,
      state.config.syllabus_code,
      state.config.year,
      state.config.exam_session,
      state.config.paper_variant,
      asset.document_type,
      'q' + question.question_number + partSuffix,
      'page-' + asset.source_page_number + '-image-' + asset.source_image_index + '.' + extension,
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

if (!output.length) {
  return [{ json: { skip_upload: true } }];
}
return output;
`.trim();

const collectUploadsCode = String.raw`
const prepared = $('Prepare Asset Uploads').all().filter((item) => !item.json.skip_upload);
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
const state = $('Select Final Validation State').first().json;
const branch = $input.first().json;
const uploaded = branch.uploaded_assets || [];
const bundle = JSON.parse(JSON.stringify(state.paper_bundle));
const extractedAssetCount = bundle.questions.reduce(
  (sum, question) => sum + (question.assets || []).length,
  0
);

for (const uploadedAsset of uploaded) {
  const asset = bundle.questions[uploadedAsset.question_index].assets[uploadedAsset.asset_index];
  asset.storage_bucket = uploadedAsset.storage_bucket;
  asset.storage_path = uploadedAsset.storage_path;
  asset.mime_type = uploadedAsset.mime_type;
  asset.byte_size = uploadedAsset.byte_size || null;
  asset.checksum = uploadedAsset.checksum || null;
}

for (const question of bundle.questions) {
  question.assets = (question.assets || []).filter((asset) => asset.storage_path);
}

const combinedIssues = [
  ...(state.validation_report.issues || []),
  ...(state.verifier_report.issues || []),
];
if (uploaded.length !== extractedAssetCount) {
  combinedIssues.push({
    severity: 'blocking',
    issue_code: 'ASSET_UPLOAD_COUNT_MISMATCH',
    document_type: null,
    page_number: null,
    question_number: null,
    part_path: [],
    message:
      'Extracted ' + extractedAssetCount + ' instructional assets but uploaded ' +
      uploaded.length + '.',
  });
}
const seen = new Set();
const uniqueIssues = combinedIssues.filter((issue) => {
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

const questionPartCount = bundle.questions.reduce(
  (sum, question) => sum + (question.parts || []).length,
  0
);
const assetCount = bundle.questions.reduce(
  (sum, question) => sum + (question.assets || []).length,
  0
);
const readyForApproval =
  state.validation_report.passed === true &&
  state.verifier_report.passed === true &&
  !uniqueIssues.some((issue) => issue.severity === 'blocking');

const summary = {
  questions: bundle.questions.length,
  parts: questionPartCount,
  assets: assetCount,
  issues: issueRows.length,
  blocking_issues: issueRows.filter((issue) => issue.severity === 'blocking').length,
};

const updateBody = {
  status: 'awaiting_review',
  review_status: 'pending',
  extraction_summary: {
    paper_bundle: bundle,
    extraction_response_id: state.extraction_response_id,
    mark_scheme_response_ids: state.mark_scheme_response_ids,
    initial_verifier_response_id: state.initial_verifier_response_id || null,
    repair_response_id: state.repair_response_id || null,
    verifier_response_id: state.verifier_response_id,
    ready_for_approval: readyForApproval,
    staged_at: new Date().toISOString(),
    summary,
  },
  verifier_report: state.verifier_report,
  validation_report: state.validation_report,
  question_count: bundle.questions.length,
  question_part_count: questionPartCount,
  asset_count: assetCount,
  finished_at: new Date().toISOString(),
};

return [{
  json: {
    config: state.config,
    paper_id: state.paper_id,
    ingestion_run_id: state.ingestion_run_id,
    paper_bundle: bundle,
    issue_rows: issueRows,
    update_body: updateBody,
    ready_for_approval: readyForApproval,
    summary,
  },
}];
`.trim();

const restoreFinalStateCode = String.raw`
return [{ json: $('Finalize Staging Package').first().json }];
`.trim();

const finalStageOutputCode = String.raw`
const state = $('Restore Final Stage State').first().json;
return [{
  json: {
    success: true,
    message: state.ready_for_approval
      ? 'Pilot extraction is staged and ready for your manual review.'
      : 'Pilot extraction is staged, but blocking issues must be reviewed before publication.',
    ingestion_run_id: state.ingestion_run_id,
    paper_id: state.paper_id,
    ready_for_approval: state.ready_for_approval,
    summary: state.summary,
    next_step: 'Inspect this execution output and Supabase shamo_ingestion_review_queue. If correct, run the separate Shamo Pilot v4 - Atomic Approve and Publish workflow with this ingestion_run_id.',
  },
}];
`.trim();

const publishConfigCode = String.raw`
const config = {
  supabase_url: 'https://YOUR_PROJECT_REF.supabase.co',
  ingestion_run_id: 'PASTE_INGESTION_RUN_ID_HERE',
};
if (config.supabase_url.includes('YOUR_PROJECT_REF')) {
  throw new Error('Replace YOUR_PROJECT_REF with your Supabase project reference.');
}
if (config.ingestion_run_id === 'PASTE_INGESTION_RUN_ID_HERE') {
  throw new Error('Paste the staged ingestion_run_id into this node before running.');
}
return [{ json: config }];
`.trim();

const inspectPublishRunCode = String.raw`
const response = $input.first().json;
const run = Array.isArray(response) ? response[0] : response;
if (!run || !run.id) throw new Error('Ingestion run was not found.');
const awaitingApproval =
  run.status === 'awaiting_review' &&
  run.review_status === 'pending';
const recoveringFailedPublication =
  run.status === 'approved' &&
  run.review_status === 'approved';
if (!awaitingApproval && !recoveringFailedPublication) {
  throw new Error(
    'Run must be awaiting review or recovering an approved publication failure, but it is ' +
    run.status + '/' + run.review_status + '.'
  );
}
if (run.validation_report?.passed !== true) {
  throw new Error('Deterministic validation did not pass.');
}
if (run.verifier_report?.passed !== true) {
  throw new Error('Independent model verification did not pass.');
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

const checkBlockingIssuesCode = String.raw`
const issues = $input.first().json;
const state = $('Inspect Staged Run').first().json;
const rows = Array.isArray(issues) ? issues : [];
if (rows.length > 0) {
  throw new Error('Publication blocked: ' + rows.length + ' unresolved blocking issue(s) remain.');
}
return [{
  json: state,
}];
`.trim();

const clearBundleCode = String.raw`
const publication = $input.first().json;
const state = $('Check Blocking Issues').first().json;
return [{
  json: {
    publication,
    ingestion_run_id: state.run.id,
    cleanup_body: {
      extraction_summary: {
        ready_for_approval: true,
        published: true,
        published_at: new Date().toISOString(),
        publication_result: publication,
      },
    },
  },
}];
`.trim();

const finalPublishOutputCode = String.raw`
const state = $('Prepare Staging Cleanup').first().json;
return [{
  json: {
    success: true,
    message: 'Pilot paper was published successfully.',
    ingestion_run_id: state.ingestion_run_id,
    publication: state.publication,
    next_step: 'Inspect shamo_published_question_overview and test shamo_get_question_context before generating embeddings.',
  },
}];
`.trim();

function codeNode(name, code, position) {
  return {
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: code,
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

function supabaseRequest(name, method, url, jsonBody, position, extraHeaders = [], responseFormat = "json") {
  const parameters = {
    method,
    url,
    authentication: "predefinedCredentialType",
    nodeCredentialType: "supabaseApi",
    sendHeaders: true,
    headerParameters: {
      parameters: extraHeaders,
    },
    options: {
      response: {
        response: {
          responseFormat,
        },
      },
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
    credentials: {
      supabaseApi: credentials.supabaseApi,
    },
  };
}

function openAiRequest(name, jsonBody, position) {
  return {
    parameters: {
      method: "POST",
      url: "https://api.openai.com/v1/responses",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "openAiApi",
      sendBody: true,
      specifyBody: "json",
      jsonBody,
      options: {
        response: {
          response: {
            responseFormat: "json",
          },
        },
        timeout: 600000,
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position,
    id: idFor(name),
    name,
    credentials: {
      openAiApi: credentials.openAiApi,
    },
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

function stickyNote(name, content, position, size = [420, 260]) {
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

function connect(connections, source, target, sourceOutput = 0, targetInput = 0) {
  if (!connections[source]) connections[source] = { main: [] };
  while (connections[source].main.length <= sourceOutput) connections[source].main.push([]);
  connections[source].main[sourceOutput].push({
    node: target,
    type: "main",
    index: targetInput,
  });
}

const stageNodes = [
  stickyNote(
    "Before running",
    "## Before running\n1. Run both v2 SQL patches in Supabase, including `shamo_v2_guidance_only_rows_patch.sql`.\n2. Edit **Pilot Configuration** with your Supabase project URL.\n3. Open **Get Test Rows** and select the `Test` sheet.\n4. Confirm the Supabase credential contains a **secret/service_role** key.\n5. Select a Mistral HTTP Header Auth credential on **Mistral OCR**.\n6. Keep this workflow manual during the pilot.",
    [-840, -520],
    [520, 340],
  ),
  manualTrigger("Run Pilot Manually", [-760, 0]),
  codeNode("Pilot Configuration", configurationCode, [-540, 0]),
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
        value: "Test",
        mode: "list",
        cachedResultName: "Test",
      },
      options: {},
    },
    type: "n8n-nodes-base.googleSheets",
    typeVersion: 4.7,
    position: [-320, 0],
    id: idFor("Get Test Rows"),
    name: "Get Test Rows",
    credentials: {
      googleSheetsOAuth2Api: credentials.googleSheetsOAuth2Api,
    },
  },
  codeNode("Pair and Validate Pilot", pairAndValidateCode, [-80, 0]),
  supabaseRequest(
    "Upsert Paper",
    "POST",
    "={{ $('Pilot Configuration').first().json.supabase_url + '/rest/v1/shamo_papers?on_conflict=qualification,syllabus_code,year,exam_session,paper_variant&select=*' }}",
    "={{ $json.paper_row }}",
    [160, 0],
    [{ name: "Prefer", value: "resolution=merge-duplicates,return=representation" }],
  ),
  codeNode("Attach Paper ID", attachPaperCode, [400, 0]),
  codeNode("Prepare Ingestion Run", createRunBodyCode, [640, 0]),
  supabaseRequest(
    "Create Ingestion Run",
    "POST",
    "={{ $('Pilot Configuration').first().json.supabase_url + '/rest/v1/shamo_ingestion_runs?on_conflict=idempotency_key&select=*' }}",
    "={{ $json.run_body }}",
    [880, 0],
    [{ name: "Prefer", value: "resolution=merge-duplicates,return=representation" }],
  ),
  codeNode("Expand Pilot Documents", expandDocumentsCode, [1120, 0]),
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
        response: {
          response: {
            responseFormat: "json",
          },
        },
        timeout: 600000,
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [1360, 0],
    id: idFor("Mistral OCR"),
    name: "Mistral OCR",
  },
  codeNode("Attach OCR Metadata", attachOcrCode, [1600, 0]),
  codeNode("Build Extraction State", buildExtractionStateCode, [1840, 0]),
  supabaseRequest(
    "Store Temporary OCR Pages",
    "POST",
    "={{ $('Pilot Configuration').first().json.supabase_url + '/rest/v1/shamo_ingestion_pages?on_conflict=ingestion_run_id,document_type,page_number' }}",
    "={{ $json.ocr_page_rows }}",
    [2080, 0],
    [{ name: "Prefer", value: "resolution=merge-duplicates,return=minimal" }],
    "text",
  ),
  codeNode("Restore Extraction State", restoreExtractionStateCode, [2320, 0]),
  codeNode(
    "Build Question Paper Request",
    buildQuestionPaperRequestCode,
    [2560, 0],
  ),
  openAiRequest(
    "OpenAI Question Paper Extraction",
    "={{ $json.question_paper_request }}",
    [2800, 0],
  ),
  codeNode("Parse Question Paper", parseQuestionPaperResponseCode, [3040, 0]),
  codeNode(
    "Build Mark Scheme Requests",
    buildMarkSchemeRequestsCode,
    [3280, 0],
  ),
  openAiRequest(
    "OpenAI Mark Scheme Questions",
    "={{ $json.mark_scheme_request }}",
    [3520, 0],
  ),
  codeNode(
    "Parse Mark Scheme Responses",
    parseMarkSchemeResponsesCode,
    [3760, 0],
  ),
  codeNode("Merge Paper Bundle", mergePaperBundleCode, [4000, 0]),
  codeNode("Deterministic Validation", deterministicValidationCode, [4240, 0]),
  codeNode("Build Verifier Request", buildVerifierRequestCode, [4480, 0]),
  openAiRequest(
    "OpenAI Independent Verifier",
    "={{ $json.verifier_request }}",
    [4720, 0],
  ),
  codeNode("Parse Verifier Result", parseVerifierCode, [4960, 0]),
  codeNode(
    "Build Targeted Repair Request",
    buildRepairRequestCode,
    [5200, 0],
  ),
  ifNode("Repair Needed", "={{ $json.repair_needed }}", [5440, 0]),
  openAiRequest(
    "OpenAI Targeted Question Repair",
    "={{ $json.repair_request }}",
    [5680, -160],
  ),
  codeNode("Parse Targeted Repair", parseRepairCode, [5920, -160]),
  codeNode(
    "Deterministic Validation After Repair",
    deterministicValidationCode,
    [6160, -160],
  ),
  codeNode(
    "Build Final Verifier Request",
    buildVerifierRequestCode,
    [6400, -160],
  ),
  openAiRequest(
    "OpenAI Final Independent Verifier",
    "={{ $json.verifier_request }}",
    [6640, -160],
  ),
  codeNode(
    "Parse Final Verifier Result",
    parseFinalVerifierCode,
    [6880, -160],
  ),
  codeNode(
    "Use Original Verified Bundle",
    useOriginalVerifiedBundleCode,
    [5680, 160],
  ),
  codeNode(
    "Select Final Validation State",
    selectFinalValidationStateCode,
    [7120, 0],
  ),
  codeNode("Prepare Asset Uploads", prepareAssetsCode, [7360, 0]),
  ifNode("Has Assets to Upload", "={{ !$json.skip_upload }}", [7600, 0]),
  {
    parameters: {
      method: "POST",
      url: "={{ $('Pilot Configuration').first().json.supabase_url + '/storage/v1/object/' + $json.storage_bucket + '/' + $json.storage_path }}",
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
      options: {
        response: {
          response: {
            responseFormat: "json",
          },
        },
      },
    },
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.4,
    position: [7840, -120],
    id: idFor("Upload Assets to Supabase Storage"),
    name: "Upload Assets to Supabase Storage",
    credentials: {
      supabaseApi: credentials.supabaseApi,
    },
  },
  codeNode("Collect Upload Results", collectUploadsCode, [8080, -120]),
  codeNode("No Asset Uploads", noUploadsCode, [7840, 140]),
  codeNode("Finalize Staging Package", finalizeStagingCode, [8320, 0]),
  supabaseRequest(
    "Update Staged Ingestion Run",
    "PATCH",
    "={{ $('Pilot Configuration').first().json.supabase_url + '/rest/v1/shamo_ingestion_runs?id=eq.' + $json.ingestion_run_id + '&select=*' }}",
    "={{ $json.update_body }}",
    [8560, 0],
    [{ name: "Prefer", value: "return=representation" }],
  ),
  codeNode("Restore Final Stage State", restoreFinalStateCode, [8800, 0]),
  ifNode("Has Validation Issues", "={{ $json.issue_rows.length > 0 }}", [9040, 0]),
  supabaseRequest(
    "Store Validation Issues",
    "POST",
    "={{ $('Pilot Configuration').first().json.supabase_url + '/rest/v1/shamo_ingestion_issues' }}",
    "={{ $json.issue_rows }}",
    [9280, -120],
    [{ name: "Prefer", value: "return=minimal" }],
    "text",
  ),
  codeNode("Pilot Stage Result", finalStageOutputCode, [9520, 0]),
];

const stageConnections = {};
connect(stageConnections, "Run Pilot Manually", "Pilot Configuration");
connect(stageConnections, "Pilot Configuration", "Get Test Rows");
connect(stageConnections, "Get Test Rows", "Pair and Validate Pilot");
connect(stageConnections, "Pair and Validate Pilot", "Upsert Paper");
connect(stageConnections, "Upsert Paper", "Attach Paper ID");
connect(stageConnections, "Attach Paper ID", "Prepare Ingestion Run");
connect(stageConnections, "Prepare Ingestion Run", "Create Ingestion Run");
connect(stageConnections, "Create Ingestion Run", "Expand Pilot Documents");
connect(stageConnections, "Expand Pilot Documents", "Mistral OCR");
connect(stageConnections, "Mistral OCR", "Attach OCR Metadata");
connect(stageConnections, "Attach OCR Metadata", "Build Extraction State");
connect(stageConnections, "Build Extraction State", "Store Temporary OCR Pages");
connect(stageConnections, "Store Temporary OCR Pages", "Restore Extraction State");
connect(stageConnections, "Restore Extraction State", "Build Question Paper Request");
connect(stageConnections, "Build Question Paper Request", "OpenAI Question Paper Extraction");
connect(stageConnections, "OpenAI Question Paper Extraction", "Parse Question Paper");
connect(stageConnections, "Parse Question Paper", "Build Mark Scheme Requests");
connect(stageConnections, "Build Mark Scheme Requests", "OpenAI Mark Scheme Questions");
connect(stageConnections, "OpenAI Mark Scheme Questions", "Parse Mark Scheme Responses");
connect(stageConnections, "Parse Mark Scheme Responses", "Merge Paper Bundle");
connect(stageConnections, "Merge Paper Bundle", "Deterministic Validation");
connect(stageConnections, "Deterministic Validation", "Build Verifier Request");
connect(stageConnections, "Build Verifier Request", "OpenAI Independent Verifier");
connect(stageConnections, "OpenAI Independent Verifier", "Parse Verifier Result");
connect(stageConnections, "Parse Verifier Result", "Build Targeted Repair Request");
connect(stageConnections, "Build Targeted Repair Request", "Repair Needed");
connect(stageConnections, "Repair Needed", "OpenAI Targeted Question Repair", 0);
connect(stageConnections, "OpenAI Targeted Question Repair", "Parse Targeted Repair");
connect(stageConnections, "Parse Targeted Repair", "Deterministic Validation After Repair");
connect(stageConnections, "Deterministic Validation After Repair", "Build Final Verifier Request");
connect(stageConnections, "Build Final Verifier Request", "OpenAI Final Independent Verifier");
connect(stageConnections, "OpenAI Final Independent Verifier", "Parse Final Verifier Result");
connect(stageConnections, "Parse Final Verifier Result", "Select Final Validation State");
connect(stageConnections, "Repair Needed", "Use Original Verified Bundle", 1);
connect(stageConnections, "Use Original Verified Bundle", "Select Final Validation State");
connect(stageConnections, "Select Final Validation State", "Prepare Asset Uploads");
connect(stageConnections, "Prepare Asset Uploads", "Has Assets to Upload");
connect(stageConnections, "Has Assets to Upload", "Upload Assets to Supabase Storage", 0);
connect(stageConnections, "Upload Assets to Supabase Storage", "Collect Upload Results");
connect(stageConnections, "Collect Upload Results", "Finalize Staging Package");
connect(stageConnections, "Has Assets to Upload", "No Asset Uploads", 1);
connect(stageConnections, "No Asset Uploads", "Finalize Staging Package");
connect(stageConnections, "Finalize Staging Package", "Update Staged Ingestion Run");
connect(stageConnections, "Update Staged Ingestion Run", "Restore Final Stage State");
connect(stageConnections, "Restore Final Stage State", "Has Validation Issues");
connect(stageConnections, "Has Validation Issues", "Store Validation Issues", 0);
connect(stageConnections, "Store Validation Issues", "Pilot Stage Result");
connect(stageConnections, "Has Validation Issues", "Pilot Stage Result", 1);

const stageWorkflow = {
  name: "Shamo Pilot v3 - Extract Repair Verify and Stage 9709 M25 Paper 12",
  nodes: stageNodes,
  pinData: {},
  connections: stageConnections,
  active: false,
  settings: {
    executionOrder: "v1",
    saveManualExecutions: true,
    saveDataErrorExecution: "all",
    saveDataSuccessExecution: "all",
  },
  versionId: idFor("stage-workflow-version"),
  meta: {
    templateCredsSetupCompleted: false,
  },
  tags: [],
};

const publishNodes = [
  stickyNote(
    "Publish safety note",
    "## Explicit approval workflow\nOnly run this after manually reviewing the staged extraction.\n\n1. Paste the `ingestion_run_id` into **Publish Configuration**.\n2. Confirm the review queue has no unresolved blocking issues.\n3. Clicking Execute is the human approval action.",
    [-760, -480],
    [500, 300],
  ),
  manualTrigger("Approve and Publish Manually", [-680, 0]),
  codeNode("Publish Configuration", publishConfigCode, [-440, 0]),
  supabaseRequest(
    "Load Staged Ingestion Run",
    "GET",
    "={{ $json.supabase_url + '/rest/v1/shamo_ingestion_runs?id=eq.' + $json.ingestion_run_id + '&select=*' }}",
    undefined,
    [-200, 0],
  ),
  codeNode("Inspect Staged Run", inspectPublishRunCode, [40, 0]),
  supabaseRequest(
    "Load Open Blocking Issues",
    "GET",
    "={{ $json.config.supabase_url + '/rest/v1/shamo_ingestion_issues?ingestion_run_id=eq.' + $json.run.id + '&severity=eq.blocking&resolved=eq.false&select=id,issue_code,message' }}",
    undefined,
    [280, 0],
  ),
  codeNode("Check Blocking Issues", checkBlockingIssuesCode, [520, 0]),
  supabaseRequest(
    "Publish Paper Bundle",
    "POST",
    "={{ $json.config.supabase_url + '/rest/v1/rpc/shamo_publish_paper_bundle_v2' }}",
    "={{ ({ requested_ingestion_run_id: $json.run.id, paper_bundle: $json.paper_bundle }) }}",
    [760, 0],
  ),
  codeNode("Prepare Staging Cleanup", clearBundleCode, [1000, 0]),
  supabaseRequest(
    "Clear Temporary Staged Bundle",
    "PATCH",
    "={{ $('Publish Configuration').first().json.supabase_url + '/rest/v1/shamo_ingestion_runs?id=eq.' + $json.ingestion_run_id }}",
    "={{ $json.cleanup_body }}",
    [1240, 0],
    [{ name: "Prefer", value: "return=minimal" }],
    "text",
  ),
  codeNode("Pilot Publication Result", finalPublishOutputCode, [1480, 0]),
];

const publishConnections = {};
connect(publishConnections, "Approve and Publish Manually", "Publish Configuration");
connect(publishConnections, "Publish Configuration", "Load Staged Ingestion Run");
connect(publishConnections, "Load Staged Ingestion Run", "Inspect Staged Run");
connect(publishConnections, "Inspect Staged Run", "Load Open Blocking Issues");
connect(publishConnections, "Load Open Blocking Issues", "Check Blocking Issues");
connect(publishConnections, "Check Blocking Issues", "Publish Paper Bundle");
connect(publishConnections, "Publish Paper Bundle", "Prepare Staging Cleanup");
connect(publishConnections, "Prepare Staging Cleanup", "Clear Temporary Staged Bundle");
connect(publishConnections, "Clear Temporary Staged Bundle", "Pilot Publication Result");

const publishWorkflow = {
  name: "Shamo Pilot v4 - Atomic Approve and Publish",
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
  versionId: idFor("publish-workflow-version"),
  meta: {
    templateCredsSetupCompleted: false,
  },
  tags: [],
};

const pilotInput = {
  source_workbook:
    "C:\\Users\\sheli\\Downloads\\Past paper data - Alevel Maths (final) (2).xlsx",
  source_sheet: "Test",
  qualification: "a_level",
  syllabus_code: "9709",
  subject: "Mathematics",
  year: 2025,
  exam_session: "feb_march",
  paper_variant: "12",
  expected_question_count: 11,
  expected_total_marks: 75,
  documents: [
    {
      document_type: "question_paper",
      source_url:
        "https://pastpapers.papacambridge.com/directories/CAIE/CAIE-pastpapers/upload/9709_m25_qp_12.pdf",
      expected_page_count: 16,
    },
    {
      document_type: "mark_scheme",
      source_url:
        "https://pastpapers.papacambridge.com/directories/CAIE/CAIE-pastpapers/upload/9709_m25_ms_12.pdf",
      expected_page_count: 22,
    },
  ],
};

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(
    path.join(outputDir, "shamo_paper_bundle.schema.json"),
    JSON.stringify(paperBundleSchema, null, 2) + "\n",
  ),
  fs.writeFile(
    path.join(outputDir, "shamo_pilot_input.json"),
    JSON.stringify(pilotInput, null, 2) + "\n",
  ),
  fs.writeFile(
    path.join(outputDir, "shamo_pilot_extract_and_stage.json"),
    JSON.stringify(stageWorkflow, null, 2) + "\n",
  ),
  fs.writeFile(
    path.join(outputDir, "shamo_pilot_approve_and_publish.json"),
    JSON.stringify(publishWorkflow, null, 2) + "\n",
  ),
]);

console.log(
  JSON.stringify(
    {
      outputDir,
      stageNodes: stageWorkflow.nodes.length,
      publishNodes: publishWorkflow.nodes.length,
    },
    null,
    2,
  ),
);
