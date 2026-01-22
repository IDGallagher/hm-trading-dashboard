/**
 * HM Trading Control API Server
 *
 * Enables the dashboard to start live tests and trigger instant backtests.
 * Manages C++ bot as subprocess.
 * Provides unified market data API (prices, orderbook, trades).
 */

const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

// Import unified data API
const unifiedApi = require('./unified-api');

const app = express();
const PORT = process.env.PORT || 3001;

// Paths
const CPP_REPO = process.env.CPP_REPO || '/opt/agent-workspaces/shared/cpp-repo';
const BOT_BINARY = path.join(CPP_REPO, 'build', 'hm_trading');
const TRADES_DIR = path.join(CPP_REPO, 'build');
const DB_ENV_PATH = path.join(CPP_REPO, 'config', 'db.env');

// State
let testProcess = null;
let testState = {
  running: false,
  startTime: null,
  endTime: null,
  strategy: null,
  exchange: null,
  pairs: [],
  pid: null
};

let backtestProcess = null;
let backtestState = {
  running: false,
  startTime: null,
  endTime: null,
  strategy: null,
  pid: null
};

let marketProcess = null;
let marketState = {
  running: false,
  startTime: null,
  endTime: null,
  strategy: null,
  exchange: null,
  pairs: [],
  pid: null,
  tradesFile: null
};

// API Key from environment
const API_KEY = process.env.HM_CONTROL_API_KEY || 'hm-trading-dev-key-2025';

// Middleware - CORS with specific origins
app.use(cors({
  origin: [
    'https://hm-trading-dashboard.pages.dev',
    'https://production.hm-trading-dashboard.pages.dev',
    'https://agent-company.atamatch.com',
    /^http:\/\/localhost/
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// API Key authentication middleware
const apiKeyAuth = (req, res, next) => {
  // Skip auth for health check and public API endpoints
  if (req.path === '/health' || req.path.startsWith('/api/')) {
    return next();
  }

  const providedKey = req.headers['x-api-key'];
  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid or missing API key' });
  }
  next();
};

app.use(apiKeyAuth);

// =============================================================================
// UNIFIED DATA API - Register endpoints
// =============================================================================
unifiedApi.registerEndpoints(app);

// Initialize database connection
unifiedApi.initDatabase().then(() => {
  console.log('[Server] Unified API database initialized');
}).catch(err => {
  console.error('[Server] Unified API database init failed:', err.message);
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Helper: Read trade log file
function readTradeLog(filename) {
  const filepath = path.join(TRADES_DIR, filename);
  try {
    if (fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${filename}:`, err.message);
  }
  return { trades: [] };
}

// Helper: Get current Unix timestamp
function now() {
  return Math.floor(Date.now() / 1000);
}

// Helper: Load database credentials from db.env
function loadDbCredentials() {
  try {
    if (!fs.existsSync(DB_ENV_PATH)) {
      console.error('Database credentials file not found:', DB_ENV_PATH);
      return null;
    }
    const content = fs.readFileSync(DB_ENV_PATH, 'utf8');
    const creds = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          creds[key] = valueParts.join('=');
        }
      }
    }
    return creds;
  } catch (err) {
    console.error('Error loading database credentials:', err.message);
    return null;
  }
}

// Helper: Transform C++ trade format to dashboard format
// C++ outputs separate OPEN/CLOSE entries; dashboard expects paired entry+exit objects
function transformCppTradesToDashboardFormat(cppTrades) {
  if (!cppTrades || !Array.isArray(cppTrades) || cppTrades.length === 0) {
    return [];
  }

  const dashboardTrades = [];
  let pendingOpen = null;
  let cumulativePnl = 0;

  for (const trade of cppTrades) {
    if (trade.action === 'OPEN') {
      // Start a new position
      pendingOpen = {
        timestamp_unix: Math.floor(trade.ts / 1000), // ms to seconds
        side: trade.dir === 'BUY' ? 'long' : 'short',
        price: trade.price,
        quantity: trade.size,
        reason: trade.reason || 'unknown'
      };
    } else if (trade.action === 'CLOSE' && pendingOpen) {
      // Complete the position with exit data
      cumulativePnl += trade.pnl || 0;
      dashboardTrades.push({
        ...pendingOpen,
        exit_time_unix: Math.floor(trade.ts / 1000),
        exit_price: trade.price,
        pnl: trade.pnl || 0,
        cumulative_pnl: cumulativePnl
      });
      pendingOpen = null;
    }
  }

  // If there's an unclosed position, add it without exit data
  if (pendingOpen) {
    dashboardTrades.push({
      ...pendingOpen,
      pnl: 0,
      cumulative_pnl: cumulativePnl
    });
  }

  return dashboardTrades;
}

// Helper: Build session response in dashboard-expected format
function buildSessionResponse(rawData, sessionType) {
  const trades = transformCppTradesToDashboardFormat(rawData.trades || []);

  // Calculate metrics from trades
  const winningTrades = trades.filter(t => t.pnl > 0);
  const losingTrades = trades.filter(t => t.pnl < 0);
  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  return {
    success: true,
    metadata: {
      bot_name: rawData.bot || 'TestBot',
      exchange: 'bitmex',
      pair: 'BTC/USD',
      session_type: sessionType,
      start_time: rawData.start_time || now(),
      end_time: rawData.end_time || now()
    },
    metrics: {
      total_pnl: totalPnl,
      win_rate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
      total_trades: trades.length,
      winning_trades: winningTrades.length,
      losing_trades: losingTrades.length,
      avg_win: winningTrades.length > 0 ? winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length : 0,
      avg_loss: losingTrades.length > 0 ? losingTrades.reduce((s, t) => s + t.pnl, 0) / losingTrades.length : 0
    },
    trades: trades,
    equity_curve: [],
    candles: []
  };
}

// =============================================================================
// TEST ENDPOINTS
// =============================================================================

/**
 * POST /test/start
 * Start a live test with selected strategy
 * Body: { strategy: string, exchange?: string, pairs?: string[] }
 */
app.post('/test/start', (req, res) => {
  if (testState.running) {
    return res.status(400).json({
      error: 'Test already running',
      pid: testState.pid
    });
  }

  const { strategy = 'PairTradeBot', exchange = 'bitmex', pairs = ['XBTUSD'], duration = 300 } = req.body || {};

  // Use historical archive data that we know exists (Milestone 1 archived this data)
  // Archive data available: 1768953600 to 1768959240 (~94 minutes)
  const ARCHIVE_START = 1768953600;
  const ARCHIVE_END = 1768959240;

  // Calculate start/end times within available archive range
  const startTime = ARCHIVE_START;
  const endTime = Math.min(ARCHIVE_START + duration, ARCHIVE_END);

  // Build command args - need --start/--end/--local-archive for test mode to work
  const args = [
    'test',
    '--bot', strategy,
    '--exchange', exchange,
    '--pairs', pairs.join(','),
    '--start', String(startTime),
    '--end', String(endTime),
    '--local-archive',
    '--log-trades', path.join(TRADES_DIR, 'test_trades.json'),
    '--verbose'
  ];

  console.log(`Starting test: ${BOT_BINARY} ${args.join(' ')}`);

  try {
    testProcess = spawn(BOT_BINARY, args, {
      cwd: CPP_REPO,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    testState = {
      running: true,
      startTime: startTime,  // Archive time, not wall clock
      endTime: endTime,      // Archive end time
      strategy,
      exchange,
      pairs,
      pid: testProcess.pid
    };

    // Log stdout/stderr
    testProcess.stdout.on('data', (data) => {
      console.log(`[TEST stdout] ${data}`);
    });
    testProcess.stderr.on('data', (data) => {
      console.error(`[TEST stderr] ${data}`);
    });

    testProcess.on('close', (code) => {
      console.log(`Test process exited with code ${code}`);
      testState.running = false;
      // Don't overwrite endTime if already set (preserves archive time range)
      if (!testState.endTime) {
        testState.endTime = now();
      }
      testProcess = null;
    });

    testProcess.on('error', (err) => {
      console.error('Test process error:', err);
      testState.running = false;
      testProcess = null;
    });

    res.json({
      success: true,
      message: 'Test started',
      state: testState
    });

  } catch (err) {
    console.error('Failed to start test:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /test/stop
 * Stop the running test
 */
app.post('/test/stop', (req, res) => {
  if (!testState.running || !testProcess) {
    return res.status(400).json({ error: 'No test running' });
  }

  const endTime = now();

  try {
    testProcess.kill('SIGTERM');

    // Give it a moment to clean up, then force kill if needed
    setTimeout(() => {
      if (testProcess && !testProcess.killed) {
        testProcess.kill('SIGKILL');
      }
    }, 2000);

    testState.running = false;
    testState.endTime = endTime;

    res.json({
      success: true,
      message: 'Test stopped',
      state: testState,
      testPeriod: {
        start: testState.startTime,
        end: endTime,
        durationSeconds: endTime - testState.startTime
      }
    });

  } catch (err) {
    console.error('Failed to stop test:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /test/status
 * Get current test status
 */
app.get('/test/status', (req, res) => {
  const trades = readTradeLog('test_trades.json');

  res.json({
    ...testState,
    tradeCount: trades.trades?.length || 0,
    uptime: testState.running ? now() - testState.startTime : null
  });
});

/**
 * GET /test/trades
 * Get current trades from test
 */
app.get('/test/trades', (req, res) => {
  const trades = readTradeLog('test_trades.json');
  res.json(trades);
});

// =============================================================================
// BACKTEST ENDPOINTS
// =============================================================================

/**
 * POST /backtest/run
 * Run backtest over specific time period
 * Body: { start: number, end: number, strategy?: string, exchange?: string, pairs?: string[] }
 */
app.post('/backtest/run', async (req, res) => {
  if (backtestState.running) {
    return res.status(400).json({
      error: 'Backtest already running',
      pid: backtestState.pid
    });
  }

  const {
    start,
    end,
    strategy = testState.strategy || 'PairTradeBot',
    exchange = testState.exchange || 'bitmex',
    pairs = testState.pairs || ['XBTUSD']
  } = req.body || {};

  if (!start || !end) {
    return res.status(400).json({
      error: 'Missing start or end timestamp',
      hint: 'Provide Unix timestamps in body: { start: number, end: number }'
    });
  }

  // Build command args
  const args = [
    'backtest',
    '--start', String(start),
    '--end', String(end),
    '--bot', strategy,
    '--exchange', exchange,
    '--pairs', pairs.join(','),
    '--log-trades', path.join(TRADES_DIR, 'backtest_trades.json'),
    '--local-archive',
    '--verbose'
  ];

  console.log(`Starting backtest: ${BOT_BINARY} ${args.join(' ')}`);

  try {
    backtestProcess = spawn(BOT_BINARY, args, {
      cwd: CPP_REPO,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    backtestState = {
      running: true,
      startTime: start,
      endTime: end,
      strategy,
      pid: backtestProcess.pid
    };

    backtestProcess.stdout.on('data', (data) => {
      console.log(`[BACKTEST stdout] ${data}`);
    });
    backtestProcess.stderr.on('data', (data) => {
      console.error(`[BACKTEST stderr] ${data}`);
    });

    backtestProcess.on('close', (code) => {
      console.log(`Backtest process exited with code ${code}`);
      backtestState.running = false;
      backtestProcess = null;
    });

    res.json({
      success: true,
      message: 'Backtest started',
      state: backtestState
    });

  } catch (err) {
    console.error('Failed to start backtest:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /backtest/status
 * Get backtest status
 */
app.get('/backtest/status', (req, res) => {
  const trades = readTradeLog('backtest_trades.json');

  res.json({
    ...backtestState,
    tradeCount: trades.trades?.length || 0
  });
});

/**
 * GET /backtest/trades
 * Get trades from backtest
 */
app.get('/backtest/trades', (req, res) => {
  const trades = readTradeLog('backtest_trades.json');
  res.json(trades);
});

// =============================================================================
// MARKET MODE ENDPOINTS
// =============================================================================

/**
 * POST /market/start
 * Start MARKET mode - connects to live BitMEX WebSocket for real-time trading
 */
app.post('/market/start', (req, res) => {
  if (marketState.running) {
    return res.status(400).json({
      error: 'MARKET mode already running',
      pid: marketState.pid
    });
  }

  const {
    strategy = 'PairTradeBot',
    exchange = 'bitmex',
    pairs = ['XBTUSD']
  } = req.body || {};

  // Trade log path for market mode
  const tradesFile = path.join(TRADES_DIR, 'market_trades.json');

  // Build command args for MARKET mode (live trading)
  const args = [
    'market',
    '--bot', strategy,
    '--exchange', exchange,
    '--pairs', pairs.join(','),
    '--log-trades', tradesFile,
    '--verbose'
  ];

  console.log(`Starting MARKET mode: ${BOT_BINARY} ${args.join(' ')}`);

  // Optionally load database credentials for archiving
  const dbCreds = loadDbCredentials();
  const env = { ...process.env };
  let dbConfigured = false;

  // Set ARCHIVE_PATH for LocalArchiver
  env.ARCHIVE_PATH = '/opt/hm-trading/archive/';

  if (dbCreds && dbCreds.DB_USER && dbCreds.DB_PASSWORD) {
    env.DB_HOST = dbCreds.DB_HOST || '127.0.0.1';
    env.DB_PORT = dbCreds.DB_PORT || '3306';
    env.DB_NAME = dbCreds.DB_DATABASE || 'bitbot_markets_new';
    env.DB_USER = dbCreds.DB_USER;
    env.DB_PASSWORD = dbCreds.DB_PASSWORD;
    dbConfigured = true;
    console.log(`Database archiving enabled: ${dbCreds.DB_HOST}:${dbCreds.DB_PORT}/${dbCreds.DB_DATABASE}`);
  }

  try {
    marketProcess = spawn(BOT_BINARY, args, {
      cwd: CPP_REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });

    marketState = {
      running: true,
      startTime: Math.floor(Date.now() / 1000),
      endTime: null,
      strategy,
      exchange,
      pairs,
      pid: marketProcess.pid,
      tradesFile
    };

    marketProcess.stdout.on('data', (data) => {
      console.log(`[MARKET stdout] ${data}`);
    });
    marketProcess.stderr.on('data', (data) => {
      console.error(`[MARKET stderr] ${data}`);
    });

    marketProcess.on('close', (code) => {
      console.log(`Market process exited with code ${code}`);
      marketState.running = false;
      marketState.endTime = Math.floor(Date.now() / 1000);
      marketProcess = null;
    });

    marketProcess.on('error', (err) => {
      console.error('Market process error:', err);
      marketState.running = false;
      marketProcess = null;
    });

    // Start watching trade file for websocket streaming
    setTimeout(() => {
      startTradeFileWatcher(tradesFile);
    }, 1000);

    // Broadcast market start to websocket clients
    broadcastTrades([], 'market_started');

    res.json({
      success: true,
      message: 'MARKET mode started - connected to live BitMEX WebSocket',
      state: marketState,
      databaseArchiving: dbConfigured,
      websocket: `ws://localhost:${PORT}/trades/stream`
    });

  } catch (err) {
    console.error('Failed to start MARKET mode:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /market/stop
 * Stop MARKET mode
 */
app.post('/market/stop', (req, res) => {
  if (!marketState.running || !marketProcess) {
    return res.status(400).json({ error: 'MARKET mode not running' });
  }

  const stopTime = Math.floor(Date.now() / 1000);

  stopTradeFileWatcher();
  broadcastTrades([], 'market_stopped');

  try {
    marketProcess.kill('SIGTERM');

    setTimeout(() => {
      if (marketProcess && !marketProcess.killed) {
        marketProcess.kill('SIGKILL');
      }
    }, 2000);

    const duration = stopTime - marketState.startTime;
    marketState.running = false;
    marketState.endTime = stopTime;

    // Read final trade count
    let tradeCount = 0;
    if (marketState.tradesFile && fs.existsSync(marketState.tradesFile)) {
      try {
        const content = fs.readFileSync(marketState.tradesFile, 'utf8');
        tradeCount = content.trim().split('\n').filter(line => line.length > 0).length;
      } catch (err) { /* ignore */ }
    }

    res.json({
      success: true,
      message: 'MARKET mode stopped',
      state: marketState,
      tradeCount,
      marketPeriod: {
        start: marketState.startTime,
        end: stopTime,
        durationSeconds: duration,
        durationFormatted: `${Math.floor(duration / 60)}m ${duration % 60}s`
      },
      tradesFile: marketState.tradesFile
    });

  } catch (err) {
    console.error('Failed to stop MARKET mode:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /market/status
 * Get current MARKET mode status
 */
app.get('/market/status', (req, res) => {
  let tradeCount = 0;
  if (marketState.tradesFile) {
    try {
      if (fs.existsSync(marketState.tradesFile)) {
        const content = fs.readFileSync(marketState.tradesFile, 'utf8');
        tradeCount = content.trim().split('\n').filter(line => line.length > 0).length;
      }
    } catch (err) {
      console.error('Error reading market trades:', err.message);
    }
  }

  const uptime = marketState.running
    ? Math.floor(Date.now() / 1000) - marketState.startTime
    : null;

  res.json({
    ...marketState,
    tradeCount,
    uptime,
    elapsedFormatted: uptime ? `${Math.floor(uptime / 60)}m ${uptime % 60}s` : null
  });
});

/**
 * GET /market/trades
 * Get trades from MARKET mode
 */
app.get('/market/trades', (req, res) => {
  if (!marketState.tradesFile) {
    return res.json({ trades: [], message: 'No market session active or completed' });
  }

  try {
    if (fs.existsSync(marketState.tradesFile)) {
      const content = fs.readFileSync(marketState.tradesFile, 'utf8');
      return res.json(JSON.parse(content));
    }
  } catch (err) {
    console.error('Error reading market trades:', err.message);
  }

  res.json({ trades: [] });
});

// =============================================================================
// SESSION ENDPOINTS
// =============================================================================

/**
 * GET /session/test
 * Get test session data in dashboard-expected format
 */
app.get('/session/test', (req, res) => {
  const rawData = readTradeLog('test_trades.json');

  if (!rawData.trades || rawData.trades.length === 0) {
    return res.json({
      success: false,
      error: 'No test session data available',
      trades: []
    });
  }

  const sessionResponse = buildSessionResponse(rawData, 'test');
  res.json(sessionResponse);
});

/**
 * GET /session/backtest
 * Get backtest session data in dashboard-expected format
 */
app.get('/session/backtest', (req, res) => {
  const rawData = readTradeLog('backtest_trades.json');

  if (!rawData.trades || rawData.trades.length === 0) {
    return res.json({
      success: false,
      error: 'No backtest session data available',
      trades: []
    });
  }

  const sessionResponse = buildSessionResponse(rawData, 'backtest');
  res.json(sessionResponse);
});

// =============================================================================
// HEALTH & CONFIG ENDPOINTS
// =============================================================================

/**
 * GET /health
 * Health check
 */
app.get('/health', (req, res) => {
  const binaryExists = fs.existsSync(BOT_BINARY);

  res.json({
    status: 'ok',
    botBinary: binaryExists ? 'found' : 'missing',
    botPath: BOT_BINARY,
    testRunning: testState.running,
    backtestRunning: backtestState.running,
    marketRunning: marketState.running,
    dbCredentials: fs.existsSync(DB_ENV_PATH) ? 'configured' : 'missing',
    unifiedApiAvailable: true
  });
});

/**
 * GET /config
 * Get available configuration options
 */
app.get('/config', (req, res) => {
  res.json({
    availableStrategies: ['PairTradeBot', 'MarketMaker', 'TrendFollower'],
    availableExchanges: ['bitmex'],
    defaultPairs: ['XBTUSD', 'ETHUSD', 'SOLUSD'],
    botBinary: BOT_BINARY,
    tradesDir: TRADES_DIR,
    unifiedApi: {
      markets: unifiedApi.SUPPORTED_MARKETS,
      periods: Object.keys(unifiedApi.PERIOD_SECONDS)
    }
  });
});

// =============================================================================
// WEBSOCKET SERVER
// =============================================================================

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/trades/stream' });

let wsClients = new Set();
let lastTradeCount = 0;
let tradeFileWatcher = null;

function broadcastTrades(trades, type = 'trades') {
  const message = JSON.stringify({ type, trades, timestamp: Date.now() });
  wsClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function startTradeFileWatcher(tradesFile) {
  stopTradeFileWatcher();

  if (!tradesFile || !fs.existsSync(tradesFile)) {
    console.log('[WS] Trade file not found, will watch when created:', tradesFile);
    return;
  }

  console.log('[WS] Starting trade file watcher:', tradesFile);
  lastTradeCount = 0;

  try {
    const content = fs.readFileSync(tradesFile, 'utf8');
    const data = JSON.parse(content);
    lastTradeCount = data.trades?.length || 0;
    console.log(`[WS] Initial trade count: ${lastTradeCount}`);
  } catch (err) {
    console.log('[WS] Could not read initial trades:', err.message);
  }

  tradeFileWatcher = fs.watch(tradesFile, { persistent: false }, (eventType) => {
    if (eventType === 'change') {
      try {
        const content = fs.readFileSync(tradesFile, 'utf8');
        const data = JSON.parse(content);
        const allTrades = data.trades || [];
        const currentCount = allTrades.length;

        if (currentCount > lastTradeCount) {
          const newTrades = allTrades.slice(lastTradeCount);
          console.log(`[WS] Broadcasting ${newTrades.length} new trade(s)`);
          broadcastTrades(newTrades, 'new_trades');
          lastTradeCount = currentCount;
        }
      } catch (err) {
        console.log('[WS] Trade file read error (will retry):', err.message);
      }
    }
  });

  tradeFileWatcher.on('error', (err) => {
    console.error('[WS] File watcher error:', err.message);
  });
}

function stopTradeFileWatcher() {
  if (tradeFileWatcher) {
    tradeFileWatcher.close();
    tradeFileWatcher = null;
    console.log('[WS] Trade file watcher stopped');
  }
}

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[WS] Client connected from ${clientIp}`);
  wsClients.add(ws);

  const statusMessage = {
    type: 'status',
    testRunning: testState.running,
    marketRunning: marketState.running,
    backtestRunning: backtestState.running,
    timestamp: Date.now()
  };
  ws.send(JSON.stringify(statusMessage));

  if (marketState.running && marketState.tradesFile) {
    try {
      if (fs.existsSync(marketState.tradesFile)) {
        const content = fs.readFileSync(marketState.tradesFile, 'utf8');
        const data = JSON.parse(content);
        if (data.trades && data.trades.length > 0) {
          ws.send(JSON.stringify({ type: 'trades', trades: data.trades, timestamp: Date.now() }));
        }
      }
    } catch (err) {
      console.log('[WS] Error sending initial trades:', err.message);
    }
  }

  ws.on('close', () => {
    console.log(`[WS] Client disconnected`);
    wsClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
    wsClients.delete(ws);
  });
});

// =============================================================================
// START SERVER
// =============================================================================

server.listen(PORT, () => {
  console.log(`HM Trading Control API running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/trades/stream`);
  console.log(`Unified API endpoints: /api/prices, /api/orderbook, /api/trades, /api/markets`);
  console.log(`Bot binary: ${BOT_BINARY}`);
  console.log(`Binary exists: ${fs.existsSync(BOT_BINARY)}`);
});
