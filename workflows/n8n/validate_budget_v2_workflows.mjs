import fs from "node:fs";
import { inlineModule } from "./lib/inline_module.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) =>
  JSON.parse(fs.readFileSync(path.join(here, name), "utf8"));
const child = load("shamo_budget_v2_1_stage_one_math_paper.json");
const controller = load("shamo_budget_v2_1_test2_six_paper_controller.json");
const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const validateWorkflow = (workflow, label) => {
  const names = new Set(workflow.nodes.map((node) => node.name));
  check(names.size === workflow.nodes.length, `${label}: node names are not unique`);
  for (const node of workflow.nodes) {
    if (node.type === "n8n-nodes-base.code") {
      try {
        new Function(node.parameters.jsCode);
      } catch (error) {
        failures.push(`${label}: ${node.name} has invalid JavaScript: ${error.message}`);
      }
      for (const match of node.parameters.jsCode.matchAll(/\$\('([^']+)'\)/g)) {
        check(
          names.has(match[1]),
          `${label}: ${node.name} refers to missing node ${match[1]}`
        );
      }
    }
  }
  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    check(names.has(source), `${label}: connection source is missing: ${source}`);
    for (const branch of outputs.main || []) {
      for (const connection of branch || []) {
        check(
          names.has(connection.node),
          `${label}: connection target is missing: ${connection.node}`
        );
      }
    }
  }
};

validateWorkflow(child, "child");
validateWorkflow(controller, "controller");

const childNames = new Set(child.nodes.map((node) => node.name));
for (const required of [
  "OpenAI Question Paper",
  "OpenAI Mark Scheme Page Map",
  "OpenAI Mark Scheme Questions",
  "OpenAI Question Metadata",
  "OpenAI Targeted Repair",
  "Deterministic Validation Before Repair",
  "Deterministic Validation",
  "Parse Mark Scheme Tables",
  "Mark Scheme Fallback Needed",
]) {
  check(childNames.has(required), `child: missing ${required}`);
}

const validationCode = child.nodes.find(
  (node) => node.name === "Deterministic Validation"
)?.parameters.jsCode;
const parseMarkSchemeCode = child.nodes.find(
  (node) => node.name === "Parse Mark Scheme Responses"
)?.parameters.jsCode;
const serializedChild = JSON.stringify(child);
check(
  serializedChild.includes(
    "verify that every subscript and stated range uses the matching variable"
  ),
  "child: mark-scheme variable-consistency instruction is missing"
);
check(
  serializedChild.includes(
    "Do not claim interpolation, proof, modelling or another operation"
  ),
  "child: metadata must classify only operations actually requested"
);
check(
  serializedChild.includes(
    "diagram_required is true only when a source-provided diagram, graph or table"
  ),
  "child: diagram-required definition is missing"
);
check(
  serializedChild.includes("A1FT") && serializedChild.includes("B1FT"),
  "child: Cambridge follow-through mark codes are not documented"
);
// The mark-code normalizer moved out of `Parse Mark Scheme Responses` -- which
// now handles only the questions the parser defers on -- and into the
// deterministic table parser. Assert the parser's own primitives rather than
// the superseded ones.
const parseTablesCode = child.nodes.find((node) => node.name === "Parse Mark Scheme Tables")
  ?.parameters?.jsCode;
check(
  parseTablesCode?.includes("function stripBold") &&
    parseTablesCode?.includes('inner.includes("**")') &&
    parseTablesCode?.includes("const CODE_BODY") &&
    parseTablesCode?.includes("const SUBTOTAL") &&
    parseTablesCode?.includes("const LIFT") &&
    parseTablesCode?.includes("printed_part_totals"),
  "child: the deterministic mark-scheme table parser is missing or incomplete"
);
// `SC` is a guidance instruction, never a mark code, and a `*` dependency
// marker must never imply an alternative method. Both were real defect sources.
check(
  !parseTablesCode?.includes("/^SC\\s+/i"),
  "child: the SC-prefix branch is back; SC is guidance, not a mark code"
);
check(
  parseTablesCode?.includes("altMode || scMode"),
  "child: is_alternative_method must be derived from printed block structure"
);

// lib/ modules are inlined into the nodes. If someone edits a node in the n8n
// UI and re-exports, these bytes stop matching and the harness would silently
// be testing different code from production.
check(
  parseTablesCode?.includes(inlineModule("mark_scheme_parser.mjs")),
  "child: Parse Mark Scheme Tables has drifted from lib/mark_scheme_parser.mjs"
);
check(
  validationCode?.includes(inlineModule("validation_rules.mjs")),
  "child: Deterministic Validation has drifted from lib/validation_rules.mjs"
);

// Every new rule must appear in BOTH emitted validator nodes.
const preRepairCode = child.nodes.find(
  (node) => node.name === "Deterministic Validation Before Repair"
)?.parameters?.jsCode;
for (const ruleCode of [
  "PART_MARK_RECONCILIATION",
  "PART_TOTAL_DISAGREES_WITH_QUESTION_PAPER",
  "UNGROUPED_ALTERNATIVE_ROW",
  "ALTERNATIVE_GROUP_EXCEEDS_PART_TOTAL",
  "NO_MARK_ROWS_FOR_PART",
  "DIAGRAM_REQUIRED_WITHOUT_ASSET",
  "SINGLE_PART_LABELLED_A",
  "STEM_DUPLICATES_PART_A",
  "MAIN_TOPIC_NOT_IN_VOCABULARY",
  "MARK_ROW_FABRICATED_FROM_SPECIAL_CASE",
  // Backstop for the model-fallback path: the parser now drops codeless,
  // prose-free rows itself, but a fallback or repair result can still contain
  // one and it would reconcile cleanly because it awards nothing.
  "MARK_ROW_WITHOUT_CODE_OR_PROSE",
  "REPAIR_DID_NOT_CLEAR_BLOCKERS",
]) {
  check(validationCode?.includes(ruleCode), `child: validator is missing rule ${ruleCode}`);
  check(preRepairCode?.includes(ruleCode), `child: pre-repair validator is missing ${ruleCode}`);
}

// Every identifier a node references must be defined in that same node.
//
// The cost-audit field was added to all five paid stages with one edit but
// defined in only four of them -- `Parse Mark Scheme Responses` accumulates
// across several requests and has its own block. That is a ReferenceError, not
// a syntax error, so the Code-node syntax check passed it, and the stage fires
// rarely enough that the offline replay never reached it. It shipped, and
// 9709/52 died on it 40 minutes into a paid batch.
//
// This asserts the pairing directly: a node that USES a locally-computed audit
// must also DEFINE it.
for (const node of child.nodes.filter((n) => n.type === "n8n-nodes-base.code")) {
  const code = node.parameters?.jsCode ?? "";
  for (const [use, define] of [
    ["usage_audit: usageAudit", "const usageAudit ="],
    ["actual_cost_usd: Number(actualCostUsd", "const actualCostUsd ="],
  ]) {
    if (code.includes(use)) {
      check(
        code.includes(define),
        `child: "${node.name}" uses ${use.split(":")[1].trim()} but never defines it`,
      );
    }
  }
}

// Repair must be able to restore an asset it was asked to fix. Discarding
// corrected.assets made a dropped diagram permanently unrecoverable.
check(
  child.nodes
    .find((node) => node.name === "Parse Targeted Repair")
    ?.parameters?.jsCode?.includes("corrected.assets && corrected.assets.length"),
  "child: Parse Targeted Repair still discards repaired assets"
);
check(
  validationCode?.includes("\\s*FT"),
  "child: follow-through mark codes are rejected by validation"
);
check(
  validationCode?.includes("isLeafPart"),
  "child: leaf-only nested part mark validation is missing"
);
check(
  validationCode?.includes("addIssue('blocking', 'MARK_CODE_COVERAGE_TOO_LOW'"),
  "child: missing mark-code coverage must block approval"
);
check(validationCode?.includes("INVALID_MARK_CODE"), "child: invalid mark-code blocker is missing");

// The parser and the validator each carry their own mark-code pattern, and they
// have to agree: the parser decides what a code IS, and the validator decides
// whether to reject it. When they disagree the paper blocks on the parser's own
// correct reading -- which is precisely what `B1B1` did on 9709/61 O/N 2025,
// where fixing a two-mark loss immediately produced INVALID_MARK_CODE instead.
//
// Rather than assert the two regex sources are textually identical, which would
// break on harmless reformatting, this drives BOTH with real printed codes from
// the corpus and requires the same verdict.
{
  const validatorPattern = validationCode?.match(
    /!\/(\^\\\*\?\(\?:DM\|DB[^/]*)\/i\s*\n?\s*\.test\(String\(mark\.mark_code\)/,
  )?.[1];
  check(Boolean(validatorPattern), "child: could not locate the validator's mark-code pattern");
  if (validatorPattern) {
    const validator = new RegExp(validatorPattern, "i");
    const REAL_CODES = [
      "M1", "A1", "B1", "DM1", "DB1",       // the ordinary forms
      "DA1",                                 // dependent accuracy: 9709/63 M/J 2024 Q6(b)
      "*M1", "M1*",                          // dependency, both sides
      "A1 FT", "A1FT", "B1 FT",              // follow-through, spaced and not
      "B2,1,0",                              // award 2, 1 or 0
      "B1 B1", "B1B1",                       // two marks in one cell, both forms
      "M1 A1",
    ];
    const rejected = REAL_CODES.filter((code) => !validator.test(code));
    check(
      rejected.length === 0,
      `child: the validator rejects printed mark codes the parser accepts: ${rejected.join(", ")}`,
    );
    const NOT_CODES = ["", "SC", "Or:", "AG", "3", "see below"];
    const accepted = NOT_CODES.filter((text) => validator.test(text));
    check(
      accepted.length === 0,
      `child: the validator accepts text that is not a mark code: ${accepted.join(", ")}`,
    );
  }
}
check(
  validationCode?.includes("MARK_SCHEME_TOTAL_ROW_EMITTED"),
  "child: Marks-column subtotal blocker is missing"
);
check(
  validationCode?.includes("ALL_METHODS_MARKED_ALTERNATIVE"),
  "child: all-methods-alternative blocker is missing"
);
check(
  !validationCode?.includes("GUIDANCE_ONLY_ROW_HAS_MARK_CODE"),
  "child: legitimate blank-Answer mark rows are still rejected"
);
check(
  validationCode?.includes("DUPLICATED_ANSWER_GUIDANCE_TEXT"),
  "child: duplicate Answer/Guidance blocker is missing"
);
check(
  validationCode?.includes("MARK_CODE_COPIED_INTO_GUIDANCE"),
  "child: copied mark-code-in-Guidance blocker is missing"
);
check(
  validationCode?.includes("TEXT_ENCODING_CORRUPTION"),
  "child: encoding-corruption blocker is missing"
);
check(
  validationCode?.includes("QUESTION_NUMBER_INSIDE_PART_PATH"),
  "child: question-number-in-part-path validation is missing"
);
if (validationCode) {
  try {
    const validationFunction = new Function("$input", "$", validationCode);
    const sampleState = {
      expected_total_marks: 2,
      paper_summary: { question_count_from_source: 1 },
      known_documents: [
        { document_type: "question_paper", page_count: 1 },
        { document_type: "mark_scheme", page_count: 1 },
      ],
      ocr_documents: [
        { document: { document_type: "question_paper" }, pages: [{ index: 0, images: [] }] },
        { document: { document_type: "mark_scheme" }, pages: [{ index: 0, images: [] }] },
      ],
      mark_scheme_results: [],
      api_events: [],
      paper_bundle: {
        documents: [],
        questions: [
          {
            question_number: 1,
            stem_markdown: "Shared prompt",
            total_marks: 2,
            source_page_numbers: [1],
            parts: [
              {
                label_path: ["a"],
                prompt_markdown: "Shared part prompt",
                marks: null,
                source_page_numbers: [1],
                sort_order: 0,
              },
              {
                label_path: ["a", "i"],
                prompt_markdown: "First child",
                marks: 1,
                source_page_numbers: [1],
                sort_order: 1,
              },
              {
                label_path: ["a", "ii"],
                prompt_markdown: "Second child",
                marks: 1,
                source_page_numbers: [1],
                sort_order: 2,
              },
            ],
            mark_scheme_items: [
              {
                sequence_number: 1,
                part_path: ["a", "i"],
                mark_code: "M1",
                content_markdown: "Valid step",
                guidance_markdown: "",
                is_final_answer: false,
                is_alternative_method: false,
                source_page_numbers: [1],
              },
              {
                sequence_number: 2,
                part_path: ["a", "i"],
                mark_code: "A1",
                content_markdown: "",
                guidance_markdown: "Wholly correct method and limits.",
                is_final_answer: false,
                is_alternative_method: true,
                source_page_numbers: [1],
              },
              {
                sequence_number: 3,
                part_path: [],
                mark_code: null,
                content_markdown: "This deliberately repeated source text is long enough.",
                guidance_markdown: "Different examiner guidance for the source row.",
                is_final_answer: false,
                is_alternative_method: false,
                source_page_numbers: [1],
              },
            ],
            assets: [],
            metadata: {
              main_topic: "Algebra",
              skills: ["Manipulation"],
              classification_confidence: 0.9,
            },
          },
        ],
      },
    };
    const result = validationFunction(
      { first: () => ({ json: sampleState }) },
      () => {
        throw new Error("Unexpected node lookup in deterministic validation");
      }
    )[0].json.validation_report;
    check(
      !result.issues.some((issue) => issue.issue_code === "QUESTION_MARK_TOTAL_MISMATCH"),
      "child: nested parent and child marks are still double-counted"
    );
    // Blocking since 9 August 2026. This fixture has 2 marks of parts and 2
    // marks of codes, but one code is flagged alternative, so the primary route
    // reaches only 1 of 2 -- a candidate following the main method could not
    // score full marks. On the real 9709/12 M/J 2024 Q6(b) this exact signal
    // fired as a warning, was passed over, and cost a published mark.
    check(
      result.passed === false &&
        result.issues.some(
          (issue) =>
            issue.issue_code === "MARK_CODE_ALTERNATIVE_CLASSIFICATION" &&
            issue.severity === "blocking"
        ),
      "child: alternative mark-code classification no longer blocks"
    );
    check(
      !result.issues.some(
        (issue) => issue.issue_code === "GUIDANCE_ONLY_ROW_HAS_MARK_CODE"
      ),
      "child: a blank Answer with A1 and Guidance was rejected"
    );
    const duplicatedState = JSON.parse(JSON.stringify(sampleState));
    duplicatedState.paper_bundle.questions[0].mark_scheme_items[2]
      .guidance_markdown =
      duplicatedState.paper_bundle.questions[0].mark_scheme_items[2]
        .content_markdown;
    const duplicatedResult = validationFunction(
      { first: () => ({ json: duplicatedState }) },
      () => {
        throw new Error("Unexpected node lookup in deterministic validation");
      }
    )[0].json.validation_report;
    // Warning, not blocking. With deterministic parsing Answer and Guidance
    // come from distinct printed columns, so similarity reflects the source --
    // an "answer given" row legitimately repeats the expression in both cells.
    // Batch 2 source-checked two of these (9709/31 Q7, 9709/42 Q7a) and cleared
    // both as false positives by hand; keeping it blocking would repeat that
    // work every batch. It still surfaces for review.
    check(
      duplicatedResult.issues.some(
        (issue) =>
          issue.issue_code === "DUPLICATED_ANSWER_GUIDANCE_TEXT" &&
          issue.severity === "warning"
      ),
      "child: duplicated Answer/Guidance is no longer reported as a warning"
    );
    // A question that fell back to the model still carries the printed subtotal
    // the parser read off the page, and must still be reconciled. Live run
    // 9709/31 Q7 came back from the model with ten marks against a printed five
    // and reported passed = true, because reconciliation was gated on
    // source === "ocr_table". Gate on having a subtotal instead.
    const modelFallbackState = JSON.parse(JSON.stringify(sampleState));
    modelFallbackState.mark_scheme_results = [
      {
        question_number: 1,
        source: "model",
        printed_part_totals: { "a.i": 99 },
        alternative_groups: [],
        special_case_groups: [],
        source_page_numbers: [1],
      },
    ];
    const modelFallbackResult = validationFunction(
      { first: () => ({ json: modelFallbackState }) },
      () => {
        throw new Error("Unexpected node lookup in deterministic validation");
      }
    )[0].json.validation_report;
    check(
      modelFallbackResult.passed === false &&
        modelFallbackResult.issues.some(
          (issue) =>
            issue.issue_code === "PART_MARK_RECONCILIATION" && issue.severity === "blocking"
        ),
      "child: a model-fallback question is not reconciled against its printed subtotal"
    );

    const copiedCodeState = JSON.parse(JSON.stringify(sampleState));
    copiedCodeState.paper_bundle.questions[0].mark_scheme_items[0]
      .guidance_markdown = "M1 Allow equivalent working.";
    const copiedCodeResult = validationFunction(
      { first: () => ({ json: copiedCodeState }) },
      () => {
        throw new Error("Unexpected node lookup in deterministic validation");
      }
    )[0].json.validation_report;
    check(
      copiedCodeResult.passed === false &&
        copiedCodeResult.issues.some(
          (issue) =>
            issue.issue_code === "MARK_CODE_COPIED_INTO_GUIDANCE" &&
            issue.severity === "blocking"
        ),
      "child: a Marks-column code copied into Guidance did not block approval"
    );
    const deficientState = JSON.parse(JSON.stringify(sampleState));
    deficientState.paper_bundle.questions[0].mark_scheme_items[1].mark_code = null;
    const deficientResult = validationFunction(
      { first: () => ({ json: deficientState }) },
      () => {
        throw new Error("Unexpected node lookup in deterministic validation");
      }
    )[0].json.validation_report;
    check(
      deficientResult.passed === false &&
        deficientResult.issues.some(
          (issue) =>
            issue.issue_code === "MARK_CODE_COVERAGE_TOO_LOW" &&
            issue.severity === "blocking"
        ),
      "child: genuinely missing mark-code coverage did not block approval"
    );
    const invalidCodeState = JSON.parse(JSON.stringify(sampleState));
    invalidCodeState.paper_bundle.questions[0].mark_scheme_items[0].mark_code = "2";
    const invalidCodeResult = validationFunction(
      { first: () => ({ json: invalidCodeState }) },
      () => {
        throw new Error("Unexpected node lookup in deterministic validation");
      }
    )[0].json.validation_report;
    check(
      invalidCodeResult.issues.some(
        (issue) =>
          issue.issue_code === "INVALID_MARK_CODE" &&
          issue.severity === "blocking"
      ),
      "child: a numeric subtotal used as mark_code was not rejected"
    );
    const subtotalState = JSON.parse(JSON.stringify(sampleState));
    subtotalState.paper_bundle.questions[0].mark_scheme_items.push({
      sequence_number: 4,
      part_path: ["a"],
      mark_code: null,
      content_markdown: "**2**",
      guidance_markdown: "",
      is_final_answer: false,
      is_alternative_method: false,
      source_page_numbers: [1],
    });
    const subtotalResult = validationFunction(
      { first: () => ({ json: subtotalState }) },
      () => {
        throw new Error("Unexpected node lookup in deterministic validation");
      }
    )[0].json.validation_report;
    check(
      subtotalResult.issues.some(
        (issue) =>
          issue.issue_code === "MARK_SCHEME_TOTAL_ROW_EMITTED" &&
          issue.severity === "blocking"
      ),
      "child: a standalone Marks-column subtotal was not rejected"
    );
    const allAlternativeState = JSON.parse(JSON.stringify(sampleState));
    allAlternativeState.paper_bundle.questions[0].mark_scheme_items[0]
      .is_alternative_method = true;
    const allAlternativeResult = validationFunction(
      { first: () => ({ json: allAlternativeState }) },
      () => {
        throw new Error("Unexpected node lookup in deterministic validation");
      }
    )[0].json.validation_report;
    check(
      allAlternativeResult.issues.some(
        (issue) =>
          issue.issue_code === "ALL_METHODS_MARKED_ALTERNATIVE" &&
          issue.severity === "blocking"
      ),
      "child: a part with every marked row labelled alternative was not rejected"
    );
    const corruptedState = JSON.parse(JSON.stringify(sampleState));
    corruptedState.paper_bundle.questions[0].mark_scheme_items[0].guidance_markdown =
      "Condone â€“ alternative.";
    const corruptedResult = validationFunction(
      { first: () => ({ json: corruptedState }) },
      () => {
        throw new Error("Unexpected node lookup in deterministic validation");
      }
    )[0].json.validation_report;
    check(
      corruptedResult.passed === false &&
        corruptedResult.issues.some(
          (issue) =>
            issue.issue_code === "TEXT_ENCODING_CORRUPTION" &&
            issue.severity === "blocking"
        ),
      "child: corrupted text encoding did not block staging approval"
    );
  } catch (error) {
    failures.push(`child: deterministic validation smoke test failed: ${error.message}`);
  }
}

const inputCode = child.nodes.find(
  (node) => node.name === "Validate Paper Input"
)?.parameters.jsCode;
check(inputCode?.includes("'budget-v2.1'"), "child: v2.1 idempotency prefix is missing");
check(
  inputCode?.includes("gpt-5.4-mini") && inputCode?.includes("gpt-5.4-nano"),
  "child: guarded model allow-list is incomplete"
);

const openAiNodes = child.nodes.filter(
  (node) =>
    node.type === "n8n-nodes-base.httpRequest" &&
    node.parameters?.url === "https://api.openai.com/v1/responses"
);
check(openAiNodes.length === 5, `child: expected 5 OpenAI nodes, found ${openAiNodes.length}`);
for (const node of openAiNodes) {
  check(node.retryOnFail === true, `child: retry is disabled on ${node.name}`);
  check(Number(node.maxTries) >= 5, `child: too few retries on ${node.name}`);
  check(
    node.credentials?.openAiApi?.name === "OpenAi account",
    `child: OpenAI credential is missing on ${node.name}`
  );
}
const markSchemeHttpNode = child.nodes.find(
  (node) => node.name === "OpenAI Mark Scheme Questions"
);
check(
  markSchemeHttpNode?.parameters?.options?.batching?.batch?.batchSize === 1 &&
    markSchemeHttpNode?.parameters?.options?.batching?.batch?.batchInterval >= 2000,
  "child: per-question mark-scheme requests are not serially throttled"
);

const reservationNodes = child.nodes.filter((node) =>
  String(node.parameters?.url || "").includes("shamo_reserve_api_budget")
);
const finalizationNodes = child.nodes.filter((node) =>
  String(node.parameters?.url || "").includes("shamo_finalize_api_cost_event")
);
check(reservationNodes.length === 5, "child: expected five database budget reservations");
check(finalizationNodes.length === 5, "child: expected five database cost finalizations");

const controllerCode = controller.nodes.find(
  (node) => node.name === "Budget Configuration"
)?.parameters.jsCode;
check(controllerCode?.includes("batch_budget_limit_usd: 1.00"), "controller: $1 interim batch cap changed -- it is lowered deliberately while the ledger reads 2.6x under the provider dashboard");
check(controllerCode?.includes("campaign_budget_limit_usd: 15.00"), "controller: $15 campaign cap changed");
check(controllerCode?.includes("workflow_version: 'v2.1'"), "controller: v2.1 batch key marker missing");
check(controllerCode?.includes("batch_number: 2"), "controller: safe batch-2 default is missing");
check(
  controllerCode?.includes("question_paper: 0.12") &&
    controllerCode?.includes("repair: 0.20"),
  "controller: per-stage reservations are missing"
);

const subworkflow = controller.nodes.find(
  (node) => node.name === "Run One Paper Sub-workflow"
);
check(
  subworkflow?.parameters?.options?.waitForSubWorkflow === true,
  "controller: child workflow must run sequentially"
);

if (failures.length) {
  console.error(failures.map((failure) => `FAIL: ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      success: true,
      child_nodes: child.nodes.length,
      controller_nodes: controller.nodes.length,
      openai_nodes: openAiNodes.length,
      reservation_nodes: reservationNodes.length,
      finalization_nodes: finalizationNodes.length,
      batch_cap_usd: 3,
      campaign_cap_usd: 15,
    },
    null,
    2
  )
);
