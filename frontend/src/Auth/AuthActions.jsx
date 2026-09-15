import styles from './AuthActions.module.css';

const TIER_LABELS = {
    free: 'Free',
    premium: 'Premium',
    shamo_student: 'Shamo Student',
};

function AuthActions({ user, profile, tier, isLoading, onOpenSignUp, onOpenLogIn, onSignOut }) {
    if (user) {
        const name = profile?.display_name || user.email || 'Signed in';
        return (
            <div className={styles.Account} aria-label="Signed-in account">
                <div className={styles.AccountText}>
                    <span className={styles.AccountName}>{name}</span>
                    <span className={styles.AccountTier}>{TIER_LABELS[tier] || 'Free'}</span>
                </div>
                <button
                    type="button"
                    className={styles.SecondaryButton}
                    onClick={onSignOut}
                    disabled={isLoading}
                >
                    Sign out
                </button>
            </div>
        );
    }

    return (
        <div className={styles.Actions} aria-label="Authentication actions">
            <button type="button" className={styles.LoginButton} onClick={onOpenLogIn} disabled={isLoading}>
                Log In
            </button>
            <button type="button" className={styles.PrimaryButton} onClick={onOpenSignUp} disabled={isLoading}>
                Sign Up
            </button>
        </div>
    );
}

export default AuthActions;
