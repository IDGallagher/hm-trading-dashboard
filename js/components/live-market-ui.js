// Live market UI component helpers

        // === PROFESSIONAL UI FUNCTIONS ===

        // Update header with current price and stats
        function updateTradingHeader(price, change24h = null) {
            const priceValueEl = document.getElementById('price-value');
            const priceMainEl = document.getElementById('header-price');
            const priceArrowEl = document.getElementById('price-arrow');
            const changeEl = document.getElementById('header-change');
            const markEl = document.getElementById('header-mark');

            if (priceValueEl && price) {
                // Format with comma separators
                const formattedPrice = price.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
                priceValueEl.textContent = formattedPrice;
            }

            if (priceMainEl && change24h !== null) {
                priceMainEl.className = 'price-main' + (change24h >= 0 ? '' : ' down');
            }

            if (priceArrowEl && change24h !== null) {
                priceArrowEl.textContent = change24h >= 0 ? '↑' : '↓';
            }

            if (changeEl && change24h !== null) {
                const changePercent = Math.abs(change24h).toFixed(2);
                changeEl.textContent = (change24h >= 0 ? '+' : '-') + changePercent + '%';
                changeEl.className = 'price-change' + (change24h >= 0 ? ' positive' : '');
            }

            if (markEl && price) {
                markEl.textContent = price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            }

            // Update instrument name based on market
            const instrumentEl = document.getElementById('header-instrument');
            if (instrumentEl) {
                instrumentEl.textContent = getMarketInstrumentSymbol(currentMarket) || 'BTCUSD';
            }
        }

        // Render orderbook in professional format
        function renderOrderbookPro(bids, asks) {
            const bidsContainer = document.getElementById('orderbook-bids-pro');
            const asksContainer = document.getElementById('orderbook-asks-pro');
            const spreadRow = document.getElementById('spread-row');
            const spreadHeader = document.getElementById('orderbook-spread-header');

            if (!bidsContainer || !asksContainer) return;

            // Calculate totals and max for depth bars
            // Show up to 15 levels each side
            let bidTotal = 0, askTotal = 0;
            const bidRows = bids.slice(0, 15).map(b => { bidTotal += b.amount; return { ...b, total: bidTotal }; });
            // Asks: calculate totals in original order (lowest first), then reverse for display (highest at top, lowest at bottom near spread)
            const askRowsRaw = asks.slice(0, 15).map(a => { askTotal += a.amount; return { ...a, total: askTotal }; });
            const askRows = askRowsRaw.reverse();  // Now highest price at top, lowest at bottom
            const maxTotal = Math.max(bidTotal, askTotal);

            // Render asks (sells) - highest at top, lowest at bottom (near spread)
            asksContainer.innerHTML = askRows.map(ask => {
                const depth = (ask.total / maxTotal * 100).toFixed(0);
                return `<div class="orderbook-row ask">
                    <span class="depth-bar" style="width: ${depth}%"></span>
                    <span class="ob-price">${formatMarketPrice(ask.price, currentMarket)}</span>
                    <span class="ob-size">${formatMarketAmount(ask.amount)}</span>
                    <span class="ob-total">${formatMarketAmount(ask.total)}</span>
                </div>`;
            }).join('');

            // Spread
            if (bids.length && asks.length) {
                const spread = asks[0].price - bids[0].price;
                const spreadPercent = (spread / asks[0].price * 100).toFixed(3);
                if (spreadRow) spreadRow.textContent = `Spread: ${formatMarketPrice(spread, currentMarket)} (${spreadPercent}%)`;
                if (spreadHeader) spreadHeader.textContent = `Spread: ${spreadPercent}%`;
            }

            // Render bids (buys)
            bidsContainer.innerHTML = bidRows.map(bid => {
                const depth = (bid.total / maxTotal * 100).toFixed(0);
                return `<div class="orderbook-row bid">
                    <span class="depth-bar" style="width: ${depth}%"></span>
                    <span class="ob-price">${formatMarketPrice(bid.price, currentMarket)}</span>
                    <span class="ob-size">${formatMarketAmount(bid.amount)}</span>
                    <span class="ob-total">${formatMarketAmount(bid.total)}</span>
                </div>`;
            }).join('');
            // Note: Don't call renderOrderbook here - it already calls us (avoid circular call)
        }

        // Render trades in professional format
        function renderTradesPro(trades, prepend = false) {
            const container = document.getElementById('recent-trades-pro');
            const countEl = document.getElementById('trades-count');
            if (!container) return;

            const newHtml = trades.slice(0, 30).map(trade => {
                const time = new Date(trade.timestamp * 1000).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
                const side = trade.side === 'buy' ? 'BUY' : 'SELL';
                return `<div class="trade-row ${trade.side}">
                    <span class="trade-time">${time}</span>
                    <span class="trade-side">${side}</span>
                    <span class="trade-price">${formatMarketPrice(trade.price, currentMarket)}</span>
                    <span class="trade-size">${formatMarketAmount(trade.amount)}</span>
                </div>`;
            }).join('');

            if (prepend) {
                container.innerHTML = newHtml + container.innerHTML;
                // Trim to 30 rows
                while (container.children.length > 30) {
                    container.removeChild(container.lastChild);
                }
            } else {
                container.innerHTML = newHtml;
            }

            if (countEl && !prepend) countEl.textContent = trades.length;
        }

        function getConfiguredPeriods() {
            return (window.HM_UI_OPTIONS?.PERIOD_OPTIONS || []).map((p) => p.value);
        }

        function getValidPeriodFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const period = params.get('period');
            if (!period) return null;
            return getConfiguredPeriods().includes(period) ? period : null;
        }

        function persistPeriodToUrl(period) {
            try {
                const url = new URL(window.location.href);
                url.searchParams.set('period', period);
                window.history.replaceState({}, '', url.toString());
            } catch (err) {
                console.warn('[Period] Failed to persist period in URL:', err.message);
            }
        }

        function applyPeriodToUi(period) {
            currentMarketPeriod = period;

            const label = document.getElementById('period-label');
            if (label) label.textContent = period;

            document.querySelectorAll('.period-option').forEach((opt) => {
                opt.classList.toggle('active', opt.dataset.period === period);
            });

            document.querySelectorAll('[id="market-period-selector"]').forEach((select) => {
                if (Array.from(select.options).some((o) => o.value === period)) {
                    select.value = period;
                }
            });

            const candlePeriod = document.getElementById('candle-period-selector');
            if (candlePeriod && Array.from(candlePeriod.options).some((o) => o.value === period)) {
                candlePeriod.value = period;
            }
        }

        // Initialize period dropdown
        function initPeriodDropdown() {
            const btn = document.getElementById('period-btn');
            const menu = document.getElementById('period-menu');
            const label = document.getElementById('period-label');

            if (!btn || !menu) return;

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.toggle('show');
            });

            document.addEventListener('click', () => menu.classList.remove('show'));

            menu.querySelectorAll('.period-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const period = opt.dataset.period;
                    applyPeriodToUi(period);
                    persistPeriodToUrl(period);
                    menu.classList.remove('show');
                    formingCandle = null;
                    earliestCandleTime = null;
                    isLoadingOlderCandles = false;
                    clearIndicators();
                    loadPriceData();
                });
            });
        }

        // Initialize bottom period selector (time range buttons)
        function initChartPeriodBar() {
            const buttons = document.querySelectorAll('.chart-period-btn');
            if (!buttons.length) return;

            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    const range = btn.dataset.range;
                    if (!range || !lastCandleData || lastCandleData.length === 0) return;

                    // Update active state
                    buttons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    // Calculate time range based on selection
                    const lastTime = lastCandleData[lastCandleData.length - 1].time;
                    let hoursBack;

                    switch (range) {
                        case '1y': hoursBack = 24 * 365; break;
                        case '1m': hoursBack = 24 * 30; break;
                        case '5d': hoursBack = 24 * 5; break;
                        case '1d': hoursBack = 24; break;
                        case '5h': hoursBack = 5; break;
                        default: hoursBack = 24;
                    }

                    const visibleFrom = lastTime - (hoursBack * 3600);
                    liveMarketChart.timeScale().setVisibleRange({
                        from: visibleFrom,
                        to: lastTime + 300
                    });
                });
            });
        }

        // Initialize live market controls
        function initLiveMarketControls() {
            const marketSelector = document.getElementById('market-selector');
            const marketSelectorSecondary = document.getElementById('market-selector-secondary');
            const periodSelector = document.getElementById('market-period-selector');
            const refreshBtn = document.getElementById('refresh-market-btn');

            function getValidMarketFromUrl() {
                const params = new URLSearchParams(window.location.search);
                const market = params.get('market');
                if (!market) return null;

                const configured = window.HM_UI_OPTIONS?.LIVE_MARKETS || [];
                const isValid = configured.some(group =>
                    (group.options || []).some(opt => opt.value === market)
                );

                return isValid ? market : null;
            }

            function persistMarketToUrl(market) {
                try {
                    const url = new URL(window.location.href);
                    url.searchParams.set('market', market);
                    window.history.replaceState({}, '', url.toString());
                } catch (err) {
                    console.warn('[Market] Failed to persist market in URL:', err.message);
                }
            }

            console.log('[Market] initLiveMarketControls called', {
                marketSelector: !!marketSelector,
                marketSelectorSecondary: !!marketSelectorSecondary
            });

            // Common handler for market change
            function handleMarketChange(newMarket, sourceSelector) {
                console.log('[Market] handleMarketChange called:', newMarket, 'from:', sourceSelector?.id);
                if (typeof window.onLiveMarketContextChange === 'function') {
                    window.onLiveMarketContextChange('market-change');
                }
                currentMarket = newMarket;
                persistMarketToUrl(newMarket);
                formingCandle = null; // Reset forming candle on market change
                earliestCandleTime = null; // Reset lazy loading state
                archiveMinTime = null;
                isLoadingOlderCandles = false;
                clearIndicators(); // Clear indicators before loading new data

                // Update UI based on market type
                updateMarketUI(newMarket);

                console.log('[Market] Calling loadLiveMarketData for:', currentMarket);
                loadLiveMarketData();

                // Start polling for the new market
                console.log('[Market] Calling subscribeToMarket for:', currentMarket);
                subscribeToMarket(currentMarket);

                // Update Price to Beat panel (Polymarket A markets only)
                startPriceToBeatPolling();

                // Sync the other selector
                if (sourceSelector !== marketSelector && marketSelector) {
                    marketSelector.value = newMarket;
                }
                if (sourceSelector !== marketSelectorSecondary && marketSelectorSecondary) {
                    marketSelectorSecondary.value = newMarket;
                }
            }

            // Update UI elements based on market
            function updateMarketUI(market) {
                const headerInstrument = document.getElementById('header-instrument');
                const instrumentType = document.querySelector('.instrument-type');

                // Update header instrument name
                if (headerInstrument) {
                    headerInstrument.textContent = getMarketInstrumentSymbol(market);
                }

                // Update instrument type based on market
                if (instrumentType) {
                    if (market.startsWith('polymarket:')) {
                        instrumentType.textContent = 'Prediction';
                    } else {
                        instrumentType.textContent = 'Perpetual';
                    }
                    instrumentType.style.display = 'inline';
                }
            }

            if (marketSelector) {
                console.log('[Market] Adding change listener to market-selector');
                marketSelector.addEventListener('change', (e) => {
                    console.log('[Market] market-selector change event fired:', e.target.value);
                    handleMarketChange(e.target.value, marketSelector);
                });
            }
            if (marketSelectorSecondary) {
                console.log('[Market] Adding change listener to market-selector-secondary');
                marketSelectorSecondary.addEventListener('change', (e) => {
                    console.log('[Market] market-selector-secondary change event fired:', e.target.value);
                    handleMarketChange(e.target.value, marketSelectorSecondary);
                });
            }
            if (periodSelector) periodSelector.addEventListener('change', (e) => {
                if (typeof window.onLiveMarketContextChange === 'function') {
                    window.onLiveMarketContextChange('period-change');
                }
                applyPeriodToUi(e.target.value);
                persistPeriodToUrl(currentMarketPeriod);
                formingCandle = null; // Reset forming candle on period change
                earliestCandleTime = null; // Reset lazy loading state
                isLoadingOlderCandles = false;
                clearIndicators(); // Clear indicators before loading new data
                loadPriceData();
            });
            if (refreshBtn) refreshBtn.addEventListener('click', loadLiveMarketData);

            // Initialize market from URL so refresh preserves selected asset.
            const marketFromUrl = getValidMarketFromUrl();
            if (marketFromUrl) {
                currentMarket = marketFromUrl;
                if (marketSelector) marketSelector.value = marketFromUrl;
                if (marketSelectorSecondary) marketSelectorSecondary.value = marketFromUrl;
                updateMarketUI(marketFromUrl);
            } else {
                // Ensure URL is synchronized with default/active market too.
                persistMarketToUrl(currentMarket);
            }

            // Initialize period from URL so refresh preserves selected timeframe.
            const periodFromUrl = getValidPeriodFromUrl();
            if (periodFromUrl) {
                applyPeriodToUi(periodFromUrl);
            } else {
                persistPeriodToUrl(currentMarketPeriod);
            }

            // Ensure market-specific panels (e.g., Polymarket Price-to-Beat) are restored on refresh.
            if (typeof startPriceToBeatPolling === 'function') {
                startPriceToBeatPolling();
            }
        }

