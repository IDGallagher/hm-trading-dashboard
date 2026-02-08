// Centralized API client and endpoint wrappers for HM Trading Dashboard.
(function () {
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

    async function request(method, path, { query, body, headers } = {}) {
        const url = buildUrl(path, query);
        const includeJson = body !== undefined && body !== null;
        const response = await fetch(url, {
            method,
            headers: makeHeaders(headers, includeJson),
            body: includeJson ? JSON.stringify(body) : undefined
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
            prices: (query = {}) => requestJson('GET', '/api/prices', { query }),
            orderbook: (query = {}) => requestJson('GET', '/api/orderbook', { query }),
            tradesDeltas: (query = {}) => requestJson('GET', '/api/trades/deltas', { query }),
            archiveInfo: (query = {}) => requestJson('GET', '/api/archive/info', { query }),
            polymarketMetadata: (query = {}) => requestJson('GET', '/api/polymarket/metadata', { query })
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
        }
    };

    window.HM_API = HM_API;
})();
