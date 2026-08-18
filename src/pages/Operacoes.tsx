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
    return () => unsubs.forEach(u => u())
  }, [addLog])

  async function handleStart(config: BotConfig) {
    setConfigOpen(false)
    const res = await window.claudePro.botStart(config)
    if (!res.ok) addLog(t('ops.logError', { error: res.error ?? '' }))
    else setDisplayBalanceId(config.balanceId)
  }

  async function handleStop() { await window.claudePro.botStop() }

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
            ? <button className="btn-start" onClick={() => setConfigOpen(true)} disabled={loading}>{t('ops.start')}</button>
            : <button className="btn-stop"  onClick={handleStop}>{t('ops.stop')}</button>
          }
        </div>
      </div>

      {/* Layout principal */}
      <div className="operacoes-body">
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
