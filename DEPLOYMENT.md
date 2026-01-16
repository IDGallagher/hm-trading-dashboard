# HM Trading Dashboard - Deployment

## Live URL

**Production:** https://hm-trading-dashboard.pages.dev

## Cloudflare Pages Configuration

- **Project Name:** hm-trading-dashboard
- **Production Branch:** master
- **Build Command:** None (static site)
- **Output Directory:** / (root)
- **Auto-deploy:** Enabled

## How to Update

1. Make changes to the dashboard files
2. Commit and push to master:
   ```bash
   git add .
   git commit -m "Update dashboard"
   git push origin master
   ```
3. Cloudflare Pages automatically deploys on every push to master

## Deployment History

Deployments are tracked at: https://dash.cloudflare.com/

## Architecture

- Static HTML dashboard with Chart.js visualization
- Data loaded from `backtest_results.json`
- No build step required
- GitHub → Cloudflare Pages integration

## Initial Setup (Already Complete)

The Cloudflare Pages project was created via API:
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -d '{"name": "hm-trading-dashboard", "production_branch": "master", "source": {"type": "github", "config": {"owner": "IDGallagher", "repo_name": "hm-trading-dashboard"}}}'
```
