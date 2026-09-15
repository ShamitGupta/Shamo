import { useState } from 'react'

import Sidebar from "./Sidebar/Sidebar"
import ChatSection from "./ChatSection/ChatSection"
import AuthOverlay from "./Auth/AuthOverlay"

function App() {
  // The auth overlay used to live inside ChatSection, because that is where the
  // Log In / Sign Up buttons were. Those buttons now sit at the bottom of the
  // sidebar, so the overlay is owned here and opened from either side --
  // ChatSection still needs to open it when a signed-out student sends a
  // message or a request comes back 401.
  const [authMode, setAuthMode] = useState(null) // null | 'login' | 'signup'

  return (
    <div className="appShell">
      <Sidebar onOpenAuth={setAuthMode} />
      <ChatSection onOpenAuth={setAuthMode} />
      <AuthOverlay
        isOpen={authMode !== null}
        mode={authMode || 'signup'}
        onClose={() => setAuthMode(null)}
      />
    </div>
  )
}

export default App
