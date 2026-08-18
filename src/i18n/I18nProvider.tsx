import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BCP47,
  interpolate,
  LOCALES,
  MESSAGES,
  type Locale,
  type MessageKey,
} from './messages'

const STORAGE_KEY = 'claudepro:locale'

function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && (LOCALES as readonly string[]).includes(raw)) return raw as Locale
  } catch { /* ignore */ }
  return 'pt'
}

interface I18nValue {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  bcp47: string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
    void window.claudePro?.appSetLocale?.(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = BCP47[locale]
    document.title = interpolate(MESSAGES[locale]['app.title'] ?? MESSAGES.pt['app.title'])
    void window.claudePro?.appSetLocale?.(locale)
  }, [locale])

  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => {
    return interpolate(MESSAGES[locale][key] ?? MESSAGES.pt[key] ?? key, vars)
  }, [locale])

  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale,
    t,
    bcp47: BCP47[locale],
  }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
