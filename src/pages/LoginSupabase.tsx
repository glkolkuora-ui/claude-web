// ════════════════════════════════════════════════════════════════════
// LoginSupabase — tela de login via Supabase Auth.
// CRIADA mas atualmente INATIVA: App.tsx só renderiza isso se
// FEATURE_FLAGS.LOGIN_REQUIRED === true.
//
// Para ativar comercialmente:
//   1. Mudar LOGIN_REQUIRED = true em src/feature-flags.ts E em
//      electron/main/feature-flags.ts
//   2. Criar usuários via Dashboard ou via signup público
//   3. Marcar profiles.license_status = 'active' / 'trial'
// ════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { supabase } from '../lib/supabase-client'
import { useI18n } from '../i18n/I18nProvider'
import LanguageSwitcher from '../components/LanguageSwitcher'

interface Profile {
  id: string
  email: string
  license_status: 'active' | 'inactive' | 'expired' | 'trial'
  plan: string
  license_expires_at: string | null
}

interface Props {
  onLogin: (user: { id: string; email: string }) => void
}

function LogoMark() {
  return (
    <svg className="login-supa-logo" viewBox="0 0 48 40" aria-hidden>
      <rect className="login-supa-logo-bar login-supa-logo-bar--l" x="6" y="14" width="8" height="20" rx="2" />
      <rect className="login-supa-logo-bar login-supa-logo-bar--c" x="20" y="6" width="8" height="28" rx="2" />
      <rect className="login-supa-logo-bar login-supa-logo-bar--r" x="34" y="10" width="8" height="24" rx="2" />
    </svg>
  )
}

function IconEnvelope() {
  return (
    <svg className="login-supa-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconLock() {
  return (
    <svg className="login-supa-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  )
}

function IconContinue() {
  return (
    <svg className="login-supa-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function LoginSupabase({ onLogin }: Props) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setInfo(null); setLoading(true)
    try {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (authErr || !data.user) {
        setError(authErr?.message ?? t('supa.loginFail'))
        return
      }
      const { data: profile, error: profErr } = await supabase
        .from('profiles')
        .select('id, email, license_status, plan, license_expires_at')
        .eq('id', data.user.id)
        .single()

      if (profErr) {
        setError(t('supa.licenseCheck', { msg: profErr.message }))
        await supabase.auth.signOut()
        return
      }

      const p = profile as Profile
      if (p.license_status === 'inactive' || p.license_status === 'expired') {
        setError(
          p.license_status === 'expired'
            ? t('supa.expired')
            : t('supa.inactive'),
        )
        await supabase.auth.signOut()
        return
      }

      onLogin({ id: data.user.id, email: data.user.email ?? '' })
    } catch (e: any) {
      setError(e?.message ?? t('supa.unexpected'))
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    setError(null); setInfo(null)
    if (!email.trim()) {
      setError(t('supa.needEmail'))
      return
    }
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email.trim())
    if (resetErr) setError(resetErr.message)
    else setInfo(t('supa.resetSent'))
  }

  return (
    <div className="login-supa-page">
      <div className="login-supa-grid" aria-hidden />
      <div className="login-supa-glow" aria-hidden />

      <form
        className="login-supa-card"
        onSubmit={handleSubmit}
        aria-busy={loading}
      >
        <div className="login-supa-card-accent" aria-hidden />

        <header className="login-supa-header">
          <LogoMark />
          <div className="login-supa-brand" aria-label="Claude Pro">
            <span className="login-supa-brand-claude">CLAUDE</span>
            <span className="login-supa-brand-pro">PRO</span>
          </div>
          <h1 className="login-supa-title">{t('supa.title')}</h1>
          <p className="login-supa-sub">{t('supa.sub')}</p>
          <p className="login-supa-tip">{t('supa.tip')}</p>
        </header>

        <div className="login-supa-fields">
          <div className="login-supa-field">
            <label className="login-supa-label" htmlFor="supa-email">{t('supa.email')}</label>
            <div className="login-supa-input-wrap">
              <IconEnvelope />
              <input
                id="supa-email"
                type="email"
                className="login-supa-input"
                placeholder={t('license.placeholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>
          </div>

          <div className="login-supa-field">
            <label className="login-supa-label" htmlFor="supa-password">{t('supa.password')}</label>
            <div className="login-supa-input-wrap">
              <IconLock />
              <input
                id="supa-password"
                type="password"
                className="login-supa-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>
        </div>

        {error && (
          <div className="login-supa-alert login-supa-alert--error" role="alert">
            {error}
          </div>
        )}
        {info && (
          <div className="login-supa-alert login-supa-alert--ok" role="status">
            {info}
          </div>
        )}

        <button type="submit" className="login-supa-submit" disabled={loading}>
          <IconContinue />
          {loading ? t('supa.entering') : t('supa.continue')}
        </button>

        <button type="button" className="login-supa-link-btn" onClick={handleReset}>
          {t('supa.forgot')}
        </button>

        <p className="login-supa-legal">
          {t('supa.legal')}{' '}
          <a
            href="https://claudepro.online"
            target="_blank"
            rel="noopener noreferrer"
            className="login-supa-legal-link"
          >
            {t('supa.more')}
          </a>
        </p>
      </form>
      <LanguageSwitcher variant="corner" />
    </div>
  )
}
