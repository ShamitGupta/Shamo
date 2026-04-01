import styles from './ChatSection.module.css'
import { useState, useEffect } from 'react'

function ChatSection(){

    const [inputValue,setInputValue] = useState("");
    const [prompt,setPrompt] = useState("");

    const [messages,setMessages] = useState([]); //this is to keep a history of all the messages

    const handleSubmit = (e) => {
        e.preventDefault();
        setInputValue("");
        setMessages([...messages,{title: prompt, sender: 'user'}]); //updates the history of messages
    }

    useEffect(() => {
        console.log(`Prompt is ${prompt}`);
        console.log(messages);
    }, [messages]); //log them to the console once messages changes. Don't log inside handleSubmit() because old value will be logged.


    return(
        <div className = {styles.Body}>
            <div className = {styles.ChatSection}>
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
        </div>
    )
}

export default ChatSection