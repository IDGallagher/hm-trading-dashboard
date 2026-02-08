        // ==========================================
        // GLOBAL ERROR HANDLER - Captures JS errors for debugging
        // ==========================================
        const jsErrorLog = [];
        const MAX_ERROR_LOG = 50;

        function logJsError(type, message, source, line, col, stack) {
            // Filter out known harmless TradingView library errors
            if (String(message).includes('Value is null')) {
                return; // Don't display this known harmless error
            }

            const entry = {
                time: new Date().toLocaleTimeString(),
                type: type,
                message: String(message).substring(0, 200),
                source: source ? String(source).split('/').pop() : '',
                line: line || '',
                col: col || '',
                stack: stack || ''
            };
            jsErrorLog.unshift(entry);
            if (jsErrorLog.length > MAX_ERROR_LOG) jsErrorLog.pop();
            updateErrorPanel();
        }

        // Helper to wrap async functions with error catching
        function safeAsync(fn, fnName) {
            return async function(...args) {
                try {
                    return await fn.apply(this, args);
                } catch (err) {
                    const stack = err.stack || '';
                    const location = stack.split('\n')[1] || '';
                    logJsError('AsyncError', `${fnName}: ${err.message}`, location, '', '', stack);
                    throw err; // Re-throw so caller knows it failed
                }
            };
        }

        function updateErrorPanel() {
            const panel = document.getElementById('js-error-panel');
            const list = document.getElementById('js-error-list');
            if (!panel || !list) return;

            if (jsErrorLog.length > 0) {
                panel.style.display = 'block';
                panel.style.visibility = 'visible';
                panel.style.opacity = '1';
                list.innerHTML = jsErrorLog.map(e =>
                    `<div class="js-error-entry" title="${e.stack ? e.stack.replace(/"/g, '&quot;') : ''}">
                        <span class="error-time">[${e.time}]</span>
                        <span class="error-type">${e.type}</span>
                        <span class="error-msg">${e.message}</span>
                        <span class="error-loc">${e.source}${e.line ? ':'+e.line : ''}</span>
                    </div>`
                ).join('');
            } else {
                panel.style.display = 'none';
            }
        }

        // Catch synchronous errors
        window.onerror = function(message, source, line, col, error) {
            const stack = error?.stack || '';
            logJsError('Error', message, source, line, col, stack);
            return false; // Let error propagate to console too
        };

        // Catch unhandled promise rejections
        window.addEventListener('unhandledrejection', function(event) {
            const reason = event.reason;
            const message = reason?.message || reason?.toString() || 'Unknown promise rejection';
            logJsError('Promise', message, reason?.stack?.split('\n')[1] || '', '', '');
        });

        // Safe wrapper for chart setData calls - logs errors with source identification
        function safeSetData(series, data, sourceName) {
            console.log("SAFESETDATA CALLED:", sourceName);
            if (!series) {
                console.warn(`[Chart] safeSetData: series is null for ${sourceName}`);
                return false;
            }
            if (!data) {
                console.warn(`[Chart] safeSetData: data is null for ${sourceName}`);
                return false;
            }
            if (!Array.isArray(data)) {
                console.warn(`[Chart] safeSetData: data is not array for ${sourceName}`, typeof data);
                return false;
            }
            // Filter out any null/invalid data points
            // Handle both line series (value) and candlestick series (OHLC)
            const validData = data.filter(d => {
                if (!d || typeof d.time !== 'number' || d.time <= 0) return false;

                // Check if it's candlestick data (has OHLC fields)
                if ('open' in d || 'high' in d || 'low' in d || 'close' in d) {
                    return typeof d.open === 'number' && !isNaN(d.open) &&
                           typeof d.high === 'number' && !isNaN(d.high) &&
                           typeof d.low === 'number' && !isNaN(d.low) &&
                           typeof d.close === 'number' && !isNaN(d.close);
                }

                // Line series data (has value field)
                return d.value !== null &&
                       d.value !== undefined &&
                       typeof d.value === 'number' &&
                       !isNaN(d.value);
            });
            if (validData.length === 0) {
                console.warn(`[Chart] safeSetData: no valid data points for ${sourceName}`);
                return false;
            }
            try {
                series.setData(validData);
                return true;
            } catch (err) {
                logJsError('ChartSetData', `${sourceName}: ${err.message}`, '', '', '', err.stack);
                console.error(`[Chart] setData failed for ${sourceName}:`, err);
                return false;
            }
        }

        // Safe wrapper for chart setMarkers calls
        function safeSetMarkers(series, markers, sourceName) {
            if (!series) {
                console.warn(`[Chart] safeSetMarkers: series is null for ${sourceName}`);
                return false;
            }
            try {
                series.setMarkers(markers || []);
                return true;
            } catch (err) {
                logJsError('ChartSetMarkers', `${sourceName}: ${err.message}`, '', '', '', err.stack);
                console.error(`[Chart] setMarkers failed for ${sourceName}:`, err);
                return false;
            }
        }

        // Safe wrapper for chart update calls (single point updates)
        function safeUpdate(series, point, sourceName) {
            console.log("SAFEUPDATE CALLED:", sourceName);
            if (!series) {
                console.warn(`[Chart] safeUpdate: series is null for ${sourceName}`);
                return false;
            }
            if (!point) {
                console.warn(`[Chart] safeUpdate: point is null for ${sourceName}`);
                return false;
            }
            // Validate time
            if (typeof point.time !== 'number' || point.time <= 0) {
                console.warn(`[Chart] safeUpdate: invalid time for ${sourceName}`, point.time);
                return false;
            }
            // Validate OHLC data if present
            if ('open' in point || 'high' in point || 'low' in point || 'close' in point) {
                if (typeof point.open !== 'number' || isNaN(point.open) ||
                    typeof point.high !== 'number' || isNaN(point.high) ||
                    typeof point.low !== 'number' || isNaN(point.low) ||
                    typeof point.close !== 'number' || isNaN(point.close)) {
                    console.warn(`[Chart] safeUpdate: invalid OHLC for ${sourceName}`, point);
                    return false;
                }
            }
            // Validate value if present (line series)
            if ('value' in point) {
                if (point.value === null || point.value === undefined ||
                    typeof point.value !== 'number' || isNaN(point.value)) {
                    console.warn(`[Chart] safeUpdate: invalid value for ${sourceName}`, point.value);
                    return false;
                }
            }
            try {
                console.log("SAFEUPDATE: BEFORE series.update()");
                series.update(point);
                console.log("SAFEUPDATE: AFTER series.update() - SUCCESS");
                return true;
            } catch (err) {
                console.log("SAFEUPDATE: CAUGHT ERROR in series.update()");
                logJsError('ChartUpdate', `${sourceName}: ${err.message}`, '', '', '', err.stack);
                console.error(`[Chart] update failed for ${sourceName}:`, err);
                return false;
            }
        }

        // Global state
        let currentData = null;
        let testSessionData = null;
        let backtestSessionData = null;
        let mainChart = null;
        let equityChart = null;
        let currentBot = 'DivergeBot';
        let currentPeriod = 'all';
        let currentSession = 'backtest';
        let currentCandlePeriod = '1m';
        let rawCandles = null; // Store original 1m candles

        // Adaptive time formatter for equity charts
        // Adjusts time label format based on zoom level
        function setupAdaptiveTimeFormat(chart) {
            const timeScale = chart.timeScale();

            // Create adaptive tick formatter
            const adaptiveTickFormatter = (time, tickMarkType, locale) => {
                const date = new Date(time * 1000);

                // Get visible range to determine zoom level
                const visibleRange = timeScale.getVisibleLogicalRange();
                let barsVisible = 100; // default
                if (visibleRange) {
                    barsVisible = Math.abs(visibleRange.to - visibleRange.from);
                }

                // Also check visible time range
                const visibleTimeRange = timeScale.getVisibleRange();
                let timeSpanSeconds = 86400 * 7; // default 1 week
                if (visibleTimeRange && visibleTimeRange.from && visibleTimeRange.to) {
                    timeSpanSeconds = visibleTimeRange.to - visibleTimeRange.from;
                }

                const hours = timeSpanSeconds / 3600;
                const days = timeSpanSeconds / 86400;

                // Format based on zoom level
                if (days > 7) {
                    // Wide range (weeks+) - show date only
                    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                } else if (days > 1) {
                    // Medium-wide range (days) - show date
                    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                } else if (hours > 6) {
                    // Medium range (hours) - show date + hour
                    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
                           ' ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                } else if (hours > 1) {
                    // Narrow range (hours) - show hour:minute
                    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                } else {
                    // Very narrow range (minutes) - show hour:minute:second
                    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                }
            };

            // Apply the formatter
            timeScale.applyOptions({
                tickMarkFormatter: adaptiveTickFormatter
            });

            // Force re-render on visible range change to update labels
            timeScale.subscribeVisibleLogicalRangeChange(() => {
                // Trigger a re-render by slightly updating options
                // This ensures tick marks get recalculated with new zoom level
                try {
                    console.log("VISIBLERANGE: calling chart.applyOptions()");
                    chart.applyOptions({});
                    console.log("VISIBLERANGE: applyOptions completed");
                } catch (err) {
                    console.log("VISIBLERANGE: ERROR in applyOptions:", err.message);
                }
            });
        }

        // Live Test Control State - use same origin as page
        const CONTROL_API_URL = window.location.origin;
        const CONTROL_API_KEY = 'hm-trading-dev-key-2025';

        // ==========================================
        // SESSION DATA API HELPERS (Phase 3 Migration)
        // Try new DB endpoints first, fall back to file-based
        // ==========================================

        /**
         * Fetch session trades - tries DB endpoint first, falls back to file-based
         * @param {string} sessionId - Session UUID
         * @param {object} options - { limit, offset }
         * @returns {object} { success, trades, count, total, source }
         */
        async function fetchSessionTrades(sessionId, options = {}) {
            const { limit = 1000, offset = 0 } = options;
            const headers = { 'x-api-key': CONTROL_API_KEY };

            // Try new DB endpoint first
            try {
                const dbResponse = await fetch(
                    `${CONTROL_API_URL}/sessions/${sessionId}/trades/db?limit=${limit}&offset=${offset}`,
                    { headers }
                );
                if (dbResponse.ok) {
                    const data = await dbResponse.json();
                    // Check if DB has data
                    if (data.trades && data.trades.length > 0) {
                        // Map field names: direction->side, realized_pnl->pnl for compatibility
                        const mappedTrades = data.trades.map(t => ({
                            ...t,
                            side: t.direction,
                            pnl: t.realized_pnl
                        }));
                        return { success: true, trades: mappedTrades, count: data.count, total: data.total, source: 'db' };
                    }
                }
            } catch (e) {
                console.log('[fetchSessionTrades] DB endpoint failed, trying file-based:', e.message);
            }

            // Fall back to file-based endpoint
            try {
                const fileResponse = await fetch(
                    `${CONTROL_API_URL}/sessions/${sessionId}/trades?limit=${limit}&offset=${offset}`,
                    { headers }
                );
                if (fileResponse.ok) {
                    const data = await fileResponse.json();
                    return { success: true, trades: data.trades || [], count: data.count || 0, total: data.count || 0, source: 'file' };
                }
            } catch (e) {
                console.error('[fetchSessionTrades] File endpoint failed:', e.message);
            }

            return { success: false, trades: [], count: 0, total: 0, source: 'none' };
        }

        /**
         * Fetch session equity curve - tries DB endpoint first, falls back to file-based
         * @param {string} sessionId - Session UUID
         * @param {object} options - { limit }
         * @returns {object} { success, equity, count, final_equity, source }
         */
        async function fetchSessionEquity(sessionId, options = {}) {
            const { limit = 1000 } = options;
            const headers = { 'x-api-key': CONTROL_API_KEY };

            // Try new DB endpoint first
            try {
                const dbResponse = await fetch(
                    `${CONTROL_API_URL}/sessions/${sessionId}/equity-curve?limit=${limit}`,
                    { headers }
                );
                if (dbResponse.ok) {
                    const data = await dbResponse.json();
                    // Check if DB has data
                    if (data.equity_curve && data.equity_curve.length > 0) {
                        return {
                            success: true,
                            equity: data.equity_curve,
                            count: data.count,
                            final_equity: data.final_equity,
                            max_drawdown: data.max_drawdown,
                            source: 'db'
                        };
                    }
                }
            } catch (e) {
                console.log('[fetchSessionEquity] DB endpoint failed, trying file-based:', e.message);
            }

            // Fall back to file-based endpoint
            try {
                const fileResponse = await fetch(
                    `${CONTROL_API_URL}/sessions/${sessionId}/equity`,
                    { headers }
                );
                if (fileResponse.ok) {
                    const data = await fileResponse.json();
                    return {
                        success: true,
                        equity: data.equity || [],
                        count: data.count || 0,
                        final_equity: data.final_equity || 0,
                        source: 'file'
                    };
                }
            } catch (e) {
                console.error('[fetchSessionEquity] File endpoint failed:', e.message);
            }

            return { success: false, equity: [], count: 0, final_equity: 0, source: 'none' };
        }

        /**
         * Fetch session positions - new DB endpoint only
         * @param {string} sessionId - Session UUID
         * @returns {object} { success, positions, count }
         */
        async function fetchSessionPositions(sessionId) {
            const headers = { 'x-api-key': CONTROL_API_KEY };
            try {
                const response = await fetch(
                    `${CONTROL_API_URL}/sessions/${sessionId}/positions`,
                    { headers }
                );
                if (response.ok) {
                    const data = await response.json();
                    return { success: true, positions: data.positions || [], count: data.count || 0 };
                }
            } catch (e) {
                console.error('[fetchSessionPositions] Failed:', e.message);
            }
            return { success: false, positions: [], count: 0 };
        }

        /**
         * Fetch session trade summary - new DB endpoint only
         * @param {string} sessionId - Session UUID
         * @returns {object} { success, summary }
         */
        async function fetchSessionTradeSummary(sessionId) {
            const headers = { 'x-api-key': CONTROL_API_KEY };
            try {
                const response = await fetch(
                    `${CONTROL_API_URL}/sessions/${sessionId}/trades/summary`,
                    { headers }
                );
                if (response.ok) {
                    const data = await response.json();
                    return { success: true, summary: data.summary };
                }
            } catch (e) {
                console.error('[fetchSessionTradeSummary] Failed:', e.message);
            }
            return { success: false, summary: null };
        }

