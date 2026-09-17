import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, claimStaffRole, ApiError } from '../api/tutorApi.js';
import { isSupabaseConfigured, supabase } from '../api/supabaseClient.js';
import { AuthContext } from './authContext.js';

function userMessage(error) {
    if (error instanceof ApiError) return error.message;
    if (error?.message) return error.message;
    return 'Authentication is unavailable right now.';
}

export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [user, setUser] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);
    const [status, setStatus] = useState(isSupabaseConfigured ? 'loading' : 'unconfigured');
    const [actionStatus, setActionStatus] = useState('idle');
    const [authError, setAuthError] = useState('');
    const [authNotice, setAuthNotice] = useState('');

    const refreshCurrentUser = useCallback(async (nextSession) => {
        if (!nextSession?.access_token) {
            setCurrentUser(null);
            return null;
        }

        const data = await getCurrentUser(nextSession.access_token);
        setCurrentUser(data);
        return data;
    }, []);

    useEffect(() => {
        if (!supabase) {
            return undefined;
        }

        let active = true;

        supabase.auth.getSession().then(async ({ data, error }) => {
            if (!active) return;
            if (error) {
                setAuthError(userMessage(error));
                setStatus('ready');
                return;
            }
            const nextSession = data?.session ?? null;
            setSession(nextSession);
            setUser(nextSession?.user ?? null);
            if (nextSession) {
                try {
                    await refreshCurrentUser(nextSession);
                } catch (currentUserError) {
                    setAuthError(userMessage(currentUserError));
                }
            }
            if (active) setStatus('ready');
        });

        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
            setSession(nextSession);
            setUser(nextSession?.user ?? null);
            setAuthError('');
            if (nextSession) {
                refreshCurrentUser(nextSession).catch((error) => {
                    setCurrentUser(null);
                    setAuthError(userMessage(error));
                });
            } else {
                setCurrentUser(null);
            }
        });

        return () => {
            active = false;
            listener?.subscription?.unsubscribe();
        };
    }, [refreshCurrentUser]);

    const signUpWithPassword = useCallback(async ({ name, email, password, grade }) => {
        if (!supabase) {
            throw new Error('Supabase is not configured.');
        }
        setActionStatus('loading');
        setAuthError('');
        setAuthNotice('');
        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: window.location.origin,
                    data: {
                        display_name: name,
                        grade: grade || null,
                    },
                },
            });
            if (error) throw error;
            if (data?.session) {
                await refreshCurrentUser(data.session);
            } else {
                // No session can mean two things and the browser CANNOT tell
                // them apart: a new account awaiting email verification, or an
                // email that already has one. Supabase answers a repeated
                // signup with 200 and no user at all rather than confirm to a
                // stranger that an address is registered -- verified against
                // the live API. So say something true of both cases instead of
                // asserting an account was created, which sent a returning user
                // off to wait for a mail that was never sent.
                setAuthNotice(
                    'If that email is new, check your inbox to verify it. '
                    + 'If you have signed up before, log in instead.',
                );
            }
            return data;
        } catch (error) {
            setAuthError(userMessage(error));
            throw error;
        } finally {
            setActionStatus('idle');
        }
    }, [refreshCurrentUser]);

    const signInWithPassword = useCallback(async ({ email, password }) => {
        if (!supabase) {
            throw new Error('Supabase is not configured.');
        }
        setActionStatus('loading');
        setAuthError('');
        setAuthNotice('');
        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            if (data?.session) {
                await refreshCurrentUser(data.session);
            }
            return data;
        } catch (error) {
            setAuthError(userMessage(error));
            throw error;
        } finally {
            setActionStatus('idle');
        }
    }, [refreshCurrentUser]);

    // `returnPath` exists for the teacher page, which needs the browser back on
    // /teacher after the Google round trip rather than on the tutor. It is a
    // PATH, joined to this origin here, so a caller cannot send someone to
    // another site via an open redirect. A project whose Supabase redirect
    // allow-list holds only the bare origin will refuse the deeper URL and land
    // on the site root instead -- App.jsx carries a sessionStorage fallback for
    // exactly that case, so the round trip still finishes where it should.
    const signInWithGoogle = useCallback(async (returnPath) => {
        if (!supabase) {
            throw new Error('Supabase is not configured.');
        }
        setActionStatus('loading');
        setAuthError('');
        setAuthNotice('');
        try {
            // Guarded on the type, not just on truthiness: this is also passed
            // straight to onClick in places, and a click event is truthy.
            const redirectTo = typeof returnPath === 'string' && returnPath
                ? new URL(returnPath, window.location.origin).toString()
                : window.location.origin;
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo },
            });
            if (error) throw error;
        } catch (error) {
            setAuthError(userMessage(error));
            setActionStatus('idle');
            throw error;
        }
    }, []);

    const signOut = useCallback(async () => {
        if (!supabase) return;
        setActionStatus('loading');
        setAuthError('');
        setAuthNotice('');
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            setSession(null);
            setUser(null);
            setCurrentUser(null);
        } catch (error) {
            setAuthError(userMessage(error));
            throw error;
        } finally {
            setActionStatus('idle');
        }
    }, []);

    const clearAuthMessages = useCallback(() => {
        setAuthError('');
        setAuthNotice('');
    }, []);

    const claimStaffRoleWithCode = useCallback(async (inviteCode) => {
        // The token is read from Supabase, NOT from the `session` state above.
        // Claiming almost always happens in the same handler as the sign-in
        // that preceded it, and at that point this closure still holds the
        // session from the render before -- which is null. Reading state here
        // made "sign in, then enter the code" fail with "Sign in before
        // claiming a teacher account" immediately after a successful sign in.
        let accessToken = session?.access_token ?? null;
        if (!accessToken && supabase) {
            const { data: live } = await supabase.auth.getSession();
            accessToken = live?.session?.access_token ?? null;
        }
        if (!accessToken) {
            throw new Error('Sign in before claiming a teacher account.');
        }
        setActionStatus('loading');
        setAuthError('');
        try {
            const data = await claimStaffRole(inviteCode, accessToken);
            // Take the server's answer rather than assuming success flipped the
            // role -- /me is what every routing decision reads, and it is the
            // server that decides what it says.
            setCurrentUser(data);
            return data;
        } catch (error) {
            setAuthError(userMessage(error));
            throw error;
        } finally {
            setActionStatus('idle');
        }
    }, [session]);

    const value = useMemo(() => ({
        session,
        user,
        currentUser,
        status,
        actionStatus,
        authError,
        authNotice,
        isConfigured: isSupabaseConfigured,
        isReady: status === 'ready',
        isAuthenticated: Boolean(session?.access_token && user),
        accessToken: session?.access_token ?? null,
        tier: currentUser?.tier ?? null,
        // Which surface this account belongs to. The SERVER decides it; the
        // browser only routes on it. Defaults to student while /me is still
        // loading, so a flicker shows the tutor rather than a dashboard.
        role: currentUser?.role ?? 'student',
        isStaff: currentUser?.role === 'staff',
        profile: currentUser?.profile ?? null,
        signUpWithPassword,
        signInWithPassword,
        signInWithGoogle,
        signOut,
        refreshCurrentUser,
        clearAuthMessages,
        claimStaffRoleWithCode,
    }), [
        session,
        user,
        currentUser,
        status,
        actionStatus,
        authError,
        authNotice,
        signUpWithPassword,
        signInWithPassword,
        signInWithGoogle,
        signOut,
        refreshCurrentUser,
        clearAuthMessages,
        claimStaffRoleWithCode,
    ]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
