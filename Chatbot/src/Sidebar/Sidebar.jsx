import styles from './Sidebar.module.css'
import logo from '../assets/ShamoLogo.png'
function Sidebar(){

    const handleRefresh = () => {
        location.reload();
    }

    return(
        <div className = {styles.Body}>

            <div className = {styles.Sidebar}>

                <div className = {styles.BotName}>
                    <img src = {logo} className = {styles.Logo}></img>
                    <p className = {styles.Label}>Shamo AI</p>  
                </div>

                <div className = {styles.SidebarButtonsContainer}>
                    <button className = {styles.SidebarButtons} onClick={handleRefresh}>New Chat</button>
                    <button className = {styles.SidebarButtons}>About Us</button>
                    <button className = {styles.SidebarButtons}>Report an Issue</button>
                    <button className = {styles.SidebarButtons}>Contact Us</button>
                </div>
            </div>
        </div>
        
    )
}

export default Sidebar