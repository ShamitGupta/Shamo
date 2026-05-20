const INLINE_MATH_PATTERN = /\\\(([\s\S]+?)\\\)/g;
const BLOCK_MATH_PATTERN = /\\\[([\s\S]+?)\\\]/g;
const FRACTION_SHORTCUT_PATTERN = /\\frac\s*\{([^{}]*?)\/([^{}]*?)\}/g;
const SCRIPTED_COMMAND_PATTERN = /([\^_])\s*(\\(?:frac|sqrt)\b(?:\{[^{}]*\}){1,2})/g;

const trimMathContent = (content) => content.trim();

const normalizeMathDelimiters = (text) => {
    return text
        .replace(BLOCK_MATH_PATTERN, (_, content) => `$$${trimMathContent(content)}$$`)
        .replace(INLINE_MATH_PATTERN, (_, content) => `$${trimMathContent(content)}$`);
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

    const normalizedDelimiters = normalizeMathDelimiters(text);
    const normalizedFractions = normalizeFractions(normalizedDelimiters);

    return normalizeSuperscriptsAndSubscripts(normalizedFractions);
};
