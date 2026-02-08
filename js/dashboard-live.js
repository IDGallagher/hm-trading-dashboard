
        let liveTestRunning = false;
        let liveTestStartTime = null;
        let currentStrategy = 'TestBot';

        // Bot configurations for display
        const botConfigs = {
            DivergeBot: { icon: '🔀', color: '#00c853', desc: 'Price ratio divergence trading' },
            SazBot: { icon: '📈', color: '#00d4ff', desc: 'Order book imbalance analysis' },
            SDBot: { icon: '📉', color: '#ffc107', desc: 'Standard deviation mean reversion' },
            PairTradeBot: { icon: '📊', color: '#7b2cbf', desc: 'Statistical arbitrage' }
        };

        // Error Toast Functions
        function showErrorToast(title, message, duration = 8000) {
            const toast = document.getElementById('error-toast');
            const titleEl = document.getElementById('error-toast-title');
            const messageEl = document.getElementById('error-toast-message');

            titleEl.textContent = title;
            messageEl.textContent = message;
            toast.classList.add('show');

            // Auto-hide after duration
            if (duration > 0) {
                setTimeout(() => hideErrorToast(), duration);
            }
        }

        function hideErrorToast() {
            document.getElementById('error-toast').classList.remove('show');
        }

        // ==========================================
        // LIVE MARKET DATA FUNCTIONS
        // ==========================================

        let liveMarketChart = null;
        let liveMarketCandleSeries = null;
        let currentMarket = 'xbtusd';
        let currentMarketPeriod = '5m';
        let marketRequestVersion = 0;
        const activeMarketRequestControllers = new Set();

        function isAbortError(err) {
            return err?.name === 'AbortError';
        }

        function beginTrackedMarketRequest() {
            const controller = new AbortController();
            activeMarketRequestControllers.add(controller);
            return {
                controller,
                signal: controller.signal,
                version: marketRequestVersion,
                market: currentMarket,
                period: currentMarketPeriod
            };
        }

        function endTrackedMarketRequest(requestContext) {
            if (!requestContext?.controller) return;
            activeMarketRequestControllers.delete(requestContext.controller);
        }

        function isStaleMarketRequest(requestContext, checkPeriod = false) {
            if (!requestContext) return true;
            if (requestContext.version !== marketRequestVersion) return true;
            if (requestContext.market !== currentMarket) return true;
            if (checkPeriod && requestContext.period !== currentMarketPeriod) return true;
            return false;
        }

        function cancelInFlightMarketRequests(reason = 'market-context-change') {
            marketRequestVersion += 1;
            for (const controller of activeMarketRequestControllers) {
                try {
                    controller.abort(reason);
                } catch (_err) {
                    // ignore
                }
            }
            activeMarketRequestControllers.clear();
            latestTradeTimestamp = 0;
        }

        window.onLiveMarketContextChange = function onLiveMarketContextChange(reason) {
            cancelInFlightMarketRequests(reason || 'market-context-change');
        };

        // Live forming candle state
        let formingCandle = null;  // { time, open, high, low, close, volume }
        let lastCandleData = [];   // Store the historical candles for reference

        // Lazy loading state for historical candles
        let earliestCandleTime = null;  // Track earliest loaded candle timestamp
        let isLoadingOlderCandles = false;  // Prevent concurrent fetches
        let archiveMinTime = null;  // Track archive data availability

        // Period duration in seconds
        const PERIOD_SECONDS = {
            '1m': 60,
            '5m': 300,
            '15m': 900,
            '1h': 3600,
            '4h': 14400,
            '1d': 86400,
            '1w': 604800
        };

        // Get the start time for a candle period containing the given timestamp
        function getPeriodStartTime(timestamp, period) {
            const periodSecs = PERIOD_SECONDS[period] || 300;
            return Math.floor(timestamp / periodSecs) * periodSecs;
        }

        // Initialize or update the forming candle from a trade
        function updateFormingCandle(trade) {
            if (!liveMarketCandleSeries) return;

            // Get raw timestamp, defaulting to current time in seconds
            const rawTimestamp = trade.timestamp || Math.floor(Date.now() / 1000);
            // Convert milliseconds to seconds if needed (timestamps > year 2033 are likely in ms)
            const tradeTime = rawTimestamp > 9999999999 ? Math.floor(rawTimestamp / 1000) : rawTimestamp;
            const price = trade.price;
            const amount = trade.amount || 0;
            const periodStart = getPeriodStartTime(tradeTime, currentMarketPeriod);

            // Check if we need to start a new candle (period rolled over)
            if (formingCandle && periodStart > formingCandle.time) {
                // Period ended - the forming candle is now frozen (already in the chart)
                // Start a new forming candle
                formingCandle = {
                    time: periodStart,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: amount
                };
                console.log('[LiveCandle] New period started:', new Date(periodStart * 1000).toISOString());
            } else if (!formingCandle) {
                // First trade - initialize forming candle
                formingCandle = {
                    time: periodStart,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: amount
                };
                console.log('[LiveCandle] Initialized forming candle:', formingCandle);
            } else {
                // Update existing forming candle
                formingCandle.high = Math.max(formingCandle.high, price);
                formingCandle.low = Math.min(formingCandle.low, price);
                formingCandle.close = price;
                formingCandle.volume += amount;
            }

            // Update the chart with the forming candle
            safeUpdate(liveMarketCandleSeries, {
                time: formingCandle.time,
                open: formingCandle.open,
                high: formingCandle.high,
                low: formingCandle.low,
                close: formingCandle.close
            }, 'liveMarketFormingCandle');
        }

        // Initialize forming candle from loaded historical data
        function initFormingCandleFromData(candles) {
            if (!candles || candles.length === 0) return;

            const lastCandle = candles[candles.length - 1];
            const now = Math.floor(Date.now() / 1000);
            const currentPeriodStart = getPeriodStartTime(now, currentMarketPeriod);

            // If the last candle is from the current period, use it as the forming candle
            if (lastCandle.time === currentPeriodStart) {
                formingCandle = {
                    time: lastCandle.time,
                    open: lastCandle.open,
                    high: lastCandle.high,
                    low: lastCandle.low,
                    close: lastCandle.close,
                    volume: lastCandle.volume || 0
                };
                console.log('[LiveCandle] Restored forming candle from data:', formingCandle);
            } else {
                // Last candle is from a previous period, create a new forming candle
                // Use the last candle's close as the starting point
                formingCandle = {
                    time: currentPeriodStart,
                    open: lastCandle.close,
                    high: lastCandle.close,
                    low: lastCandle.close,
                    close: lastCandle.close,
                    volume: 0
                };
                console.log('[LiveCandle] Created new forming candle from last close:', formingCandle);

                // Add this forming candle to the chart
                safeUpdate(liveMarketCandleSeries, {
                    time: formingCandle.time,
                    open: formingCandle.open,
                    high: formingCandle.high,
                    low: formingCandle.low,
                    close: formingCandle.close
                }, 'liveMarketInitFormingCandle');
            }
        }

        // Strategy descriptions for the Live Test Control panel
        const STRATEGY_DESCRIPTIONS = {
            'none': 'Live market data only. Select a strategy to view trade overlays and backtest results.',
            'TestBot': 'Simple test strategy that trades every 60 seconds for verification purposes.',
            'DivergeBot': 'Arbitrage strategy that detects price divergence between BTC/USD and BTC/USDT markets.',
            'SazBot': 'Order book imbalance strategy analyzing bid/ask ratios at multiple depth levels (1%-25%).',
            'SDBot': 'Supply/demand zone trading based on detecting significant price runs and zone boundaries.',
            'PairTradeBot': 'Statistical arbitrage using mean reversion between correlated trading pairs.',
            'DevDistStatBot': 'Distribution-based mean reversion using statistical z-score bands for entry/exit signals.'
        };

        // Strategy indicator configurations
        const STRATEGY_INDICATORS = {
            'TestBot': [], // Simple - no indicators
            'DivergeBot': [
                { type: 'ema', period: 20, color: '#ff9800', label: 'EMA 20' }
            ],
            'SazBot': [
                { type: 'ema', period: 20, color: '#2196f3', label: 'EMA 20' },
                { type: 'ema', period: 50, color: '#ff9800', label: 'EMA 50' }
            ],
            'SDBot': [
                { type: 'ema', period: 20, color: '#2196f3', label: 'EMA 20' },
                { type: 'ema', period: 50, color: '#ff9800', label: 'EMA 50' },
                { type: 'bollinger', period: 20, stdDev: 2, color: '#9c27b0', label: 'BB' }
            ],
            'PairTradeBot': [
                { type: 'ema', period: 20, color: '#2196f3', label: 'EMA 20' },
                { type: 'ema', period: 50, color: '#ff9800', label: 'EMA 50' }
            ],
            'DevDistStatBot': [
                { type: 'devdiststat_bands', colorMean: '#ffeb3b', colorUpper: '#4caf50', colorLower: '#f44336' }
            ]
        };

        // Indicator line series for live market chart
        let indicatorSeries = {}; // { 'ema_20': lineSeries, 'ema_50': lineSeries, etc. }
        let currentStrategyIndicators = 'TestBot';

        // DevDistStat indicator data parsed from session logs
        let devDistStatIndicatorData = {
            mean: [],   // { time, value }
            upper: [],  // { time, value }
            lower: [],  // { time, value }
            zscore: []  // { time, value } - for optional z-score panel
        };

        // Parse [INDICATOR] logs from session logs
        // Format: [INDICATOR] ts=1706000000 price=89100.00 mean=89108.32 upper=89117.93 lower=89098.71 zscore=-1.732
        function parseDevDistStatIndicatorLogs(logs) {
            const data = { mean: [], upper: [], lower: [], zscore: [] };

            if (!logs || !Array.isArray(logs)) return data;

            // DEBUG: Log first few entries to see actual structure
            if (logs.length > 0) {
                console.log('[DevDistStat] DEBUG - First log entry keys:', Object.keys(logs[0]));
                console.log('[DevDistStat] DEBUG - First log entry:', JSON.stringify(logs[0]).slice(0, 500));
                // Look for any [INDICATOR] in any field
                const sampleWithIndicator = logs.find(l => JSON.stringify(l).includes('[INDICATOR]') || JSON.stringify(l).includes('INDICATOR'));
                if (sampleWithIndicator) {
                    console.log('[DevDistStat] DEBUG - Sample INDICATOR log:', JSON.stringify(sampleWithIndicator).slice(0, 500));
                } else {
                    console.log('[DevDistStat] DEBUG - No [INDICATOR] found in any log field!');
                    // Check what log types exist
                    const types = new Set(logs.slice(0, 100).map(l => l.type || l.level || l.log_type || 'unknown'));
                    console.log('[DevDistStat] DEBUG - Log types found:', [...types]);
                }
            }

            for (const log of logs) {
                // Try multiple possible field names for the message content
                const msg = log.message || log.content || log.text || log.data || log.log || '';
                if (!msg.includes('[INDICATOR]')) continue;

                // Parse key=value pairs
                const tsMatch = msg.match(/ts=(\d+)/);
                const meanMatch = msg.match(/mean=([\d.]+)/);
                const upperMatch = msg.match(/upper=([\d.]+)/);
                const lowerMatch = msg.match(/lower=([\d.]+)/);
                const zscoreMatch = msg.match(/zscore=([-\d.]+)/);

                if (!tsMatch) continue;

                // Convert timestamp to seconds (TradingView expects seconds)
                let time = parseInt(tsMatch[1]);
                if (time > 9999999999) time = Math.floor(time / 1000); // Convert ms to seconds

                if (meanMatch) data.mean.push({ time, value: parseFloat(meanMatch[1]) });
                if (upperMatch) data.upper.push({ time, value: parseFloat(upperMatch[1]) });
                if (lowerMatch) data.lower.push({ time, value: parseFloat(lowerMatch[1]) });
                if (zscoreMatch) data.zscore.push({ time, value: parseFloat(zscoreMatch[1]) });
            }

            // Sort by time (ascending)
            data.mean.sort((a, b) => a.time - b.time);
            data.upper.sort((a, b) => a.time - b.time);
            data.lower.sort((a, b) => a.time - b.time);
            data.zscore.sort((a, b) => a.time - b.time);

            console.log(`[DevDistStat] Parsed ${data.mean.length} indicator points from ${logs.length} total logs`);

            // DEBUG: Show sample data if available
            if (data.mean.length > 0) {
                console.log(`[DevDistStat] First indicator point:`, data.mean[0]);
                console.log(`[DevDistStat] Last indicator point:`, data.mean[data.mean.length - 1]);
                console.log(`[DevDistStat] Value range: ${Math.min(...data.mean.map(d => d.value)).toFixed(2)} to ${Math.max(...data.mean.map(d => d.value)).toFixed(2)}`);
            }

            return data;
        }

        // Aggregate tick-level indicator data to match chart candle period
        // Takes the LAST value within each candle bucket (most recent before candle closes)
        function aggregateIndicatorData(rawData, period) {
            if (!rawData || rawData.length === 0) return [];

            const periodSecs = PERIOD_SECONDS[period] || 300;
            const buckets = {};

            // Group points by candle bucket
            for (const point of rawData) {
                // Round timestamp down to candle boundary
                const bucketTime = Math.floor(point.time / periodSecs) * periodSecs;

                // Keep only the LAST value for each bucket
                // (as we iterate chronologically, later values overwrite earlier ones)
                buckets[bucketTime] = { time: bucketTime, value: point.value };
            }

            // Convert to sorted array
            const result = Object.values(buckets).sort((a, b) => a.time - b.time);

            console.log(`[Aggregation] ${rawData.length} tick points -> ${result.length} candle points (period: ${period})`);

            return result;
        }

        // Aggregate all DevDistStat indicator series to match chart period
        function aggregateDevDistStatData(data, period) {
            return {
                mean: aggregateIndicatorData(data.mean, period),
                upper: aggregateIndicatorData(data.upper, period),
                lower: aggregateIndicatorData(data.lower, period),
                zscore: aggregateIndicatorData(data.zscore, period)
            };
        }

        // Load DevDistStat indicators from session logs
        async function loadDevDistStatIndicators(sessionId) {
            try {
                // Use server-side filtering to get only [INDICATOR] logs
                // This avoids log volume issues - filters before returning results
                const data = await HM_API.sessions.logs(sessionId, { limit: 5000, filter: '[INDICATOR]' });
                console.log('[DevDistStat] DEBUG - API response keys:', Object.keys(data));
                console.log('[DevDistStat] DEBUG - API response sample:', JSON.stringify(data).slice(0, 1000));
                // Try multiple possible field names for the logs array
                const logs = data.logs || data.data || data.items || data.results || (Array.isArray(data) ? data : []);
                console.log('[DevDistStat] DEBUG - logs array length:', logs.length);

                // Parse indicator data from logs
                devDistStatIndicatorData = parseDevDistStatIndicatorLogs(logs);
                return devDistStatIndicatorData;
            } catch (err) {
                console.error('[DevDistStat] Error loading indicator logs:', err);
                return null;
            }
        }

        // Calculate EMA from candle data
        function calculateEMA(candles, period) {
            if (!candles || candles.length < period) return [];
            const k = 2 / (period + 1);
            const emaData = [];

            // Initialize with SMA for first period
            let sum = 0;
            for (let i = 0; i < period; i++) {
                sum += candles[i].close;
            }
            let ema = sum / period;
            emaData.push({ time: candles[period - 1].time, value: ema });

            // Calculate EMA for remaining candles
            for (let i = period; i < candles.length; i++) {
                ema = candles[i].close * k + ema * (1 - k);
                emaData.push({ time: candles[i].time, value: ema });
            }
            return emaData;
        }

        // Calculate Bollinger Bands from candle data
        function calculateBollingerBands(candles, period, stdDev) {
            if (!candles || candles.length < period) return { upper: [], middle: [], lower: [] };

            const upper = [], middle = [], lower = [];

            for (let i = period - 1; i < candles.length; i++) {
                // Calculate SMA
                let sum = 0;
                for (let j = i - period + 1; j <= i; j++) {
                    sum += candles[j].close;
                }
                const sma = sum / period;

                // Calculate standard deviation
                let sqSum = 0;
                for (let j = i - period + 1; j <= i; j++) {
                    sqSum += Math.pow(candles[j].close - sma, 2);
                }
                const std = Math.sqrt(sqSum / period);

                const time = candles[i].time;
                middle.push({ time, value: sma });
                upper.push({ time, value: sma + stdDev * std });
                lower.push({ time, value: sma - stdDev * std });
            }

            return { upper, middle, lower };
        }

        // Clear all indicator series from chart
        function clearIndicators() {
            for (const key in indicatorSeries) {
                if (indicatorSeries[key] && liveMarketChart) {
                    try {
                        liveMarketChart.removeSeries(indicatorSeries[key]);
                    } catch (e) {
                        console.warn('[Indicators] Error removing series:', key, e);
                    }
                }
            }
            indicatorSeries = {};
        }

        // Update indicators for the selected strategy
        function updateChartIndicators(strategy) {
            if (!liveMarketChart || !lastCandleData.length) return;

            // Clear existing indicators
            clearIndicators();

            const indicators = STRATEGY_INDICATORS[strategy] || [];
            currentStrategyIndicators = strategy;

            if (indicators.length === 0) {
                console.log('[Indicators] No indicators for', strategy);
                return;
            }

            console.log('[Indicators] Adding indicators for', strategy, ':', indicators.length);

            for (const config of indicators) {
                if (config.type === 'ema') {
                    const emaData = calculateEMA(lastCandleData, config.period);
                    if (emaData.length > 0) {
                        const series = liveMarketChart.addLineSeries({
                            color: config.color,
                            lineWidth: 1,
                            title: config.label,
                            priceLineVisible: false,
                            lastValueVisible: false
                        });
                        safeSetData(series, emaData, `EMA_${config.period}`);
                        indicatorSeries[`ema_${config.period}`] = series;
                    }
                } else if (config.type === 'bollinger') {
                    const bb = calculateBollingerBands(lastCandleData, config.period, config.stdDev);
                    if (bb.upper.length > 0) {
                        // Upper band
                        const upperSeries = liveMarketChart.addLineSeries({
                            color: config.color,
                            lineWidth: 1,
                            lineStyle: 2, // Dashed
                            title: 'BB Upper',
                            priceLineVisible: false,
                            lastValueVisible: false
                        });
                        safeSetData(upperSeries, bb.upper, 'BB_upper');
                        indicatorSeries['bb_upper'] = upperSeries;

                        // Lower band
                        const lowerSeries = liveMarketChart.addLineSeries({
                            color: config.color,
                            lineWidth: 1,
                            lineStyle: 2, // Dashed
                            title: 'BB Lower',
                            priceLineVisible: false,
                            lastValueVisible: false
                        });
                        safeSetData(lowerSeries, bb.lower, 'BB_lower');
                        indicatorSeries['bb_lower'] = lowerSeries;

                        console.log(`[Indicators] Added Bollinger Bands with ${bb.upper.length} points`);
                    }
                } else if (config.type === 'devdiststat_bands') {
                    // DevDistStat bands from parsed log data
                    // STEP 1: Aggregate tick-level data to match chart candle period
                    const aggregatedData = aggregateDevDistStatData(devDistStatIndicatorData, currentMarketPeriod);
                    console.log(`[Indicators] DevDistStat aggregated to ${currentMarketPeriod}: mean=${aggregatedData.mean.length}, upper=${aggregatedData.upper.length}, lower=${aggregatedData.lower.length}`);

                    // STEP 2: Validate data - filter out any null/undefined/invalid points
                    const isValidPoint = (p) => p && typeof p.time === 'number' && p.time > 0 && typeof p.value === 'number' && !isNaN(p.value);
                    const validMean = aggregatedData.mean.filter(isValidPoint);
                    const validUpper = aggregatedData.upper.filter(isValidPoint);
                    const validLower = aggregatedData.lower.filter(isValidPoint);

                    console.log(`[Indicators] DevDistStat after validation: mean=${validMean.length}, upper=${validUpper.length}, lower=${validLower.length}`);

                    // DEBUG: Log timestamp ranges to check alignment
                    if (validMean.length > 0) {
                        const meanFirst = validMean[0].time;
                        const meanLast = validMean[validMean.length - 1].time;
                        console.log(`[Indicators] DevDistStat mean time range: ${new Date(meanFirst * 1000).toISOString()} to ${new Date(meanLast * 1000).toISOString()}`);
                        console.log(`[Indicators] DevDistStat mean first 3:`, validMean.slice(0, 3));
                    }
                    if (lastCandleData && lastCandleData.length > 0) {
                        const candleFirst = lastCandleData[0].time;
                        const candleLast = lastCandleData[lastCandleData.length - 1].time;
                        console.log(`[Indicators] Candle time range: ${new Date(candleFirst * 1000).toISOString()} to ${new Date(candleLast * 1000).toISOString()}`);
                        console.log(`[Indicators] Candle first 3:`, lastCandleData.slice(0, 3).map(c => ({time: c.time, close: c.close})));
                    }

                    // DEBUG: Check price scale alignment
                    if (validMean.length > 0 && lastCandleData && lastCandleData.length > 0) {
                        const indicatorMin = Math.min(...validMean.map(d => d.value));
                        const indicatorMax = Math.max(...validMean.map(d => d.value));
                        const candleMin = Math.min(...lastCandleData.map(c => c.low));
                        const candleMax = Math.max(...lastCandleData.map(c => c.high));
                        console.log(`[Indicators] Price alignment check:`);
                        console.log(`  Indicator values: ${indicatorMin.toFixed(2)} to ${indicatorMax.toFixed(2)}`);
                        console.log(`  Candle prices: ${candleMin.toFixed(2)} to ${candleMax.toFixed(2)}`);
                        console.log(`  Overlap: ${indicatorMin <= candleMax && indicatorMax >= candleMin ? 'YES' : 'NO - MISMATCH!'}`);
                    }

                    if (validMean.length > 0) {
                        try {
                            // Mean line (yellow - moving average)
                            const meanSeries = liveMarketChart.addLineSeries({
                                color: config.colorMean || '#ffeb3b',
                                lineWidth: 2,
                                title: 'Mean',
                                priceLineVisible: false,
                                lastValueVisible: true
                            });
                            const setDataResult = safeSetData(meanSeries, validMean, 'DevDistStat_mean');
                            console.log(`[Indicators] DevDistStat meanSeries created:`, meanSeries ? 'YES' : 'NO', 'setData result:', setDataResult);
                            indicatorSeries['devdist_mean'] = meanSeries;

                            // Upper band (green - overbought zone) - only if has data
                            if (validUpper.length > 0) {
                                const upperSeries = liveMarketChart.addLineSeries({
                                    color: config.colorUpper || '#4caf50',
                                    lineWidth: 1,
                                    lineStyle: 2, // Dashed
                                    title: 'Upper',
                                    priceLineVisible: false,
                                    lastValueVisible: false
                                });
                                safeSetData(upperSeries, validUpper, 'DevDistStat_upper');
                                indicatorSeries['devdist_upper'] = upperSeries;
                            }

                            // Lower band (red - oversold zone) - only if has data
                            if (validLower.length > 0) {
                                const lowerSeries = liveMarketChart.addLineSeries({
                                    color: config.colorLower || '#f44336',
                                    lineWidth: 1,
                                    lineStyle: 2, // Dashed
                                    title: 'Lower',
                                    priceLineVisible: false,
                                    lastValueVisible: false
                                });
                                safeSetData(lowerSeries, validLower, 'DevDistStat_lower');
                                indicatorSeries['devdist_lower'] = lowerSeries;
                            }

                            console.log(`[Indicators] Added DevDistStat bands: mean=${validMean.length}, upper=${validUpper.length}, lower=${validLower.length}`);
                            // NOTE: Aggregation now aligns indicators to candle timestamps, fitContent() no longer needed
                        } catch (chartErr) {
                            console.error('[Indicators] DevDistStat chart error:', chartErr);
                            logJsError('ChartError', `DevDistStat setData: ${chartErr.message}`, '', '', '', chartErr.stack);
                        }
                    } else {
                        console.log('[Indicators] No valid DevDistStat indicator data available');
                    }
                }
            }
        }

        // Update strategy description when selector changes
        function updateStrategyDescription(strategy) {
            const descEl = document.getElementById('strategy-description');
            if (descEl) {
                descEl.textContent = STRATEGY_DESCRIPTIONS[strategy] || 'No description available.';
            }
        }

        // Current dashboard mode ('market' = no strategy, 'strategy' = strategy selected)
        let currentDashboardMode = 'market';

        // Switch dashboard mode based on strategy selection
        // Mode A (market): Live price chart + orderbook + recent trades
        // Mode B (strategy): Price chart with trade overlays + equity curve
        async function switchDashboardMode(mode) {
            const dashboardContent = document.getElementById('dashboard-content');
            const liveMarketContent = document.getElementById('live-market-content');
            const sessionControl = document.getElementById('session-control');
            const exportButtons = document.querySelector('.export-buttons');
            const liveTestPanel = document.getElementById('live-test-panel');
            const liveTradeFeed = document.getElementById('live-trade-feed');
            const equityCurveContainer = document.getElementById('equity-curve-container');
            const tradeOverlayLegend = document.getElementById('trade-overlay-legend');

            currentDashboardMode = mode;

            if (mode === 'market') {
                // Mode A: No strategy selected - show live market view
                if (dashboardContent) {
                    dashboardContent.style.display = 'none';
                    dashboardContent.classList.add('hidden');
                }
                if (liveMarketContent) {
                    liveMarketContent.classList.add('active');
                    liveMarketContent.style.display = 'block';
                }

                // Hide backtest controls
                document.querySelectorAll('.control-group').forEach(el => el.style.display = 'none');
                if (exportButtons) exportButtons.style.display = 'none';
                if (liveTradeFeed) liveTradeFeed.style.display = 'none';
                if (equityCurveContainer) equityCurveContainer.style.display = 'none';
                if (tradeOverlayLegend) tradeOverlayLegend.style.display = 'none';

                // Initialize live market chart
                if (!liveMarketChart) initLiveMarketChart();
                await loadLiveMarketData();
                startLiveMarketPolling();

                // Clear trade overlays from chart
                clearTradeOverlays();

                // Update chart title
                const chartTitle = document.getElementById('live-chart-title');
                if (chartTitle) chartTitle.textContent = 'BTC/USD Live Price';

            } else if (mode === 'strategy') {
                // Mode B: Strategy selected - show price chart with trade overlays + equity curve
                if (dashboardContent) {
                    dashboardContent.style.display = 'none';
                    dashboardContent.classList.add('hidden');
                }
                if (liveMarketContent) {
                    liveMarketContent.classList.add('active');
                    liveMarketContent.style.display = 'block';
                }

                // Keep live market chart but add trade overlays
                if (!liveMarketChart) initLiveMarketChart();
                await loadLiveMarketData();
                startLiveMarketPolling();

                // Show equity curve container and trade overlay legend
                if (equityCurveContainer) equityCurveContainer.style.display = 'block';
                if (tradeOverlayLegend) tradeOverlayLegend.style.display = 'flex';

                // Hide other controls
                document.querySelectorAll('.control-group').forEach(el => el.style.display = 'none');
                if (exportButtons) exportButtons.style.display = 'none';
                if (liveTradeFeed) liveTradeFeed.style.display = 'none';

                // Load trade overlays for selected strategy
                await loadTradeOverlays();

                // Load equity curve
                await loadEquityCurve();

                // Update chart title with strategy
                const chartTitle = document.getElementById('live-chart-title');
                if (chartTitle) chartTitle.textContent = `BTC/USD Price with ${currentStrategy} Trades`;
            }
        }

        // Initialize mode switching based on strategy selector
        function initViewToggle() {
            // Mode is now driven by strategy selector
            // This function is kept for backwards compatibility
            // Actual mode switching happens in strategy selector change handler
        }

        // Clear trade overlay markers from the live market chart
        function clearTradeOverlays() {
            if (liveMarketCandleSeries) {
                safeSetMarkers(liveMarketCandleSeries, [], 'clearTradeOverlays');
            }
        }

        // Load and display trade overlays on the live market chart
        async function loadTradeOverlays() {
            console.log('[Trade Overlays] >>> loadTradeOverlays() CALLED <<<');
            console.log(`[Trade Overlays] liveMarketCandleSeries exists: ${!!liveMarketCandleSeries}`);
            console.log(`[Trade Overlays] lastCandleData length: ${lastCandleData?.length || 0}`);
            console.log(`[Trade Overlays] currentStrategy: ${currentStrategy}`);

            if (!liveMarketCandleSeries || !lastCandleData.length) {
                console.log('[Trade Overlays] ABORT: No candle series or candle data available');
                return;
            }
            if (currentStrategy === 'none') {
                console.log('[Trade Overlays] ABORT: Strategy is none, clearing overlays');
                clearTradeOverlays();
                return;
            }

            let trades = [];

            try {
                // Try live test session first
                console.log('[Trade Overlays] Fetching: /session/test');
                const testResponse = await HM_API.get('/session/test');
                console.log(`[Trade Overlays] /session/test status: ${testResponse.status}`);
                if (testResponse.ok) {
                    const testData = await testResponse.json();
                    if (testData.success && testData.trades && testData.trades.length > 0) {
                        trades = testData.trades;
                        console.log(`[Trade Overlays] Loaded ${trades.length} trades from live test session`);
                    }
                } else if (testResponse.status === 401) {
                    console.warn('[Trade Overlays] /session/test 401 - API key may be invalid');
                }

                // If no live test trades, try backtest session
                if (trades.length === 0) {
                    console.log('[Trade Overlays] Fetching: /session/backtest');
                    const backtestResponse = await HM_API.get('/session/backtest');
                    console.log(`[Trade Overlays] /session/backtest status: ${backtestResponse.status}`);
                    if (backtestResponse.ok) {
                        const backtestData = await backtestResponse.json();
                        if (backtestData.success && backtestData.trades && backtestData.trades.length > 0) {
                            trades = backtestData.trades;
                            console.log(`[Trade Overlays] Loaded ${trades.length} trades from backtest session`);
                        }
                    } else if (backtestResponse.status === 401) {
                        console.warn('[Trade Overlays] /session/backtest 401 - API key may be invalid');
                    }
                }

                if (trades.length === 0) {
                    console.log('[Trade Overlays] No active session - run a backtest to see trade arrows on chart');
                    clearTradeOverlays();
                    return;
                }

                const markers = [];

                // Helper to find closest candle to a timestamp
                const findClosestCandle = (timestamp) => {
                    return lastCandleData.reduce((prev, curr) => {
                        return Math.abs(curr.time - timestamp) < Math.abs(prev.time - timestamp) ? curr : prev;
                    });
                };

                trades.forEach(trade => {
                    // ENTRY marker - arrow shape
                    const entryTime = trade.timestamp_unix || trade.entry_time_unix;
                    if (entryTime) {
                        const entryCandle = findClosestCandle(entryTime);
                        markers.push({
                            time: entryCandle.time,
                            position: trade.side === 'long' ? 'belowBar' : 'aboveBar',
                            color: trade.side === 'long' ? '#2196F3' : '#FF9800', // Blue for long, orange for short
                            shape: trade.side === 'long' ? 'arrowUp' : 'arrowDown',
                            text: '' // No text to prevent overlap
                        });
                    }

                    // EXIT marker - circle shape (if exit data exists)
                    if (trade.exit_time_unix && trade.exit_price) {
                        const exitCandle = findClosestCandle(trade.exit_time_unix);
                        markers.push({
                            time: exitCandle.time,
                            position: trade.side === 'long' ? 'aboveBar' : 'belowBar',
                            color: trade.pnl >= 0 ? '#00c853' : '#ff5252', // Green for profit, red for loss
                            shape: 'circle',
                            text: ''
                        });
                    }
                });

                // Sort markers by time (required by Lightweight Charts)
                markers.sort((a, b) => a.time - b.time);
                safeSetMarkers(liveMarketCandleSeries, markers, 'loadTradesOntoChart');
                console.log(`[Trade Overlays] Displayed ${markers.length} markers for ${trades.length} trades`);

            } catch (err) {
                console.error('[Trade Overlays] Error loading trades:', err);
            }
        }

        // Equity curve chart instance
        let equityCurveChart = null;
        let equitySeries = null;
        let drawdownSeries = null;

        // Load and display equity curve in the separate chart
        async function loadEquityCurve() {
            const container = document.getElementById('equity-curve-chart-container');
            if (!container) return;

            if (currentStrategy === 'none') {
                // Clear equity curve in market mode
                if (equityCurveChart) {
                    equityCurveChart.remove();
                    equityCurveChart = null;
                    equitySeries = null;
                    drawdownSeries = null;
                }
                return;
            }

            try {
                // Fetch equity curve data from session/test endpoint
                const response = await HM_API.get('/session/test');
                if (!response.ok) {
                    console.log('[Equity Curve] No test session data available');
                    return;
                }

                const data = await response.json();
                if (!data.success || !data.equity_curve || data.equity_curve.length === 0) {
                    console.log('[Equity Curve] No equity curve data');
                    // Show empty state
                    if (!equityCurveChart) {
                        initEquityCurveChart(container);
                    }
                    if (equitySeries) safeSetData(equitySeries, [], 'equityCurve_empty');
                    if (drawdownSeries) safeSetData(drawdownSeries, [], 'drawdown_empty');
                    return;
                }

                // Initialize chart if not exists
                if (!equityCurveChart) {
                    initEquityCurveChart(container);
                }

                // Format equity curve data for Lightweight Charts
                const equityData = data.equity_curve.map(point => ({
                    time: point.timestamp_unix,
                    value: point.equity
                }));

                // Format drawdown data (inverted to show below zero line)
                const drawdownData = data.equity_curve.map(point => ({
                    time: point.timestamp_unix,
                    value: -(point.drawdown || 0) / 100  // Negative percentage as decimal
                }));

                safeSetData(equitySeries, equityData, 'equityCurve');
                safeSetData(drawdownSeries, drawdownData, 'drawdown');

                // Update title with strategy name
                const titleEl = document.getElementById('equity-chart-title');
                if (titleEl) titleEl.textContent = `${currentStrategy} Equity Curve`;

                equityCurveChart.timeScale().fitContent();
                console.log(`[Equity Curve] Loaded ${equityData.length} points`);

            } catch (err) {
                console.error('[Equity Curve] Error loading data:', err);
            }
        }

        // Initialize the equity curve chart
        function initEquityCurveChart(container) {
            equityCurveChart = LightweightCharts.createChart(container, {
                layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8892b0' },
                grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
                timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,0.1)' },
                rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', autoScale: true },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
                height: 200
            });

            equitySeries = equityCurveChart.addLineSeries({
                color: '#4caf50',
                lineWidth: 2,
                priceScaleId: 'right'
            });

            drawdownSeries = equityCurveChart.addAreaSeries({
                topColor: 'rgba(255, 82, 82, 0.4)',
                bottomColor: 'rgba(255, 82, 82, 0.1)',
                lineColor: '#ff5252',
                lineWidth: 1,
                priceScaleId: 'left'
            });

            // Configure left scale for drawdown
            equityCurveChart.applyOptions({
                leftPriceScale: {
                    visible: true,
                    borderColor: 'rgba(255,255,255,0.1)',
                    autoScale: true
                }
            });

            // Resize observer
            const resizeObserver = new ResizeObserver(() => {
                equityCurveChart.applyOptions({ width: container.clientWidth });
            });
            resizeObserver.observe(container);

            // Apply adaptive time formatting for zoom
            setupAdaptiveTimeFormat(equityCurveChart);
        }

        // Volume series for live market chart
        let liveMarketVolumeSeries = null;

        // Initialize live market chart
        function initLiveMarketChart() {
            const container = document.getElementById('live-price-chart-container');
            if (!container) return;

            // Get initial dimensions from container
            const initialWidth = container.clientWidth || 800;
            const initialHeight = container.clientHeight || 400;

            liveMarketChart = LightweightCharts.createChart(container, {
                width: initialWidth,
                height: initialHeight,
                layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#8892b0' },
                grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
                timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,0.1)' },
                rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', autoScale: true, scaleMargins: { top: 0.1, bottom: 0.25 } },
                crosshair: { mode: LightweightCharts.CrosshairMode.Normal }
            });

            liveMarketCandleSeries = liveMarketChart.addCandlestickSeries({
                upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
                wickUpColor: '#26a69a', wickDownColor: '#ef5350'
            });

            // Add volume histogram series below the candlesticks
            liveMarketVolumeSeries = liveMarketChart.addHistogramSeries({
                color: '#26a69a',
                priceFormat: { type: 'volume' },
                priceScaleId: 'volume',
            });

            // Configure volume scale to appear at the bottom
            liveMarketChart.priceScale('volume').applyOptions({
                scaleMargins: { top: 0.85, bottom: 0 },
                borderVisible: false,
            });

            // Subscribe to crosshair move for OHLC display
            liveMarketChart.subscribeCrosshairMove((param) => {
                try {
                    updateOHLCDisplay(param);
                } catch (err) {
                    console.log("CROSSHAIR: ERROR in updateOHLCDisplay:", err.message);
                }
            });

            // ResizeObserver to handle container size changes - update BOTH width AND height
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const { width, height } = entry.contentRect;
                    if (width > 0 && height > 0) {
                        liveMarketChart.applyOptions({ width, height });
                    }
                }
            });
            resizeObserver.observe(container);

            // Initial resize to fill container - retry multiple times for mobile layout
            const retryResize = (attempts = 0) => {
                if (attempts >= 5) return; // Max 5 attempts
                const w = container.clientWidth;
                const h = container.clientHeight;
                if (w > 0 && h > 0) {
                    liveMarketChart.applyOptions({ width: w, height: h });
                } else {
                    // Container not ready, retry after delay
                    setTimeout(() => retryResize(attempts + 1), 100 * (attempts + 1));
                }
            };
            setTimeout(() => retryResize(0), 50);

            // Subscribe to visible range changes for lazy loading
            liveMarketChart.timeScale().subscribeVisibleLogicalRangeChange((logicalRange) => {
                if (!logicalRange || !lastCandleData.length || isLoadingOlderCandles) return;

                // Check if user has scrolled near the left edge (first 10% of visible range)
                const visibleBarsCount = logicalRange.to - logicalRange.from;
                const leftEdgeThreshold = Math.max(5, Math.floor(visibleBarsCount * 0.1));

                // If logicalRange.from is close to 0, user is at the start of data
                if (logicalRange.from < leftEdgeThreshold) {
                    loadOlderCandles();
                }
            });
        }

        // Update OHLC display on crosshair move
        function updateOHLCDisplay(param) {
            const openEl = document.getElementById('ohlc-open');
            const highEl = document.getElementById('ohlc-high');
            const lowEl = document.getElementById('ohlc-low');
            const closeEl = document.getElementById('ohlc-close');
            const volumeEl = document.getElementById('ohlc-volume');

            if (!openEl || !highEl || !lowEl || !closeEl) return;

            if (!param || !param.time || !param.seriesData) {
                // Reset to latest candle when crosshair is not on chart
                if (lastCandleData && lastCandleData.length > 0) {
                    const latest = lastCandleData[lastCandleData.length - 1];
                    openEl.textContent = formatPrice(latest.open);
                    highEl.textContent = formatPrice(latest.high);
                    lowEl.textContent = formatPrice(latest.low);
                    closeEl.textContent = formatPrice(latest.close);
                    if (volumeEl) volumeEl.textContent = formatVolume(latest.volume || 0);

                    // Set colors based on candle direction
                    const isUp = latest.close >= latest.open;
                    const color = isUp ? 'up' : 'down';
                    [openEl, highEl, lowEl, closeEl].forEach(el => {
                        el.classList.remove('up', 'down');
                        el.classList.add(color);
                    });
                }
                return;
            }

            // Get candle data at crosshair position
            const candleData = param.seriesData.get(liveMarketCandleSeries);
            if (candleData) {
                openEl.textContent = formatPrice(candleData.open);
                highEl.textContent = formatPrice(candleData.high);
                lowEl.textContent = formatPrice(candleData.low);
                closeEl.textContent = formatPrice(candleData.close);

                // Get volume data
                const volumeData = param.seriesData.get(liveMarketVolumeSeries);
                if (volumeEl && volumeData) {
                    volumeEl.textContent = formatVolume(volumeData.value || 0);
                }

                // Set colors based on candle direction
                const isUp = candleData.close >= candleData.open;
                const color = isUp ? 'up' : 'down';
                [openEl, highEl, lowEl, closeEl].forEach(el => {
                    el.classList.remove('up', 'down');
                    el.classList.add(color);
                });
            }
        }

        // Format price for OHLC display
        function formatPrice(price) {
            if (price >= 10000) return price.toFixed(1);
            if (price >= 1000) return price.toFixed(2);
            if (price >= 1) return price.toFixed(4);
            return price.toFixed(6);
        }

        // Format volume for OHLC display
        function formatVolume(volume) {
            if (volume >= 1000000) return (volume / 1000000).toFixed(2) + 'M';
            if (volume >= 1000) return (volume / 1000).toFixed(1) + 'K';
            return volume.toFixed(0);
        }

        // Format trade size - removes unnecessary decimal places
        function formatTradeSize(size) {
            if (size == null) return '-';
            const num = parseFloat(size);
            if (isNaN(num)) return size;
            // If whole number, show no decimals
            if (num === Math.floor(num)) return num.toFixed(0);
            // Otherwise show up to 2 decimals, trimming trailing zeros
            return parseFloat(num.toFixed(2)).toString();
        }

        // Update volume series with candle data
        function updateVolumeSeries(candles) {
            if (!liveMarketVolumeSeries || !candles || candles.length === 0) return;

            // Check if we have real volume data
            const hasVolume = candles.some(c => c.volume && c.volume > 0);
            console.log(`[Volume] Has real volume data: ${hasVolume}, candles: ${candles.length}`);

            const volumeData = candles.map(c => {
                // Use real volume if available, otherwise generate synthetic volume based on price movement
                let volume = c.volume || 0;
                if (!hasVolume) {
                    // Generate synthetic volume: larger moves = more volume
                    const priceRange = Math.abs(c.high - c.low);
                    const avgPrice = (c.high + c.low) / 2;
                    volume = priceRange / avgPrice * 1000000; // Synthetic volume based on volatility
                }
                return {
                    time: c.time,
                    value: volume,
                    color: c.close >= c.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)'
                };
            });

            safeSetData(liveMarketVolumeSeries, volumeData, 'updateVolumeSeries');
        }

        // Load older candles when user scrolls left
        async function loadOlderCandles() {
            if (isLoadingOlderCandles || !earliestCandleTime) return;

            // Check if we've already loaded all available archive data
            if (archiveMinTime && earliestCandleTime <= archiveMinTime) {
                console.log('[LazyLoad] Already at archive start, no more data available');
                return;
            }

            isLoadingOlderCandles = true;
            const requestContext = beginTrackedMarketRequest();
            const chartTitle = document.getElementById('live-chart-title');
            const originalTitle = chartTitle?.textContent || '';

            try {
                // Show loading indicator
                if (chartTitle) {
                    chartTitle.textContent = originalTitle.replace(')', ' · ⏳ Loading older...)').replace('))', ')');
                }

                // Calculate time range to fetch (go back by period-appropriate amount)
                const periodSeconds = PERIOD_SECONDS[currentMarketPeriod] || 300;
                const candlesToFetch = 200; // Fetch ~200 candles at a time
                const fetchDuration = candlesToFetch * periodSeconds;

                const endTime = earliestCandleTime - 1; // Just before our earliest
                const startTime = endTime - fetchDuration;

                console.log(`[LazyLoad] Fetching older candles: ${new Date(startTime * 1000).toISOString()} to ${new Date(endTime * 1000).toISOString()}`);

                // Use unified endpoint for all markets (BitMEX and Polymarket)
                const data = await HM_API.live.prices({
                    market: currentMarket,
                    period: currentMarketPeriod,
                    startTime,
                    endTime,
                    source: 'archive'
                }, { signal: requestContext.signal });
                if (isStaleMarketRequest(requestContext, true)) return;

                if (data.success && data.candles && data.candles.length > 0) {
                    const olderCandles = data.candles.map(c => ({
                        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
                        volume: c.volume || 0
                    }));

                    // Filter out any duplicates (candles we already have)
                    const existingTimes = new Set(lastCandleData.map(c => c.time));
                    const newCandles = olderCandles.filter(c => !existingTimes.has(c.time));

                    if (newCandles.length > 0) {
                        // Prepend new candles to existing data
                        lastCandleData = [...newCandles, ...lastCandleData];
                        // Sort by time to ensure correct order
                        lastCandleData.sort((a, b) => a.time - b.time);

                        // Update earliest time
                        earliestCandleTime = lastCandleData[0].time;

                        // Update chart with all data
                        safeSetData(liveMarketCandleSeries, lastCandleData, 'loadOlderCandles');

                        // Update volume series
                        updateVolumeSeries(lastCandleData);

                        // Re-calculate and update indicators with new data
                        updateChartIndicators(currentStrategyIndicators);

                        console.log(`[LazyLoad] Added ${newCandles.length} older candles, total: ${lastCandleData.length}`);

                        // Update title with new candle count
                        if (chartTitle) {
                            chartTitle.textContent = `${getMarketDisplayName(currentMarket)} Price (📦 Archive · ${lastCandleData.length} candles · 🟢 Live)`;
                        }
                    } else {
                        console.log('[LazyLoad] No new candles in response (all duplicates)');
                        // Restore original title
                        if (chartTitle) chartTitle.textContent = originalTitle;
                    }
                } else {
                    console.log('[LazyLoad] No older data available');
                    // Restore original title
                    if (chartTitle) chartTitle.textContent = originalTitle;
                }
            } catch (err) {
                if (isAbortError(err)) return;
                console.error('[LazyLoad] Error:', err);
                // Restore original title
                if (chartTitle) chartTitle.textContent = originalTitle;
            } finally {
                endTrackedMarketRequest(requestContext);
                isLoadingOlderCandles = false;
            }
        }

        // Fetch archive info to know the available data range
        async function fetchArchiveInfo(market) {
            const requestContext = beginTrackedMarketRequest();
            try {
                const data = await HM_API.live.archiveInfo({ market }, { signal: requestContext.signal });
                if (isStaleMarketRequest(requestContext)) return;
                if (data.success && data.archive?.available) {
                    archiveMinTime = data.archive.minTime;
                    console.log(`[Archive] Data available from ${new Date(archiveMinTime * 1000).toISOString()}`);
                }
            } catch (err) {
                if (isAbortError(err)) return;
                console.error('[Archive] Error fetching archive info:', err);
            } finally {
                endTrackedMarketRequest(requestContext);
            }
        }

        // Load all live market data
        async function loadLiveMarketData() {
            const refreshBtn = document.getElementById('refresh-market-btn');
            if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '⏳ Loading...'; }
            try {
                await Promise.all([loadPriceData(), loadOrderbookData(), loadTradesData()]);
            } catch (err) { console.error('Error loading market data:', err); }
            finally { if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '🔄 Refresh'; } }
        }

        // Load price/candle data
        async function loadPriceData() {
            const requestContext = beginTrackedMarketRequest();
            const chartTitle = document.getElementById('live-chart-title');
            const priceDisplay = document.getElementById('current-market-price');

            // Show loading state
            chartTitle.textContent = `${getMarketDisplayName(currentMarket)} Price (⏳ Loading...)`;
            priceDisplay.textContent = '...';

            try {
                // Use unified endpoint for all markets (BitMEX and Polymarket)
                const data = await HM_API.live.prices({
                    market: currentMarket,
                    period: currentMarketPeriod,
                    limit: 500,
                    source: 'hybrid'
                }, { signal: requestContext.signal });
                if (isStaleMarketRequest(requestContext, true)) return;
                if (data.success && data.candles && data.candles.length > 0) {
                    const candles = data.candles.map(c => ({
                        time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
                        volume: c.volume || 0
                    }));
                    lastCandleData = candles; // Store for reference
                    earliestCandleTime = candles[0].time; // Track earliest for lazy loading
                    safeSetData(liveMarketCandleSeries, candles, 'loadLiveMarketData');

                    // Update volume series
                    updateVolumeSeries(candles);

                    // Update OHLC display with latest candle
                    updateOHLCDisplay(null);

                    // Re-render trade markers with new candle data (if viewing a session)
                    if (currentSessionTradeData) {
                        displaySessionTrades(currentSessionTradeData);
                    }

                    // Fetch archive info for lazy loading bounds (don't await, do in background)
                    fetchArchiveInfo(currentMarket);

                    // Update chart indicators for selected strategy
                    const selectedStrategy = document.getElementById('strategy-selector')?.value || 'TestBot';
                    updateChartIndicators(selectedStrategy);

                    // Show only recent data (scroll to right) instead of all data
                    // This prevents large time gaps from compressing the visible candles
                    const lastTime = candles[candles.length - 1].time;
                    // Scale visible range based on period for appropriate candle count
                    const hoursToShowByPeriod = {
                        '1m': 6,      // 360 candles
                        '5m': 6,      // 72 candles
                        '15m': 12,    // 48 candles
                        '1h': 24,     // 24 candles
                        '4h': 96,     // 24 candles (4 days)
                        '1d': 720,    // 30 candles (30 days)
                        '1w': 2520    // 15 candles (105 days)
                    };
                    const hoursToShow = hoursToShowByPeriod[currentMarketPeriod] || 6;
                    const visibleFrom = lastTime - (hoursToShow * 3600);
                    liveMarketChart.timeScale().setVisibleRange({
                        from: visibleFrom,
                        to: lastTime + 300 // Small buffer for forming candle
                    });

                    // Force price scale to auto-fit the visible data
                    liveMarketChart.priceScale('right').applyOptions({
                        autoScale: true,
                        scaleMargins: { top: 0.1, bottom: 0.1 }
                    });

                    // Initialize the forming candle from loaded data
                    initFormingCandleFromData(candles);

                    const lastCandle = data.candles[data.candles.length - 1];
                    const firstCandle = data.candles[0];
                    priceDisplay.textContent = formatMarketPrice(lastCandle.close, currentMarket);
                    const change = ((lastCandle.close - firstCandle.open) / firstCandle.open * 100).toFixed(2);
                    const changeBadge = document.getElementById('price-change-badge');
                    const changeValue = document.getElementById('price-change-value');
                    changeValue.textContent = `${change >= 0 ? '+' : ''}${change}%`;
                    changeBadge.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;

                    // Update professional trading header
                    updateTradingHeader(lastCandle.close, parseFloat(change));

                    // Calculate 24h high/low from candles
                    const high24h = Math.max(...data.candles.map(c => c.high));
                    const low24h = Math.min(...data.candles.map(c => c.low));
                    const highEl = document.getElementById('header-high');
                    const lowEl = document.getElementById('header-low');
                    if (highEl) highEl.textContent = formatMarketPrice(high24h, currentMarket);
                    if (lowEl) lowEl.textContent = formatMarketPrice(low24h, currentMarket);

                    // Update candle count in toolbar
                    const candleCountEl = document.getElementById('candle-count');
                    if (candleCountEl) candleCountEl.textContent = `${data.candles.length} candles`;

                    // Show data source and candle count
                    const sourceLabels = { 'archive': '📦 Archive', 'mysql': '🔴 Live', 'hybrid': '🔀 Combined' };
                    const sourceLabel = sourceLabels[data.source] || data.source;
                    chartTitle.textContent = `${getMarketDisplayName(currentMarket)} Price (${sourceLabel} · ${data.candleCount || data.candles.length} candles · 🟢 Live)`;
                } else {
                    chartTitle.textContent = `${getMarketDisplayName(currentMarket)} Price (No data)`;
                    priceDisplay.textContent = '--';
                }
            } catch (err) {
                if (isAbortError(err)) return;
                console.error('Error loading price data:', err);
                chartTitle.textContent = `${getMarketDisplayName(currentMarket)} Price (Error)`;
                priceDisplay.textContent = '--';
            } finally {
                endTrackedMarketRequest(requestContext);
            }
        }

        // Load orderbook data
        async function loadOrderbookData() {
            const requestContext = beginTrackedMarketRequest();
            const spreadEl = document.getElementById('orderbook-spread');
            spreadEl.textContent = 'Loading...';

            try {
                // Use unified endpoint for all markets (BitMEX and Polymarket)
                const data = await HM_API.live.orderbook({ market: currentMarket, depth: 12 }, { signal: requestContext.signal });
                if (isStaleMarketRequest(requestContext)) return;
                if (data.success) {
                    // Unified endpoint returns bids/asks in consistent format
                    const bids = data.bids || [];
                    const asks = data.asks || [];
                    // Use professional orderbook rendering
                    renderOrderbookPro(bids, asks);
                    if (bids?.length && asks?.length) {
                        const spread = asks[0].price - bids[0].price;
                        const spreadPct = (spread / asks[0].price * 100).toFixed(3);
                        if (spreadEl) spreadEl.textContent = `Spread: ${formatMarketPrice(spread, currentMarket)} (${spreadPct}%)`;
                    } else {
                        if (spreadEl) spreadEl.textContent = 'No data';
                    }
                }
            } catch (err) {
                if (isAbortError(err)) return;
                console.error('Error loading orderbook:', err);
                spreadEl.textContent = 'Error loading';
            } finally {
                endTrackedMarketRequest(requestContext);
            }
        }

        // Render orderbook (legacy + pro)
        function renderOrderbook(bids, asks) {
            // Render pro orderbook
            renderOrderbookPro(bids, asks);

            // Legacy orderbook rendering
            const bidsContainer = document.getElementById('orderbook-bids');
            const asksContainer = document.getElementById('orderbook-asks');
            if (!bidsContainer || !asksContainer) return;

            const allAmounts = [...bids, ...asks].map(o => o.amount);
            const maxAmount = Math.max(...allAmounts);
            bidsContainer.innerHTML = bids.slice(0, 10).map(bid => {
                const barWidth = (bid.amount / maxAmount * 100).toFixed(1);
                return `<div class="orderbook-row"><span class="bar" style="width: ${barWidth}%"></span><span class="price">${formatMarketPrice(bid.price, currentMarket)}</span><span class="amount">${formatMarketAmount(bid.amount)}</span></div>`;
            }).join('');
            asksContainer.innerHTML = asks.slice(0, 10).map(ask => {
                const barWidth = (ask.amount / maxAmount * 100).toFixed(1);
                return `<div class="orderbook-row"><span class="bar" style="width: ${barWidth}%"></span><span class="price">${formatMarketPrice(ask.price, currentMarket)}</span><span class="amount">${formatMarketAmount(ask.amount)}</span></div>`;
            }).join('');
        }

        // Trade polling state
        let latestTradeTimestamp = 0;  // Track last received trade for polling
        let tradePollingInterval = null;

        // Load trades data from /api/trades/deltas endpoint
        async function loadTradesData() {
            const requestContext = beginTrackedMarketRequest();
            const countEl = document.getElementById('trades-count');
            countEl.textContent = 'Loading...';

            try {
                // Use unified endpoint for all markets (BitMEX and Polymarket)
                const data = await HM_API.live.tradesDeltas({ market: currentMarket, limit: 500 }, { signal: requestContext.signal });
                if (isStaleMarketRequest(requestContext)) return;
                if (data.success && data.trades) {
                    // Transform trades to expected format and render
                    const trades = data.trades.map(t => ({
                        timestamp: Math.floor(t.t / 1000),  // Unix seconds
                        timestampMs: t.t,
                        price: t.p,
                        amount: t.a,
                        side: t.s
                    })).reverse();  // Newest first for display

                    renderLiveMarketTrades(trades);
                    countEl.textContent = `${trades.length} trades`;

                    // Store latest timestamp for polling
                    if (data.latestTimestamp) {
                        latestTradeTimestamp = data.latestTimestamp;
                    }

                    // Start trade polling (1 second interval)
                    startTradePolling();
                } else {
                    countEl.textContent = 'No trades';
                }
            } catch (err) {
                if (isAbortError(err)) return;
                console.error('Error loading trades:', err);
                countEl.textContent = 'Error';
            } finally {
                endTrackedMarketRequest(requestContext);
            }
        }

        // Start polling for new trades every second
        let tradePollingInProgress = false;  // Flag to prevent overlapping requests

        function startTradePolling() {
            if (tradePollingInterval) return; // Already polling

            tradePollingInterval = setInterval(async () => {
                // Skip if previous request hasn't completed yet
                if (tradePollingInProgress) return;

                tradePollingInProgress = true;
                const requestContext = beginTrackedMarketRequest();
                try {
                    // Poll for trades newer than our last timestamp
                    const data = await HM_API.live.tradesDeltas({ market: currentMarket, since: latestTradeTimestamp }, { signal: requestContext.signal });
                    if (isStaleMarketRequest(requestContext)) return;
                    if (data.success && data.trades && data.trades.length > 0) {
                        // Transform and prepend new trades
                        const newTrades = data.trades.map(t => ({
                            timestamp: Math.floor(t.t / 1000),
                            timestampMs: t.t,
                            price: t.p,
                            amount: t.a,
                            side: t.s
                        })).reverse();

                        // Update display with new trades
                        appendNewTrades(newTrades);

                        // Update timestamp for next poll
                        if (data.latestTimestamp) {
                            latestTradeTimestamp = data.latestTimestamp;
                        }

                        // Update forming candle with latest trade
                        const latest = newTrades[0];
                        if (latest) {
                            updateFormingCandle({
                                price: latest.price,
                                timestamp: latest.timestamp,
                                amount: latest.amount
                            });
                            // Update header price too
                            updateTradingHeader(latest.price);
                        }
                    }
                } catch (err) {
                    if (isAbortError(err)) return;
                    console.error('[Trade Poll] Error:', err.message);
                } finally {
                    endTrackedMarketRequest(requestContext);
                    tradePollingInProgress = false;
                }
            }, 1000);  // Poll every 1 second
        }

        // Stop trade polling
        function stopTradePolling() {
            if (tradePollingInterval) {
                clearInterval(tradePollingInterval);
                tradePollingInterval = null;
            }
            tradePollingInProgress = false;  // Reset flag
        }

        // Append new trades to the existing trade display
        function appendNewTrades(newTrades) {
            // Get current trades from the UI and prepend new ones
            // For now, just re-render with new trades on top
            const tbody = document.getElementById('trades-tbody');
            const countEl = document.getElementById('trades-count');

            if (!tbody) return;

            // Prepend new rows
            const newRows = newTrades.map(trade => {
                const time = new Date(trade.timestamp * 1000).toLocaleTimeString();
                const sideClass = trade.side === 'buy' ? 'side-buy' : 'side-sell';
                return `<tr><td>${time}</td><td class="${sideClass}">${trade.side.toUpperCase()}</td><td>${formatMarketPrice(trade.price, currentMarket)}</td><td>${formatMarketAmount(trade.amount)}</td></tr>`;
            }).join('');

            tbody.innerHTML = newRows + tbody.innerHTML;

            // Update professional trades panel
            renderTradesPro(newTrades, true);  // true = prepend mode

            // Trim to 50 rows max
            while (tbody.children.length > 50) {
                tbody.removeChild(tbody.lastChild);
            }

            // Update count
            const currentCount = parseInt(countEl.textContent) || 0;
            countEl.textContent = `${Math.min(currentCount + newTrades.length, 50)} trades`;
        }

        // Render live market trades (renamed to avoid collision with backtest renderTrades)
        function renderLiveMarketTrades(trades) {
            // Update professional trades panel
            renderTradesPro(trades);

            // Legacy table update
            const tbody = document.getElementById('trades-tbody');
            if (tbody) {
                tbody.innerHTML = trades.map(trade => {
                    const time = new Date(trade.timestamp * 1000).toLocaleTimeString();
                    const sideClass = trade.side === 'buy' ? 'side-buy' : 'side-sell';
                    return `<tr><td>${time}</td><td class="${sideClass}">${trade.side.toUpperCase()}</td><td>${formatMarketPrice(trade.price, currentMarket)}</td><td>${formatMarketAmount(trade.amount)}</td></tr>`;
                }).join('');
            }
        }

        // Format price based on market
        function formatMarketPrice(price, market) {
            // Polymarket markets have probability prices (0.00 - 1.00) - show 2 decimal places
            if (market && market.startsWith('polymarket:')) return price.toFixed(2);
            if (market === 'dogeusd' || market === 'xrpusd') return price.toFixed(4);
            else if (market === 'solusd') return price.toFixed(2);
            return price.toFixed(1);
        }

        // Format amount - clean decimal formatting
        function formatMarketAmount(amount) {
            if (amount == null) return '-';
            const num = parseFloat(amount);
            if (isNaN(num)) return amount;
            if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            // For amounts < 1000: show clean decimals (max 2 places, trim trailing zeros)
            if (num === Math.floor(num)) return num.toFixed(0);
            return parseFloat(num.toFixed(2)).toString();
        }


        // ==========================================
        // PRICE TO BEAT (Polymarket A markets)
        // ==========================================

        let priceToeBeatData = null;
        let priceToBeatInterval = null;

        // Fetch Price to Beat metadata for current market
        async function fetchPriceToBeat() {
            const requestContext = beginTrackedMarketRequest();
            const market = currentMarket;

            // Only show for Polymarket A markets (UP or DOWN)
            const isPolymarketA = market === 'polymarket:btc-15m-a-up' || market === 'polymarket:btc-15m-a-down';
            const ptbPanel = document.getElementById('price-to-beat-panel');

            if (!isPolymarketA) {
                if (ptbPanel) ptbPanel.style.display = 'none';
                if (priceToBeatInterval) {
                    clearInterval(priceToBeatInterval);
                    priceToBeatInterval = null;
                }
                return;
            }

            if (ptbPanel) ptbPanel.style.display = 'block';

            try {
                const data = await HM_API.live.polymarketMetadata({
                    market: 'btc-15m-a',
                    type: 'price_to_beat',
                    limit: 1
                }, { signal: requestContext.signal });
                if (isStaleMarketRequest(requestContext)) return;
                if (data.success && data.data && data.data.length > 0) {
                    priceToeBeatData = data.data[0];
                    updatePriceToBeatDisplay();
                }
            } catch (err) {
                if (isAbortError(err)) return;
                console.error('[PriceToBeat] Error fetching:', err.message);
            } finally {
                endTrackedMarketRequest(requestContext);
            }
        }

        // Update the Price to Beat display
        function updatePriceToBeatDisplay() {
            if (!priceToeBeatData) return;

            const btcPriceEl = document.getElementById('ptb-btc-price');
            const windowEl = document.getElementById('ptb-window');
            const countdownEl = document.getElementById('ptb-countdown');

            // Update BTC price
            if (btcPriceEl) {
                if (priceToeBeatData.btc_price && priceToeBeatData.btc_price > 0) {
                    btcPriceEl.textContent = '$' + priceToeBeatData.btc_price.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    });
                } else {
                    btcPriceEl.textContent = 'Loading...';
                }
            }

            // Update window times
            if (windowEl && priceToeBeatData.start_time && priceToeBeatData.end_time) {
                const startDate = new Date(priceToeBeatData.start_time * 1000);
                const endDate = new Date(priceToeBeatData.end_time * 1000);
                const formatTime = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                windowEl.textContent = `${formatTime(startDate)} - ${formatTime(endDate)}`;
            }

            // Update countdown
            if (countdownEl && priceToeBeatData.end_time) {
                const now = Date.now() / 1000;
                const remaining = priceToeBeatData.end_time - now;

                if (remaining <= 0) {
                    countdownEl.textContent = 'CLOSED';
                    countdownEl.style.color = '#ff4444';
                } else {
                    const mins = Math.floor(remaining / 60);
                    const secs = Math.floor(remaining % 60);
                    countdownEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
                    countdownEl.style.color = remaining < 60 ? '#ff8844' : '#00ff88';
                }
            }
        }

        // Start Price to Beat polling
        function startPriceToBeatPolling() {
            // Initial fetch
            fetchPriceToBeat();

            // Update countdown every second, refetch metadata every 15 seconds
            if (priceToBeatInterval) clearInterval(priceToBeatInterval);

            let tickCount = 0;
            priceToBeatInterval = setInterval(() => {
                updatePriceToBeatDisplay();
                tickCount++;
                if (tickCount >= 15) {
                    fetchPriceToBeat();
                    tickCount = 0;
                }
            }, 1000);
        }

        // ==========================================
        // LIVE MARKET POLLING
        // ==========================================

        let orderbookPollingInterval = null;

        // Start live market data polling
        function startLiveMarketPolling() {
            console.log('[LiveMarket] Starting polling for market data');
            // Trade polling is handled by startTradePolling() in loadTradesData()
            // Start orderbook polling here
            startOrderbookPolling();
        }

        let orderbookPollingInProgress = false;  // Flag to prevent overlapping requests

        function startOrderbookPolling() {
            if (orderbookPollingInterval) return;

            orderbookPollingInterval = setInterval(async () => {
                // Skip if previous request hasn't completed yet
                if (orderbookPollingInProgress) return;

                orderbookPollingInProgress = true;
                const requestContext = beginTrackedMarketRequest();
                try {
                    // Use unified endpoint for all markets (BitMEX and Polymarket)
                    const data = await HM_API.live.orderbook({ market: currentMarket, depth: 20 }, { signal: requestContext.signal });
                    if (isStaleMarketRequest(requestContext)) return;
                    if (data.success) {
                        // Unified endpoint returns bids/asks in consistent format
                        const bids = data.bids || [];
                        const asks = data.asks || [];
                        renderOrderbookPro(bids, asks);
                        // Update spread display
                        if (bids?.length && asks?.length) {
                            const spread = asks[0].price - bids[0].price;
                            const spreadPct = (spread / asks[0].price * 100).toFixed(3);
                            const spreadEl = document.getElementById('orderbook-spread');
                            if (spreadEl) spreadEl.textContent = `Spread: ${formatMarketPrice(spread, currentMarket)} (${spreadPct}%)`;
                        }
                    }
                } catch (err) {
                    if (isAbortError(err)) return;
                    // Silently ignore polling errors
                } finally {
                    endTrackedMarketRequest(requestContext);
                    orderbookPollingInProgress = false;
                }
            }, 1000);  // Poll every 1 second
        }

        function stopOrderbookPolling() {
            if (orderbookPollingInterval) {
                clearInterval(orderbookPollingInterval);
                orderbookPollingInterval = null;
            }
            orderbookPollingInProgress = false;  // Reset flag
        }

        function subscribeToMarket(market) {
            console.log('[LiveMarket] Market selected:', market);
        }

        function stopLiveMarketPolling() {
            stopTradePolling();
            stopOrderbookPolling();
            cancelInFlightMarketRequests('stop-live-market-polling');
        }

        // ==========================================
        // LIVE TEST CONTROL FUNCTIONS
        // ==========================================

        // Update UI based on live test state
        function updateLiveTestUI(state) {
            const statusIndicator = document.getElementById('status-indicator');
            const statusText = document.getElementById('status-text');
            const startBtn = document.getElementById('btn-start-test');
            const stopBtn = document.getElementById('btn-stop-backtest');
            const liveStats = document.getElementById('live-stats');
            const strategySelector = document.getElementById('strategy-selector');

            if (state === 'ready') {
                statusIndicator.className = 'status-indicator ready';
                statusText.textContent = 'Ready';
                startBtn.disabled = false;
                stopBtn.disabled = true;
                liveStats.classList.remove('active');
                strategySelector.disabled = false;
                // Reset Performance Metrics badge when test stops
                const metricsBadge = document.getElementById('metrics-badge');
                if (metricsBadge) metricsBadge.textContent = '14 Metrics';
            } else if (state === 'running') {
                statusIndicator.className = 'status-indicator running';
                statusText.textContent = 'Running...';
                startBtn.disabled = true;
                stopBtn.disabled = false;
                liveStats.classList.add('active');
                strategySelector.disabled = true;
            } else if (state === 'backtesting') {
                statusIndicator.className = 'status-indicator backtesting';
                statusText.textContent = 'Backtesting...';
                startBtn.disabled = true;
                stopBtn.disabled = true;
                liveStats.classList.remove('active');
                strategySelector.disabled = true;
            }
        }

        // Format duration from milliseconds
        function formatDuration(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }

        // Update live stats display
        function updateLiveStats(data) {
            // Use tradeCount from API (not trades)
            const tradeCount = data.tradeCount || 0;
            const liveTrades = document.getElementById('live-trades');
            if (liveTrades) liveTrades.textContent = tradeCount;
            // Also update pro UI
            const testTradesPro = document.getElementById('test-trades-pro');
            if (testTradesPro) testTradesPro.textContent = tradeCount;

            // Use totalPnl from API (not pnl)
            const pnl = data.totalPnl || 0;
            const pnlElement = document.getElementById('live-pnl');
            if (pnlElement) {
                pnlElement.textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
                pnlElement.className = 'live-stat-value ' + (pnl >= 0 ? 'positive' : 'negative');
            }
            // Also update pro UI
            const testPnlPro = document.getElementById('test-pnl-pro');
            if (testPnlPro) {
                testPnlPro.textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
                testPnlPro.className = pnl >= 0 ? 'stat-value positive' : 'stat-value negative';
            }

            if (liveTestStartTime) {
                const duration = Date.now() - liveTestStartTime;
                const durationStr = formatDuration(duration);
                const liveDuration = document.getElementById('live-duration');
                if (liveDuration) liveDuration.textContent = durationStr;
                // Also update pro UI
                const testDurationPro = document.getElementById('test-duration-pro');
                if (testDurationPro) testDurationPro.textContent = durationStr;
            }

            const liveStrategy = document.getElementById('live-strategy');
            if (liveStrategy) liveStrategy.textContent = currentStrategy;
        }

        // Flag to prevent double-clicking during API call
        let isStartingTest = false;

        // Start live test
        async function startLiveTest() {
            const btn = document.getElementById('btn-start-test');
            console.log('[startLiveTest] Function called');

            // Prevent double-clicking
            if (isStartingTest || liveTestRunning) {
                console.log('[startLiveTest] Already starting or running, ignoring click');
                btn.innerHTML = '<span>⏳</span> Please wait...';
                return;
            }
            isStartingTest = true;

            btn.innerHTML = '<span>1️⃣</span> Getting strategy...';

            const strategy = document.getElementById('strategy-selector').value;
            console.log('[startLiveTest] Strategy:', strategy);
            currentStrategy = strategy;

            try {
                console.log('[startLiveTest] Updating UI to running state');
                btn.innerHTML = '<span>2️⃣</span> Updating UI...';
                updateLiveTestUI('running');
                liveTestStartTime = Date.now();

                console.log('[startLiveTest] Fetching: /test/start');
                btn.innerHTML = '<span>3️⃣</span> Calling API...';

                const response = await HM_API.request('POST', '/test/start', {
                    body: { strategy: strategy }
                });
                console.log('[startLiveTest] Response received:', response.status, response.statusText);
                btn.innerHTML = '<span>4️⃣</span> Got response: ' + response.status;

                const result = await response.json();

                if (!response.ok) {
                    // Parse error from API response body
                    const errorMsg = result.error || result.message || `HTTP ${response.status}`;
                    throw new Error(errorMsg);
                }
                console.log('[startLiveTest] Live test started:', result);
                btn.innerHTML = '<span>✅</span> Started!';
                btn.style.border = '3px solid lime';

                liveTestRunning = true;
                isStartingTest = false;
                startPolling();
                console.log('[startLiveTest] Polling started');

            } catch (error) {
                console.error('[startLiveTest] FAILED:', error);
                btn.innerHTML = '<span>▶</span> Start Live Test';
                btn.style.border = '';
                isStartingTest = false;
                updateLiveTestUI('ready');

                // Show error toast to user
                showErrorToast(
                    'Failed to Start Test',
                    error.message || 'Could not connect to the Control API. Please check if the backend is running.',
                    10000
                );
            }
        }

        // Stop live test and trigger backtest
        async function stopAndBacktest() {
            try {
                updateLiveTestUI('backtesting');
                stopPolling();

                const result = await HM_API.test.stopAndBacktest({});
                console.log('Stop and backtest completed:', result);

                liveTestRunning = false;
                liveTestStartTime = null;

                // Wait a moment for backtest to complete
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Switch to comparison view to show TEST vs BACKTEST
                document.getElementById('session-selector').value = 'compare';
                await handleSessionChange('compare');

                // Update UI to show comparison is ready
                updateLiveTestUI('ready');

            } catch (error) {
                console.error('Failed to stop test or run backtest:', error);
                updateLiveTestUI('ready');
                liveTestRunning = false;
                showErrorToast(
                    'Backtest Failed',
                    error.message || 'Could not stop test or run backtest. Please try again.',
                    10000
                );
            }
        }

        // Poll for live test status
        let lastMetricsRefresh = 0;
        const METRICS_REFRESH_INTERVAL = 5000; // Refresh Performance Metrics every 5 seconds

        async function pollLiveTestStatus() {
            if (!liveTestRunning) return;

            try {
                const status = await HM_API.test.status();

                // Update the running status text
                const statusText = document.getElementById('status-text');
                statusText.textContent = `Running: ${status.tradeCount || 0} trades`;

                // Update live stats
                updateLiveStats(status);

                // Periodically refresh Performance Metrics panel with live test data
                const now = Date.now();
                if (now - lastMetricsRefresh > METRICS_REFRESH_INTERVAL) {
                    lastMetricsRefresh = now;
                    refreshPerformanceMetricsFromLiveTest();
                }

                // Check if test is still running
                if (!status.running && liveTestRunning) {
                    // Test was stopped externally
                    liveTestRunning = false;
                    stopPolling();
                    updateLiveTestUI('ready');
                }

            } catch (error) {
                console.warn('Status poll failed:', error.message);
                // Don't stop polling on transient errors
            }
        }

        // Refresh Performance Metrics panel with current live test data
        async function refreshPerformanceMetricsFromLiveTest() {
            try {
                const response = await HM_API.get('/session/test');
                if (!response.ok) return;
                const data = await response.json();
                if (data.success && data.metrics) {
                    // Add fallback values for missing metrics
                    const metrics = data.metrics;
                    metrics.initial_balance = metrics.initial_balance ?? 1.0;
                    metrics.final_balance = metrics.final_balance ?? (metrics.initial_balance + (metrics.total_pnl / 100));
                    metrics.total_return_percent = metrics.total_return_percent ?? metrics.total_pnl;
                    metrics.max_drawdown_percent = metrics.max_drawdown_percent ?? 0;
                    metrics.sharpe_ratio = metrics.sharpe_ratio ?? 0;
                    metrics.profit_factor = metrics.profit_factor ?? (metrics.winning_trades > 0 && metrics.losing_trades > 0 ?
                        Math.abs(metrics.avg_win * metrics.winning_trades) / Math.abs(metrics.avg_loss * metrics.losing_trades) : 0);
                    metrics.max_drawdown = metrics.max_drawdown ?? 0;

                    // Update Performance Metrics panel
                    renderMetrics(metrics);

                    // Update metrics badge to show live indicator
                    const badge = document.getElementById('metrics-badge');
                    if (badge) badge.textContent = '🔴 LIVE';

                    // Update equity curve status from live test data
                    const equityStatus = document.getElementById('equity-status');
                    if (equityStatus && data.equity_curve) {
                        equityStatus.textContent = data.equity_curve.length + ' data points';
                    }

                    // Update Trade Activity badge
                    const tradesBadge = document.getElementById('trades-badge');
                    if (tradesBadge && data.trades) {
                        const exitCount = data.trades.filter(t => t.exit_time_unix && t.exit_price).length;
                        tradesBadge.textContent = `${data.trades.length} entries / ${exitCount} exits`;
                    }

                    // Refresh equity curve chart if in strategy mode
                    if (typeof currentDashboardMode !== 'undefined' && currentDashboardMode === 'strategy') {
                        await loadEquityCurve();
                        await loadTradeOverlays();
                    }

                    // Update chart title with correct strategy name during live test
                    const chartTitle = document.getElementById('chart-title');
                    if (chartTitle && data.metadata?.bot_name) {
                        const candlePeriodLabel = currentCandlePeriod || '1m';
                        chartTitle.textContent = `BTC/USD Price (${candlePeriodLabel}) & ${data.metadata.bot_name} P&L (TEST)`;
                    }

                    console.log('[LiveTest] Refreshed - trades:', metrics.total_trades, 'P&L:', metrics.total_pnl, 'Equity points:', data.equity_curve?.length || 0);
                }
            } catch (err) {
                console.warn('[LiveTest] Failed to refresh Performance Metrics:', err.message);
            }
        }

        // Start status polling
        function startPolling() {
            // Initial status check
            pollLiveTestStatus();
        }

        // Stop polling
        function stopPolling() {
            // No-op - status fetched on demand
        }

        // Check initial test status on page load
        async function checkInitialTestStatus() {
            try {
                const response = await HM_API.get('/test/status');

                if (response.ok) {
                    const status = await response.json();

                    if (status.running) {
                        // Test is already running - resume polling
                        liveTestRunning = true;
                        liveTestStartTime = status.startTime ? status.startTime * 1000 : Date.now();
                        currentStrategy = status.strategy || 'Unknown';
                        document.getElementById('strategy-selector').value = currentStrategy;
                        updateLiveTestUI('running');
                        startPolling();
                    } else {
                        // No test running - enable the start button
                        updateLiveTestUI('ready');
                    }
                } else {
                    // API error - still enable buttons for manual attempt
                    updateLiveTestUI('ready');
                }
            } catch (error) {
                // API not available - still enable buttons (user will see error when they click)
                console.log('Control API not available:', error.message);
                updateLiveTestUI('ready');
            }
        }

        // ==========================================
        // END LIVE TEST CONTROL FUNCTIONS
        // ==========================================

        // ==========================================
        // STATUS HELPERS (polling-based)
        // ==========================================

        // Update status indicator
        function updatePollStatus(connected) {
            const dot = document.getElementById('poll-dot');
            const text = document.getElementById('poll-status-text');

            if (dot && text) {
                if (connected) {
                    dot.classList.add('connected');
                    text.textContent = 'Polling';
                } else {
                    dot.classList.remove('connected');
                    text.textContent = 'Offline';
                }
            }
        }

        // Show/hide the live trade feed
        function showLiveTradeFeed(show) {
            const feed = document.getElementById('live-trade-feed');
            if (feed) {
                if (show) {
                    feed.classList.add('active');
                } else {
                    feed.classList.remove('active');
                }
            }
        }

        // ==========================================
        // END STATUS HELPERS
        // ==========================================

        // Load backtest data from Control API (no static fallback)
        async function loadBacktestData(botName = 'DivergeBot') {
            try {
                // Try Control API first
                console.log(`[loadBacktestData] Trying Control API for ${botName}...`);
                let data = null;
                try {
                    const apiResponse = await HM_API.get('/session/backtest');
                    if (apiResponse.ok) {
                        data = await apiResponse.json();
                        if (data.success) {
                            console.log(`[loadBacktestData] Loaded ${data.trades?.length || 0} trades from Control API`);
                        } else {
                            data = null;
                        }
                    }
                } catch (apiErr) {
                    console.log(`[loadBacktestData] Control API not available: ${apiErr.message}`);
                }

                // If no data from API, return empty dataset
                if (!data) {
                    console.log(`[loadBacktestData] No data available, returning empty dataset`);
                    data = {
                        success: true,
                        metadata: {
                            bot_name: botName,
                            exchange: 'bitmex',
                            pair: 'BTC/USD',
                            session_type: 'backtest',
                            start_time: Math.floor(Date.now() / 1000) - 3600,
                            end_time: Math.floor(Date.now() / 1000)
                        },
                        metrics: {
                            total_pnl: 0,
                            win_rate: 0,
                            sharpe_ratio: 0,
                            max_drawdown: 0,
                            profit_factor: 0,
                            total_trades: 0,
                            winning_trades: 0,
                            losing_trades: 0,
                            avg_win: 0,
                            avg_loss: 0,
                            largest_win: 0,
                            largest_loss: 0,
                            avg_trade_duration: 0
                        },
                        trades: [],
                        equity_curve: [],
                        candles: []
                    };
                }

                // Add defaults for missing metrics fields
                const metrics = data.metrics;
                metrics.initial_balance = metrics.initial_balance ?? 1.0;
                metrics.final_balance = metrics.final_balance ?? (metrics.initial_balance + (metrics.total_pnl / 100));
                metrics.total_return_percent = metrics.total_return_percent ?? metrics.total_pnl;
                metrics.max_drawdown_percent = metrics.max_drawdown_percent ?? metrics.max_drawdown;

                // Add defaults for missing metadata fields (used in renderConfig)
                const metadata = data.metadata || {};
                data.metadata = metadata;
                metadata.bot_name = metadata.bot_name ?? botName;
                metadata.exchange = metadata.exchange ?? 'bitmex';
                metadata.pair = metadata.pair ?? 'BTC/USD';
                metadata.second_pair = metadata.second_pair ?? 'ETH/USD';
                metadata.trade_size = metadata.trade_size ?? 0.01;
                metadata.leverage = metadata.leverage ?? 1;
                metadata.initial_balance = metadata.initial_balance ?? 1;
                metadata.divergence_threshold = metadata.divergence_threshold ?? 0.003;
                metadata.ema_period = metadata.ema_period ?? 100;
                // Use trade timestamps for session period if not provided
                const firstTrade = data.trades?.[0];
                const lastTrade = data.trades?.[data.trades.length - 1];
                metadata.start_timestamp_unix = metadata.start_timestamp_unix ?? metadata.start_time ?? firstTrade?.timestamp_unix ?? Math.floor(Date.now() / 1000);
                metadata.end_timestamp_unix = metadata.end_timestamp_unix ?? metadata.end_time ?? lastTrade?.exit_time_unix ?? lastTrade?.timestamp_unix ?? Math.floor(Date.now() / 1000);

                // If data lacks candles or has non-1m candles, generate 1m candles from trades
                if (data.candles && data.candles.length >= 2) {
                    // Check if candles are 1-minute (60 sec apart) or larger timeframe
                    const candleInterval = data.candles[1].time - data.candles[0].time;
                    if (candleInterval > 60) {
                        console.log(`[loadBacktestData] Candles are ${candleInterval}s intervals (not 1m), generating 1m candles from trades`);
                        data.candles = generateCandlesFromTrades(data);
                    }
                } else if (!data.candles || data.candles.length === 0) {
                    console.log(`[loadBacktestData] No candles found, generating from trades`);
                    data.candles = generateCandlesFromTrades(data);
                }

                return data;
            } catch (error) {
                console.error('Failed to load backtest data:', error);
                throw error;
            }
        }

        // Load session-specific data
        async function loadSessionData(sessionType) {
            try {
                // First try to load from Control API (for fresh test/backtest data)
                const apiEndpoint = sessionType === 'test' ? '/session/test' : '/session/backtest';
                console.log(`[loadSessionData] Trying Control API: ${apiEndpoint}`);

                let data = null;
                let apiSuccess = false;
                try {
                    const apiResponse = await HM_API.get(apiEndpoint);
                    if (apiResponse.ok) {
                        data = await apiResponse.json();
                        if (data.success) {
                            apiSuccess = true;
                            console.log(`[loadSessionData] Loaded ${data.trades?.length || 0} trades from Control API`);
                        }
                    }
                } catch (apiErr) {
                    console.log(`[loadSessionData] Control API not available: ${apiErr.message}`);
                }

                // If no data from API, return empty dataset (no static fallback)
                if (!apiSuccess) {
                    console.log(`[loadSessionData] No data available from API, returning empty dataset`);
                    data = {
                        success: true,
                        metadata: {
                            bot_name: 'Unknown',
                            exchange: 'bitmex',
                            pair: 'BTC/USD',
                            session_type: sessionType,
                            start_time: Math.floor(Date.now() / 1000) - 3600,
                            end_time: Math.floor(Date.now() / 1000)
                        },
                        metrics: {
                            total_pnl: 0,
                            win_rate: 0,
                            sharpe_ratio: 0,
                            max_drawdown: 0,
                            profit_factor: 0,
                            total_trades: 0,
                            winning_trades: 0,
                            losing_trades: 0,
                            avg_win: 0,
                            avg_loss: 0,
                            largest_win: 0,
                            largest_loss: 0,
                            avg_trade_duration: 0
                        },
                        trades: [],
                        equity_curve: [],
                        candles: []
                    };
                }

                // Add defaults for missing metrics fields
                const metrics = data.metrics;
                metrics.initial_balance = metrics.initial_balance ?? 1.0;
                metrics.final_balance = metrics.final_balance ?? (metrics.initial_balance + (metrics.total_pnl / 100));
                metrics.total_return_percent = metrics.total_return_percent ?? metrics.total_pnl;
                metrics.max_drawdown_percent = metrics.max_drawdown_percent ?? metrics.max_drawdown ?? 0;
                // Additional defaults for metrics used in rendering
                metrics.sharpe_ratio = metrics.sharpe_ratio ?? 0;
                metrics.profit_factor = metrics.profit_factor ?? (metrics.winning_trades > 0 ? 1 : 0);
                metrics.avg_win = metrics.avg_win ?? (metrics.winning_trades > 0 ? metrics.total_pnl / metrics.winning_trades : 0);
                metrics.avg_loss = metrics.avg_loss ?? 0;
                metrics.max_drawdown = metrics.max_drawdown ?? 0;

                // Add defaults for missing metadata fields (used in renderConfig)
                const metadata = data.metadata;
                metadata.divergence_threshold = metadata.divergence_threshold ?? 0.003;
                metadata.ema_period = metadata.ema_period ?? 100;
                metadata.trade_size = metadata.trade_size ?? 0.01;
                metadata.leverage = metadata.leverage ?? 1;
                metadata.second_pair = metadata.second_pair ?? 'ETH/USD';
                metadata.initial_balance = metadata.initial_balance ?? 1;
                // Use trade timestamps for session period if not provided
                // Support both start_timestamp_unix and start_time field names
                const firstTrade = data.trades?.[0];
                const lastTrade = data.trades?.[data.trades.length - 1];
                metadata.start_timestamp_unix = metadata.start_timestamp_unix ?? metadata.start_time ?? firstTrade?.timestamp_unix ?? Math.floor(Date.now() / 1000);
                metadata.end_timestamp_unix = metadata.end_timestamp_unix ?? metadata.end_time ?? lastTrade?.exit_time_unix ?? lastTrade?.timestamp_unix ?? Math.floor(Date.now() / 1000);

                // Ensure equity_curve exists
                data.equity_curve = data.equity_curve || [];
                // Ensure trades array exists
                data.trades = data.trades || [];

                // If session data lacks candles or has non-1m candles, generate 1m candles from trades
                if (data.candles && data.candles.length >= 2) {
                    const candleInterval = data.candles[1].time - data.candles[0].time;
                    if (candleInterval > 60) {
                        console.log(`[loadSessionData] Candles are ${candleInterval}s intervals, generating 1m candles from ${data.trades?.length || 0} trades`);
                        data.candles = generateCandlesFromTrades(data);
                    }
                } else if (!data.candles || data.candles.length === 0) {
                    console.log(`[loadSessionData] No candles found, generating from ${data.trades?.length || 0} trades`);
                    data.candles = generateCandlesFromTrades(data);
                }
                console.log(`[loadSessionData] Final candle count: ${data.candles?.length || 0}`);

                return data;
            } catch (error) {
                console.error(`Failed to load ${sessionType} session data:`, error);
                throw error;
            }
        }

        // Load both sessions for comparison
        async function loadBothSessions() {
            const [testData, backtestData] = await Promise.all([
                loadSessionData('test'),
                loadSessionData('backtest')
            ]);
            return { testData, backtestData };
        }

        // Compare two metric values with tolerance
        function metricsMatch(val1, val2, tolerance = 0.01) {
            if (typeof val1 === 'number' && typeof val2 === 'number') {
                if (val1 === 0 && val2 === 0) return true;
                const diff = Math.abs(val1 - val2);
                const maxVal = Math.max(Math.abs(val1), Math.abs(val2), 1);
                return (diff / maxVal) <= tolerance;
            }
            return val1 === val2;
        }

        // Format trade time for display
        function formatTradeTime(timestamp) {
            return new Date(timestamp * 1000).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
        }

        // Render a single trade log item
        function renderTradeLogItem(trade, divergenceType = null) {
            const entryTime = formatTradeTime(trade.timestamp_unix);
            const sideClass = trade.side === 'long' ? 'side-long' : 'side-short';
            const sideIcon = trade.side === 'long' ? '▲' : '▼';
            const sideLabel = trade.side === 'long' ? 'Long' : 'Short';

            let exitHtml = '';
            if (trade.exit_time_unix && trade.exit_price) {
                const exitTime = formatTradeTime(trade.exit_time_unix);
                const pnlClass = (trade.pnl ?? 0) >= 0 ? 'pnl-positive' : 'pnl-negative';
                const pnlSign = (trade.pnl ?? 0) >= 0 ? '+' : '';
                exitHtml = `
                    <div class="trade-log-action">
                        <span class="exit">● Exit @ $${(trade.exit_price ?? 0).toFixed(1)}</span>
                        <span class="${pnlClass}">${pnlSign}$${(trade.pnl ?? 0).toFixed(2)}</span>
                    </div>
                    <div class="trade-log-time">${exitTime}</div>
                `;
            }

            const divergenceClass = divergenceType === 'divergent' ? 'divergent' :
                                    divergenceType === 'matching' ? 'matching' : '';

            return `
                <div class="trade-log-item ${divergenceClass}" data-divergence="${divergenceType || 'none'}">
                    <div class="trade-log-time">${entryTime}</div>
                    <div class="trade-log-action">
                        <span class="${sideClass}">${sideIcon} ${sideLabel} Entry</span>
                        <span>@ $${(trade.price ?? 0).toFixed(1)}</span>
                        <span style="color: #8892b0;">qty: ${trade.quantity ?? 0}</span>
                    </div>
                    ${exitHtml}
                </div>
            `;
        }

        // Compare trades between test and backtest to find divergences
        function findTradeDivergences(testTrades, backtestTrades) {
            const tolerance = 60; // 60 seconds tolerance for matching trades
            const priceTolerance = 0.001; // 0.1% price tolerance

            const testWithStatus = testTrades.map(t => ({ ...t, matched: false, divergenceType: 'divergent' }));
            const backtestWithStatus = backtestTrades.map(t => ({ ...t, matched: false, divergenceType: 'divergent' }));

            // Try to match trades
            testWithStatus.forEach(testTrade => {
                const matchingBacktest = backtestWithStatus.find(btTrade => {
                    if (btTrade.matched) return false;

                    const timeDiff = Math.abs(testTrade.timestamp_unix - btTrade.timestamp_unix);
                    const sideMatch = testTrade.side === btTrade.side;
                    const priceMatch = Math.abs(testTrade.price - btTrade.price) / testTrade.price < priceTolerance;

                    return timeDiff <= tolerance && sideMatch && priceMatch;
                });

                if (matchingBacktest) {
                    testTrade.matched = true;
                    testTrade.divergenceType = 'matching';
                    matchingBacktest.matched = true;
                    matchingBacktest.divergenceType = 'matching';
                }
            });

            return {
                testTrades: testWithStatus,
                backtestTrades: backtestWithStatus,
                divergenceCount: testWithStatus.filter(t => !t.matched).length +
                                 backtestWithStatus.filter(t => !t.matched).length
            };
        }

        // Render side-by-side trade logs comparison
        function renderTradeLogsComparison(testData, backtestData) {
            const testTrades = testData.trades || [];
            const backtestTrades = backtestData.trades || [];

            // Find divergences
            const { testTrades: testWithStatus, backtestTrades: backtestWithStatus, divergenceCount } =
                findTradeDivergences(testTrades, backtestTrades);

            // Update counts
            document.getElementById('test-trades-count').textContent = `${testTrades.length} trades`;
            document.getElementById('backtest-trades-count').textContent = `${backtestTrades.length} trades`;

            // Update divergence indicator
            const divergenceIndicator = document.getElementById('divergence-count');
            if (divergenceCount > 0) {
                divergenceIndicator.textContent = `${divergenceCount} divergence${divergenceCount > 1 ? 's' : ''}`;
                divergenceIndicator.style.display = 'inline-flex';
            } else {
                divergenceIndicator.style.display = 'none';
            }

            // Render test trades
            const testLogEl = document.getElementById('test-trades-log');
            if (testWithStatus.length === 0) {
                testLogEl.innerHTML = '<div class="no-trades-msg">No trades in test session</div>';
            } else {
                testLogEl.innerHTML = testWithStatus.map(t => renderTradeLogItem(t, t.divergenceType)).join('');
            }

            // Render backtest trades
            const backtestLogEl = document.getElementById('backtest-trades-log');
            if (backtestWithStatus.length === 0) {
                backtestLogEl.innerHTML = '<div class="no-trades-msg">No trades in backtest session</div>';
            } else {
                backtestLogEl.innerHTML = backtestWithStatus.map(t => renderTradeLogItem(t, t.divergenceType)).join('');
            }

            // Setup filter buttons
            setupTradeLogFilters();
        }

        // Setup filter button handlers for trade logs
        function setupTradeLogFilters() {
            const filterBtns = document.querySelectorAll('.trade-logs-filters .filter-btn');
            filterBtns.forEach(btn => {
                btn.onclick = () => {
                    // Update active state
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const filter = btn.dataset.filter;

                    // Filter both columns
                    document.querySelectorAll('.trade-log-item').forEach(item => {
                        const divergence = item.dataset.divergence;
                        if (filter === 'all') {
                            item.style.display = '';
                        } else if (filter === 'divergent') {
                            item.style.display = divergence === 'divergent' ? '' : 'none';
                        } else if (filter === 'matching') {
                            item.style.display = divergence === 'matching' ? '' : 'none';
                        }
                    });
                };
            });
        }

        // Render comparison view
        function renderComparisonView(testData, backtestData) {
            const testMetrics = testData.metrics;
            const backtestMetrics = backtestData.metrics;

            const metricsToCompare = [
                { key: 'total_trades', label: 'Total Trades', format: v => v },
                { key: 'winning_trades', label: 'Winning Trades', format: v => v },
                { key: 'losing_trades', label: 'Losing Trades', format: v => v },
                { key: 'total_pnl', label: 'Total P&L', format: v => formatPnL(v) },
                { key: 'win_rate', label: 'Win Rate', format: v => formatPercent(v) },
                { key: 'final_balance', label: 'Final Balance', format: v => (v ?? 0).toFixed(4) + ' BTC' }
            ];

            let matchCount = 0;
            let totalCount = metricsToCompare.length;

            // Render test metrics
            const testMetricsHtml = metricsToCompare.map(m => {
                const testVal = testMetrics[m.key];
                const backtestVal = backtestMetrics[m.key];
                const isMatch = metricsMatch(testVal, backtestVal);
                if (isMatch) matchCount++;

                return `
                    <div class="comparison-metric">
                        <span class="label">${m.label}</span>
                        <span class="value ${isMatch ? 'match' : 'mismatch'}">${m.format(testVal)}</span>
                    </div>
                `;
            }).join('');

            // Render backtest metrics
            const backtestMetricsHtml = metricsToCompare.map(m => {
                const testVal = testMetrics[m.key];
                const backtestVal = backtestMetrics[m.key];
                const isMatch = metricsMatch(testVal, backtestVal);

                return `
                    <div class="comparison-metric">
                        <span class="label">${m.label}</span>
                        <span class="value ${isMatch ? 'match' : 'mismatch'}">
                            ${m.format(backtestVal)}
                            <span class="match-indicator ${isMatch ? 'match' : 'mismatch'}">
                                ${isMatch ? '✓ Match' : '✗ Differs'}
                            </span>
                        </span>
                    </div>
                `;
            }).join('');

            document.getElementById('test-metrics').innerHTML = testMetricsHtml;
            document.getElementById('backtest-metrics').innerHTML = backtestMetricsHtml;

            // Update summary counts
            document.getElementById('matching-count').textContent = matchCount;
            document.getElementById('matching-count').className = 'number ' + (matchCount > 0 ? 'positive' : 'negative');
            document.getElementById('different-count').textContent = totalCount - matchCount;
            document.getElementById('different-count').className = 'number ' + (totalCount - matchCount > 0 ? 'negative' : 'positive');

            // Render side-by-side trade logs comparison
            renderTradeLogsComparison(testData, backtestData);
        }

        // Handle session change
        async function handleSessionChange(session) {
            console.log(`[handleSessionChange] Called with session: ${session}`);
            currentSession = session;
            const loadingEl = document.getElementById('loading-state');
            const contentEl = document.getElementById('dashboard-content');
            const comparisonEl = document.getElementById('comparison-container');

            try {
                console.log(`[handleSessionChange] Starting to load session: ${session}`);
                loadingEl.style.display = 'block';
                loadingEl.innerHTML = '<div class="loading">Loading session data...</div>';
                contentEl.style.display = 'none';
                comparisonEl.classList.remove('active');

                if (session === 'compare') {
                    // Load both and show comparison view
                    const { testData, backtestData } = await loadBothSessions();
                    testSessionData = testData;
                    backtestSessionData = backtestData;

                    loadingEl.style.display = 'none';
                    comparisonEl.classList.add('active');
                    contentEl.style.display = 'none';

                    renderComparisonView(testData, backtestData);

                    document.getElementById('timestamp').textContent =
                        `Last updated: ${new Date().toLocaleString()} | Comparing TEST vs BACKTEST sessions`;
                } else {
                    // Load single session and show normal dashboard
                    const data = await loadSessionData(session);
                    currentData = filterDataByPeriod(data, currentPeriod);

                    loadingEl.style.display = 'none';
                    contentEl.style.display = 'block';
                    comparisonEl.classList.remove('active');

                    // Update status indicators
                    document.getElementById('json-status').textContent = 'Loaded successfully';
                    document.getElementById('metrics-status').textContent = '14 metrics calculated';
                    document.getElementById('equity-status').textContent = currentData.equity_curve.length + ' data points';

                    // Render all components
                    renderMetrics(currentData.metrics);
                    renderConfig(currentData.metadata);
                    renderCharts(currentData);
                    renderTrades(currentData.trades);

                    // Update titles and badges
                    const sessionLabel = session === 'test' ? 'TEST' : 'BACKTEST';
                    const candlePeriodLabel = currentCandlePeriod === '1m' ? '1m' : currentCandlePeriod;
                    document.getElementById('chart-title').textContent =
                        `${currentData.metadata.pair} Price (${candlePeriodLabel}) & ${currentData.metadata.bot_name} P&L (${sessionLabel})`;
                    document.getElementById('bot-name-title').textContent =
                        `${currentData.metadata.bot_name} Configuration`;
                    document.getElementById('bot-badge').textContent = sessionLabel;
                    const exitCount = currentData.trades.filter(t => t.exit_time_unix && t.exit_price).length;
                    document.getElementById('trades-badge').textContent = `${currentData.trades.length} entries / ${exitCount} exits`;

                    document.getElementById('timestamp').textContent =
                        `Last updated: ${new Date().toLocaleString()} | ${sessionLabel} Session - ${currentData.metadata.bot_name}`;

                    animateCards();
                }
            } catch (error) {
                loadingEl.innerHTML = `
                    <div class="error-message">
                        <h3>Failed to load session data</h3>
                        <p>${error.message}</p>
                        <p style="margin-top: 10px; font-size: 0.9rem;">
                            Make sure test_session.json and backtest_session.json exist.
                        </p>
                    </div>
                `;
                loadingEl.style.display = 'block';
                contentEl.style.display = 'none';
                comparisonEl.classList.remove('active');
            }
        }

        // Filter data by date range
        function filterDataByPeriod(data, period) {
            if (period === 'all' || !data.trades || data.trades.length === 0) {
                return data;
            }

            const timestamps = data.trades.map(t => t.timestamp_unix);
            const minTime = Math.min(...timestamps);
            const maxTime = Math.max(...timestamps);
            const dayLength = 86400; // seconds in a day

            let startTime, endTime;
            switch (period) {
                case 'day1':
                    startTime = minTime;
                    endTime = minTime + dayLength;
                    break;
                case 'day2':
                    startTime = minTime + dayLength;
                    endTime = minTime + dayLength * 2;
                    break;
                case 'recent':
                    startTime = maxTime - dayLength;
                    endTime = maxTime + 1;
                    break;
                default:
                    return data;
            }

            // Filter trades
            const filteredTrades = data.trades.filter(t =>
                t.timestamp_unix >= startTime && t.timestamp_unix < endTime
            );

            // Filter candles
            const filteredCandles = data.candles ? data.candles.filter(c =>
                c.time >= startTime && c.time < endTime
            ) : [];

            // Filter equity curve
            const filteredEquity = data.equity_curve ? data.equity_curve.filter(e =>
                e.timestamp_unix >= startTime && e.timestamp_unix < endTime
            ) : [];

            // Recalculate metrics for filtered data
            const recalculatedMetrics = recalculateMetrics(filteredTrades, data.metrics);

            return {
                ...data,
                trades: filteredTrades,
                candles: filteredCandles,
                equity_curve: filteredEquity,
                metrics: recalculatedMetrics
            };
        }

        // Recalculate metrics for filtered trades
        function recalculateMetrics(trades, originalMetrics) {
            if (trades.length === 0) {
                return {
                    ...originalMetrics,
                    total_trades: 0,
                    winning_trades: 0,
                    losing_trades: 0,
                    total_pnl: 0,
                    win_rate: 0
                };
            }

            const winningTrades = trades.filter(t => t.pnl > 0);
            const losingTrades = trades.filter(t => t.pnl <= 0);
            const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);

            return {
                ...originalMetrics,
                total_trades: trades.length,
                winning_trades: winningTrades.length,
                losing_trades: losingTrades.length,
                total_pnl: totalPnl,
                win_rate: (winningTrades.length / trades.length) * 100,
                avg_win: winningTrades.length > 0
                    ? winningTrades.reduce((s, t) => s + t.pnl, 0) / winningTrades.length
                    : 0,
                avg_loss: losingTrades.length > 0
                    ? losingTrades.reduce((s, t) => s + t.pnl, 0) / losingTrades.length
                    : 0
            };
        }

        // Format number with sign
        function formatPnL(value, decimals = 2) {
            const v = value ?? 0;
            const sign = v >= 0 ? '+' : '';
            return sign + '$' + v.toFixed(decimals);
        }

        // Format percentage
        function formatPercent(value, decimals = 2) {
            return (value ?? 0).toFixed(decimals) + '%';
        }

        // Export trades to CSV (with entry/exit breakdown)
        function exportToCSV(data) {
            if (!data || !data.trades || data.trades.length === 0) {
                alert('No trade data to export');
                return;
            }

            const headers = ['Timestamp', 'Type', 'Side', 'Price', 'Quantity', 'PnL', 'Cumulative PnL'];
            const rows = [];

            data.trades.forEach(t => {
                // Entry row
                rows.push([
                    t.timestamp,
                    'Entry',
                    t.side,
                    t.price,
                    t.quantity,
                    '',
                    ''
                ]);

                // Exit row (if exists)
                if (t.exit_time_unix && t.exit_price) {
                    const exitTimestamp = new Date(t.exit_time_unix * 1000).toISOString().replace('T', ' ').replace('Z', '');
                    rows.push([
                        exitTimestamp,
                        'Exit',
                        t.side,
                        t.exit_price,
                        t.quantity,
                        t.pnl,
                        t.cumulative_pnl
                    ]);
                }
            });

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.join(','))
            ].join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${currentBot}_backtest_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();
        }

        // Export chart as image
        function exportChartAsImage() {
            const chartContainer = document.getElementById('chart-container');
            const canvas = chartContainer.querySelector('canvas');

            if (!canvas) {
                alert('Chart not ready for export');
                return;
            }

            // Create a temporary canvas with background
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const ctx = tempCanvas.getContext('2d');

            // Fill background
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

            // Draw the chart
            ctx.drawImage(canvas, 0, 0);

            // Download
            const link = document.createElement('a');
            link.download = `${currentBot}_chart_${new Date().toISOString().split('T')[0]}.png`;
            link.href = tempCanvas.toDataURL('image/png');
            link.click();
        }

        // Initialize dashboard
        async function initDashboard(botName = 'DivergeBot', period = 'all') {
            const loadingEl = document.getElementById('loading-state');
            const contentEl = document.getElementById('dashboard-content');

            try {
                if (loadingEl) {
                    loadingEl.style.display = 'block';
                    loadingEl.innerHTML = '<div class="loading">Loading backtest data...</div>';
                }
                if (contentEl) contentEl.style.display = 'none';

                let data = await loadBacktestData(botName);
                data = filterDataByPeriod(data, period);
                currentData = data;

                // Hide loading, show content
                if (loadingEl) loadingEl.style.display = 'none';
                if (contentEl) contentEl.style.display = 'block';

                // Update status indicators (with null checks)
                const jsonStatus = document.getElementById('json-status');
                const metricsStatus = document.getElementById('metrics-status');
                const equityStatus = document.getElementById('equity-status');
                if (jsonStatus) jsonStatus.textContent = 'Loaded successfully';
                if (metricsStatus) metricsStatus.textContent = '14 metrics calculated';
                if (equityStatus) equityStatus.textContent = data.equity_curve.length + ' data points';

                // Render all components
                renderMetrics(data.metrics);
                renderConfig(data.metadata);
                renderCharts(data);
                renderTrades(data.trades);

                // Update titles and badges (with null checks)
                const candlePeriodLabel = currentCandlePeriod === '1m' ? '1m' : currentCandlePeriod;
                const chartTitle = document.getElementById('chart-title');
                const botNameTitle = document.getElementById('bot-name-title');
                const botBadge = document.getElementById('bot-badge');
                const tradesBadge = document.getElementById('trades-badge');
                const timestamp = document.getElementById('timestamp');

                if (chartTitle) chartTitle.textContent =
                    `${data.metadata.pair} Price (${candlePeriodLabel}) & ${data.metadata.bot_name} P&L`;
                if (botNameTitle) botNameTitle.textContent =
                    `${data.metadata.bot_name} Configuration`;
                if (botBadge) botBadge.textContent = data.metadata.exchange.toUpperCase();
                const exitCount = data.trades.filter(t => t.exit_time_unix && t.exit_price).length;
                if (tradesBadge) tradesBadge.textContent = `${data.trades.length} entries / ${exitCount} exits`;
                if (timestamp) timestamp.textContent =
                    `Last updated: ${new Date().toLocaleString()} | Data: ${data.metadata.bot_name} on ${data.metadata.exchange} ${data.metadata.pair}`;

                // Update active bot card
                updateActiveBotCard(botName);

                // Animate cards
                animateCards();

            } catch (error) {
                if (loadingEl) {
                    loadingEl.innerHTML = `
                        <div class="error-message">
                            <h3>Failed to load backtest data</h3>
                            <p>${error.message}</p>
                            <p style="margin-top: 10px; font-size: 0.9rem;">
                                Make sure backtest_results.json exists and the page is served via HTTP server.
                            </p>
                        </div>
                    `;
                    loadingEl.style.display = 'block';
                }
                if (contentEl) contentEl.style.display = 'none';
            }
        }

        // Update active bot card styling
        function updateActiveBotCard(botName) {
            document.querySelectorAll('.bot-card').forEach(card => {
                card.classList.remove('active');
                if (card.dataset.bot === botName) {
                    card.classList.add('active');
                }
            });
        }

        // Render all 14 metrics
        function renderMetrics(metrics) {
            const grid = document.getElementById('metrics-grid');
            if (!grid) return; // Element not in DOM

            const metricsList = [
                { label: 'Total P&L', value: formatPnL(metrics.total_pnl), positive: metrics.total_pnl >= 0 },
                { label: 'Total Return', value: formatPercent(metrics.total_return_percent), positive: metrics.total_return_percent >= 0 },
                { label: 'Win Rate', value: formatPercent(metrics.win_rate), positive: metrics.win_rate >= 50 },
                { label: 'Sharpe Ratio', value: (metrics.sharpe_ratio ?? 0).toFixed(2), positive: (metrics.sharpe_ratio ?? 0) >= 1 },
                { label: 'Max Drawdown', value: '$' + (metrics.max_drawdown ?? 0).toFixed(2), positive: false },
                { label: 'Max DD %', value: formatPercent(metrics.max_drawdown_percent), positive: false },
                { label: 'Total Trades', value: metrics.total_trades ?? 0, positive: true },
                { label: 'Winning Trades', value: metrics.winning_trades ?? 0, positive: true },
                { label: 'Losing Trades', value: metrics.losing_trades ?? 0, positive: false },
                { label: 'Avg Win', value: formatPnL(metrics.avg_win), positive: true },
                { label: 'Avg Loss', value: formatPnL(metrics.avg_loss), positive: false },
                { label: 'Profit Factor', value: (metrics.profit_factor ?? 0).toFixed(2), positive: (metrics.profit_factor ?? 0) >= 1.5 },
                { label: 'Initial Balance', value: (metrics.initial_balance ?? 0).toFixed(4) + ' BTC', positive: true },
                { label: 'Final Balance', value: (metrics.final_balance ?? 0).toFixed(4) + ' BTC', positive: (metrics.final_balance ?? 0) >= (metrics.initial_balance ?? 0) }
            ];

            grid.innerHTML = metricsList.map(m => `
                <div class="stat stat-sm">
                    <div class="stat-label stat-label-sm">${m.label}</div>
                    <div class="stat-value stat-value-sm ${m.positive ? 'positive' : 'negative'}">${m.value}</div>
                </div>
            `).join('');
        }

        // Render bot configuration
        function renderConfig(metadata) {
            const section = document.getElementById('config-section');
            if (!section) return; // Element not in DOM

            const startDate = new Date(metadata.start_timestamp_unix * 1000).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric'
            });
            const endDate = new Date(metadata.end_timestamp_unix * 1000).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric'
            });

            section.innerHTML = `
                <div style="margin-bottom: 15px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px;">
                    <div class="stat-label">Backtest Period</div>
                    <div style="color: #fff; margin-top: 5px;">${startDate} - ${endDate}</div>
                </div>
                <div class="config-grid">
                    <div class="config-item">
                        <div class="config-label">Exchange</div>
                        <div class="config-value">${metadata.exchange.toUpperCase()}</div>
                    </div>
                    <div class="config-item">
                        <div class="config-label">Trading Pair</div>
                        <div class="config-value">${metadata.pair}</div>
                    </div>
                    ${metadata.second_pair ? `
                    <div class="config-item">
                        <div class="config-label">Second Pair</div>
                        <div class="config-value">${metadata.second_pair}</div>
                    </div>
                    ` : ''}
                    <div class="config-item">
                        <div class="config-label">Trade Size</div>
                        <div class="config-value">${metadata.trade_size} BTC</div>
                    </div>
                    <div class="config-item">
                        <div class="config-label">Leverage</div>
                        <div class="config-value">${metadata.leverage}x</div>
                    </div>
                    <div class="config-item">
                        <div class="config-label">Initial Balance</div>
                        <div class="config-value">${metadata.initial_balance} BTC</div>
                    </div>
                    ${metadata.ema_period ? `
                    <div class="config-item">
                        <div class="config-label">EMA Period</div>
                        <div class="config-value">${metadata.ema_period}</div>
                    </div>
                    ` : ''}
                    ${metadata.divergence_threshold ? `
                    <div class="config-item">
                        <div class="config-label">Divergence</div>
                        <div class="config-value">${(metadata.divergence_threshold * 100).toFixed(2)}%</div>
                    </div>
                    ` : ''}
                </div>
            `;
        }

        // Generate 1-minute candles from trade data (when session lacks candle data)
        function generateCandlesFromTrades(data) {
            if (!data.trades || data.trades.length === 0) return [];

            // Collect all price points with timestamps
            const pricePoints = [];
            data.trades.forEach(trade => {
                pricePoints.push({ time: trade.timestamp_unix, price: trade.price });
                if (trade.exit_time_unix && trade.exit_price) {
                    pricePoints.push({ time: trade.exit_time_unix, price: trade.exit_price });
                }
            });

            // Add equity curve points if available
            if (data.equity_curve && data.equity_curve.length > 0) {
                // Use first trade price as reference
                const refPrice = pricePoints.length > 0 ? pricePoints[0].price : 0;
                // Note: equity curve doesn't have price, just use trade prices
            }

            if (pricePoints.length === 0) return [];

            // Sort by time
            pricePoints.sort((a, b) => a.time - b.time);

            // Find time range
            const minTime = pricePoints[0].time;
            const maxTime = pricePoints[pricePoints.length - 1].time;

            // Group into 1-minute buckets
            const candles = [];
            const bucketSize = 60; // 1 minute in seconds

            // Round start time down to minute boundary
            let currentBucket = Math.floor(minTime / bucketSize) * bucketSize;
            const endBucket = Math.floor(maxTime / bucketSize) * bucketSize;

            let lastPrice = pricePoints[0].price;
            let priceIdx = 0;

            while (currentBucket <= endBucket) {
                const bucketEnd = currentBucket + bucketSize;

                // Find all prices in this bucket
                const bucketPrices = [];
                while (priceIdx < pricePoints.length && pricePoints[priceIdx].time < bucketEnd) {
                    bucketPrices.push(pricePoints[priceIdx].price);
                    priceIdx++;
                }

                if (bucketPrices.length > 0) {
                    candles.push({
                        time: currentBucket,
                        open: lastPrice,
                        high: Math.max(lastPrice, ...bucketPrices),
                        low: Math.min(lastPrice, ...bucketPrices),
                        close: bucketPrices[bucketPrices.length - 1]
                    });
                    lastPrice = bucketPrices[bucketPrices.length - 1];
                } else {
                    // No trades in this minute - create flat candle
                    candles.push({
                        time: currentBucket,
                        open: lastPrice,
                        high: lastPrice,
                        low: lastPrice,
                        close: lastPrice
                    });
                }

                currentBucket += bucketSize;
            }

            console.log(`Generated ${candles.length} 1m candles from ${pricePoints.length} price points`);
            return candles;
        }

        // Aggregate 1m candles into larger timeframes
        function aggregateCandles(candles, period) {
            console.log(`[aggregateCandles] Input: ${candles?.length || 0} candles, period: ${period}`);
            if (!candles || candles.length === 0) return [];
            if (period === '1m') {
                console.log(`[aggregateCandles] Returning ${candles.length} raw 1m candles`);
                return candles;
            }

            // Period in seconds
            const periodSeconds = {
                '1m': 60,
                '5m': 300,
                '15m': 900,
                '1h': 3600,
                '1d': 86400
            };

            const periodSecs = periodSeconds[period] || 60;

            // Group candles by period
            const groups = {};
            candles.forEach(candle => {
                // Floor timestamp to period boundary
                const periodStart = Math.floor(candle.time / periodSecs) * periodSecs;

                if (!groups[periodStart]) {
                    groups[periodStart] = [];
                }
                groups[periodStart].push(candle);
            });

            // Aggregate each group into a single candle
            const aggregated = Object.keys(groups)
                .map(key => parseInt(key))
                .sort((a, b) => a - b)
                .map(periodStart => {
                    const group = groups[periodStart];
                    // Sort by time to ensure correct order
                    group.sort((a, b) => a.time - b.time);

                    const open = group[0].open;
                    const close = group[group.length - 1].close;
                    const high = Math.max(...group.map(c => c.high));
                    const low = Math.min(...group.map(c => c.low));
                    const volume = group.reduce((sum, c) => sum + (c.volume || 0), 0);

                    return {
                        time: periodStart,
                        open: open,
                        high: high,
                        low: low,
                        close: close,
                        volume: volume
                    };
                });

            console.log(`[aggregateCandles] Output: ${aggregated.length} candles after ${period} aggregation`);
            return aggregated;
        }

        // Render TradingView charts
        function renderCharts(data) {
            // Clear existing charts
            const chartContainer = document.getElementById('chart-container');
            const equityContainer = document.getElementById('equity-chart-container');
            chartContainer.innerHTML = '';
            equityContainer.innerHTML = '';

            // Get container dimensions
            const containerWidth = chartContainer.offsetWidth || chartContainer.clientWidth || 800;
            const containerHeight = chartContainer.offsetHeight || 400;

            mainChart = LightweightCharts.createChart(chartContainer, {
                width: containerWidth,
                height: containerHeight,
                layout: {
                    background: { type: 'solid', color: 'transparent' },
                    textColor: '#8892b0',
                },
                grid: {
                    vertLines: { color: 'rgba(255,255,255,0.05)' },
                    horzLines: { color: 'rgba(255,255,255,0.05)' },
                },
                crosshair: {
                    mode: LightweightCharts.CrosshairMode.Normal,
                },
                rightPriceScale: {
                    borderColor: 'rgba(255,255,255,0.1)',
                    autoScale: true,
                },
                timeScale: {
                    borderColor: 'rgba(255,255,255,0.1)',
                    timeVisible: true,
                    fixLeftEdge: false,
                    fixRightEdge: false,
                },
                handleScroll: {
                    mouseWheel: true,
                    pressedMouseMove: true,
                    horzTouchDrag: true,
                    vertTouchDrag: true,
                },
                handleScale: {
                    axisPressedMouseMove: true,
                    mouseWheel: true,
                    pinch: true,
                },
            });

            // Store raw candles for aggregation
            if (data.candles && data.candles.length > 0) {
                rawCandles = data.candles;
            }

            // Add candlestick series with aggregated candles
            if (data.candles && data.candles.length > 0) {
                const candleSeries = mainChart.addCandlestickSeries({
                    upColor: '#26a69a',
                    downColor: '#ef5350',
                    borderDownColor: '#ef5350',
                    borderUpColor: '#26a69a',
                    wickDownColor: '#ef5350',
                    wickUpColor: '#26a69a',
                });

                // Apply aggregation based on current period
                const displayCandles = aggregateCandles(data.candles, currentCandlePeriod);
                safeSetData(candleSeries, displayCandles, 'backtestCandleChart');

                // Add trade markers - both entry AND exit markers
                if (data.trades && data.trades.length > 0) {
                    const markers = [];

                    // Helper to find closest candle to a timestamp
                    const findClosestCandle = (timestamp) => {
                        return data.candles.reduce((prev, curr) => {
                            return Math.abs(curr.time - timestamp) < Math.abs(prev.time - timestamp) ? curr : prev;
                        });
                    };

                    data.trades.forEach(trade => {
                        // ENTRY marker - arrow shape
                        const entryCandle = findClosestCandle(trade.timestamp_unix);
                        markers.push({
                            time: entryCandle.time,
                            position: trade.side === 'long' ? 'belowBar' : 'aboveBar',
                            color: trade.side === 'long' ? '#2196F3' : '#FF9800', // Blue for long entry, orange for short entry
                            shape: trade.side === 'long' ? 'arrowUp' : 'arrowDown',
                            text: '', // No text to prevent overlap on clustered trades
                        });

                        // EXIT marker - circle shape (if exit data exists)
                        if (trade.exit_time_unix && trade.exit_price) {
                            const exitCandle = findClosestCandle(trade.exit_time_unix);
                            markers.push({
                                time: exitCandle.time,
                                position: trade.side === 'long' ? 'aboveBar' : 'belowBar', // Opposite of entry
                                color: trade.pnl >= 0 ? '#00c853' : '#ff5252', // Green for profit, red for loss
                                shape: 'circle',
                                text: '', // No text to prevent overlap
                            });
                        }
                    });

                    // Sort markers by time (required by Lightweight Charts)
                    markers.sort((a, b) => a.time - b.time);
                    safeSetMarkers(candleSeries, markers, 'backtestTradeMarkers');
                }
            }

            mainChart.timeScale().fitContent();
            // Ensure price scale auto-fits the data range
            mainChart.priceScale('right').applyOptions({ autoScale: true });

            // Equity curve chart
            const equityWidth = equityContainer.offsetWidth || equityContainer.clientWidth || 800;
            const equityHeight = equityContainer.offsetHeight || 250;

            equityChart = LightweightCharts.createChart(equityContainer, {
                width: equityWidth,
                height: equityHeight,
                layout: {
                    background: { type: 'solid', color: 'transparent' },
                    textColor: '#8892b0',
                },
                grid: {
                    vertLines: { color: 'rgba(255,255,255,0.05)' },
                    horzLines: { color: 'rgba(255,255,255,0.05)' },
                },
                rightPriceScale: {
                    borderColor: 'rgba(255,255,255,0.1)',
                },
                timeScale: {
                    borderColor: 'rgba(255,255,255,0.1)',
                    timeVisible: true,
                },
                handleScroll: {
                    mouseWheel: true,
                    pressedMouseMove: true,
                    horzTouchDrag: true,
                    vertTouchDrag: true,
                },
                handleScale: {
                    axisPressedMouseMove: true,
                    mouseWheel: true,
                    pinch: true,
                },
            });

            // Equity line
            const equitySeries = equityChart.addLineSeries({
                color: '#00d4ff',
                lineWidth: 2,
            });

            const equityData = data.equity_curve.map(p => ({
                time: Math.floor(p.timestamp_unix),
                value: p.equity
            }));

            if (equityData.length > 0) {
                safeSetData(equitySeries, equityData, 'backtestEquityChart');
            }

            // Drawdown area
            const drawdownSeries = equityChart.addAreaSeries({
                topColor: 'rgba(255,82,82,0.4)',
                bottomColor: 'rgba(255,82,82,0.0)',
                lineColor: '#ff5252',
                lineWidth: 1,
                priceScaleId: 'drawdown',
            });

            const drawdownData = data.equity_curve.map(p => ({
                time: Math.floor(p.timestamp_unix),
                value: -p.drawdown
            }));

            if (drawdownData.length > 0) {
                safeSetData(drawdownSeries, drawdownData, 'backtestDrawdownChart');
            }

            equityChart.priceScale('drawdown').applyOptions({
                scaleMargins: { top: 0.8, bottom: 0 },
            });

            equityChart.timeScale().fitContent();

            // Apply adaptive time formatting for zoom
            setupAdaptiveTimeFormat(equityChart);

            // Handle resize
            const handleResize = () => {
                const chartWidth = chartContainer.offsetWidth || chartContainer.clientWidth;
                const eqWidth = equityContainer.offsetWidth || equityContainer.clientWidth;
                if (chartWidth > 0 && mainChart) {
                    mainChart.applyOptions({ width: chartWidth });
                }
                if (eqWidth > 0 && equityChart) {
                    equityChart.applyOptions({ width: eqWidth });
                }
            };

            window.addEventListener('resize', handleResize);
            setTimeout(handleResize, 250);
        }

        // Render trades table with entry and exit rows
        function renderTrades(trades) {
            const tradesTable = document.getElementById('trades-table');
            if (!tradesTable) return; // Element not in DOM
            const tbody = tradesTable.querySelector('tbody');
            if (!tbody) return;

            if (!trades || trades.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #8892b0;">No trades in selected period</td></tr>';
                return;
            }

            // Create rows for both entries and exits
            const rows = [];
            trades.forEach((trade, index) => {
                // Entry row
                const entryTime = new Date(trade.timestamp_unix * 1000).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                });
                const entryType = trade.side === 'long' ? 'Long Entry' : 'Short Entry';
                const entryColor = trade.side === 'long' ? '#2196F3' : '#FF9800';

                rows.push({
                    timestamp: trade.timestamp_unix,
                    html: `
                        <tr style="border-left: 3px solid ${entryColor};">
                            <td>${entryTime}</td>
                            <td style="color: ${entryColor}; font-weight: 500;">
                                ${trade.side === 'long' ? '&#x25B2;' : '&#x25BC;'} ${entryType}
                            </td>
                            <td>$${(trade.price ?? 0).toFixed(1)}</td>
                            <td>${trade.quantity ?? 0}</td>
                            <td style="color: #8892b0;">-</td>
                            <td style="color: #8892b0;">-</td>
                        </tr>
                    `
                });

                // Exit row (if exit data exists)
                if (trade.exit_time_unix && trade.exit_price) {
                    const exitTime = new Date(trade.exit_time_unix * 1000).toLocaleString('en-US', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    });
                    const exitType = trade.side === 'long' ? 'Close Long' : 'Close Short';
                    const exitColor = trade.pnl >= 0 ? '#00c853' : '#ff5252';
                    const profitSign = trade.pnl >= 0 ? '+' : '';

                    rows.push({
                        timestamp: trade.exit_time_unix,
                        html: `
                            <tr style="border-left: 3px solid ${exitColor};">
                                <td>${exitTime}</td>
                                <td style="color: ${exitColor}; font-weight: 500;">
                                    &#x25CF; ${exitType}
                                </td>
                                <td>$${(trade.exit_price ?? 0).toFixed(1)}</td>
                                <td>${trade.quantity ?? 0}</td>
                                <td class="${(trade.pnl ?? 0) >= 0 ? 'positive' : 'negative'}">${profitSign}$${(trade.pnl ?? 0).toFixed(2)}</td>
                                <td class="${(trade.cumulative_pnl ?? 0) >= 0 ? 'positive' : 'negative'}">${(trade.cumulative_pnl ?? 0) >= 0 ? '+' : ''}$${(trade.cumulative_pnl ?? 0).toFixed(2)}</td>
                            </tr>
                        `
                    });
                }
            });

            // Sort rows by timestamp
            rows.sort((a, b) => a.timestamp - b.timestamp);
            tbody.innerHTML = rows.map(r => r.html).join('');
        }

        // Animate cards on load
        function animateCards() {
            document.querySelectorAll('.card').forEach((card, i) => {
                card.style.opacity = '0';
                card.style.transform = 'translateY(20px)';
                setTimeout(() => {
                    card.style.transition = 'opacity 0.5s, transform 0.5s';
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, i * 100);
            });
        }

        // Setup event listeners
        function setupEventListeners() {
            console.log('[setupEventListeners] Setting up event listeners');

            // Live Test Control buttons (with null checks)
            const startBtn = document.getElementById('btn-start-test');
            console.log('[setupEventListeners] Start button found:', !!startBtn);
            if (startBtn) {
                startBtn.addEventListener('click', (e) => {
                    console.log('[btn-start-test] CLICK EVENT FIRED');
                    e.preventDefault();
                    startLiveTest();
                });
            }
            const stopBtn = document.getElementById('btn-stop-backtest');
            if (stopBtn) stopBtn.addEventListener('click', stopAndBacktest);

            // Session selector dropdown
            const sessionSelector = document.getElementById('session-selector');
            if (sessionSelector) {
                sessionSelector.addEventListener('change', (e) => {
                    console.log(`[session-selector] Change event fired, value: ${e.target.value}`);
                    handleSessionChange(e.target.value);
                });
            }

            // Bot selector dropdown
            const botSelector = document.getElementById('bot-selector');
            if (botSelector) {
                botSelector.addEventListener('change', (e) => {
                    currentBot = e.target.value;
                    if (currentSession === 'compare') {
                        handleSessionChange('compare');
                    } else {
                        initDashboard(currentBot, currentPeriod);
                    }
                });
            }

            // Strategy selector for live test - drives dashboard mode
            const strategySelector = document.getElementById('strategy-selector');
            if (strategySelector) strategySelector.addEventListener('change', async (e) => {
                currentStrategy = e.target.value;

                // Switch dashboard mode based on strategy selection
                if (currentStrategy === 'none') {
                    // Mode A: Live market only
                    document.getElementById('live-strategy').textContent = 'None';
                    document.getElementById('btn-start-test').disabled = true;
                    document.getElementById('btn-start-test').classList.add('disabled');
                    updateStrategyDescription('none');
                    clearIndicators();
                    await switchDashboardMode('market');
                } else {
                    // Mode B: Strategy selected - show trade overlays + equity curve
                    document.getElementById('live-strategy').textContent = currentStrategy;
                    document.getElementById('btn-start-test').disabled = false;
                    document.getElementById('btn-start-test').classList.remove('disabled');
                    updateStrategyDescription(currentStrategy);
                    updateChartIndicators(currentStrategy);
                    await switchDashboardMode('strategy');
                }

                // Update chart title if we have data loaded
                if (currentData && currentData.metadata) {
                    const candlePeriodLabel = currentCandlePeriod;
                    const sessionLabel = currentSession === 'test' ? ' (TEST)' : '';
                    const strategyLabel = currentStrategy === 'none' ? '' : ` & ${currentStrategy} P&L`;
                    document.getElementById('chart-title').textContent =
                        `${currentData.metadata.pair} Price (${candlePeriodLabel})${strategyLabel}${sessionLabel}`;
                }
                console.log(`[strategy-selector] Strategy changed to: ${currentStrategy}, mode: ${currentStrategy === 'none' ? 'market' : 'strategy'}`);
            });

            // Date range selector
            const dateSelector = document.getElementById('date-selector');
            if (dateSelector) {
                dateSelector.addEventListener('change', (e) => {
                    currentPeriod = e.target.value;
                    if (currentSession !== 'compare') {
                        initDashboard(currentBot, currentPeriod);
                    }
                });
            }

            // Candle period selector
            const candlePeriodSelector = document.getElementById('candle-period-selector');
            if (candlePeriodSelector) {
                candlePeriodSelector.addEventListener('change', (e) => {
                    currentCandlePeriod = e.target.value;
                    console.log(`[Period Change] Selected: ${currentCandlePeriod}, has data: ${!!currentData}, candles: ${currentData?.candles?.length || 0}`);
                    if (currentSession !== 'compare' && currentData) {
                        renderCharts(currentData);
                        // Update chart title with new period - use currentStrategy if test is running
                        const candlePeriodLabel = currentCandlePeriod;
                        const sessionLabel = currentSession === 'test' ? ' (TEST)' : '';
                        const botName = (liveTestRunning && currentStrategy && currentStrategy !== 'none')
                            ? currentStrategy
                            : currentData.metadata.bot_name;
                        const chartTitle = document.getElementById('chart-title');
                        if (chartTitle) {
                            chartTitle.textContent =
                                `${currentData.metadata.pair} Price (${candlePeriodLabel}) & ${botName} P&L${sessionLabel}`;
                        }
                    }
                });
            }

            // Bot cards click
            document.querySelectorAll('.bot-card').forEach(card => {
                card.addEventListener('click', () => {
                    const botName = card.dataset.bot;
                    const botSelectorEl = document.getElementById('bot-selector');
                    if (botSelectorEl) botSelectorEl.value = botName;
                    currentBot = botName;
                    initDashboard(currentBot, currentPeriod);
                });
            });

            // Export CSV button
            const exportCsvBtn = document.getElementById('export-csv-btn');
            if (exportCsvBtn) {
                exportCsvBtn.addEventListener('click', () => {
                    exportToCSV(currentData);
                });
            }

            // Export Chart button
            const exportChartBtn = document.getElementById('export-chart-btn');
            if (exportChartBtn) {
                exportChartBtn.addEventListener('click', () => {
                    exportChartAsImage();
                });
            }
        }

        // Initialize on page load
        console.log('[INIT] Starting initialization sequence...');
        if (typeof initializeStaticUiOptions === 'function') {
            initializeStaticUiOptions();
            console.log('[INIT] initializeStaticUiOptions done');
        }
        setupEventListeners();
        console.log('[INIT] setupEventListeners done');
        initDashboard();
        console.log('[INIT] initDashboard done');
        initViewToggle(); // Enable view toggle between Backtest and Live Market
        console.log('[INIT] initViewToggle done');
        initLiveMarketControls(); // Setup live market data controls
        console.log('[INIT] initLiveMarketControls done');
        initPeriodDropdown(); // Setup professional period dropdown
        console.log('[INIT] initPeriodDropdown done');
        initChartPeriodBar(); // Setup bottom time range buttons
        console.log('[INIT] initChartPeriodBar done');
        initTabBar(); // Setup bottom tab bar navigation
        console.log('[INIT] initTabBar done');
        initProBotControls(); // Setup pro bot controls
        console.log('[INIT] initProBotControls done');
        initSessionManagement(); // Setup session management (Phase 2)
        console.log('[INIT] initSessionManagement done - ALL INIT COMPLETE');

        // Tab bar navigation
        function initTabBar() {
            document.querySelectorAll('.tab-item').forEach(tab => {
                tab.addEventListener('click', () => {
                    // Remove active from all tabs and contents
                    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    // Activate clicked tab and its content
                    tab.classList.add('active');
                    const tabId = 'tab-' + tab.dataset.tab;
                    const content = document.getElementById(tabId);
                    if (content) content.classList.add('active');
                });
            });
        }

        // Pro bot controls initialization
        function initProBotControls() {
            console.log('[initProBotControls] >>> FUNCTION CALLED <<<');
            const strategyPro = document.getElementById('strategy-selector-pro');
            const startPro = document.getElementById('btn-start-test-pro');
            const stopPro = document.getElementById('btn-stop-backtest-pro');
            console.log(`[initProBotControls] Elements found - strategyPro: ${!!strategyPro}, startPro: ${!!startPro}, stopPro: ${!!stopPro}`);

            if (strategyPro) {
                console.log('[initProBotControls] Adding change listener to strategy-selector-pro');
                // Add both change and input listeners for debugging
                strategyPro.addEventListener('input', (e) => {
                    console.log(`[Pro Controls INPUT] Value: ${e.target.value}`);
                });
                strategyPro.addEventListener('change', async (e) => {
                    console.log('[CHANGE] ========== HANDLER ENTERED ==========');
                    const strategy = e.target.value;
                    console.log(`[CHANGE] Step 1: strategy value = "${strategy}"`);

                    // Sync with legacy selector
                    const legacySelector = document.getElementById('strategy-selector');
                    if (legacySelector) legacySelector.value = strategy;
                    console.log('[CHANGE] Step 2: synced legacy selector');

                    // Enable/disable start button
                    if (startPro) {
                        startPro.disabled = (strategy === 'none');
                        console.log(`[CHANGE] Step 3: button disabled = ${strategy === 'none'}`);
                    }

                    // Update current strategy
                    currentStrategy = strategy;
                    console.log(`[CHANGE] Step 4: currentStrategy set to "${currentStrategy}"`);

                    // Load trade overlays and metrics if strategy selected
                    console.log(`[CHANGE] Step 5: checking if strategy !== 'none': ${strategy !== 'none'}`);
                    if (strategy !== 'none') {
                        console.log('[CHANGE] Step 6: INSIDE if block - will call functions');
                        try {
                            console.log('[CHANGE] Step 7: calling updateChartIndicators...');
                            updateChartIndicators(strategy);
                            console.log('[CHANGE] Step 8: updateChartIndicators done');

                            console.log('[CHANGE] Step 9: calling loadProMetrics...');
                            loadProMetrics(strategy);
                            console.log('[CHANGE] Step 10: loadProMetrics started (async)');

                            console.log('[CHANGE] Step 11: calling loadTradeOverlays...');
                            await loadTradeOverlays();
                            console.log('[CHANGE] Step 12: loadTradeOverlays DONE');

                            console.log('[CHANGE] Step 13: calling loadBotsTabTradeLogs...');
                            await loadBotsTabTradeLogs();
                            console.log('[CHANGE] Step 14: loadBotsTabTradeLogs DONE');
                        } catch (err) {
                            console.error('[CHANGE] ERROR in handler:', err);
                        }
                    } else {
                        console.log('[CHANGE] Step 6b: strategy is none, clearing overlays');
                        clearTradeOverlays();
                    }
                    console.log('[CHANGE] ========== HANDLER COMPLETE ==========');
                });
            }

            if (startPro) {
                startPro.addEventListener('click', () => {
                    if (typeof startLiveTest === 'function') {
                        startLiveTest();
                        document.getElementById('test-stats-pro').style.display = 'flex';
                    }
                });
            }

            if (stopPro) {
                stopPro.addEventListener('click', () => {
                    if (typeof stopAndBacktest === 'function') {
                        stopAndBacktest();
                    }
                });
            }
        }

        // Load metrics for pro panel
        async function loadProMetrics(strategy) {
            try {
                const data = await loadBacktestData(strategy);
                if (data && data.metrics) {
                    const m = data.metrics;
                    const setMetric = (id, val) => {
                        const el = document.getElementById(id);
                        if (el) el.textContent = val;
                    };
                    setMetric('metric-winrate', (m.win_rate || 0).toFixed(1) + '%');
                    setMetric('metric-pf', (m.profit_factor || 0).toFixed(2));
                    setMetric('metric-pnl', '$' + (m.total_pnl || 0).toFixed(2));
                    setMetric('metric-trades', m.total_trades || 0);
                    setMetric('metric-avgtrade', '$' + ((m.total_pnl || 0) / (m.total_trades || 1)).toFixed(2));
                    setMetric('metric-dd', (m.max_drawdown_percent || 0).toFixed(1) + '%');
                }
            } catch (err) {
                console.error('[loadProMetrics] Error:', err);
            }
        }

        // Load trade logs for the Your Bots tab
        async function loadBotsTabTradeLogs() {
            console.log('[loadBotsTabTradeLogs] >>> CALLED <<<');
            try {
                // Try backtest session first
                console.log('[loadBotsTabTradeLogs] Fetching from: /session/backtest');
                const response = await HM_API.get('/session/backtest');

                console.log(`[loadBotsTabTradeLogs] Response status: ${response.status}`);
                if (!response.ok) {
                    if (response.status === 401) {
                        console.warn('[loadBotsTabTradeLogs] 401 - API key may be invalid or expired');
                    }
                    console.log('[loadBotsTabTradeLogs] ABORT: No backtest data available');
                    return;
                }

                const data = await response.json();
                console.log(`[loadBotsTabTradeLogs] Data received - success: ${data.success}, trades: ${data.trades?.length || 0}`);

                // Update the backtest trade log in Your Bots tab
                const backtestLogEl = document.getElementById('backtest-trades-log');
                const backtestCountEl = document.getElementById('backtest-trades-count');
                console.log(`[loadBotsTabTradeLogs] DOM elements - backtestLogEl: ${!!backtestLogEl}, backtestCountEl: ${!!backtestCountEl}`);

                // Handle no session data - show helpful message
                if (!data.success || !data.trades || data.trades.length === 0) {
                    console.log('[loadBotsTabTradeLogs] No active session data');
                    if (backtestCountEl) {
                        backtestCountEl.textContent = 'No session';
                        backtestCountEl.style.color = '#8b949e';
                    }
                    if (backtestLogEl) {
                        backtestLogEl.innerHTML = '<div class="no-session-msg" style="color: #8b949e; padding: 12px; text-align: center; font-size: 11px;">No active session<br><span style="color: #58a6ff;">Run a backtest to see trade data</span></div>';
                    }
                    return;
                }

                const trades = data.trades;
                console.log(`[loadBotsTabTradeLogs] Processing ${trades.length} trades`);

                if (backtestCountEl) {
                    backtestCountEl.textContent = `${trades.length} trades`;
                    backtestCountEl.style.color = '#3fb950';
                    console.log(`[loadBotsTabTradeLogs] Updated count to: ${trades.length} trades`);
                }

                if (backtestLogEl) {
                    // Render each trade
                    backtestLogEl.innerHTML = trades.map(trade => {
                        const entryTime = new Date(trade.timestamp_unix * 1000).toLocaleTimeString();
                        const exitTime = trade.exit_time_unix ? new Date(trade.exit_time_unix * 1000).toLocaleTimeString() : '--';
                        const pnl = parseFloat(trade.pnl) || 0;
                        const pnlClass = pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
                        const sideClass = trade.side === 'long' ? 'side-long' : 'side-short';
                        const entryPrice = parseFloat(trade.entry_price);

                        return `
                            <div class="trade-log-item">
                                <div class="trade-log-time">${entryTime}</div>
                                <div class="trade-log-action">
                                    <span class="${sideClass}">${trade.side?.toUpperCase() || 'UNKNOWN'}</span>
                                    @ ${!isNaN(entryPrice) ? entryPrice.toFixed(1) : '--'}
                                </div>
                                <div class="trade-log-details">
                                    <span class="${pnlClass}">$${pnl.toFixed(2)}</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                }
            } catch (err) {
                console.error('[loadBotsTabTradeLogs] Error:', err);
            }
        }

        // Default to Market mode (no strategy selected)
        (async function initLiveMarketView() {
            // Set initial strategy to 'none'
            currentStrategy = 'none';

            // Disable start button initially (no strategy selected)
            const startBtn = document.getElementById('btn-start-test');
            if (startBtn) {
                startBtn.disabled = true;
                startBtn.classList.add('disabled');
            }

            // Update strategy display
            const liveStrategyEl = document.getElementById('live-strategy');
            if (liveStrategyEl) liveStrategyEl.textContent = 'None';
            updateStrategyDescription('none');

            // Hide backtest controls (but keep live-test-panel visible)
            document.querySelectorAll('.control-group').forEach(el => el.style.display = 'none');
            const exportButtons = document.querySelector('.export-buttons');
            if (exportButtons) exportButtons.style.display = 'none';
            const liveTradeFeed = document.getElementById('live-trade-feed');
            if (liveTradeFeed) liveTradeFeed.style.display = 'none';

            // Hide equity curve container (market mode)
            const equityCurveContainer = document.getElementById('equity-curve-container');
            if (equityCurveContainer) equityCurveContainer.style.display = 'none';

            // Hide backtest content
            const dashboardContent = document.getElementById('dashboard-content');
            if (dashboardContent) dashboardContent.style.display = 'none';

            // Initialize chart and load data
            initLiveMarketChart();
            await loadLiveMarketData();

            // Start polling for real-time updates
            startLiveMarketPolling();
        })();

        checkInitialTestStatus(); // Check if a live test is already running
