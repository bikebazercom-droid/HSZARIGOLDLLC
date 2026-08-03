/**
 * ExternalSync service — Module 2 of the PRD.
 *
 * Pipeline:
 *  1. If `externalSyncEnabled` in DB: fetch and parse the configured URL
 *     (default: https://www.hazarigold.com/) using cheerio.
 *  2. If cheerio parse yields 0 prices (site is client-rendered/dynamic),
 *     fall back to the UniRateAPI key (DB-stored or env var).
 *  3. Store parsed data in memory, broadcast PRICE_MUTATION via Socket.IO.
 *
 * Exported:
 *  - getExternalSyncState()  — current in-memory snapshot
 *  - triggerExternalSync()   — force an immediate poll (called from settings save)
 *  - startExternalSyncLoop() — starts the background polling timer
 */

import * as cheerio from "cheerio";
import { db, companySettingsTable } from "@workspace/db";
import { broadcast } from "../lib/socket.js";
import { logger } from "../lib/logger.js";

const TROY        = 31.1034768;
const AED_PER_USD = 3.6725;
const HALF_SPREAD = 0.45; // synthetic bid/ask spread ≈ $0.90

export interface SyncState {
  // Gold spot (USD / troy oz)
  bidUsd:     number;
  askUsd:     number;
  midUsd:     number;
  dailyHigh:  number;
  dailyLow:   number;
  // Derived AED
  baseAedPerGram: number;
  // Item prices in AED (keyed by canonical name from price_items table)
  itemPrices: Record<string, number>;
  // Meta
  updatedAt:  string | null;
  lastUtcDay: number;
  source:     "hazarigold.com" | "UniRateAPI" | "none";
  error:      string | null;
}

const state: SyncState = {
  bidUsd:        0,
  askUsd:        0,
  midUsd:        0,
  dailyHigh:     0,
  dailyLow:      Infinity,
  baseAedPerGram:0,
  itemPrices:    {},
  updatedAt:     null,
  lastUtcDay:    new Date().getUTCDate(),
  source:        "none",
  error:         null,
};

export function getExternalSyncState(): Readonly<SyncState> {
  return state;
}

// ── Cheerio scraper for hazarigold.com ──────────────────────────────────────
// The site is a Next.js app with client-rendered prices. Static scrape will
// usually return 0.00, so this is best-effort and we fall back to UniRateAPI.
async function scrapeUrl(url: string): Promise<{
  bidUsd: number; askUsd: number; highUsd: number; lowUsd: number;
  items: Record<string, number>;
} | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // ── Strategy 1: try to parse any embedded __NEXT_DATA__ JSON ──────────
    let nextData: any = null;
    try {
      const raw = $("#__NEXT_DATA__").html() || $("script[id='__NEXT_DATA__']").html();
      if (raw) nextData = JSON.parse(raw);
    } catch {}

    // ── Strategy 2: text-based price extraction from rendered HTML ─────────
    // hazarigold.com DOM (from screenshot analysis):
    // - Gold Spot section: "ASK PRICE (oz)" / "BID PRICE (oz)" boxes
    // - Items table rows with "TEN TOLA BAR", "JEWELLERY 22K", etc.
    const extractNum = (text: string): number => {
      const m = text.match(/[\d,]+\.?\d*/);
      if (!m) return 0;
      return parseFloat(m[0].replace(/,/g, ""));
    };

    // Collect ALL text nodes that look like prices
    const allText = $("body").text();
    const pricePattern = /\b(\d{2,6}\.\d{2})\b/g;
    const allPrices: number[] = [];
    let m;
    while ((m = pricePattern.exec(allText)) !== null) {
      allPrices.push(parseFloat(m[1]));
    }

    // Try specific class/structure selectors
    let bidUsd = 0, askUsd = 0, highUsd = 0, lowUsd = 0;
    const items: Record<string, number> = {};

    // Look for BID/ASK values — typically >= 1000 for gold oz price
    const ozPrices = allPrices.filter(p => p >= 1000 && p <= 10000);

    // Try to find spot prices from text context
    $("*").each((_: number, el: any) => {
      const text = $(el).text().trim().toLowerCase();
      const parent = $(el).parent().text().trim();

      if ((text.includes("bid") || parent.toLowerCase().includes("bid")) && !bidUsd) {
        const n = extractNum($(el).text());
        if (n >= 1000) bidUsd = n;
      }
      if ((text.includes("ask") || parent.toLowerCase().includes("ask")) && !askUsd) {
        const n = extractNum($(el).text());
        if (n >= 1000) askUsd = n;
      }
      if (text.includes("high") && !highUsd) {
        const n = extractNum($(el).text());
        if (n >= 1000) highUsd = n;
      }
      if (text.includes("low") && !lowUsd) {
        const n = extractNum($(el).text());
        if (n >= 1000) lowUsd = n;
      }

      // AED item prices (100–1,000,000 range)
      if (text.includes("tola") || text.includes("ttb")) {
        const n = extractNum($(el).next().text() || $(el).parent().text());
        if (n >= 10000) items["TEN TOLA BAR"] = n;
      }
      if (text.includes("jewellery") || text.includes("22k")) {
        const n = extractNum($(el).next().text() || $(el).parent().text());
        if (n >= 100) items["JEWELLERY 22K"] = n;
      }
      if (text.includes("9999") && text.includes("1gm")) {
        const n = extractNum($(el).next().text() || $(el).parent().text());
        if (n >= 100) items["GOLD 9999 1GM"] = n;
      }
      if (text.includes("9999") && text.includes("1kg")) {
        const n = extractNum($(el).next().text() || $(el).parent().text());
        if (n >= 100000) items["GOLD 9999 1KG"] = n;
      }
      if (text.includes("kilo") || text.includes("995")) {
        const n = extractNum($(el).next().text() || $(el).parent().text());
        if (n >= 100000) items["KILO BAR 995"] = n;
      }
    });

    // If ozPrices exist and bid/ask still 0, guess from them
    if (!bidUsd && ozPrices.length >= 2) {
      bidUsd = ozPrices[0];
      askUsd = ozPrices[1];
    }

    // Check nextData for embedded prices
    if (nextData) {
      const str = JSON.stringify(nextData);
      const nums = (str.match(/:\s*(\d{4,5}\.\d{2})/g) || []).map((x: string) => parseFloat(x.replace(/:\s*/, "")));
      if (nums.length > 0 && !bidUsd) {
        const candidates = nums.filter((n: number) => n >= 1000 && n <= 9999);
        if (candidates.length >= 2) { bidUsd = candidates[0]; askUsd = candidates[1]; }
      }
    }

    const allZero = bidUsd === 0 && askUsd === 0;
    if (allZero) return null; // client-rendered — trigger fallback

    return { bidUsd, askUsd, highUsd, lowUsd, items };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[ExternalSync] Scrape failed");
    return null;
  }
}

// ── UniRateAPI fallback ──────────────────────────────────────────────────────
async function fetchUniRateApi(apiKey: string): Promise<{ mid: number } | null> {
  try {
    const url = `https://api.unirateapi.com/api/rates?api_key=${apiKey}&symbols=XAUT`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Record<string, any>;
    const rates: Record<string, number> = data?.rates ?? data?.data ?? {};
    const rawRate = rates.XAU ?? rates.XAUT;
    if (!rawRate || rawRate <= 0) return null;
    return { mid: 1 / rawRate };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "[ExternalSync] UniRateAPI fallback failed");
    return null;
  }
}

// ── Core tick ─────────────────────────────────────────────────────────────────
export async function doSyncTick(): Promise<void> {
  // Read config from DB
  let cfg: { externalSyncEnabled: boolean; externalSyncUrl: string | null; uniRateApiToken: string | null; uniRateApiEnabled: boolean } | null = null;
  try {
    const [row] = await db.select({
      externalSyncEnabled: companySettingsTable.externalSyncEnabled,
      externalSyncUrl:     companySettingsTable.externalSyncUrl,
      uniRateApiToken:     companySettingsTable.uniRateApiToken,
      uniRateApiEnabled:   companySettingsTable.uniRateApiEnabled,
    }).from(companySettingsTable).limit(1);
    cfg = row ?? null;
  } catch {
    // DB not ready on first tick; use env-only fallback
  }

  const syncEnabled  = cfg?.externalSyncEnabled ?? false;
  const syncUrl      = cfg?.externalSyncUrl ?? "https://www.hazarigold.com/";
  const uniToken     = cfg?.uniRateApiToken ?? process.env.UNIRATE_API_KEY ?? "";
  const uniEnabled   = cfg?.uniRateApiEnabled ?? true;

  let mid = 0;
  let source: SyncState["source"] = "none";

  // ── Step 1: Try scraping the external URL ───────────────────────────────
  if (syncEnabled && syncUrl) {
    const scraped = await scrapeUrl(syncUrl);
    if (scraped && (scraped.bidUsd > 0 || scraped.askUsd > 0)) {
      mid = ((scraped.bidUsd + scraped.askUsd) / 2) || scraped.bidUsd || scraped.askUsd;
      source = "hazarigold.com";

      const today = new Date().getUTCDate();
      if (today !== state.lastUtcDay) { state.dailyHigh = mid; state.dailyLow = mid; state.lastUtcDay = today; }

      state.bidUsd    = scraped.bidUsd  || (mid - HALF_SPREAD);
      state.askUsd    = scraped.askUsd  || (mid + HALF_SPREAD);
      state.dailyHigh = Math.max(state.dailyHigh || 0, scraped.highUsd || mid);
      state.dailyLow  = Math.min(state.dailyLow === Infinity ? mid : state.dailyLow, scraped.lowUsd || mid);
      state.midUsd        = mid;
      state.baseAedPerGram = (mid / TROY) * AED_PER_USD;
      state.itemPrices    = scraped.items;
      state.source        = source;
      state.updatedAt     = new Date().toISOString();
      state.error         = null;

      logger.info(`[ExternalSync] Scraped hazarigold.com successfully — $${mid.toFixed(2)}/oz`);
      broadcast("PRICE_MUTATION", { source: "hazarigold.com", midUsd: mid });
      return;
    }
  }

  // ── Step 2: UniRateAPI fallback ──────────────────────────────────────────
  if (uniEnabled && uniToken) {
    const uni = await fetchUniRateApi(uniToken);
    if (uni) {
      mid    = uni.mid;
      source = "UniRateAPI";

      const today = new Date().getUTCDate();
      if (today !== state.lastUtcDay) { state.dailyHigh = mid; state.dailyLow = mid; state.lastUtcDay = today; }

      state.bidUsd        = mid - HALF_SPREAD;
      state.askUsd        = mid + HALF_SPREAD;
      state.midUsd        = mid;
      state.dailyHigh     = state.dailyHigh === 0 ? mid : Math.max(state.dailyHigh, mid);
      state.dailyLow      = state.dailyLow === Infinity ? mid : Math.min(state.dailyLow, mid);
      state.baseAedPerGram = (mid / TROY) * AED_PER_USD;
      state.itemPrices    = {}; // derived by TV route from price_items table
      state.source        = source;
      state.updatedAt     = new Date().toISOString();
      state.error         = null;

      logger.info(`[ExternalSync] UniRateAPI — $${mid.toFixed(2)}/oz`);
      broadcast("PRICE_MUTATION", { source: "UniRateAPI", midUsd: mid });
      return;
    }
  }

  // ── Nothing worked ────────────────────────────────────────────────────────
  state.error = syncEnabled
    ? "Both hazarigold.com and UniRateAPI unavailable"
    : uniToken
      ? "UniRateAPI failed to respond"
      : "No data source configured — add UniRateAPI key or enable External Sync";
  logger.warn(`[ExternalSync] ${state.error}`);
}

// ── Public trigger (settings save → immediate refresh) ─────────────────────
export function triggerExternalSync(): void {
  doSyncTick().catch(() => {});
}

// ── Background polling loop ──────────────────────────────────────────────────
let _timer: ReturnType<typeof setInterval> | null = null;
const DEFAULT_INTERVAL_MS = 5_000; // 5 seconds per PRD

export function startExternalSyncLoop(): void {
  if (_timer) return; // already running
  doSyncTick().catch(() => {}); // immediate first tick
  _timer = setInterval(() => { doSyncTick().catch(() => {}); }, DEFAULT_INTERVAL_MS);
  logger.info("[ExternalSync] Background sync loop started (5s interval)");
}
