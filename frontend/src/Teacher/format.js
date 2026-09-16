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

/** Never blank: an unnamed account still has to be clickable in a roster. */
export function studentName(student) {
    return student.display_name || student.email || 'Unnamed student';
}
