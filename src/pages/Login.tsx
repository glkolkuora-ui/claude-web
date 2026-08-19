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

    const unsubOk = window.claudePro.on('broker:connected', () => {
      setIsConnecting(false)
      onLoggedInRef.current()
    })
    const unsubErr = window.claudePro.on('broker:error', (msg: string) => {
      setIsConnecting(false)
      setError(typeof msg === 'string' ? msg : String(msg))
      setStep('idle')
    })

    void window.claudePro.brokerIsConnected().then((res) => {
      if (res.connected) onLoggedInRef.current()
    })

    return () => {
      unsubOk()
      unsubErr()
    }
  }, [t])

  async function handleLogin() {
    setIsConnecting(true)
    setError('')
    setStep('connecting')
    const res = await window.claudePro.brokerStartAuth()
    if (!res.ok || !res.url) {
      setIsConnecting(false)
      setStep('idle')
      setError(res.error ?? t('login.authFailed'))
      return
    }
    const returnOrigin = window.location.origin
    const fallback = new URL('https://claudepro.online/claudeplus/auth/callback/')
    fallback.searchParams.set('web_return', returnOrigin)
    fallback.searchParams.set('auth_url', res.url)
    window.location.assign(fallback.toString())
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
