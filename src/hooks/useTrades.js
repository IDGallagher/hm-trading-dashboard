import { useState, useEffect, useCallback } from 'react'

const API_BASE = '/api'

// Generate mock trades data
function generateMockTrades(market, count = 50) {
  const basePrices = {
    xbtusd: 95000,
    ethusd: 3200,
    solusd: 180,
    xrpusd: 2.1,
    dogeusd: 0.32,
  }

  const basePrice = basePrices[market] || 100
  const trades = []
  const now = Math.floor(Date.now() / 1000)

  for (let i = 0; i < count; i++) {
    const time = now - (i * Math.floor(Math.random() * 10 + 1))
    const price = basePrice + (Math.random() - 0.5) * basePrice * 0.001
    const size = Math.random() * 10 + 0.1
    const side = Math.random() > 0.5 ? 'buy' : 'sell'

    trades.push({ time, price, size, side })
  }

  return trades.sort((a, b) => b.time - a.time)
}

/**
 * Hook to fetch recent trades data
 *
 * Returns data in standardized format:
 * [{ time, price, size, side }, ...]
 */
export function useTrades(market, period, refreshInterval = 5000) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      setError(null)

      const response = await fetch(`${API_BASE}/trades?market=${market}&period=${period}`)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const json = await response.json()

      // Transform API response to standardized format
      const trades = (json.trades || json.data || json).map(trade => ({
        time: trade.time || trade.timestamp,
        price: trade.price,
        size: trade.size || trade.quantity || trade.qty,
        side: trade.side || (trade.isBuyerMaker ? 'sell' : 'buy')
      }))

      setData(trades)
    } catch (err) {
      console.warn('Trades API unavailable, using mock data:', err.message)
      setData(generateMockTrades(market))
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
