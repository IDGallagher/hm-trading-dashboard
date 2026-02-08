        // ==========================================
        // SESSION MANAGEMENT (Phase 2)
        // ==========================================

        // Session state
        let sessionsData = {
            running: [],
            scrapers: [],
            history: []
        };
        let strategiesData = [];

        // Fetch strategies from API
        async function fetchStrategies() {
            try {
                const response = await fetch(`${CONTROL_API_URL}/strategies`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (response.ok) {
                    const data = await response.json();
                    strategiesData = data.strategies || [];
                    populateStrategyDropdowns();
                }
            } catch (error) {
                console.error('[Sessions] Failed to fetch strategies:', error);
            }
        }

        // Populate strategy dropdowns
        function populateStrategyDropdowns() {
            const dropdowns = [
                document.getElementById('new-session-strategy'),
                document.getElementById('filter-strategy-running')
            ];

            dropdowns.forEach(dropdown => {
                if (!dropdown) return;
                const isFilter = dropdown.id.includes('filter');
                dropdown.innerHTML = isFilter ? '<option value="">All Strategies</option>' : '';

                strategiesData.forEach(strategy => {
                    const option = document.createElement('option');
                    option.value = strategy.id;
                    option.textContent = strategy.name;
                    dropdown.appendChild(option);
                });
            });
        }

        // History pagination state
        let historyCurrentPage = 1;
        const HISTORY_PER_PAGE = 20;
        let historyTotalPages = 1;
        let historyTotal = 0;

        // Fetch all sessions from API
        async function fetchSessions() {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions?limit=100`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                const sessions = data.sessions || [];

                // Build a map of existing session trade_count and total_pnl
                const existingStats = {};
                ['running', 'scrapers', 'history'].forEach(category => {
                    (sessionsData[category] || []).forEach(s => {
                        if (s.trade_count !== undefined || s.total_pnl !== undefined) {
                            existingStats[s.id] = {
                                trade_count: s.trade_count,
                                total_pnl: s.total_pnl
                            };
                        }
                    });
                });

                // Merge existing stats into new sessions (preserve if API doesn't provide)
                sessions.forEach(s => {
                    const existing = existingStats[s.id];
                    if (existing) {
                        // Only use existing if API didn't provide values
                        if (s.trade_count === undefined || s.trade_count === null) {
                            s.trade_count = existing.trade_count;
                        }
                        if (s.total_pnl === undefined || s.total_pnl === null) {
                            s.total_pnl = existing.total_pnl;
                        }
                    }
                });

                // Categorize sessions
                sessionsData.running = sessions.filter(s =>
                    s.status === 'running' && (s.type === 'test' || s.type === 'backtest')
                );
                // Only show running scrapers (stopped scrapers go to history)
                sessionsData.scrapers = sessions.filter(s =>
                    s.type === 'scraper' && s.status === 'running'
                );
                // History includes stopped scrapers
                sessionsData.history = sessions.filter(s =>
                    s.status !== 'running' && s.status !== 'created'
                );

                // Also fetch health status for running sessions
                await fetchSessionHealth();

                renderAllSessions();
                updateTabCounts();

                // Fetch history with pagination
                await fetchHistoryPage(1);
            } catch (error) {
                console.error('[Sessions] Failed to fetch sessions:', error);
            }
        }

        // Fetch history sessions with pagination
        async function fetchHistoryPage(page) {
            try {
                const offset = (page - 1) * HISTORY_PER_PAGE;
                const typeFilter = document.getElementById('filter-type-history')?.value || '';
                const marketFilter = document.getElementById('filter-market-history')?.value || '';
                const statusFilter = document.getElementById('filter-status-history')?.value || '';

                let url = `${CONTROL_API_URL}/sessions?status=completed,stopped,failed&limit=${HISTORY_PER_PAGE}&offset=${offset}`;
                if (typeFilter) url += `&type=${typeFilter}`;
                if (marketFilter) url += `&market=${marketFilter}`;
                if (statusFilter) url += `&status=${statusFilter}`;

                const response = await fetch(url, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const data = await response.json();
                historyCurrentPage = page;
                historyTotal = data.total || 0;
                historyTotalPages = Math.ceil(historyTotal / HISTORY_PER_PAGE) || 1;

                // Update history list
                sessionsData.history = data.sessions || [];
                renderSessionList('history-list', sessionsData.history, 'history');
                updateHistoryPagination();

            } catch (error) {
                console.error('[Sessions] Failed to fetch history page:', error);
            }
        }

        // Update history pagination controls
        function updateHistoryPagination() {
            document.getElementById('history-page-info').textContent = `Page ${historyCurrentPage} of ${historyTotalPages}`;
            document.getElementById('history-prev-btn').disabled = historyCurrentPage <= 1;
            document.getElementById('history-next-btn').disabled = historyCurrentPage >= historyTotalPages;
            document.getElementById('history-count').textContent = historyTotal;
        }

        // Load history page (prev/next)
        function loadHistoryPage(direction) {
            const newPage = direction === 'next' ? historyCurrentPage + 1 : Math.max(1, historyCurrentPage - 1);
            if (newPage >= 1 && newPage <= historyTotalPages) {
                fetchHistoryPage(newPage);
            }
        }

        // History filter change handlers
        document.addEventListener('DOMContentLoaded', () => {
            ['filter-type-history', 'filter-market-history', 'filter-status-history'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('change', () => fetchHistoryPage(1));
                }
            });

            // Running sessions filter change handlers
            ['filter-market-running', 'filter-strategy-running'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('change', () => {
                        renderSessionList('running-sessions-list', filterRunningSessions(sessionsData.running), 'running');
                    });
                }
            });

            // Scrapers filter change handlers
            ['filter-market-scrapers'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('change', () => {
                        renderSessionList('scrapers-list', filterScraperSessions(sessionsData.scrapers), 'scrapers');
                    });
                }
            });
        });

        // Fetch session health status
        async function fetchSessionHealth() {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/health`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (response.ok) {
                    const data = await response.json();
                    const healthMap = {};
                    (data.sessions || []).forEach(s => {
                        healthMap[s.id] = {
                            health_status: s.health_status,
                            seconds_since_update: s.seconds_since_update
                        };
                    });

                    // Merge health data into running sessions
                    sessionsData.running.forEach(session => {
                        if (healthMap[session.id]) {
                            session.health_status = healthMap[session.id].health_status;
                            session.seconds_since_update = healthMap[session.id].seconds_since_update;
                        }
                    });
                    sessionsData.scrapers.forEach(session => {
                        if (healthMap[session.id]) {
                            session.health_status = healthMap[session.id].health_status;
                            session.seconds_since_update = healthMap[session.id].seconds_since_update;
                        }
                    });
                }
            } catch (error) {
                console.error('[Sessions] Failed to fetch health:', error);
            }
        }

        // Fetch detailed heartbeat for a specific scraper session
        async function fetchScraperHeartbeat(sessionId) {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/heartbeat`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.heartbeat) {
                        return data.heartbeat;
                    }
                }
            } catch (error) {
                console.error('[Sessions] Failed to fetch scraper heartbeat:', error);
            }
            return null;
        }

        // Poll heartbeats for all running scrapers
        async function pollScraperHeartbeats() {
            const runningScrapers = sessionsData.scrapers.filter(s => s.status === 'running');
            for (const scraper of runningScrapers) {
                const heartbeat = await fetchScraperHeartbeat(scraper.id);
                if (heartbeat) {
                    scraper.service_active = heartbeat.service_active;
                    scraper.service_status = heartbeat.service_status;
                    scraper.last_data_write = heartbeat.last_data_write;

                    // Calculate seconds since last data write (only if we have valid timestamp)
                    if (heartbeat.last_data_write) {
                        // last_data_write is ISO string (e.g., "2026-01-28T09:07:36.429Z")
                        const lastWriteMs = new Date(heartbeat.last_data_write).getTime();
                        const nowMs = Date.now();
                        const secondsAgo = Math.floor((nowMs - lastWriteMs) / 1000);
                        console.log('[Heartbeat DEBUG]', {
                            session_id: scraper.id,
                            last_data_write: heartbeat.last_data_write,
                            lastWriteMs,
                            nowMs,
                            secondsAgo,
                            service_active: heartbeat.service_active
                        });
                        // Use the calculated value (no limit - show actual staleness)
                        scraper.seconds_since_data = secondsAgo >= 0 ? secondsAgo : undefined;
                    } else {
                        console.log('[Heartbeat DEBUG] No last_data_write for', scraper.id);
                        // No data write timestamp - reset to undefined
                        scraper.seconds_since_data = undefined;
                    }

                    // Update health status based on service status (service_active is the reliable indicator)
                    if (!heartbeat.service_active) {
                        scraper.health_status = 'dead';
                    } else if (scraper.seconds_since_data !== undefined && scraper.seconds_since_data > 60) {
                        scraper.health_status = 'warning';
                    } else {
                        scraper.health_status = 'healthy';
                    }

                    // Update the card display
                    updateScraperCardHeartbeat(scraper);
                }
            }
        }

        // Update scraper card heartbeat display
        function updateScraperCardHeartbeat(scraper) {
            const card = document.querySelector(`.session-card[data-session-id="${scraper.id}"]`);
            if (!card) return;

            const heartbeatEl = card.querySelector('.heartbeat-indicator');
            if (heartbeatEl) {
                // service_active is the reliable health indicator
                const statusClass = scraper.service_active ? 'service-active' : 'service-inactive';

                // Determine display text
                let displayTime;
                if (!scraper.service_active) {
                    displayTime = 'stopped';
                } else if (scraper.seconds_since_data === undefined) {
                    // Service active but no data yet
                    displayTime = 'starting...';
                } else if (scraper.seconds_since_data > 300) {
                    // Data older than 5 minutes - show minutes/hours
                    const mins = Math.floor(scraper.seconds_since_data / 60);
                    displayTime = mins > 60 ? `${Math.floor(mins/60)}h ago` : `${mins}m ago`;
                } else {
                    displayTime = `${scraper.seconds_since_data}s ago`;
                }

                heartbeatEl.className = `heartbeat-indicator ${statusClass}`;
                heartbeatEl.innerHTML = `
                    <span class="heartbeat-icon">●</span>
                    <span>${displayTime}</span>
                `;
            }
        }

        // Update tab count badges
        function updateTabCounts() {
            document.getElementById('running-count').textContent = sessionsData.running.length;
            document.getElementById('scrapers-count').textContent = sessionsData.scrapers.length;
            // Use historyTotal from API for consistent count (avoids flickering)
            // historyTotal is set by fetchHistoryPage(), don't override here
        }

        // Filter running sessions by market and strategy
        function filterRunningSessions(sessions) {
            const marketFilter = document.getElementById('filter-market-running')?.value || '';
            const strategyFilter = document.getElementById('filter-strategy-running')?.value || '';

            return sessions.filter(s => {
                if (marketFilter && s.market !== marketFilter) return false;
                if (strategyFilter && s.strategy_id !== strategyFilter) return false;
                return true;
            });
        }

        // Filter scrapers by market
        function filterScraperSessions(sessions) {
            const marketFilter = document.getElementById('filter-market-scrapers')?.value || '';

            return sessions.filter(s => {
                if (marketFilter && s.market !== marketFilter) return false;
                return true;
            });
        }

        // Render all session lists
        function renderAllSessions() {
            renderSessionList('running-sessions-list', filterRunningSessions(sessionsData.running), 'running');
            renderSessionList('scrapers-list', filterScraperSessions(sessionsData.scrapers), 'scrapers');
            renderSessionList('history-list', sessionsData.history, 'history');
        }

        // Track previous session data for smart updates
        const previousSessionData = {};

        // Render a session list with smart DOM updates (prevents layout jumps)
        function renderSessionList(containerId, sessions, panelType) {
            const container = document.getElementById(containerId);
            if (!container) return;

            const emptyId = containerId.replace('-list', '-empty').replace('-sessions', '');
            const emptyEl = document.getElementById(emptyId);

            if (sessions.length === 0) {
                container.innerHTML = '';
                if (emptyEl) {
                    container.appendChild(emptyEl);
                    emptyEl.style.display = 'flex';
                }
                previousSessionData[containerId] = {};
                return;
            }

            // Hide empty state
            if (emptyEl) emptyEl.style.display = 'none';

            // Get existing cards by session ID
            const existingCards = {};
            container.querySelectorAll('.session-card[data-session-id]').forEach(card => {
                existingCards[card.dataset.sessionId] = card;
            });

            // Build set of current session IDs
            const currentSessionIds = new Set(sessions.map(s => s.id));

            // Remove cards for sessions that no longer exist
            Object.keys(existingCards).forEach(id => {
                if (!currentSessionIds.has(id)) {
                    existingCards[id].remove();
                    delete existingCards[id];
                }
            });

            // Initialize previous data tracker for this container
            if (!previousSessionData[containerId]) {
                previousSessionData[containerId] = {};
            }

            // Update or create cards
            sessions.forEach((session, index) => {
                const existingCard = existingCards[session.id];

                if (existingCard) {
                    // Smart update: only update changed elements
                    updateSessionCardInPlace(existingCard, session, panelType, previousSessionData[containerId][session.id]);
                } else {
                    // Create new card
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = renderSessionCard(session, panelType);
                    const newCard = tempDiv.firstElementChild;

                    // Insert at correct position
                    const existingAtIndex = container.children[index];
                    if (existingAtIndex) {
                        container.insertBefore(newCard, existingAtIndex);
                    } else {
                        container.appendChild(newCard);
                    }
                }

                // Store current data for next comparison
                previousSessionData[containerId][session.id] = {
                    status: session.status,
                    total_pnl: session.total_pnl,
                    seconds_since_update: session.seconds_since_update,
                    trade_count: session.trade_count
                };
            });
        }

        // Update a session card in place without replacing DOM
        function updateSessionCardInPlace(card, session, panelType, prevData) {
            const isRunning = session.status === 'running';

            // Update card classes for health status
            const cardClass = getCardHealthClass(session);
            card.className = `session-card clickable ${cardClass}`;

            // Update runtime (always changes for running sessions)
            const runtimeEl = card.querySelector('.session-runtime');
            if (runtimeEl) {
                let runtime = '--';
                if (session.started_at) {
                    const startTime = new Date(session.started_at).getTime();
                    const endTime = (session.status === 'running' || !session.stopped_at)
                        ? Date.now()
                        : new Date(session.stopped_at).getTime();
                    const durationMs = endTime - startTime;
                    runtime = durationMs >= 0 ? formatDuration(durationMs) : '00:00:00';
                }
                if (runtimeEl.textContent !== runtime) {
                    runtimeEl.textContent = runtime;
                }
            }

            // Update heartbeat (for running sessions)
            const heartbeatEl = card.querySelector('.heartbeat-indicator');
            if (heartbeatEl && isRunning) {
                const healthClass = getHealthClass(session);
                heartbeatEl.className = `heartbeat-indicator ${healthClass}`;
                const timeSpan = heartbeatEl.querySelector('span:last-child');
                if (timeSpan) {
                    const newTime = `${session.seconds_since_update || 0}s ago`;
                    if (timeSpan.textContent !== newTime) {
                        timeSpan.textContent = newTime;
                    }
                }
            }

            // Update P&L if changed
            if (!prevData || prevData.total_pnl !== session.total_pnl) {
                // Find P&L element by checking label (not just first metric)
                const allMetrics = card.querySelectorAll('.session-metric');
                for (const metric of allMetrics) {
                    const label = metric.querySelector('.metric-label');
                    if (label && label.textContent === 'P&L') {
                        const pnlEl = metric.querySelector('.metric-value');
                        if (pnlEl) {
                            const pnl = parseFloat(session.total_pnl || 0);
                            const pnlClass = pnl >= 0 ? 'positive' : 'negative';
                            const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
                            pnlEl.className = `metric-value ${pnlClass}`;
                            pnlEl.textContent = pnlFormatted;
                        }
                        break;
                    }
                }
            }

            // Update trade count for all sessions
            if (!prevData || prevData.trade_count !== session.trade_count) {
                const tradeMetrics = card.querySelectorAll('.session-metric');
                for (const metric of tradeMetrics) {
                    const label = metric.querySelector('.metric-label');
                    if (label && label.textContent === 'Trades') {
                        const valueEl = metric.querySelector('.metric-value');
                        if (valueEl) valueEl.textContent = session.trade_count || 0;
                        break;
                    }
                }
            }

            // Update status if changed
            if (!prevData || prevData.status !== session.status) {
                const statusEl = card.querySelector('.session-status');
                if (statusEl) {
                    statusEl.className = `session-status ${session.status}`;
                    const textNode = Array.from(statusEl.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
                    if (textNode) {
                        textNode.textContent = `\n                            ${session.status}\n                        `;
                    }
                }
            }
        }

        // Sub-tab switching
        function initSessionSubTabs() {
            document.querySelectorAll('.session-sub-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    // ALWAYS hide inline detail when switching tabs (fixes contamination bug)
                    document.getElementById('inline-session-detail').style.display = 'none';
                    currentInlineSessionId = null;
                    currentSessionTradeData = null; // Clear stored trade data

                    // Clear chart markers when leaving detail view
                    if (liveMarketCandleSeries) {
                        safeSetMarkers(liveMarketCandleSeries, [], 'clearOnTabSwitch');
                    }

                    // Update active tab
                    document.querySelectorAll('.session-sub-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');

                    // Update active panel - explicitly set display to prevent state pollution
                    const panelId = tab.dataset.panel;
                    document.querySelectorAll('.session-panel').forEach(p => {
                        p.classList.remove('active');
                        p.style.display = 'none';
                    });
                    const targetPanel = document.getElementById(`panel-${panelId}`);
                    targetPanel.classList.add('active');
                    targetPanel.style.display = 'flex';

                    // Reset previousPanelId to current panel
                    previousPanelId = `panel-${panelId}`;
                });
            });
        }

        // Modal functions
        function openNewSessionModal(type = 'test') {
            document.getElementById('new-session-modal').classList.add('active');
            document.getElementById('new-session-type').value = type;
            updateNewSessionForm();

            // Clear exact timestamps (will be set by launchBacktestFromSession if needed)
            const startInput = document.getElementById('new-session-start');
            const endInput = document.getElementById('new-session-end');
            delete startInput.dataset.exactTimestamp;
            delete endInput.dataset.exactTimestamp;

            // Add listeners to clear exact timestamps when user manually edits dates
            // (so manual changes take precedence over pre-filled exact values)
            startInput.oninput = () => { delete startInput.dataset.exactTimestamp; };
            endInput.oninput = () => { delete endInput.dataset.exactTimestamp; };
        }

        function closeNewSessionModal() {
            document.getElementById('new-session-modal').classList.remove('active');
            // Reset form
            document.getElementById('new-session-name').value = '';
        }

        // Update form based on session type
        function updateNewSessionForm() {
            const type = document.getElementById('new-session-type').value;
            const backtestFields = document.getElementById('backtest-range-fields');
            const feeFields = document.getElementById('fee-config-fields');
            const strategySelect = document.getElementById('new-session-strategy');

            // Show/hide backtest date range
            backtestFields.style.display = type === 'backtest' ? 'grid' : 'none';

            // Show/hide fee config (hide for scrapers)
            feeFields.style.display = type === 'scraper' ? 'none' : 'grid';

            // Filter strategies by type
            strategySelect.innerHTML = '';
            strategiesData.filter(s => {
                const types = s.supported_types || [];
                return types.includes(type);
            }).forEach(strategy => {
                const option = document.createElement('option');
                option.value = strategy.id;
                option.textContent = strategy.name;
                strategySelect.appendChild(option);
            });

            updateStrategyParams();
        }

        // Update strategy params form
        function updateStrategyParams() {
            const strategyId = document.getElementById('new-session-strategy').value;
            const strategy = strategiesData.find(s => s.id === strategyId);
            const container = document.getElementById('strategy-params-container');
            const fieldsContainer = document.getElementById('strategy-params-fields');

            if (!strategy || !strategy.default_params || Object.keys(strategy.default_params).length === 0) {
                container.style.display = 'none';
                return;
            }

            container.style.display = 'block';
            fieldsContainer.innerHTML = '';

            const params = strategy.default_params;
            const schema = strategy.param_schema?.properties || {};

            Object.keys(params).forEach(key => {
                const value = params[key];
                const paramSchema = schema[key] || {};
                const inputType = typeof value === 'number' ? 'number' : 'text';
                
                // Format the label nicely (trade_size -> Trade Size)
                const label = paramSchema.description || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                
                // Get min/max/step from schema
                const min = paramSchema.minimum !== undefined ? `min="${paramSchema.minimum}"` : '';
                const max = paramSchema.maximum !== undefined ? `max="${paramSchema.maximum}"` : '';
                const step = inputType === 'number' ? 'step="any"' : '';
                
                fieldsContainer.innerHTML += `
                    <div class="form-group">
                        <label class="form-label">${label}</label>
                        <input type="${inputType}" class="form-input strategy-param"
                               data-param="${key}" value="${value}" ${min} ${max} ${step}
                               title="${paramSchema.description || ''}">
                    </div>
                `;
            });
        }

        // Create a new session
        async function createSession() {
            const type = document.getElementById('new-session-type').value;
            const market = document.getElementById('new-session-market').value;
            const strategy = document.getElementById('new-session-strategy').value;
            const name = document.getElementById('new-session-name').value;

            // Collect strategy params
            const strategyParams = {};
            document.querySelectorAll('.strategy-param').forEach(input => {
                const param = input.dataset.param;
                let value = input.value;
                // Convert to number if needed
                if (input.type === 'number') {
                    value = parseFloat(value);
                }
                strategyParams[param] = value;
            });

            // Build request body
            const body = {
                type,
                market,
                strategy,
                strategy_params: strategyParams
            };
            if (name) body.name = name;

            // Add fee configuration for test/backtest (not scrapers)
            if (type !== 'scraper') {
                const makerFee = parseFloat(document.getElementById('new-session-maker-fee').value);
                const takerFee = parseFloat(document.getElementById('new-session-taker-fee').value);
                if (!isNaN(makerFee)) body.maker_fee = makerFee;
                if (!isNaN(takerFee)) body.taker_fee = takerFee;
            }

            // Add date range for backtest
            if (type === 'backtest') {
                const startInput = document.getElementById('new-session-start');
                const endInput = document.getElementById('new-session-end');
                // Use exact timestamps from data attributes if available (preserves milliseconds)
                // Otherwise fall back to parsing the datetime-local value
                if (startInput.dataset.exactTimestamp) {
                    // parseFloat preserves millisecond precision (e.g., 1769815183.456)
                    body.range_start = parseFloat(startInput.dataset.exactTimestamp);
                } else if (startInput.value) {
                    // Preserve milliseconds - datetime-local has second precision at minimum
                    body.range_start = new Date(startInput.value).getTime() / 1000;
                }
                if (endInput.dataset.exactTimestamp) {
                    // parseFloat preserves millisecond precision (e.g., 1769815213.456)
                    body.range_end = parseFloat(endInput.dataset.exactTimestamp);
                } else if (endInput.value) {
                    // Preserve milliseconds - datetime-local has second precision at minimum
                    body.range_end = new Date(endInput.value).getTime() / 1000;
                }
            }

            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': CONTROL_API_KEY
                    },
                    body: JSON.stringify(body)
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to create session');
                }

                const data = await response.json();
                closeNewSessionModal();

                // Start the session immediately
                await startSession(data.session.id);

                // Refresh sessions list
                await fetchSessions();

            } catch (error) {
                console.error('[Sessions] Failed to create session:', error);
                showErrorToast('Session Error', error.message);
            }
        }

        // Start a session
        async function startSession(sessionId) {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/start`, {
                    method: 'POST',
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to start session');
                }
                await fetchSessions();
            } catch (error) {
                console.error('[Sessions] Failed to start session:', error);
                showErrorToast('Session Error', error.message);
            }
        }

        // Stop a session
        async function stopSession(sessionId) {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/stop`, {
                    method: 'POST',
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to stop session');
                }
                await fetchSessions();
            } catch (error) {
                console.error('[Sessions] Failed to stop session:', error);
                showErrorToast('Session Error', error.message);
            }
        }

        // Restart a session
        async function restartSession(sessionId) {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/restart`, {
                    method: 'POST',
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to restart session');
                }
                const result = await response.json();
                console.log('[Sessions] Session restarted:', result);
                await fetchSessions();
            } catch (error) {
                console.error('[Sessions] Failed to restart session:', error);
                showErrorToast('Session Error', error.message);
            }
        }

        // Launch backtest from a finished test session
        async function launchBacktestFromSession(session) {
            try {
                // For TEST sessions, fetch exact trading timestamps from logs
                // This ensures BACKTEST has EXACT same trading window as TEST
                let firstTradeTs = null;
                let lastTradeTs = null;
                let tradingStartTime = null;
                if (session.type === 'test') {
                    try {
                        const response = await fetch(`${CONTROL_API_URL}/sessions/${session.id}/trading-start`, {
                            headers: { 'x-api-key': CONTROL_API_KEY }
                        });
                        if (response.ok) {
                            const data = await response.json();
                            if (data.success) {
                                tradingStartTime = data.trading_start_time;
                                firstTradeTs = data.first_trade_ts;
                                lastTradeTs = data.last_trade_ts;
                                console.log('[Sessions] Got exact trading parity data:', {
                                    trading_start_time: tradingStartTime,
                                    first_trade_ts: firstTradeTs,
                                    last_trade_ts: lastTradeTs,
                                    trade_count: data.trade_count
                                });
                            }
                        }
                    } catch (e) {
                        console.warn('[Sessions] Could not fetch trading timestamps, using started_at:', e.message);
                    }
                }

                // Fallback to session timestamps
                const startTime = session.started_at ? new Date(session.started_at) : null;
                const endTime = session.stopped_at ? new Date(session.stopped_at) : null;
                const params = session.strategy_params ?
                    (typeof session.strategy_params === 'string' ? JSON.parse(session.strategy_params) : session.strategy_params)
                    : {};

                // Open the new session modal with pre-filled values
                openNewSessionModal();

                // Wait for modal to be ready
                await new Promise(resolve => setTimeout(resolve, 100));

                // Pre-fill the form
                document.getElementById('new-session-type').value = 'backtest';
                document.getElementById('new-session-type').dispatchEvent(new Event('change'));
                document.getElementById('new-session-market').value = session.market;
                document.getElementById('new-session-strategy').value = session.strategy;
                document.getElementById('new-session-strategy').dispatchEvent(new Event('change'));
                document.getElementById('new-session-name').value = `Backtest: ${session.name || session.strategy}`;

                // Set date range - use actual trade timestamps for TEST->BACKTEST parity
                const startInput = document.getElementById('new-session-start');
                const endInput = document.getElementById('new-session-end');
                if (firstTradeTs && lastTradeTs) {
                    // Use exact trade timestamps from TEST logs
                    // range_start = trading_start_time (for proper warmup)
                    // range_end = last_trade_ts + 1 (to include the last trade)
                    const rangeStart = tradingStartTime;
                    const rangeEnd = lastTradeTs + 1;  // +1 to ensure last trade is included

                    const startDate = new Date(rangeStart * 1000);
                    const endDate = new Date(rangeEnd * 1000);

                    startInput.value = startDate.toISOString().slice(0, 16);
                    startInput.dataset.exactTimestamp = rangeStart.toFixed(3);

                    endInput.value = endDate.toISOString().slice(0, 16);
                    endInput.dataset.exactTimestamp = rangeEnd.toFixed(3);

                    console.log('[Sessions] Using exact trade timestamps for BACKTEST parity:', {
                        range_start: rangeStart,
                        range_end: rangeEnd,
                        first_trade_ts: firstTradeTs,
                        last_trade_ts: lastTradeTs
                    });
                } else if (tradingStartTime) {
                    // Fallback: use trading_start_time with stopped_at
                    const startDate = new Date(tradingStartTime * 1000);
                    startInput.value = startDate.toISOString().slice(0, 16);
                    startInput.dataset.exactTimestamp = tradingStartTime.toFixed(3);
                    if (endTime) {
                        endInput.value = endTime.toISOString().slice(0, 16);
                        endInput.dataset.exactTimestamp = (endTime.getTime() / 1000).toFixed(3);
                    }
                } else {
                    // Fallback to session timestamps
                    if (startTime) {
                        startInput.value = startTime.toISOString().slice(0, 16);
                        startInput.dataset.exactTimestamp = (startTime.getTime() / 1000).toFixed(3);
                    }
                    if (endTime) {
                        endInput.value = endTime.toISOString().slice(0, 16);
                        endInput.dataset.exactTimestamp = (endTime.getTime() / 1000).toFixed(3);
                    }
                }

                // Wait for strategy params to load, then fill them
                await new Promise(resolve => setTimeout(resolve, 200));
                document.querySelectorAll('.strategy-param').forEach(input => {
                    const param = input.dataset.param;
                    if (params[param] !== undefined) {
                        input.value = params[param];
                    }
                });

                showSessionNotification(`Backtest form pre-filled with "${session.name || session.strategy}" parameters`);
            } catch (error) {
                console.error('[Sessions] Failed to prepare backtest:', error);
                showErrorToast('Session Error', error.message);
            }
        }

        // Clone a session
        async function cloneSession(sessionId) {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/clone`, {
                    method: 'POST',
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to clone session');
                }
                await fetchSessions();
            } catch (error) {
                console.error('[Sessions] Failed to clone session:', error);
                showErrorToast('Session Error', error.message);
            }
        }

        // Delete a session
        async function deleteSession(sessionId) {
            if (!confirm('Are you sure you want to delete this session?')) return;

            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': CONTROL_API_KEY
                    },
                    body: JSON.stringify({ confirm: true })
                });
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to delete session');
                }
                await fetchSessions();
            } catch (error) {
                console.error('[Sessions] Failed to delete session:', error);
                showErrorToast('Session Error', error.message);
            }
        }

        // Currently viewed session
        let currentViewedSessionId = null;
        let currentInlineSessionId = null;
        let previousPanelId = null;
        let currentSessionTradeData = null; // Store trade data for re-rendering on period change
        let lastLogTimestamp = null; // Track last log timestamp for incremental updates

        // Show inline session detail view
        async function showInlineDetail(sessionId, panelType) {
          try {
            console.log('[Sessions] Show inline detail for:', sessionId);
            currentInlineSessionId = sessionId;
            lastLogTimestamp = null;  // Reset for fresh log load

            // Find the session data
            let session = sessionsData.running.find(s => s.id === sessionId) ||
                          sessionsData.scrapers.find(s => s.id === sessionId) ||
                          sessionsData.history.find(s => s.id === sessionId);

            if (!session) {
                console.error('[Sessions] Session not found:', sessionId);
                logJsError('DetailView', `Session not found: ${sessionId}`, 'showInlineDetail', '', '');
                return;
            }

            // Hide current panel and show inline detail
            previousPanelId = `panel-${panelType === 'running' ? 'running' : panelType === 'scrapers' ? 'scrapers' : 'history'}`;
            document.getElementById(previousPanelId).style.display = 'none';
            document.getElementById('inline-session-detail').style.display = 'flex';

            // Populate header info
            document.getElementById('inline-session-name').textContent = session.name || `${session.strategy} - ${session.market}`;
            const statusEl = document.getElementById('inline-session-status');
            statusEl.textContent = session.status;
            statusEl.className = `inline-session-status ${session.status}`;
            document.getElementById('inline-session-market').textContent = session.market;
            document.getElementById('inline-session-strategy').textContent = session.strategy;

            // Show strategy params
            const paramsEl = document.getElementById('inline-session-params');
            try {
                const params = session.strategy_params ? 
                    (typeof session.strategy_params === 'string' ? JSON.parse(session.strategy_params) : session.strategy_params) : {};
                const paramItems = [];
                if (params.trade_size !== undefined) paramItems.push(`Size: ${params.trade_size}`);
                if (params.trade_interval !== undefined) paramItems.push(`Interval: ${params.trade_interval}s`);
                if (params.leverage !== undefined && params.leverage !== 1) paramItems.push(`Lev: ${params.leverage}x`);
                // Add any other params
                Object.keys(params).filter(k => !['trade_size', 'trade_interval', 'leverage'].includes(k)).forEach(k => {
                    paramItems.push(`${k}: ${params[k]}`);
                });
                if (paramItems.length > 0) {
                    paramsEl.textContent = paramItems.join(' • ');
                    paramsEl.style.display = 'inline-block';
                } else {
                    paramsEl.style.display = 'none';
                }
            } catch (e) { paramsEl.style.display = 'none'; }

            // Calculate runtime
            let runtime = '--';
            if (session.started_at) {
                const startTime = new Date(session.started_at).getTime();
                const endTime = session.status === 'running' ? Date.now() : (session.stopped_at ? new Date(session.stopped_at).getTime() : Date.now());
                runtime = formatDuration(endTime - startTime);
            }
            document.getElementById('inline-session-runtime').textContent = runtime;

            // Setup action buttons
            document.getElementById('inline-restart-btn').onclick = () => { restartSession(sessionId); };
            document.getElementById('inline-stop-btn').onclick = () => { stopSession(sessionId); };
            document.getElementById('inline-stop-btn').style.display = session.status === 'running' ? 'inline-block' : 'none';

            // Show Launch Backtest button for finished test sessions
            const backtestBtn = document.getElementById('inline-backtest-btn');
            const isFinishedTest = session.status !== 'running' && session.type === 'test';
            backtestBtn.style.display = isFinishedTest ? 'inline-block' : 'none';
            if (isFinishedTest) {
                backtestBtn.onclick = () => { launchBacktestFromSession(session); };
            }

            // Load metrics
            await loadInlineMetrics(sessionId);

            // Load ALL sections at once (no tabs anymore)
            await Promise.all([
                loadInlineTrades(sessionId),
                loadInlineLogs(sessionId),
                loadInlineEquity(sessionId)
            ]);

            // Switch chart to session's market if different
            const currentMarketVal = document.getElementById('market-selector').value.toLowerCase();
            const sessionMarket = session.market.toLowerCase();
            console.log('[Market] showInlineDetail switching market?', { current: currentMarketVal, session: sessionMarket, willSwitch: currentMarketVal !== sessionMarket });
            if (currentMarketVal !== sessionMarket) {
                console.log('[Market] RESETTING market selector to:', sessionMarket);
                document.getElementById('market-selector').value = sessionMarket;
                document.getElementById('market-selector').dispatchEvent(new Event('change'));
            }

            // Load trades onto chart (directly, don't open modal)
            try {
                // Use new helper (tries DB first, falls back to file) - limit to 200 for chart performance
                const result = await fetchSessionTrades(sessionId, { limit: 200 });
                if (result.success) {
                    displaySessionTrades({ trades: result.trades, count: result.count });
                }
            } catch (err) {
                console.error('[Sessions] Failed to load trades for chart:', err);
            }

            // Load DevDistStatBot indicators if this is a DevDistStatBot strategy session
            if (session.strategy === 'DevDistStatBot') {
                console.log('[DevDistStatBot] Loading indicators for session:', sessionId);
                await loadDevDistStatIndicators(sessionId);
                // Update chart with DevDistStatBot indicators
                updateChartIndicators('DevDistStatBot');
            }
          } catch (err) {
            // Catch ALL errors in showInlineDetail and log them visibly
            const stack = err.stack || '';
            logJsError('DetailViewError', `showInlineDetail failed: ${err.message}`, stack.split('\n')[1] || '', '', '', stack);
            console.error('[Sessions] showInlineDetail error:', err);
          }
        }

        // Hide inline detail and return to list
        function hideInlineDetail() {
            document.getElementById('inline-session-detail').style.display = 'none';
            if (previousPanelId) {
                document.getElementById(previousPanelId).style.display = 'flex';
            }
            currentInlineSessionId = null;
            currentSessionTradeData = null; // Clear stored trade data

            // Clear chart markers
            if (liveMarketCandleSeries) {
                safeSetMarkers(liveMarketCandleSeries, [], 'hideInlineDetail');
            }

            // Clear DevDistStat indicator data and chart indicators
            devDistStatIndicatorData = { mean: [], upper: [], lower: [], zscore: [] };
            clearIndicators();
        }

        // Load metrics for inline detail
        async function loadInlineMetrics(sessionId) {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/metrics`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (response.ok) {
                    const data = await response.json();
                    const m = data.metrics;
                    document.getElementById('inline-trades').textContent = m.total_trades || 0;
                    const pnl = m.total_pnl || 0;
                    const pnlEl = document.getElementById('inline-pnl');
                    pnlEl.textContent = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
                    pnlEl.className = `inline-metric-value ${pnl >= 0 ? 'positive' : 'negative'}`;
                    document.getElementById('inline-winrate').textContent = `${(m.win_rate || 0).toFixed(1)}%`;
                    document.getElementById('inline-maxdd').textContent = `$${(m.max_drawdown || 0).toFixed(0)}`;
                }
            } catch (err) {
                console.error('[Sessions] Failed to load metrics:', err);
            }
        }

        // Load trades for inline detail
        async function loadInlineTrades(sessionId) {
            const container = document.getElementById('inline-trades-list');
            try {
                // Use new helper (tries DB first, falls back to file)
                const result = await fetchSessionTrades(sessionId, { limit: 100 });
                if (result.success) {
                    const trades = result.trades || [];
                    if (trades.length === 0) {
                        container.innerHTML = '<div class="inline-empty">No trades yet</div>';
                    } else {
                        // Note: t.timestamp is Unix seconds, multiply by 1000 for JavaScript Date
                        // Parse price/pnl as numbers (DB returns strings)
                        container.innerHTML = trades.slice(-50).reverse().map(t => {
                            const pnl = parseFloat(t.pnl) || 0;
                            const price = parseFloat(t.price) || 0;
                            return `
                            <div class="inline-trade-row">
                                <span>${new Date(t.timestamp * 1000).toLocaleTimeString()}</span>
                                <span style="color: ${t.side === 'BUY' ? '#3fb950' : '#f85149'}">${t.action}</span>
                                <span>$${price.toFixed(2)}</span>
                                <span>${formatTradeSize(t.size)}</span>
                                <span class="${pnl >= 0 ? 'positive' : 'negative'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
                            </div>
                        `}).join('');
                    }
                } else {
                    container.innerHTML = '<div class="inline-empty">Failed to load trades</div>';
                }
            } catch (err) {
                console.error('[Sessions] Failed to load trades:', err);
                container.innerHTML = '<div class="inline-empty">Failed to load trades</div>';
            }
        }

        // Load logs for inline detail
        // Filter out verbose/noisy log messages (order book, debug spam)
        function filterVerboseLogs(logs) {
            const verbosePatterns = [
                /orderBook/i,
                /book.*update/i,
                /book.*insert/i,
                /book.*delete/i,
                /Received orderBookL2/i,
                /DBClient/i,
                /WebSocket.*ping/i,
                /WebSocket.*pong/i,
                /heartbeat/i
            ];

            return logs.filter(log => {
                const msg = log.message || '';
                // Always keep errors and warnings
                if (log.level === 'ERROR' || log.level === 'WARN') return true;
                // Filter out ALL debug messages
                if (log.level === 'DEBUG') return false;
                // Filter out verbose patterns
                return !verbosePatterns.some(pattern => pattern.test(msg));
            });
        }

        async function loadInlineLogs(sessionId) {
            const container = document.getElementById('inline-logs-list');
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/logs?limit=200`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (response.ok) {
                    const data = await response.json();
                    let logs = data.logs || [];

                    // Store last timestamp from raw logs (before filtering)
                    if (logs.length > 0) {
                        lastLogTimestamp = logs[logs.length - 1].timestamp;
                    }

                    // Filter out verbose order book and debug messages
                    logs = filterVerboseLogs(logs);

                    if (logs.length === 0) {
                        container.innerHTML = '<div class="inline-empty">No INFO/WARN/ERROR logs (DEBUG filtered)</div>';
                    } else {
                        // Show most recent logs at bottom (chronological order)
                        container.innerHTML = logs.slice(-100).map(l => `
                            <div class="inline-log-row ${l.level?.toLowerCase()}">
                                <span style="color: #6e7681">${new Date(l.timestamp).toLocaleTimeString()}</span>
                                <span style="color: ${l.level === 'ERROR' ? '#f85149' : l.level === 'WARN' ? '#d29922' : '#8b949e'}">[${l.level}]</span>
                                ${l.message}
                            </div>
                        `).join('');
                        // Auto-scroll to bottom (latest logs)
                        container.scrollTop = container.scrollHeight;
                    }
                } else {
                    container.innerHTML = '<div class="inline-empty">Failed to load logs</div>';
                }
            } catch (err) {
                console.error('[Sessions] Failed to load logs:', err);
                logJsError('LogsError', `loadInlineLogs: ${err.message}`, '', '', '', err.stack);
                container.innerHTML = '<div class="inline-empty">Failed to load logs: ' + err.message + '</div>';
            }
        }

        // Poll for new logs incrementally (only fetch logs newer than lastLogTimestamp)
        async function pollInlineLogs(sessionId) {
            if (!lastLogTimestamp) {
                // No previous timestamp, do full load
                return loadInlineLogs(sessionId);
            }

            try {
                // Fetch recent logs
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/logs?limit=50`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });
                if (response.ok) {
                    const data = await response.json();
                    let logs = data.logs || [];

                    // Filter to only logs newer than lastLogTimestamp (client-side)
                    const lastTs = new Date(lastLogTimestamp).getTime();
                    const newLogs = logs.filter(l => new Date(l.timestamp).getTime() > lastTs);

                    // Update last timestamp from raw logs (before filtering)
                    if (logs.length > 0) {
                        lastLogTimestamp = logs[logs.length - 1].timestamp;
                    }

                    // Append only the new logs (if any)
                    if (newLogs.length > 0) {
                        appendInlineLogs(newLogs);
                    }
                }
            } catch (err) {
                console.error('[Sessions] Failed to poll logs:', err);
                // Only log first poll error to avoid spam
                if (!window._pollLogErrorShown) {
                    logJsError('PollError', `pollInlineLogs: ${err.message}`, '', '', '', err.stack);
                    window._pollLogErrorShown = true;
                }
            }
        }

        // Append new log entries and auto-scroll
        function appendInlineLogs(newLogs) {
            const container = document.getElementById('inline-logs-list');
            if (!container || !newLogs || newLogs.length === 0) return;

            // Filter verbose logs
            const filteredLogs = filterVerboseLogs(newLogs);
            if (filteredLogs.length === 0) return;

            // Check if user has scrolled up (not at bottom)
            const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

            // Remove "No logs" message if present
            const emptyMsg = container.querySelector('.inline-empty');
            if (emptyMsg) emptyMsg.remove();

            // Append new logs
            const html = filteredLogs.map(l => `
                <div class="inline-log-row ${l.level?.toLowerCase()} new-log">
                    <span style="color: #6e7681">${new Date(l.timestamp).toLocaleTimeString()}</span>
                    <span style="color: ${l.level === 'ERROR' ? '#f85149' : l.level === 'WARN' ? '#d29922' : '#8b949e'}">[${l.level}]</span>
                    ${l.message}
                </div>
            `).join('');
            container.insertAdjacentHTML('beforeend', html);

            // Auto-scroll if user was at bottom
            if (wasAtBottom) {
                container.scrollTop = container.scrollHeight;
            }

            // Remove highlight after animation
            setTimeout(() => {
                container.querySelectorAll('.new-log').forEach(el => el.classList.remove('new-log'));
            }, 1000);
        }

        // Load equity curve for inline detail
        let inlineEquityChart = null;
        async function loadInlineEquity(sessionId) {
            try {
                // Use new helper (tries DB first, falls back to file)
                const result = await fetchSessionEquity(sessionId);
                if (result.success) {
                    const equity = result.equity || [];
                    if (equity.length > 0) {
                        // Create mini equity chart
                        const container = document.getElementById('inline-equity-chart');
                        container.innerHTML = '';

                        // Get width - use offsetWidth or fallback to parent width
                        const chartWidth = container.offsetWidth || container.clientWidth || container.parentElement?.offsetWidth || 400;
                        const chartHeight = 180;

                        // Destroy previous chart if exists
                        if (inlineEquityChart) {
                            inlineEquityChart.remove();
                            inlineEquityChart = null;
                        }

                        inlineEquityChart = LightweightCharts.createChart(container, {
                            width: chartWidth,
                            height: chartHeight,
                            layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
                            grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
                            rightPriceScale: { borderColor: '#21262d' },
                            timeScale: { borderColor: '#21262d' }
                        });

                        const series = inlineEquityChart.addLineSeries({
                            color: '#58a6ff',
                            lineWidth: 2,
                            priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
                        });

                        // Map equity data - handle both timestamp formats
                        const chartData = equity.map(e => {
                            // Handle timestamp: could be in ms or seconds
                            let time = e.timestamp;
                            if (time > 1e12) time = Math.floor(time / 1000); // Convert ms to seconds
                            return { time: time, value: parseFloat(e.equity) || 0 };
                        }).filter(d => d.time > 0 && !isNaN(d.value));

                        if (chartData.length > 0) {
                            safeSetData(series, chartData, 'inlineEquityChart');
                            inlineEquityChart.timeScale().fitContent();
                            // Apply adaptive time formatting for zoom
                            setupAdaptiveTimeFormat(inlineEquityChart);
                            console.log(`[InlineEquity] Loaded ${chartData.length} points, width: ${chartWidth}`);
                        } else {
                            container.innerHTML = '<div class="inline-empty">No valid equity data</div>';
                        }

                        // Handle resize
                        const resizeHandler = () => {
                            if (inlineEquityChart && container.offsetWidth > 0) {
                                inlineEquityChart.applyOptions({ width: container.offsetWidth });
                            }
                        };
                        window.addEventListener('resize', resizeHandler);
                    } else {
                        document.getElementById('inline-equity-chart').innerHTML = '<div class="inline-empty">No equity data</div>';
                    }
                }
            } catch (err) {
                console.error('[InlineEquity] Error:', err);
                document.getElementById('inline-equity-chart').innerHTML = '<div class="inline-empty">Failed to load equity</div>';
            }
        }

        // Switch inline detail tabs
        function switchInlineTab(tabName) {
            // Update tab buttons
            document.querySelectorAll('.inline-tab').forEach(t => t.classList.remove('active'));
            document.querySelector(`.inline-tab[data-tab="${tabName}"]`).classList.add('active');

            // Hide all tabs
            document.querySelectorAll('.inline-tab-content').forEach(c => c.style.display = 'none');

            // Show selected tab
            document.getElementById(`inline-tab-${tabName}`).style.display = 'block';

            // Load data for tab
            if (currentInlineSessionId) {
                if (tabName === 'trades') loadInlineTrades(currentInlineSessionId);
                else if (tabName === 'logs') loadInlineLogs(currentInlineSessionId);
                else if (tabName === 'equity') loadInlineEquity(currentInlineSessionId);
            }
        }

        // View session - load trades and display on chart
        async function viewSession(sessionId) {
            console.log('[Sessions] View session:', sessionId);
            currentViewedSessionId = sessionId;

            try {
                // Use new helper (tries DB first, falls back to file) - limit to 200 for chart performance
                const result = await fetchSessionTrades(sessionId, { limit: 200 });

                if (!result.success) {
                    throw new Error('Failed to load session trades');
                }

                const data = { trades: result.trades, count: result.count, total: result.total, session_name: sessionId };
                console.log(`[Sessions] Loaded ${data.count} trades of ${result.total || 'unknown'} total (source: ${result.source})`);

                // Display trades on chart
                displaySessionTrades(data);

                // Show notification
                if (data.count > 0) {
                    showSessionNotification(`Showing ${data.count} trades from "${data.session_name}" on chart`);
                } else {
                    showSessionNotification(`No trades yet for "${data.session_name}"`);
                }

            } catch (error) {
                console.error('[Sessions] Failed to load trades:', error);
                showErrorToast('Session Error', error.message);
            }
        }

        // Display session trades as markers on the chart
        // OPTIMIZED: Sort candles once, use binary search, limit markers
        function displaySessionTrades(tradeData) {
            // Store trade data for re-rendering when period changes
            currentSessionTradeData = tradeData;

            if (!liveMarketCandleSeries || !lastCandleData || lastCandleData.length === 0) {
                console.log('[Sessions] Cannot display trades - chart not ready');
                return;
            }

            const trades = tradeData.trades || [];
            if (trades.length === 0) {
                safeSetMarkers(liveMarketCandleSeries, [], 'displaySessionTrades_empty');
                return;
            }

            // OPTIMIZATION 1: Sort candles ONCE (not per trade)
            const sortedCandles = [...lastCandleData].sort((a, b) => a.time - b.time);
            const candleTimes = sortedCandles.map(c => c.time);

            // OPTIMIZATION 2: Binary search for candle lookup
            const findContainingCandle = (timestampSec) => {
                // Binary search to find largest candle.time <= timestampSec
                let left = 0, right = candleTimes.length - 1;
                let result = 0;
                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    if (candleTimes[mid] <= timestampSec) {
                        result = mid;
                        left = mid + 1;
                    } else {
                        right = mid - 1;
                    }
                }
                return sortedCandles[result];
            };

            // OPTIMIZATION 3: Limit to most recent 200 trades for performance
            const MAX_MARKERS = 200;
            const tradesToShow = trades.length > MAX_MARKERS
                ? trades.slice(-MAX_MARKERS)
                : trades;

            const markers = [];

            tradesToShow.forEach(trade => {
                const candle = findContainingCandle(trade.timestamp);
                const isEntry = trade.action === 'OPEN';
                const isLong = trade.side === 'BUY';

                if (isEntry) {
                    // Entry marker - arrow
                    markers.push({
                        time: candle.time,
                        position: isLong ? 'belowBar' : 'aboveBar',
                        color: isLong ? '#2196F3' : '#FF9800', // Blue for long, orange for short
                        shape: isLong ? 'arrowUp' : 'arrowDown',
                        text: `${trade.side} @ ${(trade.price && typeof trade.price === 'number') ? trade.price.toFixed(1) : 'N/A'}`
                    });
                } else {
                    // Exit marker - circle
                    const pnl = parseFloat(trade.pnl) || 0;
                    markers.push({
                        time: candle.time,
                        position: !isLong ? 'belowBar' : 'aboveBar', // Opposite of entry
                        color: pnl >= 0 ? '#00c853' : '#ff5252', // Green for profit, red for loss
                        shape: 'circle',
                        text: pnl !== 0 ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}` : ''
                    });
                }
            });

            // Sort markers by time (required by Lightweight Charts)
            markers.sort((a, b) => a.time - b.time);
            safeSetMarkers(liveMarketCandleSeries, markers, 'displaySessionTrades');

            const limitNote = trades.length > MAX_MARKERS ? ` (limited from ${trades.length})` : '';
            console.log(`[Sessions] Displayed ${markers.length} trade markers on chart${limitNote}`);
        }

        // Clear session trade markers
        function clearSessionTrades() {
            currentViewedSessionId = null;
            if (liveMarketCandleSeries) {
                safeSetMarkers(liveMarketCandleSeries, [], 'clearSessionTrades');
            }
        }

        // Show session notification toast
        function showSessionNotification(message) {
            // Reuse error toast with different styling
            const toast = document.getElementById('error-toast');
            const titleEl = document.getElementById('error-toast-title');
            const messageEl = document.getElementById('error-toast-message');

            titleEl.textContent = '📊 Session Trades';
            messageEl.textContent = message;
            toast.style.borderColor = '#58a6ff';
            toast.classList.add('show');

            setTimeout(() => {
                toast.classList.remove('show');
                toast.style.borderColor = '';
            }, 3000);
        }

// Check URL params and open session detail if specified
        async function handleUrlParams() {
            const params = new URLSearchParams(window.location.search);
            const sessionId = params.get('session');
            if (sessionId) {
                console.log(`[URL] Session param detected: ${sessionId}`);

                // Wait for sessions data to be populated
                let attempts = 0;
                while (attempts < 20 && (!sessionsData.running.length && !sessionsData.history.length)) {
                    await new Promise(resolve => setTimeout(resolve, 250));
                    attempts++;
                }
                console.log(`[URL] Sessions loaded after ${attempts} attempts. Running: ${sessionsData.running.length}, History: ${sessionsData.history.length}`);

                // Find which panel the session is in
                let panelType = 'running';
                let foundSession = sessionsData.running.find(s => s.id === sessionId);
                if (foundSession) {
                    panelType = 'running';
                } else if (sessionsData.scrapers.find(s => s.id === sessionId)) {
                    panelType = 'scrapers';
                    foundSession = sessionsData.scrapers.find(s => s.id === sessionId);
                } else if (sessionsData.history.find(s => s.id === sessionId)) {
                    panelType = 'history';
                    foundSession = sessionsData.history.find(s => s.id === sessionId);
                }

                if (!foundSession) {
                    console.error(`[URL] Session not found: ${sessionId}`);
                    return;
                }
                console.log(`[URL] Found session in ${panelType} panel:`, foundSession.name);

                // Switch to the correct sub-tab (uses data-panel attribute)
                const subTabBtn = document.querySelector(`.session-sub-tab[data-panel="${panelType}"]`);
                if (subTabBtn) {
                    console.log(`[URL] Clicking sub-tab for: ${panelType}`);
                    subTabBtn.click();
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                // Open the session detail
                console.log(`[URL] Opening detail view for ${sessionId} (${panelType})`);
                showInlineDetail(sessionId, panelType);
            }
        }

        // Initialize sessions
        function startSessionPolling() {
            fetchStrategies();
            fetchSessions().then(() => {
                // Check URL params after sessions are loaded
                handleUrlParams();
                // Initial scraper heartbeat fetch
                pollScraperHeartbeats();
            });
        }

        // Stop session polling
        function stopSessionPolling() {
            // No-op - sessions are fetched on demand
        }

        // Initialize session management on page load
        function initSessionManagement() {
            initSessionSubTabs();

            // Set up event listeners
            document.getElementById('btn-new-session')?.addEventListener('click', () => openNewSessionModal());
            document.getElementById('new-session-type')?.addEventListener('change', updateNewSessionForm);
            document.getElementById('new-session-strategy')?.addEventListener('change', updateStrategyParams);

            // Start polling
            startSessionPolling();
        }

        // ==========================================
        // END SESSION MANAGEMENT
        // ==========================================
