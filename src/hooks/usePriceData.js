import { useState, useEffect, useCallback } from 'react'

const API_BASE = '/api'

// Generate mock data for development/demo
function generateMockCandles(market, period, count = 100) {
  const now = Math.floor(Date.now() / 1000)
  const periodSeconds = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
    '1w': 604800,
  }[period] || 3600

  const basePrices = {
    xbtusd: 95000,
    ethusd: 3200,
    solusd: 180,
    xrpusd: 2.1,
    dogeusd: 0.32,
  }

  const basePrice = basePrices[market] || 100
  const candles = []
  let currentPrice = basePrice

  for (let i = count - 1; i >= 0; i--) {
    const time = now - (i * periodSeconds)
    const volatility = basePrice * 0.02 // 2% volatility
    const change = (Math.random() - 0.5) * volatility
    currentPrice = Math.max(basePrice * 0.8, currentPrice + change)

    const open = currentPrice
    const close = open + (Math.random() - 0.5) * volatility * 0.5
    const high = Math.max(open, close) + Math.random() * volatility * 0.3
    const low = Math.min(open, close) - Math.random() * volatility * 0.3
    const volume = Math.random() * 1000000 + 100000

    candles.push({ time, open, high, low, close, volume })
  }

  return candles
}

/**
 * Hook to fetch price/candle data
 *
 * Returns data in standardized format:
 * { candles: [...], markers: [...] }
 */
export function usePriceData(market, period, refreshInterval = 60000) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      setError(null)

      const response = await fetch(`${API_BASE}/prices?market=${market}&period=${period}`)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const json = await response.json()

      // Transform API response to standardized format
      // Backend should return: { candles: [...] } or similar
      setData({
        candles: json.candles || json.data || json,
        markers: json.markers || []
      })
    } catch (err) {
      console.warn('API unavailable, using mock data:', err.message)
      // Use mock data when API is unavailable
      setData({
        candles: generateMockCandles(market, period),
        markers: []
      })
    } finally {
      setLoading(false)
    }
  }, [market, period])

  // Initial fetch
  useEffect(() => {
    setLoading(true)
    fetchData()
  }, [fetchData])

  // Periodic refresh
  useEffect(() => {
    const interval = setInterval(fetchData, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchData, refreshInterval])

  return { data, loading, error, refetch: fetchData }
}
