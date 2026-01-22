# Architecture

## Overview

HM Trading Dashboard is a web-based interface for monitoring and testing cryptocurrency trading strategies. It connects to a C++ backend (new-hope) for real-time market data, strategy execution, and backtesting.

```
┌─────────────────────────────────────────────────────────────┐
│                    HM Trading Dashboard                      │
│                     (This Repository)                        │
├─────────────────────────────────────────────────────────────┤
│  Browser (index.html)                                        │
│  ├── Candlestick Charts (Lightweight Charts)                │
│  ├── Backtest View (results display)                        │
│  └── Live Test Controls (start/stop buttons)                │
└────────────────────┬────────────────────────────────────────┘
                     │ WebSocket + HTTP
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 C++ Backend (new-hope)                       │
│          github.com/IDGallagher/hm-trading-new-hope         │
├─────────────────────────────────────────────────────────────┤
│  ├── WebSocket Server (live candle updates)                 │
│  ├── REST API (backtest results, historical data)           │
│  ├── Strategy Engine (TestBot, PairTradeBot, etc.)          │
│  └── FlatBuffer Archive (historical market data)            │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Frontend (hm-trading-dashboard)

| Component | Responsibility |
|-----------|----------------|
| **index.html** | Main dashboard UI, chart rendering, WebSocket connection |
| **Candlestick Charts** | Display OHLCV data using Lightweight Charts library |
| **Backtest View** | Show backtest results, trades, P&L metrics |
| **Live Test Panel** | Start/stop live tests, view forming candles |

### Backend (hm-trading-new-hope)

| Component | Responsibility |
|-----------|----------------|
| **WebSocket Server** | Push live candle updates to dashboard |
| **REST API** | Serve backtest results and historical data |
| **Strategy Engine** | Execute trading strategies (TestBot, PairTradeBot) |
| **FlatBuffer Archive** | Store/retrieve historical market data efficiently |

## Data Flow

### Live Test Flow
```
1. User clicks "Start Test" in dashboard
2. Dashboard sends start command to backend via HTTP
3. Backend begins strategy execution
4. Backend pushes live candle updates via WebSocket (timestamps in ms)
5. Dashboard converts timestamps (ms → s) and renders candles
6. Live forming candle updates in real-time
```

### Backtest Flow
```
1. User initiates backtest in dashboard
2. Dashboard sends backtest request to backend via HTTP
3. Backend loads FlatBuffer archive data
4. Backend runs strategy against historical data
5. Backend returns results (trades, metrics) via HTTP
6. Dashboard displays results in Backtest View
```

### Test/Backtest Parity
- Live tests and backtests use identical strategy code
- Same data format ensures reproducible results
- Instant backtest creates backtest from live test data

## Technologies

### Frontend
| Technology | Purpose |
|------------|---------|
| **HTML/CSS/JS** | Core web technologies |
| **Lightweight Charts** | TradingView's charting library for candlesticks |
| **WebSocket API** | Real-time communication with backend |

### Backend
| Technology | Purpose |
|------------|---------|
| **C++** | High-performance strategy execution |
| **FlatBuffers** | Efficient binary serialization for market data |
| **WebSocket** | Push live updates to dashboard |
| **REST API** | Request/response for backtests and data queries |

### Data Storage
| Storage | Content |
|---------|---------|
| **FlatBuffer Archive** | Historical OHLCV data (16,697+ files) |
| **Strategy Configs** | Trading strategy parameters |

## Known Limitations

1. **Data Availability:** Only BTC/USD data is archived. Arbitrage strategies requiring BTC/USDT will produce 0 trades.

2. **Timestamp Format:** Backend sends milliseconds, frontend expects seconds. Conversion is handled in WebSocket handler.

3. **Single-Pair Strategies Only:** Until BTC/USDT data is archived, only single-pair strategies (TestBot) work for backtesting.
