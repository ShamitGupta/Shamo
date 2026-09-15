// Where a student is actually struggling, with the evidence for saying so.
//
// Two things about this panel are deliberate rather than incidental:
//
// 1. The score is NEVER shown on its own. Every row carries the attempts behind
//    it and the raw marks, because "43% at Vectors" tells a student nothing they
//    can act on and gives a teacher nothing they can check. The percentage is
//    the headline; the marks and attempts are the point.
//
// 2. Topics with too few attempts are shown separately rather than hidden. A
//    single bad question is not a weakness, but silently dropping it would make
//    a thin history look like a complete picture of the student.

import { useEffect, useState } from 'react';

import { ApiError, fetchPracticeSet, fetchWeakTopics, SESSION_LABELS } from '../api/tutorApi.js';
import { useAuth } from '../Auth/authContext.js';
import styles from './WeakTopics.module.css';

// Bands rather than a bare number line, for the same reason similarity is
// banded: a student reading "31%" against "34%" will treat the gap as real.
function band(ratio) {
    if (ratio === null || ratio === undefined) return { label: 'Not marked yet', tone: 'unknown' };
    if (ratio < 0.4) return { label: 'Struggling', tone: 'low' };
    if (ratio < 0.7) return { label: 'Getting there', tone: 'mid' };
    return { label: 'Solid', tone: 'high' };
}

function whenText(iso) {
    if (!iso) return '';
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return '';
    const days = Math.floor((Date.now() - when.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function referenceLabel(reference) {
    const session = SESSION_LABELS[reference.exam_session] || reference.exam_session;
    return `${reference.syllabus_code}/${reference.paper_variant} ${session} ${reference.year} — Q${reference.question_number}`;
}

function WeakTopics({ refreshToken, onNavigate }) {
    const { accessToken, isAuthenticated } = useAuth();
    // No "loading" state is stored, and nothing is cleared when a session ends.
    // Both would mean calling setState synchronously inside the effect, which
    // React 19's linter rejects -- correctly, since clearing in an effect runs a
    // render too late: signing in as a different student on the same device
    // could flash the previous student's topics for a frame. Instead the data
    // is stamped with the session it was fetched for, and everything else is
    // derived from that.
    const [data, setData] = useState(null);
    const [loadedFor, setLoadedFor] = useState(null);
    const [error, setError] = useState(null);
    const [collapsed, setCollapsed] = useState(false);
    // Which topic's practice set is open, and what it holds. Only one at a
    // time: a student picking what to do next does not need five lists.
    const [practiceTopic, setPracticeTopic] = useState(null);
    const [practice, setPractice] = useState(null);
    const [practiceError, setPracticeError] = useState(null);

    useEffect(() => {
        if (!isAuthenticated || !accessToken) return undefined;

        const controller = new AbortController();
        fetchWeakTopics(accessToken, controller.signal)
            .then((body) => {
                if (controller.signal.aborted) return;
                setData(body);
                setLoadedFor(accessToken);
                setError(null);
            })
            .catch((err) => {
                // An aborted fetch rejects with a DOMException that would
                // otherwise flash up as a real error.
                if (controller.signal.aborted || err?.name === 'AbortError') return;
                setError(err instanceof ApiError ? err.message : 'Could not load your topics.');
                setLoadedFor(accessToken);
            });

        return () => controller.abort();
        // refreshToken lets the chat say a new attempt was marked, so the panel
        // re-reads without polling.
    }, [isAuthenticated, accessToken, refreshToken]);

    const openPractice = async (topic) => {
        if (practiceTopic === topic.main_topic) {
            setPracticeTopic(null);
            return;
        }
        setPracticeTopic(topic.main_topic);
        setPractice(null);
        setPracticeError(null);
        try {
            const body = await fetchPracticeSet({
                topic: topic.main_topic,
                // A topic name can span syllabuses; practise within the one the
                // student has actually been working in.
                syllabusCode: topic.syllabus_codes?.length === 1 ? topic.syllabus_codes[0] : undefined,
                accessToken,
            });
            setPractice(body.questions || []);
        } catch (err) {
            setPracticeError(
                err instanceof ApiError ? err.message : 'Could not build a practice set.',
            );
        }
    };

    if (!isAuthenticated) return null;
    // Still loading, or the data belongs to a previous session. Either way there
    // is nothing safe to show yet.
    if (loadedFor !== accessToken) return null;
    if (error) {
        return <section className={styles.Panel}><p className={styles.Error}>{error}</p></section>;
    }

    const ranked = data?.ranked || [];
    const pending = data?.needs_more_evidence || [];
    if (!ranked.length && !pending.length) return null;

    return (
        <section className={styles.Panel} aria-label="Your topics">
            <header className={styles.Header}>
                <h3 className={styles.Title}>Where you are struggling</h3>
                <button
                    type="button"
                    className={styles.Toggle}
                    onClick={() => setCollapsed((c) => !c)}
                >
                    {collapsed ? 'Show' : 'Hide'}
                </button>
            </header>

            {!collapsed && (
                <>
                    {ranked.length > 0 ? (
                        <ul className={styles.List}>
                            {ranked.map((topic) => {
                                const { label, tone } = band(topic.mark_ratio);
                                const percent = topic.mark_ratio === null
                                    ? null
                                    : Math.round(topic.mark_ratio * 100);
                                return (
                                    <li key={topic.main_topic} className={styles.Row}>
                                        <div className={styles.RowTop}>
                                            <span className={styles.Topic}>{topic.main_topic}</span>
                                            <span className={`${styles.Band} ${styles[tone]}`}>{label}</span>
                                        </div>
                                        {percent !== null && (
                                            <div className={styles.BarTrack} aria-hidden="true">
                                                <div
                                                    className={`${styles.BarFill} ${styles[tone]}`}
                                                    style={{ width: `${Math.max(percent, 2)}%` }}
                                                />
                                            </div>
                                        )}
                                        {/* The evidence, always. */}
                                        <p className={styles.Evidence}>
                                            {topic.marks_earned} of {topic.marks_available} marks
                                            {' across '}
                                            {topic.scored_attempts}
                                            {topic.scored_attempts === 1 ? ' question' : ' questions'}
                                            {whenText(topic.last_attempted_at)
                                                ? ` · last ${whenText(topic.last_attempted_at)}`
                                                : ''}
                                        </p>
                                        <button
                                            type="button"
                                            className={styles.Practise}
                                            onClick={() => openPractice(topic)}
                                            aria-expanded={practiceTopic === topic.main_topic}
                                        >
                                            {practiceTopic === topic.main_topic
                                                ? 'Hide practice'
                                                : 'Practise this'}
                                        </button>

                                        {practiceTopic === topic.main_topic && (
                                            <div className={styles.Practice}>
                                                {practiceError && (
                                                    <p className={styles.Error}>{practiceError}</p>
                                                )}
                                                {!practiceError && practice === null && (
                                                    <p className={styles.Note}>Finding questions…</p>
                                                )}
                                                {practice?.length === 0 && (
                                                    <p className={styles.Note}>
                                                        You have already worked through every
                                                        published question on this topic.
                                                    </p>
                                                )}
                                                {practice?.map((item) => (
                                                    <button
                                                        key={referenceLabel(item.reference)}
                                                        type="button"
                                                        className={styles.PracticeItem}
                                                        onClick={() => onNavigate?.(item.reference)}
                                                    >
                                                        <span className={styles.PracticeRef}>
                                                            {referenceLabel(item.reference)}
                                                            {item.total_marks
                                                                ? ` · ${item.total_marks} marks`
                                                                : ''}
                                                        </span>
                                                        {/* The reason comes from stored metadata,
                                                            never from a model, so it cannot be
                                                            fluent and wrong. */}
                                                        <span className={styles.PracticeWhy}>
                                                            {item.selection_reason}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p className={styles.Note}>
                            Nothing has enough attempts behind it yet. Check your working on a few
                            more questions and your weakest topics will appear here.
                        </p>
                    )}

                    {pending.length > 0 && (
                        <div className={styles.Pending}>
                            <p className={styles.PendingHeading}>
                                Not enough attempts yet to judge
                            </p>
                            <p className={styles.PendingList}>
                                {pending
                                    .map((topic) => `${topic.main_topic} (${topic.attempts})`)
                                    .join(' · ')}
                            </p>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

export default WeakTopics;
