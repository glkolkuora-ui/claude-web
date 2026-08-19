import { useState, useEffect, useCallback, useRef } from 'react'
import type { BotStatus, BalanceInfo, TradeRecord, BotConfig } from '../types'
import ConfigPanel from '../components/ConfigPanel'
import ScoreBoard from '../components/ScoreBoard'
import TradeLog from '../components/TradeLog'
import LiveChart from '../components/LiveChart'
import LogConsole from '../components/LogConsole'
import { formatCurrency } from '../lib/currency'
import { useI18n } from '../i18n/I18nProvider'

export default function Operacoes() {
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const [balances, setBalances] = useState<BalanceInfo[]>([])
  const [status,   setStatus]   = useState<BotStatus | null>(null)
  const [logs,     setLogs]     = useState<string[]>([])
  const [loading,  setLoading]  = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [opsPane, setOpsPane] = useState<'chart' | 'panel'>('chart')
  const [activeBalance, setActiveBalance] = useState(0)
  const [displayBalanceId, setDisplayBalanceId] = useState<number | null>(null)

  const addLog = useCallback((msg: string) => setLogs(p => [msg, ...p].slice(0, 200)), [])

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
    async function init() {
      setLoading(true)
      const bRes = await window.claudePro.sdkBalances()
      if (bRes.ok && bRes.balances) setBalances(bRes.balances)
      setStatus(await window.claudePro.botGetStatus())
      setLoading(false)
    }
    init()

    const unsubs = [
      window.claudePro.on('session:hello', (p: { running?: boolean }) => {
        if (p?.running) {
          void window.claudePro.botGetStatus().then((s) => { if (s) setStatus(s) })
        }
      }),
      window.claudePro.on('bot:status',        s  => setStatus(s)),
      window.claudePro.on('bot:started',        s  => { setStatus(s); addLog(tRef.current('ops.logStarted')) }),
      window.claudePro.on('bot:stopped',        s  => { setStatus(s); setDisplayBalanceId(null); addLog(tRef.current('ops.logStopped')) }),
      window.claudePro.on('bot:trade_entered', (t: TradeRecord) =>
        addLog(tRef.current('ops.logEntry', { strategy: t.strategy, direction: t.direction, amount: formatCurrency(t.amount, currencyRef.current) }))),
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
    const poll = window.setInterval(() => {
      void window.claudePro.botGetStatus().then((s) => { if (s) setStatus(s) })
    }, 2000)
    return () => {
      unsubs.forEach(u => u())
      window.clearInterval(poll)
    }
  }, [addLog])

  async function handleStart(config: BotConfig) {
    setConfigOpen(false)
    const res = await window.claudePro.botStart(config)
    const statusRes = (res as any)?.status ?? await window.claudePro.botGetStatus()
    if (statusRes) setStatus(statusRes)
    if (!res.ok) addLog(t('ops.logError', { error: res.error ?? '' }))
    else setDisplayBalanceId(config.balanceId)
  }

  async function handleStop() {
    await window.claudePro.botStop()
    const s = await window.claudePro.botGetStatus()
    if (s) setStatus(s)
  }

  async function openConfig() {
    setLoading(true)
    try {
      const bRes = await window.claudePro.sdkBalances()
      if (bRes.ok && bRes.balances) setBalances(bRes.balances)
      else addLog(t('ops.logError', { error: bRes.error ?? 'Sem saldo da corretora' }))
    } finally {
      setLoading(false)
      setConfigOpen(true)
    }
  }

  const isRunning = status?.running ?? false

  return (
    <div className="operacoes">
      {/* Barra de controle */}
      <div className="operacoes-bar">
        <div className="operacoes-bar-left">
          {isRunning && (
            <>
              <span className="pair-badge">{status?.activeTicker}</span>
              <span className="instrument-badge">{status?.instrument?.toUpperCase()}</span>
              <span className="running-dot active" />
              <span className="live-badge">{t('ops.live')}</span>
            </>
          )}
          {!isRunning && <span className="bar-idle">{t('ops.idle')}</span>}
        </div>
        <div className="operacoes-bar-right">
          {!isRunning
            ? <button className="btn-start" onClick={() => void openConfig()} disabled={loading}>{t('ops.start')}</button>
            : <button className="btn-stop"  onClick={handleStop}>{t('ops.stop')}</button>
          }
        </div>
      </div>

      <div className="operacoes-mobile-tabs" role="tablist" aria-label={t('ops.panes')} data-pane={opsPane}>
        <button
          type="button"
          role="tab"
          aria-selected={opsPane === 'chart'}
          className={opsPane === 'chart' ? 'active' : ''}
          onClick={() => setOpsPane('chart')}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M2 12V8h2v4H2zm5 0V4h2v8H7zm5 0V6h2v6h-2z" fill="currentColor" />
          </svg>
          {t('ops.paneChart')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={opsPane === 'panel'}
          className={opsPane === 'panel' ? 'active' : ''}
          onClick={() => setOpsPane('panel')}
        >
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M2 2h5v5H2V2zm7 0h5v5H9V2zM2 9h5v5H2V9zm7 0h5v5H9V9z" fill="currentColor" />
          </svg>
          {t('ops.panePanel')}
        </button>
      </div>

      {/* Layout principal */}
      <div className={`operacoes-body operacoes-body--${opsPane}`}>
        <div className="operacoes-left">
          <LiveChart activeId={status?.activeId} activeTicker={status?.activeTicker} />
          <LogConsole logs={logs} />
        </div>
        <div className="operacoes-right">
          <ScoreBoard status={status} activeBalance={activeBalance} currency={currency} />
          <TradeLog trades={status?.trades ?? []} currency={currency} />
        </div>
      </div>

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
