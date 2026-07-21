# Binance RWA Perps Screener

A zero-backend screener for Binance's TradFi perpetuals (tokenized-equity, commodity, and pre-IPO perps). Catches pairs that are gaining both volume and open interest.

**Live:** https://aahuja9.github.io/binance-rwa-screener/

## What it shows

For every live `TRADIFI_PERPETUAL` contract on Binance USDT-M futures:

- **Vol 24h / Vol prev / Vol chg** — quote volume over the last 24 closed hourly candles vs the 24 before.
- **OI / OI 24h / OI 4h** — current open interest notional and its change vs 24h and 4h ago, from Binance's hourly `openInterestHist` archive. A 48h OI sparkline per row.
- **Vol/OI turnover** — 24h volume divided by current OI. High values (10x+) mean day-trading churn; low values mean sticky positions.
- **Signal quadrant** — the vol-change x OI-change read:
  - **New Money**: vol up + OI up — positions building, backed by activity
  - **Churn**: vol up + OI down — busy tape but positions closing
  - **Accumulation**: vol down + OI up — quiet position building
  - **Cooling**: both down
- **Score** — percentile rank of vol change and OI change, averaged (0-100).

Filters: category (US/HK/KR equities, pre-IPO, commodities), signal quadrant, minimum volume, symbol search. Sortable columns, optional 5-minute auto-refresh.

## Caveats

- On Mondays (and weekends) the volume-change column is inflated for equities: the comparison window is the weekend, when underlying markets were closed. The app shows a banner when this applies. OI change is unaffected.
- All data is fetched from `fapi.binance.com` directly in your browser — no server, no API key. If your region is geo-blocked by Binance (HTTP 451) or CORS fails, set a proxy prefix under Connection settings.

## Run locally

Any static server works:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

Not financial advice.
