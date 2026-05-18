import { useState } from 'react';
import GradeSelect from './GradeSelect';
import styles from './AuthForms.module.css';

function SignUpForm() {
    const [formValues, setFormValues] = useState({
        name: '',
        email: '',
        password: '',
        grade: ''
    });

    const handleChange = (field) => (event) => {
        setFormValues((prev) => ({
            ...prev,
            [field]: event.target.value
        }));
    };

    const handleGradeChange = (selectedGrade) => {
        setFormValues((prev) => ({
            ...prev,
            grade: selectedGrade
        }));
    };

    const handleSubmit = (event) => {
        event.preventDefault();
    };

    return (
        <form className={styles.Form} onSubmit={handleSubmit}>
            <div className={styles.FieldGrid}>
                <label className={styles.Field}>
                    <span>Name</span>
                    <input
                        type="text"
                        placeholder="Your full name"
                        value={formValues.name}
                        onChange={handleChange('name')}
                    />
                </label>

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
                        placeholder="Create a password"
                        value={formValues.password}
                        onChange={handleChange('password')}
                    />
                </label>

                <label className={styles.Field}>
                    <span>Grade</span>
                    <GradeSelect value={formValues.grade} onChange={handleGradeChange} />
                </label>
            </div>

            <button type="submit" className={styles.SubmitButton}>
                Create account
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

export default SignUpForm;
