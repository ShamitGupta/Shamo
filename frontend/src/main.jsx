import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './Auth/AuthContext.jsx'
import { ConversationProvider } from './Conversations/ConversationContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <ConversationProvider>
        <App />
      </ConversationProvider>
    </AuthProvider>
  </StrictMode>,
)
