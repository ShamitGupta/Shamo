import styles from './ChatSection.module.css'
import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { sanitizeLatex } from '../utils/sanitizeLatex.js';
import { createCoordinatedResponse, createVisualization, fetchQuestion, streamChat, TUTOR_MODES, ApiError } from '../api/tutorApi.js';
import { usePaperCatalogue } from './usePaperCatalogue.js';
import MetadataDropdown from './MetadataDropdown';
import QuestionPanel from './QuestionPanel';
import VisualArtifactCard from './VisualArtifactCard';
import AuthActions from '../Auth/AuthActions';
import AuthOverlay from '../Auth/AuthOverlay';

const MAX_SESSION_MEMORY_MESSAGES = 10;

function ChatSection() {

    const [inputValue, setInputValue] = useState("");

    // Every selector option comes from the published corpus, so an unavailable
    // paper cannot be chosen. See usePaperCatalogue.
    const catalogue = usePaperCatalogue();

    // Multiple modes can be active at once -- see toggleMode. Multi-mode turns
    // now go through /respond so the backend can coordinate the selected modes
    // while still rendering each response in its own labelled slot.
    const [selectedModes, setSelectedModes] = useState(['explain']);
    const [question, setQuestion] = useState(null);
    const [questionStatus, setQuestionStatus] = useState('idle'); // idle | loading | ready | error
    const [questionError, setQuestionError] = useState(null);

    const dummyRef = useRef();
    const chatContainerRef = useRef();
    const chatSectionRef = useRef();
    const messageIdRef = useRef(0);
    const nextMessageId = () => `msg-${messageIdRef.current++}`;

    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [openDropdown, setOpenDropdown] = useState(null);
    const [isAuthOverlayOpen, setIsAuthOverlayOpen] = useState(false);
    const [authMode, setAuthMode] = useState('signup');

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

    // A new question is a new conversation. Carrying history across questions
    // would let the tutor answer about paper A while grounded in paper B.
    useEffect(() => {
        setMessages([]);
    }, [referenceKey]);

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

    const handleOpenAuth = (mode) => {
        setAuthMode(mode);
        setIsAuthOverlayOpen(true);
    };

    const handleCloseAuth = () => {
        setIsAuthOverlayOpen(false);
    };

    const toggleMode = (value) => {
        setSelectedModes((prev) => (
            prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value]
        ));
    };

    const canSend = Boolean(reference) && questionStatus === 'ready' && !isLoading && selectedModes.length > 0;

    const handleSubmit = async (e) => {
        e.preventDefault();

        const currentPrompt = inputValue.trim();
        if (!currentPrompt || !canSend) return;

        // Snapshot the selection for this turn -- toggling modes mid-flight
        // should not retroactively change a request that already went out.
        const modesToRun = [...selectedModes];

        const history = messages
            .slice(-MAX_SESSION_MEMORY_MESSAGES)
            .map((message) => ({
                role: message.sender === 'user' ? 'user' : 'assistant',
                content: message.title || '',
            }));

        setInputValue("");

        // One response slot per selected mode, created up front so their order
        // on screen matches selection order regardless of which one resolves
        // first. Each slot is updated in place by id, not by array position, so
        // concurrent streaming/visualize calls can't race on "the last message".
        const responseSlots = modesToRun.map((modeValue) => ({
            id: nextMessageId(),
            modeValue,
        }));

        setMessages((prev) => [
            ...prev,
            { id: nextMessageId(), title: currentPrompt, sender: 'user' },
            ...responseSlots.map(({ id, modeValue }) => ({
                id,
                title: '',
                sender: 'chatbot',
                respondingMode: modeValue,
                pending: true,
            })),
        ]);
        setIsLoading(true);

        const updateSlot = (id, patch) => {
            setMessages((prev) => prev.map((message) => (
                message.id === id ? { ...message, ...patch } : message
            )));
        };

        const applyModeResponse = (id, response) => {
            if (!response) {
                updateSlot(id, {
                    pending: false,
                    isError: true,
                    title: 'The tutor did not return this mode.',
                });
                return;
            }
            if (response.error) {
                updateSlot(id, {
                    pending: false,
                    isError: true,
                    title: response.error,
                });
                return;
            }
            updateSlot(id, {
                title: response.message_markdown || response.fallback_markdown || '',
                artifacts: response.artifacts || [],
                fallbackMarkdown: response.fallback_markdown,
                validationStatus: response.validation_status,
                pending: false,
            });
        };

        // Single-mode text turns keep the streaming path. Multi-mode turns go
        // through /respond so the backend can coordinate selected modes instead
        // of letting, for example, Explain deny an animation that Visualize is
        // rendering in the same turn.
        const runMode = async ({ id, modeValue }) => {
            try {
                // Only a reference to the question travels. The server retrieves
                // the content itself, so the browser cannot put words in the
                // tutor's source material.
                if (modeValue === 'visualize') {
                    const response = await createVisualization({
                        question: reference,
                        message: currentPrompt,
                        history,
                    });
                    updateSlot(id, {
                        title: response.message_markdown || response.fallback_markdown,
                        artifacts: response.artifacts || [],
                        fallbackMarkdown: response.fallback_markdown,
                        validationStatus: response.validation_status,
                        pending: false,
                    });
                    return;
                }

                await streamChat(
                    {
                        question: reference,
                        mode: modeValue,
                        message: currentPrompt,
                        // In Check mode the student's working IS the message; the
                        // API keeps them separate so the prompt can label it.
                        attempt: modeValue === 'check' ? currentPrompt : null,
                        history,
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
                // Shown inline on this mode's own slot, not a shared banner --
                // one mode failing (e.g. Visualize) should not hide another
                // mode's successful answer (e.g. Hint) from the same turn.
                updateSlot(id, {
                    pending: false,
                    isError: true,
                    title: error instanceof ApiError
                        ? error.message
                        : 'Could not reach the tutor. Is the API running on ' +
                          (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000') + '?',
                });
            }
        };

        try {
            if (modesToRun.length > 1) {
                const response = await createCoordinatedResponse({
                    question: reference,
                    modes: modesToRun,
                    message: currentPrompt,
                    attempt: modesToRun.includes('check') ? currentPrompt : null,
                    history,
                });
                const responseByMode = new Map((response.responses || []).map((item) => [item.mode, item]));
                responseSlots.forEach(({ id, modeValue }) => {
                    applyModeResponse(id, responseByMode.get(modeValue));
                });
            } else {
                await Promise.all(responseSlots.map(runMode));
            }
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        dummyRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, isLoading]);

    const placeholder = !reference
        ? 'Pick a paper and question to begin…'
        : selectedModes.length === 0
            ? 'Select at least one mode above…'
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
                        <div className={styles.ModeGroup} role="group" aria-label="Tutor modes -- select one or more">
                            {TUTOR_MODES.map((option) => {
                                const isActive = selectedModes.includes(option.value);
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        title={option.blurb}
                                        aria-pressed={isActive}
                                        className={`${styles.ModeButton} ${isActive ? styles.ModeButtonActive : ''}`}
                                        onClick={() => toggleMode(option.value)}
                                    >
                                        <span className={styles.ModeCheckbox} aria-hidden="true">✓</span>
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className={styles.TopBarActions}>
                        <AuthActions
                            onOpenSignUp={() => handleOpenAuth('signup')}
                            onOpenLogIn={() => handleOpenAuth('login')}
                        />
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

                {messages.map((msg) => (
                    <div key={msg.id} className={msg.sender === 'user' ? styles.ChatBubble : styles.ResponseBubble}>
                        {msg.sender === 'chatbot' && msg.respondingMode && (
                            <span className={styles.ModeTag}>
                                {TUTOR_MODES.find((m) => m.value === msg.respondingMode)?.label || msg.respondingMode}
                            </span>
                        )}
                        {msg.pending && !msg.title ? (
                            <div className={styles.InlineLoading}>
                                <span className={styles.SpinnerSmall}></span>
                                <span>{msg.respondingMode === 'visualize' ? 'Building the visual…' : 'Thinking…'}</span>
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
                        {msg.validationStatus === 'render_failed' && !msg.artifacts?.length && msg.fallbackMarkdown && (
                            <div className={styles.VisualFallbackNote}>
                                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                    {sanitizeLatex(msg.fallbackMarkdown)}
                                </ReactMarkdown>
                            </div>
                        )}
                    </div>
                ))}

                <div className={styles.Dummy} ref={dummyRef}></div>
            </div>

            <div className={styles.InputContainer}>
                <div className={styles.DropdownRegion}>
                    <div className={styles.DropdownContainer}>
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
                        type='text'
                        placeholder={placeholder}
                        value={inputValue}
                        disabled={!reference}
                        onChange={(e) => setInputValue(e.target.value)}
                        className={styles.ChatBox}
                    />
                </form>
            </div>

            <AuthOverlay
                isOpen={isAuthOverlayOpen}
                mode={authMode}
                onClose={handleCloseAuth}
            />
        </div>
    )
}

export default ChatSection
