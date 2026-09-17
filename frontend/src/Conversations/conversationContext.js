import { createContext, useContext } from 'react';

export const ConversationContext = createContext(null);

export function useConversations() {
    const context = useContext(ConversationContext);
    if (!context) {
        throw new Error('useConversations must be used inside ConversationProvider');
    }
    return context;
}

/**
 * What to call a thread that the student never named.
 *
 * Dated rather than "Untitled": a list of six "Untitled" rows is useless, and
 * the date is the thing a student actually remembers a session by.
 */
export function conversationLabel(conversation) {
    if (conversation?.title) return conversation.title;
    const raw = conversation?.last_active_at || conversation?.created_at;
    if (!raw) return 'New conversation';
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) return 'New conversation';

    const today = new Date();
    const sameDay = when.toDateString() === today.toDateString();
    if (sameDay) {
        return `Today, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    }
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (when.toDateString() === yesterday.toDateString()) {
        return `Yesterday, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    }
    return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
