# Binance RWA Perps Screener

A zero-backend screener for Binance's TradFi perpetuals (tokenized-equity, commodity, and pre-IPO perps). Catches pairs that are gaining both volume and open interest.

**Live:** https://aahuja9.github.io/binance-rwa-screener/

## What it shows

For every live `TRADIFI_PERPETUAL` contract on Binance USDT-M futures:

- **Vol 24h / Vol prev / Vol chg** — quote volume over the last 24 closed hourly candles vs the 24 before.
- **OI / OI 24h / OI 4h** — current open interest notional and its change vs 24h and 4h ago, from Binance's hourly `openInterestHist` archive. A 48h OI sparkline per row.
- **Vol/OI turnover** — 24h volume divided by current OI. High values (10x+) mean day-trading churn; low values mean sticky positions.
- **Div** — whether the underlying pays a dividend, with hover detail and a click-through to its dividend history. Curated static data in `dividends.js`; `?` marks Binance alias tickers whose underlying is unconfirmed. Note that perp holders never receive dividends — Binance neutralizes them via index price adjustment on ex-dividend dates.
- **Score** — momentum score 0-100. Each pair is ranked by 24h volume change and by 24h OI change; each rank becomes a percentile and the two are averaged 50/50. Relative to the loaded set, not an absolute threshold. Hover the header or any cell for the breakdown.

USDT-margined contracts only (USD1-quoted duplicates are excluded).

Filters: category (US/HK/KR equities, pre-IPO, commodities), minimum volume, symbol search. Sortable columns, optional 5-minute auto-refresh.

## Caveats

- On Mondays (and weekends) the volume-change column is inflated for equities: the comparison window is the weekend, when underlying markets were closed. The app shows a banner when this applies. OI change is unaffected.
- All data is fetched from `fapi.binance.com` directly in your browser — no server, no API key. If your region is geo-blocked by Binance (HTTP 451) or CORS fails, set a proxy prefix under Connection settings.

## Architecture

Two modes, one codebase:

**Server mode (preferred).** `server.js` polls Binance every 5 minutes, caches the snapshot in memory, and serves it at `/api/data` alongside the static frontend. Page loads are instant — one small JSON read instead of 260+ Binance calls per visitor — and every viewer shares the same poll cycle. Zero npm dependencies (Node 18+ built-ins only).

**Static mode (fallback).** If `/api/data` is unreachable, the frontend fetches Binance directly from the browser, exactly as before. This is what the GitHub Pages copy does. The timestamp in the header shows which mode is active: `(server)` or `(browser)`.

Dividend annotation and score computation always happen client-side, so the backend stays purely market-data.

### Endpoints

- `GET /api/data` — cached snapshot: `{rows, updatedAt, count, stale}`
- `GET /api/health` — poll diagnostics: pair count, last error, poll duration, consecutive failures

## Deploying to Render

`render.yaml` provisions a Node web service in the **Singapore** region. Deploy via Blueprint (New → Blueprint, point at this repo) and it configures itself:

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Region matters: Binance rejects requests that do not look like a browser (HTTP 451), and access varies by region. The server sends browser-like headers, and Singapore is well-placed for Binance's infrastructure. Tune `POLL_SECONDS` (default 300) and `CONCURRENCY` (default 6) via environment variables.

On Render's free tier the instance sleeps after inactivity, which stops the poller and adds a cold start; `plan: starter` in the blueprint keeps it always-on.

## Run locally

With the backend (recommended — mirrors production):

```
npm start
```

Then open http://localhost:3000. Set `PORT` if 3000 is taken.

Static-only, no backend:

```
python3 -m http.server 8000
```

Not financial advice.
