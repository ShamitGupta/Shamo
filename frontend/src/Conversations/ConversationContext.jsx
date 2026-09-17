import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    createConversation,
    deleteConversation as deleteConversationRequest,
    fetchConversation,
    fetchConversations,
    renameConversation as renameConversationRequest,
} from '../api/tutorApi.js';
import { useAuth } from '../Auth/authContext.js';
import { ConversationContext } from './conversationContext.js';

// Which thread the student had open, so a refresh returns them to it rather
// than to a blank page. Only the id is kept locally; the messages themselves
// always come from the server, so this cannot go stale into something wrong --
// at worst the id no longer exists and is ignored below.
const ACTIVE_KEY = 'shamo.activeConversationId';

function readStoredActiveId() {
    try {
        return window.localStorage.getItem(ACTIVE_KEY);
    } catch {
        // Private windows and blocked site data both throw here.
        return null;
    }
}

function writeStoredActiveId(id) {
    try {
        if (id) window.localStorage.setItem(ACTIVE_KEY, id);
        else window.localStorage.removeItem(ACTIVE_KEY);
    } catch {
        // Losing the "which thread was open" convenience is survivable.
    }
}

export function ConversationProvider({ children }) {
    const { accessToken, isAuthenticated } = useAuth();

    const [conversations, setConversations] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [loadedTurns, setLoadedTurns] = useState(null);
    const [turnsStatus, setTurnsStatus] = useState('idle'); // idle | loading | ready | error
    const [error, setError] = useState(null);
    // Incremented by startNewConversation, so "give me a blank chat" is an
    // event the chat can respond to rather than a state it might already be in.
    const [newChatToken, setNewChatToken] = useState(0);

    // Guards a lazily-created thread against a double-click sending two
    // requests and quietly creating two conversations for one student turn.
    const pendingCreate = useRef(null);

    const refresh = useCallback(async () => {
        if (!accessToken) return [];
        try {
            const rows = await fetchConversations(accessToken);
            setConversations(rows);
            setError(null);
            return rows;
        } catch (requestError) {
            setError(requestError.message);
            return [];
        }
    }, [accessToken]);

    const openConversation = useCallback(async (id) => {
        setActiveId(id);
        writeStoredActiveId(id);
        if (!id || !accessToken) {
            setLoadedTurns(null);
            setTurnsStatus('idle');
            return;
        }
        setTurnsStatus('loading');
        try {
            const detail = await fetchConversation(id, accessToken);
            setLoadedTurns(detail.turns || []);
            setTurnsStatus('ready');
            setError(null);
        } catch (requestError) {
            // A thread that no longer exists should not strand the student on a
            // permanently failing screen -- drop the stored id and start clean.
            setLoadedTurns(null);
            setTurnsStatus('error');
            setError(requestError.message);
            if (requestError.status === 404) {
                setActiveId(null);
                writeStoredActiveId(null);
                setTurnsStatus('idle');
            }
        }
    }, [accessToken]);

    // On sign-in, restore whichever thread was open. This is the whole point of
    // the sprint: a refresh must not lose the conversation.
    useEffect(() => {
        let cancelled = false;
        if (!isAuthenticated || !accessToken) {
            setConversations([]);
            setActiveId(null);
            setLoadedTurns(null);
            setTurnsStatus('idle');
            return undefined;
        }
        (async () => {
            const rows = await refresh();
            if (cancelled) return;
            const stored = readStoredActiveId();
            if (stored && rows.some((row) => row.id === stored)) {
                await openConversation(stored);
            }
        })();
        return () => { cancelled = true; };
    }, [isAuthenticated, accessToken, refresh, openConversation]);

    const startNewConversation = useCallback(() => {
        // Deliberately does NOT create a row. An empty thread the student never
        // typed into would clutter their list forever; the row is created on
        // the first message instead. See ensureConversationId.
        setActiveId(null);
        writeStoredActiveId(null);
        setLoadedTurns(null);
        setTurnsStatus('idle');
        // Clearing the id is not enough on its own. The chat only reacts to the
        // id CHANGING, so asking for a new chat while already on an unsaved one
        // -- the most common case, and the reason this button looked broken --
        // moved nothing. The token changes on every click, so it always does.
        setNewChatToken((token) => token + 1);
    }, []);

    const ensureConversationId = useCallback(async () => {
        if (activeId) return activeId;
        if (!accessToken) return null;
        if (pendingCreate.current) return pendingCreate.current;

        pendingCreate.current = (async () => {
            const created = await createConversation(null, accessToken);
            setActiveId(created.id);
            writeStoredActiveId(created.id);
            setConversations((current) => [created, ...current]);
            setLoadedTurns([]);
            setTurnsStatus('ready');
            return created.id;
        })();
        try {
            return await pendingCreate.current;
        } finally {
            pendingCreate.current = null;
        }
    }, [activeId, accessToken]);

    const rename = useCallback(async (id, title) => {
        if (!accessToken) return;
        const updated = await renameConversationRequest(id, title, accessToken);
        setConversations((current) => current.map((row) => (row.id === id ? updated : row)));
    }, [accessToken]);

    const remove = useCallback(async (id) => {
        if (!accessToken) return;
        await deleteConversationRequest(id, accessToken);
        setConversations((current) => current.filter((row) => row.id !== id));
        if (id === activeId) startNewConversation();
    }, [accessToken, activeId, startNewConversation]);

    const value = useMemo(() => ({
        conversations,
        activeId,
        newChatToken,
        loadedTurns,
        turnsStatus,
        error,
        refresh,
        openConversation,
        startNewConversation,
        ensureConversationId,
        rename,
        remove,
    }), [
        conversations, activeId, newChatToken, loadedTurns, turnsStatus, error,
        refresh, openConversation, startNewConversation, ensureConversationId, rename, remove,
    ]);

    return (
        <ConversationContext.Provider value={value}>
            {children}
        </ConversationContext.Provider>
    );
}
