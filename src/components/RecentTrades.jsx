/**
 * Recent Trades Display Component
 *
 * Expected data format:
 * [
 *   { time: 1234567890, price: 100.5, size: 10, side: 'buy' | 'sell' },
 *   ...
 * ]
 */
export default function RecentTrades({ data, loading = false, limit = 20 }) {
  if (loading) {
    return (
      <div className="loading" style={{ height: 200 }}>
        <div className="spinner"></div>
      </div>
    )
  }

  if (!data?.length) {
    return (
      <div className="loading" style={{ height: 200 }}>
        <span>No trades data</span>
      </div>
    )
  }

  const formatTime = (timestamp) => {
    const date = new Date(timestamp * 1000)
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const formatPrice = (price) => {
    if (price >= 1000) return price.toFixed(1)
    if (price >= 1) return price.toFixed(2)
    return price.toFixed(6)
  }

  const formatSize = (size) => {
    if (size >= 1000) return (size / 1000).toFixed(2) + 'K'
    return size.toFixed(4)
  }

  const trades = data.slice(0, limit)

  return (
    <div className="trades-list">
      <div className="trade-row" style={{ color: '#8892b0', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '8px', paddingBottom: '8px' }}>
        <span>Time</span>
        <span style={{ textAlign: 'right' }}>Price</span>
        <span style={{ textAlign: 'right' }}>Size</span>
      </div>

      {trades.map((trade, i) => (
        <div
          key={`${trade.time}-${i}`}
          className={`trade-row trade-${trade.side}`}
        >
          <span className="trade-time">{formatTime(trade.time)}</span>
          <span style={{ textAlign: 'right' }}>{formatPrice(trade.price)}</span>
          <span style={{ textAlign: 'right' }}>{formatSize(trade.size)}</span>
        </div>
      ))}
    </div>
  )
}
