import styles from './ChatSection.module.css'
import { useState } from 'react'

function ChatSection(){

    const [inputValue,setInputValue] = useState("");
    const [prompt,setPrompt] = useState("");

    const handleSubmit = (e) => {
        e.preventDefault();
        setInputValue("");
        console.log(`Prompt is ${prompt}`);
    }

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