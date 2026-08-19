import { useEffect, useState } from 'react'
import Operacoes from './Operacoes'
import Aulas from './Aulas'
import Suporte from './Suporte'
import NotificationBell from '../components/NotificationBell'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useI18n } from '../i18n/I18nProvider'
import sidebarLogoIcon from '../../img/logo icone.png'

type Tab = 'aulas' | 'operacoes' | 'suporte'

interface Props { onLogout: () => void }

function IconAulas({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 7h8M8 11h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconOperacoes({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="8" width="7" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 21V3M16.5 21V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function IconSuporte({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 15a2 2 0 0 1-2 2H7l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v9z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function IconLogout({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SidebarLogoMark() {
  return (
    <div className="sidebar-logo-mark" title="Claude Pro">
      <img
        src={sidebarLogoIcon}
        alt="Claude Pro"
        className="sidebar-logo-img"
        draggable={false}
      />
    </div>
  )
}

const NAV: { id: Tab; labelKey: 'nav.aulas' | 'nav.operacoes' | 'nav.suporte'; icon: typeof IconAulas }[] = [
  { id: 'aulas', labelKey: 'nav.aulas', icon: IconAulas },
  { id: 'operacoes', labelKey: 'nav.operacoes', icon: IconOperacoes },
  { id: 'suporte', labelKey: 'nav.suporte', icon: IconSuporte },
]

function AccountTools({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n()
  return (
    <>
      <LanguageSwitcher variant="sidebar" />
      <div className="sidebar-account">
        <span className="sidebar-account-label">{t('nav.account')}</span>
        <div className="sidebar-account-row">
          <span className="sidebar-account-avatar" aria-hidden>C</span>
          <span className="sidebar-account-line">Broker10</span>
        </div>
      </div>
      <div className="sidebar-notify-slot">
        <NotificationBell />
      </div>
      <button
        type="button"
        className="sidebar-logout-btn"
        onClick={() => void onLogout()}
        aria-label={t('nav.logout')}
      >
        <IconLogout className="sidebar-logout-icon" />
      </button>
    </>
  )
}

export default function MainApp({ onLogout }: Props) {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('operacoes')
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 860px)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const onChange = () => setCompact(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  /** Sair da conta: logout COMPLETO — para o bot, encerra a sessão e descarta os
   *  tokens, exigindo nova autenticação (email/senha) no próximo login. */
  async function handleLogout() {
    try { sessionStorage.setItem('cw_need_broker_login', '1') } catch { /* ignore */ }
    try {
      await window.claudePro?.brokerLogout()
    } catch {
      /* best-effort: mesmo com falha no IPC, o utilizador sai da conta */
    } finally {
      onLogout()
    }
  }

  return (
    <div className={`mainapp members-shell${compact ? ' members-shell--compact' : ''}`}>
      {compact && (
        <header className="members-topbar">
          <SidebarLogoMark />
          <div className="members-topbar-actions">
            <AccountTools onLogout={handleLogout} />
          </div>
        </header>
      )}

      <aside className="members-sidebar" aria-label={t('nav.main')}>
        <div className="members-sidebar-pill members-sidebar-pill--floating">
          {!compact && (
            <div className="sidebar-zone sidebar-zone--brand">
              <SidebarLogoMark />
            </div>
          )}

          <nav className="sidebar-zone sidebar-zone--nav" aria-label={t('nav.sections')}>
            {NAV.map(({ id, labelKey, icon: Icon }) => {
              const active = tab === id
              const isCta = id === 'operacoes'
              const label = t(labelKey)
              return (
                <button
                  key={id}
                  type="button"
                  title={label}
                  className={[
                    'sidebar-nav-btn',
                    isCta ? 'sidebar-nav-btn--operacoes' : '',
                    active ? 'active' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setTab(id)}
                >
                  <span className="sidebar-nav-iconWrap">
                    <Icon className="sidebar-nav-icon" />
                  </span>
                  <span className="sidebar-nav-label">{label}</span>
                </button>
              )
            })}
          </nav>

          {!compact && (
            <div className="sidebar-zone sidebar-zone--footer">
              <div className="sidebar-footer-sep" aria-hidden />
              <AccountTools onLogout={handleLogout} />
            </div>
          )}
        </div>
      </aside>

      <div className="members-main">
        <div className="mainapp-body">
          <div className="tab-panel" style={{ display: tab === 'aulas' ? 'contents' : 'none' }}>
            <Aulas />
          </div>
          <div className="tab-panel" style={{ display: tab === 'operacoes' ? 'contents' : 'none' }}>
            <Operacoes />
          </div>
          <div className="tab-panel" style={{ display: tab === 'suporte' ? 'contents' : 'none' }}>
            <Suporte />
          </div>
        </div>
      </div>
    </div>
  )
}
