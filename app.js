"use strict";

const BASE = "https://fapi.binance.com";
const CONCURRENCY = 8;
const CATS = {
  EQUITY: "US Eq",
  HK_EQUITY: "HK Eq",
  KR_EQUITY: "KR Eq",
  PREMARKET: "Pre-IPO",
  COMMODITY: "Cmdty",
};
const state = {
  rows: [],
  sortKey: "oiChg24",
  sortDir: -1,
  cats: new Set(["EQUITY", "HK_EQUITY", "KR_EQUITY", "PREMARKET"]),
  minVol: 0,
  search: "",
  timer: null,
};

const $ = (id) => document.getElementById(id);

function proxied(url) {
  const p = localStorage.getItem("proxyPrefix") || "";
  return p ? p + encodeURIComponent(url) : url;
}

async function fetchJson(path) {
  const res = await fetch(proxied(BASE + path));
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json();
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  const bar = $("progressBar"), txt = $("progressText");
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
      done++;
      bar.style.width = `${(done / items.length) * 100}%`;
      txt.textContent = `${done}/${items.length} pairs`;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function nearest(arr, targetTs) {
  let best = arr[0];
  for (const x of arr) if (Math.abs(x.timestamp - targetTs) < Math.abs(best.timestamp - targetTs)) best = x;
  return best;
}

async function loadSymbol(meta) {
  const sym = meta.symbol;
  const [kl, oih] = await Promise.all([
    fetchJson(`/fapi/v1/klines?symbol=${sym}&interval=1h&limit=49`),
    fetchJson(`/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=48`),
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

  const volChg = volPrev ? (volNow / volPrev - 1) * 100 : null;
  return {
    symbol: sym, baseAsset: meta.baseAsset, cat: meta.underlyingType, price,
    priceChg: price24 ? (price / price24 - 1) * 100 : null,
    volNow, volPrev, volChg, oiNow, oiChg24, oiChg4,
    turnover: oiNow ? volNow / oiNow : null,
    oiSeries,
  };
}

function computeScores(rows) {
  const ranked = (key) => {
    const vals = rows.filter((r) => r[key] != null).sort((a, b) => a[key] - b[key]);
    const pos = new Map(vals.map((r, i) => [r.symbol, vals.length > 1 ? i / (vals.length - 1) : 0.5]));
    return (r) => pos.get(r.symbol) ?? 0.5;
  };
  const rv = ranked("volChg"), ro = ranked("oiChg24");
  for (const r of rows) {
    r.scoreVol = Math.round(rv(r) * 100);
    r.scoreOi = Math.round(ro(r) * 100);
    r.score = Math.round((0.5 * rv(r) + 0.5 * ro(r)) * 100);
  }
}

// Preferred path: the backend (Render, Singapore) polls Binance and serves a
// cached snapshot. Falls back to fetching Binance directly from the browser so
// the static-only deployment keeps working.
async function loadFromBackend() {
  const res = await fetch("api/data", { cache: "no-store" });
  if (!res.ok) throw new Error(`backend HTTP ${res.status}`);
  const json = await res.json();
  if (!json.rows || !json.rows.length) throw new Error("backend returned no rows");
  return json;
}

function annotate(rows) {
  for (const r of rows) {
    const divi = dividendInfo(r.baseAsset || r.symbol.replace(/USDT$/, ""), r.cat);
    r.div = divi ? divi.d : null;
    r.divNote = divi ? divi.note : "";
    r.divUrl = divi ? divi.url : "";
  }
  computeScores(rows);
  return rows;
}

function finish(rows, updatedAt, source) {
  state.rows = rows;
  state.source = source;
  const when = updatedAt ? new Date(updatedAt) : new Date();
  $("lastUpdated").textContent =
    `Updated ${when.toLocaleTimeString()} ${source === "backend" ? "(server)" : "(browser)"}`;
  const day = new Date().getUTCDay();
  $("weekendNote").hidden = !(day === 0 || day === 1 || day === 6);
  render();
}

async function refresh() {
  const btn = $("refreshBtn");
  btn.disabled = true;
  $("errorBox").hidden = true;
  try {
    const json = await loadFromBackend();
    finish(annotate(json.rows), json.updatedAt, "backend");
    btn.disabled = false;
    return;
  } catch (e) {
    console.info("backend unavailable, fetching Binance directly:", e.message);
  }
  $("progressWrap").hidden = false;
  try {
    const info = await fetchJson("/fapi/v1/exchangeInfo");
    const metas = info.symbols.filter(
      (s) => s.contractType === "TRADIFI_PERPETUAL" && s.status === "TRADING" &&
        CATS[s.underlyingType] && s.quoteAsset === "USDT"
    );
    const rows = (await mapLimit(metas, CONCURRENCY, loadSymbol)).filter(Boolean);
    if (!rows.length) throw new Error("no data returned");
    finish(annotate(rows), null, "browser");
  } catch (e) {
    const box = $("errorBox");
    box.hidden = false;
    box.textContent =
      `Failed to load Binance data (${e.message}). If you are in a region Binance blocks (HTTP 451) ` +
      `or the browser blocks cross-origin requests, open Connection settings below and set a CORS proxy prefix.`;
  } finally {
    btn.disabled = false;
    $("progressWrap").hidden = true;
  }
}

const fmtUsd = (v) => {
  if (v == null) return "–";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return v.toFixed(0);
};
const fmtPct = (v, d = 1) => (v == null ? "–" : (v > 0 ? "+" : "") + v.toFixed(d) + "%");
const pctCls = (v) => (v == null ? "dim" : v > 0 ? "up" : v < 0 ? "down" : "dim");

function spark(series) {
  if (!series || series.length < 2) return "";
  const w = 90, h = 24, min = Math.min(...series), max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) =>
    `${((i / (series.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`
  );
  return `<svg class="spark" width="${w}" height="${h}" role="img" aria-label="48h open interest trend"><path d="M${pts.join(" L")}"/></svg>`;
}

const COLS = [
  { key: "symbol", label: "Symbol", left: true },
  { key: "cat", label: "Cat", left: true },
  { key: "price", label: "Last" },
  { key: "priceChg", label: "Price 24h" },
  { key: "volNow", label: "Vol 24h" },
  { key: "volPrev", label: "Vol prev" },
  { key: "volChg", label: "Vol chg" },
  { key: "oiNow", label: "OI" },
  { key: "oiChg24", label: "OI 24h" },
  { key: "oiChg4", label: "OI 4h" },
  { key: "turnover", label: "Vol/OI" },
  { key: "oiSeries", label: "OI 48h", sortable: false },
  { key: "div", label: "Div", left: true },
  {
    key: "score", label: "Score",
    title: "Momentum score, 0-100. Each pair is ranked by 24h volume change and by 24h OI change; " +
      "each rank becomes a percentile (0 = lowest in the current set, 100 = highest), and the two are averaged 50/50. " +
      "It is relative to the pairs currently loaded, not an absolute threshold - it shifts as the field shifts. " +
      "Hover a cell for its two components.",
  },
];

function renderHead() {
  $("headRow").innerHTML = COLS.map((c) => {
    const arrow = state.sortKey === c.key ? `<span class="arrow">${state.sortDir < 0 ? "▼" : "▲"}</span>` : "";
    const tip = c.title ? ` title="${c.title.replace(/"/g, "&quot;")}"` : "";
    const mark = c.title ? '<span class="info">?</span>' : "";
    return `<th class="${c.left ? "l" : ""}" data-key="${c.key}" data-sortable="${c.sortable !== false}"${tip}>${c.label}${mark}${arrow}</th>`;
  }).join("");
}

function visibleRows() {
  const q = state.search.trim().toUpperCase();
  let rows = state.rows.filter(
    (r) => state.cats.has(r.cat) && r.volNow >= state.minVol && (!q || r.symbol.includes(q))
  );
  const k = state.sortKey, dir = state.sortDir;
  rows.sort((a, b) => {
    const av = a[k], bv = b[k];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
  });
  return rows;
}

function renderTiles(rows) {
  const totVol = rows.reduce((a, r) => a + r.volNow, 0);
  const totOi = rows.reduce((a, r) => a + (r.oiNow || 0), 0);
  const oiUp = rows.filter((r) => r.oiChg24 != null && r.oiChg24 > 0);
  const topOi = rows.filter((r) => r.oiChg24 != null).sort((a, b) => b.oiChg24 - a.oiChg24)[0];
  $("tiles").innerHTML = [
    { k: "24h volume (filtered)", v: "$" + fmtUsd(totVol), d: `${rows.length} pairs` },
    { k: "Open interest", v: "$" + fmtUsd(totOi), d: "notional" },
    { k: "OI rising", v: String(oiUp.length), d: "pairs with OI up vs 24h ago" },
    topOi
      ? { k: "Top OI gainer", v: topOi.symbol.replace(/USDT$|USD1$/, ""), d: `${fmtPct(topOi.oiChg24)} OI, ${fmtPct(topOi.volChg, 0)} vol` }
      : { k: "Top OI gainer", v: "–", d: "" },
  ].map((t) => `<div class="tile"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="d">${t.d}</div></div>`).join("");
}

function render() {
  renderHead();
  const rows = visibleRows();
  renderTiles(rows);
  $("body").innerHTML = rows.map((r) => {
    return `<tr>
      <td class="l sym">${r.symbol}</td>
      <td class="l cat">${CATS[r.cat] || r.cat}</td>
      <td>${r.price >= 100 ? r.price.toFixed(2) : r.price.toPrecision(4)}</td>
      <td class="${pctCls(r.priceChg)}">${fmtPct(r.priceChg)}</td>
      <td>${fmtUsd(r.volNow)}</td>
      <td class="dim">${fmtUsd(r.volPrev)}</td>
      <td class="${pctCls(r.volChg)}">${fmtPct(r.volChg, 0)}</td>
      <td>${fmtUsd(r.oiNow)}</td>
      <td class="${pctCls(r.oiChg24)}">${fmtPct(r.oiChg24)}</td>
      <td class="${pctCls(r.oiChg4)}">${fmtPct(r.oiChg4)}</td>
      <td>${r.turnover == null ? "–" : r.turnover.toFixed(2) + "x"}</td>
      <td>${spark(r.oiSeries)}</td>
      <td class="l">${
        r.div == null
          ? '<span class="dim">–</span>'
          : `<a class="divlink" href="${r.divUrl}" target="_blank" rel="noopener" title="${r.divNote.replace(/"/g, "&quot;")}"><span class="badge div-${r.div === "Y" ? "y" : r.div === "N" ? "n" : "u"}">${r.div === "Y" ? "Yes" : r.div === "N" ? "No" : "?"}</span></a>`
      }</td>
      <td class="score-cell" title="Vol-change percentile ${r.scoreVol} + OI-change percentile ${r.scoreOi}, averaged 50/50 = ${r.score}. Percentile is rank within the pairs currently loaded.">${r.score}</td>
    </tr>`;
  }).join("");
}

function renderChips() {
  $("catChips").innerHTML = Object.entries(CATS).map(
    ([k, v]) => `<button class="chip ${state.cats.has(k) ? "active" : ""}" data-cat="${k}">${v}</button>`
  ).join("");
}

function parseVol(s) {
  const m = String(s).trim().toUpperCase().match(/^([\d.]+)\s*([KMB]?)$/);
  if (!m) return 0;
  return +m[1] * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1);
}

function wire() {
  $("refreshBtn").addEventListener("click", refresh);
  $("headRow").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th || th.dataset.sortable === "false") return;
    const k = th.dataset.key;
    if (state.sortKey === k) state.sortDir *= -1;
    else { state.sortKey = k; state.sortDir = -1; }
    render();
  });
  $("catChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    const c = b.dataset.cat;
    state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c);
    renderChips(); render();
  });
  $("minVol").addEventListener("input", (e) => { state.minVol = parseVol(e.target.value); render(); });
  $("search").addEventListener("input", (e) => { state.search = e.target.value; render(); });
  $("autoRefresh").addEventListener("change", (e) => {
    clearInterval(state.timer);
    if (e.target.checked) {
      // When the backend is serving, poll it often - it is a cached read, not
      // 260+ Binance calls - so the page tracks the server's own poll cycle.
      const ms = state.source === "backend" ? 60 * 1000 : 5 * 60 * 1000;
      state.timer = setInterval(refresh, ms);
    }
  });
  $("proxyPrefix").value = localStorage.getItem("proxyPrefix") || "";
  $("saveProxy").addEventListener("click", () => {
    localStorage.setItem("proxyPrefix", $("proxyPrefix").value.trim());
    refresh();
  });
}

renderChips();
wire();
refresh();
