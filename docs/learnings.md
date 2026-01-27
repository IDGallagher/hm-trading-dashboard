# Learnings - Dashboard

## Current Status

**Live dashboard:** https://hm-trading-dashboard.pages.dev/ (Cloudflare Pages)
- Real-time BTC/USD price feed and order book
- Session management (test/backtest/market modes)
- 4 active trading strategies streaming data

## Critical Insights

**WebSocket Connection:**
- Endpoint: `wss://agent-company.atamatch.com:8443/trades/stream`
- Control API relays C++ engine order updates
- Drop-in reconnection logic prevents display staleness

**Browser Caching:**
- Cloudflare Pages caches static assets aggressively
- Hard refresh (Cmd+Shift+R) required after deployment changes
- Session data always fetches fresh (not cached)

**Order Book Display:**
- Shows top 10 bid/ask levels for BTC/USD
- Updated in real-time from BitMEX WebSocket
- Spread calculation visible for entry/exit analysis

**Strategy Selection:**
- Dashboard allows switching between 4 strategies without reloading
- Each strategy has predefined parameters (non-editable via UI)
- SDBot most stable for backtesting, SazBot most responsive to market events

**4 Operating Modes:**
- **test** - Paper trading against BitMEX testnet (slower execution)
- **backtest** - Historical replay from S3 archives (deterministic)
- **market** - 24/7 data collection mode (3 services running)
- **live** - Not currently active (mainnet trading disabled)

## Gotchas

**API Connection:**
- Dashboard polls Control API at `http://localhost:8443` (nginx proxy)
- CORS headers required: custom `x-api-key` must be in `allowedHeaders`
- 503 errors indicate Control API down or unresponsive

**Session State:**
- Switching modes (test → backtest) requires stopping current session first
- Session data persisted in MySQL survives API restarts
- C++ subprocess cleanup on session end may take 5-10 seconds

**Cloudflare Pages Deployment:**
- Auto-deploys on master push, takes 30-60 seconds
- Cached assets cleared automatically
- Custom domain requires DNS CNAME configuration

**Real-time Updates:**
- WebSocket reconnects automatically on disconnect
- Order book updates every 100ms during market hours
- Price feed updates from BitMEX (live 24/7)

## Debugging Checklist

- **API not responding:** Check `systemctl status bitmex-dashboard` on Hetzner
- **WebSocket disconnected:** Verify `agent-company.atamatch.com:8443` accessible
- **Stale data:** Hard refresh dashboard (Cmd+Shift+R) to clear cache
- **Session won't start:** Verify C++ binary path and MySQL connectivity
- **No trades showing:** Check if correct strategy selected for data type (SDBot for backtest)
- **Order book not updating:** Verify BitMEX API key configured in engine
