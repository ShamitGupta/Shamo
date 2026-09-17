// Inline an ES module into an n8n Code node.
//
// The generator embeds logic as `String.raw` template literals. That is fine
// for glue, but the mark-scheme parser and the validator rules are real
// algorithms that need unit tests, and a template literal cannot be imported.
//
// So they live as proper modules under lib/ and are inlined here. The static
// validator asserts the text embedded in the generated JSON is byte-identical
// to `inlineModule()` of the current file, which means the two can never drift:
// if anyone edits the node in the n8n UI and re-exports, the check fails.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Read a module from lib/ and strip its ES module syntax so the body can be
 * pasted into a Code node.
 *
 * Deliberately narrow: it removes `export ` prefixes and rejects anything with
 * an `import` statement, because a Code node has no module resolver and a
 * silently-dropped import would fail at runtime inside n8n rather than here.
 */
export function inlineModule(fileName) {
  const source = fs.readFileSync(path.join(LIB_DIR, fileName), "utf8");

  const importLine = source
    .split(/\r?\n/)
    .find((line) => /^\s*import\s/.test(line) && !line.trim().startsWith("//"));
  if (importLine) {
    throw new Error(
      `${fileName} has an import statement and cannot be inlined into a Code node: ${importLine.trim()}`,
    );
  }

  return source
    .replace(/^export\s+(function|const|let|class)\s/gm, "$1 ")
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, "")
    .trimEnd();
}
