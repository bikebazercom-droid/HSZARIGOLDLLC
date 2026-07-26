import { Router, type IRouter } from "express";
import { db, pricesTable, companySettingsTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse, GetPublicPricesResponse } from "@workspace/api-zod";
import { io as socketIO } from "socket.io-client";
import { logger } from "../lib/logger.js";
import { broadcast } from "../lib/socket.js";

const router: IRouter = Router();

const USD_TO_AED = 3.6725;
const TROY_OUNCE_TO_GRAM = 31.1034768;

// ── Live Socket.IO feed — livepriceofgold.com ────────────────────────────────
// Connects to the Socket.IO server that powers livepriceofgold.com's Dubai
// price page. The payload includes the raw international Gold Spot (XAU/USD)
// price (`XAUUSD`), which is our source of truth for the pricing engine.
//
// Pricing formula:
//   Ask = XAUUSD tick (no offset — confirmed to ±1¢ vs livepriceofgold.com Dubai)
//   Bid = Ask − 0.30  (standard interbank gold spot spread)
//   Base_24K_AED  = (XAUUSD / 31.1034768) × 3.6725
//   Adjusted_Base = Base_24K_AED × (1 + adminSpreadPercent / 100)
//   Jewelry rows  = Adjusted_Base × purity × (1 + adminLaborPercent / 100)
//   Bar/bullion   = Adjusted_Base × purity
// ─────────────────────────────────────────────────────────────────────────────

const ASK_OFFSET_USD = 0;
const BID_ASK_SPREAD_USD = 0.30;

// ── Admin-configurable spread & labor (loaded from DB, updated via PATCH/PUT) ─
// spreadPremiumAed DB column is reused to store the spread percentage.
let adminSpreadPercent     = 0;
let adminLaborPercent      = 0;
let adminGold9999Offset    = 0;
let adminJewellery22kOffset = 0;
let adminConfigLoaded      = false;

async function loadAdminConfig(): Promise<void> {
  if (adminConfigLoaded) return;
  try {
    const [row] = await db.select().from(pricesTable).limit(1);
    if (row) {
      adminSpreadPercent      = parseFloat(String(row.spreadPremiumAed))    || 0;
      adminLaborPercent       = parseFloat(String(row.laborCostPercent))     || 0;
      adminGold9999Offset     = parseFloat(String(row.gold9999Offset))       || 0;
      adminJewellery22kOffset = parseFloat(String(row.jewellery22kOffset))   || 0;
    }
    adminConfigLoaded = true;
    logger.info({ adminSpreadPercent, adminLaborPercent, adminGold9999Offset, adminJewellery22kOffset }, "[live-gold] Admin config loaded");
  } catch (err) {
    logger.warn({ err }, "[live-gold] Failed to load admin config — using 0,0");
  }
}

// Kick off config load immediately (non-blocking)
loadAdminConfig();

interface LiveSpot {
  rawAedPerGram:  number;  // Base_24K_AED before spread — for reference
  aedPerGram:     number;  // Adjusted_Base = Base_24K_AED × (1 + spread%)
  baseAedPerGram: number;  // alias for rawAedPerGram (kept for compat)
  usdPerOz:       number;
  bidUsdPerOz:    number;
  askUsdPerOz:    number;
  dailyLowUsdPerOz:  number | null;
  dailyHighUsdPerOz: number | null;
  receivedAt:     Date;
}

let liveSpot:   LiveSpot | null = null;
let lastDbWriteAt: Date | null  = null;

// True while a GoldAPI.io token is configured, the last poll succeeded,
// AND the admin has not manually disabled the integration via the toggle.
// When active, the Yahoo Finance fallback must NOT overwrite liveSpot — GoldAPI
// is the authoritative source and Yahoo would introduce stale-price leakage
// during the 15-second window between GoldAPI's 60s poll and Yahoo's 45s
// staleness threshold.
let goldApiActive = false;

// ── Swissquote OTC half-spread (updated every 15 s) ──────────────────────────
// Swissquote's public feed returns the actual interbank XAU/USD bid and ask.
// We store half the spread so every price source (Socket.IO, GoldAPI, Yahoo
// fallback) computes bid/ask from the same calibrated OTC value instead of
// a fixed constant.  Initialised to BID_ASK_SPREAD_USD/2 as a safe fallback
// until the first Swissquote poll resolves.
let sqHalfSpread:  number        = BID_ASK_SPREAD_USD / 2;
let sqMid:         number | null = null;  // Swissquote (bid+ask)/2 — latest mid
let sqLastGoodAt:  number        = 0;     // epoch ms of last successful Swissquote poll

// Called by the settings route the instant the admin flips the toggle OFF so
// the in-memory flag reflects the new state without waiting for the next poll.
export function setGoldApiActive(val: boolean): void {
  goldApiActive = val;
}

let dailyLowUsdPerOz:    number | null = null;
let dailyHighUsdPerOz:   number | null = null;
let dailyTrackingDateUTC: string | null = null;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function trackDailyRange(usdPerOz: number) {
  const today = todayUTC();
  if (dailyTrackingDateUTC !== today) {
    dailyTrackingDateUTC = today;
    dailyLowUsdPerOz  = usdPerOz;
    dailyHighUsdPerOz = usdPerOz;
    return;
  }
  if (dailyLowUsdPerOz  == null || usdPerOz < dailyLowUsdPerOz)  dailyLowUsdPerOz  = usdPerOz;
  if (dailyHighUsdPerOz == null || usdPerOz > dailyHighUsdPerOz) dailyHighUsdPerOz = usdPerOz;
}

const liveSocket = socketIO("https://www.livepriceofgold.com", {
  path: "/sio/p7012/socket.io",
  transports: ["websocket"],
  upgrade: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,          // was 2000 — reconnect faster after drops
  reconnectionDelayMax: 3_000,     // was 6000 — cap at 3 s, not 6 s
  randomizationFactor: 0.3,
  timeout: 10_000,                 // was 20 000 — detect dead connections sooner
});

liveSocket.on("connect", () => {
  logger.info("[live-gold] Socket.IO connected to livepriceofgold.com");
  db.update(pricesTable)
    .set({ liveModeConnected: true, updatedAt: new Date() })
    .catch(() => {});
});

liveSocket.on("disconnect", (reason: string) => {
  logger.warn({ reason }, "[live-gold] Socket.IO disconnected");
});

liveSocket.on("connect_error", (err: Error) => {
  logger.warn({ msg: err.message }, "[live-gold] Socket.IO connection error");
});

// ── GoldAPI.io polling ────────────────────────────────────────────────────────
// When an admin saves a GoldAPI.io token in Settings, this 60-second loop
// reads the token from DB and fetches the live XAU/USD price. The result
// updates the shared `liveSpot` object (same struct as the Socket.IO feed),
// so the /tv board and all admin clients receive the authoritative price.
// Free tier: 1 req/min is enough — we poll every 60 s.
// ─────────────────────────────────────────────────────────────────────────────
interface GoldApiResponse {
  price?:       number;
  ask?:         number;
  bid?:         number;
  low_price?:   number;
  high_price?:  number;
  timestamp?:   number;
}

async function pollGoldApi(): Promise<void> {
  try {
    const [row] = await db
      .select({
        goldApiToken:   companySettingsTable.goldApiToken,
        goldApiEnabled: companySettingsTable.goldApiEnabled,
      })
      .from(companySettingsTable)
      .limit(1);

    const token   = row?.goldApiToken;
    const enabled = row?.goldApiEnabled ?? true;

    // If the admin has turned the toggle OFF, deactivate and skip polling.
    if (!enabled) {
      goldApiActive = false;
      return;
    }
    if (!token) return;

    const resp = await fetch("https://www.goldapi.io/api/XAU/USD", {
      headers: { "x-access-token": token, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      // 401/403 means the token is invalid — deactivate so Yahoo can fill in
      if (resp.status === 401 || resp.status === 403) goldApiActive = false;
      logger.warn({ status: resp.status }, "[goldapi] Request failed");
      return;
    }
    const data = await resp.json() as GoldApiResponse;
    const usdPerOz = data.price;
    if (!usdPerOz || !Number.isFinite(usdPerOz) || usdPerOz < 500) {
      logger.warn({ data }, "[goldapi] Unexpected response shape");
      return;
    }

    await loadAdminConfig();

    // Prefer the real ask/bid from GoldAPI.io; fall back to derived spread
    const askUsdPerOz = (data.ask && Number.isFinite(data.ask) && data.ask > 500)
      ? data.ask
      : usdPerOz + sqHalfSpread;
    const bidUsdPerOz = (data.bid && Number.isFinite(data.bid) && data.bid > 500)
      ? data.bid
      : usdPerOz - sqHalfSpread;

    // Use GoldAPI daily range when provided
    if (data.low_price  && Number.isFinite(data.low_price)  && data.low_price  > 500) {
      if (dailyLowUsdPerOz  == null || data.low_price  < dailyLowUsdPerOz)  dailyLowUsdPerOz  = data.low_price;
    }
    if (data.high_price && Number.isFinite(data.high_price) && data.high_price > 500) {
      if (dailyHighUsdPerOz == null || data.high_price > dailyHighUsdPerOz) dailyHighUsdPerOz = data.high_price;
    }

    const rawAedPerGram = (askUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
    const aedPerGram    = rawAedPerGram * (1 + adminSpreadPercent / 100);

    trackDailyRange(usdPerOz);
    liveSpot = {
      rawAedPerGram,
      aedPerGram,
      baseAedPerGram: rawAedPerGram,
      usdPerOz,
      bidUsdPerOz,
      askUsdPerOz,
      dailyLowUsdPerOz,
      dailyHighUsdPerOz,
      receivedAt: new Date(),
    };

    // Mark GoldAPI as the active source — blocks Yahoo from overwriting liveSpot
    goldApiActive = true;

    logger.info({ usdPerOz, askUsdPerOz, bidUsdPerOz, aedPerGram: aedPerGram.toFixed(4) }, "[goldapi] Price updated");

    // Notify all connected clients (TV board, admin dashboard)
    broadcast("PRICE_MUTATION");

    db.update(pricesTable)
      .set({ goldBullionRate: String(aedPerGram), goldPricePerGram: String(aedPerGram), liveModeConnected: true, updatedAt: new Date() })
      .catch((err: unknown) => logger.warn({ err }, "[goldapi] DB write failed"));
  } catch (err) {
    logger.warn({ err }, "[goldapi] Poll failed");
  }
}

// Start polling immediately, then every 60 seconds
pollGoldApi();
setInterval(pollGoldApi, 60_000);

// Exported so the settings route can trigger an immediate poll when a new
// GoldAPI token is saved — avoids up to 60 s of "Connecting…" on the TV.
export function triggerGoldApiPoll(): void {
  pollGoldApi().catch((err: unknown) => logger.warn({ err }, "[goldapi] Triggered poll failed"));
}

// ── Daily high/low from Yahoo Finance (GC=F) ─────────────────────────────────
// The livepriceofgold.com socket feed sends only the current price — no daily
// range. We fetch GC=F from Yahoo Finance on startup and every 5 minutes so
// the TV board always shows today's true session high/low, not just the
// narrow window observed since the server last started.
// ─────────────────────────────────────────────────────────────────────────────
interface YahooChartMeta {
  regularMarketDayHigh?: number;
  regularMarketDayLow?:  number;
  regularMarketPrice?:   number;
}
interface YahooChartResponse {
  chart?: { result?: Array<{ meta?: YahooChartMeta }> };
}

// Yahoo Finance v8 chart requires a browser-like User-Agent (v7/quote now returns 401)
const YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// LIVE_SPOT_STALE_MS: how long to wait for the Socket.IO feed before falling
// back to Yahoo Finance. Socket.IO ticks every few seconds when connected;
// 45 s of silence means the feed is down and we should use Yahoo.
const LIVE_SPOT_STALE_MS = 45_000;

async function fetchYahooFinance(): Promise<void> {
  const endpoints = [
    "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d",
    "https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d",
  ];
  for (const url of endpoints) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": YAHOO_UA, "Accept": "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) { logger.warn({ status: resp.status, url }, "[yahoo] HTTP error"); continue; }
      const data = await resp.json() as YahooChartResponse;
      const meta  = data?.chart?.result?.[0]?.meta;
      const high  = meta?.regularMarketDayHigh;
      const low   = meta?.regularMarketDayLow;
      const price = meta?.regularMarketPrice;

      // ── Daily H/L (startup seed only) ────────────────────────────────────────
      // GC=F is COMEX gold futures, not OTC spot — its daily range will deviate
      // from what interbank quote boards (e.g. NetDania) show.  We therefore
      // use Yahoo's H/L ONLY to seed the values on cold start or day rollover
      // (i.e. when live spot tracking hasn't yet established today's range).
      // Once trackDailyRange() has run at least once for today, spot ticks own
      // the H/L and we must NOT let futures data override them.
      if (high && low && Number.isFinite(high) && Number.isFinite(low) && high > 1000 && low > 1000) {
        const today = todayUTC();
        if (dailyTrackingDateUTC !== today) {
          dailyHighUsdPerOz    = high;
          dailyLowUsdPerOz     = low;
          dailyTrackingDateUTC = today;
          logger.info({ high, low }, "[yahoo] GC=F H/L seeded (startup/day-rollover)");
        } else {
          logger.info({ high, low }, "[yahoo] GC=F H/L skipped — live spot tracking active");
        }
      }

      // ── Live spot fallback ─────────────────────────────────────────────────────
      // Use Yahoo's regularMarketPrice when Socket.IO is silent (stale or null).
      // Socket.IO ticks are always preferred — Yahoo is only the safety net.
      // NEVER overwrite liveSpot when GoldAPI is the active source: it polls
      // every 60 s and Yahoo would clobber its price in the 45–60 s window.
      if (price && Number.isFinite(price) && price > 1000 && !goldApiActive) {
        const isStale = !liveSpot || (Date.now() - liveSpot.receivedAt.getTime() > LIVE_SPOT_STALE_MS);
        if (isStale) {
          await loadAdminConfig();
          const askUsdPerOz   = price + sqHalfSpread;
          const bidUsdPerOz   = price - sqHalfSpread;
          const rawAedPerGram = (askUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
          const aedPerGram    = rawAedPerGram * (1 + adminSpreadPercent / 100);
          trackDailyRange(price);
          liveSpot = {
            rawAedPerGram,
            aedPerGram,
            baseAedPerGram: rawAedPerGram,
            usdPerOz:       price,
            bidUsdPerOz,
            askUsdPerOz,
            dailyLowUsdPerOz,
            dailyHighUsdPerOz,
            receivedAt: new Date(),
          };
          logger.info({ usdPerOz: price, aedPerGram: aedPerGram.toFixed(4) }, "[yahoo] liveSpot refreshed (Socket.IO fallback)");
          broadcast("PRICE_MUTATION");
        }
      }
      return;
    } catch (err) {
      logger.warn({ err, url }, "[yahoo] fetch failed — trying next endpoint");
    }
  }
  logger.warn("[yahoo] All Yahoo Finance endpoints failed");
}

// Fetch immediately on startup, then every 30 s.
// — When Socket.IO is live: only the H/L fields are updated (liveSpot.receivedAt is fresh).
// — When Socket.IO is silent: liveSpot is refreshed from Yahoo's regularMarketPrice.
fetchYahooFinance();
setInterval(fetchYahooFinance, 30_000);

// ── UniRate API polling ────────────────────────────────────────────────────────
// UniRateAPI (unirateapi.com) provides LBMA-blended XAU/USD spot prices,
// refreshed every 15 minutes during market hours. We poll every 15 minutes and
// use the result as an additional fallback when both Socket.IO and GoldAPI are
// unavailable. The API key is read from the UNIRATE_API_KEY environment variable.
//
// Endpoint: GET https://api.unirateapi.com/api/commodities/rates?api_key=KEY&from=USD&to=XAU
// Response: { "base": "USD", "rates": { "XAU": <oz_per_usd> }, ... }
// Conversion: usdPerOz = 1 / rates.XAU
// ─────────────────────────────────────────────────────────────────────────────

interface UniRateResponse {
  base?: string;
  to?: string;
  // Actual response shape: { amount, base, to, rate, result }
  // rate   = USD per troy ounce (direct price, e.g. 4054.40)
  // result = XAU per USD        (inverse,      e.g. 0.000246)
  rate?:   number;
  result?: number;
  error?:  string;
}

async function pollUniRate(): Promise<void> {
  const apiKey = process.env.UNIRATE_API_KEY;
  if (!apiKey) return; // Not configured — skip silently

  try {
    const url = `https://api.unirateapi.com/api/commodities/rates?api_key=${encodeURIComponent(apiKey)}&from=USD&to=XAU`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status }, "[unirate] Request failed");
      return;
    }

    const data = await resp.json() as UniRateResponse;

    // Prefer `rate` (direct USD/oz); fall back to 1/result if rate is missing
    const usdPerOz = (data?.rate && Number.isFinite(data.rate) && data.rate > 500)
      ? data.rate
      : (data?.result && Number.isFinite(data.result) && data.result > 0)
        ? 1 / data.result
        : NaN;

    if (!Number.isFinite(usdPerOz) || usdPerOz < 500) {
      logger.warn({ data }, "[unirate] Unexpected response shape or price out of range");
      return;
    }

    if (!Number.isFinite(usdPerOz) || usdPerOz < 500) {
      logger.warn({ usdPerOz }, "[unirate] Price out of expected range");
      return;
    }

    // Only update liveSpot when Socket.IO is stale AND GoldAPI is not active.
    // UniRate refreshes every 15 min so it must never overwrite a fresh real-time feed.
    const isStale = !liveSpot || (Date.now() - liveSpot.receivedAt.getTime() > LIVE_SPOT_STALE_MS);
    if (!isStale || goldApiActive) {
      logger.info({ usdPerOz: usdPerOz.toFixed(2) }, "[unirate] Price fetched (not applied — primary feed is live)");
      return;
    }

    await loadAdminConfig();
    const askUsdPerOz   = usdPerOz + sqHalfSpread;
    const bidUsdPerOz   = usdPerOz - sqHalfSpread;
    const rawAedPerGram = (askUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
    const aedPerGram    = rawAedPerGram * (1 + adminSpreadPercent / 100);

    trackDailyRange(usdPerOz);
    liveSpot = {
      rawAedPerGram,
      aedPerGram,
      baseAedPerGram: rawAedPerGram,
      usdPerOz,
      bidUsdPerOz,
      askUsdPerOz,
      dailyLowUsdPerOz,
      dailyHighUsdPerOz,
      receivedAt: new Date(),
    };

    logger.info(
      { usdPerOz: usdPerOz.toFixed(2), aedPerGram: aedPerGram.toFixed(4) },
      "[unirate] liveSpot updated (Socket.IO stale fallback)"
    );
    broadcast("PRICE_MUTATION");

    db.update(pricesTable)
      .set({ goldBullionRate: String(aedPerGram), goldPricePerGram: String(aedPerGram), updatedAt: new Date() })
      .catch((err: unknown) => logger.warn({ err }, "[unirate] DB write failed"));
  } catch (err) {
    logger.warn({ err }, "[unirate] Poll failed");
  }
}

// Poll immediately on startup, then every 15 minutes (matching UniRate's refresh cadence)
pollUniRate();
setInterval(pollUniRate, 15 * 60_000);

// ── Swissquote OTC bid/ask calibration ────────────────────────────────────────
// Swissquote Bank's public data feed (no auth required) serves actual real-time
// XAU/USD bid and ask from the OTC interbank market — the same source used by
// professional quote boards.  We poll every 15 s and store half the spread so
// all price sources (Socket.IO, GoldAPI fallback, Yahoo fallback) produce bid
// and ask that track the real OTC market spread instead of a fixed constant.
// If any poll fails, sqHalfSpread stays at its last good value (safe fallback).
// ─────────────────────────────────────────────────────────────────────────────
interface SqSpreadProfile { spreadProfile: string; bid: number; ask: number; }
interface SqItem { spreadProfilePrices?: SqSpreadProfile[]; }

async function pollSwissquote(): Promise<void> {
  try {
    const resp = await fetch(
      "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD",
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8_000) }
    );
    if (!resp.ok) return;
    const data = await resp.json() as SqItem[];
    const profiles = data?.[0]?.spreadProfilePrices;
    if (!profiles?.length) return;
    // "prime" = institutional rates; fall back to first available profile
    const p = profiles.find(x => x.spreadProfile === "prime") ?? profiles[0];
    if (!p?.bid || !p?.ask || p.bid < 1_000) return;

    sqHalfSpread = (p.ask - p.bid) / 2;
    sqMid        = (p.bid + p.ask) / 2;
    sqLastGoodAt = Date.now();

    const socketSilentMs = liveSpot
      ? Date.now() - liveSpot.receivedAt.getTime()
      : Infinity;

    // ── Drift guard ──────────────────────────────────────────────────────────
    // While Socket.IO is live, compare its mid against Swissquote's mid.
    // A gap > $3 means the feeds are diverging — flag it so it can be watched.
    // We don't suppress the Socket.IO price at this threshold; short violent
    // moves can span $3+ in seconds and the freshest timestamp wins.
    if (liveSpot && socketSilentMs < 10_000) {
      const drift = Math.abs(liveSpot.usdPerOz - sqMid);
      if (drift > 3) {
        logger.warn(
          { liveMid: liveSpot.usdPerOz.toFixed(2), sqMid: sqMid.toFixed(2), drift: drift.toFixed(2) },
          "[swissquote] Drift detected — livepriceofgold and Swissquote mid diverge >$3"
        );
      }
    }

    // ── Stale-feed takeover ──────────────────────────────────────────────────
    // If Socket.IO has been silent for > 10 s, promote Swissquote to the full
    // price source rather than waiting 45 s for the Yahoo Finance fallback.
    // This cuts the maximum stale-data window on the TV board from ~45 s to
    // at most one Swissquote poll interval (~15 s).
    if (socketSilentMs > 10_000) {
      await loadAdminConfig();
      const mid           = sqMid;
      const askUsdPerOz   = mid + sqHalfSpread;
      const bidUsdPerOz   = mid - sqHalfSpread;
      const rawAedPerGram = (askUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
      const aedPerGram    = rawAedPerGram * (1 + adminSpreadPercent / 100);
      trackDailyRange(mid);
      liveSpot = {
        rawAedPerGram,
        aedPerGram,
        baseAedPerGram: rawAedPerGram,
        usdPerOz:       mid,
        bidUsdPerOz,
        askUsdPerOz,
        dailyLowUsdPerOz,
        dailyHighUsdPerOz,
        receivedAt: new Date(),
      };
      broadcast("PRICE_MUTATION");
      logger.info(
        { mid: mid.toFixed(2), silentMs: Math.round(socketSilentMs) },
        "[swissquote] Stale-feed takeover — Swissquote mid promoted to price source"
      );
      return;
    }

    // Normal path: Socket.IO is fresh — re-calibrate bid/ask on existing spot
    if (liveSpot) {
      liveSpot.bidUsdPerOz = liveSpot.usdPerOz - sqHalfSpread;
      liveSpot.askUsdPerOz = liveSpot.usdPerOz + sqHalfSpread;
      broadcast("PRICE_MUTATION");
    }
    logger.info(
      { bid: p.bid.toFixed(3), ask: p.ask.toFixed(3), halfSpread: sqHalfSpread.toFixed(3) },
      "[swissquote] OTC spread calibrated"
    );
  } catch (err) {
    logger.warn({ err }, "[swissquote] Poll failed — retaining last known spread");
  }
}
pollSwissquote();
setInterval(pollSwissquote, 15_000);

liveSocket.on("update", (raw: string) => {
  try {
    const data = JSON.parse(raw) as Record<string, string | number>;

    const usdRaw         = parseFloat(String(data["XAUUSD"]));
    const aedRawFallback = parseFloat(String(data["GXAUUSD_AED"]));

    let usdPerOz: number;

    if (Number.isFinite(usdRaw) && usdRaw > 1000) {
      usdPerOz = usdRaw;
    } else if (Number.isFinite(aedRawFallback) && aedRawFallback > 300 && aedRawFallback < 800) {
      usdPerOz = (aedRawFallback / USD_TO_AED) * TROY_OUNCE_TO_GRAM;
    } else {
      return;
    }

    // ── Swissquote sanity check ──────────────────────────────────────────────
    // If Swissquote has polled in the last 30 s, compare its mid against this
    // tick.  A gap > $5 is large enough to be suspicious but not large enough
    // to auto-reject (rapid moves can reach $3–4 within seconds).  The warning
    // surfaces feed divergence early so it can be monitored.
    if (sqMid !== null && sqLastGoodAt > 0 && Date.now() - sqLastGoodAt < 30_000) {
      const drift = Math.abs(usdPerOz - sqMid);
      if (drift > 5) {
        logger.warn(
          { tick: usdPerOz.toFixed(2), sqMid: sqMid.toFixed(2), drift: drift.toFixed(2) },
          "[live-gold] Drift warning — Socket.IO tick diverges from Swissquote mid by >$5"
        );
      }
    }

    const askUsdPerOz   = usdPerOz + sqHalfSpread;
    const bidUsdPerOz   = usdPerOz - sqHalfSpread;
    const rawAedPerGram = (askUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED;

    // Apply admin spread: Adjusted_Base = Base_24K_AED × (1 + spread% / 100)
    const aedPerGram = rawAedPerGram * (1 + adminSpreadPercent / 100);

    trackDailyRange(usdPerOz);
    liveSpot = {
      rawAedPerGram,
      aedPerGram,
      baseAedPerGram: rawAedPerGram,
      usdPerOz,
      bidUsdPerOz,
      askUsdPerOz,
      dailyLowUsdPerOz,
      dailyHighUsdPerOz,
      receivedAt: new Date(),
    };

    const now = Date.now();
    if (!lastDbWriteAt || now - lastDbWriteAt.getTime() > 5 * 60 * 1000) {
      lastDbWriteAt = new Date();
      db.update(pricesTable)
        .set({
          goldBullionRate:  String(aedPerGram),
          goldPricePerGram: String(aedPerGram),
          liveModeConnected: true,
          updatedAt: new Date(),
        })
        .catch((err: unknown) => logger.warn({ err }, "[live-gold] DB write failed"));
    }
  } catch (err) {
    logger.warn({ err }, "[live-gold] Failed to parse socket update");
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function toNum(v: string | number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePrices(p: typeof pricesTable.$inferSelect) {
  let customDescriptions: { name: string; rate: number }[] = [];
  try { customDescriptions = JSON.parse(p.customDescriptions || "[]"); } catch {}
  return {
    ...p,
    goldPricePerGram:   Number(p.goldPricePerGram),
    silverPricePerGram: Number(p.silverPricePerGram),
    goldJewelryRate:    Number(p.goldJewelryRate),
    goldBullionRate:    Number(p.goldBullionRate),
    ttBarRate:          Number(p.ttBarRate),
    ttBar24kRate:       Number(p.ttBar24kRate),
    kgBarRate:          Number(p.kgBarRate),
    gold22kRate:        Number(p.gold22kRate),
    gold21kRate:        Number(p.gold21kRate),
    gold18kRate:        Number(p.gold18kRate),
    gold9999Rate:       Number(p.gold9999Rate),
    goldKg9999Rate:     Number(p.goldKg9999Rate),
    spreadPremiumPercent: parseFloat(String(p.spreadPremiumAed)) || 0,
    laborCostPercent:   parseFloat(String(p.laborCostPercent))   || 0,
    gold9999Offset:     parseFloat(String(p.gold9999Offset))     || 0,
    jewellery22kOffset: parseFloat(String(p.jewellery22kOffset)) || 0,
    customDescriptions,
    updatedAt:          p.updatedAt.toISOString(),
    liveModeConnected:  p.liveModeConnected,
    liveGoldRate24k:    toNum(p.liveGoldRate24k),
    liveGoldRate22k:    toNum(p.liveGoldRate22k),
    liveSilverRate:     toNum(p.liveSilverRate),
    liveGoldBid:        toNum(p.liveGoldBid),
    liveGoldAsk:        toNum(p.liveGoldAsk),
    liveGoldHigh:       toNum(p.liveGoldHigh),
    liveGoldLow:        toNum(p.liveGoldLow),
    liveLastSyncedAt:   p.liveLastSyncedAt ? p.liveLastSyncedAt.toISOString() : null,
    tvShowTtBar995:     p.tvShowTtBar995,
    tvShowTtBar999:     p.tvShowTtBar999,
    tvShowGold9999:     p.tvShowGold9999,
    tvShowKgBar995:     p.tvShowKgBar995,
    tvShowGold22k:      p.tvShowGold22k,
    tvShowGold21k:      p.tvShowGold21k,
    tvShowGold18k:      p.tvShowGold18k,
    tvShowGoldKg9999:   p.tvShowGoldKg9999,
  };
}

async function getOrCreate() {
  let [row] = await db.select().from(pricesTable).limit(1);
  if (!row) {
    [row] = await db.insert(pricesTable).values({}).returning();
  }
  return row;
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.get("/prices", async (_req, res): Promise<void> => {
  const prices = await getOrCreate();
  res.json(GetPricesResponse.parse(parsePrices(prices)));
});

router.post("/prices/spot/refresh", async (_req, res): Promise<void> => {
  if (liveSpot) {
    res.json({ aedPerGram: liveSpot.aedPerGram, updatedAt: liveSpot.receivedAt.toISOString(), refreshed: true });
  } else {
    res.status(503).json({ error: "Live feed not yet connected" });
  }
});

// ── Public router (mounted before requireAuth) ────────────────────────────────
export const publicPricesRouter: IRouter = Router();

publicPricesRouter.get("/prices/spot", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");

  if (liveSpot) {
    res.json({
      usdPerOz:          liveSpot.usdPerOz,
      aedPerGram:        liveSpot.aedPerGram,
      baseAedPerGram:    liveSpot.rawAedPerGram,
      bidUsdPerOz:       liveSpot.bidUsdPerOz,
      askUsdPerOz:       liveSpot.askUsdPerOz,
      dailyLowUsdPerOz:  liveSpot.dailyLowUsdPerOz,
      dailyHighUsdPerOz: liveSpot.dailyHighUsdPerOz,
      spreadPercent:       adminSpreadPercent,
      laborCostPercent:    adminLaborPercent,
      gold9999Offset:      adminGold9999Offset,
      jewellery22kOffset:  adminJewellery22kOffset,
      updatedAt:           liveSpot.receivedAt.toISOString(),
    });
    return;
  }

  // ── DB fallback: market closed (weekend) or feed not yet connected ───────────
  // When the Socket.IO feed is silent and GoldAPI.io has polled at least once,
  // the last-known price is persisted in goldPricePerGram. Serve it so the TV
  // board shows the closing price rather than "Connecting…" with all dashes.
  // bid/ask/high/low are left null — the TV's fmt() renders them as "—".
  try {
    await loadAdminConfig();
    const prices = await getOrCreate();
    const base = parseFloat(String(prices.goldPricePerGram));
    if (base && base > 50) {
      const rawBase  = adminSpreadPercent > 0 ? base / (1 + adminSpreadPercent / 100) : base;
      const usdPerOz = (rawBase / USD_TO_AED) * TROY_OUNCE_TO_GRAM;
      res.json({
        usdPerOz,
        aedPerGram:          base,
        baseAedPerGram:      rawBase,
        bidUsdPerOz:         null,
        askUsdPerOz:         null,
        dailyLowUsdPerOz:    null,
        dailyHighUsdPerOz:   null,
        spreadPercent:       adminSpreadPercent,
        laborCostPercent:    adminLaborPercent,
        gold9999Offset:      adminGold9999Offset,
        jewellery22kOffset:  adminJewellery22kOffset,
        updatedAt:           prices.updatedAt.toISOString(),
      });
      return;
    }
  } catch (err) {
    logger.warn({ err }, "[prices/spot] DB fallback failed");
  }

  res.status(503).json({ error: "Live price feed connecting — please wait" });
});

publicPricesRouter.get("/prices/public", async (_req, res): Promise<void> => {
  const prices = await getOrCreate();
  const parsed = parsePrices(prices);
  const goldBullionRate = liveSpot?.aedPerGram ?? parsed.goldBullionRate;
  res.json(
    GetPublicPricesResponse.parse({
      goldBullionRate,
      ttBarRate:          parsed.ttBarRate,
      ttBar24kRate:       parsed.ttBar24kRate,
      kgBarRate:          parsed.kgBarRate,
      silverPricePerGram: parsed.silverPricePerGram,
      gold22kRate:        parsed.gold22kRate,
      gold21kRate:        parsed.gold21kRate,
      gold18kRate:        parsed.gold18kRate,
      gold9999Rate:       parsed.gold9999Rate,
      goldKg9999Rate:     parsed.goldKg9999Rate,
      liveModeConnected:  liveSpot !== null,
      liveSilverRate:     parsed.liveSilverRate,
      liveGoldBid:        liveSpot?.bidUsdPerOz   ?? null,
      liveGoldAsk:        liveSpot?.askUsdPerOz   ?? null,
      liveGoldHigh:       liveSpot?.dailyHighUsdPerOz ?? null,
      liveGoldLow:        liveSpot?.dailyLowUsdPerOz  ?? null,
      updatedAt:          liveSpot?.receivedAt.toISOString() ?? parsed.updatedAt,
      tvShowTtBar995:   parsed.tvShowTtBar995,
      tvShowTtBar999:   parsed.tvShowTtBar999,
      tvShowGold9999:   parsed.tvShowGold9999,
      tvShowKgBar995:   parsed.tvShowKgBar995,
      tvShowGold22k:    parsed.tvShowGold22k,
      tvShowGold21k:    parsed.tvShowGold21k,
      tvShowGold18k:    parsed.tvShowGold18k,
      tvShowGoldKg9999: parsed.tvShowGoldKg9999,
    }),
  );
});

// ── Shared update logic ───────────────────────────────────────────────────────
async function applyUpdates(body: Record<string, unknown>) {
  await getOrCreate();
  const updates: Record<string, string | boolean | Date> = { updatedAt: new Date() };

  const numFields = [
    "goldPricePerGram", "silverPricePerGram", "goldJewelryRate",
    "goldBullionRate", "ttBarRate", "ttBar24kRate", "kgBarRate",
    "gold22kRate", "gold21kRate", "gold18kRate", "gold9999Rate", "goldKg9999Rate",
  ];
  for (const f of numFields) {
    if (body[f] != null) updates[f] = String(body[f]);
  }

  // Admin spread/labor — stored in spreadPremiumAed and laborCostPercent columns
  if (body.spreadPremiumPercent != null) {
    const v = Number(body.spreadPremiumPercent);
    if (Number.isFinite(v)) {
      updates.spreadPremiumAed = String(v);
      adminSpreadPercent = v;
      // Recompute liveSpot with new spread so next poll reflects change immediately
      if (liveSpot) {
        const newAed = liveSpot.rawAedPerGram * (1 + adminSpreadPercent / 100);
        liveSpot = { ...liveSpot, aedPerGram: newAed };
      }
    }
  }
  if (body.laborCostPercent != null) {
    const v = Number(body.laborCostPercent);
    if (Number.isFinite(v)) {
      updates.laborCostPercent = String(v);
      adminLaborPercent = v;
    }
  }
  if (body.gold9999Offset != null) {
    const v = Number(body.gold9999Offset);
    if (Number.isFinite(v)) {
      updates.gold9999Offset = String(v);
      adminGold9999Offset = v;
    }
  }
  if (body.jewellery22kOffset != null) {
    const v = Number(body.jewellery22kOffset);
    if (Number.isFinite(v)) {
      updates.jewellery22kOffset = String(v);
      adminJewellery22kOffset = v;
    }
  }

  if (body.customDescriptions != null)
    updates.customDescriptions = JSON.stringify(body.customDescriptions);

  const boolFields = [
    "manualInvoiceMode",
    "tvShowTtBar995", "tvShowTtBar999", "tvShowGold9999", "tvShowKgBar995",
    "tvShowGold22k", "tvShowGold21k", "tvShowGold18k", "tvShowGoldKg9999",
  ] as const;
  for (const f of boolFields) {
    if (typeof body[f] === "boolean") updates[f] = body[f] as boolean;
  }

  const [updated] = await db.update(pricesTable).set(updates).returning();
  return updated;
}

router.put("/prices", async (req, res): Promise<void> => {
  const updated = await applyUpdates(req.body as Record<string, unknown>);
  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
  broadcast("PRICE_MUTATION");
});

router.patch("/prices", async (req, res): Promise<void> => {
  const updated = await applyUpdates(req.body as Record<string, unknown>);
  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
  broadcast("PRICE_MUTATION");
});

export default router;
