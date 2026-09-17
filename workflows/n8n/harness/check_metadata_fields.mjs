// The metadata fields nothing has ever checked: subtopics, skills, methods,
// difficulty_level.
//
// WHY THESE ARE DIFFERENT FROM main_topic
// ---------------------------------------
// main_topic draws on a controlled vocabulary, so "is this value legal" and "is
// this value right" are separable questions. These four are not like that:
// three are free text and one is a subjective integer. There is no list to
// check them against, so the honest move is to say what CAN be checked and be
// explicit about what cannot.
//
//   methods      CHECKABLE against source, but only for NAMED TECHNIQUES. The
//                mark scheme states the official solution, so metadata claiming
//                a named technique the solution never uses is invented -- the
//                9709/41 Q6 defect from batch 1, where the metadata asserted
//                coefficient-of-restitution and energy methods that the official
//                solution does not use.
//
//   subtopics    Same test, same limits.
//
// A REJECTED FIRST DESIGN, recorded because the reason generalises
// -------------------------------------------------------------------
// The first version of this script flagged any metadata phrase whose salient
// words were all absent from the question and mark scheme. It produced 108
// findings across 138 rows, and hand-checking showed most were wrong:
//
//   "Rewrite in completed-square form"  on a question that literally gives
//                                       y = 4(x-3)^2 - 8
//   "Apply the fundamental theorem of calculus"
//   "Pythagorean identities", "Binomial probabilities"
//
// All correct descriptions. The words are absent because Cambridge writes
// mathematics, not commentary. Metadata is prose ABOUT maths; the source IS
// maths; there is no lexical overlap to mine. Absence of a word proves nothing.
//
// What does work is a named technique with BOTH a prose form and a notation
// form, so the source has somewhere to leave a trace: Poisson appears as the
// word or as `Po(`, binomial as the word or as `C_`. Only then does absence
// mean something. That is the test below, and it is deliberately narrow.
//
//   skills       WEAKLY checkable. Skills are deliberately abstract ("interpret
//                a transformed quadratic"), so absence from the source text is
//                normal rather than suspicious. Only structural defects are
//                reported: empty, duplicated, or absurdly long.
//
//   difficulty   NOT CHECKABLE for correctness. There is no ground truth for
//                difficulty and this script does not invent one. What it does
//                is flag internal INCONSISTENCY: a 1-mark question rated hard,
//                or an 11-mark multi-part question rated easy. That is a
//                different and much weaker claim than "this difficulty is
//                wrong", and it is deliberately reported as such.
//
// Read-only against live Supabase. No model, no cost.
//
//   node workflows/n8n/harness/check_metadata_fields.mjs
//   node workflows/n8n/harness/check_metadata_fields.mjs --verbose

import { select } from "./supabase_client.mjs";

const verbose = process.argv.includes("--verbose");

// Findings read against the printed question and mark scheme and judged correct
// as written. Same golden-override role as the ADJUDICATED list in
// check_metadata_topics.mjs: a settled row must stop re-raising, or the report
// becomes noise a reviewer learns to skip -- which is exactly how the warning
// on 9709/12 Q6(b) went unheeded until it had cost a published mark.
const ADJUDICATED = new Set([
  '62|2024|may_june|5|claims "binomial"',   // (c) IS the conditional-binomial result for Po sums
  '62|2024|may_june|3|claims "binomial"',   // a proportion confidence interval IS normal-approx-to-binomial
  '52|2024|feb_march|4|claims "binomial"',  // (c) n=80, p=0.2 -- normal approximation to a binomial
]);

// Named techniques. `claim` is how metadata would name it; `trace` is every way
// Cambridge could show it, in words OR notation. A finding needs the claim
// present and every trace absent, which is why each trace list is generous --
// one missed spelling produces a confident false accusation.
const TECHNIQUES = [
  // Trace lists were widened three times against real false positives. Every
  // addition below is there because the narrower version accused a CORRECT row:
  //   Poisson       9709/62 Q5 marks it purely as e^{-3.1}(1 + 3.1 + ...)
  //   binomial      9709/12 Q1 marks only the coefficients, 240 = 12 x 80a^2
  //   implicit      9709/32 Q4 writes \frac{d}{dx}(ye^{2x}) ... \frac{dy}{dx}
  //   friction      9709/41 Q4 calls it "work done against resistance"
  // The lesson generalises: Cambridge marks in notation, so a technique whose
  // notation cannot be pinned down does not belong in this list at all.

  // ---- Probability and Statistics ----
  { name: "Poisson", claim: /\bpoisson\b/i, trace: /poisson|\bpo\s*[(\\]|\\lambda|e\^\{?\s*-|\bmean\b/i },
  { name: "binomial", claim: /\bbinomial\b/i, trace: /binomial|\bb\s*\(|c_|\\binom|\bnc[rx]\b|expansion|coefficient|\bnp\b|\(1\s*-\s*p\)/i },
  { name: "hypothesis test", claim: /\bhypothes/i, trace: /hypothes|h_?\{?[01]|significan|critical region|reject|accept h|test/i },
  { name: "confidence interval", claim: /\bconfidence interval\b/i, trace: /confidence|interval|\\pm|z\s*\\times/i },
  { name: "unbiased estimate", claim: /\bunbiased\b/i, trace: /unbiased|\\bar\{?x|s\^\{?2|n\s*-\s*1|\\sum/i },
  { name: "Venn diagram", claim: /\bvenn\b/i, trace: /venn|\\cup|\\cap|union|intersect/i },
  { name: "tree diagram", claim: /\btree diagram\b/i, trace: /tree|branch|\\times.*\\times/i },

  // ---- Mechanics ----
  { name: "coefficient of restitution", claim: /\brestitution\b/i, trace: /restitution|\be\s*=|coalesc|rebound/i },
  { name: "conservation of momentum", claim: /\bconservation of momentum\b/i, trace: /momentum|m\s*_?1|mv|impulse|collid|collision/i },
  { name: "friction", claim: /\bcoefficient of friction\b/i, trace: /friction|\\mu|\bmu\b|resistance|resisting|smooth/i },

  // ---- Pure ----
  { name: "integration by parts", claim: /\bintegration by parts\b/i, trace: /by parts|u\s*v|\\int\s*v|\\int.*\\mathrm\{d\}/i },
  { name: "Maclaurin series", claim: /\bmaclaurin\b/i, trace: /maclaurin|f'?'?\s*\(\s*0\s*\)|series|expansion/i },
  { name: "iteration", claim: /\biterat/i, trace: /iterat|x_\{?n|converge|sign change|decimal places/i },
  { name: "Argand diagram", claim: /\bargand\b/i, trace: /argand|complex|conjugate|\\mathrm\{i\}|imaginary|modulus|\barg\b/i },
];


const normalise = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
const [papers, questions, parts, markRows, metadata] = await Promise.all([
  select("shamo_papers", { columns: "id,paper_variant,year,exam_session" }),
  select("shamo_questions", { columns: "id,paper_id,question_number,stem_markdown,total_marks" }),
  select("shamo_question_parts", { columns: "question_id,prompt_markdown,marks" }),
  select("shamo_mark_scheme_items", { columns: "question_id,content_markdown,guidance_markdown" }),
  select("shamo_question_metadata", {
    columns: "question_id,main_topic,subtopics,skills,methods,question_style,difficulty_level,classification_confidence",
  }),
]);

const paperById = new Map(papers.map((p) => [p.id, p]));
const questionById = new Map(questions.map((q) => [q.id, q]));
const sourceText = new Map();
// Kept UN-normalised as well. Notation traces are case- and symbol-sensitive:
// `Po(` and `C_` and `\Phi` all vanish under lowercasing and whitespace
// collapsing, and those are exactly the traces the technique check relies on.
const rawSourceText = new Map();
const add = (id, ...bits) => {
  sourceText.set(id, (sourceText.get(id) ?? "") + " " + bits.map(normalise).join(" "));
  rawSourceText.set(id, (rawSourceText.get(id) ?? "") + " " + bits.map((b) => String(b ?? "")).join(" "));
};
for (const q of questions) add(q.id, q.stem_markdown);
for (const p of parts) add(p.question_id, p.prompt_markdown);
for (const m of markRows) add(m.question_id, m.content_markdown, m.guidance_markdown);

const partCount = new Map();
for (const p of parts) partCount.set(p.question_id, (partCount.get(p.question_id) ?? 0) + 1);

const findings = [];
let adjudicated = 0;
const stats = {
  rows: 0,
  structural: 0,
  fabricatedMethod: 0,
  fabricatedSubtopic: 0,
  difficultyOutlier: 0,
};

// Difficulty is judged only against the corpus's own marks/difficulty relation,
// so the thresholds are derived, not asserted. A rating is called inconsistent
// only when it sits outside the observed range for questions of that size.
const byMarks = new Map();
for (const meta of metadata) {
  const q = questionById.get(meta.question_id);
  if (!q || q.total_marks == null || meta.difficulty_level == null) continue;
  const bucket = q.total_marks <= 3 ? "small" : q.total_marks <= 7 ? "medium" : "large";
  const list = byMarks.get(bucket) ?? [];
  list.push(meta.difficulty_level);
  byMarks.set(bucket, list);
}
const difficultyBand = new Map();
for (const [bucket, values] of byMarks) {
  const sorted = [...values].sort((a, b) => a - b);
  // 10th and 90th percentile of what the model itself produced for that size.
  difficultyBand.set(bucket, [
    sorted[Math.floor(sorted.length * 0.1)],
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9))],
  ]);
}

for (const meta of metadata) {
  const question = questionById.get(meta.question_id);
  if (!question) continue;
  const paper = paperById.get(question.paper_id);
  if (!paper) continue;
  const label = `${paper.paper_variant} ${paper.year} ${paper.exam_session} Q${question.question_number}`;
  const text = sourceText.get(meta.question_id) ?? "";
  stats.rows += 1;

  const key = `${paper.paper_variant}|${paper.year}|${paper.exam_session}|${question.question_number}`;
  const push = (kind, detail) => {
    for (const settled of ADJUDICATED) {
      if (settled.startsWith(key + "|") && detail.startsWith(settled.slice(key.length + 1))) {
        adjudicated += 1;
        return;
      }
    }
    findings.push({ kind, label, detail, confidence: meta.classification_confidence });
  };

  // ---- structural -------------------------------------------------------
  const arrays = { subtopics: meta.subtopics, skills: meta.skills, methods: meta.methods };
  for (const [name, value] of Object.entries(arrays)) {
    const list = Array.isArray(value) ? value : [];
    if (!list.length) {
      stats.structural += 1;
      push("EMPTY FIELD", `${name} is empty`);
      continue;
    }
    const seen = new Set(list.map((v) => normalise(v)));
    if (seen.size !== list.length) {
      stats.structural += 1;
      push("DUPLICATE ENTRIES", `${name} repeats an entry`);
    }
    const overlong = list.filter((v) => String(v).length > 320);
    if (overlong.length) {
      stats.structural += 1;
      push("OVERLONG ENTRY", `${name} has an entry of ${String(overlong[0]).length} characters`);
    }
  }
  if (meta.difficulty_level == null) {
    stats.structural += 1;
    push("EMPTY FIELD", "difficulty_level is null");
  }

  // ---- named techniques vs the official solution -------------------------
  // Only named techniques, and only when the source shows no trace of them in
  // words OR notation. Everything else is paraphrase and is not checkable --
  // see the rejected first design in the header.
  const rawSource = rawSourceText.get(meta.question_id) ?? "";
  for (const [field, values] of [["method", meta.methods], ["subtopic", meta.subtopics]]) {
    for (const entry of Array.isArray(values) ? values : []) {
      for (const technique of TECHNIQUES) {
        if (!technique.claim.test(String(entry))) continue;
        if (technique.trace.test(rawSource)) continue;
        if (field === "method") stats.fabricatedMethod += 1;
        else stats.fabricatedSubtopic += 1;
        push(
          field === "method" ? "METHOD UNSUPPORTED" : "SUBTOPIC UNSUPPORTED",
          `claims "${technique.name}" ("${String(entry).slice(0, 80)}") but neither the question nor the mark scheme shows any trace of it`,
        );
      }
    }
  }

  // ---- difficulty: consistency only, never correctness -------------------
  if (meta.difficulty_level != null && question.total_marks != null) {
    const bucket = question.total_marks <= 3 ? "small" : question.total_marks <= 7 ? "medium" : "large";
    const band = difficultyBand.get(bucket);
    if (band && (meta.difficulty_level < band[0] || meta.difficulty_level > band[1])) {
      stats.difficultyOutlier += 1;
      push(
        "DIFFICULTY OUTLIER",
        `rated ${meta.difficulty_level} on a ${question.total_marks}-mark question (${partCount.get(question.id) ?? 0} parts); ` +
          `comparable questions in this corpus run ${band[0]}-${band[1]}`,
      );
    }
  }
}

console.log("\nsubtopics / skills / methods / difficulty -- read-only, no cost\n");
console.log(`rows examined                       ${stats.rows}`);
console.log(`structural defects                  ${stats.structural}`);
console.log(`methods unsupported by the source   ${stats.fabricatedMethod}`);
console.log(`subtopics unsupported by the source ${stats.fabricatedSubtopic}`);
console.log(`difficulty inconsistent for size    ${stats.difficultyOutlier}`);
console.log(`\ntotal findings                      ${findings.length}`);
console.log(`already adjudicated, suppressed     ${adjudicated}`);

const order = ["EMPTY FIELD", "DUPLICATE ENTRIES", "OVERLONG ENTRY", "METHOD UNSUPPORTED", "SUBTOPIC UNSUPPORTED", "DIFFICULTY OUTLIER"];
const shown = verbose ? findings : findings.slice(0, 25);
if (shown.length) {
  console.log(`\nFINDINGS (${shown.length} of ${findings.length}):\n`);
  for (const f of [...shown].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    console.log(`  [${f.kind}] ${f.label}`);
    console.log(`      ${f.detail}${f.confidence != null ? `  (confidence ${f.confidence})` : ""}`);
  }
}

console.log(
  "\nREAD THIS BEFORE ACTING ON THE ABOVE.\n" +
    "  METHOD/SUBTOTAL UNSUPPORTED is the only strong signal here, and even it is\n" +
    "  a prompt to look, not a verdict -- metadata legitimately paraphrases.\n" +
    "  DIFFICULTY OUTLIER makes NO claim that a rating is wrong. Difficulty has no\n" +
    "  ground truth in this corpus; the band is the model's own output, so this\n" +
    "  measures self-consistency and nothing more.\n",
);
