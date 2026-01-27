# Architecture

## Overview

Vanilla JavaScript dashboard for HM Trading system. Displays live BTC/USD order book, real-time candles from trading engine, and session management. Hosted on Cloudflare Pages.

**Live:** https://hm-trading-dashboard.pages.dev/

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

| Component | Purpose |
|-----------|---------|
| **Price Feed** | Live BTC/USD from BitMEX (refreshed real-time) |
| **Order Book** | Top 10 bid/ask levels (updated via WebSocket) |
| **Session Manager** | Create/manage trading sessions (test, backtest, market modes) |
| **Strategy Selector** | Choose trading bot (SDBot, SazBot, DivergeBot, PairTradeBot) |
| **Performance Metrics** | Display P&L, Sharpe ratio, win rate |

### Control API (Node.js + Express)

| Component | Purpose |
|-----------|---------|
| **Session Endpoints** | `/sessions` CRUD, mode control (/test/*, /backtest/*, /market/*) |
| **WebSocket Relay** | Forward C++ engine updates to browser clients |
| **MySQL Persistence** | Store trades, positions, metrics, events for historical analysis |
| **Trade Transformation** | Pair C++ OPEN/CLOSE into entry+exit objects for display |

### C++ Engine (4 Concurrent Strategies)

| Strategy | Trigger | Status |
|----------|---------|--------|
| **SDBot** | Bollinger Band divergence (±2.0 std) | Active |
| **SazBot** | Order book imbalance (ratio > 1.5) | Active |
| **DivergeBot** | Price ratio divergence | Active |
| **PairTradeBot** | Statistical arbitrage | Active |

## Data Flows

**Price & Order Book (Real-time):**
```
BitMEX WebSocket → C++ Engine (market mode) → Control API → Dashboard (wss://)
```

**Session Management:**
```
Dashboard → Control API (POST /sessions) → MySQL (session record)
User selects strategy + mode → Control API spawns C++ subprocess
C++ generates trades → Stored in MySQL → Dashboard queries via REST
```

**Market Data Modes:**

| Mode | Source | Use Case |
|------|--------|----------|
| **live** | BitMEX mainnet | Real trading (currently inactive) |
| **test** | BitMEX testnet | Paper trading verification |
| **backtest** | S3 FlatBuffer archives | Historical simulation |
| **market** | BitMEX mainnet (3 services) | 24/7 data collection |

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

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Frontend** | Vanilla JS, Lightweight Charts (TradingView) |
| **Hosting** | Cloudflare Pages (auto-deploy on push) |
| **Control API** | Node.js + Express, MySQL |
| **Trading Engine** | C++20, BitMEX WebSocket, FlatBuffer archives |
| **Data Storage** | MySQL (trades, sessions), S3 (market data archives) |
