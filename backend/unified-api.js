/**
 * Unified Data API Module
 *
 * Provides market data endpoints that abstract FlatBuffers (live) and MySQL (historical).
 * Supports periods: 1m, 5m, 15m, 1h, 4h, 1d, 1w
 * Markets: XBTUSD, ETHUSD, SOLUSD, XRPUSD, DOGEUSD
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Database configuration
const DB_CONFIG = {
  host: 'bitbot.cp4aykvajqpg.eu-west-1.rds.amazonaws.com',
  port: 3306,
  database: 'bitbot_markets_new',
  user: 'bitbot',
  password: 'Ssb*R%%#&BY*f&hW67?QxW4ShwkkyE',
  connectionLimit: 5,
  waitForConnections: true,
  queueLimit: 0
};

// Period to seconds mapping
const PERIOD_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800
};

// Supported markets
const SUPPORTED_MARKETS = ['xbtusd', 'ethusd', 'solusd', 'xrpusd', 'dogeusd'];

// Market to table name mapping
const MARKET_TABLE_MAP = {
  'xbtusd': 'bitmex_xbt_usd',
  'ethusd': 'bitmex_eth_usd',
  'solusd': 'bitmex_sol_usd',
  'xrpusd': 'bitmex_xrp_usd',
  'dogeusd': 'bitmex_doge_usd'
};

// Local archive path (for FlatBuffers data)
const LOCAL_ARCHIVE_PATH = '/opt/hm-trading/archive/';

let dbPool = null;

/**
 * Initialize the MySQL connection pool
 */
async function initDatabase() {
  if (!dbPool) {
    try {
      dbPool = mysql.createPool(DB_CONFIG);
      // Test connection
      const conn = await dbPool.getConnection();
      console.log('[UnifiedAPI] Database connection established');
      conn.release();
    } catch (err) {
      console.error('[UnifiedAPI] Failed to connect to database:', err.message);
      dbPool = null;
    }
  }
  return dbPool;
}

/**
 * Build table name from market symbol
 */
function getTableName(market, dataType = 'price') {
  const normalizedMarket = market.toLowerCase();
  const tableSuffix = MARKET_TABLE_MAP[normalizedMarket];
  if (!tableSuffix) {
    throw new Error(`Unsupported market: ${market}. Supported: ${SUPPORTED_MARKETS.join(', ')}`);
  }
  return `${dataType}_${tableSuffix}`;
}

/**
 * Convert period string to seconds
 */
function getPeriodSeconds(period) {
  const periodLower = period.toLowerCase();
  const seconds = PERIOD_SECONDS[periodLower];
  if (!seconds) {
    throw new Error(`Unsupported period: ${period}. Supported: ${Object.keys(PERIOD_SECONDS).join(', ')}`);
  }
  return seconds;
}

/**
 * Get price data and aggregate into OHLCV candles
 *
 * @param {string} market - Market symbol (e.g., 'xbtusd')
 * @param {string} period - Candle period (e.g., '1h')
 * @param {number} limit - Maximum number of candles to return
 * @param {number} startTime - Optional start timestamp (unix seconds)
 * @param {number} endTime - Optional end timestamp (unix seconds)
 */
async function getPrices(market, period = '1h', limit = 100, startTime = null, endTime = null) {
  const pool = await initDatabase();
  if (!pool) {
    throw new Error('Database connection not available');
  }

  const tableName = getTableName(market, 'price');
  const periodSeconds = getPeriodSeconds(period);

  // Default time range: last 24 hours if not specified
  const now = Math.floor(Date.now() / 1000);
  const defaultStartTime = now - (periodSeconds * limit);

  const start = startTime || defaultStartTime;
  const end = endTime || now;

  // Convert to milliseconds for database query (DB stores timestamps in ms)
  const startMs = start * 1000;
  const endMs = end * 1000;

  try {
    // Query raw price data
    const [rows] = await pool.execute(
      `SELECT timestamp, price FROM ${tableName}
       WHERE timestamp >= ? AND timestamp < ?
       ORDER BY timestamp ASC
       LIMIT 100000`,
      [startMs, endMs]
    );

    if (rows.length === 0) {
      return { candles: [], market, period, count: 0 };
    }

    // Aggregate into OHLCV candles
    const candles = aggregateToCandles(rows, periodSeconds * 1000);

    // Limit result
    const limitedCandles = candles.slice(-limit);

    return {
      candles: limitedCandles,
      market: market.toUpperCase(),
      period,
      count: limitedCandles.length,
      timeRange: {
        start: limitedCandles.length > 0 ? limitedCandles[0].time : null,
        end: limitedCandles.length > 0 ? limitedCandles[limitedCandles.length - 1].time : null
      }
    };
  } catch (err) {
    console.error(`[UnifiedAPI] Error fetching prices for ${market}:`, err.message);
    throw err;
  }
}

/**
 * Aggregate raw price data into OHLCV candles
 */
function aggregateToCandles(priceData, periodMs) {
  if (!priceData || priceData.length === 0) return [];

  const candles = [];
  let currentCandle = null;
  let currentPeriodStart = null;

  for (const row of priceData) {
    const timestamp = Number(row.timestamp);
    const price = Number(row.price);

    // Calculate period start for this price
    const periodStart = Math.floor(timestamp / periodMs) * periodMs;

    if (currentPeriodStart === null || periodStart !== currentPeriodStart) {
      // Save previous candle if exists
      if (currentCandle) {
        candles.push(currentCandle);
      }

      // Start new candle
      currentPeriodStart = periodStart;
      currentCandle = {
        time: Math.floor(periodStart / 1000), // Convert to unix seconds
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0 // We don't have volume data from price table
      };
    } else {
      // Update current candle
      currentCandle.high = Math.max(currentCandle.high, price);
      currentCandle.low = Math.min(currentCandle.low, price);
      currentCandle.close = price;
    }
  }

  // Don't forget the last candle
  if (currentCandle) {
    candles.push(currentCandle);
  }

  return candles;
}

/**
 * Get orderbook data
 *
 * @param {string} market - Market symbol (e.g., 'xbtusd')
 * @param {number} depth - Number of levels on each side
 */
async function getOrderbook(market, depth = 25) {
  const pool = await initDatabase();
  if (!pool) {
    throw new Error('Database connection not available');
  }

  const tableName = getTableName(market, 'book');

  try {
    // Get the most recent orderbook updates
    // The book table stores incremental updates, so we need to reconstruct
    const [rows] = await pool.execute(
      `SELECT timestamp, action, order_id, amount
       FROM ${tableName}
       ORDER BY timestamp DESC, id DESC
       LIMIT 1000`
    );

    if (rows.length === 0) {
      return {
        market: market.toUpperCase(),
        timestamp: Math.floor(Date.now() / 1000),
        bids: [],
        asks: [],
        message: 'No orderbook data available'
      };
    }

    // Reconstruct orderbook from updates
    // action: 0 = remove, 1 = add/update
    const orderbook = reconstructOrderbook(rows, depth);

    return {
      market: market.toUpperCase(),
      timestamp: orderbook.timestamp,
      bids: orderbook.bids,
      asks: orderbook.asks
    };
  } catch (err) {
    console.error(`[UnifiedAPI] Error fetching orderbook for ${market}:`, err.message);

    // Fallback: return empty orderbook structure
    return {
      market: market.toUpperCase(),
      timestamp: Math.floor(Date.now() / 1000),
      bids: [],
      asks: [],
      error: err.message
    };
  }
}

/**
 * Reconstruct orderbook from database updates
 */
function reconstructOrderbook(updates, depth) {
  // This is a simplified reconstruction
  // In production, you'd maintain a proper orderbook state
  const bidsMap = new Map();
  const asksMap = new Map();
  let latestTimestamp = 0;

  // Process updates in reverse order (oldest first)
  const sortedUpdates = [...updates].reverse();

  for (const update of sortedUpdates) {
    const timestamp = Number(update.timestamp);
    const action = update.action;
    const orderId = Number(update.order_id);
    const amount = Number(update.amount);

    latestTimestamp = Math.max(latestTimestamp, timestamp);

    if (action === 0) {
      // Remove
      bidsMap.delete(orderId);
      asksMap.delete(orderId);
    } else {
      // Add/update - determine side by amount sign or orderId pattern
      // Positive amount = bid, negative = ask (convention may vary)
      if (amount > 0) {
        bidsMap.set(orderId, { price: orderId, amount: amount });
      } else {
        asksMap.set(orderId, { price: orderId, amount: Math.abs(amount) });
      }
    }
  }

  // Convert to arrays and sort
  const bids = Array.from(bidsMap.values())
    .sort((a, b) => b.price - a.price)
    .slice(0, depth);

  const asks = Array.from(asksMap.values())
    .sort((a, b) => a.price - b.price)
    .slice(0, depth);

  return {
    timestamp: Math.floor(latestTimestamp / 1000),
    bids,
    asks
  };
}

/**
 * Get trade history
 *
 * @param {string} market - Market symbol (e.g., 'xbtusd')
 * @param {string} period - Time period to fetch
 * @param {number} limit - Maximum number of trades
 */
async function getTrades(market, period = '1h', limit = 100) {
  const pool = await initDatabase();
  if (!pool) {
    throw new Error('Database connection not available');
  }

  const tableName = getTableName(market, 'price');
  const periodSeconds = getPeriodSeconds(period);

  // Calculate time range
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - periodSeconds;

  const startMs = startTime * 1000;
  const endMs = now * 1000;

  try {
    // Get price updates as "trades" (price changes represent trades)
    const [rows] = await pool.execute(
      `SELECT id, timestamp, price FROM ${tableName}
       WHERE timestamp >= ? AND timestamp < ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [startMs, endMs, limit]
    );

    const trades = rows.map((row, index) => ({
      id: row.id,
      timestamp: Math.floor(Number(row.timestamp) / 1000),
      price: Number(row.price),
      // Determine side by comparing with previous price
      side: index < rows.length - 1 && Number(row.price) > Number(rows[index + 1].price) ? 'buy' : 'sell'
    }));

    return {
      trades: trades.reverse(), // Return in chronological order
      market: market.toUpperCase(),
      period,
      count: trades.length
    };
  } catch (err) {
    console.error(`[UnifiedAPI] Error fetching trades for ${market}:`, err.message);
    throw err;
  }
}

/**
 * Try to read FlatBuffer data from local archive
 * Returns null if not available
 */
function tryReadFlatBuffer(market, dataType, timestamp) {
  try {
    const normalizedMarket = market.toLowerCase();
    const marketParts = MARKET_TABLE_MAP[normalizedMarket];
    if (!marketParts) return null;

    // Build path: archive/bitmex/xbt/usd/price_<period>_<timestamp>.fb.gz
    const [exchange, first, second] = marketParts.split('_');
    const periodStart = Math.floor(timestamp / 60) * 60; // Round to minute

    const archivePath = path.join(
      LOCAL_ARCHIVE_PATH,
      exchange,
      first,
      second,
      `${dataType}_60_${periodStart}.fb.gz`
    );

    if (fs.existsSync(archivePath)) {
      const compressed = fs.readFileSync(archivePath);
      const decompressed = zlib.gunzipSync(compressed);
      // Would need FlatBuffer parser here - returning null for now
      // In production, use flatbuffers npm package
      return null;
    }
  } catch (err) {
    console.log(`[UnifiedAPI] FlatBuffer read failed: ${err.message}`);
  }
  return null;
}

/**
 * Register API endpoints on Express app
 */
function registerEndpoints(app) {
  /**
   * GET /api/prices
   * Returns OHLCV candlestick data
   * Query params:
   *   - market: xbtusd, ethusd, etc. (required)
   *   - period: 1m, 5m, 15m, 1h, 4h, 1d, 1w (default: 1h)
   *   - limit: number of candles (default: 100)
   *   - start: start timestamp in unix seconds (optional)
   *   - end: end timestamp in unix seconds (optional)
   */
  app.get('/api/prices', async (req, res) => {
    try {
      const { market, period = '1h', limit = '100', start, end } = req.query;

      if (!market) {
        return res.status(400).json({
          error: 'Missing required parameter: market',
          supported: SUPPORTED_MARKETS
        });
      }

      const result = await getPrices(
        market,
        period,
        parseInt(limit, 10),
        start ? parseInt(start, 10) : null,
        end ? parseInt(end, 10) : null
      );

      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * GET /api/orderbook
   * Returns current orderbook
   * Query params:
   *   - market: xbtusd, ethusd, etc. (required)
   *   - depth: number of levels (default: 25)
   */
  app.get('/api/orderbook', async (req, res) => {
    try {
      const { market, depth = '25' } = req.query;

      if (!market) {
        return res.status(400).json({
          error: 'Missing required parameter: market',
          supported: SUPPORTED_MARKETS
        });
      }

      const result = await getOrderbook(market, parseInt(depth, 10));

      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * GET /api/trades
   * Returns trade history
   * Query params:
   *   - market: xbtusd, ethusd, etc. (required)
   *   - period: 1m, 5m, 15m, 1h, 4h, 1d, 1w (default: 1h)
   *   - limit: number of trades (default: 100)
   */
  app.get('/api/trades', async (req, res) => {
    try {
      const { market, period = '1h', limit = '100' } = req.query;

      if (!market) {
        return res.status(400).json({
          error: 'Missing required parameter: market',
          supported: SUPPORTED_MARKETS
        });
      }

      const result = await getTrades(market, period, parseInt(limit, 10));

      res.json({
        success: true,
        ...result
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  /**
   * GET /api/markets
   * Returns list of supported markets and periods
   */
  app.get('/api/markets', (req, res) => {
    res.json({
      success: true,
      markets: SUPPORTED_MARKETS.map(m => m.toUpperCase()),
      periods: Object.keys(PERIOD_SECONDS),
      periodSeconds: PERIOD_SECONDS
    });
  });

  console.log('[UnifiedAPI] Endpoints registered: /api/prices, /api/orderbook, /api/trades, /api/markets');
}

module.exports = {
  initDatabase,
  registerEndpoints,
  getPrices,
  getOrderbook,
  getTrades,
  SUPPORTED_MARKETS,
  PERIOD_SECONDS
};
