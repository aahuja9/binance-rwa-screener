"use strict";
// Zero-dependency Node server: polls Binance on an interval, caches the result,
// and serves both the JSON snapshot and the static frontend.
// Deployed on Render in the Singapore region so Binance is reachable.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const POLL_MS = (process.env.POLL_SECONDS ? +process.env.POLL_SECONDS : 300) * 1000;
const CONCURRENCY = process.env.CONCURRENCY ? +process.env.CONCURRENCY : 6;
const BASE = "https://fapi.binance.com";
const CATS = ["EQUITY", "HK_EQUITY", "KR_EQUITY", "PREMARKET", "COMMODITY"];

// Binance rejects requests that do not look like a browser (HTTP 451).
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const cache = {
  rows: [],
  updatedAt: null,
  polling: false,
  lastError: null,
  lastDurationMs: null,
  consecutiveFailures: 0,
};

async function api(pathname) {
  const res = await fetch(BASE + pathname, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${pathname.split("?")[0]}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function nearest(arr, ts) {
  let best = arr[0];
  for (const x of arr) if (Math.abs(x.timestamp - ts) < Math.abs(best.timestamp - ts)) best = x;
  return best;
}

async function loadSymbol(meta) {
  const sym = meta.symbol;
  const [kl, oih] = await Promise.all([
    api(`/fapi/v1/klines?symbol=${sym}&interval=1h&limit=49`),
    api(`/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=48`).catch(() => null),
  ]);
  if (!Array.isArray(kl) || kl.length < 2) return null;

  const closed = kl.slice(0, -1);
  const last24 = closed.slice(-24);
  const prev24 = closed.slice(-48, -24);
  const volNow = last24.reduce((a, k) => a + +k[7], 0);
  const volPrev = prev24.length === 24 ? prev24.reduce((a, k) => a + +k[7], 0) : null;
  const price = +kl[kl.length - 1][4];
  const price24 = last24.length ? +last24[0][1] : null;

  let oiNow = null, oiChg24 = null, oiChg4 = null, oiSeries = [];
  if (Array.isArray(oih) && oih.length >= 2) {
    oih.sort((a, b) => a.timestamp - b.timestamp);
    oiSeries = oih.map((x) => +x.sumOpenInterestValue);
    const last = oih[oih.length - 1];
    oiNow = +last.sumOpenInterestValue;
    const p24 = nearest(oih, last.timestamp - 24 * 36e5);
    const p4 = nearest(oih, last.timestamp - 4 * 36e5);
    if (p24 !== last) oiChg24 = (oiNow / +p24.sumOpenInterestValue - 1) * 100;
    if (p4 !== last) oiChg4 = (oiNow / +p4.sumOpenInterestValue - 1) * 100;
  }

  return {
    symbol: sym,
    baseAsset: meta.baseAsset,
    cat: meta.underlyingType,
    price,
    priceChg: price24 ? (price / price24 - 1) * 100 : null,
    volNow,
    volPrev,
    volChg: volPrev ? (volNow / volPrev - 1) * 100 : null,
    oiNow,
    oiChg24,
    oiChg4,
    turnover: oiNow ? volNow / oiNow : null,
    oiSeries,
  };
}

async function poll() {
  if (cache.polling) return;
  cache.polling = true;
  const started = Date.now();
  try {
    const info = await api("/fapi/v1/exchangeInfo");
    const metas = info.symbols.filter(
      (s) => s.contractType === "TRADIFI_PERPETUAL" && s.status === "TRADING" &&
        s.quoteAsset === "USDT" && CATS.includes(s.underlyingType)
    );
    const rows = (await mapLimit(metas, CONCURRENCY, loadSymbol)).filter(Boolean);
    if (!rows.length) throw new Error("no rows returned");
    cache.rows = rows;
    cache.updatedAt = new Date().toISOString();
    cache.lastError = null;
    cache.consecutiveFailures = 0;
    cache.lastDurationMs = Date.now() - started;
    console.log(`[poll] ok: ${rows.length} pairs in ${cache.lastDurationMs}ms`);
  } catch (e) {
    cache.consecutiveFailures++;
    cache.lastError = e.message;
    cache.lastDurationMs = Date.now() - started;
    console.error(`[poll] failed (${cache.consecutiveFailures}): ${e.message}`);
  } finally {
    cache.polling = false;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.join(__dirname, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(__dirname)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }).end("not found"); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=300",
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || "/").split("?")[0];

  if (urlPath === "/api/data") {
    const body = JSON.stringify({
      rows: cache.rows,
      updatedAt: cache.updatedAt,
      count: cache.rows.length,
      stale: cache.lastError != null,
    });
    res.writeHead(cache.rows.length ? 200 : 503, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });
    res.end(body);
    return;
  }

  if (urlPath === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({
      ok: cache.rows.length > 0,
      pairs: cache.rows.length,
      updatedAt: cache.updatedAt,
      lastError: cache.lastError,
      lastDurationMs: cache.lastDurationMs,
      consecutiveFailures: cache.consecutiveFailures,
      pollSeconds: POLL_MS / 1000,
      uptimeSeconds: Math.round(process.uptime()),
    }, null, 2));
    return;
  }

  serveStatic(req, res, urlPath);
});

server.listen(PORT, () => {
  console.log(`listening on ${PORT}, polling every ${POLL_MS / 1000}s`);
  poll();
  setInterval(poll, POLL_MS);
});
