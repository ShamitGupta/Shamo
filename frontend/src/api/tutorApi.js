// The only module that talks to the tutor API.
//
// Every call goes through here so the base URL lives in one place. The previous
// version hardcoded a Railway URL in two places inside the chat component, which
// is why pointing the app at a local server used to mean editing the component.
//
// VITE_API_BASE_URL is read at build time by Vite. Set it in frontend/.env.

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

/** Thrown for any non-2xx response, carrying what the server actually said. */
export class ApiError extends Error {
    constructor(message, { status, detail } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.detail = detail;
    }
}

async function readError(response) {
    let detail = null;
    try {
        const body = await response.json();
        detail = body?.detail ?? body;
    } catch {
        detail = null;
    }
    // A 404 carries a written explanation and a hint about what IS published.
    // Surfacing that verbatim is the point: the old app logged failures to the
    // console and left the student staring at nothing.
    if (typeof detail === 'object' && detail?.detail) {
        const hint = detail.available_hint ? ` ${detail.available_hint}` : '';
        return new ApiError(`${detail.detail}${hint}`, { status: response.status, detail });
    }
    if (typeof detail === 'string') {
        return new ApiError(detail, { status: response.status, detail });
    }
    return new ApiError(`Request failed (${response.status})`, { status: response.status });
}

/**
 * Every published paper, with the question numbers it actually holds.
 *
 * The selector is built from this rather than from a hardcoded list of years and
 * variants, so a student cannot pick a paper that does not exist.
 */
export async function fetchPapers() {
    const response = await fetch(`${BASE_URL}/papers`);
    if (!response.ok) throw await readError(response);
    return response.json();
}

/** Full context for one question: stem, parts, mark scheme, signed diagram URLs. */
export async function fetchQuestion({ year, exam_session, paper_variant, question_number }) {
    const path = `/papers/${year}/${exam_session}/${paper_variant}/questions/${question_number}`;
    const response = await fetch(`${BASE_URL}${path}`);
    if (!response.ok) throw await readError(response);
    return response.json();
}

/**
 * Stream a tutoring reply, invoking `onChunk` with each piece of text.
 *
 * The request carries only a REFERENCE to the question. The server re-retrieves
 * the content itself, so the browser cannot substitute its own source material.
 */
export async function streamChat({ question, mode, message, attempt, history }, onChunk, signal) {
    const response = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, mode, message, attempt: attempt || null, history }),
        signal,
    });
    if (!response.ok) throw await readError(response);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        onChunk(full);
    }
    return full;
}

export const SESSION_LABELS = {
    feb_march: 'Feb/March',
    may_june: 'May/June',
    oct_nov: 'Oct/Nov',
};

export const TUTOR_MODES = [
    { value: 'hint', label: 'Hint', blurb: 'A nudge, not the answer' },
    { value: 'explain', label: 'Explain', blurb: 'Full method, mark by mark' },
    { value: 'check', label: 'Check my work', blurb: 'Diagnose your attempt' },
];
