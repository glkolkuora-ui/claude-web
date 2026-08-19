import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import LanguageSwitcher from '../components/LanguageSwitcher'

interface Props { onLoggedIn: () => void }
type Step = 'idle' | 'connecting'

function authQueryError(t: (key: any) => string): string | null {
  const raw = new URLSearchParams(window.location.search).get('auth')
  if (!raw || raw === 'ok') return null
  if (raw === 'denied') return t('login.authDenied')
  if (raw === 'no_verifier') return t('login.authExpired')
  if (raw === 'missing_code') return t('login.authFailed')
  return t('login.authFailed')
}

export default function Login({ onLoggedIn }: Props) {
  const { t } = useI18n()
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)

  const onLoggedInRef = useRef(onLoggedIn)
  onLoggedInRef.current = onLoggedIn

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const auth = params.get('auth')
    if (auth && auth !== 'ok') {
      setError(authQueryError(t) ?? t('login.authFailed'))
      window.history.replaceState({}, '', window.location.pathname)
    }

    const finish = () => {
      try { sessionStorage.removeItem('cw_need_broker_login') } catch { /* ignore */ }
      setIsConnecting(false)
      onLoggedInRef.current()
    }

    const unsubOk = window.claudePro.on('broker:connected', finish)
    const unsubErr = window.claudePro.on('broker:error', (msg: string) => {
      setIsConnecting(false)
      setError(typeof msg === 'string' ? msg : String(msg))
      setStep('idle')
    })

    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return
      if (ev.data?.channel === 'broker:connected') finish()
    }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'cw_broker_auth' && ev.newValue) finish()
    }
    window.addEventListener('message', onMessage)
    window.addEventListener('storage', onStorage)

    const forceAuth = (() => {
      try { return sessionStorage.getItem('cw_need_broker_login') === '1' } catch { return false }
    })()

    void window.claudePro.brokerIsConnected().then((res) => {
      if (res.connected && !forceAuth) finish()
    })

    const poll = window.setInterval(() => {
      if (forceAuth) return
      void window.claudePro.brokerIsConnected().then((res) => {
        if (res.connected) finish()
      })
    }, 1500)

    return () => {
      unsubOk()
      unsubErr()
      window.removeEventListener('message', onMessage)
      window.removeEventListener('storage', onStorage)
      window.clearInterval(poll)
    }
  }, [t])

  async function handleLogin() {
    setIsConnecting(true)
    setError('')
    setStep('connecting')

    const tab = window.open('about:blank', 'cw_broker_auth')
    if (!tab) {
      setIsConnecting(false)
      setStep('idle')
      setError(t('login.popupBlocked'))
      return
    }
    try {
      tab.document.write(
        '<!doctype html><title>Claude Pro</title><body style="margin:0;background:#0d0f14;color:#9196a8;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh">Abrindo autorização...</body>',
      )
      tab.document.close()
    } catch { /* ignore */ }

    try {
      const savedEmail = (() => {
        try { return localStorage.getItem('claudepro_licensed_email') || '' } catch { return '' }
      })()
      if (savedEmail) {
        try { await window.claudePro.setUserEmail(savedEmail) } catch { /* segue */ }
      }
      const res = await window.claudePro.brokerStartAuth()
      if (!res.ok || !res.url) {
        try { tab.close() } catch { /* ignore */ }
        setIsConnecting(false)
        setStep('idle')
        setError(res.error ?? t('login.authFailed'))
        return
      }
      const fallback = new URL('https://claudepro.online/claudeplus/auth/callback/')
      fallback.searchParams.set('web_return', window.location.origin)
      fallback.searchParams.set('auth_url', res.url)
      tab.location.replace(fallback.toString())
      try { tab.focus() } catch { /* ignore */ }
    } catch (err: any) {
      try { tab.close() } catch { /* ignore */ }
      setIsConnecting(false)
      setStep('idle')
      setError(err?.message ?? t('login.authFailed'))
    }
  }

  return (
    <div className="login-page">
      <div className="login-orb" aria-hidden />
      <div className={`login-card glass-elevated${isConnecting ? ' login-card-loading' : ''}`}>
        <div className="login-card-accent" aria-hidden />
        {step === 'connecting' || isConnecting ? (
          <div className="login-loading">
            <div className="loading-spinner" aria-hidden />
            <h2>{t('login.connectingTitle')}</h2>
            <p>{t('login.connectingBody')}</p>
          </div>
        ) : (
        <>
        <div className="login-brand">
          <span className="brand-claude">Claude</span>
          <span className="brand-pro">Pro</span>
        </div>
        <p className="login-tagline">{t('login.tagline')}</p>
        <p className="login-desc">{t('login.desc')}</p>
        {error && <div className="login-error">{error}</div>}
        <button className="btn-broker" onClick={() => void handleLogin()}>
          {t('login.enter')}
        </button>
        </>
        )}
        <div className="login-lang-slot">
          <LanguageSwitcher variant="corner" />
        </div>
      </div>
    </div>
  )
}
