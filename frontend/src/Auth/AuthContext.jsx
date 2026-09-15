import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentUser, ApiError } from '../api/tutorApi.js';
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
                setAuthNotice('Check your email to verify your account before using the tutor.');
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

    const signInWithGoogle = useCallback(async () => {
        if (!supabase) {
            throw new Error('Supabase is not configured.');
        }
        setActionStatus('loading');
        setAuthError('');
        setAuthNotice('');
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: window.location.origin },
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
        profile: currentUser?.profile ?? null,
        signUpWithPassword,
        signInWithPassword,
        signInWithGoogle,
        signOut,
        refreshCurrentUser,
        clearAuthMessages,
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
    ]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
