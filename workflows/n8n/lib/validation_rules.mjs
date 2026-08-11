// Extended deterministic validation rules.
//
// WHY THESE EXIST
// ---------------
// Batches 1 and 2 each ended in hand-written SQL that corrected that batch's
// rows. Nothing was added to the validator, so the same defect classes came
// back. Every rule below corresponds to a defect that was found by human source
// review and would otherwise recur: each one converts a finding into a check.
//
// Inlined into the `Deterministic Validation` Code node by
// build_budget_v2_workflows.mjs. That node is emitted twice (before and after
// repair) from one string, so each rule is written once and runs twice.
//
// THE TRAP THIS IS DESIGNED AROUND
// --------------------------------
// The pre-existing SQL reconciliation excluded is_alternative_method rows from
// the sum. On 9709/62 Q7(b) the model fabricated a B1 AND flagged it as an
// alternative, so the part reconciled at 3 = 3 and the defect was invisible.
// The same upstream error both created the bad row and hid it.
//
// Two things close that here. The parser now derives is_alternative_method from
// printed structure, so a fabricated row cannot claim to be an alternative; and
// UNGROUPED_ALTERNATIVE_ROW makes an alternative flag that belongs to no parsed
// block a blocking issue in its own right. Flagging a row can no longer make it
// disappear.

// Controlled vocabulary for main_topic. Batch 1 used `Statistics` for every
// component 5/6 question; batch 2 produced `Probability`, `Statistics` and even
// `Algebra` for the same components, and paper 42 used the paper-family name
// `Mechanics` for all seven questions. Values drifted because the field was
// unconstrained free text.
/**
 * Which paper family a component belongs to. Deterministic from the component
 * digit, so it never needs a model and can never disagree with itself.
 *
 * This exists because `main_topic` was carrying two different levels of meaning
 * at once. Across the first 99 rows, component 4 was labelled `Mechanics` 14
 * times and components 5-6 were labelled `Statistics` 18 times -- those are
 * paper families, not content topics, and they sat in the same field as
 * `Calculus` and `Complex Numbers`. Any filter or analytic over that field was
 * comparing unlike things.
 */
export const PAPER_DOMAIN_BY_COMPONENT = {
  1: "Pure Mathematics",
  2: "Pure Mathematics",
  3: "Pure Mathematics",
  4: "Mechanics",
  5: "Probability and Statistics",
  6: "Probability and Statistics",
};

export function paperDomainFor(paperVariant) {
  const component = Number(String(paperVariant ?? "").trim().charAt(0));
  return PAPER_DOMAIN_BY_COMPONENT[component] ?? null;
}

/**
 * Controlled content-topic vocabulary, aligned to the published 9709 syllabus
 * rather than invented. A paper family must never appear here -- that is what
 * `paper_domain` is for.
 *
 * Changing this list invalidates stored rows, so it is versioned: bump
 * TAXONOMY_VERSION and record the migration whenever a value is added, removed
 * or renamed.
 */
export const TAXONOMY_VERSION = "9709-v3";

const PURE_TOPICS = [
  "Algebra",
  "Functions",
  "Coordinate Geometry",
  "Circular Measure",
  "Trigonometry",
  "Series",
  "Calculus",
  "Exponential and Logarithmic Functions",
  "Numerical Methods",
  "Vectors",
  "Complex Numbers",
  "Differential Equations",
];

const MECHANICS_TOPICS = [
  "Forces and Equilibrium",
  "Kinematics",
  "Newton's Laws of Motion",
  "Energy, Work and Power",
  "Momentum",
];

const STATISTICS_TOPICS = [
  "Representation of Data",
  "Permutations and Combinations",
  "Probability",
  "Discrete Random Variables",
  // Added after the first review pass: the syllabus lists binomial and geometric
  // as their own topic, and omitting it forced genuinely binomial questions into
  // `Discrete Random Variables`, which would have hidden the gap rather than
  // fixed it. 9709/52 Q2 is the case that exposed it.
  "The Binomial and Geometric Distributions",
  "The Normal Distribution",
  "The Poisson Distribution",
  "Linear Combinations of Random Variables",
  "Continuous Random Variables",
  "Sampling and Estimation",
  "Hypothesis Tests",
];

/** Topics permitted within each paper family. */
export const TOPICS_BY_DOMAIN = {
  "Pure Mathematics": PURE_TOPICS,
  Mechanics: MECHANICS_TOPICS,
  "Probability and Statistics": STATISTICS_TOPICS,
};

const MAIN_TOPIC_VOCABULARY = [...PURE_TOPICS, ...MECHANICS_TOPICS, ...STATISTICS_TOPICS];

/** Marks awarded by a code cell. `B2,1,0` -> 2, `B1 B1` -> 2, `A1 FT` -> 1. */
function ruleMarkValue(code) {
  if (!code) return 0;
  return [...String(code).matchAll(/\*?(?:DM|DB|M|A|B)(\d+)/gi)].reduce(
    (total, match) => total + Number(match[1] || 1),
    0,
  );
}

function normalizeForCompare(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * @param {object} options
 * @param {object} options.bundle   state.paper_bundle
 * @param {object} options.state    the full node state
 * @param {Function} options.addIssue  (severity, code, message, extra) => void
 */
function applyExtendedValidationRules({ bundle, state, addIssue }) {
  const questions = Array.isArray(bundle?.questions) ? bundle.questions : [];
  const resultsByQuestion = new Map(
    (state.mark_scheme_results || []).map((result) => [Number(result.question_number), result]),
  );

  let markedRowTotal = 0;
  let alternativeRowTotal = 0;

  for (const question of questions) {
    const questionNumber = Number(question.question_number);
    const result = resultsByQuestion.get(questionNumber) || {};
    const markItems = Array.isArray(question.mark_scheme_items) ? question.mark_scheme_items : [];
    const parts = Array.isArray(question.parts) ? question.parts : [];
    const printedTotals = result.printed_part_totals || {};
    const altGroups = result.alternative_groups || [];
    const scGroups = result.special_case_groups || [];
    const parsedFromTables = result.source === "ocr_table";
    // Reconciliation is gated on having a printed subtotal to check against,
    // NOT on which stage produced the rows. A question that fell back to the
    // model still has the subtotal the parser read off the page, and it is the
    // path that most needs checking -- 9709/31 Q7 came back from the model with
    // ten marks against a printed five and passed, because this was previously
    // gated on source === "ocr_table".
    const hasPrintedTotals = Object.keys(printedTotals).length > 0;

    markedRowTotal += markItems.filter((m) => m.mark_code).length;
    alternativeRowTotal += markItems.filter((m) => m.is_alternative_method).length;

    // ---- R1: per-part mark reconciliation ---------------------------------
    // Anchored on the subtotal the examiner printed in the Marks column, which
    // is independent of the question-paper extraction. This is the check that
    // would have caught nine of the eleven mechanically-detectable batch-2
    // defects on its own.
    const primaryByPart = new Map();
    const groupedAltSequences = new Set([
      ...altGroups.flatMap((g) => g.row_sequence_numbers || []),
      ...scGroups.flatMap((g) => g.row_sequence_numbers || []),
    ]);

    for (const item of markItems) {
      const partKey = (item.part_path || []).join(".");
      if (item.is_alternative_method) continue;
      primaryByPart.set(partKey, (primaryByPart.get(partKey) || 0) + ruleMarkValue(item.mark_code));
    }

    if (hasPrintedTotals) {
      for (const [partKey, printed] of Object.entries(printedTotals)) {
        const actual = primaryByPart.get(partKey) || 0;
        if (actual !== printed) {
          addIssue(
            "blocking",
            "PART_MARK_RECONCILIATION",
            "Primary mark rows sum to " + actual + " but the mark scheme prints " + printed +
              " for this part.",
            {
              document_type: "mark_scheme",
              question_number: questionNumber,
              part_path: partKey ? partKey.split(".") : [],
            },
          );
        }
      }

      // A printed subtotal that disagrees with the question paper's own part
      // marks means one of the two extractions is wrong. Which one is not
      // knowable here, so report it rather than silently preferring either.
      for (const part of parts) {
        const partKey = (part.label_path || []).join(".");
        if (part.marks === null || part.marks === undefined) continue;
        const printed = printedTotals[partKey];
        if (printed === undefined) continue;
        if (Number(part.marks) !== printed) {
          addIssue(
            "blocking",
            "PART_TOTAL_DISAGREES_WITH_QUESTION_PAPER",
            "The mark scheme prints " + printed + " marks for this part but the question paper " +
              "shows " + part.marks + ".",
            { question_number: questionNumber, part_path: part.label_path || [] },
          );
        }
      }

      for (const part of parts) {
        const partKey = (part.label_path || []).join(".");
        const isLeaf = !parts.some(
          (other) =>
            other !== part &&
            (other.label_path || []).length > (part.label_path || []).length &&
            (other.label_path || []).join(".").startsWith(partKey + "."),
        );
        if (!isLeaf) continue;
        const hasRows = markItems.some((m) => (m.part_path || []).join(".") === partKey);
        if (!hasRows) {
          addIssue(
            "blocking",
            "NO_MARK_ROWS_FOR_PART",
            "This part has no mark-scheme rows.",
            { question_number: questionNumber, part_path: part.label_path || [] },
          );
        }
        if (printedTotals[partKey] === undefined && hasRows) {
          addIssue(
            "warning",
            "PART_TOTAL_NOT_FOUND",
            "No printed subtotal was found for this part, so its marks could not be reconciled.",
            { question_number: questionNumber, part_path: part.label_path || [] },
          );
        }
      }

      for (const group of altGroups) {
        const partKey = (group.part_path || []).join(".");
        const printed = printedTotals[partKey];
        if (printed !== undefined && group.mark_value > printed) {
          addIssue(
            "blocking",
            "ALTERNATIVE_GROUP_EXCEEDS_PART_TOTAL",
            "An alternative method awards " + group.mark_value + " marks but the part is worth " +
              printed + ".",
            { question_number: questionNumber, part_path: group.part_path || [] },
          );
        }
      }
    }

    // ---- R1f: the trap-closer ---------------------------------------------
    // An alternative flag that belongs to no parsed block is unexplained. This
    // is what stops "flag it as an alternative" from being a way to vanish from
    // the reconciliation sum.
    for (const item of markItems) {
      if (!item.is_alternative_method) continue;
      if (!parsedFromTables) continue;
      if (groupedAltSequences.has(item.sequence_number)) continue;
      const parenthesised = typeof item.mark_code === "string" && /^\(.*\)$/.test(item.mark_code);
      if (parenthesised) continue;
      addIssue(
        "blocking",
        "UNGROUPED_ALTERNATIVE_ROW",
        "This row is flagged as an alternative method but belongs to no alternative or " +
          "special-case block printed in the mark scheme.",
        {
          document_type: "mark_scheme",
          question_number: questionNumber,
          part_path: item.part_path || [],
        },
      );
    }

    // ---- R7: a mark code invented from a Special Case sentence -------------
    // The exact 9709/62 Q7(b) failure. Kept even though the parser can no
    // longer produce it, because the repair model still can.
    for (const item of markItems) {
      if (!item.mark_code) continue;
      if (String(item.content_markdown ?? "").trim() !== "") continue;
      if (/^\s*(?:\*\*)?(?:If \d+ scored,?\s*)?(?:\*\*)?SC\b/i.test(String(item.guidance_markdown ?? ""))) {
        addIssue(
          "blocking",
          "MARK_ROW_FABRICATED_FROM_SPECIAL_CASE",
          "This row has a mark code and a blank Answer cell, and its guidance is a special-case " +
            "instruction. The printed Marks cell is almost certainly blank.",
          {
            document_type: "mark_scheme",
            question_number: questionNumber,
            part_path: item.part_path || [],
          },
        );
      }
    }

    // ---- R10: a codeless row that carries no prose -------------------------
    // Layout stored as content. Two shapes seen in the real corpus: an embedded
    // numeric working grid (9709/22 Q5(a) synthetic division, three 5-column
    // rows inside a 4-column table) and a bare `**Or:**` separator (published
    // 9709/12 Q10 and Q11). Both award nothing, so per-part reconciliation
    // stays balanced and never sees them -- this needs its own rule.
    //
    // A codeless row WITH prose is legitimate and must survive: 9709/62 Q7(b)
    // has a blank Marks cell and a real special-case instruction in Guidance.
    // Maths is stripped before the prose test so `\frac` does not read as a word.
    const hasProse = (text) =>
      /[A-Za-z]{3,}/.test(
        String(text ?? "")
          .replace(/\$\$?[^$]*\$\$?/g, " ")
          .replace(/\\[A-Za-z]+/g, " "),
      );
    for (const item of markItems) {
      if (item.mark_code) continue;
      if (hasProse(item.content_markdown) || hasProse(item.guidance_markdown)) continue;
      addIssue(
        "blocking",
        "MARK_ROW_WITHOUT_CODE_OR_PROSE",
        "This row has no mark code and no prose in either the Answer or Guidance cell, so it is " +
          "table layout rather than a mark award.",
        {
          document_type: "mark_scheme",
          question_number: questionNumber,
          part_path: item.part_path || [],
        },
      );
    }

    // ---- R2: a required diagram with no asset ------------------------------
    // 9709/11 Q11 states "The graph of y = f(x) is shown in the diagram", its
    // own metadata sets diagram_required = true, and it staged zero assets. The
    // bundle contradicted itself and nothing noticed.
    const assets = Array.isArray(question.assets) ? question.assets : [];
    const metadata = question.metadata || {};

    // The opposite case, and it is NOT the same defect. When the question asks
    // the CANDIDATE to draw ("On a sketch of an Argand diagram, shade the
    // region ..."), there is no printed diagram to capture and
    // diagram_required = true is simply wrong. 9709/32 F/M Q5 blocked a whole
    // paper on a diagram that was never supposed to exist, and 9709/32 M/J Q1
    // needed the same correction in batch 1 -- twice is a class.
    //
    // The "the diagram shows" guard is load-bearing: a question can both print
    // a diagram AND ask for a sketch, and that one really does need its asset.
    const allText = [
      String(question.stem_markdown ?? ""),
      ...parts.map((part) => String(part.prompt_markdown ?? "")),
    ].join(" ");
    // The verb has to be matched as an INSTRUCTION, not as the phrase
    // "sketch the". Cambridge routinely puts the qualifier between the two:
    //
    //   "Sketch, on a single diagram, the graphs of ..."   9709/21 M/J 2025 Q3
    //   "Sketch on the same diagram the graphs of ..."     9709/22,23 M/J 2025 Q2
    //
    // The old pattern required "sketch the" adjacently and so missed all three,
    // blocking four papers on diagrams the candidate is asked to produce and
    // that therefore do not exist to be captured. Anchoring on a sentence start
    // or a part label catches the imperative wherever the qualifier sits.
    //
    // Widening this is safe because referencesPrintedDiagram still gates it: a
    // question that shows a figure AND asks for a sketch keeps blocking, which
    // is the case that actually needs a human.
    const asksCandidateToDraw =
      /(?:^|[.;\n)])\s*(?:sketch|draw|plot|shade|copy)\b|\bon a sketch\b|\bshade the region\b/i.test(
        allText,
      );
    const referencesPrintedDiagram = /\bthe diagram\b|\bdiagram shows\b|\bgraph of .{0,30}\bis shown\b/i.test(allText);
    const candidateDrawsIt = asksCandidateToDraw && !referencesPrintedDiagram;

    // Some Cambridge "diagrams" are typeset as tables, and OCR reads them as
    // tables rather than cropping them as images. A back-to-back stem-and-leaf,
    // a frequency table, a cumulative-frequency table: printed inside a ruled
    // box, described in the text as a diagram, but made of digits.
    //
    // 9709/51 O/N 2025 Q3 is the worked example. Its stem-and-leaf came through
    // complete and correct as a markdown table, and the extraction model then
    // ALSO claimed an image for it -- an image that does not exist, because
    // there is nothing on that page for OCR to crop. Blocking there demands a
    // human recover an asset that was never lost.
    //
    // Scoped to the table-shaped diagram names on purpose. A question printing
    // a curve and a table both would still block, because "graph"/"curve"/
    // "sketch" are not in this list.
    const diagramIsTabular =
      /\b(?:stem[- ]and[- ]leaf|back[- ]to[- ]back|frequency table|cumulative frequency|box[- ]and[- ]whisker)\b/i.test(
        allText,
      );
    const textCarriesTable = /(^|\n)\s*\|.*\|/.test(allText) || /```/.test(allText);

    if (
      metadata.diagram_required === true &&
      assets.length === 0 &&
      diagramIsTabular &&
      textCarriesTable
    ) {
      addIssue(
        "warning",
        "DIAGRAM_CAPTURED_AS_TEXT",
        "Metadata marks this question as requiring a source diagram, but the diagram is tabular " +
          "and OCR captured it as text inside the question. Nothing is missing; there is no image " +
          "to recover.",
        { question_number: questionNumber, part_path: [] },
      );
    } else if (metadata.diagram_required === true && assets.length === 0 && candidateDrawsIt) {
      addIssue(
        "warning",
        "DIAGRAM_REQUIRED_BUT_CANDIDATE_DRAWS_IT",
        "Metadata marks this question as requiring a source diagram, but the question asks the " +
          "candidate to produce the sketch and no printed diagram is referenced. diagram_required " +
          "should be false; there is no missing asset to recover.",
        { question_number: questionNumber, part_path: [] },
      );
    } else if (metadata.diagram_required === true && assets.length === 0) {
      addIssue(
        "blocking",
        "DIAGRAM_REQUIRED_WITHOUT_ASSET",
        "Metadata marks this question as requiring a source diagram but no asset was captured.",
        { question_number: questionNumber, part_path: [] },
      );
    } else if (assets.length === 0) {
      const mentionsDiagram =
        /diagram|graph of/i.test(String(question.stem_markdown ?? "")) ||
        parts.some((part) => /diagram|graph of/i.test(String(part.prompt_markdown ?? "")));
      if (mentionsDiagram) {
        addIssue(
          "warning",
          "TEXT_MENTIONS_DIAGRAM_WITHOUT_ASSET",
          "The question text refers to a diagram or graph but no asset was captured.",
          { question_number: questionNumber, part_path: [] },
        );
      }
    }

    // ---- R3: a fabricated lone part label ----------------------------------
    // Cambridge never prints a solitary (a). 9709/11 Q10 is unparted in the
    // source and the model invented one.
    if (parts.length === 1 && (parts[0].label_path || []).join(".") === "a") {
      addIssue(
        "blocking",
        "SINGLE_PART_LABELLED_A",
        "This question has exactly one part labelled (a). Cambridge does not print a lone (a), " +
          "so either the label was invented or later parts are missing.",
        { question_number: questionNumber, part_path: ["a"] },
      );
    }

    // ---- R4: a stem duplicating part (a) -----------------------------------
    // 9709/11 Q5 has no printed stem; the model copied part (a) into it.
    if (parts.length && String(question.stem_markdown ?? "").trim()) {
      if (normalizeForCompare(question.stem_markdown) === normalizeForCompare(parts[0].prompt_markdown)) {
        addIssue(
          "blocking",
          "STEM_DUPLICATES_PART_A",
          "The question stem is identical to the first part prompt, so the instruction is stored twice.",
          { question_number: questionNumber, part_path: [] },
        );
      }
    }

    // ---- R5: controlled topic vocabulary -----------------------------------
    if (metadata.main_topic && !MAIN_TOPIC_VOCABULARY.includes(metadata.main_topic)) {
      addIssue(
        "blocking",
        "MAIN_TOPIC_NOT_IN_VOCABULARY",
        'main_topic "' + metadata.main_topic + '" is not in the controlled vocabulary: ' +
          MAIN_TOPIC_VOCABULARY.join(", ") + ".",
        { question_number: questionNumber, part_path: [] },
      );
    }

    // ---- R11: the topic must belong to this paper's domain -----------------
    // Membership of the global list is not enough. A Mechanics paper carrying
    // `The Normal Distribution` is in-vocabulary and still wrong, and the
    // component digit says so deterministically without asking a model.
    const paperDomain = paperDomainFor(state?.pair?.paper_variant);
    const allowedForDomain = paperDomain ? TOPICS_BY_DOMAIN[paperDomain] || [] : [];
    if (metadata.main_topic && allowedForDomain.length && !allowedForDomain.includes(metadata.main_topic)) {
      addIssue(
        // Blocking, promoted from warning on 9 August 2026. It was held back
        // until the narrowed prompt had been measured rather than assumed --
        // the mistake the alternative-method rate rule taught. Batch 3 then
        // produced ZERO violations across all six papers, so the rule now
        // rests on evidence: it costs nothing on correct output and catches a
        // class that is always wrong, since the component digit determines the
        // domain deterministically and a model never sees it.
        "blocking",
        "MAIN_TOPIC_OUTSIDE_PAPER_DOMAIN",
        'main_topic "' + metadata.main_topic + '" is not a ' + paperDomain +
          " topic. Permitted here: " + allowedForDomain.join(", ") + ".",
        { question_number: questionNumber, part_path: [] },
      );
    }

    // ---- R12: measured topic confusions ------------------------------------
    //
    // The same rules the metadata prompt states, enforced rather than requested.
    // A prompt instruction is a hope; this is a check, and the difference is why
    // 16 of the first 138 published rows carried a wrong main_topic while every
    // one of them sat inside the correct paper domain.
    //
    // Each rule is near-deterministic: the feature it looks for settles the
    // topic whatever else the question touches. Warning severity, because a
    // question can legitimately straddle two topics and a wrongly-blocked paper
    // costs far more than a flagged one -- the lesson the alternative-method
    // rate rule already taught.
    //
    // The component restriction is not a convenience. In component 1 the
    // expansion of (a+b)^n is Series; in component 3 the expansion of (1+x)^n
    // for rational n sits under Algebra beside partial fractions. Same words,
    // two correct answers.
    const componentDigit = Number(String(state?.pair?.paper_variant || "").charAt(0));
    const questionText = [
      String(question.stem_markdown ?? ""),
      ...parts.map((part) => String(part.prompt_markdown ?? "")),
    ]
      .join(" ")
      .toLowerCase();

    const TOPIC_CONFUSIONS = [
      {
        expect: "Series",
        why: "the question is about an arithmetic or geometric progression",
        test: (text) => /\b(arithmetic|geometric) progression/.test(text),
      },
      {
        expect: "Series",
        why: "the question expands a bracket and reads off a coefficient, which is Series in a component 1 paper",
        components: [1],
        test: (text) =>
          /\bexpansion of\b/.test(text) && /coefficient|first (three|four) terms|term in/.test(text),
      },
      {
        expect: "Functions",
        why: "the assessed skill is describing or applying graph transformations, whatever curve is being transformed",
        test: (text) =>
          /\b(transformations?|transformed)\b/.test(text) &&
          /\b(sequence|describe|stretch|translation|reflection)\b/.test(text),
      },
      {
        expect: "Differential Equations",
        why: "a differential equation is printed in the question",
        test: (text) => /\bdifferential equation\b/.test(text),
      },
      {
        expect: "The Poisson Distribution",
        why: "the question declares a Poisson distribution",
        test: (text) => /\\sim\s*\\?(?:text|mathrm)?\{?\s*po\s*\}?\s*\(|~\s*po\s*\(/.test(text),
      },
    ];

    for (const rule of TOPIC_CONFUSIONS) {
      if (rule.components && !rule.components.includes(componentDigit)) continue;
      if (!rule.test(questionText)) continue;
      if (metadata.main_topic === rule.expect) continue;
      addIssue(
        "warning",
        "MAIN_TOPIC_CONFUSABLE_CLASS",
        'main_topic is "' + metadata.main_topic + '" but ' + rule.why +
          ', which makes it "' + rule.expect + '". Check against the printed question before approving.',
        { question_number: questionNumber, part_path: [] },
      );
      break;
    }

    // ---- R8: page-map cross-check ------------------------------------------
    // Free, and it is the reason the page-map stage is still worth its $0.0035:
    // it becomes an independent second opinion on where a question lives.
    const mappedPages = (state.mark_scheme_page_map || {})[String(questionNumber)] || [];
    if (parsedFromTables && mappedPages.length && (result.source_page_numbers || []).length) {
      const parsedPages = new Set(result.source_page_numbers);
      const disagreement = mappedPages.filter((page) => !parsedPages.has(Number(page)));
      if (disagreement.length) {
        addIssue(
          "warning",
          "MARK_SCHEME_PAGE_MAP_DISAGREEMENT",
          "The page map lists mark-scheme pages " + mappedPages.join(", ") +
            " but rows were parsed from " + [...parsedPages].join(", ") + ".",
          { document_type: "mark_scheme", question_number: questionNumber, part_path: [] },
        );
      }
    }
  }

  // ---- R6: paper-level alternative rate ------------------------------------
  //
  // Drift detection only, both tiers warning-severity.
  //
  // The original design made >30% blocking, on the assumption that batch 2's
  // measured 23.9% was itself too high. Measuring against the source showed
  // that assumption was wrong: papers 11, 22 and 51 each flag exactly as many
  // alternatives as there are parenthesised codes printed in the mark scheme
  // (19=19, 9=9, 25=25), and paper 42 prints seven explicit "Alternative
  // Method" headers. A Mechanics paper genuinely running at 38% is a property
  // of the paper, not a defect.
  //
  // What was wrong in batch 2 was not the rate but WHICH rows carried the flag
  // -- dependency asterisks were read as alternatives. That is now caught
  // precisely by UNGROUPED_ALTERNATIVE_ROW, which is blocking. Blocking on the
  // rate as well would fail correct papers.
  if (markedRowTotal >= 20) {
    const rate = alternativeRowTotal / markedRowTotal;
    if (rate > 0.45) {
      addIssue(
        "warning",
        "ALTERNATIVE_METHOD_RATE_EXCESSIVE",
        "Alternative-method rows are " + (rate * 100).toFixed(1) + "% of marked rows, which is " +
          "far above any paper measured so far. Check the alternative-block detection.",
        {},
      );
    } else if (rate > 0.3) {
      addIssue(
        "warning",
        "ALTERNATIVE_METHOD_RATE_HIGH",
        "Alternative-method rows are " + (rate * 100).toFixed(1) + "% of marked rows.",
        {},
      );
    }
  }

}

// REPAIR_DID_NOT_CLEAR_BLOCKERS is deliberately NOT here: it depends on the
// final blocking count, so it is injected after that count is computed. There
// is no second repair pass -- another $0.25 with no evidence it converges --
// so naming the surviving failure is the honest alternative to letting it
// disappear into a generic "not ready for approval".
