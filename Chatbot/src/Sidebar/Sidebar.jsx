import styles from './Sidebar.module.css'
function Sidebar(){
    return(
        <div className = {styles.Body}>
            <div className = {styles.Sidebar}>
                <div className = {styles.SidebarButtonsContainer}>
                    <button className = {styles.SidebarButtons}>New Chat</button>
                    <button className = {styles.SidebarButtons}>About Us</button>
                    <button className = {styles.SidebarButtons}>Report an Issue</button>
                    <button className = {styles.SidebarButtons}>Contact Us</button>
                </div>
            </div>

            <div className = {styles.ChatSection}>
            
            </div>
        </div>
        
    )
}

export default Sidebar