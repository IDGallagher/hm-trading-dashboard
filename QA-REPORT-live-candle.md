# Live Forming Candle Feature - QA Report

**Tested by:** QA Agent
**Date:** 2026-01-22
**Dashboard:** https://production.hm-trading-dashboard.pages.dev/
**Commit:** 20c4c22 feat: add live forming candle to candlestick chart

## Summary

The live forming candle feature is **mostly working** but has **1 bug** that needs to be fixed.

---

## ✅ PASSED Tests

### 1. Chart Title Shows Live Indicator
- Chart now displays "🟢 Live" in title
- Example: `BTC/USD Price (🔀 Combined · 63 candles · 🟢 Live)`

### 2. Candle Count Increases on Period Rollover
- Observed: 62 → 63 candles when 5-minute period rolled over
- Period boundaries correctly detected

### 3. OHLCV Tracking Working Correctly
Console log confirms proper tracking:
```
{time: 1769057100, open: 89886, high: 89919.3, low: 89880.2, close: 89919.3}
```
- Open: First price of period ✓
- High: Tracks maximum (89919.3) ✓
- Low: Tracks minimum (89880.2) ✓
- Close: Latest price ✓

### 4. Price Display Updates Real-Time
- Observed updates: 89805.6 → 89883.1 → 89900.0 → 89919.3
- No visible flickering

### 5. WebSocket Connection
- Successfully connects to wss://agent-company.atamatch.com:8443/trades/stream
- Subscriptions working

### 6. Period Change Resets Forming Candle
- Confirmed: `formingCandle = null` on period change
- Data reloads correctly

---

## ⚠️ BUG FOUND

### Timestamp Unit Mismatch (MEDIUM Priority)

**Symptom:**
Console shows impossible dates when period rolls over:
```
[LiveCandle] New period started: +058029-03-08T05:25:00.000Z
```

Year 58029 is obviously wrong.

**Root Cause:**
In `updateFormingCandle()`, line ~1624:
```javascript
const tradeTime = trade.timestamp || Math.floor(Date.now() / 1000);
```

The code expects `trade.timestamp` in **seconds**, but trades from WebSocket provide timestamp in **milliseconds**.

When a millisecond timestamp (e.g., `1737524533123`) is used:
- `getPeriodStartTime(1737524533123, '5m')` calculates a huge period start
- `new Date(periodStart * 1000)` then gives year 58029

**Fix Required:**
```javascript
// Check if timestamp is in milliseconds and convert to seconds
const tradeTime = trade.timestamp > 9999999999
    ? Math.floor(trade.timestamp / 1000)
    : (trade.timestamp || Math.floor(Date.now() / 1000));
```

**Impact:**
- The bug causes incorrect period start logging but doesn't break candle display
- The `initFormingCandleFromData()` works correctly because historical candles have proper timestamps

---

## Test Coverage

| Test | Result |
|------|--------|
| Live candle updates in real-time | ✅ PASS |
| Period rollover detection | ✅ PASS |
| 5-minute period | ✅ PASS |
| OHLCV correctness | ✅ PASS |
| No flickering | ✅ PASS |
| Period change reset | ✅ PASS |
| Timestamp handling | ⚠️ BUG |

---

## Recommendation

1. **Fix the timestamp bug** - Add milliseconds detection in `updateFormingCandle()`
2. **Deploy fix** - This is a low-risk change
3. **Feature can be considered functional** - The core functionality works despite the logging bug
