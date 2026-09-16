import styles from './Sidebar.module.css'
import logo from '../assets/ShamoLogo.png'
import { useEffect, useState } from 'react'

import AuthActions from '../Auth/AuthActions'
import ConversationList from '../Conversations/ConversationList'
import WeakTopics from '../ChatSection/WeakTopics'
import { useConversations } from '../Conversations/conversationContext.js'
import { useAuth } from '../Auth/authContext.js'
import { useWorkspace } from '../Workspace/workspaceContext.js'

function Sidebar({ onOpenAuth }){
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Log In / Sign Up moved here from the chat top bar, so the account lives
    // at the bottom of the sidebar rather than in the corner above the
    // conversation. The overlay itself is owned by App.
    const { user, profile, tier, actionStatus, signOut } = useAuth();
    const { startNewConversation } = useConversations();
    // The topic panel hands the student a question to practise, and clicking
    // one has to move the selection the chat is grounded in. That selection
    // lives in WorkspaceProvider precisely so both sides can reach it.
    const { catalogue, progressToken } = useWorkspace();

    const handlePractiseNavigate = (reference) => {
        const moved = catalogue.selectReference(reference);
        if (moved) handleMenuClose();
        return moved;
    };

    // Was location.reload(), back when a conversation only existed in memory and
    // throwing the page away was the only way to clear it. Threads are saved
    // now, so this starts a fresh one and leaves the previous conversation in
    // the list rather than destroying it.
    const handleNewChat = () => {
        startNewConversation();
        handleMenuClose();
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

                {/* New Chat is the one button here a student presses often, so
                    it is the only one that looks like a button. The rest are
                    small links -- they were taking a third of the sidebar from
                    the thread list, which is the part that grows. */}
                <button type="button" className={styles.NewChatButton} onClick={handleNewChat}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                        <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                    New chat
                </button>

                <div className = {styles.SidebarButtonsContainer}>
                    <button className = {styles.SidebarButtons} onClick={handleMenuClose}>About Us</button>
                    <button className = {styles.SidebarButtons} onClick={handleMenuClose}>Report an Issue</button>
                    <button className = {styles.SidebarButtons} onClick={handleMenuClose}>Contact Us</button>
                </div>

                {user && <ConversationList onNavigate={handleMenuClose} />}

                {/* Always on screen, never behind a scroll to the bottom of a
                    conversation. What a student is weakest at is the thing that
                    should be visible while they choose what to do next. */}
                {user && (
                    <div className={styles.TopicsRegion}>
                        <WeakTopics
                            refreshToken={progressToken}
                            onNavigate={handlePractiseNavigate}
                            variant="sidebar"
                        />
                    </div>
                )}

                <div className={styles.SidebarFooter}>
                    <AuthActions
                        user={user}
                        profile={profile}
                        tier={tier}
                        isLoading={actionStatus === 'loading'}
                        onOpenSignUp={() => { handleMenuClose(); onOpenAuth('signup'); }}
                        onOpenLogIn={() => { handleMenuClose(); onOpenAuth('login'); }}
                        onSignOut={signOut}
                    />
                </div>
            </div>
        </>

    )
}

export default Sidebar
