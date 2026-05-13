import styles from './Sidebar.module.css'
import logo from '../assets/ShamoLogo.png'
import { useEffect, useState } from 'react'

function Sidebar(){
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const handleRefresh = () => {
        location.reload();
    }

    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth > 960) {
                setIsMenuOpen(false);
            }
        };

        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setIsMenuOpen(false);
            }
        };

        window.addEventListener('resize', handleResize);
        window.addEventListener('keydown', handleEscape);

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', handleEscape);
        };
    }, []);

    const handleMenuToggle = () => {
        setIsMenuOpen(prev => !prev);
    };

    const handleMenuClose = () => {
        setIsMenuOpen(false);
    };

    return(
        <>
            <div className={styles.MobileBar}>
                <div className={styles.MobileBrand}>
                    <img src={logo} className={styles.Logo} alt="Shamo AI logo" />
                    <p className={styles.Label}>Shamo AI</p>
                </div>

                <button
                    type="button"
                    className={styles.MobileMenuButton}
                    onClick={handleMenuToggle}
                    aria-expanded={isMenuOpen}
                    aria-controls="sidebar-navigation"
                    aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                >
                    <span></span>
                    <span></span>
                    <span></span>
                </button>
            </div>

            {isMenuOpen && (
                <button
                    type="button"
                    className={styles.MobileOverlay}
                    onClick={handleMenuClose}
                    aria-label="Close navigation menu"
                />
            )}

            <div
                id="sidebar-navigation"
                className={`${styles.Sidebar} ${isMenuOpen ? styles.SidebarOpen : ''}`}
            >
                <div className = {styles.BotName}>
                    <img src={logo} className={styles.Logo} alt="Shamo AI logo" />
                    <p className = {styles.Label}>Shamo AI</p>
                </div>

                <div className = {styles.SidebarButtonsContainer}>
                    <button className = {styles.SidebarButtons} onClick={handleRefresh}>New Chat</button>
                    <button className = {styles.SidebarButtons} onClick={handleMenuClose}>About Us</button>
                    <button className = {styles.SidebarButtons} onClick={handleMenuClose}>Report an Issue</button>
                    <button className = {styles.SidebarButtons} onClick={handleMenuClose}>Contact Us</button>
                </div>
            </div>
        </>
        
    )
}

export default Sidebar
