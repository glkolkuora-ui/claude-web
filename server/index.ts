import http from 'http'
import path from 'path'
import fs from 'fs'
import express from 'express'
import cookieParser from 'cookie-parser'
import { WebSocketServer } from 'ws'
import { FEATURE_FLAGS } from './engine/feature-flags'
import { callEdgeFunction } from './engine/supabase-client'
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
const PORT = Number(process.env.PORT || 3000)
const VERSION = process.env.npm_package_version ?? '1.0.0'

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
    res.cookie(COOKIE, sid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    })
  }
  return session
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'claude-web' })
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
    const { url, codeVerifier } = await session.sdk.createAuthUrl()
    session.verifier = codeVerifier
    res.json({ ok: true, url })
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
    const code = extractOAuthCode(String(req.query.code ?? req.query.raw ?? ''))
    if (!code) return res.redirect('/?auth=missing_code')
    if (!session.verifier) return res.redirect('/?auth=no_verifier')
    await session.sdk.exchangeCode(code, session.verifier)
    await session.sdk.connect()
    session.verifier = null
    session.brokerLinked = true
    emitBrokerConnected(session)
    res.redirect('/')
  } catch (e: any) {
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
  res.json(await setSessionEmail(session, String(req.body?.email ?? '')))
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
    const result = await callEdgeFunction('check-update', {
      platform: 'web',
      current_version: VERSION,
    })
    if (!result.ok) return res.json({ ok: false, error: result.error })
    res.json({ ok: true, ...result.data })
  } catch (e: any) {
    res.json({ ok: false, error: e?.message })
  }
})

  const publicDir = path.join(__dirname, 'public')
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next()
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
