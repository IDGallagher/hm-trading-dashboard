(function () {
    const LIVE_MARKETS = [
        {
            group: 'BitMEX Perpetuals',
            options: [
                { value: 'xbtusd', primaryLabel: 'BTC/USD', secondaryLabel: 'BTC/USD (XBTUSD)', instrument: 'BTCUSD', sessionMarket: 'XBTUSD' },
                { value: 'ethusd', primaryLabel: 'ETH/USD', secondaryLabel: 'ETH/USD (ETHUSD)', instrument: 'ETHUSD', sessionMarket: 'ETHUSD' },
                { value: 'solusd', primaryLabel: 'SOL/USD', secondaryLabel: 'SOL/USD (SOLUSD)', instrument: 'SOLUSD', sessionMarket: 'SOLUSD' },
                { value: 'xrpusd', primaryLabel: 'XRP/USD', secondaryLabel: 'XRP/USD (XRPUSD)', instrument: 'XRPUSD' },
                { value: 'dogeusd', primaryLabel: 'DOGE/USD', secondaryLabel: 'DOGE/USD (DOGEUSD)', instrument: 'DOGEUSD' }
            ]
        },
        {
            group: 'Binance Futures',
            options: [
                { value: 'binance:btcusdt', primaryLabel: 'BTC/USDT', secondaryLabel: 'BTC/USDT (BTCUSDT)', instrument: 'BTCUSDT' }
            ]
        },
        {
            group: 'Bybit Perpetuals',
            options: [
                { value: 'bybit:btcusdt', primaryLabel: 'BTC/USDT', secondaryLabel: 'BTC/USDT (Bybit BTCUSDT)', instrument: 'BTCUSDT' }
            ]
        },
        {
            group: 'Coinbase Spot',
            options: [
                { value: 'coinbase:btc-usd', primaryLabel: 'BTC/USD', secondaryLabel: 'BTC/USD (Coinbase BTC-USD)', instrument: 'BTCUSD' }
            ]
        },
        {
            group: 'Polymarket (Slot A)',
            options: [
                { value: 'polymarket:btc-15m-a-up', primaryLabel: 'BTC 15m A-UP', secondaryLabel: 'BTC 15m A-UP', instrument: 'A-UP' },
                { value: 'polymarket:btc-15m-a-down', primaryLabel: 'BTC 15m A-DOWN', secondaryLabel: 'BTC 15m A-DOWN', instrument: 'A-DOWN' }
            ]
        },
        {
            group: 'Polymarket (Slot B)',
            options: [
                { value: 'polymarket:btc-15m-b-up', primaryLabel: 'BTC 15m B-UP', secondaryLabel: 'BTC 15m B-UP', instrument: 'B-UP' },
                { value: 'polymarket:btc-15m-b-down', primaryLabel: 'BTC 15m B-DOWN', secondaryLabel: 'BTC 15m B-DOWN', instrument: 'B-DOWN' }
            ]
        },
        {
            group: 'Polymarket (Slot C)',
            options: [
                { value: 'polymarket:btc-15m-c-up', primaryLabel: 'BTC 15m C-UP', secondaryLabel: 'BTC 15m C-UP', instrument: 'C-UP' },
                { value: 'polymarket:btc-15m-c-down', primaryLabel: 'BTC 15m C-DOWN', secondaryLabel: 'BTC 15m C-DOWN', instrument: 'C-DOWN' }
            ]
        },
        {
            group: 'Chainlink Data Streams',
            options: [
                { value: 'chainlink:btc-usd', primaryLabel: 'BTC/USD', secondaryLabel: 'BTC/USD (Chainlink)', instrument: 'BTCUSD' },
                { value: 'chainlink:eth-usd', primaryLabel: 'ETH/USD', secondaryLabel: 'ETH/USD (Chainlink)', instrument: 'ETHUSD' },
                { value: 'chainlink:sol-usd', primaryLabel: 'SOL/USD', secondaryLabel: 'SOL/USD (Chainlink)', instrument: 'SOLUSD' },
                { value: 'chainlink:xrp-usd', primaryLabel: 'XRP/USD', secondaryLabel: 'XRP/USD (Chainlink)', instrument: 'XRPUSD' }
            ]
        }
    ];

    function buildSessionMarketsFromLiveMarkets() {
        const fallback = [
            { value: 'XBTUSD', label: 'XBTUSD' },
            { value: 'ETHUSD', label: 'ETHUSD' },
            { value: 'SOLUSD', label: 'SOLUSD' }
        ];

        const seen = new Set();
        const derived = LIVE_MARKETS
            .flatMap((group) => group.options || [])
            .map((option) => option.sessionMarket)
            .filter((market) => typeof market === 'string' && market.length > 0)
            .filter((market) => {
                if (seen.has(market)) return false;
                seen.add(market);
                return true;
            })
            .map((market) => ({ value: market, label: market }));

        return derived.length > 0 ? derived : fallback;
    }

    const SESSION_MARKETS = buildSessionMarketsFromLiveMarkets();

    const LIVE_STRATEGIES = [
        { value: 'none', label: '?? Live Market Only' },
        { value: 'TestBot', label: 'TestBot' },
        { value: 'DivergeBot', label: 'DivergeBot' },
        { value: 'SazBot', label: 'SazBot' },
        { value: 'SDBot', label: 'SDBot' },
        { value: 'PairTradeBot', label: 'PairTradeBot' },
        { value: 'DevDistStatBot', label: 'DevDistStatBot' }
    ];

    const BACKTEST_BOTS = [
        { value: 'DivergeBot', label: 'DivergeBot' },
        { value: 'SazBot', label: 'SazBot' },
        { value: 'SDBot', label: 'SDBot' },
        { value: 'PairTradeBot', label: 'PairTradeBot' },
        { value: 'DevDistStatBot', label: 'DevDistStatBot' },
        { value: 'TestBot', label: 'TestBot' }
    ];

    const SESSION_MODES = [
        { value: 'backtest', label: 'Backtest' },
        { value: 'test', label: 'Test' }
    ];

    const SESSION_TYPES = [
        { value: 'test', label: 'Live Test' },
        { value: 'backtest', label: 'Backtest' },
        { value: 'scraper', label: 'Scraper' }
    ];

    const HISTORY_TYPES = [
        { value: '', label: 'All Types' },
        { value: 'test', label: 'Test' },
        { value: 'backtest', label: 'Backtest' },
        { value: 'scraper', label: 'Scraper' }
    ];

    const HISTORY_STATUSES = [
        { value: '', label: 'All Statuses' },
        { value: 'completed', label: 'Completed' },
        { value: 'stopped', label: 'Stopped' },
        { value: 'failed', label: 'Failed' }
    ];

    const DATE_FILTERS = [
        { value: 'all', label: 'All' }
    ];

    const PERIOD_OPTIONS = [
        { value: '1m', label: '1 Minute', compactLabel: '1m' },
        { value: '5m', label: '5 Minutes', compactLabel: '5m' },
        { value: '15m', label: '15 Minutes', compactLabel: '15m' },
        { value: '1h', label: '1 Hour', compactLabel: '1h' },
        { value: '4h', label: '4 Hours', compactLabel: '4h' },
        { value: '1d', label: '1 Day', compactLabel: '1D' },
        { value: '1w', label: '1 Week', compactLabel: '1w' }
    ];

    const CHART_RANGE_BUTTONS = [
        { value: '1y', label: '1y' },
        { value: '1m', label: '1m' },
        { value: '5d', label: '5d' },
        { value: '1d', label: '1d' },
        { value: '5h', label: '5h' }
    ];

    function setSelectOptions(select, options, defaultValue) {
        if (!select) return;

        const previousValue = select.value;
        select.innerHTML = '';

        options.forEach((opt) => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            select.appendChild(option);
        });

        const hasPrevious = options.some((o) => o.value === previousValue);
        if (hasPrevious) {
            select.value = previousValue;
        } else if (defaultValue !== undefined && defaultValue !== null) {
            select.value = defaultValue;
        }
    }

    function setSelectOptionsById(id, options, defaultValue) {
        document.querySelectorAll(`[id="${id}"]`).forEach((select) => {
            setSelectOptions(select, options, defaultValue);
        });
    }

    function setGroupedMarketOptionsById(id, labelType, defaultValue) {
        document.querySelectorAll(`[id="${id}"]`).forEach((select) => {
            if (!select) return;
            const previousValue = select.value;
            select.innerHTML = '';

            LIVE_MARKETS.forEach((group) => {
                const optgroup = document.createElement('optgroup');
                optgroup.label = group.group;
                group.options.forEach((market) => {
                    const option = document.createElement('option');
                    option.value = market.value;
                    option.textContent = labelType === 'secondary' ? market.secondaryLabel : market.primaryLabel;
                    optgroup.appendChild(option);
                });
                select.appendChild(optgroup);
            });

            const flat = LIVE_MARKETS.flatMap((g) => g.options);
            const hasPrevious = flat.some((m) => m.value === previousValue);
            if (hasPrevious) {
                select.value = previousValue;
            } else if (defaultValue) {
                select.value = defaultValue;
            }
        });
    }

    function renderPeriodMenu(defaultPeriod) {
        const periodMenu = document.getElementById('period-menu');
        if (!periodMenu) return;

        const selected = defaultPeriod || document.getElementById('period-label')?.textContent?.trim() || '5m';
        periodMenu.innerHTML = PERIOD_OPTIONS
            .filter((p) => p.value !== '1w')
            .map((p) => `<div class="period-option${p.value === selected ? ' active' : ''}" data-period="${p.value}">${p.compactLabel}</div>`)
            .join('');
    }

    function renderChartRangeButtons(defaultRange) {
        const bar = document.querySelector('.chart-period-bar');
        if (!bar) return;

        const selected = defaultRange || '1d';
        bar.innerHTML = CHART_RANGE_BUTTONS
            .map((btn) => `<button class="chart-period-btn${btn.value === selected ? ' active' : ''}" data-range="${btn.value}">${btn.label}</button>`)
            .join('');
    }

    function initializeStaticUiOptions() {
        setGroupedMarketOptionsById('market-selector', 'primary', 'xbtusd');
        setGroupedMarketOptionsById('market-selector-secondary', 'secondary', 'xbtusd');

        setSelectOptionsById('market-period-selector', PERIOD_OPTIONS.map((p) => ({ value: p.value, label: p.label })), '5m');
        setSelectOptionsById('candle-period-selector', PERIOD_OPTIONS.map((p) => ({ value: p.value, label: p.value })), '5m');

        setSelectOptionsById('strategy-selector', LIVE_STRATEGIES, 'none');
        setSelectOptionsById('strategy-selector-pro', [{ value: 'none', label: 'Select Strategy...' }, ...LIVE_STRATEGIES.filter((s) => s.value !== 'none')], 'none');
        setSelectOptionsById('bot-selector', BACKTEST_BOTS, 'DivergeBot');

        setSelectOptionsById('session-selector', SESSION_MODES, 'backtest');
        setSelectOptionsById('date-selector', DATE_FILTERS, 'all');

        setSelectOptionsById('new-session-type', SESSION_TYPES, 'test');
        setSelectOptionsById('new-session-market', SESSION_MARKETS, 'XBTUSD');

        setSelectOptionsById('filter-market-running', [{ value: '', label: 'All Markets' }, ...SESSION_MARKETS], '');
        setSelectOptionsById('filter-market-scrapers', [{ value: '', label: 'All Markets' }, ...SESSION_MARKETS], '');
        setSelectOptionsById('filter-market-history', [{ value: '', label: 'All Markets' }, ...SESSION_MARKETS], '');
        setSelectOptionsById('filter-type-history', HISTORY_TYPES, '');
        setSelectOptionsById('filter-status-history', HISTORY_STATUSES, '');

        renderPeriodMenu('5m');
        renderChartRangeButtons('1d');
    }

    window.HM_UI_OPTIONS = {
        LIVE_MARKETS,
        SESSION_MARKETS,
        LIVE_STRATEGIES,
        BACKTEST_BOTS,
        PERIOD_OPTIONS,
        SESSION_TYPES,
        HISTORY_TYPES,
        HISTORY_STATUSES
    };

    window.initializeStaticUiOptions = initializeStaticUiOptions;
})();
