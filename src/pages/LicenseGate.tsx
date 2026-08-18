// ════════════════════════════════════════════════════════════════════
// LicenseGate — primeiro contato do app. Valida o email do usuário
// contra a Misespay via Edge Function `verify-license`.
//
// Comportamento:
//   • Ao montar, se há email salvo no localStorage, revalida silencioso
//     em background. Se passar, libera direto. Se falhar, mostra o form.
//   • Form pede email → POST verify-license → onAuthorized(email).
//   • localStorage guarda apenas o email autorizado (sem dados de
//     compra, sem JWT, sem nada sensível).
// ════════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react'
import { FEATURE_FLAGS, SUPABASE_URL, SUPABASE_ANON_KEY } from '../feature-flags'
import { useI18n } from '../i18n/I18nProvider'
import LanguageSwitcher from '../components/LanguageSwitcher'

interface Props {
  onAuthorized: (email: string) => void
}

const STORAGE_KEY = 'claudepro_licensed_email'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

async function authorizeEmail(emailToCheck: string, onAuthorized: (email: string) => void) {
  const normalized = emailToCheck.trim().toLowerCase()
  localStorage.setItem(STORAGE_KEY, normalized)
  try {
    await window.claudePro?.setUserEmail?.(normalized)
  } catch {
    /* ignore */
  }
  onAuthorized(normalized)
}

function LogoMark() {
  return (
    <svg className="lic-gate-logo" viewBox="0 0 48 40" aria-hidden>
      <rect className="lic-gate-logo-bar lic-gate-logo-bar--l" x="6" y="14" width="8" height="20" rx="2" />
      <rect className="lic-gate-logo-bar lic-gate-logo-bar--c" x="20" y="6" width="8" height="28" rx="2" />
      <rect className="lic-gate-logo-bar lic-gate-logo-bar--r" x="34" y="10" width="8" height="24" rx="2" />
    </svg>
  )
}

function IconEnvelope() {
  return (
    <svg className="lic-gate-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function LicenseGate({ onAuthorized }: Props) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkingCache, setCheckingCache] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      void validateEmail(saved, true)
    } else {
      setCheckingCache(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function validateEmail(emailToCheck: string, silent = false) {
    if (!silent) setLoading(true)
    setError(null)

    const normalized = emailToCheck.trim().toLowerCase()
    if (!EMAIL_RE.test(normalized)) {
      setCheckingCache(false)
      setLoading(false)
      if (!silent) setError(t('license.invalidEmail'))
      return
    }

    if (FEATURE_FLAGS.LICENSE_OPEN_ACCESS) {
      // Registra no Supabase (license_checks + user_id) mesmo em modo aberto —
      // necessário para broker-auth-exchange validar a licença.
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/verify-license`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify({ email: normalized, app_version: 'open-access' }),
        })
      } catch {
        /* best-effort */
      }
      await authorizeEmail(normalized, onAuthorized)
      setCheckingCache(false)
      setLoading(false)
      return
    }

    try {
      const appVersion =
        (typeof window !== 'undefined' && (window as any).claudePro?.appPlatform)
          ? '1.0.0'
          : 'web'

      const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-license`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: normalized,
          app_version: appVersion,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (data?.authorized) {
        await authorizeEmail(normalized, onAuthorized)
        return
      }

      localStorage.removeItem(STORAGE_KEY)
      setCheckingCache(false)
      if (!silent) {
        setError(typeof data?.message === 'string' ? data.message : t('license.denied'))
      }
    } catch {
      setCheckingCache(false)
      if (!silent) {
        setError(t('license.checkError'))
      }
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      setError(t('license.needEmail'))
      return
    }
    void validateEmail(trimmed)
  }

  const shell = (children: React.ReactNode) => (
    <div className="lic-gate-page">
      <div className="lic-gate-grid" aria-hidden />
      <div className="lic-gate-glow" aria-hidden />
      {children}
    </div>
  )

  if (checkingCache) {
    return shell(
      <div className="lic-gate-card" role="status" aria-live="polite">
        <div className="lic-gate-accent" aria-hidden />
        <header className="lic-gate-header">
          <LogoMark />
          <h1 className="lic-gate-title">Claude Pro</h1>
        </header>
        <div className="lic-gate-loading">
          <div className="lic-gate-spinner" />
          <p>{t('license.checking')}</p>
        </div>
      </div>
    )
  }

  return shell(
    <form className="lic-gate-card" onSubmit={handleSubmit}>
      <div className="lic-gate-accent" aria-hidden />

      <header className="lic-gate-header">
        <LogoMark />
        <h1 className="lic-gate-title">Claude Pro</h1>
        <p className="lic-gate-sub">
          {t('license.subtitle')}
        </p>
      </header>

      <div className="lic-gate-fields">
        <label className="lic-gate-label" htmlFor="lic-email">{t('license.email')}</label>
        <div className="lic-gate-input-wrap">
          <IconEnvelope />
          <input
            id="lic-email"
            type="email"
            className="lic-gate-input"
            placeholder={t('license.placeholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            autoComplete="email"
            autoFocus
          />
        </div>
      </div>

      {error && (
        <div className="lic-gate-alert" role="alert">
          {error}
        </div>
      )}

      <button type="submit" className="lic-gate-submit" disabled={loading || !email.trim()}>
        {!loading && <span className="lic-gate-submit-arrow" aria-hidden>→</span>}
        {loading ? t('license.verifying') : t('license.continue')}
      </button>

      <div className="lic-gate-footer">
        <p>
          {t('license.footer')}{' '}
          <a
            href="https://claudepro.online"
            target="_blank"
            rel="noopener noreferrer"
            className="lic-gate-footer-link"
          >
            {t('license.support')}
          </a>
        </p>
        <LanguageSwitcher variant="corner" />
      </div>
    </form>
  )
}
