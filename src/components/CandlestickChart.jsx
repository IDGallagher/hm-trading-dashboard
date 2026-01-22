import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType } from 'lightweight-charts'

/**
 * Reusable Candlestick Chart Component
 *
 * Designed to work with:
 * - Live market data
 * - Test bot results (future)
 * - Backtest results (future)
 *
 * Expected data format (standardized):
 * {
 *   candles: [
 *     { time: 1234567890, open: 100, high: 110, low: 95, close: 105, volume: 1000 }
 *   ],
 *   markers: [  // Optional - for trade markers
 *     { time: 1234567890, position: 'belowBar', color: 'green', shape: 'arrowUp', text: 'Buy' }
 *   ]
 * }
 */
export default function CandlestickChart({
  data,
  loading = false,
  market,
  period,
  height = 400,
  showVolume = true,
  markers = []
}) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const candleSeriesRef = useRef(null)
  const volumeSeriesRef = useRef(null)

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8892b0',
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(0,212,255,0.3)', width: 1, style: 2 },
        horzLine: { color: 'rgba(0,212,255,0.3)', width: 1, style: 2 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.1)',
      },
      handleScroll: true,
      handleScale: true,
    })

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00c853',
      downColor: '#ff5252',
      borderUpColor: '#00c853',
      borderDownColor: '#ff5252',
      wickUpColor: '#00c853',
      wickDownColor: '#ff5252',
    })

    // Volume series (optional)
    let volumeSeries = null
    if (showVolume) {
      volumeSeries = chart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        scaleMargins: { top: 0.85, bottom: 0 },
      })
      volumeSeriesRef.current = volumeSeries
    }

    chartRef.current = chart
    candleSeriesRef.current = candleSeries

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: height,
        })
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
    }
  }, [height, showVolume])

  // Update data
  useEffect(() => {
    if (!candleSeriesRef.current || !data?.candles?.length) return

    const candles = data.candles.map(c => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    candleSeriesRef.current.setData(candles)

    // Set volume data
    if (volumeSeriesRef.current && showVolume) {
      const volumeData = data.candles.map(c => ({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(0,200,83,0.3)' : 'rgba(255,82,82,0.3)',
      }))
      volumeSeriesRef.current.setData(volumeData)
    }

    // Add markers if provided
    if (markers.length > 0 || data.markers?.length > 0) {
      const allMarkers = [...(markers || []), ...(data.markers || [])]
      candleSeriesRef.current.setMarkers(allMarkers)
    }

    // Fit content
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent()
    }
  }, [data, markers, showVolume])

  if (loading) {
    return (
      <div className="loading" style={{ height }}>
        <div className="spinner"></div>
      </div>
    )
  }

  if (!data?.candles?.length) {
    return (
      <div className="loading" style={{ height }}>
        <span>No data available</span>
      </div>
    )
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />
}
