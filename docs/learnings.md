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
