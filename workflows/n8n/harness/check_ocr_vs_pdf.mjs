// Verify Mistral's OCR against the PDF's own text layer.
//
// WHY THIS EXISTS
// ---------------
// OCR is the one stage nothing checks. Everything downstream faithfully copies
// whatever it produced, so a misread -- `2!` as `2^2`, `/` as `+` -- arrives in
// the database with every validator reporting success. The only detector was a
// human holding the printed paper, which is why review could never drop to a
// sample.
//
// Cambridge PDFs carry a text layer: a second, independent reading of the same
// page, free. This diffs the two.
//
// WHAT IT DELIBERATELY DOES NOT DO
// --------------------------------
// It does not diff the text. PDF extraction mangles mathematical typesetting --
// a stacked fraction loses its bar, superscripts drift ahead of their base, and
// `3.1^2/2!` extracts as "233.1 3.1" over "2! 3!". Any character-level
// comparison drowns in that noise.
//
// Instead it compares the MULTISET of tokens that both representations render
// unambiguously, per page. A factorial is `!` in the PDF and `!` in LaTeX. If
// the PDF page has two and the OCR page has none, something was lost, and it
// does not matter that the surrounding text is unalignable.
//
// Offline and free. Reads fixtures/ocr and fixtures/pdf_text.
//
//   node workflows/n8n/harness/check_ocr_vs_pdf.mjs
//   node workflows/n8n/harness/check_ocr_vs_pdf.mjs --paper 62 --verbose

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const args = process.argv.slice(2);
const only = args.includes("--paper") ? args[args.indexOf("--paper") + 1] : null;
const verbose = args.includes("--verbose");

// ---------------------------------------------------------------------------
// Adobe Symbol font decoding
// ---------------------------------------------------------------------------
// Cambridge typesets maths in Symbol font, so extraction returns private-use
// codepoints, not the characters they render as: `×` arrives as U+F0B4 and `√`
// as U+F0D6. The first version of this check counted literal `×` and reported
// "PDF 0, OCR 21" on page after page -- 54 disagreements that were entirely an
// artefact of not decoding this. The rule is U+F0xx -> Symbol encoding byte 0xxx.
const SYMBOL_FONT = new Map([
  [0xf021, "!"],
  [0xf02b, "+"],
  [0xf02d, "−"],
  [0xf02f, "/"],
  [0xf03d, "="],
  [0xf046, "Φ"],
  [0xf053, "Σ"],
  [0xf070, "π"],
  [0xf0a5, "∞"],
  [0xf0b1, "±"],
  [0xf0b4, "×"],
  [0xf0b8, "÷"],
  [0xf0d6, "√"],
  [0xf0e5, "Σ"],
  [0xf0f2, "∫"],
]);

/**
 * Strip the scanned-paper barcode strip.
 *
 * Cambridge question papers carry a security barcode down the margin. It
 * extracts as a run of Latin Extended codepoints plus a `* 0000800000004 *`
 * candidate marker, and it happens to contain byte values that decode to `×`
 * and `÷`. That produced 20 of 32 flags on 9709/31 alone -- all of them noise
 * from a region that carries no mathematics at all.
 */
function stripBarcode(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((line) => {
      if (/\*\s*\d{8,}\s*\*/.test(line)) return false;
      // A long unbroken run of Latin Extended is the barcode, whatever else
      // shares the line. Ratio alone was not enough: on 9709/61 the barcode sits
      // on the same extracted line as "DO NOT WRITE IN THIS MARGIN", which
      // diluted the ratio below the threshold and let five phantom flags through.
      if (/[ -˿]{8,}/.test(line)) return false;
      const exotic = (line.match(/[Ā-˿]/g) ?? []).length;
      return !(exotic > 4 && exotic / Math.max(line.length, 1) > 0.15);
    })
    .join("\n");
}

function decodeSymbolFont(text) {
  return stripBarcode(text).replace(/[-]/g, (ch) => SYMBOL_FONT.get(ch.charCodeAt(0)) ?? " ");
}

// ---------------------------------------------------------------------------
// Tokens worth comparing
// ---------------------------------------------------------------------------
// Each must satisfy one property: it survives BOTH renderings intact. A symbol
// that PDF extraction sometimes drops would generate noise, not findings.
const SYMBOLS = [
  { name: "factorial", char: "!", latex: [] },
  { name: "divide", char: "÷", latex: [/\\div(?![A-Za-z])/g] },
  // Cambridge prints `×`, but Mistral legitimately renders the same product as
  // `\cdot`. Counting only `\times` made every multiplication look lost.
  { name: "times", char: "×", latex: [/\\times(?![A-Za-z])/g, /\\cdot(?![A-Za-z])/g] },
  { name: "sqrt", char: "√", latex: [/\\sqrt(?![A-Za-z])/g] },
  { name: "sigma", char: "Σ", latex: [/\\Sigma(?![A-Za-z])/g, /\\sum(?![A-Za-z])/g] },
  { name: "phi", char: "Φ", latex: [/\\Phi(?![A-Za-z])/g] },
  { name: "pi", char: "π", latex: [/\\pi(?![A-Za-z])/g] },
  { name: "integral", char: "∫", latex: [/\\int(?![A-Za-z])/g] },
  { name: "infinity", char: "∞", latex: [/\\infty(?![A-Za-z])/g] },
  { name: "plusminus", char: "±", latex: [/\\pm(?![A-Za-z])/g] },
];

/**
 * Count a symbol in OCR markdown.
 *
 * LaTeX spells most of these as commands, so both the literal character and
 * every command spelling count toward the same total. `\!` is a spacing
 * directive, not a factorial, and is removed before counting.
 */
function countInOcr(markdown, symbol) {
  const cleaned = markdown
    // `![img-0.jpeg](...)` is an image reference, not a factorial. This alone
    // accounted for every factorial disagreement on the question papers.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/!\[[^\]]*\]/g, " ")
    // `\!` and friends are LaTeX spacing directives.
    .replace(/\\[!,;:]/g, " ");
  let total = (cleaned.match(new RegExp(escape(symbol.char), "g")) ?? []).length;
  for (const pattern of symbol.latex) {
    total += (cleaned.match(pattern) ?? []).length;
  }
  return total;
}

function countInPdf(text, symbol) {
  return (decodeSymbolFont(text).match(new RegExp(escape(symbol.char), "g")) ?? []).length;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Load and pair
// ---------------------------------------------------------------------------
/**
 * Which OCR run should a paper be scored against?
 *
 * Several runs exist per paper. Sorting filenames picks the wrong one, because
 * the suffix is a run UUID and UUIDs are not chronological -- for 9709/62 that
 * silently selected the superseded v2.1 run (`e1892962`) over the v2.2 one
 * (`9e1805f1`), so the whole check measured OCR that is no longer in use.
 *
 * The runs under review are whichever ones were exported to fixtures/staged,
 * so take the run ids from there and pin to them. Falls back to filename order
 * only when nothing is staged.
 */
function stagedRunIds() {
  const dir = path.join(FIXTURES, "staged");
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).run_id)
      .filter(Boolean),
  );
}

function loadOcr() {
  const dir = path.join(FIXTURES, "ocr");
  const pinned = stagedRunIds();
  const byPaper = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const isPinned = [...pinned].some((id) => file.includes(id));
    const existing = byPaper.get(data.paper_key);
    if (!existing || (isPinned && !existing.isPinned) || (isPinned === existing.isPinned && file > existing.file)) {
      byPaper.set(data.paper_key, { file, data, isPinned });
    }
  }
  return byPaper;
}

function loadPdf() {
  const dir = path.join(FIXTURES, "pdf_text");
  if (!fs.existsSync(dir)) return new Map();
  const byPaper = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    byPaper.set(data.paper_key, data);
  }
  return byPaper;
}

const ocrPapers = loadOcr();
const pdfPapers = loadPdf();

if (!pdfPapers.size) {
  console.error("No PDF text fixtures. Run extract_pdf_text.py first.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------
const findings = [];
const rows = [];
let pagesCompared = 0;

for (const [paperKey, pdf] of [...pdfPapers.entries()].sort()) {
  if (only && !paperKey.endsWith(`_${only}`)) continue;
  const ocr = ocrPapers.get(paperKey);
  if (!ocr) {
    console.log(`  no OCR fixture for ${paperKey} -- skipped`);
    continue;
  }

  let paperFindings = 0;
  let paperPages = 0;

  for (const pdfDoc of pdf.documents) {
    const ocrDoc = ocr.data.documents.find((d) => d.document_type === pdfDoc.document_type);
    if (!ocrDoc) continue;

    // Page counts must agree, or the pages are not the pages we think they are
    // and every comparison below is meaningless.
    if (ocrDoc.pages.length !== pdfDoc.pages.length) {
      findings.push({
        paper: paperKey,
        document: pdfDoc.document_type,
        page: 0,
        symbol: "PAGE_COUNT",
        pdf: pdfDoc.pages.length,
        ocr: ocrDoc.pages.length,
        excerpt: "page counts differ; per-page comparison skipped",
      });
      continue;
    }

    for (const pdfPage of pdfDoc.pages) {
      const ocrPage = ocrDoc.pages.find((p) => p.page_number === pdfPage.page_number);
      if (!ocrPage) continue;
      pagesCompared += 1;
      paperPages += 1;

      const pdfText = pdfPage.text ?? "";
      const ocrText = ocrPage.raw_markdown ?? "";
      // A page whose text layer is empty is a scanned image, not a disagreement.
      if (!pdfText.trim()) continue;

      for (const symbol of SYMBOLS) {
        const inPdf = countInPdf(pdfText, symbol);
        const inOcr = countInOcr(ocrText, symbol);
        if (inPdf === inOcr) continue;
        // Direction is the whole game.
        //
        // PDF > OCR -- the PDF text layer contains a symbol the OCR does not.
        //   Something was LOST in reading the page. Both confirmed corruptions
        //   on 9709/62 sit here: `2! 3!` became `2^2`, and `÷` became `+`.
        //
        // OCR > PDF -- the OCR read a symbol the extractor could not find.
        //   Almost always a pypdf limitation: radical signs and integral signs
        //   are frequently drawn paths rather than text, so they extract as
        //   nothing while OCR, which is reading the rendered image, sees them
        //   perfectly. Reporting these as defects would blame OCR for being
        //   better than the tool checking it.
        const direction = inPdf > inOcr ? "lost" : "extractor";
        findings.push({
          paper: paperKey,
          document: pdfDoc.document_type,
          page: pdfPage.page_number,
          symbol: symbol.name,
          pdf: inPdf,
          ocr: inOcr,
          direction,
          excerpt: contextFor(pdfText, symbol.char),
        });
        if (direction === "lost") paperFindings += 1;
      }
    }
  }
  rows.push({ paperKey, pages: paperPages, findings: paperFindings });
}

function contextFor(rawText, char) {
  const text = decodeSymbolFont(rawText);
  const index = text.indexOf(char);
  if (index < 0) return "";
  return text
    .slice(Math.max(0, index - 45), index + 25)
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const lost = findings.filter((f) => f.direction === "lost");
const extractor = findings.filter((f) => f.direction === "extractor");

console.log("\nOCR vs PDF text layer -- symbol integrity, offline, no cost\n");
console.log("paper                          pages   OCR lost   extractor noise");
console.log("-".repeat(66));
for (const row of rows) {
  const noise = extractor.filter((f) => f.paper === row.paperKey).length;
  console.log(
    row.paperKey.padEnd(31) +
      String(row.pages).padStart(5) +
      String(row.findings).padStart(11) +
      String(noise).padStart(18),
  );
}
console.log("-".repeat(66));
console.log(
  "TOTAL".padEnd(31) +
    String(pagesCompared).padStart(5) +
    String(lost.length).padStart(11) +
    String(extractor.length).padStart(18),
);

const bySymbol = new Map();
for (const finding of lost) {
  bySymbol.set(finding.symbol, (bySymbol.get(finding.symbol) ?? 0) + 1);
}
if (bySymbol.size) {
  console.log("\nOCR lost, by symbol:");
  for (const [name, count] of [...bySymbol.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${name}`);
  }
}

const shown = verbose ? lost : lost.slice(0, 30);
if (shown.length) {
  console.log(`\nOCR LOST A SYMBOL THE PDF HAS (${shown.length} of ${lost.length}) -- review these:\n`);
  for (const finding of shown) {
    console.log(
      `  ${finding.paper} ${finding.document.slice(0, 2)} p${finding.page}  ${finding.symbol}: ` +
        `PDF ${finding.pdf}, OCR ${finding.ocr}`,
    );
    if (finding.excerpt) console.log(`      pdf: ${finding.excerpt}`);
  }
}

console.log(
  `\n${extractor.length} disagreements in the other direction are suppressed: the OCR read a\n` +
    "symbol pypdf could not extract. Radical and integral signs are often drawn\n" +
    "paths rather than text, so that direction measures the extractor, not the OCR.\n" +
    "\nA flag is a CANDIDATE, not a confirmed defect. Confirm against the printed page.\n",
);
