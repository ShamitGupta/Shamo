import styles from './AuthActions.module.css';

function AuthActions({ onOpenSignUp, onOpenLogIn }) {
    return (
        <div className={styles.Actions} aria-label="Authentication actions">
            <button type="button" className={styles.SecondaryButton} onClick={onOpenLogIn}>
                Log In
            </button>
            <button type="button" className={styles.PrimaryButton} onClick={onOpenSignUp}>
                Sign Up
            </button>
        </div>
    );
}

export default AuthActions;
