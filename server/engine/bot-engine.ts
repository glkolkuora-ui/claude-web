import { EventEmitter } from 'events'
import { StrategyEngine, StrategyConfig, Candle, StrategyEvent } from './strategies'
import { SdkBridge, TradeParams } from './sdk-bridge'
import { FEATURE_FLAGS } from './feature-flags'
import {
  describeTradeError,
  isBrokerOrderRejected,
  isInsufficientBalanceError,
  isM1UnavailableError,
  serializeTradeError,
} from './trade-errors'
import {
  trackBotStart,
  trackBotStop,
  trackTrade,
  trackTradeResult,
  trackError,
} from './telemetry'
import { logTime, tApp } from './locale'

export interface BotConfig {
  activeId: number
  activeTicker: string
  instrument: 'binary' | 'digital'
  balanceId: number
  entryAmount: number
  strategies: StrategyConfig
  stopLoss: number
  stopWin: number
  stopConsecLosses: number
  // Gale
  galeEnabled: boolean
  galeRounds: number
  // Soros
  sorosEnabled: boolean
  /** Quantas entradas em cadeia com reinvestimento (100% do lucro do win anterior). */
  sorosMaxLevel: number
}

export interface TradeRecord {
  id: string; strategy: string; direction: 'CALL' | 'PUT'
  amount: number; enteredAt: number; result: 'WIN' | 'LOSS' | 'PENDING'; profit: number
}

export interface BotStatus {
  running: boolean; activeId: number; activeTicker: string; instrument: string
  balanceStart: number; balanceCurrent: number; totalPnl: number
  wins: number; losses: number; consecLosses: number; winRate: number
  trades: TradeRecord[]
  /** Moeda da conta em uso (ex.: 'BRL', 'USD') — p/ formatar valores na UI. */
  currency: string
  balanceId: number
}

export class BotEngine extends EventEmitter {
  constructor(private readonly sdk: SdkBridge) {
    super()
  }

  private config: BotConfig | null = null
  private engine: StrategyEngine | null = null
  private running = false
  private balanceStart = 0
  private balanceCurrent = 0
  private wins = 0; private losses = 0; private consecLosses = 0
  private trades: TradeRecord[] = []
  private pendingTrades = new Map<number, string>()
  private unsubCandles: (() => void) | null = null
  private unsubPositions: (() => void) | null = null
  // Gale
  private simGaleStep = 0
  // Soros (100% do lucro; níveis configuráveis)
  private pendingSorosAdd = 0
  /** Profundidade atual da cadeia (1 = próximo win ainda pode estender até sorosMaxLevel). */
  private sorosChainTier = 0
  private warming = true
  private openTradeId: string | null = null
  private openTradeStrategy: string | null = null
  private openTradeTimeout: ReturnType<typeof setTimeout> | null = null
  /** Impede entradas concorrentes enquanto placeTrade está em voo. */
  private entryInFlight = false
  /** Retry HARD após rejeição transitória (máx. HARD_MAX_RETRIES). */
  private pendingHardTimer: ReturnType<typeof setTimeout> | null = null
  private hardRetryCount = 0
  /** Entrar na janela segura da próxima vela (1,5–4,5s após :00). */
  private static readonly HARD_SAFE_ENTRY_MS = 1_800
  private static readonly HARD_MAX_RETRIES = 3
  private paused = false
  private openTradeIdSnapshot: string | null = null
  /** Moeda da conta selecionada — capturada no start p/ formatar a UI. */
  private currency = 'USD'
  /** Buffer de velas do gráfico (histórico + ao vivo), p/ repovoar quando o
   *  componente do gráfico remonta (troca de aba). Keyed por `from` (segundos). */
  private chartCandles = new Map<number, Candle>()
  private static readonly CHART_BUFFER_MAX = 1500

  async start(config: BotConfig, currentBalance: number): Promise<void> {
    if (this.running) throw new Error(tApp('botAlreadyRunning'))
    if (
      config.strategies.hard &&
      (config.strategies.q5 || config.strategies.alt || config.strategies.last2)
    ) {
      throw new Error(tApp('hardConflict'))
    }
    this.config = config
    this.running = true
    this.currency = this.sdk.getBalanceSnapshot(config.balanceId)?.currency ?? 'USD'
    this.balanceStart = currentBalance
    this.balanceCurrent = currentBalance
    this.wins = this.losses = this.consecLosses = 0
    this.simGaleStep = 0
    this.pendingSorosAdd = 0
    this.sorosChainTier = 0
    this.trades = []
    this.pendingTrades.clear()
    this.openTradeId = null
    this.openTradeStrategy = null
    this.entryInFlight = false
    this.hardRetryCount = 0
    this.engine = new StrategyEngine(config.strategies)
    this.warming = true

    await this.resubscribeChartAndPositions()

    this.emit('started', this.getStatus())
    this.log(tApp('started'))

    trackBotStart({
      activeId:        config.activeId,
      activeTicker:    config.activeTicker,
      instrument:      config.instrument,
      strategies:      config.strategies,
      entryAmount:     config.entryAmount,
      galeEnabled:     config.galeEnabled,
      sorosEnabled:    config.sorosEnabled,
      sorosMaxLevel:   config.sorosMaxLevel,
      startingBalance: currentBalance,
      weekday:         new Date().getDay(),
      hourOfDay:       new Date().getHours(),
    })
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    this.engine?.reset()
    this.engine = null
    this.unsubCandles?.()
    this.unsubCandles = null
    this.unsubPositions?.()
    this.unsubPositions = null
    this.openTradeId = null
    this.openTradeStrategy = null
    this.entryInFlight = false
    this.hardRetryCount = 0
    if (this.openTradeTimeout) {
      clearTimeout(this.openTradeTimeout)
      this.openTradeTimeout = null
    }
    if (this.pendingHardTimer) {
      clearTimeout(this.pendingHardTimer)
      this.pendingHardTimer = null
    }
    this.paused = false
    this.openTradeIdSnapshot = null
    this.emit('stopped', this.getStatus())
    this.log(tApp('stopped'))

    trackBotStop('manual_or_stop', {
      wins:           this.wins,
      losses:         this.losses,
      consecLosses:   this.consecLosses,
      totalTrades:    this.wins + this.losses,
      endingBalance:  this.balanceCurrent,
      pnl:            this.balanceCurrent - this.balanceStart,
    })
  }

  pauseForSleep(): void {
    if (!this.running) return
    this.paused = true
    this.openTradeIdSnapshot = this.openTradeId
    if (this.openTradeTimeout) {
      clearTimeout(this.openTradeTimeout)
      this.openTradeTimeout = null
    }
    // Timer de retry cancelado sem ordem aberta → libera HARD na engine
    if (this.pendingHardTimer) {
      clearTimeout(this.pendingHardTimer)
      this.pendingHardTimer = null
      if (!this.openTradeId) {
        this.hardRetryCount = 0
        this.engine?.notifyHardOrderSettled()
      }
    }
    this.log(tApp('sleep'))
    this.emit('paused')
  }

  async resumeAfterSleep(): Promise<void> {
    if (!this.running || !this.paused) return
    this.paused = false
    this.log(tApp('resume'))
    try {
      await this.resubscribeChartAndPositions()
    } catch (e: any) {
      this.log(tApp('resubFail', { msg: e.message }))
    }
    if (this.openTradeIdSnapshot) {
      this.log(tApp('standbyTrade', { id: this.openTradeIdSnapshot }))
      const wasHard = this.openTradeStrategy === 'HARD'
      this.openTradeId = null
      this.openTradeStrategy = null
      this.openTradeIdSnapshot = null
      this.hardRetryCount = 0
      if (wasHard) this.engine?.notifyHardOrderSettled()
    }
    this.emit('resumed')
  }

  private async resubscribeChartAndPositions(): Promise<void> {
    if (!this.config) return
    this.unsubCandles?.()
    this.unsubCandles = null
    this.unsubPositions?.()
    this.unsubPositions = null

    this.unsubPositions = this.sdk.subscribePositions((ids, isWin, profit) => {
      this.onOrderSettled(ids, isWin, profit)
    })
    this.emit('chart_reset')
    this.chartCandles.clear()
    const historicalCandles: any[] = []
    this.warming = true
    this.unsubCandles = await this.sdk.subscribeCandles(
      this.config.activeId,
      (rawCandle, isLive) => {
        if (!isLive) {
          historicalCandles.push(rawCandle)
          return
        }
        if (this.warming) {
          for (const h of historicalCandles) this.chartCandles.set(h.from, h as Candle)
          this.emit('candles_history', historicalCandles)
          for (const h of historicalCandles) {
            this.replayHistoricalCandle(h)
          }
          this.warming = false
          this.log(tApp('warmup'))
        }
        this.handleLiveCandle(rawCandle)
      }
    )
  }

  isRunning() { return this.running }

  /** Snapshot das velas atuais do gráfico (ordenadas por tempo) para o
   *  renderer repovoar o gráfico ao remontar (ex.: voltar de outra aba). */
  getChartCandles(): Candle[] {
    return [...this.chartCandles.values()].sort((a, b) => a.from - b.from)
  }

  /** Replay histórico na engine (sem IPC). Enquanto `warming`, entradas ficam bloqueadas. */
  private replayHistoricalCandle(raw: { from: number; open: number; close: number; min: number; max: number }): void {
    if (!this.running || !this.engine || !this.config) return
    this.engine.process(raw as Candle)
  }

  /** Vela ao vivo: renderer (update) + estratégia. */
  private handleLiveCandle(raw: { from: number; open: number; close: number; min: number; max: number }): void {
    if (!this.running || !this.engine || !this.config || this.paused) return
    const candle: Candle = raw as Candle
    this.chartCandles.set(candle.from, candle)
    if (this.chartCandles.size > BotEngine.CHART_BUFFER_MAX) {
      const oldest = this.chartCandles.keys().next().value
      if (oldest !== undefined) this.chartCandles.delete(oldest)
    }
    this.emit('candle', candle)
    const events = this.engine.process(candle)
    for (const ev of events) {
      if (ev.type === 'enter') void this.onStrategyEnter(ev)
      else if (ev.type === 'result') this.onStrategyResult(ev)
      else if (ev.type === 'hard_stuck_recovered') {
        this.log(tApp('hardRecovered'))
        // A strategy já liberou hardTradeOpen; só limpa locks do bot.
        this.hardRetryCount = 0
        if (this.pendingHardTimer) {
          clearTimeout(this.pendingHardTimer)
          this.pendingHardTimer = null
        }
        if (this.openTradeId) {
          this.log(tApp('unlockStuck', { id: this.openTradeId }))
          this.openTradeId = null
          this.openTradeStrategy = null
          if (this.openTradeTimeout) {
            clearTimeout(this.openTradeTimeout)
            this.openTradeTimeout = null
          }
        }
      }
    }
  }

  private onStrategyResult(_ev: StrategyEvent): void {
    // Resultados simulados da engine; PnL real vem do broker em onOrderSettled
  }

  private computeStake(): number {
    if (!this.config) return 0
    const base = this.config.entryAmount
    const galeMultiplier = this.config.galeEnabled ? Math.pow(2, this.simGaleStep) : 1
    return base * galeMultiplier + this.pendingSorosAdd
  }

  private async onStrategyEnter(ev: StrategyEvent): Promise<void> {
    if (!this.config || !this.running || this.paused) return
    if (this.openTradeId || this.entryInFlight) {
      this.log(tApp('ignoredOpen', { strategy: ev.strategy ?? '', id: this.openTradeId ?? tApp('inFlight') }))
      return
    }

    // HARD: a strategy já dispara só na janela segura (0,5–4,5s da vela).
    // NÃO adiar para o :00 da próxima vela — isso causava rejeições 4009 em massa.
    if (ev.strategy === 'HARD' && this.pendingHardTimer) {
      this.log(tApp('hardRetryPending'))
      return
    }

    await this.executeEntry(ev)
  }

  /**
   * Reagenda HARD na janela segura da próxima vela (não no boundary :00).
   * Máximo HARD_MAX_RETRIES tentativas para não spammar a corretora.
   */
  private scheduleHardEntryRetry(ev: StrategyEvent, reason: string): void {
    if (this.pendingHardTimer) return

    if (this.hardRetryCount >= BotEngine.HARD_MAX_RETRIES) {
      this.log(tApp('hardGiveUp', { n: BotEngine.HARD_MAX_RETRIES, reason }))
      trackError(new Error(`HARD max retries: ${reason}`), {
        context: 'hard_max_retries',
        strategy: 'HARD',
        reason,
        active_ticker: this.config?.activeTicker,
      })
      this.hardRetryCount = 0
      this.engine?.notifyHardOrderSettled()
      return
    }

    this.hardRetryCount++
    const msToNext = 60_000 - (Date.now() % 60_000)
    const delay = msToNext + BotEngine.HARD_SAFE_ENTRY_MS
    this.log(tApp('hardRetryWait', {
      reason,
      n: this.hardRetryCount,
      max: BotEngine.HARD_MAX_RETRIES,
      sec: (delay / 1000).toFixed(1),
    }))

    this.pendingHardTimer = setTimeout(() => {
      this.pendingHardTimer = null
      if (!this.running || this.paused) {
        this.hardRetryCount = 0
        this.engine?.notifyHardOrderSettled()
        return
      }
      if (this.openTradeId || this.entryInFlight) {
        this.log(tApp('hardRetryDiscard'))
        return
      }
      void this.executeEntry(ev)
    }, delay)
  }

  private clearOpenTradeLock(reason?: string): void {
    const wasHard = this.openTradeStrategy === 'HARD'
    if (reason && this.openTradeId) {
      this.log(tApp('releasing', { reason, id: this.openTradeId }))
    }
    this.openTradeId = null
    this.openTradeStrategy = null
    if (this.openTradeTimeout) {
      clearTimeout(this.openTradeTimeout)
      this.openTradeTimeout = null
    }
    if (wasHard) this.engine?.notifyHardOrderSettled()
  }

  private async executeEntry(ev: StrategyEvent): Promise<void> {
    if (!this.config || !this.running || this.paused) return
    if (this.openTradeId || this.entryInFlight) return

    this.entryInFlight = true
    const stake = this.computeStake()
    const balanceSnap = this.sdk.getBalanceSnapshot(this.config.balanceId)
    const cur = balanceSnap?.currency ?? 'USD'
    this.log(tApp('entry', {
      strategy: ev.strategy ?? '',
      direction: ev.direction ?? '',
      ticker: this.config.activeTicker,
      stake: stake.toFixed(2),
      cur,
    }))
    try {
      const order = await this.sdk.placeTrade({
        activeId: this.config.activeId,
        direction: ev.direction!,
        amount: stake,
        balanceId: this.config.balanceId,
        instrument: this.config.instrument,
      }, { activeTicker: this.config.activeTicker })
      if (this.openTradeTimeout) {
        clearTimeout(this.openTradeTimeout)
        this.openTradeTimeout = null
      }
      this.openTradeId = order.id
      this.openTradeStrategy = ev.strategy ?? null
      this.hardRetryCount = 0
      this.openTradeTimeout = setTimeout(() => {
        if (this.openTradeId) {
          this.clearOpenTradeLock(tApp('timeout2min'))
        }
      }, 2 * 60_000)
      if (ev.enteredAt) this.pendingTrades.set(ev.enteredAt, order.id)
      const record: TradeRecord = {
        id: order.id, strategy: ev.strategy!, direction: ev.direction!,
        amount: stake, enteredAt: Date.now(), result: 'PENDING', profit: 0,
      }
      this.trades.unshift(record)
      this.emit('trade_entered', record)
      this.emitStatus()

      trackTrade({
        trade_id:      record.id,
        strategy:      record.strategy,
        direction:     record.direction,
        amount:        record.amount,
        active_ticker: this.config.activeTicker,
        instrument:    this.config.instrument,
        entered_at:    record.enteredAt,
      })
    } catch (err: unknown) {
      const detailedMsg = describeTradeError(err)
      const m1Unavailable = isM1UnavailableError(err)
      const brokerRejected = isBrokerOrderRejected(err)
      const insufficient = isInsufficientBalanceError(err)

      if (ev.strategy === 'HARD' && !insufficient && (m1Unavailable || brokerRejected)) {
        const reason = m1Unavailable ? tApp('reasonM1') : tApp('reasonRejected')
        this.log(tApp('entryRetry', { detail: detailedMsg, reason }))
        trackError(err, serializeTradeError(err, {
          context: 'executeEntry_hard_retry',
          strategy: ev.strategy,
          active_ticker: this.config.activeTicker,
          instrument: this.config.instrument,
          stake,
          retry: this.hardRetryCount,
        }))
        this.scheduleHardEntryRetry(ev, reason)
        return
      }

      this.log(tApp('entryFail', { detail: detailedMsg }))
      trackError(err, serializeTradeError(err, {
        context: 'executeEntry',
        strategy: ev.strategy,
        active_ticker: this.config.activeTicker,
        instrument: this.config.instrument,
        stake,
        balance_id: this.config.balanceId,
        balance_amount: balanceSnap?.amount ?? null,
        balance_currency: balanceSnap?.currency ?? null,
      }))
      if (ev.strategy === 'HARD') {
        this.hardRetryCount = 0
        this.engine?.notifyHardOrderSettled()
      }
    } finally {
      this.entryInFlight = false
    }
  }

  private onOrderSettled(ids: string[], isWin: boolean, profit: number): void {
    // Match relaxado: orderIds do close batem com buy().id; externalId = position.
    const trade = this.trades.find(t => ids.includes(t.id))
    const matchedLock = this.openTradeId !== null && ids.includes(this.openTradeId)

    if (!matchedLock && !trade) {
      // Posição fechou mas não tem nada a ver com este bot — ignora silencioso
      return
    }

    const strategy = trade?.strategy ?? this.openTradeStrategy

    if (matchedLock) {
      this.openTradeId = null
      this.openTradeStrategy = null
      if (this.openTradeTimeout) {
        clearTimeout(this.openTradeTimeout)
        this.openTradeTimeout = null
      }
    }

    if (!trade) {
      // Lock bateu sem registro — libera PnL e HARD para não travar o bot.
      if (matchedLock) {
        this.balanceCurrent += profit
        if (strategy === 'HARD') this.engine?.notifyHardOrderSettled()
        this.emitStatus()
      }
      return
    }
    trade.result = isWin ? 'WIN' : 'LOSS'
    trade.profit = profit
    this.balanceCurrent += profit

    if (isWin) {
      this.wins++
      this.consecLosses = 0
      this.simGaleStep = 0
      if (!FEATURE_FLAGS.SOROS_ENABLED || !this.config?.sorosEnabled) {
        this.pendingSorosAdd = 0
        this.sorosChainTier = 0
      } else {
        const maxL = Math.max(1, Math.min(3, this.config.sorosMaxLevel ?? 1))
        const boosted = this.pendingSorosAdd > 0
        if (!boosted) {
          this.pendingSorosAdd = profit
          this.sorosChainTier = 1
        } else if (this.sorosChainTier < maxL) {
          this.pendingSorosAdd = profit
          this.sorosChainTier += 1
        } else {
          this.pendingSorosAdd = 0
          this.sorosChainTier = 0
        }
      }
    } else {
      this.losses++
      this.consecLosses++
      this.pendingSorosAdd = 0
      this.sorosChainTier = 0
      if (this.config?.galeEnabled) {
        if (this.simGaleStep < (this.config.galeRounds ?? 2)) this.simGaleStep++
        else this.simGaleStep = 0
      } else {
        this.simGaleStep = 0
      }
    }

    this.log(tApp('result', {
      icon: isWin ? '✅' : '❌',
      result: isWin ? 'WIN' : 'LOSS',
      strategy: trade.strategy,
      direction: trade.direction,
      profit: `${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`,
    }))
    this.emit('trade_result', trade)
    if (trade.strategy === 'HARD') this.engine?.notifyHardOrderSettled()
    this.checkStops()
    this.emitStatus()

    trackTradeResult(trade.id, trade.result, profit)
  }

  private checkStops(): void {
    if (!this.config || !this.running) return
    const pnl = this.balanceCurrent - this.balanceStart
    if (this.config.stopLoss > 0 && pnl <= -this.config.stopLoss) {
      this.log(tApp('stopLoss', { pnl: pnl.toFixed(2) }))
      this.stop(); this.emit('stop_triggered', { reason: 'stop_loss', pnl }); return
    }
    if (this.config.stopWin > 0 && pnl >= this.config.stopWin) {
      this.log(tApp('stopWin', { pnl: pnl.toFixed(2) }))
      this.stop(); this.emit('stop_triggered', { reason: 'stop_win', pnl }); return
    }
    if (this.config.stopConsecLosses > 0 && this.consecLosses >= this.config.stopConsecLosses) {
      this.log(tApp('consecLosses', { n: this.consecLosses }))
      this.stop(); this.emit('stop_triggered', { reason: 'consec_losses', pnl: this.consecLosses })
    }
  }

  private log(msg: string) {
    this.emit('log', `[${logTime()}] ${msg}`)
  }
  private emitStatus() { this.emit('status', this.getStatus()) }

  getStatus(): BotStatus {
    const total = this.wins + this.losses
    return {
      running: this.running,
      activeId: this.config?.activeId ?? 0,
      activeTicker: this.config?.activeTicker ?? '',
      instrument: this.config?.instrument ?? 'binary',
      balanceStart: this.balanceStart,
      balanceCurrent: this.balanceCurrent,
      totalPnl: this.balanceCurrent - this.balanceStart,
      wins: this.wins, losses: this.losses, consecLosses: this.consecLosses,
      winRate: total > 0 ? Math.round((this.wins / total) * 100) : 0,
      trades: this.trades.slice(0, 50),
      currency: this.currency,
      balanceId: this.config?.balanceId ?? 0,
    }
  }
}
