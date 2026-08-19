import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { FEATURE_FLAGS } from './feature-flags'
import { ingestTelemetry } from './db-ops'

const FLUSH_MS = 5_000
const MAX_BATCH = 50
const MAX_QUEUE = 500

interface QueuedEvent {
  event_name: string
  event_data: Record<string, unknown> | null
  created_at: string
}

let queue: QueuedEvent[] = []
let flushTimer: NodeJS.Timeout | null = null
let currentUserId: string | null = null
let localFilePath: string | null = null

function getLocalFilePath(): string {
  if (localFilePath) return localFilePath
  const dir = process.env.DATA_DIR || path.join(os.tmpdir(), 'claude-web')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  localFilePath = path.join(dir, 'telemetry.jsonl')
  return localFilePath
}

function appendLocal(events: QueuedEvent[]): void {
  if (events.length === 0) return
  const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  try { fs.appendFileSync(getLocalFilePath(), lines, 'utf8') } catch (err) {
    console.error('[telemetry] falha ao gravar arquivo local:', err)
  }
}

async function flushRemote(events: QueuedEvent[]): Promise<boolean> {
  if (!currentUserId) return false
  try {
    const res = await ingestTelemetry(currentUserId, events)
    if (res.errors.length) console.warn('[telemetry] flush parcial:', res.errors)
    return res.processed > 0 || res.errors.length === 0
  } catch (err: any) {
    console.warn('[telemetry] flush remoto falhou:', err?.message ?? err)
    return false
  }
}

async function flush(): Promise<void> {
  if (queue.length === 0) return
  const batch = queue.splice(0, MAX_BATCH)
  if (currentUserId) {
    const sent = await flushRemote(batch)
    if (!sent) appendLocal(batch)
  } else {
    appendLocal(batch)
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setInterval(() => { void flush() }, FLUSH_MS)
  if (flushTimer.unref) flushTimer.unref()
}

export function setTelemetryUser(userId: string | null): void {
  currentUserId = userId
  if (userId) void flush()
}

export function trackEvent(name: string, data?: Record<string, unknown>): void {
  if (!FEATURE_FLAGS.TELEMETRY_ENABLED) return
  if (queue.length >= MAX_QUEUE) queue.shift()
  queue.push({
    event_name: name.slice(0, 100),
    event_data: data ?? null,
    created_at: new Date().toISOString(),
  })
  scheduleFlush()
}

export async function flushTelemetryNow(): Promise<void> {
  await flush()
}

let currentSessionId: string | null = null
let currentRunId: string | null = null

function newLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function trackSessionStart(): string {
  currentSessionId = newLocalId()
  trackEvent('session_start', {
    local_session_id: currentSessionId,
    app_version: process.env.npm_package_version ?? 'web',
    os_platform: 'web',
  })
  return currentSessionId
}

export function trackSessionEnd(): void {
  if (!currentSessionId) return
  trackEvent('session_end', { local_session_id: currentSessionId })
  currentSessionId = null
}

export function trackBotStart(config: Record<string, unknown>): string {
  currentRunId = newLocalId()
  trackEvent('bot_start', {
    local_run_id: currentRunId,
    local_session_id: currentSessionId,
    active_ticker: config.activeTicker ?? null,
    instrument: config.instrument ?? null,
    strategies: config.strategies ?? null,
    base_amount: config.entryAmount ?? null,
    account_type: config.accountType ?? null,
    starting_balance: config.startingBalance ?? null,
    weekday: config.weekday ?? new Date().getDay(),
    hour_of_day: config.hourOfDay ?? new Date().getHours(),
    raw_config: config,
  })
  return currentRunId
}

export function trackBotStop(reason: string, stats: Record<string, unknown>): void {
  trackEvent('bot_stop', {
    local_run_id: currentRunId,
    local_session_id: currentSessionId,
    stopped_reason: reason,
    wins: stats.wins ?? 0,
    losses: stats.losses ?? 0,
    total_trades: stats.totalTrades ?? 0,
    ending_balance: stats.endingBalance ?? null,
    pnl: stats.pnl ?? 0,
  })
  currentRunId = null
}

export function trackTrade(trade: Record<string, unknown>): void {
  const localId = String(trade.local_trade_id ?? trade.trade_id ?? newLocalId())
  trackEvent('trade_entered', {
    local_run_id: currentRunId,
    local_trade_id: localId,
    external_id: trade.trade_id ?? null,
    active_ticker: trade.active_ticker ?? null,
    instrument: trade.instrument ?? null,
    strategy: trade.strategy ?? null,
    direction: trade.direction ?? null,
    amount: trade.amount ?? null,
  })
}

export function trackTradeResult(tradeId: string, result: string, profit: number): void {
  trackEvent('trade_result', {
    local_run_id: currentRunId,
    local_trade_id: String(tradeId),
    result,
    profit,
  })
}

export function trackBalanceUpdate(amount: number, currency: string): void {
  trackEvent('balance_update', { local_run_id: currentRunId, amount, currency })
}

export function trackError(error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined
  const payload: Record<string, unknown> = { message, stack, ...context }
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    if (typeof e.code === 'string') payload.error_code = e.code
    if (typeof e.status === 'number') payload.error_status = e.status
    if (e.details != null) payload.error_details = e.details
  }
  trackEvent('error', payload)
}
