import styles from './ChatSection.module.css'
import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { getAvailableVariants } from '../utils/variantRules.js';
import MetadataDropdown from './MetadataDropdown';

const MAX_SESSION_MEMORY_MESSAGES = 10;

const formatConversationHistory = (conversationHistory) => {
    if (conversationHistory.length === 0) {
        return "";
    }

    return conversationHistory
        .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
        .join('\n');
};

function ChatSection() {

    const [inputValue, setInputValue] = useState("");
    const [prompt, setPrompt] = useState("");

    // Metadata Dropdown States
    const [subject, setSubject] = useState("IGCSE Additional Mathematics");
    const [year, setYear] = useState("");
    const [session, setSession] = useState("");
    const [variant, setVariant] = useState("");
    const [questionNum, setQuestionNum] = useState("");

    const [paperData, setPaperData] = useState([]);
    const dummyRef = useRef();
    const chatContainerRef = useRef();
    const chatSectionRef = useRef();

    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [openDropdown, setOpenDropdown] = useState(null);

    const subjectOptions = [
        { value: "IGCSE Additional Mathematics", label: "IGCSE Additional Mathematics" },
        { value: "A-level Mathematics", label: "A-level Mathematics" }
    ];

    const yearOptions = [
        { value: "", label: "Year (None)" },
        { value: "2020", label: "2020" },
        { value: "2021", label: "2021" },
        { value: "2022", label: "2022" },
        { value: "2023", label: "2023" },
        { value: "2024", label: "2024" }
    ];

    const sessionOptions = [
        { value: "", label: "Session (None)" },
        { value: "February/March", label: "Feb/March" },
        { value: "May/June", label: "May/June" },
        { value: "October/November", label: "Oct/Nov" }
    ];

    const variantOptions = [
        { value: "", label: "Variant (None)" },
        ...getAvailableVariants(subject, session).map(v => ({ value: v, label: v }))
    ];

    const questionOptions = [
        { value: "", label: "Question (None)" },
        ...[...Array(15)].map((_, i) => ({ value: String(i + 1), label: String(i + 1) }))
    ];

    // Reset variant if it is no longer valid for the selected subject/session
    useEffect(() => {
        const availableVariants = getAvailableVariants(subject, session);
        if (variant && !availableVariants.includes(variant)) {
            setVariant("");
        }
    }, [subject, session, variant]);

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

    const handleSubmit = async (e) => {
        e.preventDefault();

        const currentPrompt = prompt;
        const conversationHistory = messages
            .slice(-MAX_SESSION_MEMORY_MESSAGES)
            .map((message) => ({
                role: message.sender === 'user' ? 'user' : 'assistant',
                content: message.title,
            }));
        const formattedConversationHistory = formatConversationHistory(conversationHistory);
        // console.log(currentPrompt);

        // Construct backend prompt combining metadata
        let metadataString = [];
        if (subject) metadataString.push(subject);
        if (year) metadataString.push(year);
        if (session) metadataString.push(session);
        if (variant) metadataString.push(variant);
        if (questionNum) metadataString.push(questionNum);

        console.log(metadataString);

        let backendPrompt = currentPrompt;
        if (metadataString.length > 0) {
            backendPrompt = metadataString.join(", ") + ". " + currentPrompt;
        }

        console.log(backendPrompt);

        const responsePrompt = formattedConversationHistory
            ? `You are continuing an existing chat session. The previous messages in this current session are below, and you should use them as accessible conversation context.\n\nConversation history:\n${formattedConversationHistory}\n\nLatest user message: ${currentPrompt}`
            : currentPrompt;

        setInputValue("");
        setPrompt(""); // Clear local prompt

        // Show simplified message to user (only what they typed, or metadata search summary)
        setMessages(prevMessages => [...prevMessages, {
            title: currentPrompt || (metadataString.length > 0 ? "Search Past Paper: " + metadataString.join(", ") : ""),
            sender: 'user'
        }]);

        setIsLoading(true);

        try {
            // First API call to get info and extract past paper data based on backendPrompt
            const formatted_data_response = await fetch("https://shamo-production.up.railway.app/get_info", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ user_prompt: backendPrompt, metadata: metadataString })
            });


            if (!formatted_data_response.ok) {
                throw new Error(`Response status: ${formatted_data_response.status}`);
            }

            let formatted_data = await formatted_data_response.json();
            console.log(formatted_data);

            // Keep memory of past paper data if current extract is empty
            if ((formatted_data.past_paper_data[0] === '') && (formatted_data.past_paper_data[1] === '') && (paperData.length !== 0)) {
                formatted_data = paperData;
                console.log("Using cached paper data");
            }

            if ((formatted_data.past_paper_data[0] !== '') && (formatted_data.past_paper_data[1] !== '')) {
                setPaperData(formatted_data);
            }

            // Second API call for chatbot response stream, providing data separately
            const chatbot_reply_response = await fetch("https://shamo-production.up.railway.app/get_response", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    data_formatted: formatted_data.past_paper_data,
                    user_prompt: responsePrompt,
                    conversation_history: conversationHistory
                })
            })

            if (!chatbot_reply_response.ok) {
                throw new Error(`Response status for call 2: ${chatbot_reply_response.status}`)
            }

            setIsLoading(false);

            // Streaming logic
            setMessages(prev => [...prev, { title: "", sender: 'chatbot' }]);
            const reader = chatbot_reply_response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                accumulatedText += chunk;

                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = {
                        ...newMessages[newMessages.length - 1],
                        title: accumulatedText
                    };
                    return newMessages;
                });

                // Jitter-free stream scrolling via RAF setting container scrollTop
                requestAnimationFrame(() => {
                    if (chatContainerRef.current) {
                        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
                    }
                });
            }

        } catch (error) {
            console.error("Error:", error);
            setIsLoading(false);
        }
    }

    // Scroll into view whenever a whole new message is added or loading state changes
    useEffect(() => {
        dummyRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, isLoading]);

    return (
        <div className={styles.ChatSection} ref={chatSectionRef}>
            <div className={styles.TopBar}>
                <div className={styles.DropdownRegion}>
                    <MetadataDropdown
                        id="subject"
                        label="Subject"
                        value={subject}
                        options={subjectOptions}
                        direction="down"
                        isOpen={openDropdown === 'subject'}
                        onOpen={setOpenDropdown}
                        onClose={() => setOpenDropdown(null)}
                        onToggle={handleDropdownToggle}
                        onSelect={handleDropdownSelect(setSubject)}
                    />
                </div>
            </div>

            <div className={styles.Chat} ref={chatContainerRef}>
                {messages.map((msg, index) => (
                    <div key={index} className={msg.sender === 'user' ? styles.ChatBubble : styles.ResponseBubble}>
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {msg.title}
                        </ReactMarkdown>
                    </div>
                ))}

                {isLoading && (
                    <div className={styles.LoadingContainer}>
                        <div className={styles.Spinner}></div>
                        <p className={styles.LoadingText}>Analyzing question...</p>
                    </div>
                )}

                <div className={styles.Dummy} ref={dummyRef}></div>
            </div>

            <div className={styles.InputContainer}>
                <div className={styles.DropdownRegion}>
                    <div className={styles.DropdownContainer}>
                        <MetadataDropdown
                            id="year"
                            label="Year"
                            value={year}
                            options={yearOptions}
                            direction="up"
                            isOpen={openDropdown === 'year'}
                            onOpen={setOpenDropdown}
                            onClose={() => setOpenDropdown(null)}
                            onToggle={handleDropdownToggle}
                            onSelect={handleDropdownSelect(setYear)}
                        />
                        <MetadataDropdown
                            id="session"
                            label="Session"
                            value={session}
                            options={sessionOptions}
                            direction="up"
                            isOpen={openDropdown === 'session'}
                            onOpen={setOpenDropdown}
                            onClose={() => setOpenDropdown(null)}
                            onToggle={handleDropdownToggle}
                            onSelect={handleDropdownSelect(setSession)}
                        />
                        <MetadataDropdown
                            id="variant"
                            label="Variant"
                            value={variant}
                            options={variantOptions}
                            direction="up"
                            isOpen={openDropdown === 'variant'}
                            onOpen={setOpenDropdown}
                            onClose={() => setOpenDropdown(null)}
                            onToggle={handleDropdownToggle}
                            onSelect={handleDropdownSelect(setVariant)}
                        />
                        <MetadataDropdown
                            id="question"
                            label="Question"
                            value={questionNum}
                            options={questionOptions}
                            direction="up"
                            isOpen={openDropdown === 'question'}
                            onOpen={setOpenDropdown}
                            onClose={() => setOpenDropdown(null)}
                            onToggle={handleDropdownToggle}
                            onSelect={handleDropdownSelect(setQuestionNum)}
                        />
                    </div>
                </div>

                <form onSubmit={handleSubmit} className={styles.Form}>
                    <input
                        type='text'
                        placeholder='Ask anything...'
                        value={inputValue}
                        onChange={(e) => {
                            setInputValue(e.target.value);
                            setPrompt(e.target.value);
                        }}
                        className={styles.ChatBox}
                    />
                </form>
            </div>
        </div>
    )
}

export default ChatSection
