// Published questions that test the same method as the one on screen.
//
// Two things about this panel are deliberate rather than incidental:
//
// 1. An empty result is a NORMAL state, styled as a quiet note rather than an
//    error. The backend only returns matches above a measured quality floor,
//    so roughly one question in ten legitimately has nothing close enough.
//    Padding the list with weak suggestions would be worse than saying so.
//
// 2. Opening a suggestion used to clear the conversation, so this panel asked
//    for confirmation first. Threads now span several questions and are saved,
//    so moving to a suggestion keeps the conversation and simply continues it
//    under the new question. There is nothing left to warn about, and asking
//    anyway would train students to click through a meaningless dialog.
//
// 3. It is CLOSED until asked for. Five suggestions unfurling above a question
//    the student has not read yet pushes the actual work off screen, and it
//    answers a question nobody asked. Nothing is fetched until it is opened,
//    so an unopened panel costs a request as well as the space.

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

import { ApiError, fetchSimilarQuestions, SESSION_LABELS } from '../api/tutorApi.js';
import { useAuth } from '../Auth/authContext.js';
import { sanitizeLatex } from '../utils/sanitizeLatex.js';
import styles from './SimilarQuestions.module.css';

const RESULT_LIMIT = 5;

// Never show the raw cosine. 0.71 and 0.68 are not meaningfully different to a
// student, and a percentage invites the reading "71% the same question". The
// backend floor is 0.60, so anything shown here is at least a fair match.
const SIMILARITY_BANDS = [
    { min: 0.8, label: 'Strong match', level: 3 },
    { min: 0.7, label: 'Good match', level: 2 },
    { min: 0, label: 'Fair match', level: 1 },
];

function similarityBand(value) {
    const score = typeof value === 'number' ? value : 0;
    return SIMILARITY_BANDS.find((band) => score >= band.min) || SIMILARITY_BANDS[SIMILARITY_BANDS.length - 1];
}

function refKey(ref) {
    if (!ref) return '';
    return [
        ref.qualification,
        ref.syllabus_code,
        ref.year,
        ref.exam_session,
        ref.paper_variant,
        ref.question_number,
    ].join(':');
}

function paperLabel(ref) {
    if (!ref) return '';
    const sessionLabel = SESSION_LABELS[ref.exam_session] || ref.exam_session;
    const syllabusCode = ref.syllabus_code || '9709';
    return `${syllabusCode}/${ref.paper_variant} ${sessionLabel} ${ref.year} — Question ${ref.question_number}`;
}

// `p` is remapped to a span because the snippet renders inside a <button>,
// which may only contain phrasing content. KaTeX itself emits spans, so the
// whole snippet stays valid markup inside the clickable card.
const SNIPPET_COMPONENTS = {
    p: ({ children }) => <span className={styles.SnippetLine}>{children}</span>,
};

function Snippet({ children }) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={SNIPPET_COMPONENTS}
        >
            {sanitizeLatex(children || '')}
        </ReactMarkdown>
    );
}

function SimilarQuestions({
    reference,
    referenceKey,
    questionStatus,
    onNavigate,
    onOpenAuth,
}) {
    const { accessToken, isAuthenticated } = useAuth();

    const [status, setStatus] = useState('idle'); // idle|loading|ready|empty|notReady|error
    const [matches, setMatches] = useState([]);
    const [error, setError] = useState(null);
    const [isOpen, setIsOpen] = useState(false);
    const [navError, setNavError] = useState(null);
    const [retryToken, setRetryToken] = useState(0);

    // Closed again whenever the question changes: the list below belongs to the
    // question that was on screen when it was opened, and silently swapping its
    // contents under an open panel is worse than asking again.
    useEffect(() => {
        setIsOpen(false);
    }, [referenceKey]);

    useEffect(() => {
        setNavError(null);

        if (!isOpen || !referenceKey || questionStatus !== 'ready' || !isAuthenticated || !accessToken) {
            setMatches([]);
            setStatus('idle');
            setError(null);
            return undefined;
        }

        const controller = new AbortController();
        setStatus('loading');
        setError(null);

        fetchSimilarQuestions(
            { ...reference, limit: RESULT_LIMIT, accessToken },
            controller.signal,
        )
            .then((data) => {
                if (controller.signal.aborted) return;
                const items = (data?.matches || []).filter(
                    (match) => refKey(match.reference) !== refKey(reference),
                );
                setMatches(items);
                if (items.length) {
                    setStatus('ready');
                } else {
                    setStatus(data?.is_ready === false ? 'notReady' : 'empty');
                }
            })
            .catch((err) => {
                // An aborted fetch rejects with a DOMException whose message
                // would otherwise flash up as an error card.
                if (controller.signal.aborted || err?.name === 'AbortError') return;
                setMatches([]);
                setError({ message: err.message, status: err instanceof ApiError ? err.status : null });
                setStatus('error');
                if (err instanceof ApiError && err.status === 401) onOpenAuth('login');
            });

        return () => controller.abort();
        // referenceKey rather than reference: the object is rebuilt every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, referenceKey, questionStatus, isAuthenticated, accessToken, retryToken]);

    if (!reference || questionStatus !== 'ready') return null;

    const navigate = (match) => {
        const ok = onNavigate(match.reference);
        setNavError(ok ? null : 'That paper is not in the published catalogue yet.');
    };

    const handleSelect = (match) => {
        setNavError(null);
        navigate(match);
    };

    // What sits inside the panel once it is open. Each branch is a genuinely
    // different answer -- "not signed in", "nothing published to compare
    // against", "nothing close enough" and "the request failed" must not all
    // collapse into one empty list.
    const body = () => {
        if (!isAuthenticated) {
            return (
                <div className={styles.SignedOut}>
                    <p className={styles.EmptyNote}>
                        Sign in to see past-paper questions that test the same method as this one.
                    </p>
                    <button type="button" className={styles.SignInButton} onClick={() => onOpenAuth('login')}>
                        Sign in
                    </button>
                </div>
            );
        }

        if (status === 'loading' || status === 'idle') {
            return (
                <>
                    <p className={styles.EmptyNote}>Finding similar questions…</p>
                    <div className={styles.Results} aria-hidden="true">
                        <div className={styles.Skeleton} />
                        <div className={styles.Skeleton} />
                        <div className={styles.Skeleton} />
                    </div>
                </>
            );
        }

        if (status === 'error') {
            // 403 means signed in but unverified. Opening the login overlay at
            // someone who is already signed in would just be baffling.
            if (error?.status === 403) {
                return (
                    <p className={styles.EmptyNote}>
                        Verify your email address to see similar questions.
                    </p>
                );
            }
            return (
                <>
                    <p className={styles.ErrorText}>{error?.message || 'Could not load similar questions.'}</p>
                    <button
                        type="button"
                        className={styles.TextButton}
                        onClick={() => setRetryToken((value) => value + 1)}
                    >
                        Try again
                    </button>
                </>
            );
        }

        if (status === 'notReady') {
            return (
                <p className={styles.EmptyNote}>
                    Similar questions aren’t available for this paper yet — there aren’t enough
                    published papers in this component to compare against.
                </p>
            );
        }

        if (status === 'empty') {
            return (
                <p className={styles.EmptyNote}>
                    No close matches in this paper component. Shamo only suggests questions that
                    genuinely test the same method, and about one question in ten has no close
                    counterpart in the published papers.
                </p>
            );
        }

        return (
            <>
                {navError && <p className={styles.ErrorText}>{navError}</p>}
                <ul className={styles.Results}>
                    {matches.map((match) => {
                        const band = similarityBand(match.similarity);
                        const label = paperLabel(match.reference);
                        // Both fields can legitimately be null, so only join
                        // what exists -- otherwise a dangling separator shows.
                        const meta = [
                            match.main_topic,
                            match.total_marks != null && `${match.total_marks} marks`,
                        ]
                            .filter(Boolean)
                            .join(' · ');

                        return (
                            <li key={refKey(match.reference)} className={styles.ResultItem}>
                                <button
                                    type="button"
                                    className={styles.Result}
                                    onClick={() => handleSelect(match)}
                                    aria-label={`Open ${label}. ${meta}. ${band.label}.`}
                                >
                                    <span className={styles.ResultHead}>
                                        <span className={styles.Meta}>{meta || 'Same component'}</span>
                                        <span className={styles.Band} data-level={band.level}>
                                            <span className={styles.Bars} aria-hidden="true">
                                                <i />
                                                <i />
                                                <i />
                                            </span>
                                            <span className={styles.BandLabel}>{band.label}</span>
                                        </span>
                                    </span>
                                    <span className={styles.Paper}>{label}</span>
                                    {match.stem_snippet && (
                                        <span className={styles.Snippet}>
                                            <Snippet>{match.stem_snippet}</Snippet>
                                        </span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </>
        );
    };

    return (
        <div className={styles.Wrapper}>
            <button
                type="button"
                className={`${styles.Toggle} ${isOpen ? styles.ToggleOpen : ''}`}
                aria-expanded={isOpen}
                aria-controls="similar-questions-body"
                onClick={() => setIsOpen((value) => !value)}
            >
                <svg className={styles.Chevron} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path d="M5.5 3.5 L10.5 8 L5.5 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className={styles.ToggleLabel}>Similar questions</span>
                {isOpen && status === 'ready' && (
                    <span className={styles.Count}>{matches.length}</span>
                )}
            </button>

            {isOpen && (
                <section className={styles.Panel} id="similar-questions-body" aria-busy={status === 'loading'}>
                    {body()}
                </section>
            )}
        </div>
    );
}

export default SimilarQuestions;
