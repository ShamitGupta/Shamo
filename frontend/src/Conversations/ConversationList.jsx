import { useState } from 'react';

import styles from './ConversationList.module.css';
import { conversationLabel, useConversations } from './conversationContext.js';
import { SESSION_LABELS } from '../api/tutorApi.js';

// Icons rather than the words "Rename" and "Delete". Two labels per row, on
// every row, competed with the thread names for a sidebar that is only ~300px
// wide -- and the thread name is the only thing there worth reading. The
// accessible name is still the full sentence, on the button.
function PencilIcon() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path
                d="M11.4 2.1a1.4 1.4 0 0 1 2 2l-7.3 7.3-2.7.7.7-2.7 7.3-7.3ZM10.2 3.3l2.5 2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function TrashIcon() {
    return (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path
                d="M3 4.3h10M6.4 4.3V3.1a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.2M4.4 4.3l.6 8.2a.9.9 0 0 0 .9.8h4.2a.9.9 0 0 0 .9-.8l.6-8.2M6.7 6.6v4.4M9.3 6.6v4.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** "9709/12 Oct/Nov 2025 Q4" from a stored reference, or nothing. */
function questionSubtitle(reference) {
    if (!reference) return '';
    const session = SESSION_LABELS[reference.exam_session] || reference.exam_session;
    return `${reference.syllabus_code}/${reference.paper_variant} ${session} ${reference.year} Q${reference.question_number}`;
}

function ConversationList({ onNavigate }) {
    const {
        conversations,
        activeId,
        error,
        openConversation,
        rename,
        remove,
    } = useConversations();

    const [renamingId, setRenamingId] = useState(null);
    const [draftTitle, setDraftTitle] = useState('');
    const [confirmingId, setConfirmingId] = useState(null);

    const startRename = (conversation) => {
        setConfirmingId(null);
        setRenamingId(conversation.id);
        setDraftTitle(conversation.title || '');
    };

    const commitRename = async (id) => {
        const next = draftTitle.trim();
        setRenamingId(null);
        // An emptied box means "no name", which is a real choice -- the thread
        // falls back to its dated label rather than keeping the old title.
        await rename(id, next || null);
    };

    if (error) {
        return <p className={styles.Error}>{error}</p>;
    }

    return (
        <div className={styles.Wrapper}>
            <p className={styles.Heading}>Your conversations</p>
            {conversations.length === 0 ? (
                <p className={styles.Empty}>
                    Nothing saved yet. Ask the tutor something and this conversation
                    will be here when you come back.
                </p>
            ) : (
                <ul className={styles.List}>
                    {conversations.map((conversation) => {
                        const isActive = conversation.id === activeId;
                        const subtitle = questionSubtitle(conversation.last_question);

                        if (renamingId === conversation.id) {
                            return (
                                <li key={conversation.id} className={styles.Row}>
                                    <input
                                        className={styles.RenameInput}
                                        value={draftTitle}
                                        autoFocus
                                        maxLength={120}
                                        aria-label="Conversation name"
                                        onChange={(event) => setDraftTitle(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') void commitRename(conversation.id);
                                            if (event.key === 'Escape') setRenamingId(null);
                                        }}
                                        onBlur={() => void commitRename(conversation.id)}
                                    />
                                </li>
                            );
                        }

                        if (confirmingId === conversation.id) {
                            return (
                                <li key={conversation.id} className={styles.Row}>
                                    <span className={styles.ConfirmRow}>
                                        <span className={styles.ConfirmText}>Delete permanently?</span>
                                    </span>
                                    <button
                                        type="button"
                                        className={`${styles.ConfirmAction} ${styles.Danger}`}
                                        onClick={async () => {
                                            setConfirmingId(null);
                                            await remove(conversation.id);
                                        }}
                                    >
                                        Delete
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.ConfirmAction}
                                        onClick={() => setConfirmingId(null)}
                                    >
                                        Keep
                                    </button>
                                </li>
                            );
                        }

                        return (
                            <li
                                key={conversation.id}
                                className={`${styles.Row} ${isActive ? styles.RowActive : ''}`}
                            >
                                <button
                                    type="button"
                                    className={styles.Open}
                                    aria-current={isActive ? 'true' : undefined}
                                    onClick={() => {
                                        void openConversation(conversation.id);
                                        if (onNavigate) onNavigate();
                                    }}
                                >
                                    <span className={styles.Title}>{conversationLabel(conversation)}</span>
                                    {subtitle && <span className={styles.Subtitle}>{subtitle}</span>}
                                </button>
                                <button
                                    type="button"
                                    className={styles.Action}
                                    title="Rename"
                                    aria-label={`Rename ${conversationLabel(conversation)}`}
                                    onClick={() => startRename(conversation)}
                                >
                                    <PencilIcon />
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.Action} ${styles.Danger}`}
                                    title="Delete"
                                    aria-label={`Delete ${conversationLabel(conversation)}`}
                                    onClick={() => { setRenamingId(null); setConfirmingId(conversation.id); }}
                                >
                                    <TrashIcon />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

export default ConversationList;
