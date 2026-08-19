import { randomBytes, randomUUID } from 'crypto'
import { WebSocket } from 'ws'
import { SdkBridge } from './engine/sdk-bridge'
import { BotEngine, type BotConfig, type BotStatus } from './engine/bot-engine'
import { setAppLocale } from './engine/locale'
import { loadBrokerTokens, saveBrokerTokens, upsertUserByEmail, deleteBrokerTokens } from './engine/db-ops'
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
  reauthRequired: boolean
  clients: Set<WebSocket>
  reconnectTimer: ReturnType<typeof setInterval> | null
  wsTicket: string
  restorePromise: Promise<void> | null
}

const sessions = new Map<string, Session>()
const tickets = new Map<string, string>()

function bindTokenPersist(session: Session): void {
  session.sdk.onTokens((tokens) => {
    if (session.reauthRequired) return
    if (!session.userId || !tokens.accessToken) return
    void saveBrokerTokens(session.userId, tokens).catch((err) => {
      console.warn('[BROKER] falha ao gravar tokens:', err?.message ?? err)
    })
  })
}

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
    if (!session.sdk.isConnected() && session.brokerLinked && !session.reauthRequired) {
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
    reauthRequired: false,
    clients: new Set(),
    reconnectTimer: null,
    wsTicket: randomBytes(24).toString('hex'),
    restorePromise: null,
  }
  tickets.set(session.wsTicket, id)
  bindBot(session)
  bindTokenPersist(session)
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

export function getSessionByTicket(ticket: string | undefined | null): Session | null {
  if (!ticket) return null
  return getSession(tickets.get(ticket) ?? null)
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

export async function persistSessionTokens(session: Session): Promise<void> {
  if (session.reauthRequired || !session.userId) return
  const tokens = await session.sdk.exportTokens()
  if (!tokens?.accessToken) return
  await saveBrokerTokens(session.userId, tokens)
}

export async function ensureBroker(session: Session): Promise<void> {
  if (session.reauthRequired) return
  if (session.sdk.isConnected()) return
  if (session.restorePromise) return session.restorePromise
  session.restorePromise = (async () => {
    try {
      if (session.reauthRequired) return
      if (session.email && !session.userId) {
        await setSessionEmail(session, session.email)
      }
      if (session.reauthRequired) return
      if (await session.sdk.hasTokens()) {
        await session.sdk.reconnect()
        session.brokerLinked = true
        await persistSessionTokens(session)
        return
      }
      if (session.userId && session.email) {
        const stored = await loadBrokerTokens(session.userId)
        if (!stored) return
        if (session.reauthRequired) return
        session.sdk.setUserEmail(session.email)
        await session.sdk.restoreFromTokens(stored)
        await session.sdk.connect()
        session.brokerLinked = true
        await persistSessionTokens(session)
      }
    } finally {
      session.restorePromise = null
    }
  })()
  return session.restorePromise
}

export async function forgetBroker(session: Session): Promise<void> {
  session.reauthRequired = true
  session.brokerLinked = false
  if (session.restorePromise) {
    await session.restorePromise.catch(() => {})
  }
  if (session.email && !session.userId) {
    await setSessionEmail(session, session.email).catch(() => {})
  }
  if (session.userId) {
    await deleteBrokerTokens(session.userId).catch((err) => {
      console.warn('[BROKER] falha ao apagar tokens:', err?.message ?? err)
    })
  }
  await session.sdk.logout()
}

export async function startBot(session: Session, config: BotConfig): Promise<{ ok: boolean; error?: string; status?: BotStatus }> {
  try {
    console.log('[BOT] start', {
      activeId: config?.activeId,
      ticker: config?.activeTicker,
      balanceId: config?.balanceId,
      connected: session.sdk.isConnected(),
    })
    if (session.email && !session.userId) {
      await setSessionEmail(session, session.email)
    }
    if (!session.sdk.isConnected()) {
      await ensureBroker(session)
    }
    if (!session.sdk.isConnected()) {
      return { ok: false, error: 'Broker10 desconectada. Entre de novo com a corretora.' }
    }
    if (!config?.activeId || !config?.balanceId) {
      return { ok: false, error: 'Escolha o ativo e a conta antes de iniciar' }
    }
    if (session.bot.isRunning()) {
      console.log('[BOT] already running — syncing status')
      return { ok: true, status: session.bot.getStatus() }
    }
    const balances = await session.sdk.getBalances()
    const bal = balances.find((b) => String(b.id) === String(config.balanceId))
    if (!bal) return { ok: false, error: 'Saldo não encontrado. Reabra o painel e escolha a conta.' }
    session.sdk.subscribeBalanceUpdate(config.balanceId, (amount) => {
      const msg = JSON.stringify({ channel: 'bot:balance', payload: amount })
      for (const ws of session.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg)
      }
      trackBalanceUpdate(amount, bal.currency)
    })
    await session.bot.start(config, bal.amount)
    console.log('[BOT] started')
    return { ok: true, status: session.bot.getStatus() }
  } catch (e: any) {
    console.error('[BOT] start failed', e?.message ?? e)
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
