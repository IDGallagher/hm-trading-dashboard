import { useState, useEffect } from 'react'
import CandlestickChart from './components/CandlestickChart'
import OrderBook from './components/OrderBook'
import RecentTrades from './components/RecentTrades'
import MarketSelector from './components/MarketSelector'
import PeriodSelector from './components/PeriodSelector'
import { usePriceData } from './hooks/usePriceData'
import { useOrderBook } from './hooks/useOrderBook'
import { useTrades } from './hooks/useTrades'

const MARKETS = [
  { id: 'xbtusd', name: 'BTC/USD', symbol: 'XBTUSD' },
  { id: 'ethusd', name: 'ETH/USD', symbol: 'ETHUSD' },
  { id: 'solusd', name: 'SOL/USD', symbol: 'SOLUSD' },
  { id: 'xrpusd', name: 'XRP/USD', symbol: 'XRPUSD' },
  { id: 'dogeusd', name: 'DOGE/USD', symbol: 'DOGEUSD' },
]

const PERIODS = [
  { id: '1m', name: '1 Min' },
  { id: '5m', name: '5 Min' },
  { id: '15m', name: '15 Min' },
  { id: '1h', name: '1 Hour' },
  { id: '4h', name: '4 Hour' },
  { id: '1d', name: '1 Day' },
  { id: '1w', name: '1 Week' },
]

function App() {
  const [market, setMarket] = useState(MARKETS[0])
  const [period, setPeriod] = useState(PERIODS[3]) // Default to 1h

  const { data: priceData, loading: priceLoading, error: priceError } = usePriceData(market.id, period.id)
  const { data: orderBookData, loading: orderBookLoading, status: orderBookStatus } = useOrderBook(market.id)
  const { data: tradesData, loading: tradesLoading } = useTrades(market.id, period.id)

  return (
    <div className="container">
      <header className="header">
        <h1>HM Trading Dashboard</h1>
        <p className="subtitle">Live Market Data & Analysis</p>
      </header>

      <div className="controls">
        <MarketSelector
          markets={MARKETS}
          selected={market}
          onChange={setMarket}
        />
        <PeriodSelector
          periods={PERIODS}
          selected={period}
          onChange={setPeriod}
        />
      </div>

      <div className="dashboard-grid">
        <div className="main-content">
          <div className="card">
            <div className="card-header">
              <span className="card-title">{market.name} - {period.name}</span>
              {priceError && <span className="badge badge-error">Error</span>}
            </div>
            <div className="chart-container">
              <CandlestickChart
                data={priceData}
                loading={priceLoading}
                market={market}
                period={period}
              />
            </div>
          </div>
        </div>

        <div className="sidebar">
          <div className="card">
            <div className="card-header">
              <span className="card-title">Order Book</span>
              <span className={`badge badge-${orderBookStatus}`}>
                {orderBookStatus === 'live' ? 'Live' : orderBookStatus === 'connecting' ? 'Connecting...' : 'Offline'}
              </span>
            </div>
            <OrderBook
              data={orderBookData}
              loading={orderBookLoading}
            />
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Recent Trades</span>
            </div>
            <RecentTrades
              data={tradesData}
              loading={tradesLoading}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
