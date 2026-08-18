// ─── Types ────────────────────────────────────────────────────────────────────

export type Direction = 'CALL' | 'PUT'
export type StrategyName = 'Q5' | 'ALT' | 'LAST2' | 'HARD'

export interface Candle {
  from: number   // unix seconds
  open: number
  close: number
  min: number
  max: number
}

export interface StrategyEvent {
  type: 'enter' | 'result' | 'hard_stuck_recovered'
  strategy?: StrategyName
  direction?: Direction
  isWin?: boolean
  enteredAt?: number
}

export interface StrategyConfig {
  q5: boolean
  alt: boolean
  last2: boolean
  hard: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function quadrantStart(ts: number): number {
  return Math.floor(ts / 300) * 300
}

function posInQuadrant(ts: number): number {
  return Math.floor((ts - quadrantStart(ts)) / 60)
}

function isBull(c: Candle): boolean { return c.close > c.open }
function isBear(c: Candle): boolean { return c.close < c.open }
function isDoji(c: Candle): boolean { return c.close === c.open }
function isValid(c: Candle): boolean { return !isDoji(c) }

function resolveWin(direction: Direction, candle: Candle): boolean {
  if (direction === 'CALL') return candle.close >= candle.open  // doji conta como win para CALL
  return candle.close < candle.open                              // doji NÃO é win para PUT
}

// ─── Strategy Engine ──────────────────────────────────────────────────────────

export class StrategyEngine {
  private candles = new Map<number, Candle>()  // keyed by candle.from (seconds)

  // Shared cooldowns
  private lastEntryTime = 0   // ms
  private seenFromQ5 = new Set<number>()
  private seenFromAlt = new Set<number>()
  private seenFromLast2 = new Set<number>()

  // Q5
  private quadrantUsed = false
  private lastQuadrantStart = -1
  private q5Pending: { direction: Direction; enteredAt: number } | null = null

  // ALT
  private altCooldownUntil = 0   // ms
  private altPending: { direction: Direction; enteredAt: number } | null = null

  // LAST2
  private last2Pending: { direction: Direction; enteredAt: number } | null = null

  // HARD
  private hardTradeOpen = false
  private hardNextEntryTime = 0   // ms — próxima janela para nova entrada
  private hardLastResolution = 0  // ms
  private hardEnteredAt = 0
  private hardDirection: Direction | null = null
  private hardSeenFrom = new Set<number>()

  constructor(private config: StrategyConfig) {}

  updateConfig(config: StrategyConfig): void {
    this.config = config
  }

  // Feed a new (or updated) candle into the engine
  process(candle: Candle): StrategyEvent[] {
    const events: StrategyEvent[] = []
    const T = candle.from           // seconds
    const nowMs = Date.now()

    this.candles.set(T, candle)

    // ── HARD dominates when active ─────────────────────────────────────────
    if (this.config.hard) {
      const hardEvents = this.processHard(T, nowMs)
      events.push(...hardEvents)
      if (hardEvents.some(e => e.type === 'enter') || this.hardTradeOpen) {
        return events  // HARD blocks other strategies
      }
    }

    const pos = posInQuadrant(T)
    const qS = quadrantStart(T)

    // Reset quadrant state on new quadrant
    if (qS !== this.lastQuadrantStart) {
      this.quadrantUsed = false
      this.lastQuadrantStart = qS
      this.q5Pending = null
      // NOTE: we don't reset altPending here
    }

    const cooldownOk = (nowMs - this.lastEntryTime) >= 55_000

    // ── Resolve pending Q5 ─────────────────────────────────────────────────
    if (this.q5Pending && pos >= 4) {
      const resCandle = this.candles.get(qS + 180)
      if (resCandle) {
        const win = resolveWin(this.q5Pending.direction, resCandle)
        events.push({ type: 'result', strategy: 'Q5', direction: this.q5Pending.direction, isWin: win, enteredAt: this.q5Pending.enteredAt })
        this.q5Pending = null
      } else if (T >= this.q5Pending.enteredAt + 180) {
        this.q5Pending = null
      }
    }

    // ── Resolve pending ALT ────────────────────────────────────────────────
    if (this.altPending && T >= this.altPending.enteredAt + 60) {
      const resCandle = this.candles.get(this.altPending.enteredAt)
      if (resCandle) {
        const win = resolveWin(this.altPending.direction, resCandle)
        events.push({ type: 'result', strategy: 'ALT', direction: this.altPending.direction, isWin: win, enteredAt: this.altPending.enteredAt })
        this.altPending = null
        this.altCooldownUntil = nowMs + 90_000
      } else if (T >= this.altPending.enteredAt + 180) {
        this.altPending = null
      }
    }

    // ── Resolve pending LAST2 ──────────────────────────────────────────────
    if (this.last2Pending && pos >= 1) {
      const resCandle = this.candles.get(qS)
      if (resCandle) {
        const win = resolveWin(this.last2Pending.direction, resCandle)
        events.push({ type: 'result', strategy: 'LAST2', direction: this.last2Pending.direction, isWin: win, enteredAt: this.last2Pending.enteredAt })
        this.last2Pending = null
      } else if (T >= this.last2Pending.enteredAt + 120) {
        this.last2Pending = null
      }
    }

    // ── Q5 entry ───────────────────────────────────────────────────────────
    if (
      this.config.q5 &&
      cooldownOk &&
      pos === 3 &&
      !this.quadrantUsed &&
      !this.q5Pending &&
      !this.seenFromQ5.has(T)
    ) {
      const c0 = this.candles.get(qS)
      const c1 = this.candles.get(qS + 60)
      const c2 = this.candles.get(qS + 120)

      if (c0 && c1 && c2 && isValid(c0) && isValid(c1) && isValid(c2)) {
        const allBull = isBull(c0) && isBull(c1) && isBull(c2)
        const allBear = isBear(c0) && isBear(c1) && isBear(c2)

        if (allBull || allBear) {
          const direction: Direction = allBull ? 'PUT' : 'CALL'
          this.q5Pending = { direction, enteredAt: T }
          this.quadrantUsed = true
          this.lastEntryTime = nowMs
          this.seenFromQ5.add(T)
          events.push({ type: 'enter', strategy: 'Q5', direction, enteredAt: T })
        }
      }
    }

    // ── ALT entry ──────────────────────────────────────────────────────────
    if (
      this.config.alt &&
      cooldownOk &&
      !this.quadrantUsed &&
      !this.altPending &&
      nowMs > this.altCooldownUntil &&
      !this.seenFromAlt.has(T)
    ) {
      const c4 = this.candles.get(T - 240)
      const c3 = this.candles.get(T - 180)
      const c2 = this.candles.get(T - 120)
      const c1 = this.candles.get(T - 60)

      if (c4 && c3 && c2 && c1 && isValid(c4) && isValid(c3) && isValid(c2) && isValid(c1)) {
        const alternates =
          (isBull(c4) && isBear(c3) && isBull(c2) && isBear(c1)) ||
          (isBear(c4) && isBull(c3) && isBear(c2) && isBull(c1))

        if (alternates) {
          const direction: Direction = isBull(c1) ? 'PUT' : 'CALL'
          this.altPending = { direction, enteredAt: T }
          this.quadrantUsed = true
          this.lastEntryTime = nowMs
          this.seenFromAlt.add(T)
          events.push({ type: 'enter', strategy: 'ALT', direction, enteredAt: T })
        }
      }
    }

    // ── LAST2 entry ────────────────────────────────────────────────────────
    if (
      this.config.last2 &&
      cooldownOk &&
      pos === 0 &&
      !this.last2Pending &&
      !this.seenFromLast2.has(T)
    ) {
      const c1 = this.candles.get(T - 120)  // 4th candle of prev quadrant
      const c2 = this.candles.get(T - 60)   // 5th candle of prev quadrant

      if (c1 && c2 && isValid(c1) && isValid(c2)) {
        const bothBull = isBull(c1) && isBull(c2)
        const bothBear = isBear(c1) && isBear(c2)

        if (bothBull || bothBear) {
          const direction: Direction = bothBull ? 'PUT' : 'CALL'
          this.last2Pending = { direction, enteredAt: T }
          this.lastEntryTime = nowMs
          this.seenFromLast2.add(T)
          events.push({ type: 'enter', strategy: 'LAST2', direction, enteredAt: T })
        }
      }
    }

    return events
  }

  /** Agenda próxima entrada HARD em 25–70s (a partir de nowMs). */
  private scheduleNextHardEntry(nowMs: number): void {
    const delaySec = 25 + Math.random() * 45
    this.hardNextEntryTime = nowMs + delaySec * 1000
  }

  private processHard(T: number, nowMs: number): StrategyEvent[] {
    const events: StrategyEvent[] = []

    // Watchdog: trade stuck > 180s
    if (this.hardTradeOpen && nowMs - this.hardEnteredAt * 1000 > 180_000) {
      this.hardTradeOpen = false
      this.hardDirection = null
      this.hardEnteredAt = 0
      this.scheduleNextHardEntry(nowMs)
      events.push({ type: 'hard_stuck_recovered', strategy: 'HARD' })
    }

    if (this.hardTradeOpen) return events

    // Resolve if we have a result (60s after entry)
    if (this.hardDirection && this.hardEnteredAt > 0 && T >= this.hardEnteredAt + 60) {
      const resCandle = this.candles.get(this.hardEnteredAt)
      if (resCandle && !isDoji(resCandle)) {
        const win = resolveWin(this.hardDirection, resCandle)
        events.push({ type: 'result', strategy: 'HARD', direction: this.hardDirection, isWin: win, enteredAt: this.hardEnteredAt })
        this.hardTradeOpen = false
        this.hardDirection = null
        this.hardEnteredAt = 0
        this.scheduleNextHardEntry(nowMs)
      }
    }

    // New entry — só no início da vela: 500ms–4500ms após T (evita corrida no segundo 00)
    if (!this.hardTradeOpen && nowMs >= this.hardNextEntryTime && !this.hardSeenFrom.has(T)) {
      const candleAge = nowMs - T * 1000
      if (candleAge < 500) return events
      if (candleAge >= 4500) {
        this.hardSeenFrom.add(T)
        return events
      }
      this.hardSeenFrom.add(T)
      const direction: Direction = Math.random() < 0.5 ? 'CALL' : 'PUT'
      this.hardTradeOpen = true
      this.hardDirection = direction
      this.hardEnteredAt = T
      events.push({ type: 'enter', strategy: 'HARD', direction, enteredAt: T })
    }

    return events
  }

  // Call this when a real order settles (for HARD sync)
  notifyHardOrderSettled(): void {
    this.hardTradeOpen = false
    this.hardDirection = null
    this.hardEnteredAt = 0
    this.hardLastResolution = Date.now()
    this.scheduleNextHardEntry(Date.now())
  }

  reset(): void {
    this.candles.clear()
    this.lastEntryTime = 0
    this.seenFromQ5.clear()
    this.seenFromAlt.clear()
    this.seenFromLast2.clear()
    this.quadrantUsed = false
    this.lastQuadrantStart = -1
    this.q5Pending = null
    this.altCooldownUntil = 0
    this.altPending = null
    this.last2Pending = null
    this.hardTradeOpen = false
    this.hardNextEntryTime = 0
    this.hardLastResolution = 0
    this.hardEnteredAt = 0
    this.hardDirection = null
    this.hardSeenFrom.clear()
  }
}
