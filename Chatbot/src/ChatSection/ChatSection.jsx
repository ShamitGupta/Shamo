import styles from './ChatSection.module.css'

function ChatSection(){
    return(
        <div className = {styles.Body}>
            <div className = {styles.ChatSection}>
                <input type = 'text' placeholder='Ask anything' className = {styles.ChatBox}></input>
            </div>
        </div>
    )
}

export default ChatSection