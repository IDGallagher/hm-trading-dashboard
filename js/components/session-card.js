// Session card component helpers (extracted from monolith)

// Render a single session card
        function renderSessionCard(session, panelType) {
            const isRunning = session.status === 'running';
            const isScraper = session.type === 'scraper';
            const healthClass = getHealthClass(session);
            const cardClass = getCardHealthClass(session);

            // Calculate runtime
            let runtime = '--';
            if (session.started_at) {
                const startTime = new Date(session.started_at).getTime();
                // For running sessions, always use current time (ignore stopped_at from previous run)
                const endTime = (session.status === 'running' || !session.stopped_at)
                    ? Date.now()
                    : new Date(session.stopped_at).getTime();
                const durationMs = endTime - startTime;
                // Guard against negative duration (can happen with clock skew or bad data)
                runtime = durationMs >= 0 ? formatDuration(durationMs) : '00:00:00';
            }

            // Format PnL (not shown for scrapers)
            const pnl = parseFloat(session.total_pnl || 0);
            const pnlClass = pnl >= 0 ? 'positive' : 'negative';
            const pnlFormatted = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;

            // Get heartbeat display
            const heartbeatHtml = isRunning ? renderHeartbeat(session) : '';

            // Actions based on panel type (View button removed - row click navigates)
            let actionsHtml = '';
            if (panelType === 'running' || panelType === 'scrapers') {
                actionsHtml = `
                    <button class="btn-session-action btn-session-restart" onclick="event.stopPropagation(); restartSession('${session.id}')">Restart</button>
                    <button class="btn-session-action btn-session-stop" onclick="event.stopPropagation(); stopSession('${session.id}')">Stop</button>
                `;
            } else {
                actionsHtml = `
                    <button class="btn-session-action btn-session-restart" onclick="event.stopPropagation(); restartSession('${session.id}')">Restart</button>
                    <button class="btn-session-action btn-session-clone" onclick="event.stopPropagation(); cloneSession('${session.id}')">Clone</button>
                    <button class="btn-session-action btn-session-delete" onclick="event.stopPropagation(); deleteSession('${session.id}')">×</button>
                `;
            }

            // Show "LIVE DATA" badge for running test sessions with healthy heartbeat (providing market data)
            const isProvidingLiveData = isRunning && session.type === 'test' &&
                session.seconds_since_update !== undefined && session.seconds_since_update < 30;
            const liveDataBadge = isProvidingLiveData ?
                '<span class="live-data-badge" title="This session is providing live market data">📡 LIVE</span>' : '';

            // Parse and format strategy params for display
            let paramsDisplay = '';
            try {
                const params = session.strategy_params ? 
                    (typeof session.strategy_params === 'string' ? JSON.parse(session.strategy_params) : session.strategy_params) : {};
                const paramItems = [];
                if (params.trade_size !== undefined) paramItems.push(`Size: ${params.trade_size}`);
                if (params.trade_interval !== undefined) paramItems.push(`Interval: ${params.trade_interval}s`);
                if (params.leverage !== undefined && params.leverage !== 1) paramItems.push(`Lev: ${params.leverage}x`);
                if (paramItems.length > 0) {
                    paramsDisplay = `<span class="session-params">${paramItems.join(' • ')}</span>`;
                }
            } catch (e) { /* ignore parse errors */ }

            // Format session name - handle multi-market scrapers
            let sessionName = session.name || `${session.strategy} - ${session.market}`;
            let marketDisplay = session.market;
            if (isScraper && session.market && session.market.includes('+')) {
                // Multi-market scraper - show count instead of full list
                const markets = session.market.split('+');
                marketDisplay = `${markets.length} markets`;
                // If name already contains first market, don't duplicate
                if (!session.name) {
                    sessionName = `${session.strategy}`;
                }
            }

            return `
                <div class="session-card clickable ${cardClass}" data-session-id="${session.id}" onclick="showInlineDetail('${session.id}', '${panelType}')">
                    <div class="session-info">
                        <div class="session-name">
                            ${sessionName}
                            <span class="session-market">${marketDisplay}</span>
                            ${liveDataBadge}
                        </div>
                        <div class="session-meta">
                            <span class="session-strategy">${session.strategy}</span>
                            <span>${session.type}</span>
                            ${paramsDisplay}
                        </div>
                    </div>
                    <div class="session-status ${session.status}">
                        <span class="status-dot"></span>
                        ${session.status}
                    </div>
                    <div class="session-runtime">${runtime}</div>
                    ${isRunning && !isScraper ? `
                        <div class="heartbeat-indicator ${healthClass}">
                            <span class="heartbeat-icon">♡</span>
                            <span>${session.seconds_since_update || 0}s ago</span>
                        </div>
                    ` : ''}
                    ${isRunning && isScraper ? `
                        <div class="heartbeat-indicator ${session.service_active === true ? 'service-active' : (session.service_active === false ? 'service-inactive' : 'healthy')}">
                            <span class="heartbeat-icon">●</span>
                            <span>${session.service_active === false ? 'stopped' : (session.seconds_since_data !== undefined ? session.seconds_since_data + 's ago' : 'loading...')}</span>
                        </div>
                    ` : ''}
                    ${!isScraper ? `
                        <div class="session-metric">
                            <span class="metric-label">Trades</span>
                            <span class="metric-value">${session.trade_count || 0}</span>
                        </div>
                        <div class="session-metric">
                            <span class="metric-label">P&L</span>
                            <span class="metric-value ${pnlClass}">${pnlFormatted}</span>
                        </div>
                    ` : ''}
                    <div class="session-actions">
                        ${actionsHtml}
                    </div>
                </div>
            `;
        }

        // Get health class for heartbeat indicator
        function getHealthClass(session) {
            if (!session.health_status) return 'healthy';
            return session.health_status; // healthy, warning, stale, dead
        }

        // Get card class for stale warnings
        function getCardHealthClass(session) {
            if (session.status !== 'running') return '';
            if (session.health_status === 'stale' || session.health_status === 'dead') {
                return 'stale-danger';
            }
            if (session.health_status === 'warning') {
                return 'stale-warning';
            }
            return '';
        }

        // Render heartbeat indicator
        function renderHeartbeat(session) {
            const healthClass = getHealthClass(session);
            const seconds = session.seconds_since_update || 0;
            return `
                <div class="heartbeat-indicator ${healthClass}">
                    <span class="heartbeat-icon">♡</span>
                    <span>${seconds}s ago</span>
                </div>
            `;
        }

        // Format duration from milliseconds
        function formatDuration(ms) {
            const seconds = Math.floor(ms / 1000);
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

