// The teaching brief: what to do on Monday, before looking at anyone in
// particular.
//
// The roster below this answers "how is Aisha doing". This answers "what does
// this class need", which is the question a head of department is actually
// asking and the one the dashboard could not previously answer without opening
// every profile in turn.
//
// THE HEADLINE IS THE HEADCOUNT, NOT THE PERCENTAGE. "6 of 9 below 40%" is
// robust; a pooled mark ratio is dominated by whoever practised most, so one
// heavy user could define the class's apparent weakness. The ratio is still
// shown -- withholding it would be its own kind of dishonesty -- but it sits
// second, and the ordering is built on the headcount.

import { useEffect, useState } from 'react';

import { ApiError, fetchClassOverview } from '../api/tutorApi.js';
import ActivityChart from './ActivityChart.jsx';
import MarkCodeSplit from './MarkCodeSplit.jsx';
import { band } from './format.js';
import styles from './Teacher.module.css';

function ClassOverview({ accessToken, isStaff }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!accessToken || !isStaff) return undefined;
        const controller = new AbortController();
        fetchClassOverview(accessToken, controller.signal)
            .then((body) => {
                if (controller.signal.aborted) return;
                setData(body);
                setError('');
            })
            .catch((err) => {
                if (controller.signal.aborted || err?.name === 'AbortError') return;
                setError(err instanceof ApiError ? err.message : 'Could not load the class picture.');
            });
        return () => controller.abort();
    }, [accessToken, isStaff]);

    if (error) return <p className={styles.Error}>{error}</p>;
    if (!data) return <p className={styles.Blurb}>Reading the class…</p>;

    const topics = data.topics || [];
    const thin = data.needs_more_evidence || [];

    return (
        <div className={styles.Overview}>
            <section className={styles.Insight} aria-label="What the class is finding hard">
                <h3 className={styles.InsightTitle}>What the class is finding hard</h3>

                {topics.length === 0 ? (
                    <p className={styles.Blurb}>
                        No topic has enough marked work behind it from more than one student
                        yet. One student struggling is a conversation with that student, not
                        a lesson plan — so nothing is ranked here until a second one agrees.
                    </p>
                ) : (
                    <ul className={styles.Topics}>
                        {topics.map((topic) => {
                            const { label, tone } = band(topic.class_mark_ratio);
                            const percent =
                                topic.class_mark_ratio === null
                                    ? null
                                    : Math.round(topic.class_mark_ratio * 100);
                            return (
                                <li key={topic.main_topic} className={styles.Topic}>
                                    <div className={styles.TopicTop}>
                                        <span className={styles.TopicName}>{topic.main_topic}</span>
                                        <span className={`${styles.Band} ${styles[tone]}`}>{label}</span>
                                    </div>
                                    {/* The finding. Read this before the percentage. */}
                                    <p className={styles.TopicHeadcount}>
                                        <strong>
                                            {topic.students_struggling} of {topic.students_with_evidence}
                                        </strong>{' '}
                                        {topic.students_with_evidence === 1 ? 'student is' : 'students are'}{' '}
                                        below 40% here
                                    </p>
                                    {percent !== null && (
                                        <div className={styles.BarTrack} aria-hidden="true">
                                            <div
                                                className={`${styles.BarFill} ${styles[tone]}`}
                                                style={{ width: `${Math.max(percent, 2)}%` }}
                                            />
                                        </div>
                                    )}
                                    <p className={styles.TopicEvidence}>
                                        {topic.marks_earned} of {topic.marks_available} marks across{' '}
                                        {topic.scored_attempts}{' '}
                                        {topic.scored_attempts === 1 ? 'attempt' : 'attempts'}
                                        {percent !== null ? ` · ${percent}% overall` : ''}
                                    </p>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {thin.length > 0 && (
                    <div className={styles.Pending}>
                        <p className={styles.PendingHeading}>Not enough to judge yet</p>
                        <p className={styles.PendingList}>
                            {thin
                                .map((topic) => `${topic.main_topic} (${topic.students_attempting})`)
                                .join(' · ')}
                        </p>
                    </div>
                )}

                {/* Said plainly rather than left for the reader to work out. These
                    are self-chosen questions of differing difficulty, so the
                    percentages are a guide to where to look, not a measurement. */}
                <p className={styles.Caveat}>
                    Students choose their own questions, so these percentages come from
                    different work of differing difficulty. Treat them as somewhere to look
                    rather than as a measurement.
                </p>
            </section>

            <MarkCodeSplit profile={data.mark_codes} heading="Where the class loses marks" />
            <ActivityChart weeks={data.activity} heading="Work handed in" />
        </div>
    );
}

export default ClassOverview;
