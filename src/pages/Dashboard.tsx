import { useState, useEffect, useCallback, useRef } from 'react'
import type { BotStatus, BalanceInfo, TradeRecord, BotConfig } from '../types'
import ConfigPanel from '../components/ConfigPanel'
import ScoreBoard from '../components/ScoreBoard'
import TradeLog from '../components/TradeLog'
import LiveChart from '../components/LiveChart'
import LogConsole from '../components/LogConsole'
import { formatCurrency } from '../lib/currency'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  onDisconnect: () => void
}

export default function Dashboard({ onDisconnect }: Props) {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const [balances, setBalances] = useState<BalanceInfo[]>([])
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [activeBalance, setActiveBalance] = useState<number>(0)
  const [displayBalanceId, setDisplayBalanceId] = useState<number | null>(null)

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 200))
  }, [])

  const currency =
    status?.currency
    ?? balances.find(b => b.id === displayBalanceId)?.currency
    ?? balances.find(b => b.id === status?.balanceId)?.currency
    ?? balances.find(b => b.type === 'real')?.currency
    ?? balances[0]?.currency
    ?? 'USD'

  const currencyRef = useRef(currency)
  currencyRef.current = currency

  useEffect(() => {
    // Load initial data
    async function init() {
      setLoading(true)
      const bRes = await window.claudePro.sdkBalances()
      if (bRes.ok && bRes.balances) setBalances(bRes.balances)

      const s = await window.claudePro.botGetStatus()
      setStatus(s)
      setLoading(false)
    }
    init()

    // Subscribe to events
    const unsubs = [
      window.claudePro.on('bot:status',        (s) => setStatus(s)),
      window.claudePro.on('bot:started',       (s) => { setStatus(s); addLog(tRef.current('ops.logStarted')) }),
      window.claudePro.on('bot:stopped',       (s) => { setStatus(s); setDisplayBalanceId(null); addLog(tRef.current('ops.logStopped')) }),
      window.claudePro.on('bot:trade_entered', (tr: TradeRecord) =>
        addLog(tRef.current('ops.logEntry', { strategy: tr.strategy, direction: tr.direction, amount: formatCurrency(tr.amount, currencyRef.current) }))),
      window.claudePro.on('bot:trade_result',  (tr: TradeRecord) =>
        addLog(`[${tr.result}] ${tr.strategy} ${tr.direction} ${tr.profit >= 0 ? '+' : ''}${formatCurrency(tr.profit, currencyRef.current)}`)),
      window.claudePro.on('bot:stop_triggered',(d: any) => {
        const map: Record<string, 'ops.stopReason.stop_loss' | 'ops.stopReason.stop_win' | 'ops.stopReason.consec_losses'> = {
          stop_loss: 'ops.stopReason.stop_loss',
          stop_win: 'ops.stopReason.stop_win',
          consec_losses: 'ops.stopReason.consec_losses',
        }
        const reasonKey = map[String(d.reason)]
        addLog(tRef.current('ops.logStop', { reason: reasonKey ? tRef.current(reasonKey) : String(d.reason ?? '') }))
      }),
      window.claudePro.on('bot:log',           (m: string) => addLog(m)),
      window.claudePro.on('bot:balance',       (v: number) => setActiveBalance(v)),
      window.claudePro.on('bot:error',         (e: string) => addLog(tRef.current('ops.logError', { error: e }))),
    ]

    return () => unsubs.forEach(u => u())
  }, [addLog])

  async function handleStart(config: BotConfig) {
    setConfigOpen(false)
    const res = await window.claudePro.botStart(config)
    if (!res.ok) addLog(t('ops.logError', { error: res.error ?? '' }))
    else setDisplayBalanceId(config.balanceId)
  }

  async function handleStop() {
    await window.claudePro.botStop()
  }

  const isRunning = status?.running ?? false

  return (
    <div className="dashboard">
      {/* ── Top Bar ── */}
      <div className="topbar">
        <div className="topbar-logo">
          <span className="brand-claude">Claude</span>
          <span className="brand-pro">Pro</span>
        </div>

        <div className="topbar-pair">
          {isRunning && (
            <>
              <span className="pair-badge">{status?.activeTicker}</span>
              <span className="instrument-badge">{status?.instrument?.toUpperCase()}</span>
              <span className={`running-dot ${isRunning ? 'active' : ''}`} />
            </>
          )}
        </div>

        <div className="topbar-actions">
          {!isRunning ? (
            <button className="btn-start" onClick={() => setConfigOpen(true)} disabled={loading}>
              {t('ops.start')}
            </button>
          ) : (
            <button className="btn-stop" onClick={handleStop}>
              {t('ops.stop')}
            </button>
          )}
          <button className="btn-ghost-sm" onClick={onDisconnect}>{t('ops.disconnect')}</button>
        </div>
      </div>

      {/* ── Main Layout ── */}
      <div className="dashboard-body">

        {/* Left: Chart + Log */}
        <div className="dashboard-left">
          <LiveChart activeId={status?.activeId} activeTicker={status?.activeTicker} />
          <LogConsole logs={logs} />
        </div>

        {/* Right: Scoreboard + Trades */}
        <div className="dashboard-right">
          <ScoreBoard status={status} activeBalance={activeBalance} currency={currency} />
          <TradeLog trades={status?.trades ?? []} currency={currency} />
        </div>
      </div>

      {/* ── Config Modal ── */}
      {configOpen && (
        <ConfigPanel
          balances={balances}
          onStart={handleStart}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  )
}
