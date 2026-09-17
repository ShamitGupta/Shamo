// Why marks are being lost, not just how many.
//
// Cambridge awards M marks for the METHOD, A marks for ACCURACY once the method
// is there, and B marks independently. Which kind a student drops is a different
// teaching problem: you reteach for one and drill for the other. That
// distinction already sits in every attempt Shamo has marked -- this panel is
// the first thing to read it.
//
// Three things about it are deliberate:
//
// 1. ONE COMPONENT, THREE SURFACES. The teacher's class panel, a student's page
//    on the dashboard, and the student's own sidebar all render this, fed a
//    profile as a prop. A second copy would be free to drift, and a student
//    being told something different about their own work than their teacher is
//    told is the failure this project has already decided it will not ship.
//
// 2. THE COUNT IS ALWAYS THERE. 0 of 2 and 0 of 40 are not the same finding, so
//    no bar is drawn without the marks behind it -- the same rule as WeakTopics.
//
// 3. THE HEADLINE IS THE SERVER'S, AND IT CAN BE ABSENT. Below a few marks
//    there is no honest comparison to make and the API returns none. Nothing
//    here invents one to fill the space.

import styles from './Teacher.module.css';

const LABELS = {
    M: { name: 'Method', what: 'knowing what to do' },
    A: { name: 'Accuracy', what: 'carrying it out correctly' },
    B: { name: 'Independent', what: 'stated results and facts' },
    other: { name: 'Other', what: 'codes outside the usual three' },
};

// Matches the student's own bands. "Struggling" has to mean the same thing
// wherever it appears, or the two of them are reading different instruments.
function tone(ratio) {
    if (ratio === null || ratio === undefined) return 'unknown';
    if (ratio < 0.4) return 'low';
    if (ratio < 0.7) return 'mid';
    return 'high';
}

function MarkCodeSplit({ profile, heading = 'Where the marks go', compact = false }) {
    const groups = profile?.groups || [];
    if (groups.length === 0) {
        return (
            <section className={styles.Insight} aria-label={heading}>
                <h3 className={styles.InsightTitle}>{heading}</h3>
                <p className={styles.Blurb}>
                    Nothing marked yet. Once working is checked against a mark scheme, the
                    marks earned and missed show up here split by what each one was for.
                </p>
            </section>
        );
    }

    return (
        <section className={styles.Insight} aria-label={heading}>
            <h3 className={styles.InsightTitle}>{heading}</h3>
            {profile.headline && <p className={styles.Headline}>{profile.headline}</p>}

            <ul className={`${styles.Codes2} ${compact ? styles.CodesCompact : ''}`}>
                {groups.map((group) => {
                    const label = LABELS[group.code_class] || LABELS.other;
                    const percent =
                        group.earned_ratio === null || group.earned_ratio === undefined
                            ? null
                            : Math.round(group.earned_ratio * 100);
                    return (
                        <li key={group.code_class} className={styles.CodeRow}>
                            <div className={styles.CodeTop}>
                                <span className={styles.CodeName}>
                                    {label.name}
                                    <span className={styles.CodeWhat}> — {label.what}</span>
                                </span>
                                {percent !== null && (
                                    <span className={`${styles.CodePercent} ${styles[tone(group.earned_ratio)]}`}>
                                        {percent}%
                                    </span>
                                )}
                            </div>
                            {percent !== null && (
                                <div className={styles.BarTrack} aria-hidden="true">
                                    <div
                                        className={`${styles.BarFill} ${styles[tone(group.earned_ratio)]}`}
                                        style={{ width: `${Math.max(percent, 2)}%` }}
                                    />
                                </div>
                            )}
                            {/* The evidence, always. */}
                            <p className={styles.CodeEvidence}>
                                {group.earned} of {group.total} earned
                                {group.missed > 0 ? `, ${group.missed} missed` : ''}
                            </p>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

export default MarkCodeSplit;
