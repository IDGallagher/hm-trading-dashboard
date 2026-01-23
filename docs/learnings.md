# Learnings

## Decisions

### TestBot vs PairTradeBot Strategy (January 2026)
**Decision:** Use TestBot instead of PairTradeBot for backtesting demos.

**Context:** The backtest system was producing 0 trades when using PairTradeBot.

**Reasoning:**
- PairTradeBot is an arbitrage strategy that requires two correlated pairs (BTC/USD and BTC/USDT)
- The historical FlatBuffer archive only contains BTC/USD data
- TestBot is a simple strategy that works with single-pair data
- For demonstrating the backtest/test parity feature, TestBot is sufficient

**Trade-off:** Less sophisticated strategy, but functional demos. Future: archive BTC/USDT data to enable arbitrage testing.

### Timestamp Format: Milliseconds vs Seconds (January 2026)
**Decision:** Convert timestamps from ms to seconds at the WebSocket handler level.

**Context:** Live forming candles appeared as micro-candles and X-axis showed raw numbers.

**Reasoning:**
- C++ backend (new-hope) sends WebSocket messages with timestamps in milliseconds
- JavaScript charting libraries (Lightweight Charts) expect Unix timestamps in seconds
- Converting at the handler level ensures all downstream code receives consistent format

**Implementation:** `timestamp = message.timestamp / 1000`

### Archive Replay vs Live Market Mode (January 2026)
**Decision:** Use `market` mode for live tests instead of archive replay.

**Context:** Test runs were completing in ~2 seconds instead of running indefinitely against live data.

**Reasoning:**
- The `/test/start` endpoint was hardcoded to use archive replay with fixed timestamps
- This caused tests to replay ~94 minutes of archived data instantly
- For true live testing, we need real-time data from BitMEX WebSocket
- Archive mode is useful for deterministic backtesting, but not for live strategy evaluation

**Implementation:**
- Removed `--local-archive`, `--start`, `--end` flags from C++ binary invocation
- Test now connects to live BitMEX WebSocket via `market` mode
- Tracks wall clock start/end times so backtest can replay the exact test period

**Trade-off:** Live tests now depend on BitMEX connectivity. Archive replay remains available for backtesting.

### Periodic Refresh Interval (January 2026)
**Decision:** Reduce chart refresh interval from 30 seconds to 5 minutes.

**Context:** Aggressive 30-second refresh was causing data loss and performance issues.

**Reasoning:**
- 30-second refresh was interrupting user interactions
- Chart state was being lost on each refresh
- For live data, WebSocket updates are more efficient than periodic full refreshes
- 5-minute interval is sufficient for catching any missed WebSocket updates

**Trade-off:** Slightly less frequent fallback updates, but much better UX and performance.

### Lazy Loading for Historical Data (January 2026)
**Decision:** Implement scroll-triggered lazy loading for historical candles.

**Context:** Loading all historical data upfront was slow and memory-intensive.

**Reasoning:**
- Users typically view recent data first
- Older data is only needed when scrolling left
- Loading on-demand reduces initial page load time
- Keeps memory usage bounded

**Implementation:** Detect scroll position, fetch older candles when user scrolls to left edge of chart.

### Strategy-Specific Chart Indicators (January 2026)
**Decision:** Configure indicator overlays (EMA, Bollinger Bands) per strategy.

**Context:** Different trading strategies use different technical indicators.

**Reasoning:**
- TestBot may use simple EMA crossovers
- DivergeBot may use Bollinger Bands for divergence detection
- Showing irrelevant indicators clutters the chart
- Per-strategy config keeps display relevant to the strategy's logic

**Implementation:** Each bot config includes `indicators` array specifying which overlays to show.

## Lessons Learned

### Data Dependency Debugging
When a strategy produces 0 trades:
1. First check if the strategy requires multiple data pairs
2. Verify all required pairs are available in the data archive
3. Check the strategy's configuration for pair requirements
4. Consider testing with a simpler single-pair strategy first

### Timestamp Unit Mismatches
When charts display incorrect time formatting:
1. Check the unit of timestamps at the source (ms vs s)
2. Check what unit the charting library expects
3. Look for both visual symptoms: wrong scale AND raw numbers on axis

### Archive vs Live Mode Confusion
When tests complete too quickly:
1. Check if the endpoint is using archive replay vs live market mode
2. Look for hardcoded timestamps or `--local-archive` flags
3. Verify the C++ binary is connecting to live WebSocket (not replaying files)
4. Check if duration reflects wall clock time vs data playback time

### C++ Binary and NDJSON Parsing Issues
When strategy produces 0 trades despite correct setup:
1. Check if C++ binary needs rebuilding after code changes
2. Verify NDJSON (newline-delimited JSON) parsing handles line-by-line correctly
3. Check field name consistency between C++ output and JavaScript parsing
4. Ensure JSON parsing doesn't fail silently on malformed lines

### Candle Period Zoom Scaling
When zooming behaves incorrectly for different timeframes:
1. Zoom levels should adapt to candle period (1m vs 4h have different scales)
2. A fixed zoom factor looks wrong across different timeframes
3. Calculate zoom based on the time range each candle represents

## Best Practices

### FlatBuffer Data Archiving
- Archives stored in `/flatbuffer-archive/` directory
- Each file represents a time period of market data
- 16,697+ files indicates healthy archive coverage
- Use these files for consistent, reproducible backtests

### Test/Backtest Parity
- Live tests and backtests should produce identical results given same data
- TestBot strategy is good for verifying this parity
- Any difference indicates a bug in either the test or backtest code path

### Chart Y-axis Scaling
- Always use auto-scaling for financial charts
- Fixed scales can hide important price movements
- Candlestick charts need dynamic range based on OHLC values

### Chart Technical Indicators
- Configure indicators per strategy (not globally)
- Common indicators: EMA (Exponential Moving Average), Bollinger Bands, RSI
- Match indicator display to what the strategy actually uses
- Allow users to toggle indicators on/off for cleaner view

### Lazy Loading Historical Data
- Load recent data first (users see this immediately)
- Fetch older data on scroll (triggered at chart left edge)
- Keep a buffer of older data to prevent constant fetching
- Show loading indicator while fetching more data

## Pitfalls to Avoid

### Assuming Data Availability
**Problem:** Strategies may silently fail when required data pairs are missing.
**Solution:** Validate data availability before running strategies. Log warnings when expected pairs are not found.

### Hardcoded Timestamp Units
**Problem:** Different systems use different timestamp units (ms, s, ns).
**Solution:** Document the expected unit at API boundaries. Convert early in the data pipeline.

### Null Value Handling in JavaScript
**Problem:** Calling `.toFixed()` on undefined crashes the view.
**Solution:** Always add null checks before formatting: `value?.toFixed(2) ?? 'N/A'`

### Hardcoded Test Modes
**Problem:** Test endpoints may be hardcoded for a specific mode (archive replay) during development, causing live tests to behave unexpectedly (instant completion, wrong data source).
**Solution:** Make test mode configurable via parameters. Document which mode each endpoint uses. Verify the data source (archive files vs live WebSocket) matches the intended use case.

### Stale C++ Binaries
**Problem:** After modifying C++ strategy code, the running binary may be stale and not reflect changes.
**Solution:** Always rebuild (`cmake --build`) and restart the binary after C++ code changes. Consider adding version/build timestamp to binary output for verification.

### NDJSON Parsing Fragility
**Problem:** NDJSON (newline-delimited JSON) parsing can fail silently if:
- Lines aren't split correctly
- Field names don't match expected schema
- Empty lines or malformed JSON isn't handled
**Solution:** Parse line-by-line with proper error handling. Log parsing failures. Validate field names against expected schema.

### Aggressive Refresh Intervals
**Problem:** Too-frequent periodic refreshes (e.g., 30s) can cause:
- Data loss during refresh
- Interrupted user interactions
- Unnecessary network traffic
- Chart state loss
**Solution:** Use longer intervals (5+ minutes) for fallback refreshes. Rely on WebSocket for real-time updates. Preserve chart state across refreshes where possible.
