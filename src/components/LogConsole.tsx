import { useRef, useEffect } from 'react'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  logs: string[]
}

export default function LogConsole({ logs }: Props) {
  const { t } = useI18n()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="log-console">
      <div className="log-header">{t('log.title')}</div>
      <div className="log-body">
        {[...logs].reverse().map((line, i) => {
          const isWin = line.includes('WIN') || line.includes('✅')
          const isLoss = line.includes('LOSS') || line.includes('❌')
          const isStop = line.includes('Stop') || line.includes('🛑') || line.includes('🏆')
          const isEntry = line.includes('ENTRADA') || line.includes('📍')
          return (
            <div key={i} className={`log-line ${isWin ? 'win' : isLoss ? 'loss' : isStop ? 'warning' : isEntry ? 'entry' : ''}`}>
              {line}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
