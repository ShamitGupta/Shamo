import styles from './ChatSection.module.css'
import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { sanitizeLatex } from '../utils/sanitizeLatex.js';
import { fetchQuestion, streamChat, TUTOR_MODES, ApiError } from '../api/tutorApi.js';
import { usePaperCatalogue } from './usePaperCatalogue.js';
import MetadataDropdown from './MetadataDropdown';
import QuestionPanel from './QuestionPanel';
import AuthActions from '../Auth/AuthActions';
import AuthOverlay from '../Auth/AuthOverlay';

const MAX_SESSION_MEMORY_MESSAGES = 10;

function ChatSection() {

    const [inputValue, setInputValue] = useState("");

    // Every selector option comes from the published corpus, so an unavailable
    // paper cannot be chosen. See usePaperCatalogue.
    const catalogue = usePaperCatalogue();

    const [mode, setMode] = useState('explain');
    const [question, setQuestion] = useState(null);
    const [questionStatus, setQuestionStatus] = useState('idle'); // idle | loading | ready | error
    const [questionError, setQuestionError] = useState(null);

    const dummyRef = useRef();
    const chatContainerRef = useRef();
    const chatSectionRef = useRef();

    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [chatError, setChatError] = useState(null);
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
        setChatError(null);
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

    const canSend = Boolean(reference) && questionStatus === 'ready' && !isLoading;

    const handleSubmit = async (e) => {
        e.preventDefault();

        const currentPrompt = inputValue.trim();
        if (!currentPrompt || !canSend) return;

        const history = messages
            .slice(-MAX_SESSION_MEMORY_MESSAGES)
            .map((message) => ({
                role: message.sender === 'user' ? 'user' : 'assistant',
                content: message.title,
            }));

        setInputValue("");
        setChatError(null);
        setMessages(prev => [...prev, { title: currentPrompt, sender: 'user' }]);
        setIsLoading(true);

        try {
            // Only a reference to the question travels. The server retrieves the
            // content itself, so the browser cannot put words in the tutor's
            // source material.
            let started = false;
            await streamChat(
                {
                    question: reference,
                    mode,
                    message: currentPrompt,
                    // In Check mode the student's working IS the message; the
                    // API keeps them separate so the prompt can label it.
                    attempt: mode === 'check' ? currentPrompt : null,
                    history,
                },
                (accumulated) => {
                    if (!started) {
                        started = true;
                        setIsLoading(false);
                        setMessages(prev => [...prev, { title: "", sender: 'chatbot' }]);
                    }
                    setMessages(prev => {
                        const next = [...prev];
                        next[next.length - 1] = { ...next[next.length - 1], title: accumulated };
                        return next;
                    });
                    requestAnimationFrame(() => {
                        if (chatContainerRef.current) {
                            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
                        }
                    });
                },
            );
        } catch (error) {
            // Shown to the student, not just logged. A 404 here carries the
            // server's explanation of what is published instead.
            setChatError(
                error instanceof ApiError
                    ? error.message
                    : 'Could not reach the tutor. Is the API running on ' +
                      (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000') + '?',
            );
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        dummyRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, isLoading]);

    const placeholder = !reference
        ? 'Pick a paper and question to begin…'
        : mode === 'check'
            ? 'Type or paste your working…'
            : 'Ask anything about this question…';

    return (
        <div className={styles.ChatSection} ref={chatSectionRef}>
            <div className={styles.TopBar}>
                <div className={styles.TopBarContent}>
                    <div className={styles.TopBarPrimary}>
                        <div className={styles.ModeGroup} role="group" aria-label="Tutor mode">
                            {TUTOR_MODES.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    title={option.blurb}
                                    aria-pressed={mode === option.value}
                                    className={`${styles.ModeButton} ${mode === option.value ? styles.ModeButtonActive : ''}`}
                                    onClick={() => setMode(option.value)}
                                >
                                    {option.label}
                                </button>
                            ))}
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

                {messages.map((msg, index) => (
                    <div key={index} className={msg.sender === 'user' ? styles.ChatBubble : styles.ResponseBubble}>
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {sanitizeLatex(msg.title)}
                        </ReactMarkdown>
                    </div>
                ))}

                {isLoading && (
                    <div className={styles.LoadingContainer}>
                        <div className={styles.Spinner}></div>
                        <p className={styles.LoadingText}>Reading the mark scheme…</p>
                    </div>
                )}

                {chatError && <div className={styles.Notice}>{chatError}</div>}

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
