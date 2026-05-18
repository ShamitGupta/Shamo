import { useState } from 'react';
import styles from './AuthForms.module.css';

function LoginForm() {
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

    const handleSubmit = (event) => {
        event.preventDefault();
    };

    return (
        <form className={styles.Form} onSubmit={handleSubmit}>
            <div className={styles.FieldGrid}>
                <label className={styles.Field}>
                    <span>Email</span>
                    <input
                        type="email"
                        placeholder="you@example.com"
                        value={formValues.email}
                        onChange={handleChange('email')}
                    />
                </label>

                <label className={styles.Field}>
                    <span>Password</span>
                    <input
                        type="password"
                        placeholder="Enter your password"
                        value={formValues.password}
                        onChange={handleChange('password')}
                    />
                </label>
            </div>

            <button type="submit" className={styles.SubmitButton}>
                Log in
            </button>

            <div className={styles.Divider}>
                <span>or continue with</span>
            </div>

            <button type="button" className={styles.GoogleButton}>
                <span className={styles.GoogleIcon} aria-hidden="true">G</span>
                <span>Google</span>
            </button>
        </form>
    );
}

export default LoginForm;
