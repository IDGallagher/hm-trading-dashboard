// Session detail modal component helpers

// ============= SESSION DETAIL MODAL =============
        let currentDetailSessionId = null;
        let detailEquityChart = null;
        let logStreamInterval = null;
        let tradesCurrentPage = 1;
        const TRADES_PER_PAGE = 50;

        // Open session detail modal
        async function openSessionDetailModal(sessionId) {
            console.log('[Detail] Opening modal for session:', sessionId);
            currentDetailSessionId = sessionId;

            // Show modal
            document.getElementById('session-detail-modal').classList.add('active');

            // Reset to info tab
            switchDetailTab('info');

            // Load session data
            await loadSessionDetail(sessionId);
        }

        // Close session detail modal
        function closeSessionDetailModal() {
            document.getElementById('session-detail-modal').classList.remove('active');
            currentDetailSessionId = null;

            // Stop log polling if active
            if (logStreamInterval) {
                clearInterval(logStreamInterval);
                logStreamInterval = null;
            }
            lastLogTimestamp = null;

            // Destroy equity chart
            if (detailEquityChart) {
                detailEquityChart.remove();
                detailEquityChart = null;
            }
        }

        // Switch between detail tabs
        function switchDetailTab(tabName) {
            // Update tab buttons
            document.querySelectorAll('.modal-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.tab === tabName);
            });

            // Update tab content
            document.querySelectorAll('.detail-tab-content').forEach(content => {
                content.classList.toggle('active', content.id === `tab-${tabName}`);
            });

            // Load tab-specific data
            if (currentDetailSessionId) {
                if (tabName === 'metrics') loadSessionMetrics(currentDetailSessionId);
                if (tabName === 'trades') loadSessionTrades(currentDetailSessionId, 1);
                if (tabName === 'logs') loadSessionLogs(currentDetailSessionId);
            }
        }

        // Load session detail info
        async function loadSessionDetail(sessionId) {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });

                if (!response.ok) throw new Error('Failed to load session');

                const data = await response.json();
                const session = data.session;

                // Update header
                document.getElementById('detail-session-name').textContent = session.name || `${session.strategy} - ${session.market}`;
                document.getElementById('detail-session-type').textContent = session.type;
                document.getElementById('detail-session-market').textContent = session.market;
                document.getElementById('detail-session-strategy').textContent = session.strategy;
                const statusEl = document.getElementById('detail-session-status');
                statusEl.textContent = session.status;
                statusEl.className = `detail-status ${session.status}`;

                // Update info tab
                document.getElementById('detail-id').textContent = session.id;
                document.getElementById('detail-name').textContent = session.name || '-';
                document.getElementById('detail-type').textContent = session.type;
                document.getElementById('detail-market').textContent = session.market;
                document.getElementById('detail-strategy').textContent = session.strategy;
                document.getElementById('detail-status').textContent = session.status;

                // Timing
                document.getElementById('detail-created').textContent = formatDateTime(session.created_at);
                document.getElementById('detail-started').textContent = session.started_at ? formatDateTime(session.started_at) : '-';
                document.getElementById('detail-completed').textContent = session.completed_at ? formatDateTime(session.completed_at) : '-';
                document.getElementById('detail-duration').textContent = session.started_at ?
                    formatDurationFromDates(session.started_at, session.completed_at || new Date().toISOString()) : '-';

                // Strategy params - format nicely
                try {
                    const params = session.strategy_params ? 
                        (typeof session.strategy_params === 'string' ? JSON.parse(session.strategy_params) : session.strategy_params) : {};
                    if (Object.keys(params).length > 0) {
                        const formatted = Object.entries(params)
                            .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
                            .join('\n');
                        document.getElementById('detail-params').textContent = formatted;
                    } else {
                        document.getElementById('detail-params').textContent = 'No custom parameters';
                    }
                } catch (e) {
                    document.getElementById('detail-params').textContent = session.strategy_params || 'No parameters';
                }

                // Notes
                document.getElementById('detail-notes').value = session.notes || '';

            } catch (error) {
                console.error('[Detail] Failed to load session:', error);
                showErrorToast('Error', 'Failed to load session details');
            }
        }

        // Format date/time
        function formatDateTime(isoString) {
            if (!isoString) return '-';
            const d = new Date(isoString);
            return d.toLocaleString();
        }

        // Format duration from two dates
        function formatDurationFromDates(start, end) {
            const ms = new Date(end) - new Date(start);
            const seconds = Math.floor(ms / 1000);
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
            if (minutes > 0) return `${minutes}m ${secs}s`;
            return `${secs}s`;
        }

        // Load session metrics
        async function loadSessionMetrics(sessionId) {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/metrics`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });

                if (!response.ok) throw new Error('Failed to load metrics');

                const data = await response.json();
                const m = data.metrics || {};

                // Update metric cards
                const pnl = m.total_pnl || 0;
                const pnlEl = document.getElementById('metric-pnl');
                pnlEl.textContent = `$${pnl.toFixed(2)}`;
                pnlEl.className = `metric-card-value ${pnl >= 0 ? 'positive' : 'negative'}`;

                document.getElementById('metric-trades').textContent = m.total_trades || 0;
                document.getElementById('metric-winrate').textContent = `${(m.win_rate || 0).toFixed(1)}%`;
                document.getElementById('metric-avgwin').textContent = `$${(m.avg_win || 0).toFixed(2)}`;
                document.getElementById('metric-avgloss').textContent = `$${(m.avg_loss || 0).toFixed(2)}`;
                document.getElementById('metric-drawdown').textContent = `$${(m.max_drawdown || 0).toFixed(2)}`;
                document.getElementById('metric-pf').textContent = (m.profit_factor || 0).toFixed(2);
                document.getElementById('metric-sharpe').textContent = (m.sharpe_ratio || 0).toFixed(2);

                // Load equity curve
                await loadEquityCurve(sessionId);

            } catch (error) {
                console.error('[Detail] Failed to load metrics:', error);
            }
        }

        // Load equity curve chart
        async function loadEquityCurve(sessionId) {
            try {
                // Use new helper (tries DB first, falls back to file)
                const result = await fetchSessionEquity(sessionId);
                if (!result.success) throw new Error('Failed to load equity curve');

                const points = result.equity || [];

                // Create/update chart
                const container = document.getElementById('detail-equity-chart');
                if (!container) return;

                if (detailEquityChart) {
                    detailEquityChart.remove();
                }

                detailEquityChart = LightweightCharts.createChart(container, {
                    width: container.clientWidth,
                    height: 250,
                    layout: { background: { type: 'solid', color: '#0d1117' }, textColor: '#8b949e' },
                    grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
                    timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,0.1)' },
                    rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' }
                });

                const lineSeries = detailEquityChart.addLineSeries({
                    color: '#58a6ff',
                    lineWidth: 2
                });

                if (points.length > 0) {
                    const equityPoints = points.map(p => ({
                        time: Math.floor(p.timestamp / 1000),
                        value: p.equity
                    }));
                    safeSetData(lineSeries, equityPoints, 'detailEquityChart');
                }

                // Apply adaptive time formatting for zoom
                setupAdaptiveTimeFormat(detailEquityChart);

            } catch (error) {
                console.error('[Detail] Failed to load equity curve:', error);
            }
        }

        // Load session trades with pagination
        async function loadSessionTrades(sessionId, page = 1) {
            try {
                tradesCurrentPage = page;
                const offset = (page - 1) * TRADES_PER_PAGE;

                // Use new helper (tries DB first, falls back to file)
                const result = await fetchSessionTrades(sessionId, { limit: TRADES_PER_PAGE, offset });
                if (!result.success) throw new Error('Failed to load trades');

                const trades = result.trades || [];
                const total = result.total || result.count || 0;

                const tbody = document.getElementById('detail-trades-body');
                if (trades.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" class="no-data">No trades yet</td></tr>';
                } else {
                    // Note: t.timestamp is Unix seconds, multiply by 1000 for JavaScript Date
                    tbody.innerHTML = trades.map(t => `
                        <tr>
                            <td>${new Date(t.timestamp * 1000).toLocaleString()}</td>
                            <td>${t.action}</td>
                            <td class="${t.side.toLowerCase()}">${t.side}</td>
                            <td>$${(parseFloat(t.price) || 0).toFixed(2)}</td>
                            <td>${formatTradeSize(t.size)}</td>
                            <td class="${(parseFloat(t.pnl) || 0) >= 0 ? 'buy' : 'sell'}">${t.pnl ? `$${(parseFloat(t.pnl) || 0).toFixed(2)}` : '-'}</td>
                            <td>${t.reason || '-'}</td>
                        </tr>
                    `).join('');
                }

                // Update pagination
                const totalPages = Math.ceil(total / TRADES_PER_PAGE);
                document.getElementById('trades-page-info').textContent = `Page ${page} of ${totalPages || 1}`;

            } catch (error) {
                console.error('[Detail] Failed to load trades:', error);
            }
        }

        // Pagination controls
        function loadTradesPage(direction) {
            if (!currentDetailSessionId) return;
            const newPage = direction === 'next' ? tradesCurrentPage + 1 : Math.max(1, tradesCurrentPage - 1);
            loadSessionTrades(currentDetailSessionId, newPage);
        }

        // Load session logs
        async function loadSessionLogs(sessionId) {
            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${sessionId}/logs?limit=100`, {
                    headers: { 'x-api-key': CONTROL_API_KEY }
                });

                if (!response.ok) throw new Error('Failed to load logs');

                const data = await response.json();
                const logs = data.logs || [];

                const container = document.getElementById('detail-logs-container');
                if (logs.length === 0) {
                    container.innerHTML = '<div class="log-line log-info">No logs yet</div>';
                } else {
                    container.innerHTML = logs.map(log => {
                        const levelClass = `log-${(log.level || 'info').toLowerCase()}`;
                        return `<div class="log-line ${levelClass}">[${new Date(log.timestamp).toLocaleTimeString()}] [${log.level || 'INFO'}] ${log.message}</div>`;
                    }).join('');

                    // Auto-scroll to bottom
                    if (document.getElementById('logs-autoscroll-check').checked) {
                        container.scrollTop = container.scrollHeight;
                    }
                }

            } catch (error) {
                console.error('[Detail] Failed to load logs:', error);
                document.getElementById('detail-logs-container').innerHTML =
                    '<div class="log-line log-error">Failed to load logs</div>';
            }
        }

        // Filter logs by level
        function filterLogs() {
            // Re-load logs with filter (API should support level filter)
            if (currentDetailSessionId) {
                loadSessionLogs(currentDetailSessionId);
            }
        }

        // Toggle live log polling
        function toggleLogStream() {
            const btn = document.getElementById('btn-logs-stream');

            if (logStreamInterval) {
                // Stop polling
                clearInterval(logStreamInterval);
                logStreamInterval = null;
                lastLogTimestamp = null;
                btn.textContent = '▶ Start Stream';
                btn.classList.remove('streaming');
            } else {
                // Start polling for new logs every second
                btn.textContent = '⏹ Stop Stream';
                btn.classList.add('streaming');

                // Set initial timestamp to now to only get new logs
                lastLogTimestamp = new Date().toISOString();

                logStreamInterval = setInterval(async () => {
                    if (!currentDetailSessionId) return;

                    try {
                        const url = `${CONTROL_API_URL}/sessions/${currentDetailSessionId}/logs?since=${encodeURIComponent(lastLogTimestamp)}`;
                        const response = await fetch(url, {
                            headers: { 'x-api-key': CONTROL_API_KEY }
                        });

                        if (!response.ok) return;

                        const data = await response.json();
                        const logs = data.logs || [];

                        if (logs.length > 0) {
                            const container = document.getElementById('detail-logs-container');

                            for (const log of logs) {
                                const levelClass = `log-${(log.level || 'info').toLowerCase()}`;
                                const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
                                container.innerHTML += `<div class="log-line ${levelClass}">[${timestamp}] [${log.level || 'INFO'}] ${log.message}</div>`;
                            }

                            // Update timestamp for next poll
                            lastLogTimestamp = logs[logs.length - 1].timestamp || new Date().toISOString();

                            if (document.getElementById('logs-autoscroll-check').checked) {
                                container.scrollTop = container.scrollHeight;
                            }
                        }
                    } catch (e) {
                        // Ignore errors during polling
                    }
                }, 1000);
            }
        }

        // Save session notes
        async function saveSessionNotes() {
            if (!currentDetailSessionId) return;

            const notes = document.getElementById('detail-notes').value;

            try {
                const response = await fetch(`${CONTROL_API_URL}/sessions/${currentDetailSessionId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': CONTROL_API_KEY
                    },
                    body: JSON.stringify({ notes })
                });

                if (!response.ok) throw new Error('Failed to save notes');

                showSessionNotification('Notes saved');

            } catch (error) {
                console.error('[Detail] Failed to save notes:', error);
                showErrorToast('Error', 'Failed to save notes');
            }
        }

        // View current session on chart
        function viewSessionOnChart() {
            if (currentDetailSessionId) {
                viewSession(currentDetailSessionId);
                closeSessionDetailModal();
            }
        }

        // Clone current session
        async function cloneCurrentSession() {
            if (currentDetailSessionId) {
                await cloneSession(currentDetailSessionId);
                closeSessionDetailModal();
            }
        }

        // Session card clicks now handled inline via onclick attribute in renderSessionCard()
        // Old modal-based click handler removed - using inline detail view instead
        // ============= END SESSION DETAIL MODAL =============

