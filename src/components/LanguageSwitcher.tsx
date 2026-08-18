import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n/I18nProvider'
import { LOCALE_OPTIONS, type Locale } from '../i18n/messages'

function IconGlobe({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 12h18M12 3c2.8 3 4.2 6 4.2 9s-1.4 6-4.2 9c-2.8-3-4.2-6-4.2-9s1.4-6 4.2-9Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

interface Props {
  /** `sidebar` = botão estreito na rail; `corner` = canto das telas de auth. */
  variant?: 'sidebar' | 'corner'
}

export default function LanguageSwitcher({ variant = 'sidebar' }: Props) {
  const { locale, setLocale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const current = LOCALE_OPTIONS.find(o => o.id === locale) ?? LOCALE_OPTIONS[0]

  useLayoutEffect(() => {
    if (!open || variant !== 'sidebar' || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const menuW = 176
    let left = rect.right + 12
    if (left + menuW > window.innerWidth - 12) left = rect.left - menuW - 12
    let top = rect.top
    if (top + 140 > window.innerHeight - 12) top = window.innerHeight - 152
    if (top < 12) top = 12
    setMenuPos({ top, left })
  }, [open, variant])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(id: Locale) {
    setLocale(id)
    setOpen(false)
  }

  return (
    <div className={`lang-switch lang-switch--${variant} ${open ? 'open' : ''}`} ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className={variant === 'sidebar' ? 'sidebar-nav-btn lang-switch-btn' : 'lang-switch-corner-btn'}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('nav.language')}
        title={t('nav.language')}
      >
        {variant === 'sidebar' ? (
          <>
            <span className="sidebar-nav-iconWrap">
              <IconGlobe className="sidebar-nav-icon" />
            </span>
            <span className="sidebar-nav-label">{current.short}</span>
          </>
        ) : (
          <>
            <IconGlobe className="lang-switch-corner-icon" />
            <span>{current.short}</span>
          </>
        )}
      </button>

      {open && variant === 'corner' && (
        <ul className="lang-menu" role="listbox" aria-label={t('nav.language')} ref={menuRef}>
          {LOCALE_OPTIONS.map(opt => (
            <li
              key={opt.id}
              role="option"
              aria-selected={opt.id === locale}
              className={`lang-option ${opt.id === locale ? 'active' : ''}`}
              onClick={() => pick(opt.id)}
            >
              <span className="lang-option-code">{opt.short}</span>
              <span className="lang-option-name">{opt.nativeName}</span>
            </li>
          ))}
        </ul>
      )}

      {open && variant === 'sidebar' && createPortal(
        <ul
          className="lang-menu lang-menu--portal"
          role="listbox"
          aria-label={t('nav.language')}
          ref={menuRef}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {LOCALE_OPTIONS.map(opt => (
            <li
              key={opt.id}
              role="option"
              aria-selected={opt.id === locale}
              className={`lang-option ${opt.id === locale ? 'active' : ''}`}
              onClick={() => pick(opt.id)}
            >
              <span className="lang-option-code">{opt.short}</span>
              <span className="lang-option-name">{opt.nativeName}</span>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  )
}
