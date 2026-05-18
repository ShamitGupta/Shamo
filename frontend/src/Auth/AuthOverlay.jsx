import { useEffect } from 'react';
import LoginForm from './LoginForm';
import SignUpForm from './SignUpForm';
import styles from './AuthOverlay.module.css';

function AuthOverlay({ isOpen, mode, onClose }) {
    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose]);

    if (!isOpen) {
        return null;
    }

    const isSignUp = mode === 'signup';

    return (
        <div className={styles.Overlay} role="dialog" aria-modal="true" aria-labelledby="auth-overlay-title">
            <button type="button" className={styles.Backdrop} onClick={onClose} aria-label="Close authentication window" />

            <div className={styles.Panel}>
                <div className={styles.FormColumn}>
                    <div className={styles.HeaderRow}>
                        <span className={styles.ModeLabel}>
                            {isSignUp ? 'Sign Up' : 'Log In'}
                        </span>

                        <button type="button" className={styles.CloseButton} onClick={onClose} aria-label="Close authentication window">
                            x
                        </button>
                    </div>

                    <div className={styles.FormIntro}>
                        <h2 id="auth-overlay-title" className={styles.Title}>
                            {isSignUp ? 'Create your account' : 'Welcome back'}
                        </h2>
                        <p>
                            {isSignUp
                                ? 'Add your details below to set up the future authenticated Shamo experience.'
                                : 'Enter your details below to access your account once authentication is connected.'}
                        </p>
                    </div>

                    {isSignUp ? <SignUpForm /> : <LoginForm />}
                </div>
            </div>
        </div>
    );
}

export default AuthOverlay;
