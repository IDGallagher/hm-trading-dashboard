import { useMemo } from 'react'

/**
 * Order Book Display Component
 *
 * Expected data format:
 * {
 *   bids: [[price, size], [price, size], ...],  // Sorted highest to lowest
 *   asks: [[price, size], [price, size], ...],  // Sorted lowest to highest
 *   timestamp: 1234567890
 * }
 */
export default function OrderBook({ data, loading = false, depth = 10 }) {
  const { bids, asks, spread, spreadPercent } = useMemo(() => {
    if (!data?.bids?.length || !data?.asks?.length) {
      return { bids: [], asks: [], spread: 0, spreadPercent: 0 }
    }

    const topBids = data.bids.slice(0, depth)
    const topAsks = data.asks.slice(0, depth)

    const bestBid = topBids[0]?.[0] || 0
    const bestAsk = topAsks[0]?.[0] || 0
    const spread = bestAsk - bestBid
    const spreadPercent = bestBid > 0 ? ((spread / bestBid) * 100).toFixed(4) : 0

    return {
      bids: topBids,
      asks: topAsks.reverse(), // Reverse so highest ask is at bottom (near spread)
      spread,
      spreadPercent
    }
  }, [data, depth])

  if (loading) {
    return (
      <div className="loading" style={{ height: 200 }}>
        <div className="spinner"></div>
      </div>
    )
  }

  if (!bids.length && !asks.length) {
    return (
      <div className="loading" style={{ height: 200 }}>
        <span>No order book data</span>
      </div>
    )
  }

  const formatPrice = (price) => {
    if (price >= 1000) return price.toFixed(1)
    if (price >= 1) return price.toFixed(2)
    return price.toFixed(6)
  }

  const formatSize = (size) => {
    if (size >= 1000000) return (size / 1000000).toFixed(2) + 'M'
    if (size >= 1000) return (size / 1000).toFixed(2) + 'K'
    return size.toFixed(2)
  }

  return (
    <div className="orderbook">
      <div className="orderbook-row orderbook-header">
        <span>Price</span>
        <span style={{ textAlign: 'right' }}>Size</span>
        <span style={{ textAlign: 'right' }}>Total</span>
      </div>

      {/* Asks (sells) - displayed top to bottom, lowest at bottom */}
      {asks.map(([price, size], i) => {
        const total = asks.slice(i).reduce((sum, [, s]) => sum + s, 0)
        return (
          <div key={`ask-${price}`} className="orderbook-row orderbook-ask">
            <span>{formatPrice(price)}</span>
            <span style={{ textAlign: 'right' }}>{formatSize(size)}</span>
            <span style={{ textAlign: 'right' }}>{formatSize(total)}</span>
          </div>
        )
      })}

      {/* Spread */}
      <div className="orderbook-spread">
        Spread: {formatPrice(spread)} ({spreadPercent}%)
      </div>

      {/* Bids (buys) - displayed top to bottom, highest at top */}
      {bids.map(([price, size], i) => {
        const total = bids.slice(0, i + 1).reduce((sum, [, s]) => sum + s, 0)
        return (
          <div key={`bid-${price}`} className="orderbook-row orderbook-bid">
            <span>{formatPrice(price)}</span>
            <span style={{ textAlign: 'right' }}>{formatSize(size)}</span>
            <span style={{ textAlign: 'right' }}>{formatSize(total)}</span>
          </div>
        )
      })}
    </div>
  )
}
