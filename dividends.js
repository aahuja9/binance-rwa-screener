"use strict";
// Curated dividend status for underlyings of Binance TradFi perps.
// Keyed by Binance baseAsset. d: "Y" pays, "N" does not, "?" unverified
// (several Binance tickers are aliases that don't match the real exchange symbol).
// note: shown as tooltip. url: overrides the default click-through.
// Static data - verify before trading on it. Last reviewed 2026-07-21.

const DIV_ETFS = new Set([
  "QQQ", "SPY", "IWM", "TQQQ", "SQQQ", "SOXL", "SOXS", "TZA", "UVXY",
  "XLE", "XBI", "URNM", "EWJ", "EWY", "EWZ", "EWT", "KORU", "DRAM", "KSTR",
]);

const DIVIDENDS = {
  // Verified July 2026
  MU: { d: "Y", note: "Quarterly $0.15; last paid Jul 21 2026" },
  SKHY: { d: "Y", note: "SK hynix ADR; last paid Jul 8 2026 ($0.24), next Oct 7 2026", url: "https://stockevents.app/en/stock/HXSCL/dividends" },
  QQQ: { d: "Y", note: "Quarterly; last paid Jul 10 2026 ($0.8135)" },
  EWY: { d: "Y", note: "Annual; last paid Dec 19 2025 ($2.04)" },
  KORU: { d: "Y", note: "Small quarterly; last paid Mar 31 2026 ($0.0057)" },
  SOXL: { d: "Y", note: "Token quarterly distributions; last confirmed Sep 30 2025 ($0.0101)" },
  SNDK: { d: "N", note: "No dividend planned (WDC spin-off, Feb 2025)" },
  CRCL: { d: "N", note: "No dividend; IPO Jun 2025" },
  DRAM: { d: "N", note: "Roundhill Memory ETF, launched Apr 2026; no distributions" },
  SPCX: { d: "N", note: "SpaceX pre-IPO; private, no dividend" },
  OPENAI: { d: "N", note: "Pre-IPO; private, no dividend" },
  ANTHROPIC: { d: "N", note: "Pre-IPO; private, no dividend" },

  // Well-known payers
  AAPL: { d: "Y" }, MSFT: { d: "Y" }, GOOGL: { d: "Y" }, META: { d: "Y" },
  NVDA: { d: "Y", note: "Token quarterly dividend" }, AVGO: { d: "Y" },
  QCOM: { d: "Y" }, TXN: { d: "Y" }, CSCO: { d: "Y" }, IBM: { d: "Y" },
  ORCL: { d: "Y" }, CRM: { d: "Y" }, JPM: { d: "Y" }, V: { d: "Y" },
  WMT: { d: "Y" }, HD: { d: "Y" }, COST: { d: "Y" }, LLY: { d: "Y" },
  NVO: { d: "Y" }, DIS: { d: "Y" }, CAT: { d: "Y" }, MRVL: { d: "Y" },
  AMAT: { d: "Y" }, LRCX: { d: "Y" }, KLAC: { d: "Y" }, TSM: { d: "Y" },
  ASML: { d: "Y" }, SONY: { d: "Y" }, EBAY: { d: "Y" }, GLW: { d: "Y" },
  HPE: { d: "Y" }, DELL: { d: "Y" }, BX: { d: "Y" }, TER: { d: "Y" },
  GEV: { d: "Y" }, VRT: { d: "Y", note: "Small dividend" },
  NOK: { d: "Y", note: "Nokia" }, BABA: { d: "Y", note: "Annual dividend since 2023" },
  STRC: { d: "Y", note: "Strategy preferred; monthly dividend" },
  SAMSUNG: { d: "Y", note: "Quarterly (KRW)" },
  SKHYNIX: { d: "Y", note: "Quarterly (KRW)" },
  HYUNDAI: { d: "Y", note: "Quarterly (KRW)" },
  SPY: { d: "Y" }, IWM: { d: "Y" }, EWJ: { d: "Y" }, EWZ: { d: "Y" },
  EWT: { d: "Y" }, XLE: { d: "Y" }, XBI: { d: "Y" }, URNM: { d: "Y" },
  TQQQ: { d: "Y", note: "Small distributions" },
  SQQQ: { d: "Y", note: "Collateral-income distributions" },
  TZA: { d: "Y", note: "Small distributions" },

  // Well-known non-payers
  TSLA: { d: "N" }, AMZN: { d: "N" }, NFLX: { d: "N" }, AMD: { d: "N" },
  BRKB: { d: "N", note: "Berkshire famously pays none" },
  INTC: { d: "N", note: "Suspended 2024" },
  PLTR: { d: "N" }, SNOW: { d: "N" }, CRWD: { d: "N" }, NOW: { d: "N" },
  ADBE: { d: "N" }, UBER: { d: "N" }, COIN: { d: "N" }, HOOD: { d: "N" },
  MSTR: { d: "N" }, GME: { d: "N" }, RIVN: { d: "N" }, ZM: { d: "N" },
  SMCI: { d: "N" }, ARM: { d: "N" }, DKNG: { d: "N" }, HIMS: { d: "N" },
  IREN: { d: "N" }, APP: { d: "N" }, ASTS: { d: "N" }, RKLB: { d: "N" },
  NBIS: { d: "N" }, CRWV: { d: "N" }, ALAB: { d: "N" }, CRDO: { d: "N" },
  CIEN: { d: "N" }, AAOI: { d: "N" }, AXTI: { d: "N" }, BE: { d: "N" },
  FLNC: { d: "N" }, FLEX: { d: "N" }, ONDS: { d: "N" }, USAR: { d: "N" },
  PANW: { d: "N" }, SOFI: { d: "N" }, TTWO: { d: "N" }, COHR: { d: "N" },
  UVXY: { d: "N", note: "No distributions" },
  ZHIPU: { d: "N", note: "Recent HK AI listing" },
  MINIMAX: { d: "N", note: "Recent HK AI listing" },
};

function dividendInfo(base, cat) {
  if (cat === "COMMODITY") return null;
  const rec = DIVIDENDS[base] || { d: "?", note: "Unverified - Binance ticker may be an alias" };
  let url = rec.url;
  if (!url) {
    if (rec.d === "?") url = `https://www.google.com/search?q=${encodeURIComponent(base + " stock dividend history")}`;
    else if (DIV_ETFS.has(base)) url = `https://stockanalysis.com/etf/${base.toLowerCase()}/dividend/`;
    else url = `https://stockanalysis.com/stocks/${base.toLowerCase()}/dividend/`;
  }
  return { d: rec.d, note: rec.note || "", url };
}
