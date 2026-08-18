import type { TradeRecord } from '../types'
import { formatCurrency } from '../lib/currency'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  trades: TradeRecord[]
  currency?: string
}

function timeStr(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function TradeLog({ trades, currency = 'USD' }: Props) {
  const { t, bcp47 } = useI18n()
  return (
    <div className="tradelog">
      <div className="tradelog-header">{t('trades.title')}</div>
      <div className="tradelog-body">
        {trades.length === 0 ? (
          <div className="tradelog-empty">{t('trades.empty')}</div>
        ) : (
          trades.map((t) => (
            <div key={t.id} className={`trade-row ${t.result.toLowerCase()}`}>
              <div className="trade-left">
                <span className={`direction-badge ${t.direction.toLowerCase()}`}>
                  {t.direction}
                </span>
                <span className="strategy-tag">{t.strategy}</span>
              </div>
              <div className="trade-center">
                <span className={`result-tag ${t.result.toLowerCase()}`}>
                  {t.result === 'PENDING' ? '⏳' : t.result === 'WIN' ? '✓' : '✗'}
                  {' '}{t.result}
                </span>
              </div>
              <div className="trade-right">
                {t.result !== 'PENDING' && (
                  <span className={`profit-val ${t.profit >= 0 ? 'win' : 'loss'}`}>
                    {t.profit >= 0 ? '+' : ''}{formatCurrency(t.profit, currency)}
                  </span>
                )}
                <span className="trade-time">{timeStr(t.enteredAt, bcp47)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
