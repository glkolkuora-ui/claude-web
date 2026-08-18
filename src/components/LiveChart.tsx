import { useEffect, useRef } from 'react'
import {
  createChart,
  CandlestickSeries,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useI18n } from '../i18n/I18nProvider'

interface Props {
  activeId?: number
  activeTicker?: string
}

export default function LiveChart({ activeId, activeTicker }: Props) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)

  useEffect(() => {
    seriesRef.current?.setData([])
  }, [activeTicker])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current

    const readSize = () => {
      const r = el.getBoundingClientRect()
      return {
        width: Math.max(80, Math.floor(r.width)),
        height: Math.max(200, Math.floor(r.height)),
      }
    }

    const { width, height } = readSize()

    const chart = createChart(el, {
      layout: {
        background: { color: '#0d0f14' },
        textColor: '#6b7280',
      },
      grid: {
        vertLines: { color: '#1a1d26' },
        horzLines: { color: '#1a1d26' },
      },
      crosshair: {
        vertLine: { color: '#3b82f6' },
        horzLine: { color: '#3b82f6' },
      },
      rightPriceScale: {
        borderColor: '#1a1d26',
      },
      timeScale: {
        borderColor: '#1a1d26',
        timeVisible: true,
        // Zoom padrão "mais próximo": velas maiores. Como temos 6h de histórico,
        // esticar a janela preenche o vazio à esquerda com mais velas (sem gap).
        // O usuário pode dar zoom out no scroll quando quiser.
        barSpacing: 9,
        rightOffset: 4,
      },
      width,
      height,
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    })

    chartRef.current = chart
    seriesRef.current = series
    series.setData([])

    // Repovoa imediatamente ao montar (ex.: voltar de outra aba), pois o
    // evento de histórico só é emitido uma vez no aquecimento do bot.
    let cancelled = false
    void window.claudePro.botChartSnapshot?.().then((candles) => {
      if (cancelled || !seriesRef.current || !candles?.length) return
      seriesRef.current.setData(
        candles.map(c => ({
          time: c.from as UTCTimestamp,
          open: c.open,
          high: c.max,
          low: c.min,
          close: c.close,
        }))
      )
      chartRef.current?.timeScale().scrollToRealTime()
    }).catch(() => { /* sem snapshot ainda — segue com eventos ao vivo */ })

    const unsubHistory = window.claudePro.on('bot:candles_history', (candles: any[]) => {
      if (!seriesRef.current) return
      seriesRef.current.setData(
        (candles ?? []).map(c => ({
          time: c.from as UTCTimestamp,
          open: c.open,
          high: c.max,
          low: c.min,
          close: c.close,
        }))
      )
      // Ancora na vela mais recente mantendo o barSpacing padrão (não usa
      // fitContent p/ não achatar as velas espalhando as 6h inteiras).
      chartRef.current?.timeScale().scrollToRealTime()
    })

    const unsubCandle = window.claudePro.on('bot:candle', (c: any) => {
      if (!seriesRef.current) return
      seriesRef.current.update({
        time: c.from as UTCTimestamp,
        open: c.open,
        high: c.max,
        low: c.min,
        close: c.close,
      })
    })

    const unsubReset = window.claudePro.on('bot:chart_reset', () => {
      seriesRef.current?.setData([])
    })

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return
      const { width: w, height: h } = readSize()
      chartRef.current.applyOptions({ width: w, height: h })
    })
    resizeObserver.observe(el)

    return () => {
      cancelled = true
      unsubHistory()
      unsubCandle()
      unsubReset()
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  return (
    <div className="chart-wrap">
      <div className="chart-header">
        <span className="chart-pair">{activeTicker ?? '—'}</span>
        <span className="chart-tf">M1</span>
      </div>
      <div ref={containerRef} className="chart-container" />
      {!activeId && (
        <div className="chart-placeholder">
          {t('chart.startHint')}
        </div>
      )}
    </div>
  )
}
