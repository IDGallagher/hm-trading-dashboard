# HM Trading Dashboard - Project Learnings

## Project Completion (2026-01-27)
Real-time BitMEX XBTUSD trading dashboard: https://hm-trading-dashboard.pages.dev/
- All 12 P1-P5 features verified complete
- Deployed to Cloudflare Pages
- Final verification: CEO QA round passed all requirements

## Key Technical Insights

### Session Detail View
- Positioned at y=1071 (requires user scroll to access)
- Logs section displays "No logs available" when no INFO/WARN/ERROR entries exist
- Browser caching requires hard refresh (Cmd+Shift+R) to see updates after deployment

### Systemd Service Configuration
- Used systemd template unit pattern: `hm-bot@<instance>.service`
- Critical fixes: `StartLimitBurst` placement (after `StartLimitInterval`), shell variable expansion in service files
- Commit: fec997e

### BitMEX Integration
- P&L formula: inverse perpetual contract calculation
- XBTUSD pairs use specific leverage/position sizing logic
- Real-time WebSocket streaming verified stable

### Cloudflare Deployment
- Pages deployment handles automatic cache clearing on push
- Static site regeneration for real-time data requires refresh strategy
- DNS routing for custom domain tested and verified

## Key Challenges & Resolutions

| Challenge | Root Cause | Solution |
|-----------|-----------|----------|
| Session view not updating | Browser caching | Hard refresh (Cmd+Shift+R) required by users |
| systemd service failures | Syntax errors (StartLimitBurst, variables) | Fixed systemd template, tested all 3 services running |
| QA blocking | Credentials expired (2+ hour session) | Credential refresh between test rounds |

## Agent Contributions
- **backend-dev**: Session detail view + logs section, final deployment
- **cpp-dev**: Systemd service fixes, verified all services running
- **workflow-qa**: Comprehensive P1-P5 feature verification, bug detection & fix validation

## Patterns That Worked
- Incremental QA with immediate bug fixes (rapid iteration)
- Systemd troubleshooting via direct service status checks
- Cloudflare Pages for static dashboard deployment (reliable, fast)
