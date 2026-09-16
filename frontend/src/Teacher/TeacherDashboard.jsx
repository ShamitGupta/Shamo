// The class roster: who has been working, and how it is going.
//
// Sortable because the question a head of department actually asks is "who do I
// need to talk to", not "tell me about Aisha" -- and that question is answered
// by ordering the list, not by opening six profiles.
//
// Two display rules carried over from the student side, for the same reasons:
//
//   * a score is never shown alone. Every row carries the attempts behind it,
//     so "37%" can be read as "8 questions" rather than as a verdict;
//   * a student with no marked work shows "not marked yet", never 0%. A zero
//     would sort to the top of a struggling list and accuse someone who has
//     simply not been marked.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, fetchStudents } from '../api/tutorApi.js';
import { useAuth } from '../Auth/authContext.js';
import SampleBadge from './SampleBadge.jsx';
import { band, studentName, whenText } from './format.js';
import styles from './Teacher.module.css';

const COLUMNS = [
    { key: 'name', label: 'Student' },
    { key: 'mark_ratio', label: 'Marks', numeric: true },
    { key: 'attempts', label: 'Attempts', numeric: true },
    { key: 'turns', label: 'Messages', numeric: true },
    { key: 'weakest_topic', label: 'Weakest topic' },
    { key: 'last_active_at', label: 'Last active' },
];

function TeacherDashboard() {
    const { accessToken, isStaff, isReady } = useAuth();
    const [students, setStudents] = useState(null);
    const [error, setError] = useState('');
    // Least-marks-first by default: the roster's job is to surface who needs
    // attention, and that is not alphabetical order.
    const [sort, setSort] = useState({ key: 'mark_ratio', ascending: true });

    useEffect(() => {
        if (!accessToken || !isStaff) return undefined;
        const controller = new AbortController();
        fetchStudents(accessToken, controller.signal)
            .then((rows) => {
                if (controller.signal.aborted) return;
                setStudents(rows);
                setError('');
            })
            .catch((err) => {
                if (controller.signal.aborted || err?.name === 'AbortError') return;
                setError(err instanceof ApiError ? err.message : 'Could not load your class.');
            });
        return () => controller.abort();
    }, [accessToken, isStaff]);

    const sorted = useMemo(() => {
        if (!students) return [];
        const rows = [...students];
        const { key, ascending } = sort;
        rows.sort((a, b) => {
            let left = key === 'name' ? studentName(a).toLowerCase() : a[key];
            let right = key === 'name' ? studentName(b).toLowerCase() : b[key];
            // Null sorts last whichever way the column is pointed. A student
            // with nothing recorded is not the weakest student in the class.
            if (left === null || left === undefined) return 1;
            if (right === null || right === undefined) return -1;
            if (left === right) return 0;
            return (left < right ? -1 : 1) * (ascending ? 1 : -1);
        });
        return rows;
    }, [students, sort]);

    const toggleSort = (key) =>
        setSort((prev) => ({ key, ascending: prev.key === key ? !prev.ascending : true }));

    // Until /me has answered, show nothing that implies this is anyone's class.
    // Without this a student opening /dashboard sees "Your class" and a loading
    // row for a frame before being turned away, which reads like the page was
    // theirs and broke rather than like a door they cannot open.
    if (!isReady) {
        return (
            <main className={styles.Page}>
                <p className={styles.Blurb}>Loading…</p>
            </main>
        );
    }

    if (!isStaff) {
        return (
            <main className={styles.Page}>
                <div className={styles.Empty}>
                    <h1 className={styles.Title}>This area is for staff accounts</h1>
                    <p className={styles.Blurb}>
                        If your school uses Shamo, you can set up a teacher account with your
                        school's invite code.
                    </p>
                    <Link className={styles.PrimaryLink} to="/teacher">Teacher access</Link>
                    <Link className={styles.QuietLink} to="/">Back to the tutor</Link>
                </div>
            </main>
        );
    }

    const hasSamples = sorted.some((student) => student.is_sample);

    return (
        <main className={styles.Page}>
            <header className={styles.PageHeader}>
                <div>
                    <h1 className={styles.Title}>Your class</h1>
                    <p className={styles.Blurb}>
                        What each student has practised and how they are scoring. Their
                        conversations with the tutor are private and are not shown here.
                    </p>
                </div>
                <Link className={styles.QuietLink} to="/">Open the tutor</Link>
            </header>

            {hasSamples && (
                <p className={styles.SampleNotice}>
                    Rows marked <SampleBadge /> are demonstration data, not real students.
                </p>
            )}

            {error && <p className={styles.Error}>{error}</p>}
            {!error && students === null && <p className={styles.Blurb}>Loading your class…</p>}
            {!error && students?.length === 0 && (
                <p className={styles.Blurb}>No students have signed up yet.</p>
            )}

            {sorted.length > 0 && (
                <div className={styles.TableWrap}>
                    <table className={styles.Table}>
                        <thead>
                            <tr>
                                {COLUMNS.map((column) => (
                                    <th key={column.key} className={column.numeric ? styles.Numeric : ''}>
                                        <button
                                            type="button"
                                            className={styles.SortButton}
                                            onClick={() => toggleSort(column.key)}
                                            aria-label={`Sort by ${column.label}`}
                                        >
                                            {column.label}
                                            {sort.key === column.key && (
                                                <span aria-hidden="true">{sort.ascending ? ' ▲' : ' ▼'}</span>
                                            )}
                                        </button>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((student) => {
                                const { label, tone } = band(student.mark_ratio);
                                return (
                                    <tr key={student.user_id}>
                                        <td>
                                            <Link
                                                className={styles.StudentLink}
                                                to={`/dashboard/students/${student.user_id}`}
                                            >
                                                {studentName(student)}
                                            </Link>
                                            {student.is_sample && <SampleBadge />}
                                            {/* An account with no display name falls back to its
                                                email, and printing the same string twice looks
                                                like a rendering bug rather than a detail. */}
                                            {student.email !== studentName(student) && (
                                                <span className={styles.Email}>{student.email}</span>
                                            )}
                                        </td>
                                        <td className={styles.Numeric}>
                                            <span className={`${styles.Band} ${styles[tone]}`}>{label}</span>
                                            {student.mark_ratio !== null && (
                                                <span className={styles.Ratio}>
                                                    {Math.round(student.mark_ratio * 100)}%
                                                </span>
                                            )}
                                        </td>
                                        <td className={styles.Numeric}>
                                            {student.attempts}
                                            {student.scored_attempts !== student.attempts && (
                                                <span className={styles.Sub}>
                                                    {student.scored_attempts} marked
                                                </span>
                                            )}
                                        </td>
                                        <td className={styles.Numeric}>{student.turns}</td>
                                        <td>
                                            {student.weakest_topic || (
                                                <span className={styles.Sub}>not enough attempts yet</span>
                                            )}
                                        </td>
                                        <td>{whenText(student.last_active_at)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </main>
    );
}

export default TeacherDashboard;
