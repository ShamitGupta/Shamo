// Shared formatting for the teacher surface.
//
// In its own file because the roster and the student page both need it, and
// this project's convention is that a .jsx file exports components only --
// exporting a helper alongside one breaks fast refresh, which the lint rule
// enforces.

/**
 * Bands rather than a bare percentage, and identical to the student's own
 * panel. A teacher and their student must not be reading different
 * instruments: "struggling" has to mean the same thing on both screens.
 */
export function band(ratio) {
    if (ratio === null || ratio === undefined) return { label: 'Not marked yet', tone: 'unknown' };
    if (ratio < 0.4) return { label: 'Struggling', tone: 'low' };
    if (ratio < 0.7) return { label: 'Getting there', tone: 'mid' };
    return { label: 'Solid', tone: 'high' };
}

export function whenText(iso) {
    if (!iso) return 'never';
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return 'never';
    const days = Math.floor((Date.now() - when.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days} days ago`;
    return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// A fortnight. Long enough that a half-term week or a busy stretch does not
// trip it, short enough that a teacher can still do something about it.
const QUIET_DAYS = 14;

/**
 * Has this student gone quiet?
 *
 * Deliberately separate from whenText: a date a teacher has to convert in their
 * head is a date they will not notice. `null` -- never active at all -- counts,
 * because an account that has never been used is the loudest version of this.
 */
export function isQuiet(iso) {
    if (!iso) return true;
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return true;
    return (Date.now() - when.getTime()) / 86400000 >= QUIET_DAYS;
}

/** Never blank: an unnamed account still has to be clickable in a roster. */
export function studentName(student) {
    return student.display_name || student.email || 'Unnamed student';
}
