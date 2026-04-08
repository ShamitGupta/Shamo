import styles from './ChatSection.module.css'
import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css'; // Import KaTeX CSS for styling math symbols

function ChatSection(){

    const [inputValue,setInputValue] = useState("");
    const [prompt,setPrompt] = useState("");
    const dummyRef = useRef();

    const [messages,setMessages] = useState([]); //this is to keep a history of all the messages

    const handleSubmit = async (e) => {
        e.preventDefault();
        setInputValue("");
        setMessages(prevMessages => [...prevMessages, { title: prompt, sender: 'user' }]); //using functional assignment to avoid stacking.

        try{
            const formatted_data_response = await fetch("http://127.0.0.1:8000/get_info",{
            method: "POST",
            headers: {
            "Content-Type": "application/json", // Crucial for FastAPI to parse the body
            },
            body: JSON.stringify({user_prompt: prompt})
            });

            if (!formatted_data_response.ok) {
                throw new Error(`Response status: ${formatted_data_response.status}`);
            }

            const formatted_data = await formatted_data_response.json();
            console.log(formatted_data);
            

            //First API response completes here.

            const chatbot_reply_response = await fetch("http://127.0.0.1:8000/get_response",{
                method: "POST",
                headers:{
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({data_formatted: formatted_data.past_paper_data, user_prompt: prompt})
            })

            if (!chatbot_reply_response.ok){
                throw new Error(`Response status for call 2: ${chatbot_reply_response.status}`)
            }


            //THIS IS THE CODE FOR THE STREAMING LOGIC
            setMessages(prev => [...prev, { title: "", sender: 'chatbot' }]);
            const reader = chatbot_reply_response.body.getReader();
            const decoder = new TextDecoder();
            let accumulatedText = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                accumulatedText += chunk;

                // Update the last message (the chatbot placeholder) with current progress
                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { 
                        ...newMessages[newMessages.length - 1], 
                        title: accumulatedText 
                    };
                    return newMessages;
                });
        }

        } catch(error){
            console.error("Error:", error);          
        }
        
    }

    useEffect(() => {
        // console.log(`Prompt is ${prompt}`);
        // console.log(messages);
        // console.log(dummyRef);
        dummyRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [messages]); //log them to the console once messages changes. Don't log inside handleSubmit() because old value will be logged.


    return(

        <div className = {styles.ChatSection}>

            <div className = {styles.Chat}>

                {messages.map((msg,index) => (
                    <div key = {index} className = {msg.sender === 'user'? styles.ChatBubble : styles.ResponseBubble}>
                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {msg.title}
                        </ReactMarkdown>
                    </div>
                ))}

                <div className = {styles.Dummy} ref={dummyRef}></div>
                
            </div>


            
            <form onSubmit={handleSubmit} className = {styles.Form}>
                <input 
                type = 'text' 
                placeholder='Ask anything' 
                value = {inputValue} 
                onChange={(e) => {
                    setInputValue(e.target.value);
                    setPrompt(e.target.value);
                }} 
                className = {styles.ChatBox}>
                </input>
            </form>
            
        </div>
    )
}

export default ChatSection