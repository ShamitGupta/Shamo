// One student: their topic ranking, and the work they submitted for marking.
//
// The ranking is rendered by the SAME component the student sees
// (ChatSection/WeakTopics), fed from /staff/students/{id}/weak-topics, which
// calls the same SQL function as /me/weak-topics. A teacher and their student
// being shown different answers about the same work would be worse than either
// of them being slightly wrong, so there is deliberately only one renderer and
// only one definition of "weak".
//
// What is not here, and cannot be reached from here: the student's
// conversations with the tutor. Asking for help is not work handed in.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError, fetchStudent, fetchStudentWeakTopics, SESSION_LABELS } from '../api/tutorApi.js';
import { useAuth } from '../Auth/authContext.js';
import WeakTopics from '../ChatSection/WeakTopics.jsx';
import SampleBadge from './SampleBadge.jsx';
import { studentName, whenText } from './format.js';
import styles from './Teacher.module.css';

function referenceLabel(reference, partLabel) {
    const session = SESSION_LABELS[reference.exam_session] || reference.exam_session;
    const part = partLabel ? ` ${partLabel}` : '';
    return `${reference.syllabus_code}/${reference.paper_variant} ${session} ${reference.year} — Q${reference.question_number}${part}`;
}

function StudentDetail() {
    const { userId } = useParams();
    const { accessToken, isStaff } = useAuth();
    const [detail, setDetail] = useState(null);
    const [topics, setTopics] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!accessToken || !isStaff || !userId) return undefined;
        const controller = new AbortController();

        Promise.all([
            fetchStudent(userId, accessToken, controller.signal),
            fetchStudentWeakTopics(userId, accessToken, controller.signal),
        ])
            .then(([studentBody, topicBody]) => {
                if (controller.signal.aborted) return;
                setDetail(studentBody);
                setTopics(topicBody);
                setError('');
            })
            .catch((err) => {
                if (controller.signal.aborted || err?.name === 'AbortError') return;
                setError(err instanceof ApiError ? err.message : 'Could not load this student.');
            });

        return () => controller.abort();
    }, [accessToken, isStaff, userId]);

    if (error) {
        return (
            <main className={styles.Page}>
                <Link className={styles.QuietLink} to="/dashboard">← Back to your class</Link>
                <p className={styles.Error}>{error}</p>
            </main>
        );
    }

    if (!detail) {
        return (
            <main className={styles.Page}>
                <Link className={styles.QuietLink} to="/dashboard">← Back to your class</Link>
                <p className={styles.Blurb}>Loading…</p>
            </main>
        );
    }

    const student = detail.student;
    const attempts = detail.attempts || [];

    return (
        <main className={styles.Page}>
            <Link className={styles.QuietLink} to="/dashboard">← Back to your class</Link>

            <header className={styles.PageHeader}>
                <div>
                    <h1 className={styles.Title}>
                        {studentName(student)}
                        {student.is_sample && <SampleBadge />}
                    </h1>
                    <p className={styles.Blurb}>
                        {student.email} · last active {whenText(student.last_active_at)}
                    </p>
                </div>
            </header>

            <section className={styles.Stats} aria-label="Usage">
                <div className={styles.Stat}>
                    <span className={styles.StatValue}>{student.attempts}</span>
                    <span className={styles.StatLabel}>attempts submitted</span>
                </div>
                <div className={styles.Stat}>
                    <span className={styles.StatValue}>{student.scored_attempts}</span>
                    <span className={styles.StatLabel}>of those marked</span>
                </div>
                <div className={styles.Stat}>
                    <span className={styles.StatValue}>{student.conversations}</span>
                    <span className={styles.StatLabel}>tutoring sessions</span>
                </div>
                <div className={styles.Stat}>
                    <span className={styles.StatValue}>{student.turns}</span>
                    <span className={styles.StatLabel}>messages exchanged</span>
                </div>
            </section>

            <p className={styles.PrivacyNote}>
                Conversations are counted, not shown. What a student says to the tutor while
                they are stuck stays between them and the tutor.
            </p>

            <div className={styles.TopicsRegion}>
                <WeakTopics topics={topics} heading={`Where ${studentName(student)} is struggling`} />
            </div>

            <section aria-label="Submitted work">
                <h2 className={styles.SectionTitle}>Work submitted for marking</h2>
                {attempts.length === 0 && (
                    <p className={styles.Blurb}>
                        Nothing submitted yet. Attempts appear here once this student checks
                        their working on a question.
                    </p>
                )}
                <ul className={styles.Attempts}>
                    {attempts.map((attempt, index) => (
                        <li key={`${referenceLabel(attempt.reference, attempt.part_label)}-${index}`} className={styles.Attempt}>
                            <div className={styles.AttemptTop}>
                                <span className={styles.AttemptRef}>
                                    {referenceLabel(attempt.reference, attempt.part_label)}
                                </span>
                                <span className={styles.AttemptMarks}>
                                    {attempt.outcome_source === 'extractor' &&
                                     attempt.marks_earned !== null
                                        ? `${attempt.marks_earned} / ${attempt.marks_available}`
                                        : 'not marked'}
                                </span>
                            </div>
                            <p className={styles.AttemptText}>{attempt.attempt_text}</p>
                            {(attempt.earned_codes.length > 0 || attempt.missed_codes.length > 0) && (
                                <p className={styles.Codes}>
                                    {attempt.earned_codes.length > 0 && (
                                        <span className={styles.Earned}>
                                            earned {attempt.earned_codes.join(', ')}
                                        </span>
                                    )}
                                    {attempt.missed_codes.length > 0 && (
                                        <span className={styles.Missed}>
                                            missed {attempt.missed_codes.join(', ')}
                                        </span>
                                    )}
                                </p>
                            )}
                            <p className={styles.AttemptWhen}>{whenText(attempt.created_at)}</p>
                        </li>
                    ))}
                </ul>
            </section>
        </main>
    );
}

export default StudentDetail;
