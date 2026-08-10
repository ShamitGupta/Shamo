// Is the assigned main_topic supported by what the question actually says?
//
// WHY
// ---
// Every other check in this harness has an independent witness. Mark rows are
// checked against the printed subtotal; content against the PDF text layer; OCR
// against the PDF's own characters. Topic classification had none: the only
// thing vouching for a topic was the model that chose it.
//
// The vocabulary rules already catch a topic that is invalid or belongs to the
// wrong paper family. They cannot catch a topic that is valid, in-domain, and
// simply wrong -- which is the case that matters, because it is the one that
// silently degrades search and recommendation.
//
// METHOD
// ------
// Each topic carries signature terms drawn from the syllabus and from the way
// Cambridge actually words questions and mark schemes. Evidence is gathered from
// the question stem, its part prompts, and its mark-scheme rows, and scored per
// topic. Two things are then reported:
//
//   MISSING HALLMARK  the topic has a defining feature the text does not contain
//   NO EVIDENCE       the assigned topic has no supporting term anywhere
//   STRONGER RIVAL    a different in-domain topic has clearly more support
//
// MISSING HALLMARK is the strongest of the three and the only near-certain one.
// Some topics are defined by a feature that cannot be absent: a Differential
// Equations question contains a differential equation, a Vectors question
// contains a vector. Scoring can be argued with; a missing hallmark cannot.
//
// This is deliberately NOT a classifier. It never proposes a topic as truth --
// it says "the text does not look like this topic", which is a question for a
// reviewer. Terms are evidence of presence, not proof: `mean` appears in both
// Representation of Data and Sampling and Estimation, so a single shared term is
// weak and only a clear margin is reported.
//
// Read-only against live Supabase. No model, no cost.
//
//   node workflows/n8n/harness/check_metadata_topics.mjs
//   node workflows/n8n/harness/check_metadata_topics.mjs --verbose

import { select } from "./supabase_client.mjs";

const verbose = process.argv.includes("--verbose");
// A rival must beat the assigned topic by more than this to be worth reporting.
const MARGIN = 2;

const DOMAIN_BY_COMPONENT = {
  1: "Pure Mathematics",
  2: "Pure Mathematics",
  3: "Pure Mathematics",
  4: "Mechanics",
  5: "Probability and Statistics",
  6: "Probability and Statistics",
};

// Signature terms per topic. Lower case. A term beginning with a letter is
// matched at a word boundary, so `integrat` still covers integrate/integration
// but `tan` no longer matches con-STAN-t and `sin` no longer matches u-SIN-g.
// That bug silently gave Trigonometry a point on any question containing the
// word "constant", which is most of them.
const SIGNATURES = {
  // ---- Pure Mathematics ----
  Algebra: ["quadratic", "discriminant", "polynomial", "factor theorem", "remainder", "partial fraction", "modulus of", "inequality", "solve the equation", "solutions of the equation", "in the form", "complete the square", "roots of", "divid"],
  Functions: ["inverse function", "domain", "range of", "composite", "one-one", "f^{-1}", "fg(", "gf(", "transformation", "transformed", "translation", "stretch", "reflection in the"],
  "Coordinate Geometry": ["equation of the circle", "gradient", "midpoint", "perpendicular", "equation of the line", "coordinates of", "centre of the circle", "normal to the curve", "tangent to the curve"],
  "Circular Measure": ["radian", "arc length", "sector", "segment", "arc ab"],
  Trigonometry: ["sin", "cos", "tan", "identity", "sec", "cosec", "cot", "r\\cos", "r\\sin", "degrees", "trigonometric"],
  Series: ["arithmetic progression", "geometric progression", "progression", "common difference", "common ratio", "sum to infinity", "binomial expansion", "expansion of", "first three terms", "nth term", "convergent series", "coefficient of x", "sum of the first", "binomial coefficient"],
  Calculus: ["differentiat", "integrat", "stationary point", "rate of change", "area under", "volume of revolution", "chain rule", "product rule", "dy/dx", "\\frac{dy}{dx}", "maximum or minimum", "gradient of the curve", "gradient of the chord", "as h tends", "limiting value"],
  "Exponential and Logarithmic Functions": ["\\ln", "logarithm", "\\log", "e^{", "exponential"],
  "Numerical Methods": ["iterat", "x_{n+1}", "sign change", "converge", "to 3 decimal places", "root of the equation", "newton"],
  Vectors: ["vector", "position vector", "scalar product", "angle between", "\\mathbf{i}", "unit vector", "magnitude of"],
  "Complex Numbers": ["complex number", "argand", "conjugate", "modulus and argument", "\\mathrm{i}", "real and imaginary"],
  "Differential Equations": ["differential equation", "separat", "general solution", "particular solution", "\\frac{dy}{dx}="],

  // ---- Mechanics ----
  "Forces and Equilibrium": ["equilibrium", "resultant", "coplanar", "friction", "normal contact", "coefficient of friction", "resolv", "magnitude and direction"],
  Kinematics: ["velocity-time", "displacement-time", "acceleration of", "distance travelled", "projectile", "vertically upwards", "speed of projection", "retardation", "graph which models the motion"],
  "Newton's Laws of Motion": ["newton", "tension", "light inextensible string", "pulley", "connected by", "mass", "towing", "tow-bar", "acceleration"],
  "Energy, Work and Power": ["work done", "kinetic energy", "potential energy", "power", "watt", "conservation of energy", "winch", "driving force"],
  Momentum: ["momentum", "collid", "collision", "impulse", "coalesc", "after the collision"],

  // ---- Probability and Statistics ----
  "Representation of Data": ["histogram", "cumulative frequency", "box-and-whisker", "median", "quartile", "stem-and-leaf", "standard deviation", "summarised in the", "coded", "\\sum(x", "class interval", "frequency density"],
  "Permutations and Combinations": ["arrangement", "how many ways", "permutation", "combination", "different selections", "stand in a line", "committee"],
  Probability: ["probability that", "independent", "mutually exclusive", "tree diagram", "conditional", "venn", "at random from the bag", "given that"],
  "Discrete Random Variables": ["probability distribution", "e(x)", "var(x)", "expectation", "table of", "discrete random variable"],
  "The Binomial and Geometric Distributions": ["binomial", "b(", "geometric distribution", "geo(", "independently of all other", "on any attempt"],
  "The Normal Distribution": ["normal distribution", "n(", "standardis", "\\phi", "normally distributed", "z-value"],
  "The Poisson Distribution": ["poisson", "po(", "po}", "\\lambda", "e^{-", "singly, randomly and independently", "average number of", "per hour", "10-second"],
  "Linear Combinations of Random Variables": ["linear combination", "x_1", "x_2", "independent random", "two independent random values", "3x_2", "independent distributions", "total mass", "total weight", "sum of two", "times the mass", "combined mass"],
  "Continuous Random Variables": ["probability density function", "p.d.f", "cumulative distribution function", "continuous random variable", "\\int", "density function"],
  "Sampling and Estimation": ["confidence interval", "unbiased estimate", "random sample", "sampling distribution", "population mean", "population variance", "sample of"],
  "Hypothesis Tests": ["hypothes", "significance level", "h_0", "h_1", "type i error", "type ii error", "critical region", "reject", "test whether", "suspect"],
};

// A hallmark is a feature the topic cannot exist without. If none of these
// appear anywhere in the question or its mark scheme, the label is wrong --
// not merely weakly supported. Only topics with a genuinely non-negotiable
// feature belong here; a topic that can be worded many ways must be left out,
// because a false hallmark produces confident nonsense.
//
// Deliberately absent: Algebra, Calculus, Probability, Representation of Data
// and the Mechanics topics. Each can be examined without any fixed phrase.
const HALLMARKS = {
  // NOT `\frac{dy}{dx}=`. Every parametric-differentiation question shows a
  // derivative equal to something; that makes it calculus, not a differential
  // equation. Including it let 9709/21 Q6 pass as a DE when it has none.
  "Differential Equations": ["differential equation", "rate of increase", "rate of decrease", "proportional to", "separating the variables", "general solution"],
  "Complex Numbers": ["complex", "argand", "\\mathrm{i}", "conjugate", "imaginary"],
  Vectors: ["vector", "\\mathbf", "\\overrightarrow", "position of the point"],
  "Circular Measure": ["radian", "arc", "sector", "segment"],
  "Numerical Methods": ["iterat", "x_{n+1}", "sign change", "decimal places", "converge"],
  // `po(` is not enough: Cambridge typesets it as `\text{Po}(3.1)`, so the
  // parenthesis is separated from the name by a closing brace. Notation forms
  // must be listed or the hallmark accuses correct rows.
  "The Poisson Distribution": ["poisson", "po(", "po}", "\\lambda", "e^{-"],
  "The Normal Distribution": ["normal", "n(", "n}", "\\phi", "standardis", "z ="],
  // Cambridge routinely examines these without ever printing the words
  // "binomial" or "geometric" -- 9709/52 F/M Q2 describes a repeated trial and
  // the mark scheme writes ^{10}C_8(0.7)^8(0.3)^2. The combinatorial notation
  // and the "on any attempt" phrasing are the real tells.
  // Widened after batch 4: Cambridge sets both distributions without ever
  // naming them. 9709/51 O/N Q2 is Geo(1/6) written as "thrown repeatedly until
  // a 6 is obtained", and Q5 is B(7, 0.6) written as "in a week (7 days) ... on
  // at least 5 days". Both were flagged and both labels were right, so the list
  // was too narrow rather than the metadata being wrong.
  "The Binomial and Geometric Distributions": ["binomial", "b(", "geometric distribution", "geo(", "c_", "}c", "on any attempt", "independently of all other", "each attempt", "on each occasion", "repeatedly until", "for the first time on the", "for the third time on the", "at least 5 days", "on at least"],
  "Hypothesis Tests": ["hypothes", "significance", "h_0", "h_1", "critical region", "type i", "type ii", "test at the", "reject"],
  "Sampling and Estimation": ["confidence interval", "unbiased", "sample", "population"],
  "Permutations and Combinations": ["arrangement", "how many ways", "selection", "different orders", "code", "committee"],
  Series: ["progression", "expansion", "series", "coefficient of x", "sum to infinity"],
};

// Near-deterministic class rules. Scoring only flags a big margin, so a
// systematic confusion where the wrong topic still scores respectably slips
// through -- four binomial-expansion questions labelled `Algebra` did exactly
// that. These say: whatever else the question touches, this feature settles it.
//
// `component` restricts a rule to the papers where it holds. That is not a
// convenience: in Paper 1 the expansion of (a+b)^n is Series, while in Paper 3
// the expansion of (1+x)^n for rational n sits under Algebra beside partial
// fractions. The same words, two correct answers, decided by the component.
const CONFUSABLE = [
  {
    name: "progression -> Series",
    expect: "Series",
    test: (t) => /\b(arithmetic|geometric) progression/.test(t),
  },
  {
    name: "binomial expansion -> Series (Paper 1 only)",
    expect: "Series",
    component: [1],
    test: (t) => /\bexpansion of\b/.test(t) && /coefficient|first (three|four) terms|term in/.test(t),
  },
  {
    name: "modulus inequality -> Algebra",
    expect: "Algebra",
    test: (t) => /\|\s*x\s*-|\\left\|/.test(t) && /inequality/.test(t),
  },
  {
    name: "printed differential equation -> Differential Equations",
    expect: "Differential Equations",
    test: (t) => /\bdifferential equation\b/.test(t),
  },
  // When the stem DECLARES a distribution, the topic is that distribution.
  // 9709/62 Q5 opens "X ~ Po(3.1)" and was labelled `Probability`, which the
  // scoring check could not see because a Poisson question is naturally full of
  // the words "probability that" and "independent". A declared distribution is
  // not a matter of emphasis -- it is the examiner naming the topic.
  {
    name: "stem declares Po(...) -> The Poisson Distribution",
    expect: "The Poisson Distribution",
    test: (t) => /\\sim\s*\\?(?:text|mathrm)?\{?\s*po\s*\}?\s*\(|~\s*po\s*\(/.test(t),
  },
  {
    name: "stem declares N(...) -> The Normal Distribution",
    expect: "The Normal Distribution",
    // Excludes questions that also declare another distribution, which are
    // genuinely about combining them rather than about the normal alone.
    test: (t) =>
      /\\sim\s*\\?(?:text|mathrm)?\{?\s*n\s*\}?\s*\(|~\s*n\s*\(/.test(t) &&
      !/\\sim\s*\\?(?:text|mathrm)?\{?\s*(?:po|b|geo)\s*\}?\s*\(/.test(t),
  },
];

// Rows examined against the printed question and mark scheme and judged
// correct as labelled. They keep flagging because they genuinely span two
// topics; without this list every future run re-raises settled work and the
// report slowly becomes noise a reviewer learns to skip.
//
// This is the golden-override half of the standing rule: a review finding
// becomes either a check or a recorded adjudication, never a loose memory.
const ADJUDICATED = new Map([
  ["22|2024|may_june|5", "Calculus. Division (3 marks) then integration (5). The integral is the substance; the division is the means. Reviewed 2026-08-09."],
  ["21|2024|may_june|7", "Calculus. Same shape as 9709/22 Q5 -- division (3 marks) then a 6-mark integral. Reviewed 2026-08-09."],
  ["41|2024|may_june|4", "Energy, Work and Power. Needs P = Fv before Newton's laws can be applied; genuinely spans two Mechanics topics. Reviewed 2026-08-09."],
  ["41|2024|may_june|5", "Energy, Work and Power. Part (b) marks the work-energy principle as the primary route. Reviewed 2026-08-09."],
  // Batch 4, read against the printed questions on 9 August 2026.
  ["22|2024|feb_march|2", "Algebra. The modulus function sits under Algebra in the Paper 2 syllabus; the question sketches |3x-7| only to solve |3x-7| = k(x-4). Flagged for 'graph'/'axes', which is the carrier, not the skill. Reviewed 2026-08-09."],
  ["31|2024|may_june|1", "Algebra. Expansion of (1-2x)^(1/2) for RATIONAL n, which is Paper 3 Algebra beside partial fractions -- not Paper 1 Series. This is the documented component-dependent split. Reviewed 2026-08-09."],
  ["51|2025|oct_nov|2", "The Binomial and Geometric Distributions. A fair dice thrown repeatedly until a 6 appears is Geo(1/6); part (b) is negative binomial. Cambridge never names either distribution, which is why scoring finds nothing. Reviewed 2026-08-09."],
  ["51|2025|oct_nov|5", "The Binomial and Geometric Distributions. Part (a) is B(7, 0.6) -- 'in a week (7 days) ... on at least 5 days'. Part (b) approximates, but the assessed distribution is binomial. Reviewed 2026-08-09."],
]);

function normalise(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ");
}

// Terms starting with a letter are anchored at a word boundary so a short term
// cannot match inside a longer word. Trailing is left open on purpose, so
// `integrat` still covers integrate/integration/integrating.
const matcherCache = new Map();
function matches(text, term) {
  if (!/^[a-z]/.test(term)) return text.includes(term);
  let re = matcherCache.get(term);
  if (!re) {
    re = new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    matcherCache.set(term, re);
  }
  return re.test(text);
}

function scoreTopics(text, allowed) {
  const scores = new Map();
  for (const topic of allowed) {
    const terms = SIGNATURES[topic] ?? [];
    let hits = 0;
    for (const term of terms) if (matches(text, term)) hits += 1;
    scores.set(topic, hits);
  }
  return scores;
}

// ---------------------------------------------------------------------------
const [papers, questions, parts, markRows, metadata] = await Promise.all([
  select("shamo_papers", { columns: "id,paper_variant,year,exam_session,status" }),
  select("shamo_questions", { columns: "id,paper_id,question_number,stem_markdown" }),
  select("shamo_question_parts", { columns: "question_id,prompt_markdown" }),
  select("shamo_mark_scheme_items", { columns: "question_id,content_markdown,guidance_markdown" }),
  select("shamo_question_metadata", { columns: "question_id,main_topic,subtopics,methods,classification_confidence,review_status" }),
]);

const paperById = new Map(papers.map((p) => [p.id, p]));
const textByQuestion = new Map();
const add = (id, ...bits) => {
  const existing = textByQuestion.get(id) ?? "";
  textByQuestion.set(id, existing + " " + bits.map(normalise).join(" "));
};
for (const q of questions) add(q.id, q.stem_markdown);
for (const p of parts) add(p.question_id, p.prompt_markdown);
for (const m of markRows) add(m.question_id, m.content_markdown, m.guidance_markdown);

const questionById = new Map(questions.map((q) => [q.id, q]));

const findings = [];
const settled = [];
const byDomain = new Map();

for (const meta of metadata) {
  const question = questionById.get(meta.question_id);
  if (!question) continue;
  const paper = paperById.get(question.paper_id);
  if (!paper) continue;
  const domain = DOMAIN_BY_COMPONENT[Number(String(paper.paper_variant).charAt(0))];
  if (!domain) continue;

  const allowed = Object.keys(SIGNATURES).filter((topic) => {
    // Restrict rivals to the same domain: a Mechanics paper cannot sensibly be
    // out-scored by a Statistics topic, and allowing it produces noise.
    if (domain === "Mechanics") return ["Forces and Equilibrium", "Kinematics", "Newton's Laws of Motion", "Energy, Work and Power", "Momentum"].includes(topic);
    if (domain === "Probability and Statistics") return ["Representation of Data", "Permutations and Combinations", "Probability", "Discrete Random Variables", "The Binomial and Geometric Distributions", "The Normal Distribution", "The Poisson Distribution", "Linear Combinations of Random Variables", "Continuous Random Variables", "Sampling and Estimation", "Hypothesis Tests"].includes(topic);
    return ["Algebra", "Functions", "Coordinate Geometry", "Circular Measure", "Trigonometry", "Series", "Calculus", "Exponential and Logarithmic Functions", "Numerical Methods", "Vectors", "Complex Numbers", "Differential Equations"].includes(topic);
  });

  const text = textByQuestion.get(meta.question_id) ?? "";
  const scores = scoreTopics(text, allowed);
  const assigned = scores.get(meta.main_topic) ?? 0;
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0];

  const stats = byDomain.get(domain) ?? { rows: 0, supported: 0, confusable: 0, hallmark: 0, noEvidence: 0, rival: 0 };
  stats.rows += 1;

  const key = `${paper.paper_variant}|${paper.year}|${paper.exam_session}|${question.question_number}`;
  const adjudication = ADJUDICATED.get(key);
  if (adjudication) {
    // Counted as supported: a human read it against the source and kept it.
    // Leaving it in the flag list would mean the report never converges.
    stats.supported += 1;
    settled.push({
      paper: `${paper.paper_variant} ${paper.year} ${paper.exam_session}`,
      question: question.question_number,
      assigned: meta.main_topic,
      note: adjudication,
    });
    byDomain.set(domain, stats);
    continue;
  }

  const component = Number(String(paper.paper_variant).charAt(0));
  const brokenRule = CONFUSABLE.find(
    (rule) =>
      (!rule.component || rule.component.includes(component)) &&
      rule.test(text) &&
      meta.main_topic !== rule.expect,
  );
  if (brokenRule) {
    stats.confusable += 1;
    findings.push({
      kind: "CONFUSABLE CLASS",
      paper: `${paper.paper_variant} ${paper.year} ${paper.exam_session}`,
      question: question.question_number,
      assigned: meta.main_topic,
      detail: `${brokenRule.name}: the question carries the defining feature but is not labelled ${brokenRule.expect}`,
      confidence: meta.classification_confidence,
    });
    byDomain.set(domain, stats);
    continue;
  }

  const hallmarks = HALLMARKS[meta.main_topic];
  if (hallmarks && !hallmarks.some((term) => matches(text, term))) {
    stats.hallmark += 1;
    findings.push({
      kind: "MISSING HALLMARK",
      paper: `${paper.paper_variant} ${paper.year} ${paper.exam_session}`,
      question: question.question_number,
      assigned: meta.main_topic,
      detail: `none of the defining features appear anywhere: ${hallmarks.join(", ")}; best supported is ${best[0]} (${best[1]})`,
      confidence: meta.classification_confidence,
    });
  } else if (assigned === 0) {
    stats.noEvidence += 1;
    findings.push({
      kind: "NO EVIDENCE",
      paper: `${paper.paper_variant} ${paper.year} ${paper.exam_session}`,
      question: question.question_number,
      assigned: meta.main_topic,
      detail: `nothing in the question or mark scheme matches this topic; best supported is ${best[0]} (${best[1]})`,
      confidence: meta.classification_confidence,
    });
  } else if (best[1] - assigned > MARGIN) {
    stats.rival += 1;
    findings.push({
      kind: "STRONGER RIVAL",
      paper: `${paper.paper_variant} ${paper.year} ${paper.exam_session}`,
      question: question.question_number,
      assigned: `${meta.main_topic} (${assigned})`,
      detail: `${best[0]} scores ${best[1]}`,
      confidence: meta.classification_confidence,
    });
  } else {
    stats.supported += 1;
  }
  byDomain.set(domain, stats);
}

console.log("\nmain_topic vs evidence in the question and mark scheme -- read-only, no cost\n");
console.log("domain                          rows   supported    confusable   no hallmark   no evidence   stronger rival");
console.log("-".repeat(107));
let totals = { rows: 0, supported: 0, confusable: 0, hallmark: 0, noEvidence: 0, rival: 0 };
const row = (label, s) =>
  label.padEnd(30) + String(s.rows).padStart(6) + String(s.supported).padStart(12) +
  String(s.confusable).padStart(14) + String(s.hallmark).padStart(14) +
  String(s.noEvidence).padStart(14) + String(s.rival).padStart(17);
for (const [domain, s] of [...byDomain.entries()].sort()) {
  console.log(row(domain, s));
  for (const k of Object.keys(totals)) totals[k] += s[k];
}
console.log("-".repeat(94));
console.log(row("TOTAL", totals));

const shown = verbose ? findings : findings.slice(0, 20);
if (shown.length) {
  console.log(`\nROWS TO REVIEW (${shown.length} of ${findings.length}):\n`);
  for (const f of shown) {
    console.log(`  [${f.kind}] ${f.paper} Q${f.question}  assigned: ${f.assigned}`);
    console.log(`      ${f.detail}${f.confidence != null ? `  (model confidence ${f.confidence})` : ""}`);
  }
} else {
  console.log("\nNo unreviewed rows flagged.");
}

if (settled.length) {
  console.log(`\nALREADY ADJUDICATED (${settled.length}) -- flagged, reviewed against source, kept:\n`);
  for (const f of settled) {
    console.log(`  ${f.paper} Q${f.question}  ${f.assigned}`);
    console.log(`      ${f.note}`);
  }
}

console.log(
  "\nA flag is a REVIEW ITEM, not a verdict. Shared terms make a single match weak,\n" +
    "and a question can legitimately sit across two topics. This says the text does\n" +
    "not look like the assigned topic -- it never claims to know the right one.\n",
);
