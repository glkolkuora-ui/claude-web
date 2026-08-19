/** Cliente HTTP + WebSocket que replica a API `window.claudePro` do Electron. */

type Unsub = () => void

const listeners = new Map<string, Set<(...args: any[]) => void>>()

function emit(channel: string, payload: any) {
  const set = listeners.get(channel)
  if (!set) return
  for (const cb of set) {
    try { cb(payload) } catch (err) { console.error('[claude-web]', channel, err) }
  }
}

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  return res.json() as Promise<T>
}

let ws: WebSocket | null = null
let wsTimer: ReturnType<typeof setTimeout> | null = null

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws`
}

function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  try {
    ws = new WebSocket(wsUrl())
  } catch {
    scheduleWs()
    return
  }
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(String(ev.data))
      if (data?.channel) emit(data.channel, data.payload)
    } catch { /* ignore */ }
  }
  ws.onclose = () => scheduleWs()
  ws.onerror = () => { /* onclose follows */ }
}

function scheduleWs() {
  if (wsTimer) return
  wsTimer = setTimeout(() => {
    wsTimer = null
    connectWs()
  }, 2000)
}

void api('/api/session').then(() => connectWs()).catch(() => scheduleWs())

window.claudePro = {
  appPlatform: 'web',

  brokerStartAuth: async () =>
    api<{ ok: boolean; url?: string; origin?: string; error?: string }>('/api/auth/start', { method: 'POST' }),
  brokerExchangeCode: (code: string) =>
    api('/api/auth/exchange', { method: 'POST', body: JSON.stringify({ code }) }),
  brokerDisconnect: () => api('/api/auth/disconnect', { method: 'POST' }),
  brokerLogout: () => api('/api/auth/logout', { method: 'POST' }),
  brokerIsConnected: () => api('/api/auth/connected'),

  sdkBalances: () => api('/api/sdk/balances'),
  sdkActives: (instrument?: 'binary' | 'digital') =>
    api(`/api/sdk/actives?instrument=${instrument ?? 'binary'}`),

  botStart: (config: any) =>
    api('/api/bot/start', { method: 'POST', body: JSON.stringify(config) }),
  botStop: () => api('/api/bot/stop', { method: 'POST' }),
  botGetStatus: () => api('/api/bot/status'),
  botChartSnapshot: () => api('/api/bot/chart-snapshot'),

  appGetVersion: () => api('/api/version'),
  appSetLocale: (locale: string) =>
    api('/api/locale', { method: 'POST', body: JSON.stringify({ locale }) }),
  appCheckUpdate: () => api('/api/check-update', { method: 'POST' }),
  appOpenExternal: async (url: string) => {
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'open_failed' }
    }
  },
  appClearStorage: async () => {
    try { localStorage.clear() } catch { /* ignore */ }
    location.reload()
    return { ok: true }
  },
  setUserEmail: (email: string) =>
    api('/api/user/email', { method: 'POST', body: JSON.stringify({ email }) }),
  appGetUserId: () => api('/api/user'),
  appGetEmbedOrigin: () => api('/api/embed-origin'),

  on: (channel: string, cb: (...args: any[]) => void): Unsub => {
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
    }
    set.add(cb)
    return () => { set!.delete(cb) }
  },
}
