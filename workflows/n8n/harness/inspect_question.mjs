// Diagnostic: show what the parser produced for one question, next to the raw
// OCR table lines it came from. Used when a reconciliation check fails and you
// need to know whether the parser is wrong or the mark scheme is unusual.
//
//   node workflows/n8n/harness/inspect_question.mjs 31 7
//   node workflows/n8n/harness/inspect_question.mjs 31 7 --raw

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkSchemePages, markValue } from "../lib/mark_scheme_parser.mjs";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const [variant, questionArg, ...flags] = process.argv.slice(2);
const question = Number(questionArg);
const SHOW_RAW = flags.includes("--raw");

const bundleDir = path.join(FIXTURES, "bundles");
const file = fs
  .readdirSync(bundleDir)
  .find(
    (f) =>
      f.endsWith(".json") &&
      JSON.parse(fs.readFileSync(path.join(bundleDir, f), "utf8")).pipeline_version === "budget-v2.1" &&
      f.includes(`_${variant}__`),
  );
if (!file) throw new Error(`no v2.1 bundle for variant ${variant}`);

const ocr = JSON.parse(fs.readFileSync(path.join(FIXTURES, "ocr", file), "utf8"));
const msPages = ocr.documents.find((d) => d.document_type === "mark_scheme").pages;

const { items, printedPartTotals, alternativeGroups } = parseMarkSchemePages(msPages);
const rows = items.filter((i) => i._question_number === question);

console.log(`\n=== 9709/${variant} Question ${question} ===\n`);

console.log("PARSED ROWS");
for (const row of rows) {
  const part = row.part_path.length ? `(${row.part_path.join(")(")})` : "--";
  console.log(
    `  p${String(row.source_page_numbers[0]).padStart(2)} ${part.padEnd(8)} ` +
      `${String(row.mark_code ?? "null").padEnd(9)} ` +
      `${row.is_alternative_method ? "ALT " : "    "}` +
      `${(row.content_markdown || "").replace(/\s+/g, " ").slice(0, 58)}`,
  );
}

console.log("\nPRINTED SUBTOTALS vs PARSED PRIMARY SUM");
for (const [key, printed] of Object.entries(printedPartTotals)) {
  const [q, part] = key.split("|");
  if (Number(q) !== question) continue;
  const sum = rows
    .filter((r) => !r.is_alternative_method && r.part_path.join(".") === part)
    .reduce((total, r) => total + markValue(r.mark_code), 0);
  const altSum = rows
    .filter((r) => r.is_alternative_method && r.part_path.join(".") === part)
    .reduce((total, r) => total + markValue(r.mark_code), 0);
  console.log(
    `  ${part ? `(${part})` : "--"}  printed ${printed}  primary ${sum}  alt ${altSum}  ` +
      `${sum === printed ? "ok" : "MISMATCH"}`,
  );
}

const groups = alternativeGroups.filter((g) => g.question_number === question);
if (groups.length) {
  console.log("\nALTERNATIVE GROUPS");
  for (const g of groups) {
    console.log(`  part (${g.part_path.join(".") || "--"}) group ${g.group_index}  value ${g.mark_value}`);
  }
}

if (SHOW_RAW) {
  const pages = [...new Set(rows.flatMap((r) => r.source_page_numbers))];
  console.log("\nRAW OCR TABLE LINES");
  for (const pageNumber of pages) {
    const page = msPages.find((p) => p.page_number === pageNumber);
    console.log(`\n  --- page ${pageNumber} ---`);
    for (const line of page.raw_markdown.split(/\r?\n/)) {
      if (/^\s*\|/.test(line)) console.log(`  ${line.replace(/\s+/g, " ").slice(0, 155)}`);
    }
  }
}
console.log("");
