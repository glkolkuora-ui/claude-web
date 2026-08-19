import { useEffect, useLayoutEffect, useState } from 'react'
import Login from './pages/Login'
import MainApp from './pages/MainApp'
import LoginSupabase from './pages/LoginSupabase'
import LicenseGate from './pages/LicenseGate'
import { FEATURE_FLAGS } from './feature-flags'
import { supabase } from './lib/supabase-client'
import InstallPrompt from './components/InstallPrompt'
import './index.css'

interface SupaUser { id: string; email: string }

export default function App() {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.remove('electron-frame', 'electron-darwin', 'electron-win32')
    const plat = typeof window !== 'undefined' ? window.claudePro?.appPlatform : undefined
    if (plat !== 'darwin' && plat !== 'win32') return
    root.classList.add('electron-frame')
    if (plat === 'darwin') root.classList.add('electron-darwin')
    else if (plat === 'win32') root.classList.add('electron-win32')
  }, [])

  // Gate de licença Misespay (vem ANTES de tudo)
  const [licensedEmail, setLicensedEmail] = useState<string | null>(null)
  // Login Broker10 (fluxo atual — sempre ativo)
  const [loggedIn, setLoggedIn] = useState(false)
  // Login Supabase (futuro — só usado se LOGIN_REQUIRED=true)
  const [supaUser, setSupaUser]   = useState<SupaUser | null>(null)
  const [supaReady, setSupaReady] = useState(!FEATURE_FLAGS.LOGIN_REQUIRED)

  // Quando LOGIN_REQUIRED=true, verifica sessão Supabase persistida no boot
  useEffect(() => {
    if (!FEATURE_FLAGS.LOGIN_REQUIRED) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      const user = data.session?.user
      if (!cancelled) {
        if (user) setSupaUser({ id: user.id, email: user.email ?? '' })
        setSupaReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const shell = FEATURE_FLAGS.LICENSE_REQUIRED && !licensedEmail
    ? <LicenseGate onAuthorized={setLicensedEmail} />
    : FEATURE_FLAGS.LOGIN_REQUIRED && !supaReady
      ? null
      : FEATURE_FLAGS.LOGIN_REQUIRED && !supaUser
        ? <LoginSupabase onLogin={setSupaUser} />
        : loggedIn
          ? <MainApp onLogout={() => setLoggedIn(false)} />
          : <Login onLoggedIn={() => setLoggedIn(true)} />

  if (FEATURE_FLAGS.LOGIN_REQUIRED && !supaReady && licensedEmail) return null

  return (
    <div className="app-root">
      {shell}
      <InstallPrompt />
    </div>
  )
}
