// General numeric self-consistency check: evaluate a stored expression and
// compare it against the evaluated value Cambridge prints beside it.
//
//   node workflows/n8n/harness/check_numeric_consistency.mjs [--verbose]
//
// WHY THIS EXISTS
//
// Every one of the nine mathematical defects corrected on 11-12 August 2026
// was confirmed the same way: by hand, evaluating a stored expression and
// comparing it against a number Cambridge prints in the same cell --
// `[= 1.461]`, `= 0.105`, a trailing `= 0.368`. check_lost_factorials.mjs and
// check_lost_operators.mjs each catch ONE specific shape of that class (a
// dropped `n!`, a comma misread as an operator). Neither is a general
// evaluator, and both say so in their own headers. This is the general
// version: parse whatever arithmetic Cambridge printed, evaluate it, and flag
// anywhere the stored expression does not reach the stored answer. It exists
// to catch the shape nobody has written a narrow check for yet.
//
// WHAT IT FOUND ON FIRST RUN, UNPROMPTED
//
// 9709/63 M/J 2024 Q3, M1: the staged bundle holds
//
//     \frac{0 - (-10^\circ)}{\sqrt[3]{30^\circ}}   [= 1.826]
//
// which is a cube root, and evaluates to 3.218 -- not the printed 1.826.
// Drop the spurious cube-root index and the stray degree markers (this is a
// Normal-distribution standardisation, N(-10, 30), not an angle) and
// \frac{0-(-10)}{\sqrt{30}} = 1.826 exactly. The corruption is already
// present in the raw OCR record (fixtures/ocr, mark scheme page 7), so this
// is a reading defect, not something introduced downstream. Needs source
// confirmation against the printed page before correcting; recorded here as
// a found-not-fixed example because that is what this check actually is for.
//
// THE EVALUATOR
//
// A small recursive-descent parser for LaTeX arithmetic: + - * / (implicit
// juxtaposition too), ^, !, \frac/\dfrac/\tfrac, \sqrt and \sqrt[n]{}, \pi,
// bare e as Euler's number, parenthesis/bracket/brace/absolute-value
// grouping, and a trailing ^\circ treated as a degree marker rather than
// exponentiation. It is deliberately narrow: anything it does not recognise
// (\sin, \cos, \Phi, a bare variable, \text{...}) throws, and a throw means
// "not fully numeric" -- the candidate is silently skipped, not flagged. A
// general evaluator that guessed at symbolic content would be exactly the
// "108 findings on 138 rows" mistake check_metadata_fields.mjs already made
// once. This one only ever speaks when it can actually compute both sides.
//
// A `\text{their}'N'` follow-through placeholder is substituted with the
// literal N before parsing -- Cambridge writes the candidate's own carried
// value this way, and it is exactly as checkable as a bare number once
// substituted.
//
// TWO EXTRACTION SHAPES, MATCHING WHAT CAMBRIDGE ACTUALLY PRINTS
//
//   1. BRACKET   <expr> [= <number>]   -- an inline annotation, evaluated
//      against the expression immediately before it (back to the nearest
//      earlier top-level '=', so a leading label like "E(X-Y) =" is dropped
//      rather than fed to the parser, where it would just throw on the
//      capital E).
//   2. CHAIN      <expr> = <number>    -- a bare trailing equality. Segments
//      are split on top-level '=' (respecting bracket/brace/paren depth) and
//      only STRICTLY ADJACENT segments are compared. This adjacency
//      restriction is load-bearing: a first version compared every pair of
//      parseable segments in a chain, and "8^2 = 0^2 + 2a x 25 => a = 1.28"
//      was flagged as 64 != 1.28 by comparing the two ends across an
//      unparseable middle (the unknown `a`). A = f(x) = C does not imply
//      A = C when f(x) cannot be evaluated; only true neighbours are ever
//      compared.
//
// GUARDS AGAINST FALSE POSITIVES, EACH EARNED BY A REAL ONE ON THIS CORPUS
//
//   * DESCRIBES_WRONG_MATH -- guidance routinely narrates a WRONG method the
//     marker still explains, e.g. "Allow error of 0 x -1 = -1", "... is M0
//     unless ...", or "sigma = 0.017/-1.425 = 0.0119 is not acceptable, A0".
//     These are deliberately inconsistent by design -- they are describing a
//     mistake for grading purposes, not making one. A field mentioning
//     error/mistake/wrong/incorrect/M0/A0/"not acceptable" is skipped whole.
//   * Two bare literals either side of an '=' with no operator on either
//     side (e.g. a mark scheme literally writing "27 = 0" to describe a
//     contradiction an alternate substitution reaches) are not a computation
//     and are not compared -- there is nothing to evaluate.
//   * AWRT ("answer which rounds to") signals Cambridge is deliberately
//     recombining pre-rounded intermediate values for display, which
//     compounds a few tenths of a percent of rounding error by design. A
//     mismatch within a looser AWRT tolerance is not reported.
//
// SCOPE
//
// Staged bundles only -- what would actually be published -- and only
// mark-scheme content_markdown/guidance_markdown, the same fields the other
// arithmetic checks use. Question stems are not scanned; they are almost
// entirely word-problem prose and would mostly just add parse failures. This
// is a report, not a gate: an evaluator this general will occasionally need
// a human to read a borderline case, and that is a cheaper failure mode than
// a corruption nobody looked for.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGED = path.join(HERE, "fixtures", "staged");

const verbose = process.argv.includes("--verbose");

class ParseError extends Error {}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0 || n > 20) throw new ParseError("bad factorial");
  let out = 1;
  for (let k = 2; k <= n; k += 1) out *= k;
  return out;
}

// A small recursive-descent evaluator for LaTeX arithmetic. Throws
// ParseError on anything it does not recognise -- that throw IS the "not
// fully numeric, skip this candidate" signal used by every caller below.
function evaluateExpression(raw) {
  const s = raw;
  let i = 0;

  function skipTrivia() {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i += 1;
      if (s[i] === "$") { i += 1; continue; }
      if (s.startsWith("\\left", i)) { i += 5; continue; }
      if (s.startsWith("\\right", i)) { i += 6; continue; }
      if (s.startsWith("\\qquad", i)) { i += 6; continue; }
      if (s.startsWith("\\quad", i)) { i += 5; continue; }
      if (s.startsWith("\\,", i)) { i += 2; continue; }
      if (s.startsWith("\\;", i)) { i += 2; continue; }
      if (s.startsWith("\\!", i)) { i += 2; continue; }
      break;
    }
  }

  function isDigit(c) { return c >= "0" && c <= "9"; }

  function parseNumber() {
    skipTrivia();
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (!m) throw new ParseError("expected number");
    i += m[0].length;
    return Number(m[0]);
  }

  function expect(lit) {
    skipTrivia();
    if (!s.startsWith(lit, i)) {
      throw new ParseError(`expected ${lit} at ${i}: ...${s.slice(Math.max(0, i - 10), i + 10)}...`);
    }
    i += lit.length;
  }

  function parseBraced(inner) {
    expect("{");
    const v = inner();
    skipTrivia();
    expect("}");
    return v;
  }

  // A trailing ^\circ or ^{\circ} is a degree marker, not exponentiation.
  function tryConsumeDegreeMarker() {
    skipTrivia();
    if (s.startsWith("\\circ", i)) { i += 5; return true; }
    if (s[i] === "{") {
      const save = i;
      i += 1;
      skipTrivia();
      if (s.startsWith("\\circ", i)) {
        i += 5;
        skipTrivia();
        if (s[i] === "}") { i += 1; return true; }
      }
      i = save;
    }
    return false;
  }

  function parsePrimary() {
    skipTrivia();
    const c = s[i];
    if (c === undefined) throw new ParseError("unexpected end");
    if (isDigit(c) || c === ".") return parseNumber();
    if (c === "(") { i += 1; const v = parseExpr(); expect(")"); return v; }
    if (c === "[") { i += 1; const v = parseExpr(); expect("]"); return v; }
    if (c === "|") { i += 1; const v = parseExpr(); expect("|"); return Math.abs(v); }
    if (c === "{") return parseBraced(parseExpr);
    if (c === "\\") {
      if (s.startsWith("\\dfrac", i) || s.startsWith("\\tfrac", i)) {
        i += 6;
        const num = parseBraced(parseExpr);
        const den = parseBraced(parseExpr);
        if (den === 0) throw new ParseError("division by zero");
        return num / den;
      }
      if (s.startsWith("\\frac", i)) {
        i += 5;
        const num = parseBraced(parseExpr);
        const den = parseBraced(parseExpr);
        if (den === 0) throw new ParseError("division by zero");
        return num / den;
      }
      if (s.startsWith("\\sqrt", i)) {
        i += 5;
        let root = 2;
        skipTrivia();
        if (s[i] === "[") { i += 1; root = parseExpr(); expect("]"); }
        const inner = parseBraced(parseExpr);
        if (inner < 0) throw new ParseError("sqrt of negative");
        return inner ** (1 / root);
      }
      if (s.startsWith("\\pi", i)) { i += 3; return Math.PI; }
      throw new ParseError(`unsupported command at ${i}: ${s.slice(i, i + 12)}`);
    }
    if (c === "e") {
      const after = s[i + 1];
      if (after && /[a-zA-Z]/.test(after)) throw new ParseError("identifier, not e");
      i += 1;
      return Math.E;
    }
    throw new ParseError(`unexpected character '${c}' at ${i}`);
  }

  function parseFactor() {
    let v = parsePrimary();
    for (;;) {
      skipTrivia();
      if (s[i] === "!") { i += 1; v = factorial(v); }
      else break;
    }
    return v;
  }

  function parseUnary() {
    skipTrivia();
    if (s[i] === "-") { i += 1; return -parseUnary(); }
    if (s[i] === "+") { i += 1; return parseUnary(); }
    return parsePower();
  }

  function parsePower() {
    const base = parseFactor();
    skipTrivia();
    if (s[i] === "^") {
      i += 1;
      if (tryConsumeDegreeMarker()) return base;
      skipTrivia();
      const exp = s[i] === "{" ? parseBraced(parseExpr) : parseUnary();
      return base ** exp;
    }
    return base;
  }

  function canStartPrimary() {
    skipTrivia();
    const c = s[i];
    if (c === undefined) return false;
    if (isDigit(c) || c === ".") return true;
    if ("([{|".includes(c)) return true;
    if (c === "\\") return true;
    if (c === "e") return true;
    return false;
  }

  function parseTerm() {
    let v = parseUnary();
    for (;;) {
      skipTrivia();
      if (s.startsWith("\\times", i)) { i += 6; v *= parseUnary(); }
      else if (s.startsWith("\\cdot", i)) { i += 5; v *= parseUnary(); }
      else if (s.startsWith("\\div", i)) {
        i += 4;
        const d = parseUnary();
        if (d === 0) throw new ParseError("division by zero");
        v /= d;
      } else if (s[i] === "*") { i += 1; v *= parseUnary(); }
      else if (s[i] === "/") {
        i += 1;
        const d = parseUnary();
        if (d === 0) throw new ParseError("division by zero");
        v /= d;
      } else if (
        s[i] === "}" || s[i] === ")" || s[i] === "]" || s[i] === undefined ||
        s[i] === "=" || s[i] === "," || s[i] === "!" || s[i] === "|"
      ) break;
      else if (canStartPrimary()) v *= parseUnary();
      else break;
    }
    return v;
  }

  function parseExpr() {
    let v = parseTerm();
    for (;;) {
      skipTrivia();
      if (s[i] === "+") { i += 1; v += parseTerm(); }
      else if (s[i] === "-") { i += 1; v -= parseTerm(); }
      else break;
    }
    return v;
  }

  const result = parseExpr();
  skipTrivia();
  if (i !== s.length) throw new ParseError(`trailing content: ${JSON.stringify(s.slice(i))}`);
  if (!Number.isFinite(result)) throw new ParseError("non-finite result");
  return result;
}

function substituteTheir(text) {
  return text.replace(/\\text\{their\}'\s*(-?\d+(?:\.\d+)?)\s*'/g, "$1");
}

function cleanExprText(raw) {
  return raw.replace(/^\s*(?:or|and)\b\s*/i, "").trim();
}

function isBare(text) {
  return /^-?\d+(?:\.\d+)?$/.test(text.trim());
}

// Mark schemes routinely narrate a WRONG substitution the marker still
// credits, or an explicitly disallowed one. Both are deliberately
// inconsistent by design, not corrupted.
const DESCRIBES_WRONG_MATH = /\berror\b|\bmistake\b|\bincorrect\b|\bwrong\b|\bM0\b|\bA0\b|not acceptable|unacceptable/i;
// "Answer which rounds to": a deliberate recombination of pre-rounded
// intermediates, which compounds a small, expected rounding gap.
const AWRT_NEARBY = /\bAWRT\b/i;

const BRACKET_EQ = /\[\s*\$*\s*=\s*(-?\d+(?:\.\d+)?)\s*\$*\s*\]/g;

function tolerance(valueText, value, awrt) {
  const decMatch = /\.(\d+)/.exec(valueText);
  const decimals = decMatch ? decMatch[1].length : 0;
  const abs = Math.abs(value);
  if (awrt) return Math.max(0.75 * 10 ** -decimals, 0.02 * abs, 0.01);
  return Math.max(0.75 * 10 ** -decimals, 0.006 * abs, 1e-9);
}

// Top-level '=' positions only, respecting ( ) [ ] { } nesting depth.
function splitTopLevelEquals(text) {
  const segments = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    else if (c === "=" && depth === 0) {
      segments.push(text.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(text.slice(start));
  return segments;
}

function lastTopLevelEqualsSplit(text) {
  const segs = splitTopLevelEquals(text);
  return segs.length <= 1 ? text : segs[segs.length - 1];
}

// Corrected in the database already, but a stale fixture (see the
// convention in check_lost_operators.mjs / check_metadata_topics.mjs) would
// otherwise re-raise it forever, since export_staged.mjs only refreshes
// papers still in a staged batch.
const ADJUDICATED = new Map();

function findingsForField(data, question, label, field, raw) {
  const out = [];
  if (!raw) return out;
  if (DESCRIBES_WRONG_MATH.test(raw)) return out;
  const awrt = AWRT_NEARBY.test(raw);
  const text = substituteTheir(raw);

  // Pass 1: bracket annotations, "<expr> [= <number>]".
  const consumed = [];
  BRACKET_EQ.lastIndex = 0;
  let cursor = 0;
  let m;
  while ((m = BRACKET_EQ.exec(text))) {
    const exprRaw = text.slice(cursor, m.index);
    const exprText = cleanExprText(lastTopLevelEqualsSplit(exprRaw));
    cursor = m.index + m[0].length;
    consumed.push([m.index, cursor]);
    const valueText = m[1];
    const value = Number(valueText);
    if (!exprText || !/\d/.test(exprText)) continue;
    try {
      const computed = evaluateExpression(exprText);
      const diff = Math.abs(computed - value);
      const tol = tolerance(valueText, value, awrt);
      if (diff > tol) {
        out.push({
          paper: data.paper_key, run: data.run_id, question: question.question_number, label, field,
          kind: "bracket", exprText, valueText, computed, printed: value, diff,
        });
      }
    } catch (e) {
      // Not fully numeric (symbolic content) -- not a finding, not even noise.
    }
  }

  // Pass 2: chain equality, "<expr> = <number>", masking out consumed
  // bracket regions so the same clause is not scored twice.
  let masked = text;
  for (const [a, b] of consumed) masked = masked.slice(0, a) + " ".repeat(b - a) + masked.slice(b);
  const blocks = [...masked.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((mm) => mm[1]);
  const zones = blocks.length ? blocks : [masked];
  for (const zone of zones) {
    const segs = splitTopLevelEquals(zone).map((z) => cleanExprText(z)).filter(Boolean);
    if (segs.length < 2) continue;
    // Parse each segment independently. A parse failure means "unknown", not
    // "absent" -- it must never be skipped over to compare its neighbours
    // with each other (A = f(x) = C does not imply A = C).
    const parsedBySlot = segs.map((seg) => {
      if (!/\d/.test(seg)) return null;
      try {
        return { seg, value: evaluateExpression(seg) };
      } catch (e) {
        return null;
      }
    });
    for (let a = 0; a < parsedBySlot.length - 1; a += 1) {
      const va = parsedBySlot[a];
      const vb = parsedBySlot[a + 1];
      if (!va || !vb) continue;
      // Two bare literals either side of '=' with no operator anywhere are
      // almost always a marking note describing a degenerate path, not a
      // computation -- nothing here was actually evaluated.
      if (isBare(va.seg) && isBare(vb.seg)) continue;
      const diff = Math.abs(va.value - vb.value);
      const decA = (/\.(\d+)/.exec(va.seg) || [, ""])[1].length;
      const decB = (/\.(\d+)/.exec(vb.seg) || [, ""])[1].length;
      const decimals = Math.max(decA, decB);
      const magnitude = Math.max(Math.abs(va.value), Math.abs(vb.value));
      const tol = awrt
        ? Math.max(0.75 * 10 ** -decimals, 0.02 * magnitude, 0.01)
        : Math.max(0.75 * 10 ** -decimals, 0.006 * magnitude, 1e-9);
      if (diff > tol) {
        out.push({
          paper: data.paper_key, run: data.run_id, question: question.question_number, label, field,
          kind: "chain", exprText: va.seg, valueText: vb.seg, computed: va.value, printed: vb.value, diff,
        });
      }
    }
  }
  return out;
}

const findings = [];
const suppressed = [];

for (const file of fs.readdirSync(STAGED).filter((f) => f.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(STAGED, file), "utf8"));
  const bundle = data.paper_bundle ?? {};
  for (const question of bundle.questions ?? []) {
    const rows = [
      ...(question.mark_scheme_items ?? []).map((mm) => ["", mm]),
      ...(question.parts ?? []).flatMap((p) =>
        (p.mark_scheme_items ?? []).map((mm) => [`(${(p.label_path ?? []).join(")(")})`, mm]),
      ),
    ];
    for (const [label, row] of rows) {
      for (const field of ["content_markdown", "guidance_markdown"]) {
        const raw = String(row[field] ?? "");
        for (const f of findingsForField(data, question, label, field, raw)) {
          const key = `${f.paper}|Q${f.question}`;
          const target = ADJUDICATED.has(key) ? suppressed : findings;
          target.push({ ...f, note: ADJUDICATED.get(key) });
        }
      }
    }
  }
}

function group(list) {
  const byPaper = new Map();
  for (const f of list) {
    if (!byPaper.has(f.paper)) byPaper.set(f.paper, []);
    byPaper.get(f.paper).push(f);
  }
  return [...byPaper].sort();
}

console.log("\nNumeric self-consistency: expression vs printed evaluated value -- offline, no cost\n");

if (!findings.length) {
  console.log("  Clean. Every checkable expression reaches its printed value.\n");
} else {
  for (const [paper, items] of group(findings)) {
    console.log(`  ${paper}  (${items.length})`);
    for (const f of items) {
      console.log(`      Q${f.question}${f.label} ${f.field} [${f.kind}]`);
      console.log(`         expr    : ${f.exprText}  ->  ${f.computed}`);
      console.log(`         printed : ${f.valueText}  ->  ${f.printed}   (diff ${f.diff.toFixed(6)})`);
      if (verbose) console.log(`         run ${f.run}`);
    }
  }
  console.log(
    `\n  ${findings.length} occurrence(s) across ${group(findings).length} paper(s).\n\n` +
      "  Each is a stored expression that does not reach the value Cambridge prints\n" +
      "  beside it. Confirm against the OCR record and the printed page before\n" +
      "  correcting -- the corruption can originate in either stage.\n",
  );
}

if (suppressed.length) {
  const papers = [...new Set(suppressed.map((f) => f.paper))];
  console.log(
    `  ${suppressed.length} further occurrence(s) across ${papers.length} paper(s) are ADJUDICATED\n` +
      "  -- already corrected in the database, stale only in the fixture:\n",
  );
  for (const paper of papers) {
    console.log(`    ${paper}`);
    console.log(`      ${suppressed.find((f) => f.paper === paper).note}`);
  }
  console.log("");
}

process.exitCode = findings.length ? 1 : 0;
