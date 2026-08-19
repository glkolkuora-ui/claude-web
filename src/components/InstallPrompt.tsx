import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'

type Platform = 'ios' | 'android' | null
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'cw_pwa_dismissed_at'
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000

function detectPlatform(): Platform {
  const ua = navigator.userAgent || ''
  const iOS = /iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (iOS) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return null
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function wasDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return Date.now() - at < DISMISS_MS
  } catch {
    return false
  }
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3v12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export default function InstallPrompt() {
  const { t } = useI18n()
  const [platform, setPlatform] = useState<Platform>(null)
  const [open, setOpen] = useState(false)
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (isStandalone() || wasDismissed()) return
    const next = detectPlatform()
    if (!next) return

    const onPrompt = (event: Event) => {
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    const timer = window.setTimeout(() => {
      if (isStandalone() || wasDismissed()) return
      setPlatform(next)
      setOpen(true)
    }, 1400)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.clearTimeout(timer)
    }
  }, [])

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* ignore */ }
    setOpen(false)
  }

  async function installAndroid() {
    if (!deferred) return
    await deferred.prompt()
    try { await deferred.userChoice } catch { /* ignore */ }
    setDeferred(null)
    dismiss()
  }

  if (!open || !platform) return null

  return (
    <div className="install-sheet" role="dialog" aria-labelledby="install-title">
      <div className="install-sheet-card">
        <img src="/icons/icon-192.png?v=2" alt="" className="install-sheet-icon" width={44} height={44} />
        <div className="install-sheet-copy">
          <h2 id="install-title">{t('install.title')}</h2>
          <p>{platform === 'ios' ? t('install.iosBody') : t('install.androidBody')}</p>
          {platform === 'ios' ? (
            <ol className="install-sheet-steps">
              <li>
                <ShareIcon />
                {t('install.iosStep1')}
              </li>
              <li>{t('install.iosStep2')}</li>
            </ol>
          ) : deferred ? (
            <button type="button" className="install-sheet-cta" onClick={() => void installAndroid()}>
              {t('install.androidCta')}
            </button>
          ) : (
            <p className="install-sheet-hint">{t('install.androidHint')}</p>
          )}
        </div>
        <button type="button" className="install-sheet-dismiss" onClick={dismiss}>
          {t('install.dismiss')}
        </button>
      </div>
    </div>
  )
}
