import { randomBytes, randomUUID } from 'crypto'
import { WebSocket } from 'ws'
import { SdkBridge } from './engine/sdk-bridge'
import { BotEngine, type BotConfig } from './engine/bot-engine'
import { setAppLocale } from './engine/locale'
import { upsertUserByEmail } from './engine/db-ops'
import { setTelemetryUser, trackBalanceUpdate, trackError } from './engine/telemetry'

export interface Session {
  id: string
  sdk: SdkBridge
  bot: BotEngine
  email: string | null
  userId: string | null
  locale: string
  createdAt: number
  lastSeenAt: number
  verifier: string | null
  brokerLinked: boolean
  clients: Set<WebSocket>
  reconnectTimer: ReturnType<typeof setInterval> | null
}

const sessions = new Map<string, Session>()

function bindBot(session: Session): void {
  const emit = (channel: string, payload: unknown) => {
    const msg = JSON.stringify({ channel, payload })
    for (const ws of session.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg)
    }
  }

  session.bot.on('started', (s) => emit('bot:started', s))
  session.bot.on('stopped', (s) => emit('bot:stopped', s))
  session.bot.on('status', (s) => emit('bot:status', s))
  session.bot.on('trade_entered', (t) => emit('bot:trade_entered', t))
  session.bot.on('trade_result', (t) => emit('bot:trade_result', t))
  session.bot.on('stop_triggered', (d) => emit('bot:stop_triggered', d))
  session.bot.on('log', (m) => emit('bot:log', m))
  session.bot.on('error', (e) => emit('bot:error', e))
  session.bot.on('candle', (c) => emit('bot:candle', c))
  session.bot.on('candles_history', (h) => emit('bot:candles_history', h))
  session.bot.on('chart_reset', () => emit('bot:chart_reset', null))
}

function startReconnectWatch(session: Session): void {
  if (session.reconnectTimer) return
  session.reconnectTimer = setInterval(() => {
    if (!session.sdk.isConnected() && session.brokerLinked) {
      // Só tenta reconectar se já houve login (sdk já teve oauth).
      void session.sdk.reconnect().catch((err: Error) => {
        emitBrokerError(session, err.message)
        trackError(err, { context: 'web_reconnect' })
      })
    }
  }, 15_000)
  if (session.reconnectTimer.unref) session.reconnectTimer.unref()
}

function emitBrokerError(session: Session, message: string): void {
  const msg = JSON.stringify({ channel: 'broker:error', payload: message })
  for (const ws of session.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg)
  }
}

export function createSession(): Session {
  const id = randomUUID()
  const sdk = new SdkBridge()
  const bot = new BotEngine(sdk)
  const session: Session = {
    id,
    sdk,
    bot,
    email: null,
    userId: null,
    locale: 'pt',
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    verifier: null,
    brokerLinked: false,
    clients: new Set(),
    reconnectTimer: null,
  }
  bindBot(session)
  startReconnectWatch(session)
  sessions.set(id, session)
  return session
}

export function getSession(id: string | undefined | null): Session | null {
  if (!id) return null
  const s = sessions.get(id)
  if (s) s.lastSeenAt = Date.now()
  return s ?? null
}

export function newSessionIdFallback(): string {
  return randomBytes(16).toString('hex')
}

export function attachClient(session: Session, ws: WebSocket): void {
  session.clients.add(ws)
  ws.on('close', () => session.clients.delete(ws))
}

export async function setSessionEmail(session: Session, email: string): Promise<{ ok: boolean; userId?: string; error?: string }> {
  const clean = String(email ?? '').trim().toLowerCase()
  if (!clean) return { ok: false, error: 'empty_email' }
  session.email = clean
  session.sdk.setUserEmail(clean)
  try {
    session.userId = await upsertUserByEmail(clean)
    setTelemetryUser(session.userId)
    return { ok: true, userId: session.userId }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'unknown' }
  }
}

export function setSessionLocale(session: Session, locale: string): string {
  session.locale = locale
  return setAppLocale(locale)
}

export async function startBot(session: Session, config: BotConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const balances = await session.sdk.getBalances()
    const bal = balances.find((b) => b.id === config.balanceId)
    if (!bal) return { ok: false, error: 'Saldo não encontrado' }
    session.sdk.subscribeBalanceUpdate(config.balanceId, (amount) => {
      const msg = JSON.stringify({ channel: 'bot:balance', payload: amount })
      for (const ws of session.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg)
      }
      trackBalanceUpdate(amount, bal.currency)
    })
    await session.bot.start(config, bal.amount)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'unknown' }
  }
}

export async function stopBot(session: Session): Promise<{ ok: boolean; error?: string }> {
  try {
    await session.bot.stop()
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'unknown' }
  }
}

export function emitBrokerConnected(session: Session): void {
  const msg = JSON.stringify({ channel: 'broker:connected', payload: null })
  for (const ws of session.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg)
  }
}
