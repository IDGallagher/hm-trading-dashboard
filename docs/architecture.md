# HM Trading Dashboard Architecture

## 1) Overview

The dashboard is a browser-only, script-tag based application (no bundler/framework runtime) that provides:

- Live market monitoring (candles, order book, trades, header stats)
- Live-forming candle construction from trade deltas
- Strategy overlays/indicators for chart analysis
- Session lifecycle management (running, scrapers, history)
- Session drilldown (inline panel + legacy modal helpers)
- Live test control and backtest comparison workflows

The app is primarily orchestrated by global functions and shared global state across script files.

## 2) Runtime and Dependencies

- Runtime: plain browser JavaScript
- Chart library: Lightweight Charts v4.1.0 (CDN in `index.html`)
- Styles: `css/main.css`
- API transport: `fetch` via centralized wrapper in `js/api/client.js`
- Auth: API key header (`x-api-key`) attached in API client

## 3) Entry Point and Script Load Order

Scripts are loaded in this order from `index.html`:

1. `js/core.js`
2. `js/config/ui-options.js`
3. `js/api/client.js`
4. `js/components/session-card.js`
5. `js/components/session-detail-modal.js`
6. `js/session-management.js`
7. `js/components/live-market-ui.js`
8. `js/components/live-test-button-hook.js`
9. `js/dashboard-live.js`

Implication: modules rely on globals created by earlier files (e.g. `CONTROL_API_URL`, `CONTROL_API_KEY`, `HM_API`, `safeSetData`, etc.).

## 4) Module Responsibilities

### `js/core.js`

Cross-cutting infrastructure:

- Global debug gate:
  - `window.HM_DEBUG` enabled by `?debug=1` or pre-set global
  - `window.debugLog(...)` helper
- JS error capture:
  - `window.onerror`
  - `unhandledrejection` listener
  - in-page error panel (`#js-error-panel`)
- Safe chart wrappers:
  - `safeSetData`
  - `safeSetMarkers`
  - `safeUpdate`
- Shared formatting/helpers:
  - market metadata lookup (`getMarketDisplayName`, `getMarketInstrumentSymbol`)
  - adaptive time formatter for charts (`setupAdaptiveTimeFormat`)
- Shared session-data fetch helpers with DB→file fallback:
  - `fetchSessionTrades`
  - `fetchSessionEquity`
  - `fetchSessionPositions`
  - `fetchSessionTradeSummary`

### `js/config/ui-options.js`

Single source for static UI option sets:

- `LIVE_MARKETS` grouped market definitions
- `SESSION_MARKETS` derived from `LIVE_MARKETS[*].options[*].sessionMarket` (with fallback)
- `PERIOD_OPTIONS`, strategy lists, session modes/types, history filters
- Render helpers to populate `<select>` and period/range controls
- Exports:
  - `window.HM_UI_OPTIONS`
  - `window.initializeStaticUiOptions()`

### `js/api/client.js`

Central API surface + adapters:

- Low-level:
  - `request`, `requestJson`, URL/query/header construction
- Domain namespaces:
  - `HM_API.strategies`
  - `HM_API.sessions`
  - `HM_API.sessionData`
  - `HM_API.live`
  - `HM_API.test`
  - `HM_API.legacySession`
- New live trade adapter layer:
  - `normalizeEpochMs`
  - `normalizeLiveTradeDelta`
  - `normalizeLiveTradesDeltasPayload`
  - `HM_API.live.tradesDeltasNormalized(...)`

### `js/components/live-market-ui.js`

UI-focused live market behavior:

- Header rendering: `updateTradingHeader`
- Professional panels:
  - `renderOrderbookPro`
  - `renderTradesPro`
- URL-state synchronization:
  - `market` query param
  - `period` query param
- Controls wiring:
  - `initLiveMarketControls`
  - `initPeriodDropdown`
  - `initChartPeriodBar`

### `js/dashboard-live.js`

Main application orchestration and most business logic:

- Global app state and lifecycle
- Live market chart creation + updates
- API loading flows (`/api/prices`, `/api/orderbook`, `/api/trades/deltas`)
- Polling loops
- In-flight request cancellation / stale-request protection
- Forming candle logic from trade deltas
- Indicators and overlays
- Backtest/test flows and chart rendering
- App bootstrap sequence on page load

### `js/session-management.js`

Session management subsystem:

- Session list fetch/categorization
- Pagination/filtering
- Health/heartbeat enrichment
- Efficient card rendering + in-place updates
- Inline detail panel orchestration
- Inline trades/logs/equity loading
- Trade marker projection to chart
- URL param session open (`?session=<id>`)
- Inline equity chart teardown to avoid resize-listener leaks

### `js/components/session-card.js`

Pure render/helpers for session cards:

- `renderSessionCard`
- health/status class helpers
- runtime formatting helper

### `js/components/session-detail-modal.js`

Legacy modal detail helpers (still present):

- Open/close modal
- tab switching
- metrics/trades/logs/equity detail loading
- note editing and cloning actions

## 5) High-Level UI Structure

Primary layout in `index.html`:

- Trading header (instrument, price stats)
- Main trading body:
  - left: live chart + OHLC + period controls
  - right: orderbook + recent trades + polymarket “Price to Beat” panel
- “Your Bots” tab:
  - Running sessions panel
  - Scrapers panel
  - History panel
  - Inline session detail panel

There is still legacy/backtest UI content in the same document, some hidden.

## 6) Shared Global State Model (Important)

Key global state lives mainly in `dashboard-live.js`:

- Market context:
  - `currentMarket`
  - `currentMarketPeriod`
- Chart refs:
  - `liveMarketChart`
  - `liveMarketCandleSeries`
- Candle/trade state:
  - `formingCandle`
  - `lastCandleData`
  - `latestTradeTimestamp`
- Lazy-loading bounds:
  - `earliestCandleTime`
  - `archiveMinTime`
- Request versioning/cancellation:
  - `marketRequestVersion`
  - `activeMarketRequestControllers`
- Polling handles/flags:
  - `tradePollingInterval`, `tradePollingInProgress`
  - `orderbookPollingInterval`, `orderbookPollingInProgress`
  - `priceToBeatInterval`

Session state lives mainly in `session-management.js`:

- `sessionsData` (`running`, `scrapers`, `history`)
- pagination (`historyCurrentPage`, `historyTotalPages`, `historyTotal`)
- inline view state (`currentInlineSessionId`, `currentSessionTradeData`, etc.)

## 7) Live Market Data Flow

### Initial live load

`loadLiveMarketData()`:

1. Stops trade polling
2. Awaits `loadPriceData()`
3. In parallel loads:
   - `loadOrderbookData()`
   - `loadTradesData()`

### Price/candle load

`loadPriceData()` calls:

- `GET /api/prices` with `{ market, period, limit, source: 'hybrid' }`

Then it:

- sets full candle series
- updates volume series + OHLC display + indicators
- updates chart range/autoscale
- computes latest static candle end timestamp and seeds `latestTradeTimestamp`
- explicitly resets forming candle (`formingCandle = null`) so live candle is rebuilt from trade deltas

### Trade load + polling

`loadTradesData()` now uses:

- `HM_API.live.tradesDeltasNormalized(...)`

Normalization guarantees a stable trade shape:

- `{ timestampMs, timestamp, price, amount, side }`

Behavior:

- sorts trades chronologically
- feeds all trades into `updateFormingCandle(...)`
- renders trade list newest-first
- updates `latestTradeTimestamp`
- starts polling

`startTradePolling()`:

- every 1s polls with `since=latestTradeTimestamp`
- prevents overlap with `tradePollingInProgress`
- processes all received trades chronologically for candle correctness
- updates header from newest trade

### Orderbook polling

`startOrderbookPolling()`:

- polls every 1s with overlap guard
- updates pro orderbook rendering + spread labels

## 8) In-Flight Request Cancellation and Stale Guarding

Market/period context changes trigger:

- `window.onLiveMarketContextChange(...)`
- which calls `cancelInFlightMarketRequests(...)`

That mechanism:

- increments `marketRequestVersion`
- aborts all tracked request `AbortController`s
- clears active controller set
- resets `latestTradeTimestamp`

Each request receives a context from `beginTrackedMarketRequest()` and checks staleness using:

- `isStaleMarketRequest(context, checkPeriod?)`

This protects UI from old responses arriving after context changes.

## 9) Session Architecture

### Sources

Session data can come from:

- primary DB-style session endpoints
- fallback file/session endpoints (for trades/equity where implemented)

### Fetch and classify

`fetchSessions()`:

- gets sessions list
- preserves prior metrics where API may omit
- classifies into running/scrapers/history
- enriches running/scrapers with `sessions.health()`
- renders panels

### Inline detail flow

`showInlineDetail(sessionId, panelType)`:

- swaps list panel to inline detail panel
- loads metrics/trades/logs/equity in parallel
- optionally aligns live chart market to session market
- overlays session trades on chart
- loads DevDistStat indicators for matching strategy

### Inline equity cleanup

To avoid listener leaks:

- `teardownInlineEquityChart()` removes prior resize listener and chart instance
- called before recreating chart and when inline detail closes

## 10) Live Test and Backtest Flow

Main flow in `dashboard-live.js`:

- `startLiveTest()` → `POST /test/start`
- `pollLiveTestStatus()` → `GET /test/status`
- periodic live metrics refresh from `GET /session/test`
- `stopAndBacktest()` → `POST /test/stop-and-backtest`
- then loads compare/session views and updates chart/metrics

Strategy selection also controls mode toggling:

- market-only mode (`none`)
- strategy mode (overlays + equity components)

## 11) URL State

Supported params:

- `market=<market-id>`
- `period=<period-id>`
- `session=<session-id>`
- `debug=1` (enables debug log gate in core)

Behavior:

- market/period persist through refresh (`history.replaceState`)
- session param opens inline detail after sessions load

## 12) API Surface (Client Contract)

### Live data

- `GET /api/prices`
- `GET /api/orderbook`
- `GET /api/trades/deltas`
- `GET /api/archive/info`
- `GET /api/polymarket/metadata`

### Session orchestration

- `GET /sessions`
- `GET /sessions/health`
- `GET /sessions/{id}`
- `POST /sessions`
- `POST /sessions/{id}/start|stop|restart|clone`
- `DELETE /sessions/{id}`
- `GET /sessions/{id}/metrics|logs|heartbeat|trading-start`

### Session data

- `GET /sessions/{id}/trades/db`
- `GET /sessions/{id}/trades`
- `GET /sessions/{id}/equity-curve`
- `GET /sessions/{id}/equity`
- `GET /sessions/{id}/positions`
- `GET /sessions/{id}/trades/summary`

### Test control

- `POST /test/start`
- `POST /test/stop-and-backtest`
- `GET /test/status`

## 13) Debugging and Observability

- Error toast for user-visible failures (`showErrorToast`)
- JS error panel for captured exceptions/rejections
- `window.HM_DEBUG` / `?debug=1` for gated debug logs
- Several non-gated `console.log` statements still exist in older paths

## 14) Current Technical Constraints / Known Risks

- Global namespace coupling across script files
- Mixed legacy and newer UI paths coexist in same page
- Some duplicate `id` attributes still exist in `index.html` (risk of selecting wrong element with `getElementById`)
- Some data formatting/rendering logic still duplicated between legacy and pro panels
- No compile-time type checks; runtime shape mismatches are handled ad hoc

## 15) Practical Change Guidelines

For safe modifications:

1. Prefer adding transformations in `js/api/client.js` adapters over inline parsing.
2. Keep market context updates routed through `window.onLiveMarketContextChange`.
3. Use request tracking (`beginTrackedMarketRequest` / `endTrackedMarketRequest`) for any new market-bound fetches.
4. Use `safeSetData`/`safeUpdate`/`safeSetMarkers` for chart writes.
5. Avoid introducing new duplicated IDs in `index.html`.
6. Preserve URL synchronization behavior for `market` and `period`.
7. Tear down intervals/listeners/charts when replacing UI subviews.

## 16) File Map

- `index.html`: full markup shell, script loading, top-level layout
- `css/main.css`: all styling
- `js/core.js`: shared runtime helpers + error/debug plumbing
- `js/config/ui-options.js`: static options and select/menu rendering
- `js/api/client.js`: HTTP client and endpoint/adapters
- `js/dashboard-live.js`: main app orchestration
- `js/session-management.js`: session panels and inline details
- `js/components/live-market-ui.js`: live-market UI behavior helpers
- `js/components/live-test-button-hook.js`: test control button hook glue
- `js/components/session-card.js`: session card rendering
- `js/components/session-detail-modal.js`: legacy modal detail flow
