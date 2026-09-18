import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ROUTER_BASENAME } from './appBase.js'
import { AuthProvider } from './Auth/AuthContext.jsx'
import { ConversationProvider } from './Conversations/ConversationContext.jsx'
import { WorkspaceProvider } from './Workspace/WorkspaceProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Without a basename the routes below are absolute, so serving the app
        from /chatbot matches nothing and the catch-all redirect sends the
        visitor to the domain root -- out of the app entirely. */}
    <BrowserRouter basename={ROUTER_BASENAME}>
      <AuthProvider>
        <ConversationProvider>
          <WorkspaceProvider>
            <App />
          </WorkspaceProvider>
        </ConversationProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
