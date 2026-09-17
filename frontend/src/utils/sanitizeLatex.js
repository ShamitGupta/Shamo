// Mistral OCR occasionally spells the LaTeX escape character out as the
// English word "backslash" instead of emitting `\`, and separately escapes
// grouping braces that should be plain: `\backslash frac\{1\}\{2\}` for a
// printed `\frac{1}{2}`. The pipeline now repairs this before storage
// (workflows/n8n/lib/mark_scheme_parser.mjs, repairBackslashWordCorruption)
// and the 79 already-published rows were backfilled by
// database/shamo_v2_3_backslash_word_corruption_correction.sql, but this
// stays here as a defensive second layer -- older cached client state or a
// future reading defect of the same shape should still render.
const BACKSLASH_WORD_COMMANDS = new Set([
    'frac', 'dfrac', 'tfrac', 'times', 'text', 'left', 'right', 'ln', 'sqrt',
    'mu', 'theta', 'tan', 'pm', 'div', 'pi', 'log', 'sin', 'cos', 'leq', 'geq',
    'cdot', 'circ', 'leqslant', 'geqslant', 'neq', 'approx', 'alpha', 'beta',
    'gamma', 'lambda', 'sigma', 'phi', 'Phi', 'Sigma', 'infty', 'int', 'sum',
    'Rightarrow',
]);

// Built at runtime, not as a regex/string literal, so the placeholder never
// appears as a literal control character in source -- linters flag those on
// sight, and it also means the marker cannot collide with real content.
const LEFT_BRACE_MARKER = `${String.fromCharCode(1)}LB${String.fromCharCode(1)}`;
const RIGHT_BRACE_MARKER = `${String.fromCharCode(1)}RB${String.fromCharCode(1)}`;

const repairBackslashWordCorruption = (text) => {
    if (!text.includes('backslash') && !text.includes('\\{') && !text.includes('\\}')) {
        return text;
    }
    let repaired = text.replace(/\\backslash ?([A-Za-z]+)/g, (whole, word) =>
        BACKSLASH_WORD_COMMANDS.has(word) ? `\\${word}` : whole
    );
    repaired = repaired.replace(/\\backslash ?/g, '');
    repaired = repaired
        .split('\\left\\{').join(LEFT_BRACE_MARKER)
        .split('\\right\\}').join(RIGHT_BRACE_MARKER)
        .replace(/\\\{/g, '{')
        .replace(/\\\}/g, '}')
        .split(LEFT_BRACE_MARKER).join('\\left\\{')
        .split(RIGHT_BRACE_MARKER).join('\\right\\}');
    return repaired;
};

const INLINE_MATH_PATTERN = /\\\(([\s\S]+?)\\\)/g;
const BLOCK_MATH_PATTERN = /\\\[([\s\S]+?)\\\]/g;
const FRACTION_SHORTCUT_PATTERN = /\\frac\s*\{([^{}]*?)\/([^{}]*?)\}/g;
const SCRIPTED_COMMAND_PATTERN = /([\^_])\s*(\\(?:frac|sqrt)\b(?:\{[^{}]*\}){1,2})/g;
const DISPLAY_DELIMITER_PATTERN = /\$\$/g;
const LATEX_CONTENT_PATTERN = /\\[A-Za-z]+|[\^_]\s*[A-Za-z0-9{]/;
const LOOSE_MATH_SEPARATOR_PATTERN = /\\quad\\to\\quad/g;

const trimMathContent = (content) => content.trim();

const normalizeMathDelimiters = (text) => {
    return text
        .replace(BLOCK_MATH_PATTERN, (_, content) => `$$${trimMathContent(content)}$$`)
        .replace(INLINE_MATH_PATTERN, (_, content) => `$${trimMathContent(content)}$`);
};

const countDisplayDelimiters = (text) => (text.match(DISPLAY_DELIMITER_PATTERN) || []).length;

const repairOrphanDisplayDelimiters = (text) => {
    return text
        .split('\n')
        .map((line) => {
            if (countDisplayDelimiters(line) % 2 === 0) {
                return line;
            }

            const delimiterIndex = line.indexOf('$$');
            const before = line.slice(0, delimiterIndex);
            const after = line.slice(delimiterIndex + 2);

            if (LATEX_CONTENT_PATTERN.test(before)) {
                const leadingWhitespace = before.match(/^\s*/)?.[0] || '';
                const mathStart = leadingWhitespace.length;
                return (
                    line.slice(0, mathStart) +
                    '$$' +
                    line.slice(mathStart)
                );
            }

            if (LATEX_CONTENT_PATTERN.test(after)) {
                return `${line}$$`;
            }

            return line;
        })
        .join('\n');
};

const transformOutsideMath = (text, transform) => {
    let result = '';
    let buffer = '';
    let inMath = false;
    let delimiter = '';

    const flush = () => {
        result += inMath ? buffer : transform(buffer);
        buffer = '';
    };

    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== '$') {
            buffer += text[index];
            continue;
        }

        const nextDelimiter = text[index + 1] === '$' ? '$$' : '$';

        if (!inMath) {
            flush();
            result += nextDelimiter;
            inMath = true;
            delimiter = nextDelimiter;
            if (nextDelimiter === '$$') index += 1;
            continue;
        }

        if (nextDelimiter === delimiter) {
            flush();
            result += nextDelimiter;
            inMath = false;
            delimiter = '';
            if (nextDelimiter === '$$') index += 1;
            continue;
        }

        buffer += nextDelimiter;
        if (nextDelimiter === '$$') index += 1;
    }

    flush();
    return result;
};

const wrapLooseMathSeparators = (text) => {
    return transformOutsideMath(text, (segment) =>
        segment.replace(LOOSE_MATH_SEPARATOR_PATTERN, (match) => `$${match}$`)
    );
};

const normalizeFractions = (text) => {
    let normalized = text;
    let previous = '';

    while (normalized !== previous) {
        previous = normalized;
        normalized = normalized.replace(
            FRACTION_SHORTCUT_PATTERN,
            (_, numerator, denominator) => `\\frac{${numerator.trim()}}{${denominator.trim()}}`
        );
    }

    return normalized;
};

const normalizeSuperscriptsAndSubscripts = (text) => {
    return text.replace(SCRIPTED_COMMAND_PATTERN, (_, operator, command) => `${operator}{${command}}`);
};

export const sanitizeLatex = (text) => {
    if (typeof text !== 'string' || text.length === 0) {
        return text;
    }

    const repaired = repairBackslashWordCorruption(text);
    const normalizedDelimiters = wrapLooseMathSeparators(
        repairOrphanDisplayDelimiters(normalizeMathDelimiters(repaired))
    );
    const normalizedFractions = normalizeFractions(normalizedDelimiters);

    return normalizeSuperscriptsAndSubscripts(normalizedFractions);
};
