import type { BotStatus } from '../types'
import { formatCurrency } from '../lib/currency'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  status: BotStatus | null
  activeBalance: number
  currency?: string
}

export default function ScoreBoard({ status, activeBalance, currency = 'USD' }: Props) {
  const { t } = useI18n()
  const pnl = status?.totalPnl ?? 0
  const wins = status?.wins ?? 0
  const losses = status?.losses ?? 0
  const winRate = status?.winRate ?? 0
  const total = wins + losses
  const balanceCurrent = activeBalance || status?.balanceCurrent || 0

  return (
    <div className="scoreboard">
      <div className="sb-header">
        <span className="sb-title">{t('score.title')}</span>
        {status?.running && <span className="live-badge">{t('score.live')}</span>}
      </div>

      {/* PnL */}
      <div className="pnl-display">
        <span className={`pnl-value ${pnl > 0 ? 'win' : pnl < 0 ? 'loss' : ''}`}>
          {pnl >= 0 ? '+' : ''}{formatCurrency(pnl, currency)}
        </span>
        <span className="pnl-label">{t('score.pnl')}</span>
      </div>

      {/* Win/Loss bar */}
      <div className="wl-bar-wrap">
        <div className="wl-bar">
          <div
            className="wl-bar-fill win"
            style={{ width: total > 0 ? `${winRate}%` : '0%' }}
          />
        </div>
        <div className="wl-rate">{t('score.accuracy', { rate: winRate })}</div>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <div className="stat-cell">
          <div className="stat-value win">{wins}</div>
          <div className="stat-label">{t('score.wins')}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value loss">{losses}</div>
          <div className="stat-label">{t('score.losses')}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value">{total}</div>
          <div className="stat-label">{t('score.total')}</div>
        </div>
        <div className="stat-cell">
          <div className="stat-value warning">{status?.consecLosses ?? 0}</div>
          <div className="stat-label">{t('score.consec')}</div>
        </div>
      </div>

      {/* Balance */}
      {balanceCurrent > 0 && (
        <div className="balance-row">
          <span className="balance-label">{t('score.balance')}</span>
          <span className="balance-value">{formatCurrency(balanceCurrent, currency)}</span>
        </div>
      )}
    </div>
  )
}
