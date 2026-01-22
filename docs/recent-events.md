# Recent Events

## Latest Updates - January 22, 2026

### Bug Fixes Completed

| Bug | Root Cause | Fix | Fixed By |
|-----|------------|-----|----------|
| **Chart Y-axis scaling** | Y-axis not auto-scaling to data range | Updated chart options to use auto-scaling | chart-fix-dev |
| **Backtest producing 0 trades** | PairTradeBot requires BTC/USDT data (only BTC/USD available) | Changed to TestBot strategy which only needs BTC/USD | backtest-fix-dev |
| **Backtest view JS crash** | `.toFixed()` called on undefined value | Added null check before calling `.toFixed()` | ui-fix-dev |
| **Hidden Start Test button** | Button was not visible in UI | Fixed button visibility/styling | ui-fix-dev |
| **Live candle micro-candles** | WebSocket sends timestamps in milliseconds, chart expects seconds | Added ms → seconds conversion (÷1000) | candle-fix-dev |
| **X-axis showing raw numbers** | Same timestamp format mismatch | Same fix - ms → seconds conversion | candle-fix-dev |

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

## Deployments

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-22 | - | Bug fixes for chart scaling, backtest, UI, and live candles |
