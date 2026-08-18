import { tApp } from './locale'
export class TradeOrderError extends Error {
  readonly code: string
  readonly status?: number
  readonly details?: unknown
  readonly context?: Record<string, unknown>

  constructor(
    message: string,
    opts?: {
      code?: string
      status?: number
      details?: unknown
      context?: Record<string, unknown>
    },
  ) {
    super(message)
    this.name = 'TradeOrderError'
    this.code = opts?.code ?? 'trade_error'
    this.status = opts?.status
    this.details = opts?.details
    this.context = opts?.context
  }
}

function extractDetailString(details: unknown): string | null {
  if (details == null) return null
  if (typeof details === 'string' && details.trim()) return details.trim()
  if (typeof details !== 'object') return null

  const d = details as Record<string, unknown>
  for (const key of ['message', 'error_description', 'error', 'reason']) {
    const v = d[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }

  if (Array.isArray(d.message)) {
    const joined = d.message.filter((x) => typeof x === 'string').join(' ')
    if (joined.trim()) return joined.trim()
  }

  return null
}

function readErrorStatus(err: unknown): number | undefined {
  const e = err as Record<string, unknown>
  const status = e?.status ?? e?.statusCode
  return typeof status === 'number' ? status : undefined
}

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

/** Mínimo estimado quando o SDK não expõe limites do ativo. */
export function minStakeForCurrency(currency?: string): number {
  const c = String(currency ?? 'USD').toUpperCase()
  if (c === 'BRL') return 2
  return 1
}

export function parseBrokerOrderError(
  err: unknown,
  context?: Record<string, unknown>,
): TradeOrderError {
  if (err instanceof TradeOrderError) {
    if (context && !err.context) {
      return new TradeOrderError(err.message, {
        code: err.code,
        status: err.status,
        details: err.details,
        context,
      })
    }
    return err
  }

  const status = readErrorStatus(err)
  const rawMessage = readErrorMessage(err)
  const details = (err as Record<string, unknown>)?.details
    ?? (err as Record<string, unknown>)?.msg
    ?? null
  const detailStr = extractDetailString(details)
  const msgLower = rawMessage.toLowerCase()

  const isRejected =
    status === 4009 ||
    (msgLower.includes('4009') && msgLower.includes('rejected')) ||
    msgLower.includes('rejected')

  if (isRejected) {
    return new TradeOrderError(
      detailStr ??
        tApp('brokerRejected'),
      {
        code: 'broker_rejected',
        status: status ?? 4009,
        details,
        context,
      },
    )
  }

  if (detailStr) {
    return new TradeOrderError(detailStr, {
      code: 'broker_error',
      status,
      details,
      context,
    })
  }

  return new TradeOrderError(rawMessage, {
    code: 'broker_error',
    status,
    details,
    context,
  })
}

export function formatTradeErrorForUser(err: unknown): string {
  if (err instanceof TradeOrderError) return err.message
  return readErrorMessage(err)
}

/**
 * Linha diagnóstica p/ o LOG: mensagem amigável + os dados técnicos exatos
 * (código, status HTTP/broker e detalhe cru da corretora). Serve para o usuário
 * printar o log e a gente saber a causa exata e como resolver.
 */
export function describeTradeError(err: unknown): string {
  const msg = formatTradeErrorForUser(err)
  const parts: string[] = []

  if (err instanceof TradeOrderError) {
    if (err.code) parts.push(`${tApp('errCode')}=${err.code}`)
    if (err.status != null) parts.push(`status=${err.status}`)
    const detail = extractDetailString(err.details)
    if (detail && detail !== msg) parts.push(`${tApp('errDetail')}="${detail}"`)
  } else {
    const status = readErrorStatus(err)
    if (status != null) parts.push(`status=${status}`)
    const raw = readErrorMessage(err)
    if (raw && raw !== msg) parts.push(`raw="${raw}"`)
    const detail = extractDetailString((err as Record<string, unknown>)?.details)
    if (detail && detail !== msg && detail !== readErrorMessage(err)) {
      parts.push(`${tApp('errDetail')}="${detail}"`)
    }
  }

  return parts.length ? `${msg} — [${parts.join(' · ')}]` : msg
}

export function isBrokerOrderRejected(err: unknown): boolean {
  if (err instanceof TradeOrderError) return err.code === 'broker_rejected'
  const status = readErrorStatus(err)
  const msg = readErrorMessage(err).toLowerCase()
  return status === 4009 || (msg.includes('4009') && msg.includes('rejected'))
}

export function isInsufficientBalanceError(err: unknown): boolean {
  return err instanceof TradeOrderError && err.code === 'insufficient_balance'
}

export function isM1UnavailableError(err: unknown): boolean {
  if (err instanceof TradeOrderError && err.code === 'm1_unavailable') return true
  const msg = formatTradeErrorForUser(err)
  return msg.includes('M1') && (
    msg.includes('Nenhum instrumento') ||
    msg.includes('No M1 instrument') ||
    msg.includes('Ningún instrumento')
  )
}

export function serializeTradeError(
  err: unknown,
  context?: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...context }

  if (err instanceof TradeOrderError) {
    base.message = err.message
    base.code = err.code
    if (err.status != null) base.status = err.status
    if (err.details != null) base.details = err.details
    if (err.context) base.trade_context = err.context
    if (err.stack) base.stack = err.stack
    return base
  }

  base.message = readErrorMessage(err)
  const status = readErrorStatus(err)
  if (status != null) base.status = status
  const details = (err as Record<string, unknown>)?.details
  if (details != null) base.details = details
  if (err instanceof Error && err.stack) base.stack = err.stack
  return base
}
