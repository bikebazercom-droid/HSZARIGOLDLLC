/**
 * ExternalSync — live gold price engine.
 *
 * Source priority (automatic fallback chain):
 *  1. Swissquote public OTC feed  — free, no key, real bid/ask spread, same
 *     source as the deployed server uses
 *  2. hazarigold.com HTML scraper — when externalSyncEnabled = true in DB
 *  3. UniRateAPI (XAUT)           — DB-stored token or UNIRATE_API_KEY env var
 *
 * GoldAPI (GOLDAPI_KEY) is skipped: the free tier has a ~100 req/month quota
 * that a 5-second polling loop drains in minutes.
 *
 * Broadcasts PRICE_MUTATION via Socket.IO every successful tick.
 */

import * as cheerio from "cheerio";
import { db, companySettingsTable } from "@workspace/db";
import { broadcast } from "../lib/socket.js";
import { logger } from "../lib/logger.js";

const TROY        = 31.1034768;   // grams per troy oz
const AED_PER_USD = 3.6725;       // AED fixed peg

export interface SyncState {
  bidUsd:          number;
  askUsd:          number;
  midUsd:          number;
  dailyHigh:       number;
  dailyLow:        number;
  baseAedPerGram:  number;   // 24 K, AED/gram
  aed22k:          number;
  aed21k:          number;
  aed18k:          number;
  itemPrices:      Record<string, number>;
  updatedAt:       string | null;
  lastUtcDay:      number;
  source:          "Swissquote" | "hazarigold.com" | "UniRateAPI" | "none";
  error:           string | null;
}

const state: SyncState = {
  bidUsd:         0,
  askUsd:         0,
  midUsd:         0,
  dailyHigh:      0,
  dailyLow:       Infinity,
  baseAedPerGram: 0,
  aed22k:         0,
  aed21k:         0,
  aed18k:         0,
  itemPrices:     {},
  updatedAt:      null,
  lastUtcDay:     new Date().getUTCDate(),
  source:         "none",
  error:          null,
};

export function getExternalSyncState(): Readonly<SyncState> {
  return state;
}

// ── Daily high / low tracker ───────────────────────────────────────────────────
function trackHighLow(mid: number): void {
  const today = new Date().getUTCDate();
  if (today !== state.lastUtcDay) {
    state.dailyHigh  = mid;
    state.dailyLow   = mid;
    state.lastUtcDay = today;
  } else {
    if (state.dailyHigh === 0 || mid > state.dailyHigh) state.dailyHigh = mid;
    if (state.dailyLow  === Infinity || mid < state.dailyLow)  state.dailyLow  = mid;
  }
}

// ── Derive AED/gram karat rates from base ──────────────────────────────────────
function deriveKarats(baseAedPerGram: number): { aed22k: number; aed21k: number; aed18k: number } {
  return {
    aed22k: +(baseAedPerGram * (22 / 24)).toFixed(4),
    aed21k: +(baseAedPerGram * (21 / 24)).toFixed(4),
    aed18k: +(baseAedPerGram * (18 / 24)).toFixed(4),
  };
}

// ── Source 1: Swissquote public OTC feed ──────────────────────────────────────
// Endpoint is public — no API key required.
// Returns multiple spread profiles per platform; we use the "premium" profile
// from SwissquoteCapitalMarkets as it gives the tightest institutional spread.
interface SQSpreadProfile { spreadProfile: string; bid: number; ask: number; bidSpread: number; askSpread: number; }
interface SQEntry { topo: { platform: string }; spreadProfilePrices: SQSpreadProfile[]; ts: number; }

async function fetchSwissquote(): Promise<{ bid: number; ask: number; mid: number } | null> {
  try {
    const res = await fetch(
      "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!res.ok) {
      logger.warn({ status: res.status }, "[ExternalSync] Swissquote non-200");
      return null;
    }

    const entries: SQEntry[] = await res.json();
    // Pick SwissquoteCapitalMarkets (first entry), prefer "premium" spread profile
    const entry  = entries.find(e => e.topo.platform === "SwissquoteCapitalMarkets") ?? entries[0];
    if (!entry) return null;

    const profile =
      entry.spreadProfilePrices.find(p => p.spreadProfile === "premium") ??
      entry.spreadProfilePrices.find(p => p.spreadProfile === "prime")   ??
      entry.spreadProfilePrices[0];
    if (!profile || !profile.bid || !profile.ask) return null;

    return {
      bid: +profile.bid.toFixed(3),
      ask: +profile.ask.toFixed(3),
      mid: +((profile.bid + profile.ask) / 2).toFixed(3),
    };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[ExternalSync] Swissquote fetch failed");
    return null;
  }
}

// ── Source 2: hazarigold.com HTML scraper ─────────────────────────────────────
// Best-effort — Next.js client-rendered, prices usually 0 in static HTML.
async function scrapeUrl(url: string): Promise<{
  bidUsd: number; askUsd: number; items: Record<string, number>;
} | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
        "Accept": "text/html,*/*",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    let bidUsd = 0, askUsd = 0;
    const items: Record<string, number> = {};

    const extractNum = (t: string) => { const m = t.match(/[\d,]+\.?\d*/); return m ? parseFloat(m[0].replace(/,/g, "")) : 0; };

    $("*").each((_: number, el: any) => {
      const txt = $(el).text().trim().toLowerCase();
      if (!txt || txt.length > 200) return;
      if (txt.includes("bid") && !bidUsd) { const n = extractNum($(el).text()); if (n >= 1000) bidUsd = n; }
      if (txt.includes("ask") && !askUsd) { const n = extractNum($(el).text()); if (n >= 1000) askUsd = n; }
      if (txt.includes("tola") || txt.includes("ttb"))  { const n = extractNum($(el).next().text() || $(el).parent().text()); if (n >= 10000) items["TEN TOLA BAR"] = n; }
      if (txt.includes("jewellery") || txt.includes("22k")) { const n = extractNum($(el).next().text() || $(el).parent().text()); if (n >= 100) items["JEWELLERY 22K"] = n; }
      if (txt.includes("9999") && txt.includes("1gm"))  { const n = extractNum($(el).next().text() || $(el).parent().text()); if (n >= 100) items["GOLD 9999"] = n; }
      if (txt.includes("9999") && txt.includes("1kg"))  { const n = extractNum($(el).next().text() || $(el).parent().text()); if (n >= 100000) items["GOLD 9999 1KG"] = n; }
      if (txt.includes("kilo") || (txt.includes("995") && !txt.includes("9999"))) { const n = extractNum($(el).next().text() || $(el).parent().text()); if (n >= 100000) items["KILO BAR 995"] = n; }
    });

    if (bidUsd === 0 && askUsd === 0) return null;
    return { bidUsd, askUsd, items };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[ExternalSync] Scrape failed");
    return null;
  }
}

// ── Source 3: UniRateAPI (XAUT = Tether Gold ≈ XAU spot) ─────────────────────
async function fetchUniRateApi(apiKey: string): Promise<{ mid: number } | null> {
  try {
    const res = await fetch(
      `https://api.unirateapi.com/api/rates?api_key=${apiKey}&symbols=XAUT`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Record<string, any>;
    const rate = data?.rates?.XAUT ?? data?.rates?.XAU;
    if (!rate || rate <= 0) return null;
    return { mid: +(1 / rate).toFixed(3) };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[ExternalSync] UniRateAPI failed");
    return null;
  }
}

// ── Core tick ─────────────────────────────────────────────────────────────────
export async function doSyncTick(): Promise<void> {
  let cfg: {
    externalSyncEnabled: boolean;
    externalSyncUrl:     string | null;
    uniRateApiToken:     string | null;
    uniRateApiEnabled:   boolean;
  } | null = null;

  try {
    const [row] = await db.select({
      externalSyncEnabled: companySettingsTable.externalSyncEnabled,
      externalSyncUrl:     companySettingsTable.externalSyncUrl,
      uniRateApiToken:     companySettingsTable.uniRateApiToken,
      uniRateApiEnabled:   companySettingsTable.uniRateApiEnabled,
    }).from(companySettingsTable).limit(1);
    cfg = row ?? null;
  } catch { /* DB not ready yet */ }

  const syncEnabled = cfg?.externalSyncEnabled ?? false;
  const syncUrl     = cfg?.externalSyncUrl ?? "https://www.hazarigold.com/";
  const uniToken    = cfg?.uniRateApiToken ?? process.env.UNIRATE_API_KEY ?? "";
  const uniEnabled  = cfg?.uniRateApiEnabled ?? true;

  // ── Step 1: Swissquote OTC (primary, always attempted) ───────────────────
  const sq = await fetchSwissquote();
  if (sq) {
    trackHighLow(sq.mid);
    const baseAed   = +((sq.mid / TROY) * AED_PER_USD).toFixed(4);
    const karats    = deriveKarats(baseAed);

    state.bidUsd         = sq.bid;
    state.askUsd         = sq.ask;
    state.midUsd         = sq.mid;
    state.baseAedPerGram = baseAed;
    Object.assign(state, karats);
    state.itemPrices     = {};
    state.source         = "Swissquote";
    state.updatedAt      = new Date().toISOString();
    state.error          = null;

    logger.info(
      `[ExternalSync] Swissquote ✓  bid=$${sq.bid} ask=$${sq.ask}  ` +
      `H=$${state.dailyHigh} L=$${state.dailyLow}  AED/g=${baseAed}`
    );
    broadcast("PRICE_MUTATION", { source: "Swissquote", bid: sq.bid, ask: sq.ask, baseAedPerGram: baseAed });
    return;
  }

  // ── Step 2: hazarigold.com scraper ───────────────────────────────────────
  if (syncEnabled && syncUrl) {
    const scraped = await scrapeUrl(syncUrl);
    if (scraped && (scraped.bidUsd > 0 || scraped.askUsd > 0)) {
      const mid     = ((scraped.bidUsd + scraped.askUsd) / 2) || scraped.bidUsd || scraped.askUsd;
      trackHighLow(mid);
      const baseAed = +((mid / TROY) * AED_PER_USD).toFixed(4);
      const karats  = deriveKarats(baseAed);

      state.bidUsd         = scraped.bidUsd  || +(mid - 0.45).toFixed(3);
      state.askUsd         = scraped.askUsd  || +(mid + 0.45).toFixed(3);
      state.midUsd         = +mid.toFixed(3);
      state.baseAedPerGram = baseAed;
      Object.assign(state, karats);
      state.itemPrices     = scraped.items;
      state.source         = "hazarigold.com";
      state.updatedAt      = new Date().toISOString();
      state.error          = null;

      logger.info(`[ExternalSync] hazarigold.com ✓  $${mid.toFixed(2)}/oz`);
      broadcast("PRICE_MUTATION", { source: "hazarigold.com", midUsd: mid });
      return;
    }
  }

  // ── Step 3: UniRateAPI fallback ──────────────────────────────────────────
  if (uniEnabled && uniToken) {
    const uni = await fetchUniRateApi(uniToken);
    if (uni) {
      trackHighLow(uni.mid);
      const baseAed = +((uni.mid / TROY) * AED_PER_USD).toFixed(4);
      const karats  = deriveKarats(baseAed);

      state.bidUsd         = +(uni.mid - 0.45).toFixed(3);
      state.askUsd         = +(uni.mid + 0.45).toFixed(3);
      state.midUsd         = uni.mid;
      state.baseAedPerGram = baseAed;
      Object.assign(state, karats);
      state.itemPrices     = {};
      state.source         = "UniRateAPI";
      state.updatedAt      = new Date().toISOString();
      state.error          = null;

      logger.info(`[ExternalSync] UniRateAPI ✓  $${uni.mid.toFixed(2)}/oz`);
      broadcast("PRICE_MUTATION", { source: "UniRateAPI", midUsd: uni.mid });
      return;
    }
  }

  // ── No source worked ─────────────────────────────────────────────────────
  state.error = "All price sources unavailable (Swissquote + UniRateAPI failed)";
  logger.warn("[ExternalSync] " + state.error);
}

// ── Public API ────────────────────────────────────────────────────────────────
export function triggerExternalSync(): void {
  doSyncTick().catch(() => {});
}

let _timer: ReturnType<typeof setInterval> | null = null;
const INTERVAL_MS = 5_000;

export function startExternalSyncLoop(): void {
  if (_timer) return;
  doSyncTick().catch(() => {});
  _timer = setInterval(() => doSyncTick().catch(() => {}), INTERVAL_MS);
  logger.info("[ExternalSync] Sync loop started — Swissquote primary, 5 s interval");
}
