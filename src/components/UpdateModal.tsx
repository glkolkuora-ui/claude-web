import { useCallback, useEffect, useState } from 'react'
import { FEATURE_FLAGS } from '../feature-flags'
import type { UpdateCheckResult } from '../types'
import { useI18n } from '../i18n/I18nProvider'

const RECHECK_MS = 60 * 60 * 1000 // 1 hora

export default function UpdateModal() {
  const { t } = useI18n()
  const [info, setInfo]               = useState<UpdateCheckResult | null>(null)
  const [dismissed, setDismissed]     = useState(false)
  const [currentVersion, setCurrent]  = useState<string | null>(null)

  // Carrega a versão atual do app (do package.json via main process)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.claudePro.appGetVersion()
        if (!cancelled) setCurrent(res?.version ?? null)
      } catch { /* silencioso */ }
    })()
    return () => { cancelled = true }
  }, [])

  const checkForUpdate = useCallback(async () => {
    try {
      const res = await window.claudePro.appCheckUpdate()
      if (res.ok && res.needs_update) {
        setInfo(res)
        setDismissed(false)            // reabre se for nova versão (mandatory ou não)
      }
    } catch {
      /* check é best-effort, silencioso */
    }
  }, [])

  // Check inicial + re-check a cada 1h
  useEffect(() => {
    if (!FEATURE_FLAGS.UPDATE_CHECK_ENABLED) return
    void checkForUpdate()
    const interval = setInterval(() => { void checkForUpdate() }, RECHECK_MS)
    return () => clearInterval(interval)
  }, [checkForUpdate])

  if (!info || dismissed) return null

  const mandatory = info.is_mandatory
  return (
    <div className="modal-overlay" onClick={() => { if (!mandatory) setDismissed(true) }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span className="modal-title">
            {mandatory ? t('update.mandatory') : t('update.available')}
          </span>
          {!mandatory && (
            <button className="modal-close" onClick={() => setDismissed(true)}>✕</button>
          )}
        </div>
        <div className="modal-body" style={{ padding: 20 }}>
          <p style={{ marginBottom: 12 }}>
            {currentVersion ? (
              <>
                <span style={{ color: '#9ca3af' }}>{t('update.yours')}</span>
                <code>{currentVersion}</code>
                <span style={{ margin: '0 8px', color: '#9ca3af' }}>→</span>
              </>
            ) : null}
            <span style={{ color: '#9ca3af' }}>{t('update.latest')}</span>
            <b>{info.latest_version}</b>
          </p>
          {info.changelog && (
            <pre style={{
              whiteSpace: 'pre-wrap',
              background: '#0d0f14',
              padding: 12,
              borderRadius: 6,
              fontSize: 13,
              marginTop: 4,
            }}>
              {info.changelog}
            </pre>
          )}
          {mandatory && (
            <p style={{ color: '#ef4444', marginTop: 12 }}>
              {t('update.must')}
            </p>
          )}
        </div>
        <div className="modal-footer">
          {!mandatory && (
            <button className="btn-ghost" onClick={() => setDismissed(true)}>{t('update.later')}</button>
          )}
          {info.download_url && (
            <a
              className="btn-primary"
              href={info.download_url}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              {t('update.download')}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
