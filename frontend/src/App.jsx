import { useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import Sidebar from "./Sidebar/Sidebar"
import ChatSection from "./ChatSection/ChatSection"
import AuthOverlay from "./Auth/AuthOverlay"
import StudentDetail from "./Teacher/StudentDetail"
import TeacherDashboard from "./Teacher/TeacherDashboard"
import TeacherSignUp from "./Teacher/TeacherSignUp"
import { useAuth } from "./Auth/authContext.js"

function StudentApp({ onOpenAuth }) {
  return (
    <div className="appShell">
      <Sidebar onOpenAuth={onOpenAuth} />
      <ChatSection onOpenAuth={onOpenAuth} />
    </div>
  )
}

function App() {
  // The auth overlay used to live inside ChatSection, because that is where the
  // Log In / Sign Up buttons were. Those buttons now sit at the bottom of the
  // sidebar, so the overlay is owned here and opened from either side --
  // ChatSection still needs to open it when a signed-out student sends a
  // message or a request comes back 401.
  const [authMode, setAuthMode] = useState(null) // null | 'login' | 'signup'

  const { isStaff, isReady } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // A teacher signing in expects their dashboard, not the tutor. But this must
  // fire ONCE PER TAB, not once per mount -- a teacher who opens the tutor to
  // see what they are setting and then reloads the page would otherwise be
  // thrown straight back out of it, because a reload is a fresh mount and the
  // role resolves to staff all over again. sessionStorage remembers the
  // difference between "just arrived" and "chose to be here"; it is per tab and
  // dies with it, which is exactly the lifetime wanted.
  const redirected = useRef(false)

  useEffect(() => {
    if (!isReady || !isStaff || redirected.current) return
    redirected.current = true
    let alreadySent = false
    try {
      alreadySent = sessionStorage.getItem('shamo.staffLanded') === '1'
      sessionStorage.setItem('shamo.staffLanded', '1')
    } catch {
      // Private mode or blocked storage. Falling through means the teacher
      // lands on the dashboard, which is the better failure of the two.
    }
    if (!alreadySent && location.pathname === '/') navigate('/dashboard', { replace: true })
  }, [isReady, isStaff, location.pathname, navigate])

  // Someone who started a Google sign-in FROM the teacher page should finish it
  // there. The OAuth redirect normally returns to /teacher directly, but a
  // Supabase project whose redirect allow-list holds only the bare origin will
  // refuse the deeper URL and drop the browser on the site root -- where they
  // would be looking at the tutor wondering what happened to the invite code
  // step. The flag is set just before leaving for Google and cleared here.
  useEffect(() => {
    if (!isReady || location.pathname !== '/') return
    let wanted = false
    try {
      wanted = sessionStorage.getItem('shamo.teacherIntent') === '1'
      if (wanted) sessionStorage.removeItem('shamo.teacherIntent')
    } catch {
      // Blocked storage; the direct redirect is the only route in that case.
    }
    if (wanted && !isStaff) navigate('/teacher', { replace: true })
  }, [isReady, isStaff, location.pathname, navigate])

  return (
    <>
      <Routes>
        <Route path="/" element={<StudentApp onOpenAuth={setAuthMode} />} />
        <Route path="/teacher" element={<TeacherSignUp />} />
        <Route path="/dashboard" element={<TeacherDashboard />} />
        <Route path="/dashboard/students/:userId" element={<StudentDetail />} />
        {/* An unknown path is a typo, not an error worth a page of its own. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <AuthOverlay
        isOpen={authMode !== null}
        mode={authMode || 'signup'}
        onClose={() => setAuthMode(null)}
      />
    </>
  )
}

export default App
