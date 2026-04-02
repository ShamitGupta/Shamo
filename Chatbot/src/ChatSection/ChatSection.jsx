import styles from './ChatSection.module.css'
import { useState, useEffect, useRef } from 'react'

function ChatSection(){

    const [inputValue,setInputValue] = useState("");
    const [prompt,setPrompt] = useState("");
    const dummyRef = useRef();

    const [messages,setMessages] = useState([]); //this is to keep a history of all the messages

    const handleSubmit = (e) => {
        e.preventDefault();
        setInputValue("");
        setMessages([...messages,{title: prompt, sender: 'user'}]); //updates the history of messages

    }

    useEffect(() => {
        console.log(`Prompt is ${prompt}`);
        console.log(messages);
        console.log(dummyRef);
        dummyRef.current?.scrollIntoView();
    }, [messages]); //log them to the console once messages changes. Don't log inside handleSubmit() because old value will be logged.


    return(

        <div className = {styles.ChatSection}>

            <div className = {styles.Chat}>

                {messages.map((msg,index) => (
                    <p key = {index} className = {styles.ChatBubble}>{msg.title}</p>
                ))}
                
            </div>

            <div className = {styles.Dummy} ref = {dummyRef}></div>

            
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