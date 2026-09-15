import { useState } from 'react';

import styles from './ConversationList.module.css';
import { conversationLabel, useConversations } from './conversationContext.js';
import { SESSION_LABELS } from '../api/tutorApi.js';

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
                                        className={`${styles.Action} ${styles.Danger}`}
                                        onClick={async () => {
                                            setConfirmingId(null);
                                            await remove(conversation.id);
                                        }}
                                    >
                                        Delete
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.Action}
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
                                    aria-label={`Rename ${conversationLabel(conversation)}`}
                                    onClick={() => startRename(conversation)}
                                >
                                    Rename
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.Action} ${styles.Danger}`}
                                    aria-label={`Delete ${conversationLabel(conversation)}`}
                                    onClick={() => { setRenamingId(null); setConfirmingId(conversation.id); }}
                                >
                                    Delete
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
