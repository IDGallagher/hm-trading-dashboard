// Centralized API client and endpoint wrappers for HM Trading Dashboard.
(function () {
    function normalizeEpochMs(value) {
        const num = Number(value);
        if (!Number.isFinite(num) || num <= 0) return null;
        // Values above ~year 5138 in seconds are almost certainly milliseconds.
        return num > 1e11 ? Math.floor(num) : Math.floor(num * 1000);
    }

    function normalizeLiveTradeDelta(rawTrade) {
        if (!rawTrade || typeof rawTrade !== 'object') return null;

        const timestampMs = normalizeEpochMs(rawTrade.t ?? rawTrade.timestamp ?? rawTrade.ts);
        const price = Number(rawTrade.p ?? rawTrade.price);
        const amount = Number(rawTrade.a ?? rawTrade.amount ?? 0);
        if (!timestampMs || !Number.isFinite(price)) return null;

        const sideRaw = String(rawTrade.s ?? rawTrade.side ?? '').toLowerCase();
        const side = sideRaw === 'sell' || sideRaw === 's' ? 'sell' : 'buy';

        return {
            timestampMs,
            timestamp: Math.floor(timestampMs / 1000),
            price,
            amount: Number.isFinite(amount) ? amount : 0,
            side
        };
    }

    function normalizeLiveTradesDeltasPayload(payload) {
        const normalizedTrades = (payload?.trades || [])
            .map(normalizeLiveTradeDelta)
            .filter(Boolean);

        const latestTimestampFromPayload = normalizeEpochMs(payload?.latestTimestamp);
        const fallbackLatestTimestamp = normalizedTrades.length > 0
            ? Math.max(...normalizedTrades.map((trade) => trade.timestampMs))
            : null;

        return {
            ...(payload || {}),
            trades: normalizedTrades,
            latestTimestamp: latestTimestampFromPayload || fallbackLatestTimestamp
        };
    }

    function buildUrl(path, query) {
        const url = new URL(path, CONTROL_API_URL);
        if (query && typeof query === 'object') {
            Object.entries(query).forEach(([key, value]) => {
                if (value === undefined || value === null || value === '') return;
                url.searchParams.set(key, String(value));
            });
        }
        return url.toString();
    }

    function makeHeaders(extraHeaders = {}, includeJson = false) {
        const headers = { 'x-api-key': CONTROL_API_KEY, ...extraHeaders };
        if (includeJson) headers['Content-Type'] = 'application/json';
        return headers;
    }

    async function request(method, path, { query, body, headers, signal } = {}) {
        const url = buildUrl(path, query);
        const includeJson = body !== undefined && body !== null;
        const response = await fetch(url, {
            method,
            headers: makeHeaders(headers, includeJson),
            body: includeJson ? JSON.stringify(body) : undefined,
            signal
        });
        return response;
    }

    async function requestJson(method, path, options = {}) {
        const response = await request(method, path, options);
        let payload = null;
        try {
            payload = await response.json();
        } catch (_err) {
            payload = null;
        }

        if (!response.ok) {
            const message = payload?.error || payload?.message || `HTTP ${response.status}`;
            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    }

    const HM_API = {
        request,
        requestJson,
        get: (path, options) => request('GET', path, options),
        getJson: (path, options) => requestJson('GET', path, options),
        postJson: (path, body, options = {}) => requestJson('POST', path, { ...options, body }),
        patchJson: (path, body, options = {}) => requestJson('PATCH', path, { ...options, body }),
        deleteJson: (path, body, options = {}) => requestJson('DELETE', path, { ...options, body }),

        strategies: {
            list: () => requestJson('GET', '/strategies')
        },

        sessions: {
            list: (query = {}) => requestJson('GET', '/sessions', { query }),
            health: () => requestJson('GET', '/sessions/health'),
            get: (sessionId) => requestJson('GET', `/sessions/${sessionId}`),
            create: (body) => requestJson('POST', '/sessions', { body }),
            start: (sessionId) => requestJson('POST', `/sessions/${sessionId}/start`),
            stop: (sessionId) => requestJson('POST', `/sessions/${sessionId}/stop`),
            restart: (sessionId) => requestJson('POST', `/sessions/${sessionId}/restart`),
            clone: (sessionId) => requestJson('POST', `/sessions/${sessionId}/clone`),
            delete: (sessionId) => requestJson('DELETE', `/sessions/${sessionId}`),
            tradingStart: (sessionId) => requestJson('GET', `/sessions/${sessionId}/trading-start`),
            heartbeat: (sessionId) => requestJson('GET', `/sessions/${sessionId}/heartbeat`),
            metrics: (sessionId) => requestJson('GET', `/sessions/${sessionId}/metrics`),
            logs: (sessionId, query = {}) => requestJson('GET', `/sessions/${sessionId}/logs`, { query })
        },

        sessionData: {
            tradesDb: (sessionId, query = {}) => requestJson('GET', `/sessions/${sessionId}/trades/db`, { query }),
            tradesFile: (sessionId, query = {}) => requestJson('GET', `/sessions/${sessionId}/trades`, { query }),
            equityCurve: (sessionId, query = {}) => requestJson('GET', `/sessions/${sessionId}/equity-curve`, { query }),
            equityFile: (sessionId, query = {}) => requestJson('GET', `/sessions/${sessionId}/equity`, { query }),
            positions: (sessionId) => requestJson('GET', `/sessions/${sessionId}/positions`),
            tradeSummary: (sessionId) => requestJson('GET', `/sessions/${sessionId}/trades/summary`)
        },

        live: {
            prices: (query = {}, options = {}) => requestJson('GET', '/api/prices', { ...options, query }),
            orderbook: (query = {}, options = {}) => requestJson('GET', '/api/orderbook', { ...options, query }),
            tradesDeltas: (query = {}, options = {}) => requestJson('GET', '/api/trades/deltas', { ...options, query }),
            tradesDeltasNormalized: async (query = {}, options = {}) => {
                const payload = await requestJson('GET', '/api/trades/deltas', { ...options, query });
                return normalizeLiveTradesDeltasPayload(payload);
            },
            archiveInfo: (query = {}, options = {}) => requestJson('GET', '/api/archive/info', { ...options, query }),
            polymarketMetadata: (query = {}, options = {}) => requestJson('GET', '/api/polymarket/metadata', { ...options, query })
        },

        test: {
            start: (body) => requestJson('POST', '/test/start', { body }),
            stopAndBacktest: (body) => requestJson('POST', '/test/stop-and-backtest', { body }),
            status: () => requestJson('GET', '/test/status')
        },

        legacySession: {
            test: () => requestJson('GET', '/session/test'),
            backtest: () => requestJson('GET', '/session/backtest'),
            byPath: (path) => requestJson('GET', path)
        },

        adapters: {
            normalizeEpochMs,
            normalizeLiveTradeDelta,
            normalizeLiveTradesDeltasPayload
        }
    };

    window.HM_API = HM_API;
})();
