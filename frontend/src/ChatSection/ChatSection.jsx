import styles from './ChatSection.module.css'
import { Fragment, useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { sanitizeLatex } from '../utils/sanitizeLatex.js';
import { createAssistedResponse, createCoordinatedResponse, createVisualization, fetchQuestion, streamChat, TUTOR_MODES, SESSION_LABELS, ApiError } from '../api/tutorApi.js';
import MetadataDropdown from './MetadataDropdown';
import QuestionPanel from './QuestionPanel';
import SimilarQuestions from './SimilarQuestions';
import VisualArtifactCard from './VisualArtifactCard';
import { useAuth } from '../Auth/authContext.js';
import { useConversations } from '../Conversations/conversationContext.js';
import { useWorkspace } from '../Workspace/workspaceContext.js';

const MAX_SESSION_MEMORY_MESSAGES = 10;
const TUTOR_STRATEGY = {
    value: 'tutor',
    label: 'Tutor',
    blurb: 'Keep the default, and let Shamo choose based on your question.',
};
const MODE_OPTIONS = [TUTOR_STRATEGY, ...TUTOR_MODES];

function modeLabel(value) {
    return MODE_OPTIONS.find((m) => m.value === value)?.label || value;
}


/** "9709/12 Oct/Nov 2025 Q4", used for the divider between questions. */
function questionHeading(reference) {
    if (!reference) return '';
    const session = SESSION_LABELS[reference.exam_session] || reference.exam_session;
    return `${reference.syllabus_code}/${reference.paper_variant} ${session} ${reference.year} Q${reference.question_number}`;
}

function sameQuestion(a, b) {
    if (!a || !b) return a === b;
    return questionHeading(a) === questionHeading(b);
}

/**
 * Turn a stored conversation turn back into a rendered message.
 *
 * One thing does not survive the round trip: a Visualize turn's full artifact
 * spec. Only a short summary of each visual is stored -- deliberately, since a
 * stored spec would carry an expired signed video URL and a copy of something
 * the server can rebuild. A restored turn therefore shows its text plus a note
 * naming the visual, rather than silently looking like the visual failed.
 */
function turnToMessage(turn) {
    const base = {
        id: turn.id,
        title: turn.content || '',
        question: turn.question || null,
        restored: true,
    };
    if (turn.role === 'user') {
        return { ...base, sender: 'user' };
    }
    const priorVisuals = turn.visual_artifacts || [];
    return {
        ...base,
        sender: 'chatbot',
        respondingMode: (turn.modes && turn.modes[0]) || 'tutor',
        artifacts: [],
        restoredVisuals: priorVisuals,
    };
}

function ChatSection({ onOpenAuth }) {
    const {
        accessToken,
        isAuthenticated,
    } = useAuth();

    // Threads are saved server-side and may span several questions. See
    // ConversationContext; the divider below marks where the question changed.
    const {
        activeId: activeConversationId,
        newChatToken,
        loadedTurns,
        turnsStatus,
        ensureConversationId,
        refresh: refreshConversations,
    } = useConversations();

    // Which thread is currently ON SCREEN. Without this, the sync effect below
    // re-applies the server's turns on every change to loadedTurns -- including
    // the empty list set when a thread is created on the first message, which
    // wiped the message the student had just sent.
    const appliedConversationRef = useRef(undefined);

    const [inputValue, setInputValue] = useState("");

    // Every selector option comes from the published corpus, so an unavailable
    // paper cannot be chosen. It lives in WorkspaceProvider rather than here
    // because the sidebar's topic panel also navigates -- see workspaceContext.
    const { catalogue, notifyAttemptRecorded } = useWorkspace();

    // Single-select by default -- clicking a pill switches to it directly, no
    // need to uncheck the old one first. "Combine modes" is an explicit opt-in
    // for the rarer coordinated turn (e.g. Explain + Visualize together), which
    // still goes through /respond so the backend can coordinate them while
    // rendering each response in its own labelled slot. See toggleMode.
    const [selectedModes, setSelectedModes] = useState(['tutor']);
    const [combineModes, setCombineModes] = useState(false);
    const [question, setQuestion] = useState(null);
    const [questionStatus, setQuestionStatus] = useState('idle'); // idle | loading | ready | error
    const [questionError, setQuestionError] = useState(null);

    const dummyRef = useRef();
    const chatContainerRef = useRef();
    const chatSectionRef = useRef();
    const inputRef = useRef();
    const messageIdRef = useRef(0);
    const nextMessageId = () => `msg-${messageIdRef.current++}`;

    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [openDropdown, setOpenDropdown] = useState(null);

    const reference = catalogue.reference;
    const referenceKey = reference ? JSON.stringify(reference) : null;

    // Load the question as soon as the selection is complete, before the student
    // asks anything. They see what they picked, and a bad reference surfaces
    // immediately rather than at the end of a failed chat request.
    useEffect(() => {
        if (!reference) {
            setQuestion(null);
            setQuestionStatus('idle');
            setQuestionError(null);
            return;
        }
        let cancelled = false;
        setQuestionStatus('loading');
        setQuestionError(null);
        fetchQuestion(reference)
            .then((data) => {
                if (cancelled) return;
                setQuestion(data);
                setQuestionStatus('ready');
            })
            .catch((error) => {
                if (cancelled) return;
                setQuestion(null);
                setQuestionError(error.message);
                setQuestionStatus('error');
            });
        return () => { cancelled = true; };
        // referenceKey rather than reference: the object is rebuilt each render,
        // so comparing by identity would refetch on every keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [referenceKey]);

    // A conversation may now span several questions, so changing question no
    // longer throws the thread away. What used to make that unsafe -- the tutor
    // reading turns about paper A while grounded in paper B -- is handled by
    // tagging every turn with its own question, both in storage and in the
    // prompt (see _history_question_context in prompts.py).
    //
    // Messages come from whichever thread is open. A thread that has not been
    // created yet (the student has not sent anything) shows an empty chat.
    useEffect(() => {
        // Already showing this thread: leave the live messages alone. This is
        // the guard that keeps a turn in flight from being replaced by a stale
        // server copy of the same thread.
        if (appliedConversationRef.current === activeConversationId) return;

        if (!activeConversationId) {
            appliedConversationRef.current = null;
            setMessages([]);
            return;
        }
        // Mid-switch. Clear rather than leave the previous thread's messages
        // sitting under the new thread's name.
        if (turnsStatus === 'loading') {
            setMessages([]);
            return;
        }
        if (turnsStatus === 'ready' && loadedTurns) {
            appliedConversationRef.current = activeConversationId;
            setMessages(loadedTurns.map(turnToMessage));

            // Reopening a thread should put the student back where they were,
            // question and all. Restoring the messages alone leaves them
            // looking at their own conversation with the selectors empty and
            // the input disabled -- the thread is back but unusable.
            const lastWithQuestion = [...loadedTurns].reverse().find((turn) => turn.question);
            if (lastWithQuestion) catalogue.selectReference(lastWithQuestion.question);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeConversationId, loadedTurns, turnsStatus]);

    // "New chat" while already on an unsaved thread changes no id, so the sync
    // effect above sees nothing and the half-typed conversation stays on
    // screen. This is what made the button look like it did nothing.
    useEffect(() => {
        if (newChatToken === 0) return;
        appliedConversationRef.current = null;
        setMessages([]);
        setInputValue('');
        setOpenDropdown(null);
    }, [newChatToken]);

    useEffect(() => {
        const handlePointerDown = (event) => {
            if (chatSectionRef.current && !chatSectionRef.current.contains(event.target)) {
                setOpenDropdown(null);
            }
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setOpenDropdown(null);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    const handleDropdownToggle = (dropdownId) => {
        setOpenDropdown(prev => prev === dropdownId ? null : dropdownId);
    };

    const handleDropdownSelect = (setter) => (selectedValue) => {
        setter(selectedValue);
        setOpenDropdown(null);
    };

    // Jumping to a similar question changes the selectors underneath an open
    // dropdown, so close it. The document-level handler above only closes on
    // clicks OUTSIDE chatSectionRef, and a result card is inside it.
    const handleSimilarNavigate = (ref) => {
        setOpenDropdown(null);
        return catalogue.selectReference(ref);
    };

    const toggleMode = (value) => {
        if (value === 'tutor') {
            setCombineModes(false);
            setSelectedModes(['tutor']);
            setOpenDropdown(null);
            return;
        }
        setSelectedModes((prev) => {
            if (!combineModes) {
                // Single-select: clicking a pill just switches to it.
                return [value];
            }
            const withoutTutor = prev.filter((m) => m !== 'tutor');
            if (withoutTutor.includes(value)) {
                return withoutTutor.length > 1
                    ? withoutTutor.filter((m) => m !== value)
                    : withoutTutor;
            }
            return [...withoutTutor, value];
        });
        if (!combineModes) {
            setOpenDropdown(null);
        }
    };

    const handleCombineToggle = () => {
        setCombineModes((prev) => {
            const next = !prev;
            if (next) {
                setSelectedModes((current) => (
                    current.includes('tutor') ? ['explain', 'visualize'] : current
                ));
                return next;
            }
            if (!next) {
                // Leaving combine mode: collapse back to one active mode so the
                // single-select control isn't left in an ambiguous multi state.
                setSelectedModes((current) => (current.length > 1 ? [current[0]] : current));
            }
            return next;
        });
    };

    // Only used when the request carries no conversation_id -- with one, the
    // server loads history from the database and ignores whatever is sent here.
    const buildHistory = () => messages
        .slice(-MAX_SESSION_MEMORY_MESSAGES)
        .map((message) => ({
            role: message.sender === 'user' ? 'user' : 'assistant',
            content: message.title || '',
            ...(message.question ? { question: message.question } : {}),
            ...(message.sender === 'chatbot' && TUTOR_MODES.some((mode) => mode.value === message.respondingMode)
                ? { modes: [message.respondingMode] }
                : {}),
            ...(message.sender === 'chatbot' && message.artifacts?.length
                ? {
                    visual_artifacts: message.artifacts.map((artifact) => ({
                        artifact_kind: artifact.artifact_kind,
                        title: artifact.title,
                        purpose: artifact.purpose,
                        part_label: artifact.part_label ?? null,
                        manim_template: artifact.manim?.template ?? null,
                    })),
                }
                : {}),
        }));

    const updateSlot = (id, patch) => {
        setMessages((prev) => prev.map((message) => (
            message.id === id ? { ...message, ...patch } : message
        )));
    };

    const replaceSlot = (id, replacements) => {
        setMessages((prev) => prev.flatMap((message) => (
            message.id === id ? replacements : [message]
        )));
    };

    const modeResponseToMessage = (id, modeValue, response, extra = {}) => {
        if (!response) {
            return {
                id,
                title: 'The tutor did not return this mode.',
                sender: 'chatbot',
                respondingMode: modeValue,
                pending: false,
                isError: true,
                ...extra,
            };
        }
        if (response.error) {
            return {
                id,
                title: response.error,
                sender: 'chatbot',
                respondingMode: modeValue,
                pending: false,
                isError: true,
                ...extra,
            };
        }
        return {
            id,
            title: response.message_markdown || response.fallback_markdown || '',
            sender: 'chatbot',
            respondingMode: modeValue,
            artifacts: response.artifacts || [],
            fallbackMarkdown: response.fallback_markdown,
            validationStatus: response.validation_status,
            pending: false,
            ...extra,
        };
    };

    const applyModeResponse = (id, modeValue, response, extra = {}) => {
        updateSlot(id, modeResponseToMessage(id, modeValue, response, extra));
    };

    const errorText = (error) => error instanceof ApiError
        ? error.message
        : 'Could not reach the tutor. Is the API running on ' +
          (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000') + '?';

    const submitPrompt = async (promptText, overrideModes = null) => {
        const currentPrompt = promptText.trim();
        const modesToRun = overrideModes ? [...overrideModes] : [...selectedModes];
        if (!currentPrompt || !reference || questionStatus !== 'ready' || isLoading || modesToRun.length === 0) return;

        if (!isAuthenticated || !accessToken) {
            onOpenAuth('login');
            return;
        }

        const isTutorStrategy = modesToRun.length === 1 && modesToRun[0] === 'tutor';
        const history = buildHistory();

        // The thread row is created on the first message rather than when the
        // student clicks "New Chat", so an opened-and-abandoned chat never
        // clutters their list. A failure here must not block the tutoring, so
        // the turn simply goes unsaved.
        let conversationId = activeConversationId;
        try {
            conversationId = await ensureConversationId();
            // A thread created right here is already what is on screen, so the
            // sync effect must not then "restore" it to the empty list the
            // provider just set.
            appliedConversationRef.current = conversationId;
        } catch {
            conversationId = null;
        }

        setInputValue("");

        const responseSlots = (isTutorStrategy ? ['tutor'] : modesToRun).map((modeValue) => ({
            id: nextMessageId(),
            modeValue,
        }));

        setMessages((prev) => [
            ...prev,
            { id: nextMessageId(), title: currentPrompt, sender: 'user', question: reference },
            ...responseSlots.map(({ id, modeValue }) => ({
                id,
                title: '',
                sender: 'chatbot',
                respondingMode: modeValue,
                question: reference,
                pending: true,
            })),
        ]);
        setIsLoading(true);

        const runMode = async ({ id, modeValue }) => {
            try {
                if (modeValue === 'visualize') {
                    const response = await createVisualization({
                        question: reference,
                        message: currentPrompt,
                        history,
                        conversationId,
                        accessToken,
                    });
                    applyModeResponse(id, modeValue, response);
                    return;
                }

                await streamChat(
                    {
                        question: reference,
                        mode: modeValue,
                        message: currentPrompt,
                        attempt: modeValue === 'check' ? currentPrompt : null,
                        history,
                        conversationId,
                        accessToken,
                    },
                    (accumulated) => {
                        updateSlot(id, { title: accumulated, pending: false });
                        requestAnimationFrame(() => {
                            if (chatContainerRef.current) {
                                chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
                            }
                        });
                    },
                );
            } catch (error) {
                updateSlot(id, {
                    pending: false,
                    isError: true,
                    title: errorText(error),
                });
                if (error instanceof ApiError && error.status === 401) {
                    onOpenAuth('login');
                }
            }
        };

        try {
            if (isTutorStrategy) {
                const response = await createAssistedResponse({
                    question: reference,
                    message: currentPrompt,
                    history,
                    conversationId,
                    accessToken,
                });
                const responses = response.responses || [];
                const replacements = responses.length
                    ? responses.map((item, index) => modeResponseToMessage(
                        index === 0 ? responseSlots[0].id : nextMessageId(),
                        item.mode,
                        item,
                        {
                            routeLabel: index === 0 ? response.route_label : null,
                            suggestedActions: index === responses.length - 1 ? response.suggested_actions || [] : [],
                        },
                    ))
                    : [modeResponseToMessage(responseSlots[0].id, 'tutor', null)];
                replaceSlot(responseSlots[0].id, replacements);
            } else if (modesToRun.length > 1) {
                const response = await createCoordinatedResponse({
                    question: reference,
                    modes: modesToRun,
                    message: currentPrompt,
                    attempt: modesToRun.includes('check') ? currentPrompt : null,
                    history,
                    conversationId,
                    accessToken,
                });
                const responseByMode = new Map((response.responses || []).map((item) => [item.mode, item]));
                responseSlots.forEach(({ id, modeValue }) => {
                    applyModeResponse(id, modeValue, responseByMode.get(modeValue));
                });
            } else {
                await Promise.all(responseSlots.map(runMode));
            }
        } catch (error) {
            responseSlots.forEach(({ id }) => {
                updateSlot(id, {
                    pending: false,
                    isError: true,
                    title: errorText(error),
                });
            });
            if (error instanceof ApiError && error.status === 401) {
                onOpenAuth('login');
            }
        } finally {
            setIsLoading(false);
            // The thread's name, subtitle and position in the list all move
            // with its latest turn.
            if (conversationId) void refreshConversations();
            // A Check turn may have produced a new marking record.
            if (modesToRun.includes('check') || isTutorStrategy) {
                notifyAttemptRecorded();
            }
        }
    };

    const handleSuggestedAction = (action) => {
        const mode = action.mode || 'tutor';
        setCombineModes(false);
        setSelectedModes([mode]);
        if (action.kind === 'send' && action.message) {
            void submitPrompt(action.message, [mode]);
            return;
        }
        setInputValue(action.message || '');
        requestAnimationFrame(() => inputRef.current?.focus());
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        await submitPrompt(inputValue);
    };

    const activeModeSummary = selectedModes.length > 1
        ? selectedModes.map(modeLabel).join(' + ')
        : modeLabel(selectedModes[0] || 'tutor');

    useEffect(() => {
        dummyRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, isLoading]);

    const placeholder = !reference
        ? 'Pick a paper and question to begin…'
        : !isAuthenticated
            ? 'Sign in to ask the tutor...'
        : selectedModes.length === 0
            ? 'Select at least one mode above…'
            : selectedModes.includes('tutor')
                ? 'Tell Shamo where you are stuck…'
            : selectedModes.includes('check')
                ? 'Type or paste your working…'
                : selectedModes.every((m) => m === 'visualize')
                    ? 'Ask what you want to see visually…'
                    : 'Ask anything about this question…';

    return (
        <div className={styles.ChatSection} ref={chatSectionRef}>
            <div className={styles.TopBar}>
                <div className={styles.TopBarContent}>
                    <div className={styles.TopBarPrimary}>
                        <div className={`${styles.ModeDropdown} ${styles.DropdownDown}`}>
                            <button
                                type="button"
                                className={`${styles.ModeSelectBtn} ${openDropdown === 'mode' ? styles.ModeSelectBtnOpen : ''}`}
                                onClick={() => handleDropdownToggle('mode')}
                                aria-haspopup="listbox"
                                aria-expanded={openDropdown === 'mode'}
                                aria-label={`Mode: ${activeModeSummary}`}
                            >
                                <span className={styles.ModeSelectPrefix}>Mode:</span>
                                <span className={styles.ModeSelectValue}>{activeModeSummary}</span>
                            </button>

                            {openDropdown === 'mode' && (
                                <div className={styles.ModeMenuWrapper}>
                                    <div className={styles.ModeMenu} role="listbox" aria-label="Tutor mode">
                                        {MODE_OPTIONS.map((option) => {
                                            const isActive = selectedModes.includes(option.value);
                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    className={`${styles.ModeOption} ${isActive ? styles.ModeOptionActive : ''}`}
                                                    onClick={() => toggleMode(option.value)}
                                                    role="option"
                                                    aria-selected={isActive}
                                                    aria-label={`${option.label}. ${option.blurb}`}
                                                >
                                                    <span className={styles.ModeOptionHeader}>
                                                        {combineModes && option.value !== 'tutor' && (
                                                            <span className={styles.ModeCheckbox} aria-hidden="true">
                                                                {isActive ? '✓' : ''}
                                                            </span>
                                                        )}
                                                        <span>{option.label}</span>
                                                    </span>
                                                    <span className={styles.ModeOptionDescription}>{option.blurb}</span>
                                                </button>
                                            );
                                        })}

                                        <div className={styles.ModeMenuDivider}></div>

                                        <button
                                            type="button"
                                            className={styles.CombineMenuToggle}
                                            aria-pressed={combineModes}
                                            onClick={handleCombineToggle}
                                        >
                                            <span>
                                                <span className={styles.CombineMenuTitle}>Combine modes</span>
                                                <span className={styles.CombineMenuDescription}>
                                                    Run more than one mode together in the same turn.
                                                </span>
                                            </span>
                                            <span className={`${styles.CombineSwitch} ${combineModes ? styles.CombineSwitchOn : ''}`}>
                                                <span className={styles.CombineSwitchThumb}></span>
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className={styles.Chat} ref={chatContainerRef}>
                {catalogue.status === 'error' && (
                    <div className={styles.Notice}>
                        Could not load the paper list. {catalogue.error}
                    </div>
                )}

                <QuestionPanel
                    question={question}
                    isLoading={questionStatus === 'loading'}
                    error={questionError}
                />

                <SimilarQuestions
                    reference={reference}
                    referenceKey={referenceKey}
                    questionStatus={questionStatus}
                    onNavigate={handleSimilarNavigate}
                    onOpenAuth={onOpenAuth}
                />

                {/* Without this, "New chat" empties a thread into an area that
                    still shows the question, the suggestions and the input --
                    a change so quiet it reads as the button not working. */}
                {messages.length === 0 && (
                    <div className={styles.EmptyThread}>
                        <p className={styles.EmptyThreadTitle}>New chat</p>
                        <p className={styles.EmptyThreadHint}>
                            {reference
                                ? 'Pick a mode and ask about the question above. Everything you send is saved, so you can come back to it.'
                                : 'Choose a paper and question below, then ask away.'}
                        </p>
                    </div>
                )}

                {messages.map((msg, index) => (
                    <Fragment key={msg.id}>
                    {/* A thread can move between questions, so mark where it
                        did. Without this a restored conversation reads as one
                        continuous discussion of whatever question happens to be
                        selected now. */}
                    {index > 0 && msg.question && !sameQuestion(msg.question, messages[index - 1].question) && (
                        <div className={styles.QuestionDivider}>
                            <span>{questionHeading(msg.question)}</span>
                        </div>
                    )}
                    <div className={msg.sender === 'user' ? styles.ChatBubble : styles.ResponseBubble}>
                        {msg.sender === 'chatbot' && msg.respondingMode && (
                            <span className={styles.ModeTag}>
                                {modeLabel(msg.respondingMode)}
                            </span>
                        )}
                        {msg.routeLabel && (
                            <span className={styles.RouteTag}>{msg.routeLabel}</span>
                        )}
                        {msg.pending && !msg.title ? (
                            <div className={styles.InlineLoading}>
                                <span className={styles.SpinnerSmall}></span>
                                <span>
                                    {msg.respondingMode === 'tutor'
                                        ? 'Choosing the best help…'
                                        : msg.respondingMode === 'visualize'
                                            ? 'Building the visual…'
                                            : 'Thinking…'}
                                </span>
                            </div>
                        ) : msg.isError ? (
                            <div className={styles.Notice}>{msg.title}</div>
                        ) : (
                            <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                {sanitizeLatex(msg.title)}
                            </ReactMarkdown>
                        )}
                        {msg.artifacts?.map((artifact, artifactIndex) => (
                            <VisualArtifactCard
                                key={`${msg.id}-${artifactIndex}`}
                                artifact={artifact}
                                fallbackMarkdown={msg.fallbackMarkdown}
                            />
                        ))}
                        {/* Only a summary of each visual is stored, never the
                            spec itself -- a stored spec would carry an expired
                            signed video URL. Say what was shown rather than let
                            a restored turn look like the visual broke. */}
                        {msg.restoredVisuals?.length > 0 && (
                            <div className={styles.RestoredVisualNote}>
                                {msg.restoredVisuals.length === 1
                                    ? `This reply included a visual: ${msg.restoredVisuals[0].title}.`
                                    : `This reply included ${msg.restoredVisuals.length} visuals.`}
                                {' '}Ask again to see it.
                            </div>
                        )}
                        {msg.validationStatus === 'render_failed' && !msg.artifacts?.length && msg.fallbackMarkdown && (
                            <div className={styles.VisualFallbackNote}>
                                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                    {sanitizeLatex(msg.fallbackMarkdown)}
                                </ReactMarkdown>
                            </div>
                        )}
                        {msg.suggestedActions?.length > 0 && (
                            <div className={styles.SuggestedActions} aria-label="Suggested next steps">
                                {msg.suggestedActions.map((action, actionIndex) => (
                                    <button
                                        key={`${msg.id}-action-${actionIndex}`}
                                        type="button"
                                        className={styles.SuggestedAction}
                                        onClick={() => handleSuggestedAction(action)}
                                        disabled={isLoading}
                                    >
                                        {action.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    </Fragment>
                ))}

                <div className={styles.Dummy} ref={dummyRef}></div>
            </div>

            <div className={styles.InputContainer}>
                <div className={styles.DropdownRegion}>
                    <div className={styles.DropdownContainer}>
                        <MetadataDropdown
                            id="subject"
                            label="Subject"
                            value={catalogue.subject}
                            options={catalogue.subjectOptions}
                            direction="up"
                            isOpen={openDropdown === 'subject'}
                            onOpen={setOpenDropdown}
                            onClose={() => setOpenDropdown(null)}
                            onToggle={handleDropdownToggle}
                            onSelect={handleDropdownSelect(catalogue.setSubject)}
                        />
                        <MetadataDropdown
                            id="year"
                            label="Year"
                            value={catalogue.year}
                            options={catalogue.yearOptions}
                            direction="up"
                            isOpen={openDropdown === 'year'}
                            onOpen={setOpenDropdown}
                            onClose={() => setOpenDropdown(null)}
                            onToggle={handleDropdownToggle}
                            onSelect={handleDropdownSelect(catalogue.setYear)}
                        />
                        <MetadataDropdown
                            id="session"
                            label="Session"
                            value={catalogue.session}
                            options={catalogue.sessionOptions}
                            direction="up"
                            isOpen={openDropdown === 'session'}
                            onOpen={setOpenDropdown}
                            onClose={() => setOpenDropdown(null)}
                            onToggle={handleDropdownToggle}
                            onSelect={handleDropdownSelect(catalogue.setSession)}
                        />
                        <MetadataDropdown
                            id="variant"
                            label="Variant"
                            value={catalogue.variant}
                            options={catalogue.variantOptions}
                            direction="up"
                            isOpen={openDropdown === 'variant'}
                            onOpen={setOpenDropdown}
                            onClose={() => setOpenDropdown(null)}
                            onToggle={handleDropdownToggle}
                            onSelect={handleDropdownSelect(catalogue.setVariant)}
                        />
                        <MetadataDropdown
                            id="question"
                            label="Question"
                            value={catalogue.questionNum}
                            options={catalogue.questionOptions}
                            direction="up"
                            isOpen={openDropdown === 'question'}
                            onOpen={setOpenDropdown}
                            onClose={() => setOpenDropdown(null)}
                            onToggle={handleDropdownToggle}
                            onSelect={handleDropdownSelect(catalogue.setQuestionNum)}
                        />
                    </div>
                    {catalogue.status === 'ready' && (
                        <span className={styles.CatalogueHint}>
                            {catalogue.paperCount} papers available
                        </span>
                    )}
                </div>

                <form onSubmit={handleSubmit} className={styles.Form}>
                    <input
                        ref={inputRef}
                        type='text'
                        placeholder={placeholder}
                        value={inputValue}
                        disabled={!reference}
                        onChange={(e) => setInputValue(e.target.value)}
                        className={styles.ChatBox}
                    />
                </form>
            </div>
        </div>
    )
}

export default ChatSection
