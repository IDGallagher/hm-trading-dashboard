# Recent Events

## Latest Updates - January 23, 2026

### Bug Fixes Completed

| Bug | Root Cause | Fix | Commit |
|-----|------------|-----|--------|
| **#1 Periodic refresh too aggressive** | Chart refresh every 30s caused data loss and performance issues | Reduced refresh interval from 30s to 5 minutes | 096cbcb |
| **#2 4h candle zoom not scaling** | Zoom level was fixed regardless of candle period | Zoom now scales by candle period (1m, 5m, 1h, etc.) | 096cbcb |
| **#6 TestBot not generating trades** | Multiple issues: C++ binary needed rebuild, NDJSON parsing broken, field name mismatch | Rebuilt binary, fixed NDJSON line parsing, corrected field names | backend-dev |

### New Features

| Feature | Description | Commit |
|---------|-------------|--------|
| **#3 Historical data lazy loading** | Scroll left on chart to load older candles dynamically | 2df01e7 |
| **#4 Bot strategy descriptions** | Shows strategy description when a bot is selected | c2fd7bd |
| **#5 Chart indicator overlays** | EMA and Bollinger Bands per strategy (configurable per bot) | e5ec8aa |

### Verified Features

All 6 features verified by QA on January 23, 2026:

| Feature | Status | Notes |
|---------|--------|-------|
| #1 Periodic refresh (5 min) | ✅ Working | No more data loss from aggressive refresh |
| #2 4h candle zoom scaling | ✅ Working | Zoom adapts to candle period |
| #3 Historical lazy loading | ✅ Working | Scroll left loads older candles |
| #4 Bot descriptions | ✅ Working | All 5 strategies have descriptions |
| #5 Chart overlays | ✅ Working | EMA/Bollinger per strategy |
| #6 TestBot trades | ✅ Working | Trades generating correctly |

---

## Updates - January 22, 2026

### Bug Fixes Completed

| Bug | Root Cause | Fix | Fixed By |
|-----|------------|-----|----------|
| **Chart Y-axis scaling** | Y-axis not auto-scaling to data range | Updated chart options to use auto-scaling | chart-fix-dev |
| **Backtest producing 0 trades** | PairTradeBot requires BTC/USDT data (only BTC/USD available) | Changed to TestBot strategy which only needs BTC/USD | backtest-fix-dev |
| **Backtest view JS crash** | `.toFixed()` called on undefined value | Added null check before calling `.toFixed()` | ui-fix-dev |
| **Hidden Start Test button** | Button was not visible in UI | Fixed button visibility/styling | ui-fix-dev |
| **Live candle micro-candles** | WebSocket sends timestamps in milliseconds, chart expects seconds | Added ms → seconds conversion (÷1000) | candle-fix-dev |
| **X-axis showing raw numbers** | Same timestamp format mismatch | Same fix - ms → seconds conversion | candle-fix-dev |
| **Test runs completing instantly** | `/test/start` hardcoded to archive replay mode with fixed timestamps | Changed to `market` mode - connects to live BitMEX WebSocket, runs indefinitely | backend-dev |

### UI Improvements (commit bed3d75)

| Improvement | Before | After | Fixed By |
|-------------|--------|-------|----------|
| **Chart Title Dynamic Update** | Showed "DivergeBot P&L" regardless of strategy | Updates to `BTC/USD Price (1m) & {selectedStrategy} P&L` when strategy changes | backend-dev |
| **Error Toast Notifications** | Confusing `alert()` popups | New toast component (top-right), clear title + detailed message, auto-dismiss after 10s | backend-dev |
| **API Badge Clarification** | "Control API" (unclear) | "API Connected" with tooltip explaining backend purpose | backend-dev |
| **24h Percentage Label** | Unlabeled percentage next to price | Added "24h:" label for clarity | backend-dev |
| **Loading States** | No feedback when switching views | Added loading indicators during view transitions | backend-dev |

### Verified Milestones

All milestones verified by QA on January 22, 2026:

| Milestone | Status | Notes |
|-----------|--------|-------|
| FlatBuffer archiving | ✅ Working | 16,697 files archived |
| Test/Backtest parity | ✅ Working | Using TestBot strategy |
| Dashboard backtest view | ✅ Working | No JS errors |
| Candlestick charts | ✅ Working | Proper Y-axis scaling |
| Live Test → Instant Backtest | ✅ Working | Seamless transition |
| Live forming candle | ✅ Working | Correct timestamps |

## Incidents

### Timestamp Format Mismatch (Resolved)
- **Date:** January 22, 2026
- **Impact:** Live candles appeared as micro-candles, X-axis showed raw numbers
- **Root Cause:** WebSocket messages from C++ backend send timestamps in milliseconds, but the charting library expects Unix timestamps in seconds
- **Resolution:** Added `timestamp / 1000` conversion in frontend WebSocket handler

### Strategy Data Availability (Resolved)
- **Date:** January 22, 2026
- **Impact:** Backtests produced 0 trades
- **Root Cause:** PairTradeBot arbitrage strategy requires both BTC/USD and BTC/USDT data pairs, but only BTC/USD historical data is available
- **Resolution:** Switched to TestBot strategy which only requires single pair data

### Live WebSocket Test Mode (Resolved)
- **Date:** January 22, 2026
- **Impact:** Test runs completed in ~2 seconds instead of running indefinitely against live data
- **Root Cause:** `/test/start` endpoint was hardcoded to use archive replay mode:
  - Used fixed timestamps (`ARCHIVE_START`/`ARCHIVE_END`)
  - Called C++ binary with `--local-archive`, `--start`, `--end` flags
  - Replayed ~94 minutes of archived data instantly
- **Resolution:** Changed to use `market` mode:
  - Removed archive-related flags from C++ binary invocation
  - Test now connects to live BitMEX WebSocket
  - Runs indefinitely until manually stopped via `/test/stop`
  - Tracks wall clock start/end times for accurate backtest periods
- **Files Modified:**
  - `hm-trading-control-api/server.js` lines 221-307 (`/test/start`)
  - `hm-trading-control-api/server.js` lines 769-846 (`/test/stop-and-backtest`)

## Deployments

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-23 | e5ec8aa | Feature #5: Chart indicator overlays (EMA, Bollinger Bands) |
| 2026-01-23 | c2fd7bd | Feature #4: Bot strategy descriptions |
| 2026-01-23 | 2df01e7 | Feature #3: Historical data lazy loading |
| 2026-01-23 | 096cbcb | Bug fixes #1 & #2: Periodic refresh interval, 4h candle zoom scaling |
| 2026-01-22 | bed3d75 | UI improvements: dynamic chart titles, error toasts, API badge, 24h label, loading states |
| 2026-01-22 | - | Bug fixes for chart scaling, backtest, UI, and live candles |
