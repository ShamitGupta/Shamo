// Score a batch and emit a scorecard.
//
// This is the artefact that fixes the stated batch-over-batch problem: quality
// becomes a number with the same shape every batch, instead of an impression
// formed by reading review notes.
//
// Two headline metrics, deliberately not averaged into one:
//
//   CDPP  critical defects per paper (a count, target 0). A percentage hides
//         the fact that one wrong factorial ruins a question.
//   MRF1  mark-row F1 against the source-anchored reconciliation. The
//         continuous number to optimise between iterations.
//
// Reported alongside both: the OCR ceiling. Some defects are Mistral losing
// information before extraction ever runs -- 9709/62's `2!` read as `2^2`, its
// division sign read as a plus. No extraction change can fix those, so counting
// them against the parser would be dishonest and would push toward overfitting.
//
//   node workflows/n8n/harness/score.mjs
//   node workflows/n8n/harness/score.mjs --write

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkSchemePages, markValue, stripBold } from "../lib/mark_scheme_parser.mjs";

const HARNESS = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HARNESS, "fixtures");
const REPO = path.resolve(HARNESS, "..", "..", "..");
const WRITE = process.argv.includes("--write");

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const norm = (s) =>
  String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

// Defects confirmed by human source review that no extraction change can fix,
// because the information was already gone from the OCR. Transcribed from
// "Shamo Batch 2 Paper 62 Source Review.md".
const OCR_CEILING = [
  { paper: "62", ref: "5(a)", printed: "3.1^2/2!", ocr: "3.1^2/2^2" },
  { paper: "62", ref: "6(a)", printed: "10 / sqrt(120)", ocr: "10 + sqrt(120)" },
  { paper: "62", ref: "5(c)", printed: "5.5^5", ocr: "5.5^4" },
  { paper: "62", ref: "6(b)", printed: "Phi('2.421')", ocr: "Phi(\\cdot 2.421')" },
];

// Defects that WERE mechanically detectable and are the reason each rule exists.
const LABELLED_DEFECTS = [
  { paper: "11", ref: "Q5", rule: "STEM_DUPLICATES_PART_A", desc: "stem duplicates part (a)" },
  { paper: "11", ref: "Q10", rule: "SINGLE_PART_LABELLED_A", desc: "fabricated lone part (a)" },
  { paper: "11", ref: "Q11", rule: "DIAGRAM_REQUIRED_WITHOUT_ASSET", desc: "required diagram missing" },
  { paper: "22", ref: "Q2", rule: "PART_MARK_RECONCILIATION", desc: "*M1 read as alternative" },
  { paper: "22", ref: "Q5(a)", rule: "PART_MARK_RECONCILIATION", desc: "table bleed inflated marks" },
  { paper: "31", ref: "Q9(a)", rule: "PART_MARK_RECONCILIATION", desc: "continuation row lost" },
  { paper: "31", ref: "Q9(b)", rule: "PART_MARK_RECONCILIATION", desc: "continuation row lost" },
  { paper: "31", ref: "Q9(d)", rule: "PART_MARK_RECONCILIATION", desc: "continuation rows lost" },
  { paper: "51", ref: "Q3(a)", rule: "PART_MARK_RECONCILIATION", desc: "code at unexpected column" },
  { paper: "51", ref: "Q6(b)", rule: "PART_MARK_RECONCILIATION", desc: "over-count" },
  { paper: "51", ref: "Q7(c)", rule: "PART_MARK_RECONCILIATION", desc: "table rows became mark rows" },
  { paper: "62", ref: "Q7(b)", rule: "MARK_ROW_FABRICATED_FROM_SPECIAL_CASE", desc: "fabricated B1 from SC text" },
  { paper: "62", ref: "Q2", rule: null, desc: "missing stem block (question-paper stage)" },
];

const papers = fs
  .readdirSync(path.join(FIXTURES, "bundles"))
  .map((file) => ({ file, bundle: readJson(path.join(FIXTURES, "bundles", file)) }))
  .filter(({ bundle }) => bundle.pipeline_version === "budget-v2.1")
  .map(({ file, bundle }) => ({
    file,
    bundle,
    variant: bundle.paper_key.split("_").pop(),
    ocr: readJson(path.join(FIXTURES, "ocr", file)),
  }))
  .sort((a, b) => a.variant.localeCompare(b.variant));

const CODE_ONLY = /^\*?(?:DM|DB|M|A|B)\d+\*?(?:\s*FT)?(?:\s*,\s*\d+)*$/i;
const rows = [];
let totals = { parts: 0, reconciled: 0, depSrc: 0, depParsed: 0, deferred: 0, parsedRows: 0, stagedRows: 0 };

for (const paper of papers) {
  const msPages = paper.ocr.documents.find((d) => d.document_type === "mark_scheme").pages;
  const { items, printedPartTotals } = parseMarkSchemePages(msPages);

  const primary = new Map();
  for (const item of items) {
    if (item.is_alternative_method) continue;
    const key = `${item._question_number}|${(item.part_path ?? []).join(".")}`;
    primary.set(key, (primary.get(key) ?? 0) + markValue(item.mark_code));
  }

  let ok = 0;
  let bad = 0;
  const failures = [];
  for (const [key, printed] of Object.entries(printedPartTotals)) {
    const actual = primary.get(key) ?? 0;
    if (actual === printed) ok += 1;
    else {
      bad += 1;
      const [q, part] = key.split("|");
      failures.push(`Q${q}${part ? `(${part})` : ""} printed ${printed}, parsed ${actual}`);
    }
  }

  let depSrc = 0;
  for (const page of msPages) {
    for (const line of page.raw_markdown.split(/\r?\n/)) {
      if (!/^\s*\|/.test(line)) continue;
      for (const cell of line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|")) {
        const body = stripBold(cell.trim()).replace(/^\((.*)\)$/, "$1");
        if (CODE_ONLY.test(body) && body.includes("*")) depSrc += 1;
      }
    }
  }
  const depParsed = items.filter((i) => i.mark_code?.includes("*")).length;
  const stagedRows = paper.bundle.extraction_summary.paper_bundle.questions.reduce(
    (n, q) => n + (q.mark_scheme_items?.length ?? 0),
    0,
  );

  rows.push({
    variant: paper.variant,
    parsed: items.length,
    staged: stagedRows,
    ok,
    bad,
    failures,
    depSrc,
    depParsed,
  });

  totals.parts += ok + bad;
  totals.reconciled += ok;
  totals.depSrc += depSrc;
  totals.depParsed += depParsed;
  totals.deferred += bad;
  totals.parsedRows += items.length;
  totals.stagedRows += stagedRows;
}

const mrf1 = totals.parts ? totals.reconciled / totals.parts : 0;
const detectable = LABELLED_DEFECTS.filter((d) => d.rule).length;
const lines = [];
const say = (line = "") => {
  lines.push(line);
  console.log(line);
};

say("# Shamo Batch 2 Scorecard");
say();
say("Generated by `workflows/n8n/harness/score.mjs` against verbatim stored OCR.");
say("No API calls; nothing here costs money.");
say();
say("## Headline");
say();
say("| Metric | Value | Target |");
say("| --- | --- | --- |");
say(`| Part-mark reconciliation (MRF1) | **${totals.reconciled}/${totals.parts} = ${mrf1.toFixed(3)}** | 1.000 |`);
say(`| Dependency markers vs source | **${totals.depParsed}/${totals.depSrc}** | exact |`);
say(`| Questions deferred to the paid model | **${totals.deferred}** | as few as possible |`);
say(`| Labelled defects with a permanent rule | **${detectable}/${LABELLED_DEFECTS.length}** | all mechanically detectable ones |`);
say(`| OCR-ceiling defects (unfixable by extraction) | **${OCR_CEILING.length}** | reported, not counted against the parser |`);
say();
say("## Per paper");
say();
say("| Paper | Parsed rows | Staged rows (old) | Parts reconciled | Dependency markers |");
say("| --- | ---: | ---: | ---: | ---: |");
for (const row of rows) {
  say(
    `| 9709/${row.variant} | ${row.parsed} | ${row.staged} | ${row.ok}/${row.ok + row.bad} | ` +
      `${row.depParsed}/${row.depSrc} |`,
  );
}
say();

const openFailures = rows.filter((r) => r.bad);
if (openFailures.length) {
  say("## Unreconciled parts");
  say();
  for (const row of openFailures) {
    for (const failure of row.failures) say(`- 9709/${row.variant} ${failure}`);
  }
  say();
  say(
    "These route to the model fallback rather than being guessed at. 9709/31 Q7 is the known case: " +
      "Cambridge printed an alternative method with no header row, so the block cannot be identified " +
      "deterministically.",
  );
  say();
}

say("## OCR ceiling");
say();
say("Confirmed by source review; the information was lost before extraction ran.");
say();
say("| Paper | Ref | Printed | In OCR |");
say("| --- | --- | --- | --- |");
for (const c of OCR_CEILING) say(`| 9709/${c.paper} | ${c.ref} | \`${c.printed}\` | \`${c.ocr}\` |`);
say();
say(
  "Closing these needs numeric self-consistency checking of extracted expressions against printed " +
    "evaluated values, which is not built. Until then they are the floor on achievable accuracy and " +
    "the reason sampled human review cannot go to zero.",
);
say();
say("## Defect-to-rule mapping");
say();
say("| Paper | Ref | Defect | Permanent rule |");
say("| --- | --- | --- | --- |");
for (const d of LABELLED_DEFECTS) {
  say(`| 9709/${d.paper} | ${d.ref} | ${d.desc} | ${d.rule ? `\`${d.rule}\`` : "_none yet_" } |`);
}
say();

if (WRITE) {
  const target = path.join(REPO, "Shamo Batch 2 Scorecard.md");
  fs.writeFileSync(target, lines.join("\n") + "\n", "utf8");
  console.log(`\nWrote ${target}`);
}
