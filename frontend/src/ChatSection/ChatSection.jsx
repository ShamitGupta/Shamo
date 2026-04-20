import styles from './ChatSection.module.css'
import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

function ChatSection() {

    const [inputValue, setInputValue] = useState("");
    const [prompt, setPrompt] = useState("");

    // Metadata Dropdown States
    const [year, setYear] = useState("");
    const [session, setSession] = useState("");
    const [variant, setVariant] = useState("");
    const [questionNum, setQuestionNum] = useState("");

    const [paperData, setPaperData] = useState([]);
    const dummyRef = useRef();
    const chatContainerRef = useRef();

    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();

        const currentPrompt = prompt;
        // console.log(currentPrompt);

        // Construct backend prompt combining metadata
        let metadataString = [];
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
                body: JSON.stringify({ user_prompt: currentPrompt, metadata: metadataString })
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
                    user_prompt: currentPrompt // Provide clean user prompt string as requested
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
        <div className={styles.ChatSection}>
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
                <div className={styles.DropdownContainer}>
                    <select className={styles.SelectBtn} value={year} onChange={(e) => setYear(e.target.value)}>
                        <option value="">Year (None)</option>
                        <option value="2020">2020</option>
                        <option value="2021">2021</option>
                        <option value="2022">2022</option>
                        <option value="2023">2023</option>
                        <option value="2024">2024</option>
                    </select>
                    <select className={styles.SelectBtn} value={session} onChange={(e) => setSession(e.target.value)}>
                        <option value="">Session (None)</option>
                        <option value="Feb/March">February/March</option>
                        <option value="May/June">May/June</option>
                        <option value="Oct/Nov">October/November</option>
                    </select>
                    <select className={styles.SelectBtn} value={variant} onChange={(e) => setVariant(e.target.value)}>
                        <option value="">Variant (None)</option>
                        <option value="11">11</option>
                        <option value="12">12</option>
                        <option value="13">13</option>
                        <option value="21">21</option>
                        <option value="22">22</option>
                        <option value="23">23</option>
                    </select>
                    <select className={styles.SelectBtn} value={questionNum} onChange={(e) => setQuestionNum(e.target.value)}>
                        <option value="">Question (None)</option>
                        {[...Array(15)].map((_, i) => (
                            <option key={i + 1} value={i + 1}>{i + 1}</option>
                        ))}
                    </select>
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