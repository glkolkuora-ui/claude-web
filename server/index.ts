import http from 'http'
import path from 'path'
import fs from 'fs'
import express from 'express'
import cookieParser from 'cookie-parser'
import { WebSocketServer } from 'ws'
import { FEATURE_FLAGS } from './engine/feature-flags'
import { pingDb } from './engine/db'
import {
  checkUpdate,
  clearNotifications,
  listLessonCatalog,
  listLessonProgress,
  listNotifications,
  markLessonProgress,
  markNotificationRead,
  verifyLicense,
} from './engine/db-ops'
import {
  attachClient,
  createSession,
  emitBrokerConnected,
  getSession,
  setSessionEmail,
  setSessionLocale,
  startBot,
  stopBot,
  type Session,
} from './session-store'

const COOKIE = 'cw_sid'
const EMAIL_COOKIE = 'cw_email'
const PORT = Number(process.env.PORT || 3000)
const VERSION = process.env.npm_package_version ?? '1.0.0'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function sessionCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  }
}

function persistEmail(res: express.Response, email: string) {
  const clean = email.trim().toLowerCase()
  if (EMAIL_RE.test(clean)) res.cookie(EMAIL_COOKIE, clean, sessionCookie())
}

function publicOrigin(req: express.Request): string {
  const xfProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  const proto = xfProto || req.protocol || 'https'
  const xfHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
  const host = xfHost || req.get('host') || 'localhost'
  return `${proto}://${host}`
}

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

function extractOAuthCode(raw: string): string | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null
  try {
    const u = new URL(trimmed)
    const code = u.searchParams.get('code')
    if (code) return code
  } catch { /* not a URL */ }
  const match = trimmed.match(/[?&]code=([^&]+)/)
  return match ? decodeURIComponent(match[1]) : trimmed
}

function requireSession(req: express.Request, res: express.Response): Session | null {
  let sid = String(req.cookies?.[COOKIE] ?? '')
  let session = getSession(sid)
  if (!session) {
    session = createSession()
    sid = session.id
    res.cookie(COOKIE, sid, sessionCookie())
  }
  const emailFromCookie = String(req.cookies?.[EMAIL_COOKIE] ?? '').trim().toLowerCase()
  if (!session.email && EMAIL_RE.test(emailFromCookie)) {
    session.email = emailFromCookie
  }
  if (session.email) session.sdk.setUserEmail(session.email)
  return session
}

app.get('/api/health', async (_req, res) => {
  const db = await pingDb()
  res.json({ ok: true, service: 'claude-web', db })
})

app.get('/api/session', (req, res) => {
  const session = requireSession(req, res)!
  res.json({
    ok: true,
    connected: session.sdk.isConnected(),
    running: session.bot.isRunning(),
  })
})

app.get('/api/version', (_req, res) => {
  res.json({ version: VERSION, platform: 'web' })
})

app.post('/api/auth/start', async (req, res) => {
  const session = requireSession(req, res)!
  try {
    const email = String(req.body?.email ?? session.email ?? '').trim().toLowerCase()
    if (EMAIL_RE.test(email)) {
      session.email = email
      session.sdk.setUserEmail(email)
      persistEmail(res, email)
    }
    if (!session.email) {
      return res.json({ ok: false, error: 'Email do usuário não definido — passe pelo LicenseGate antes do login Broker10' })
    }
    session.sdk.setRedirectUri('https://claudepro.online/claudeplus/auth/callback')
    const { url, codeVerifier } = await session.sdk.createAuthUrl()
    session.verifier = codeVerifier
    res.json({ ok: true, url, origin: publicOrigin(req) })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message ?? 'auth_start_failed' })
  }
})

app.post('/api/auth/exchange', async (req, res) => {
  const session = requireSession(req, res)!
  try {
    const raw = String(req.body?.code ?? '')
    const code = extractOAuthCode(raw)
    if (!code) return res.json({ ok: false, error: 'URL sem código de autorização' })
    if (!session.verifier) return res.json({ ok: false, error: 'Inicie o fluxo de autenticação primeiro' })
    await session.sdk.exchangeCode(code, session.verifier)
    await session.sdk.connect()
    session.verifier = null
    session.brokerLinked = true
    emitBrokerConnected(session)
    res.json({ ok: true })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message ?? 'exchange_failed' })
  }
})

app.get('/auth/callback', async (req, res) => {
  const session = requireSession(req, res)!
  try {
    if (req.query.error) {
      return res.redirect(`/?auth=denied`)
    }
    const code = extractOAuthCode(String(req.query.code ?? req.query.raw ?? ''))
    if (!code) return res.redirect('/?auth=missing_code')
    if (!session.verifier) return res.redirect('/?auth=no_verifier')
    await session.sdk.exchangeCode(code, session.verifier)
    await session.sdk.connect()
    session.verifier = null
    session.brokerLinked = true
    emitBrokerConnected(session)
    const origin = publicOrigin(req)
    res.type('html').send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Claude Pro</title></head>
<body style="background:#0d0f14;color:#e2e4ea;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<p id="msg">Conectado. Fechando esta guia...</p>
<script>
  try { localStorage.setItem('cw_broker_auth', JSON.stringify({ ok: true, t: Date.now() })) } catch (e) {}
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ channel: 'broker:connected' }, ${JSON.stringify(origin)})
      window.opener.focus()
    }
  } catch (e) {}
  window.close()
  setTimeout(function () {
    document.getElementById('msg').textContent = 'Pode fechar esta guia e voltar ao Claude Pro.'
  }, 400)
</script>
</body></html>`)
  } catch (e: any) {
    console.error('[auth/callback]', e?.message ?? e)
    res.redirect('/?auth=error')
  }
})

app.get('/api/auth/connected', (req, res) => {
  const session = requireSession(req, res)!
  res.json({ connected: session.sdk.isConnected() })
})

app.post('/api/auth/logout', async (req, res) => {
  const session = requireSession(req, res)!
  try {
    await session.bot.stop().catch(() => {})
    await session.sdk.logout()
    session.brokerLinked = false
    res.json({ ok: true })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message ?? 'logout_failed' })
  }
})

app.post('/api/auth/disconnect', async (req, res) => {
  const session = requireSession(req, res)!
  try {
    await session.sdk.disconnect()
    res.json({ ok: true })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message ?? 'disconnect_failed' })
  }
})

app.get('/api/sdk/balances', async (req, res) => {
  const session = requireSession(req, res)!
  try {
    res.json({ ok: true, balances: await session.sdk.getBalances() })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message })
  }
})

app.get('/api/sdk/actives', async (req, res) => {
  const session = requireSession(req, res)!
  const instrument = req.query.instrument === 'digital' ? 'digital' : 'binary'
  try {
    res.json({ ok: true, actives: await session.sdk.getAvailableActives(instrument) })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message })
  }
})

app.post('/api/bot/start', async (req, res) => {
  const session = requireSession(req, res)!
  res.json(await startBot(session, req.body))
})

app.post('/api/bot/stop', async (req, res) => {
  const session = requireSession(req, res)!
  res.json(await stopBot(session))
})

app.get('/api/bot/status', (req, res) => {
  const session = requireSession(req, res)!
  res.json(session.bot.getStatus())
})

app.get('/api/bot/chart-snapshot', (req, res) => {
  const session = requireSession(req, res)!
  res.json(session.bot.getChartCandles())
})

app.post('/api/locale', (req, res) => {
  const session = requireSession(req, res)!
  const locale = setSessionLocale(session, String(req.body?.locale ?? 'pt'))
  res.json({ ok: true, locale })
})

app.post('/api/user/email', async (req, res) => {
  const session = requireSession(req, res)!
  const result = await setSessionEmail(session, String(req.body?.email ?? ''))
  if (session.email) persistEmail(res, session.email)
  res.json(result)
})

app.post('/api/license/verify', async (req, res) => {
  const session = requireSession(req, res)!
  try {
    const email = String(req.body?.email ?? '')
    const result = await verifyLicense({
      email,
      appVersion: String(req.body?.app_version ?? 'web'),
      clientIp: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    })
    if (result.authorized && result.user_id) {
      session.email = email.trim().toLowerCase()
      session.userId = result.user_id
      session.sdk.setUserEmail(session.email)
      persistEmail(res, session.email)
    }
    res.json(result)
  } catch (e: any) {
    res.json({ authorized: false, message: e?.message ?? 'license_failed' })
  }
})

app.get('/api/lessons/catalog', async (_req, res) => {
  try {
    res.json({ ok: true, ...(await listLessonCatalog()) })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message, modules: [], lessons: [], materials: [] })
  }
})

app.post('/api/lessons/progress/list', async (req, res) => {
  try {
    const userId = String(req.body?.user_id ?? '')
    res.json({ watched_lesson_ids: await listLessonProgress(userId) })
  } catch (e: any) {
    res.json({ watched_lesson_ids: [], error: e?.message })
  }
})

app.post('/api/lessons/progress/mark', async (req, res) => {
  try {
    await markLessonProgress(
      String(req.body?.user_id ?? ''),
      String(req.body?.lesson_id ?? ''),
      Boolean(req.body?.is_watched),
    )
    res.json({ ok: true })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message })
  }
})

app.post('/api/notifications/list', async (req, res) => {
  try {
    const userId = typeof req.body?.user_id === 'string' ? req.body.user_id : null
    res.json(await listNotifications(userId))
  } catch (e: any) {
    res.json({ notifications: [], dismissed_keys: [], error: e?.message })
  }
})

app.post('/api/notifications/mark-read', async (req, res) => {
  try {
    res.json(await markNotificationRead({
      userId: typeof req.body?.user_id === 'string' ? req.body.user_id : null,
      notificationId: typeof req.body?.notification_id === 'string' ? req.body.notification_id : undefined,
      itemKey: typeof req.body?.item_key === 'string' ? req.body.item_key : undefined,
    }))
  } catch (e: any) {
    res.json({ ok: false, error: e?.message })
  }
})

app.post('/api/notifications/clear', async (req, res) => {
  try {
    const userId = String(req.body?.user_id ?? '')
    const keys = Array.isArray(req.body?.dismiss_keys)
      ? req.body.dismiss_keys.filter((k: unknown) => typeof k === 'string' && k.length > 0)
      : []
    res.json(await clearNotifications(userId, keys))
  } catch (e: any) {
    res.json({ ok: false, error: e?.message })
  }
})

app.get('/api/user', (req, res) => {
  const session = requireSession(req, res)!
  res.json({ userId: session.userId, email: session.email })
})

app.get('/api/embed-origin', (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`
  res.json({ origin, pageUrl: `${origin}/` })
})

app.post('/api/check-update', async (_req, res) => {
  if (!FEATURE_FLAGS.UPDATE_CHECK_ENABLED) return res.json({ ok: true, needs_update: false })
  try {
    const result = await checkUpdate('web', VERSION)
    res.json({ ok: true, ...result })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message })
  }
})

const publicDir = path.join(__dirname, 'public')
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/auth')) return next()
    res.sendFile(path.join(publicDir, 'index.html'))
  })
}

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws, req) => {
  const cookie = String(req.headers.cookie ?? '')
  const match = cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`))
  const sid = match ? decodeURIComponent(match[1]) : ''
  const session = getSession(sid)
  if (!session) {
    ws.close(4401, 'no session')
    return
  }
  attachClient(session, ws)
  ws.send(JSON.stringify({
    channel: 'session:hello',
    payload: { connected: session.sdk.isConnected(), running: session.bot.isRunning() },
  }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[claude-web] listening on :${PORT}`)
})
