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

function authHeaders(accessToken) {
    return accessToken
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }
        : { 'Content-Type': 'application/json' };
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
export async function fetchQuestion({ year, exam_session, paper_variant, question_number, qualification, syllabus_code }) {
    const path = `/papers/${year}/${exam_session}/${paper_variant}/questions/${question_number}`;
    // qualification/syllabus_code are query params, not path segments, and the
    // backend defaults them to the corpus's original syllabus (9709) when
    // absent -- so omitting them here still resolves correctly, it just can't
    // disambiguate a variant number shared with another syllabus (e.g. IGCSE).
    const params = new URLSearchParams();
    if (qualification) params.set('qualification', qualification);
    if (syllabus_code) params.set('syllabus_code', syllabus_code);
    const query = params.toString();
    const response = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ''}`);
    if (!response.ok) throw await readError(response);
    return response.json();
}

/**
 * Published questions that test the same method as this one.
 *
 * Authenticated, unlike fetchQuestion above: the similarity index is not
 * public. 401 when signed out, 403 when the email is unverified.
 *
 * An empty `matches` list is a NORMAL outcome, not a failure. Only matches
 * above a measured quality floor are returned, so roughly one question in ten
 * legitimately has nothing close enough -- the caller is expected to say so
 * plainly rather than render an error.
 */
export async function fetchSimilarQuestions(
    { year, exam_session, paper_variant, question_number, qualification, syllabus_code, limit, accessToken },
    signal,
) {
    const path = `/papers/${year}/${exam_session}/${paper_variant}/questions/${question_number}/similar`;
    const params = new URLSearchParams();
    if (qualification) params.set('qualification', qualification);
    if (syllabus_code) params.set('syllabus_code', syllabus_code);
    if (limit) params.set('limit', String(limit));
    const query = params.toString();
    const response = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ''}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

/** Current signed-in account, profile, and effective Shamo tier. */
export async function getCurrentUser(accessToken) {
    const response = await fetch(`${BASE_URL}/me`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

/**
 * Stream a tutoring reply, invoking `onChunk` with each piece of text.
 *
 * The request carries only a REFERENCE to the question. The server re-retrieves
 * the content itself, so the browser cannot substitute its own source material.
 */
export async function streamChat({ question, mode, message, attempt, history, conversationId, accessToken }, onChunk, signal) {
    const response = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ question, mode, message, attempt: attempt || null, history, conversation_id: conversationId ?? null }),
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

/** Build a validated visual explanation for one published question. */
export async function createVisualization({ question, message, history, conversationId, accessToken }, signal) {
    const response = await fetch(`${BASE_URL}/visualize`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ question, message, history, conversation_id: conversationId ?? null }),
        signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

/** Coordinate one student turn across multiple selected modes. */
export async function createCoordinatedResponse({ question, modes, message, attempt, history, conversationId, accessToken }, signal) {
    const response = await fetch(`${BASE_URL}/respond`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ question, modes, message, attempt: attempt || null, history, conversation_id: conversationId ?? null }),
        signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

/** Let Shamo route one natural student turn to the right tutor mode(s). */
export async function createAssistedResponse({ question, message, history, conversationId, accessToken }, signal) {
    const response = await fetch(`${BASE_URL}/assist`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ question, message, history, conversation_id: conversationId ?? null }),
        signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

/**
 * The student's saved threads, most recently active first.
 *
 * A thread may span several questions, so it is named and dated rather than
 * labelled with one question. `last_question` is only a subtitle hint.
 */
export async function fetchConversations(accessToken, signal) {
    const response = await fetch(`${BASE_URL}/conversations`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

/** One thread with all of its messages, for restoring it after a refresh. */
export async function fetchConversation(conversationId, accessToken, signal) {
    const response = await fetch(`${BASE_URL}/conversations/${conversationId}`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

/** Start a new thread. An omitted or blank title means "unnamed". */
export async function createConversation(title, accessToken, signal) {
    const response = await fetch(`${BASE_URL}/conversations`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ title: title ?? null }),
        signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

/** Rename a thread. Passing null clears the name back to the dated label. */
export async function renameConversation(conversationId, title, accessToken, signal) {
    const response = await fetch(`${BASE_URL}/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ title: title ?? null }),
        signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

/**
 * Delete a thread and its messages permanently.
 *
 * Marks recorded from attempts in this thread are deliberately kept -- they are
 * learning evidence rather than conversation, and have their own deletion path.
 */
export async function deleteConversation(conversationId, accessToken, signal) {
    const response = await fetch(`${BASE_URL}/conversations/${conversationId}`, {
        method: 'DELETE',
        headers: authHeaders(accessToken),
        signal,
    });
    if (!response.ok) throw await readError(response);
}

/**
 * How this student is scoring by topic, weakest first.
 *
 * Returns two lists, deliberately: `ranked` are topics with enough attempts to
 * judge, `needs_more_evidence` are topics that have been attempted but not
 * enough times to call a weakness. Showing only the first would make a thin
 * history look like a complete picture.
 */
export async function fetchWeakTopics(accessToken, signal) {
    const response = await fetch(`${BASE_URL}/me/weak-topics`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        signal,
    });
    if (!response.ok) throw await readError(response);
    return response.json();
}

export const SESSION_LABELS = {
    feb_march: 'Feb/March',
    may_june: 'May/June',
    oct_nov: 'Oct/Nov',
};

export const TUTOR_MODES = [
    { value: 'hint', label: 'Hint', blurb: 'Get a small nudge without revealing the full solution.' },
    { value: 'explain', label: 'Explain', blurb: 'Walk through the method step by step.' },
    { value: 'check', label: 'Check my work', blurb: 'Paste your working and get feedback.' },
    { value: 'visualize', label: 'Visualize', blurb: 'See the idea with a graph, diagram, or animation.' },
];
