// The teacher's own door, at /teacher.
//
// Two things to know before changing it.
//
// 1. THE INVITE CODE IS NOT CHECKED HERE. It is posted to the server, which
//    compares it against a value the browser never sees. A check in this file
//    would be theatre -- anyone can call supabase.auth.signUp() directly, so a
//    client-side gate would stop exactly nobody.
//
// 2. SIGNING UP AND BECOMING STAFF ARE TWO STEPS, AND THE SECOND CAN FAIL.
//    Supabase creates the account; the backend grants the role. If the code is
//    wrong the account still exists, as a normal student account, and this page
//    says so plainly rather than leaving someone staring at a form that
//    apparently did nothing. They can type the right code and try again without
//    signing up twice.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../Auth/authContext.js';
import styles from './Teacher.module.css';

/**
 * Turn a provider error into something a teacher can act on.
 *
 * Supabase rejects an address whose domain it cannot see accepting mail, which
 * is how a plausible-looking school address gets a flat "is invalid" with no
 * clue that the DOMAIN is the problem. Everything else is passed through as
 * written -- guessing at an unfamiliar error helps nobody.
 */
function explain(error) {
    const message = error?.message || '';
    if (/is invalid/i.test(message) && /email/i.test(message)) {
        return `${message} Use an address that can actually receive mail — a domain ` +
            'that does not accept email is rejected before any account is made.';
    }
    return message || 'That did not work. Check the invite code and try again.';
}

function TeacherSignUp() {
    const navigate = useNavigate();
    const {
        isAuthenticated,
        isStaff,
        user,
        actionStatus,
        signUpWithPassword,
        signInWithPassword,
        signInWithGoogle,
        claimStaffRoleWithCode,
    } = useAuth();

    const [mode, setMode] = useState('signup'); // 'signup' | 'signin'
    const [values, setValues] = useState({ name: '', email: '', password: '', inviteCode: '' });
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const change = (field) => (event) =>
        setValues((prev) => ({ ...prev, [field]: event.target.value }));

    // Google leaves the page entirely, so the invite code in the form is gone
    // by the time the browser comes back. That is fine -- on return the page
    // sees a signed-in account and asks for the code alone, one field. The flag
    // is only a note to App.jsx in case Supabase's redirect allow-list refuses
    // the deeper URL and drops the browser on the site root instead.
    const handleGoogle = async () => {
        setError('');
        setNotice('');
        try {
            sessionStorage.setItem('shamo.teacherIntent', '1');
        } catch {
            // Private mode. The redirect below usually lands correctly anyway.
        }
        try {
            await signInWithGoogle('/teacher');
        } catch (googleError) {
            setError(explain(googleError));
        }
    };

    const claim = async (code) => {
        await claimStaffRoleWithCode(code);
        navigate('/dashboard');
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError('');
        setNotice('');

        const code = values.inviteCode.trim();
        if (!code) {
            setError('An invite code is required for a teacher account.');
            return;
        }

        try {
            // Already signed in: this is just the claim step, which is the path
            // someone lands on after a failed code or an email verification.
            if (isAuthenticated) {
                await claim(code);
                return;
            }

            if (mode === 'signin') {
                await signInWithPassword({ email: values.email, password: values.password });
                await claim(code);
                return;
            }

            const data = await signUpWithPassword({
                name: values.name,
                email: values.email,
                password: values.password,
                grade: '',
            });

            if (!data?.session) {
                // Two different situations arrive here and the browser cannot
                // tell them apart: a new account awaiting email verification,
                // and an email that already has an account -- Supabase answers
                // a repeated signup with 200 and no user rather than confirm to
                // a stranger that an address is registered. This used to say
                // "Account created", which is false in the second case and
                // leaves a returning teacher waiting for a mail nobody sent.
                // Say what is true of both, and switch to the form that works
                // either way.
                setNotice(
                    'Almost there. If that email is new, verify it from the message ' +
                    'just sent, then sign in below with the invite code. If it already ' +
                    'has a Shamo account, nothing new was created — just sign in below.',
                );
                setMode('signin');
                return;
            }
            await claim(code);
        } catch (claimError) {
            setError(explain(claimError));
        }
    };

    if (isStaff) {
        return (
            <main className={styles.AuthPage}>
                <div className={styles.AuthCard}>
                    <h1 className={styles.AuthTitle}>You are signed in as a teacher</h1>
                    <p className={styles.AuthBlurb}>
                        {user?.email}
                    </p>
                    <Link className={styles.PrimaryLink} to="/dashboard">
                        Go to the dashboard
                    </Link>
                </div>
            </main>
        );
    }

    const busy = actionStatus === 'loading';

    return (
        <main className={styles.AuthPage}>
            <form className={styles.AuthCard} onSubmit={handleSubmit}>
                <h1 className={styles.AuthTitle}>Teacher access</h1>
                <p className={styles.AuthBlurb}>
                    For staff at a school using Shamo. You will need the invite code your
                    school was given. A teacher account can see how students are practising
                    and the work they submit for marking — it cannot read their conversations
                    with the tutor.
                </p>

                {error && <div className={styles.Error}>{error}</div>}
                {notice && <div className={styles.Notice}>{notice}</div>}

                {isAuthenticated ? (
                    <p className={styles.AuthBlurb}>
                        Signed in as {user?.email}. Enter the invite code to turn this into a
                        teacher account.
                    </p>
                ) : (
                    <>
                        {mode === 'signup' && (
                            <label className={styles.Field}>
                                <span>Name</span>
                                <input
                                    type="text"
                                    value={values.name}
                                    onChange={change('name')}
                                    placeholder="Your full name"
                                    required
                                />
                            </label>
                        )}
                        <label className={styles.Field}>
                            <span>School email</span>
                            <input
                                type="email"
                                value={values.email}
                                onChange={change('email')}
                                required
                            />
                        </label>
                        <label className={styles.Field}>
                            <span>Password</span>
                            <input
                                type="password"
                                value={values.password}
                                onChange={change('password')}
                                minLength={8}
                                required
                            />
                        </label>
                    </>
                )}

                <label className={styles.Field}>
                    <span>Invite code</span>
                    <input
                        type="text"
                        value={values.inviteCode}
                        onChange={change('inviteCode')}
                        placeholder="Given to your school"
                        autoComplete="off"
                        required
                    />
                </label>

                {!isAuthenticated && (
                    <>
                        <button
                            type="button"
                            className={styles.Google}
                            onClick={handleGoogle}
                            disabled={busy}
                        >
                            Continue with Google
                        </button>
                        <span className={styles.Divider}>or</span>
                    </>
                )}

                <button type="submit" className={styles.Primary} disabled={busy}>
                    {busy ? 'Working…' : isAuthenticated ? 'Enable teacher access' : 'Continue'}
                </button>

                {!isAuthenticated && (
                    <button
                        type="button"
                        className={styles.Secondary}
                        onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); }}
                    >
                        {mode === 'signup'
                            ? 'I already have an account'
                            : 'Create a new teacher account'}
                    </button>
                )}

                <Link className={styles.QuietLink} to="/">I'm a student — take me to the tutor</Link>
            </form>
        </main>
    );
}

export default TeacherSignUp;
