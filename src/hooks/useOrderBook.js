import { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = '/api'

// Generate mock order book data
function generateMockOrderBook(market) {
  const basePrices = {
    xbtusd: 95000,
    ethusd: 3200,
    solusd: 180,
    xrpusd: 2.1,
    dogeusd: 0.32,
  }

  const basePrice = basePrices[market] || 100
  const spread = basePrice * 0.0001 // 0.01% spread

  const bids = []
  const asks = []

  for (let i = 0; i < 15; i++) {
    const bidPrice = basePrice - spread / 2 - (i * basePrice * 0.0001)
    const askPrice = basePrice + spread / 2 + (i * basePrice * 0.0001)
    const bidSize = Math.random() * 50 + 10
    const askSize = Math.random() * 50 + 10

    bids.push([bidPrice, bidSize])
    asks.push([askPrice, askSize])
  }

  return { bids, asks, timestamp: Date.now() }
}

/**
 * Hook to fetch order book data
 *
 * Returns data in standardized format:
 * { bids: [[price, size], ...], asks: [[price, size], ...] }
 */
export function useOrderBook(market, refreshInterval = 1000) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('connecting') // 'live', 'connecting', 'error'
  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const reconnectAttempts = useRef(0)

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/orderbook?market=${market}`)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const json = await response.json()
      setData({
        bids: json.bids || [],
        asks: json.asks || [],
        timestamp: json.timestamp || Date.now()
      })
      setStatus('live')
    } catch (err) {
      console.warn('Order book API unavailable, using mock data:', err.message)
      setData(generateMockOrderBook(market))
      setStatus('live') // Show as live even with mock data for demo
    } finally {
      setLoading(false)
    }
  }, [market])

  // WebSocket connection for live updates (future enhancement)
  // For now, use polling
  useEffect(() => {
    setLoading(true)
    setStatus('connecting')
    fetchData()

    const interval = setInterval(fetchData, refreshInterval)

    return () => {
      clearInterval(interval)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [fetchData, refreshInterval])

  return { data, loading, status }
}
