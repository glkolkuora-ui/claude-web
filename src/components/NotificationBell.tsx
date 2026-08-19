// ════════════════════════════════════════════════════════════════════
// NotificationBell — sino de notificações.
//
// Arquitetura:
//   1. Pega o user_id do main (window.claudePro.appGetUserId)
//   2. Chama /api/notifications/* no servidor (Postgres Railway)

//   3. Polling de 60s — sem dependência de auth Supabase no renderer
//   4. markAsRead via Edge `notifications-mark-read`
//
// Mostra mesmo quando user_id é null (só broadcasts), pra usuários
// que ainda não passaram pelo LicenseGate ou enquanto user_id carrega.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FEATURE_FLAGS } from '../feature-flags'
import { appApi } from '../lib/app-api'
import type { UpdateCheckResult } from '../types'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'

const SYS_UPDATE_PREFIX = '__update__:'
const UPDATE_KEY_PREFIX = 'update:'
const LS_UPDATE_DISMISSED = 'claudepro_update_dismissed_version'
const LS_DISMISSED = 'claudepro_notif_dismissed_v2'

type DismissedBucket = { notificationIds: string[]; itemKeys: string[] }
type DismissedStore = Record<string, DismissedBucket>

function storageUserKey(userId: string | null): string {
  return userId ?? '__anon__'
}

function updateDismissKey(version: string): string {
  return `${UPDATE_KEY_PREFIX}${version}`
}

function loadDismissedBucket(userId: string | null): DismissedBucket {
  try {
    const all = JSON.parse(localStorage.getItem(LS_DISMISSED) ?? '{}') as DismissedStore
    const bucket = all[storageUserKey(userId)]
    return {
      notificationIds: bucket?.notificationIds ?? [],
      itemKeys: bucket?.itemKeys ?? [],
    }
  } catch {
    return { notificationIds: [], itemKeys: [] }
  }
}

function mergeDismissedLocal(
  userId: string | null,
  notificationIds: string[],
  itemKeys: string[],
): void {
  try {
    const all = JSON.parse(localStorage.getItem(LS_DISMISSED) ?? '{}') as DismissedStore
    const key = storageUserKey(userId)
    const prev = all[key] ?? { notificationIds: [], itemKeys: [] }
    all[key] = {
      notificationIds: [...new Set([...prev.notificationIds, ...notificationIds])],
      itemKeys: [...new Set([...prev.itemKeys, ...itemKeys])],
    }
    localStorage.setItem(LS_DISMISSED, JSON.stringify(all))
  } catch { /* ignore */ }
}

function isNotificationDismissed(
  n: Notification,
  userId: string | null,
  serverDismissedKeys: Set<string>,
): boolean {
  const bucket = loadDismissedBucket(userId)
  if (isSystemUpdateId(n.id)) {
    const version = n.id.slice(SYS_UPDATE_PREFIX.length)
    const key = updateDismissKey(version)
    return (
      getDismissedUpdateVersion() === version
      || bucket.itemKeys.includes(key)
      || serverDismissedKeys.has(key)
    )
  }
  return bucket.notificationIds.includes(n.id)
}

function filterVisibleNotifications(
  list: Notification[],
  userId: string | null,
  serverDismissedKeys: string[],
): Notification[] {
  const keys = new Set(serverDismissedKeys)
  return list.filter(n => !isNotificationDismissed(n, userId, keys))
}

interface Notification {
  id: string
  user_id: string | null
  title: string
  message: string
  type: 'info' | 'warning' | 'update' | 'promo' | 'critical'
  is_read: boolean
  action_url: string | null
  created_at: string
  expires_at: string | null
}

const POLL_MS = 60_000
const PANEL_W = 360
const PANEL_MAX_H = 440

async function callNotifApi(name: string, body: unknown): Promise<any> {
  return appApi(`/api/notifications/${name}`, body)
}

function IconBell() {
  return (
    <svg className="notif-bell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const TYPE_KEYS: Record<Notification['type'], MessageKey> = {
  info: 'notif.type.info',
  warning: 'notif.type.warning',
  update: 'notif.type.update',
  promo: 'notif.type.promo',
  critical: 'notif.type.critical',
}

function formatWhen(
  iso: string,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
  bcp47: string,
): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return t('notif.now')
  if (mins < 60) return t('notif.mins', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('notif.hours', { n: hrs })
  return d.toLocaleDateString(bcp47, { day: '2-digit', month: 'short' })
}

function getDismissedUpdateVersion(): string | null {
  try {
    return localStorage.getItem(LS_UPDATE_DISMISSED)
  } catch {
    return null
  }
}

function setDismissedUpdateVersion(version: string) {
  try {
    localStorage.setItem(LS_UPDATE_DISMISSED, version)
  } catch { /* ignore */ }
}

function isSystemUpdateId(id: string): boolean {
  return id.startsWith(SYS_UPDATE_PREFIX)
}

function buildSystemUpdateNotification(
  info: UpdateCheckResult,
  userId: string | null,
  serverDismissedKeys: Set<string>,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): Notification | null {
  const version = info.latest_version
  const url = info.download_url?.trim()
  if (!version || !url || !info.needs_update) return null
  const key = updateDismissKey(version)
  if (
    getDismissedUpdateVersion() === version
    || loadDismissedBucket(userId).itemKeys.includes(key)
    || serverDismissedKeys.has(key)
  ) return null
  return {
    id: `${SYS_UPDATE_PREFIX}${version}`,
    user_id: null,
    title: t('notif.updateTitle', { version }),
    message: info.changelog?.trim()
      ? info.changelog.trim()
      : t('notif.updateBody'),
    type: 'update',
    is_read: false,
    action_url: url,
    created_at: info.published_at ?? new Date().toISOString(),
    expires_at: null,
  }
}

async function openInBrowser(url: string): Promise<void> {
  const trimmed = url.trim()
  if (!trimmed) return
  try {
    if (typeof window.claudePro?.appOpenExternal === 'function') {
      const res = await window.claudePro.appOpenExternal(trimmed)
      if (res.ok) return
    }
  } catch { /* fallback abaixo */ }
  window.open(trimmed, '_blank', 'noopener,noreferrer')
}

function formatWhenFull(iso: string, bcp47: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(bcp47, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function IconBack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function NotificationBell() {
  if (!FEATURE_FLAGS.NOTIFICATIONS_ENABLED) return null
  return <NotificationBellActive />
}

function NotificationBellActive() {
  const { t, bcp47 } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: PANEL_W })
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await window.claudePro.appGetUserId()
        if (!cancelled) setUserId(res?.userId ?? null)
      } catch {
        if (!cancelled) setUserId(null)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const fetchNotifications = useCallback(async (uid: string | null) => {
    try {
      const [data, updateRes] = await Promise.all([
        callNotifApi('list', { user_id: uid }),
        FEATURE_FLAGS.UPDATE_CHECK_ENABLED && typeof window.claudePro?.appCheckUpdate === 'function'
          ? window.claudePro.appCheckUpdate().catch(() => null)
          : Promise.resolve(null),
      ])

      const serverKeys: string[] = Array.isArray(data?.dismissed_keys) ? data.dismissed_keys : []
      const serverKeySet = new Set(serverKeys)

      let list: Notification[] = Array.isArray(data?.notifications)
        ? (data.notifications as Notification[])
        : []

      if (updateRes?.ok) {
        const sys = buildSystemUpdateNotification(updateRes, uid, serverKeySet, tRef.current)
        if (sys) list = [sys, ...list]
      }

      setItems(filterVisibleNotifications(list, uid, serverKeys))
    } catch (err) {
      console.error('[NOTIFICATIONS] erro ao buscar:', err)
    }
  }, [])

  useEffect(() => {
    void fetchNotifications(userId)
    const timer = setInterval(() => { void fetchNotifications(userId) }, POLL_MS)
    return () => clearInterval(timer)
  }, [userId, fetchNotifications])

  const updatePanelPosition = useCallback(() => {
    const btn = anchorRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const gap = 14
    const margin = 12
    const vw = window.innerWidth
    const vh = window.innerHeight
    const mobile = vw < 860
    const panelW = mobile ? Math.min(vw - margin * 2, 400) : PANEL_W

    let left = mobile ? (vw - panelW) / 2 : rect.right + gap
    if (!mobile && left + panelW > vw - margin) {
      left = rect.left - panelW - gap
    }
    if (left < margin) left = margin

    const panelH = Math.min(
      panelRef.current?.offsetHeight || PANEL_MAX_H,
      vh - margin * 2,
    )

    let top = mobile
      ? Math.min(rect.bottom + gap, vh - panelH - margin)
      : rect.top + rect.height / 2 - panelH / 2
    const maxTop = vh - panelH - margin
    if (top > maxTop) top = maxTop
    if (top < margin) top = margin

    setPanelPos({ top, left, width: panelW })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    // Duas passadas: a 1ª estima, a 2ª ajusta já com a altura real do painel.
    updatePanelPosition()
    const raf = requestAnimationFrame(updatePanelPosition)
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
    }
  }, [open, updatePanelPosition, items.length, selectedId])

  useEffect(() => {
    if (!open) setSelectedId(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      if (anchorRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (selectedId) setSelectedId(null)
      else setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, selectedId])

  async function markAsRead(id: string) {
    if (isSystemUpdateId(id)) {
      const version = id.slice(SYS_UPDATE_PREFIX.length)
      const key = updateDismissKey(version)
      setDismissedUpdateVersion(version)
      mergeDismissedLocal(userId, [], [key])
      if (userId) {
        await callNotifApi('mark-read', { user_id: userId, item_key: key }).catch(() => {})
      }
      setItems(prev => prev.filter(n => n.id !== id))
      return
    }
    try {
      await callNotifApi('mark-read', {
        user_id: userId,
        notification_id: id,
      })
      mergeDismissedLocal(userId, [id], [])
      setItems(prev => prev.filter(n => n.id !== id))
    } catch (err) {
      console.error('[NOTIFICATIONS] erro ao marcar como lida:', err)
    }
  }

  async function clearAll() {
    setClearing(true)
    try {
      const notificationIds = items.filter(n => !isSystemUpdateId(n.id)).map(n => n.id)
      const itemKeys: string[] = []

      for (const n of items) {
        if (isSystemUpdateId(n.id)) {
          itemKeys.push(updateDismissKey(n.id.slice(SYS_UPDATE_PREFIX.length)))
        }
      }

      if (FEATURE_FLAGS.UPDATE_CHECK_ENABLED && typeof window.claudePro?.appCheckUpdate === 'function') {
        const updateRes = await window.claudePro.appCheckUpdate().catch(() => null)
        if (updateRes?.ok && updateRes.needs_update && updateRes.latest_version) {
          const key = updateDismissKey(updateRes.latest_version)
          itemKeys.push(key)
          setDismissedUpdateVersion(updateRes.latest_version)
        }
      }

      const uniqueKeys = [...new Set(itemKeys)]
      mergeDismissedLocal(userId, notificationIds, uniqueKeys)

      if (userId) {
        await callNotifApi('clear', {
          user_id: userId,
          dismiss_keys: uniqueKeys,
        })
      }

      setItems([])
      setSelectedId(null)
    } catch (err) {
      console.error('[NOTIFICATIONS] erro ao limpar:', err)
    } finally {
      setClearing(false)
    }
  }

  const unreadCount = items.filter(n => !n.is_read).length
  const selected = selectedId ? items.find(n => n.id === selectedId) ?? null : null
  const canClear = items.length > 0 && !clearing

  function openNotification(n: Notification) {
    if (n.type === 'update' && n.action_url) {
      void markAsRead(n.id)
      void openInBrowser(n.action_url)
      return
    }
    setSelectedId(n.id)
    if (!n.is_read) void markAsRead(n.id)
  }

  const panel = open ? (
    <div
      ref={panelRef}
      className={`notif-panel${panelPos.width < PANEL_W ? ' notif-panel--sheet' : ''}`}
      role="dialog"
      aria-label={t('notif.title')}
      style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
    >
      <div className="notif-panel-head">
        {selected ? (
          <>
            <button
              type="button"
              className="notif-back-btn"
              onClick={() => setSelectedId(null)}
              aria-label={t('notif.backAria')}
            >
              <IconBack />
              <span>{t('notif.back')}</span>
            </button>
            <span className="notif-panel-title notif-panel-title--sub">{t('notif.detail')}</span>
          </>
        ) : (
          <>
            <span className="notif-panel-title">{t('notif.title')}</span>
            <div className="notif-panel-head-actions">
              {unreadCount > 0 && (
                <span className="notif-panel-badge">
                  {t(unreadCount === 1 ? 'notif.new_one' : 'notif.new_other', { n: unreadCount })}
                </span>
              )}
              {canClear && (
                <button
                  type="button"
                  className="notif-clear-btn"
                  onClick={() => { void clearAll() }}
                  disabled={clearing}
                >
                  {clearing ? t('notif.clearing') : t('notif.clear')}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="notif-panel-body">
        {selected ? (
          <article className={`notif-detail notif-detail--${selected.type}`}>
            <div className="notif-detail-meta">
              <span className={`notif-type-pill notif-type-pill--${selected.type}`}>
                {t(TYPE_KEYS[selected.type] ?? 'notif.type.info')}
              </span>
              <time className="notif-item-time" dateTime={selected.created_at}>
                {formatWhenFull(selected.created_at, bcp47)}
              </time>
            </div>
            <h2 className="notif-detail-title">{selected.title}</h2>
            <p className="notif-detail-message">{selected.message}</p>
            {selected.action_url && (
              <button
                type="button"
                className="notif-detail-link"
                onClick={() => {
                  if (selected.type === 'update') void markAsRead(selected.id)
                  void openInBrowser(selected.action_url!)
                }}
              >
                {selected.type === 'update' ? t('notif.download') : t('notif.openLink')}
              </button>
            )}
          </article>
        ) : items.length === 0 ? (
          <div className="notif-empty">
            <IconBell />
            <p>{t('notif.empty')}</p>
            <span>{t('notif.emptyHint')}</span>
          </div>
        ) : (
          items.map(n => (
            <article
              key={n.id}
              className={[
                'notif-item',
                'notif-item--clickable',
                n.is_read ? 'notif-item--read' : 'notif-item--unread',
              ].join(' ')}
              onClick={() => openNotification(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  openNotification(n)
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="notif-item-top">
                <span className={`notif-type-pill notif-type-pill--${n.type}`}>
                  {t(TYPE_KEYS[n.type] ?? 'notif.type.info')}
                </span>
                <time className="notif-item-time" dateTime={n.created_at}>
                  {formatWhen(n.created_at, t, bcp47)}
                </time>
              </div>
              <h3 className="notif-item-title">{n.title}</h3>
              <p className="notif-item-msg notif-item-msg--preview">{n.message}</p>
              <span className="notif-item-hint">{t('notif.tap')}</span>
            </article>
          ))
        )}
      </div>
    </div>
  ) : null

  return (
    <div className="notif-root">
      <button
        ref={anchorRef}
        type="button"
        className={['notif-trigger', open ? 'notif-trigger--open' : ''].filter(Boolean).join(' ')}
        onClick={() => setOpen(v => !v)}
        aria-label={t('notif.title')}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <IconBell />
        {unreadCount > 0 && (
          <span className="notif-count" aria-hidden>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {panel && createPortal(panel, document.body)}
    </div>
  )
}
