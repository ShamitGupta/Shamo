import { useState } from 'react';
import styles from './AuthForms.module.css';

function LoginForm({ onLogin, onGoogle, isLoading, error, notice }) {
    const [formValues, setFormValues] = useState({
        email: '',
        password: ''
    });

    const handleChange = (field) => (event) => {
        setFormValues((prev) => ({
            ...prev,
            [field]: event.target.value
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            await onLogin(formValues);
        } catch {
            // AuthContext owns the visible error message.
        }
    };

    const handleGoogle = async () => {
        try {
            await onGoogle();
        } catch {
            // AuthContext owns the visible error message.
        }
    };

    return (
        <form className={styles.Form} onSubmit={handleSubmit}>
            {error && <div className={styles.Error}>{error}</div>}
            {notice && <div className={styles.Notice}>{notice}</div>}
            <div className={styles.FieldGrid}>
                <label className={styles.Field}>
                    <span>Email</span>
                    <input
                        type="email"
                        placeholder="you@example.com"
                        value={formValues.email}
                        onChange={handleChange('email')}
                        required
                    />
                </label>

                <label className={styles.Field}>
                    <span>Password</span>
                    <input
                        type="password"
                        placeholder="Enter your password"
                        value={formValues.password}
                        onChange={handleChange('password')}
                        required
                    />
                </label>
            </div>

            <button type="submit" className={styles.SubmitButton} disabled={isLoading}>
                {isLoading ? 'Logging in...' : 'Log in'}
            </button>

            <div className={styles.Divider}>
                <span>or continue with</span>
            </div>

            <button type="button" className={styles.GoogleButton} onClick={handleGoogle} disabled={isLoading}>
                <span className={styles.GoogleIcon} aria-hidden="true">G</span>
                <span>Google</span>
            </button>
        </form>
    );
}

export default LoginForm;
