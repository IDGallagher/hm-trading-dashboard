# HM Trading Dashboard - Phase 2 Requirements

## NEW FEATURES

### 1. Session Detail View (In-Page, Not Modal)
- Clicking a session in "Your Bots" section navigates the bottom panel to a detail view
- Replace current modal with inline detail view in the same section
- Detail view shows: Info, Metrics, Trades, Logs tabs
- Back button to return to session list

### 2. Trades on Chart
- When a session is clicked, overlay that bot's trades on the price chart
- Show entry/exit markers with price and P&L
- Visual distinction between winning and losing trades (green/red markers)

### 3. Chart Market Switch
- When a session is clicked, automatically switch the chart to that session's market
- If session trades XBTUSD, chart switches to XBTUSD
- Seamless transition with WebSocket reconnection

### 4. Live Trade Updates
- WebSocket subscription for new/closed trades
- Real-time updates when bot executes trades
- Update trade count and P&L in session cards without refresh

### 5. Remove View Button
- Remove explicit "View" button from session cards
- Entire row click navigates to session detail view
- Keep Stop/Restart buttons as separate clickable areas

## BUG FIXES

### 6. Bot Metrics Blank
- Metrics endpoint returns zeros even for sessions with trades
- Root cause: Endpoint only handles NDJSON format, not full JSON format
- Fix: Update /sessions/:id/metrics to parse both file formats

### 7. Equity Curve Blank
- Equity curve endpoint returns empty data
- Root cause: Same as metrics - only handles NDJSON format
- Fix: Update /sessions/:id/equity to parse both file formats

### 8. P&L Shows Zero on Session List
- Session list shows $0.00 P&L for all sessions
- Root cause: Database not updated with P&L from trades files
- Fix: API reads from trades_file when DB values are stale (COMPLETED)

### 9. Scrapers Tab Not Showing Scrapers
- BitMEX Multi-Market Scraper not appearing in Scrapers tab
- Check filter logic in fetchSessions()
- Verify scraper type sessions are correctly categorized

### 10. Price Chart Polling
- Chart currently uses periodic polling for updates
- Should use pure WebSocket for real-time updates
- Remove setInterval-based polling, rely on WebSocket only

### 11. TestBot Not Trading Regularly
- TestBot should execute trades every minute during test sessions
- Investigate C++ bot trading logic
- Verify interval_trade trigger is firing correctly

## UI CHANGES

### 12. Chart Height Reduction
- Reduce chart section height so "Your Bots" section is above the fold
- Current height too tall on desktop
- Target: ~300px chart height on desktop, 250px on mobile

### 13. Bot Logs Enhancement
- Add detailed logging panel in session detail view
- Show real-time log streaming for running sessions
- Filter by log level (INFO, WARN, ERROR)
- Start with TestBot logging for debugging

---

## Implementation Status

| # | Item | Status |
|---|------|--------|
| 1 | Session Detail View | **COMPLETED** - Inline detail view replaces modal |
| 2 | Trades on Chart | **COMPLETED** - Trades displayed as markers on chart |
| 3 | Chart Market Switch | **COMPLETED** - Auto-switches to session's market |
| 4 | Live Trade Updates | **COMPLETED** - WebSocket updates for real-time data |
| 5 | Remove View Button | **COMPLETED** - Row click navigates to detail |
| 6 | Bot Metrics Blank | **COMPLETED** - Fixed JSON/NDJSON format parsing |
| 7 | Equity Curve Blank | **COMPLETED** - Fixed JSON/NDJSON format parsing |
| 8 | P&L Shows Zero | **COMPLETED** - Reads from trades file when DB stale |
| 9 | Scrapers Tab | **COMPLETED** - Shows all scrapers regardless of status |
| 10 | Price Chart Polling | **COMPLETED** - Removed polling, WebSocket only |
| 11 | TestBot Trading | Not addressed - Requires C++ bot changes |
| 12 | Chart Height | **COMPLETED** - Reduced to 350px on desktop |
| 13 | Bot Logs | **COMPLETED** - Logs tab in inline detail view
