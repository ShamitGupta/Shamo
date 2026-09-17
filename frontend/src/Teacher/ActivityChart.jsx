// Whether anyone is actually working, week by week.
//
// Plain divs rather than a charting library: eight bars do not justify a
// dependency, and the numbers stay readable by a screen reader this way -- the
// list carries the real figures and the bars are decoration over them.
//
// Empty weeks are drawn, not skipped. The API returns them as zero rows for
// exactly this reason: a fortnight where nobody worked has to look like a
// fortnight where nobody worked, and omitting the bars would draw a smooth line
// straight over the gap a teacher is looking for.

import styles from './Teacher.module.css';

function weekLabel(iso) {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return '';
    return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function ActivityChart({ weeks, heading = 'Work handed in' }) {
    const data = weeks || [];
    const peak = Math.max(1, ...data.map((week) => week.attempts));
    const total = data.reduce((sum, week) => sum + week.attempts, 0);

    return (
        <section className={styles.Insight} aria-label={heading}>
            <h3 className={styles.InsightTitle}>{heading}</h3>
            {total === 0 ? (
                <p className={styles.Blurb}>
                    No attempts submitted in this period.
                </p>
            ) : (
                <p className={styles.Blurb}>
                    {total} {total === 1 ? 'attempt' : 'attempts'} over the last{' '}
                    {data.length} weeks.
                </p>
            )}

            <ol className={styles.Weeks}>
                {data.map((week) => {
                    const height = Math.round((week.attempts / peak) * 100);
                    const active = week.students_active || 0;
                    // How many students were active that week is a genuine second
                    // signal, and it does not fit: eight columns share the panel's
                    // width, which is about 34px each at any viewport, while the
                    // word "students" alone needs more. It rides on the label
                    // instead of being squeezed in or dropped.
                    const description =
                        `Week of ${weekLabel(week.week_start)}: ${week.attempts} ` +
                        `${week.attempts === 1 ? 'attempt' : 'attempts'} from ` +
                        `${active} ${active === 1 ? 'student' : 'students'}`;
                    return (
                        <li
                            key={week.week_start}
                            className={styles.Week}
                            title={description}
                            aria-label={description}
                        >
                            <span className={styles.WeekCount}>{week.attempts}</span>
                            <div className={styles.WeekTrack}>
                                <div
                                    className={`${styles.WeekBar} ${week.attempts === 0 ? styles.WeekEmpty : ''}`}
                                    style={{ height: `${Math.max(height, 2)}%` }}
                                    aria-hidden="true"
                                />
                            </div>
                            <span className={styles.WeekLabel} aria-hidden="true">
                                {weekLabel(week.week_start)}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

export default ActivityChart;
