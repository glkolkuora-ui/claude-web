import { useState, useEffect, useRef } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import LanguageSwitcher from '../components/LanguageSwitcher'

interface Props { onLoggedIn: () => void }
type Step = 'idle' | 'waiting_code' | 'connecting'

export default function Login({ onLoggedIn }: Props) {
  const { t } = useI18n()
  const [step, setStep]     = useState<Step>('idle')
  const [code, setCode]     = useState('')
  const [error, setError]   = useState('')
  const [isConnecting, setIsConnecting] = useState(false)

  const onLoggedInRef = useRef(onLoggedIn)
  onLoggedInRef.current = onLoggedIn

  useEffect(() => {
    const unsubOk = window.claudePro.on('broker:connected', () => {
      console.log('[LOGIN] broker:connected recebido!')
      setIsConnecting(false)
      onLoggedInRef.current()
    })
    const unsubErr = window.claudePro.on('broker:error', (msg: string) => {
      console.error('[LOGIN] broker:error:', msg)
      setIsConnecting(false)
      setError(typeof msg === 'string' ? msg : String(msg))
      setStep('waiting_code')
    })

    void window.claudePro.brokerIsConnected().then((res) => {
      if (res.connected) {
        console.log('[LOGIN] broker já conectado ao montar — avançando')
        onLoggedInRef.current()
      }
    })

    return () => {
      unsubOk()
      unsubErr()
    }
  }, [])

  async function handleLogin() {
    setIsConnecting(true)
    setError('')
    const res = await window.claudePro.brokerStartAuth()
    if (!res.ok) {
      console.error('Erro ao iniciar auth:', res.error)
      setIsConnecting(false)
      return
    }
    setStep('waiting_code')
  }

  async function handleCode() {
    if (!code.trim()) return setError(t('login.needUrl'))
    setError('')
    setStep('connecting')

    const ex = await window.claudePro.brokerExchangeCode(code.trim())
    if (!ex.ok) {
      setError(ex.error ?? t('login.authFailed'))
      setStep('waiting_code')
      return
    }

    onLoggedIn()
  }

  return (
    <div className="login-page">
      <div className="login-orb" aria-hidden />
      <div className={`login-card glass-elevated${isConnecting ? ' login-card-loading' : ''}`}>
        <div className="login-card-accent" aria-hidden />
        {isConnecting ? (
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

        {step === 'idle' && (
          <>
            <p className="login-desc">
              {t('login.desc')}
            </p>
            {error && <div className="login-error">{error}</div>}
            <button className="btn-broker" onClick={handleLogin}>
              {t('login.enter')}
            </button>
          </>
        )}

        {step === 'waiting_code' && (
          <>
            <p className="login-desc">
              {t('login.pasteHint')}
            </p>
            <div className="field-group">
              <label>{t('login.returnUrl')}</label>
              <input
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="https://claudepro.online/claudeplus/auth/callback?code=..."
                autoFocus
              />
            </div>
            {error && <div className="login-error">{error}</div>}
            <button className="btn-broker" onClick={handleCode}>{t('login.continue')}</button>
            <button className="btn-ghost" onClick={() => { setIsConnecting(false); setStep('idle'); setCode(''); setError('') }}>{t('login.back')}</button>
          </>
        )}

        {step === 'connecting' && (
          <div className="login-connecting">
            <div className="connecting-spinner" />
            <p>{t('login.connectingShort')}</p>
          </div>
        )}
        </>
        )}
        <div className="login-lang-slot">
          <LanguageSwitcher variant="corner" />
        </div>
      </div>
    </div>
  )
}
