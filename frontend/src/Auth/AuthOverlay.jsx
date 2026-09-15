import { useEffect } from 'react';
import LoginForm from './LoginForm';
import SignUpForm from './SignUpForm';
import styles from './AuthOverlay.module.css';
import { useAuth } from './authContext.js';

function AuthOverlay({ isOpen, mode, onClose }) {
    const {
        isConfigured,
        isAuthenticated,
        actionStatus,
        authError,
        authNotice,
        signInWithPassword,
        signUpWithPassword,
        signInWithGoogle,
        clearAuthMessages,
    } = useAuth();

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

    useEffect(() => {
        if (isOpen) {
            clearAuthMessages();
        }
    }, [isOpen, mode, clearAuthMessages]);

    useEffect(() => {
        if (isOpen && isAuthenticated && mode === 'login') {
            onClose();
        }
    }, [isOpen, isAuthenticated, mode, onClose]);

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
                                ? 'Add your details below to set up the best learning experience.'
                                : 'Enter your details below to access your account.'}
                        </p>
                    </div>

                    {!isConfigured && (
                        <div className={styles.ConfigNotice}>
                            Supabase auth is not configured for this frontend build.
                        </div>
                    )}

                    {isSignUp ? (
                        <SignUpForm
                            onSignUp={signUpWithPassword}
                            onGoogle={signInWithGoogle}
                            isLoading={actionStatus === 'loading' || !isConfigured}
                            error={authError}
                            notice={authNotice}
                        />
                    ) : (
                        <LoginForm
                            onLogin={signInWithPassword}
                            onGoogle={signInWithGoogle}
                            isLoading={actionStatus === 'loading' || !isConfigured}
                            error={authError}
                            notice={authNotice}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

export default AuthOverlay;
