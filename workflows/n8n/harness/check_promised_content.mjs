// Find questions that promise a table or diagram they do not contain.
//
//   node workflows/n8n/harness/check_promised_content.mjs [--verbose]
//
// THE BLIND SPOT THIS CLOSES
//
// check_content_vs_pdf.mjs verifies that staged prose appears in the printed
// paper -- it detects INVENTED text. Its own header says the converse is not
// covered: a question missing a block simply has fewer words, and every word it
// still has matches. Dropped content is invisible to it.
//
// Marks do not help either. Dropping a data table removes no mark allocation, so
// the paper still reconciles exactly against the printed [N] values.
//
// FOUND BY THIS CHECK, ON A PAPER THAT HAD PASSED EVERYTHING
//
// 9709/51 M/J 2025 Q3 staged the stem
//
//     "The times recorded for 11 runners from each of the Gulls and the Herons
//      are shown in the table."
//
// with no table anywhere in the question -- not in the stem, not in any part.
// Parts (a) and (b) ask for a back-to-back stem-and-leaf diagram and a median,
// both impossible without the 22 values. The paper reconciled 17/17 parts and
// 50/50 marks, matched the printed allocations exactly, and staged clean.
//
// THE RULE
//
// If a question's text says its data is shown in a table or diagram, then the
// question must actually contain one. A promised TABLE requires markdown table
// markup; an asset does not satisfy it, for the reason given at the test below.
// A promised DIAGRAM requires an asset, since a figure has no textual form.
// Cambridge is highly formulaic in this phrasing, which is what makes the check
// cheap and quiet.
//
// DELIBERATE NARROWNESS
//
// Only explicit referring phrases count -- "shown in the table", "the diagram
// shows", "in the diagram" and similar. A question that merely uses the word
// "table" or "diagram" is ignored, because "draw a table" and "sketch a diagram"
// are instructions to the candidate, not promises of supplied content. That
// distinction is the same one DIAGRAM_REQUIRED_BUT_CANDIDATE_DRAWS_IT makes, and
// getting it wrong is what produced four false blocks in this corpus.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGED = path.join(HERE, "fixtures", "staged");

const verbose = process.argv.includes("--verbose");

// Phrases that PROMISE supplied content. Each requires a definite article or a
// passive construction, so an imperative to the candidate cannot match.
const PROMISES_TABLE = [
  /\b(?:are|is)\s+shown\s+in\s+the\s+table\b/i,
  /\bthe\s+table\s+(?:shows|gives|below|summarises|summarizes)\b/i,
  /\bin\s+the\s+following\s+table\b/i,
  /\bgiven\s+in\s+the\s+table\b/i,
  /\bthe\s+results?\s+are\s+shown\s+in\s+the\s+table\b/i,
];
const PROMISES_DIAGRAM = [
  /\b(?:are|is)\s+shown\s+in\s+the\s+diagram\b/i,
  /\bthe\s+diagram\s+shows\b/i,
  /\bshown\s+in\s+(?:the\s+)?(?:Fig|figure)\b/i,
  /\bthe\s+(?:Fig|figure)\s*\.?\s*\d*\s*shows\b/i,
];

// Markdown table markup: a pipe row followed by a delimiter row.
const HAS_TABLE_MARKUP = /\|[^\n]*\|\s*\n\s*\|\s*:?-{2,}/;

function questionText(question) {
  return [
    question.stem_markdown ?? "",
    ...(question.parts ?? []).map((p) => p.prompt_markdown ?? ""),
  ].join("\n\n");
}

const findings = [];
for (const file of fs.readdirSync(STAGED).filter((f) => f.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(STAGED, file), "utf8"));
  for (const question of data.paper_bundle?.questions ?? []) {
    const text = questionText(question);
    const assets = (question.assets ?? []).length;
    const hasTable = HAS_TABLE_MARKUP.test(text);

    const tablePromise = PROMISES_TABLE.find((re) => re.test(text));
    const diagramPromise = PROMISES_DIAGRAM.find((re) => re.test(text));

    // A promised table must be satisfied by ACTUAL TABLE MARKUP. An asset does
    // not count, and that is the whole point.
    //
    // The first version of this check accepted "an asset exists" as evidence and
    // therefore MISSED the very case it was written for: 9709/51 M/J 2025 Q3
    // carried a phantom asset -- the page barcode, mis-described as "Table of
    // times taken" -- so assets was 1 and the missing table went unreported. The
    // bad asset masked the missing data. Caught by testing the check against the
    // pre-correction bundle instead of assuming it worked.
    //
    // Cambridge data tables OCR reliably into markdown pipe tables, so their
    // absence is the signal. If a table is ever genuinely image-only, this
    // reports it for review rather than passing it silently, which is the right
    // way round.
    if (tablePromise && !hasTable) {
      findings.push({
        paper: data.paper_key,
        run: data.run_id,
        question: question.question_number,
        kind: "TABLE",
        phrase: text.match(tablePromise)[0],
        marks: question.total_marks,
        assets,
      });
    }
    // A promised diagram can only be satisfied by an asset.
    if (diagramPromise && assets === 0) {
      findings.push({
        paper: data.paper_key,
        run: data.run_id,
        question: question.question_number,
        kind: "DIAGRAM",
        phrase: text.match(diagramPromise)[0],
        marks: question.total_marks,
      });
    }
  }
}

console.log("\nQuestions promising content they do not contain -- offline, no cost\n");

if (!findings.length) {
  console.log("  Clean. Every promised table or diagram is present.\n");
} else {
  const byPaper = new Map();
  for (const f of findings) {
    if (!byPaper.has(f.paper)) byPaper.set(f.paper, []);
    byPaper.get(f.paper).push(f);
  }
  for (const [paper, list] of [...byPaper].sort()) {
    console.log(`  ${paper}  (${list.length})`);
    for (const f of list) {
      console.log(`      Q${f.question} (${f.marks} marks) promises a ${f.kind}: "${f.phrase}"`);
      console.log(
        `         but the question carries no ${f.kind === "TABLE" ? "table markup" : "asset"}` +
          (f.kind === "TABLE" && f.assets ? `  (it has ${f.assets} asset(s) -- check they are not page furniture)` : ""),
      );
      if (verbose) console.log(`         run ${f.run}`);
    }
  }
  console.log(
    `\n  ${findings.length} question(s) across ${byPaper.size} paper(s).\n\n` +
      "  Each is content the student needs and does not have. Recover it from the\n" +
      "  OCR page, which usually captured it, and confirm against the PDF. Marks\n" +
      "  still reconcile without it, so no other check sees this.\n",
  );
}

process.exitCode = findings.length ? 1 : 0;
