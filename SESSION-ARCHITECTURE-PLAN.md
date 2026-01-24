# Session Architecture Implementation Plan

## Overview

Enable multiple parallel trading sessions with full lifecycle management, persistent history, and a modern dashboard UI.

---

## 1. Database Schema

### 1.1 Sessions Table

```sql
CREATE TABLE sessions (
  -- Identity
  id VARCHAR(36) PRIMARY KEY,           -- UUID
  name VARCHAR(255),                    -- User-friendly name (auto or custom)

  -- Type & Configuration
  type ENUM('test', 'backtest', 'scraper') NOT NULL,
  market VARCHAR(20) NOT NULL,          -- 'XBTUSD', 'ETHUSD', etc.
  exchange VARCHAR(50) DEFAULT 'bitmex',
  strategy VARCHAR(100) NOT NULL,       -- 'TestBot', 'PairTradeBot', etc.
  strategy_params JSON,                 -- {"param1": value, "param2": value}

  -- Time Range (for backtests)
  range_start BIGINT,                   -- Unix timestamp (backtest start)
  range_end BIGINT,                     -- Unix timestamp (backtest end)

  -- Lifecycle
  status ENUM('created', 'running', 'stopped', 'completed', 'failed') DEFAULT 'created',
  pid INT,                              -- OS process ID when running

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  stopped_at TIMESTAMP NULL,

  -- Results (updated as session runs)
  trade_count INT DEFAULT 0,
  total_pnl DECIMAL(20,8) DEFAULT 0,
  win_rate DECIMAL(5,2) DEFAULT 0,
  max_drawdown DECIMAL(10,4) DEFAULT 0,

  -- File references
  trades_file VARCHAR(500),             -- Path to trades JSON file
  logs_file VARCHAR(500),               -- Path to bot output log

  -- Metadata
  cloned_from VARCHAR(36),              -- Parent session if cloned
  notes TEXT,                           -- User notes

  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_created (created_at DESC),
  FOREIGN KEY (cloned_from) REFERENCES sessions(id) ON DELETE SET NULL
);
```

### 1.2 Strategies Table (Reference Data)

```sql
CREATE TABLE strategies (
  id VARCHAR(50) PRIMARY KEY,           -- 'TestBot', 'PairTradeBot'
  name VARCHAR(100) NOT NULL,           -- Display name
  description TEXT,
  supported_types JSON,                 -- ['test', 'backtest']
  supported_markets JSON,               -- ['XBTUSD', 'ETHUSD'] or ['*']
  default_params JSON,                  -- Default parameter values
  param_schema JSON,                    -- JSON Schema for params validation
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed data
INSERT INTO strategies (id, name, description, supported_types, supported_markets, default_params, param_schema) VALUES
('TestBot', 'Test Bot', 'Simple test strategy for single market',
 '["test", "backtest"]', '["XBTUSD", "ETHUSD", "SOLUSD"]',
 '{"threshold": 0.5, "position_size": 100}',
 '{"type":"object","properties":{"threshold":{"type":"number","min":0,"max":1},"position_size":{"type":"integer","min":1}}}'),

('PairTradeBot', 'Pair Trade Bot', 'Statistical arbitrage between two markets',
 '["test", "backtest"]', '["XBTUSD+ETHUSD", "XBTUSD+SOLUSD"]',
 '{"spread_threshold": 2.0, "lookback": 100}',
 '{"type":"object","properties":{"spread_threshold":{"type":"number"},"lookback":{"type":"integer"}}}'),

('MarketScraper', 'Market Scraper', 'Collects market data without trading',
 '["scraper"]', '["*"]',
 '{"archive_interval": 60}',
 '{"type":"object","properties":{"archive_interval":{"type":"integer","min":1}}}');
```

### 1.3 Session Events Table (Audit Log)

```sql
CREATE TABLE session_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  event_type ENUM('created', 'started', 'stopped', 'trade', 'error', 'metric_update'),
  event_data JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_session (session_id),
  INDEX idx_created (created_at),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

---

## 2. API Endpoints

### 2.1 Session CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sessions` | List all sessions with filters |
| `POST` | `/sessions` | Create a new session |
| `GET` | `/sessions/:id` | Get session details |
| `PATCH` | `/sessions/:id` | Update session (name, notes) |
| `DELETE` | `/sessions/:id` | Delete session (only if stopped) |

### 2.2 Session Lifecycle

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions/:id/start` | Start a session |
| `POST` | `/sessions/:id/stop` | Stop a running session |
| `POST` | `/sessions/:id/clone` | Clone session config to new session |

### 2.3 Session Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sessions/:id/trades` | Get trades for session |
| `GET` | `/sessions/:id/metrics` | Get detailed metrics |
| `GET` | `/sessions/:id/equity` | Get equity curve data |
| `GET` | `/sessions/:id/logs` | Get bot output logs |

### 2.4 Reference Data

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/strategies` | List available strategies |
| `GET` | `/strategies/:id` | Get strategy details with param schema |
| `GET` | `/markets` | List available markets |

### 2.5 Endpoint Details

#### GET /sessions
```
Query params:
  ?status=running,completed    (comma-separated, optional)
  ?type=test,backtest          (comma-separated, optional)
  ?market=XBTUSD               (optional)
  ?limit=50                    (default: 50, max: 200)
  ?offset=0                    (for pagination)
  ?sort=created_at:desc        (field:direction)

Response:
{
  "success": true,
  "sessions": [
    {
      "id": "uuid-here",
      "name": "BTC Test #1",
      "type": "test",
      "market": "XBTUSD",
      "strategy": "TestBot",
      "status": "running",
      "created_at": 1706000000,
      "started_at": 1706000100,
      "trade_count": 15,
      "total_pnl": 245.50,
      "win_rate": 60.0
    },
    ...
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

#### POST /sessions
```
Request body:
{
  "name": "My BTC Test",        // optional, auto-generated if omitted
  "type": "test",               // required: test, backtest, scraper
  "market": "XBTUSD",           // required
  "strategy": "TestBot",        // required
  "strategy_params": {          // optional, uses defaults if omitted
    "threshold": 0.3,
    "position_size": 50
  },
  "range_start": 1705000000,    // required for backtest
  "range_end": 1706000000,      // required for backtest
  "notes": "Testing new params" // optional
}

Response:
{
  "success": true,
  "session": {
    "id": "new-uuid",
    "name": "My BTC Test",
    "type": "test",
    "status": "created",
    ...
  }
}
```

#### POST /sessions/:id/start
```
Response:
{
  "success": true,
  "session": {
    "id": "uuid",
    "status": "running",
    "pid": 12345,
    "started_at": 1706000100
  }
}
```

#### POST /sessions/:id/clone
```
Request body (optional overrides):
{
  "name": "Clone of Test #1",
  "strategy_params": { ... }    // override params
}

Response:
{
  "success": true,
  "session": {
    "id": "new-clone-uuid",
    "cloned_from": "original-uuid",
    "status": "created",
    ...
  }
}
```

---

## 3. UI Wireframe - Your Bots Section

### 3.1 Main Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Running Sessions]  [Scrapers]  [History]                    [+ New Session]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RUNNING SESSIONS (3)                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ● BTC Test #1          TestBot    XBTUSD    00:45:32   15 trades    │   │
│  │   PnL: +$245.50 (60% win)                              [Stop] [View]│   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ ● ETH Backtest         PairBot    ETHUSD    Backtesting 45%...      │   │
│  │   Progress: 1,234 / 2,500 candles                      [Stop] [View]│   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ ● Market Scraper       Scraper    XBTUSD    02:15:00   Recording... │   │
│  │   Data points: 8,432                                   [Stop] [View]│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  PENDING / CREATED (1)                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ○ SOL Test Draft       TestBot    SOLUSD    Created 5m ago          │   │
│  │   Not started                                    [Start] [Edit] [×] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Create New Session Modal

```
┌───────────────────────────────────────────────────────────────┐
│  Create New Session                                       [×] │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  Session Type                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│  │  ◉ Live     │ │  ○ Backtest │ │  ○ Scraper  │             │
│  │    Test     │ │             │ │             │             │
│  └─────────────┘ └─────────────┘ └─────────────┘             │
│                                                               │
│  Market              Strategy                                 │
│  ┌──────────────┐    ┌──────────────────────┐                │
│  │ XBTUSD     ▼│    │ TestBot            ▼│                │
│  └──────────────┘    └──────────────────────┘                │
│                                                               │
│  ─── Strategy Parameters ───────────────────────────────────  │
│                                                               │
│  Threshold           Position Size                            │
│  ┌──────────────┐    ┌──────────────┐                        │
│  │ 0.5          │    │ 100          │                        │
│  └──────────────┘    └──────────────┘                        │
│                                                               │
│  ─── Date Range (Backtest only) ────────────────────────────  │
│                                                               │
│  Start Date              End Date                             │
│  ┌──────────────┐        ┌──────────────┐                    │
│  │ 2024-01-15   │        │ 2024-01-22   │                    │
│  └──────────────┘        └──────────────┘                    │
│                                                               │
│  Session Name (optional)                                      │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ My BTC Test                                             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│                              [Cancel]  [Create]  [Create & Start] │
└───────────────────────────────────────────────────────────────┘
```

### 3.3 History Tab

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Running Sessions]  [Scrapers]  [History]                    [+ New Session]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Filter: [All Types ▼] [All Markets ▼] [Last 7 days ▼]    🔍 Search...     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Name              Type      Market   Trades   PnL       Duration    │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ BTC Test #12      Test      XBTUSD   45       +$1,234   2h 15m  [↻][👁]│
│  │ ETH Backtest      Backtest  ETHUSD   128      -$456     --      [↻][👁]│
│  │ BTC Test #11      Test      XBTUSD   23       +$89      45m     [↻][👁]│
│  │ SOL Test          Test      SOLUSD   12       +$34      30m     [↻][👁]│
│  │ ...                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Showing 1-20 of 156                            [< Prev]  [1] [2] [3]  [Next >]│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Legend: [↻] = Clone  [👁] = View Details
```

### 3.4 Session Detail View (Modal or Slide-out Panel)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BTC Test #12                                              [Clone] [Close]  │
│  TestBot • XBTUSD • Completed                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─── METRICS ─────────────────────────────────────────────────────────┐   │
│  │                                                                      │   │
│  │   Total PnL        Win Rate        Trades       Max Drawdown        │   │
│  │   +$1,234.50       62.2%           45           -3.2%               │   │
│  │   ████████████     ████████░░      ██████       ███░░░░░            │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─── EQUITY CURVE ────────────────────────────────────────────────────┐   │
│  │                                                              ╱──    │   │
│  │                                                        ╱────╱       │   │
│  │                                              ╱────────╱             │   │
│  │                                    ╱────────╱                       │   │
│  │  ────────────────────────────────╱                                  │   │
│  │  $1.00 BTC                                              $1.0123 BTC │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─── TRADES ──────────────────────────────────────────────────────────┐   │
│  │  Time        Side    Entry      Exit       PnL        Duration      │   │
│  │  14:32:05    LONG    89,450    89,520    +$70.00      5m 23s       │   │
│  │  14:15:42    SHORT   89,600    89,550    +$50.00      12m 10s      │   │
│  │  13:45:00    LONG    89,400    89,380    -$20.00      8m 45s       │   │
│  │  ...                                                                │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [Parameters]  [Logs]                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.5 Scrapers Tab

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Running Sessions]  [Scrapers]  [History]                    [+ New Session]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ACTIVE SCRAPERS                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ● XBTUSD Scraper    Running 02:15:00    8,432 data points          │   │
│  │   Archive: /archive/xbtusd/2024-01-22/         [Stop] [View Data]   │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ ● ETHUSD Scraper    Running 02:15:00    7,891 data points          │   │
│  │   Archive: /archive/ethusd/2024-01-22/         [Stop] [View Data]   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  AVAILABLE MARKETS (not scraping)                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ○ SOLUSD     Last data: 2h ago                    [Start Scraping]  │   │
│  │ ○ XRPUSD     Last data: 1d ago                    [Start Scraping]  │   │
│  │ ○ DOGEUSD    No data                              [Start Scraping]  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Phases

### Phase 1: Database & API (Backend)
1. Create MySQL tables (sessions, strategies, session_events)
2. Add session CRUD endpoints to server.js
3. Modify /test/start, /market/start to create session records
4. Add session metrics updates during bot execution
5. Test all endpoints with curl

### Phase 2: Session List UI (Frontend)
1. Create new Your Bots section with tabs
2. Implement Running Sessions list
3. Add session status polling/WebSocket updates
4. Implement Start/Stop buttons

### Phase 3: Create Session Flow (Frontend)
1. Build Create Session modal
2. Load strategies and params from API
3. Form validation
4. Create + auto-start flow

### Phase 4: Session Detail View (Frontend)
1. Detail modal/panel
2. Metrics display
3. Equity curve chart
4. Trades table with pagination
5. Logs viewer

### Phase 5: History & Clone (Frontend)
1. History tab with filters/search
2. Pagination
3. Clone functionality
4. Delete confirmation

---

## 5. Migration Strategy

**Existing data handling:**
- Current `test_trades.json`, `backtest_trades.json` will become legacy files
- New sessions will use unique files: `trades_{session_id}.json`
- No migration needed for existing files (they'll remain accessible via old endpoints)

**Backward compatibility:**
- Keep existing `/session/test` and `/session/backtest` endpoints
- Add deprecation notice in response
- Point to new `/sessions` endpoint

---

## 6. Open Questions

1. **Session Limits:** Max concurrent sessions per type? (recommend: 3 test, 1 backtest, 5 scrapers)
2. **Auto-cleanup:** Delete sessions older than X days? Archive to cold storage?
3. **Permissions:** Any auth/user system planned? Or single-user?
4. **Notifications:** WebSocket push for session status changes? Trade alerts?

---

*Plan created: 2024-01-24*
*Ready for review and approval before implementation*
