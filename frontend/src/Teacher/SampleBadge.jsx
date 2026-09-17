// Marks a demonstration account wherever its name appears.
//
// Small, but not cosmetic. The dashboard is shown to people evaluating whether
// this works, and invented students presented without a label would be a
// misrepresentation rather than a rough edge. It renders on every surface that
// names a student, which is why it is a component instead of a class name.

import styles from './Teacher.module.css';

function SampleBadge() {
    return (
        <span className={styles.SampleBadge} title="Demonstration data, not a real student">
            sample
        </span>
    );
}

export default SampleBadge;
