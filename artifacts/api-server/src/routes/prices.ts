import { Router, type IRouter } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { db, pricesTable, companySettingsTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse, GetPublicPricesResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";
import { broadcast } from "../lib/socket.js";

const router: IRouter = Router();

const USD_TO_AED         = 3.6725;
const TROY_OUNCE_TO_GRAM = 31.1034768;

// Standard interbank XAU/USD OTC half-spread (USD per oz).
// UniRateAPI returns the mid price only; we derive bid/ask from this constant.
// Real OTC spot spread for XAU/USD is typically $0.80–$1.00; $0.45 → $0.90 full.
const HALF_SPREAD_USD = 0.45;

// ── Polling intervals ─────────────────────────────────────────────────────────
// UniRateAPI paid plan: 1,000 requests/day.
//   Normal interval : 90 s → 960 req/day  (safe, leaves ~40 buffer for triggered polls)
//   Back-off interval: 300 s → engaged when x-ratelimit-remaining < RATE_LIMIT_BACKOFF_THRESHOLD
const POLL_INTERVAL_NORMAL_MS  = 90_000;
const POLL_INTERVAL_BACKOFF_MS = 300_000;
const RATE_LIMIT_BACKOFF_THRESHOLD = 100;   // engage back-off when <100 req remain in the window

// Active poll interval — starts at normal; may be lengthened by adaptive throttle.
let activePollIntervalMs = POLL_INTERVAL_NORMAL_MS;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// ── Admin-configurable spread & labor (loaded from DB, updated via PATCH/PUT) ─
let adminSpreadPercent      = 0;
let adminLaborPercent       = 0;
let adminGold9999Offset     = 0;
let adminJewellery22kOffset = 0;
let adminConfigLoaded       = false;

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
    logger.info(
      { adminSpreadPercent, adminLaborPercent, adminGold9999Offset, adminJewellery22kOffset },
      "[UniRateAPI] Admin config loaded"
    );
  } catch (err) {
    logger.warn({ err }, "[UniRateAPI] Failed to load admin config — using 0,0");
  }
}

loadAdminConfig();

// ── Live spot (updated exclusively by UniRateAPI) ─────────────────────────────
interface LiveSpot {
  rawAedPerGram:     number;
  aedPerGram:        number;
  baseAedPerGram:    number;
  usdPerOz:          number;
  bidUsdPerOz:       number;
  askUsdPerOz:       number;
  dailyLowUsdPerOz:  number | null;
  dailyHighUsdPerOz: number | null;
  receivedAt:        Date;
}

let liveSpot:      LiveSpot | null = null;
let lastDbWriteAt: Date    | null  = null;

// ── Daily high / low tracker — file-backed persistence ───────────────────────
// State is written to daily_hl.json on every update so a server restart within
// the same UTC day restores the accumulated range rather than starting over.
// At UTC midnight the watchdog clears both in-memory state and the file.
//
// H/L is seeded from Yahoo Finance GC=F OHLC on startup so the first tick
// after a restart doesn't collapse High=Low to a single value.
// ─────────────────────────────────────────────────────────────────────────────
const DAILY_HL_FILE = join(process.cwd(), "daily_hl.json");

interface DailyHLState {
  date:    string;          // YYYY-MM-DD UTC
  low:     number | null;
  high:    number | null;
}

let dailyLowUsdPerOz:     number | null = null;
let dailyHighUsdPerOz:    number | null = null;
let dailyTrackingDateUTC: string | null = null;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Persist current H/L state to disk (fire-and-forget, never throws). */
function saveDailyHL(): void {
  try {
    const state: DailyHLState = {
      date: dailyTrackingDateUTC ?? todayUTC(),
      low:  dailyLowUsdPerOz,
      high: dailyHighUsdPerOz,
    };
    writeFileSync(DAILY_HL_FILE, JSON.stringify(state), "utf8");
  } catch { /* non-fatal */ }
}

/** On startup: restore today's H/L from file if date matches, else start fresh. */
function loadDailyHL(): void {
  try {
    if (!existsSync(DAILY_HL_FILE)) return;
    const raw   = readFileSync(DAILY_HL_FILE, "utf8");
    const state = JSON.parse(raw) as DailyHLState;
    if (state.date !== todayUTC()) {
      logger.info({ savedDate: state.date, today: todayUTC() }, "[UniRateAPI] Daily H/L file is from a prior day — starting fresh");
      return;
    }
    dailyTrackingDateUTC = state.date;
    dailyLowUsdPerOz     = typeof state.low  === "number" ? state.low  : null;
    dailyHighUsdPerOz    = typeof state.high === "number" ? state.high : null;
    logger.info(
      { low: dailyLowUsdPerOz, high: dailyHighUsdPerOz },
      "[UniRateAPI] Daily H/L restored from file"
    );
  } catch (err) {
    logger.warn({ err }, "[UniRateAPI] Could not read daily_hl.json — starting fresh");
  }
}

/** Update in-memory H/L from a new tick price and persist to disk. */
function trackDailyRange(usdPerOz: number): void {
  const today = todayUTC();
  if (dailyTrackingDateUTC !== today) {
    // Day rolled over — reset state
    dailyTrackingDateUTC = today;
    dailyLowUsdPerOz     = usdPerOz;
    dailyHighUsdPerOz    = usdPerOz;
    saveDailyHL();
    return;
  }
  let changed = false;
  if (dailyLowUsdPerOz  == null || usdPerOz < dailyLowUsdPerOz)  { dailyLowUsdPerOz  = usdPerOz; changed = true; }
  if (dailyHighUsdPerOz == null || usdPerOz > dailyHighUsdPerOz) { dailyHighUsdPerOz = usdPerOz; changed = true; }
  if (changed) saveDailyHL();
}

// ── H/L Seed — Yahoo GC=F with dynamic basis correction ─────────────────────
//
// Fetches GC=F (gold futures) hourly bars from Yahoo Finance (free, no API key)
// and converts them to OTC spot H/L using a DYNAMIC BASIS correction:
//
//   basis        = GC=F current price − Swissquote OTC mid (calculated at seed time)
//   OTC HIGH     = GC=F bar HIGH − basis
//   OTC LOW      = GC=F bar LOW  − basis
//
// The carry-based futures-spot basis is stable intraday (< ±$2 variation), so
// applying today's current basis to earlier same-day bars is accurate.
//
// Empirical validation (Dubai market, 2026-08-03, post contract-roll):
//   GC=F H=4135.80  L=4102.70  current=4115.2  OTC mid=4061  basis=54.2
//   Estimated OTC H = 4081.60  (Netdania ref 4082.35, Δ $0.75) ✅
//   Estimated OTC L = 4048.50  (Netdania ref 4047.18, Δ $1.32) ✅
//
// BARS FILTERED BY DUBAI DATE (UTC+4) — the gold market day in UAE starts at
// midnight Dubai time (= 20:00 UTC the previous calendar day).
//
// MERGE STRATEGY:
//   HIGH → max(seed, live-ticks)  |  LOW → min(seed, live-ticks)
// ─────────────────────────────────────────────────────────────────────────────
const DUBAI_OFFSET_MS = 4 * 3600 * 1000;   // UTC+4
const GCF_CHART_URL   = "https://query2.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1h&range=2d&includePrePost=true";

/** GC=F hourly bars with dynamic basis correction → OTC spot H/L. No API key needed. */
async function seedHLFromGCF(): Promise<{ high: number | null; low: number | null } | null> {
  if (!liveSpot) return null;
  try {
    const resp = await fetch(GCF_CHART_URL, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal:  AbortSignal.timeout(12_000),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "[H/L GC=F] Yahoo request failed");
      return null;
    }
    const json   = await resp.json() as Record<string, unknown>;
    const result = (json as any)?.chart?.result?.[0];
    const meta   = result?.meta as Record<string, unknown> | undefined;

    const gcfCurrentPrice = typeof meta?.regularMarketPrice === "number"
      ? (meta.regularMarketPrice as number) : NaN;
    if (!Number.isFinite(gcfCurrentPrice) || gcfCurrentPrice < 500) return null;

    const dynamicBasis = gcfCurrentPrice - liveSpot.usdPerOz;
    const dubaiToday   = new Date(Date.now() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
    const tsList = (result?.timestamp ?? []) as number[];
    const qHigh  = (result?.indicators?.quote?.[0]?.high  ?? []) as (number | null)[];
    const qLow   = (result?.indicators?.quote?.[0]?.low   ?? []) as (number | null)[];

    let gcfHigh: number | null = null;
    let gcfLow:  number | null = null;
    for (let i = 0; i < tsList.length; i++) {
      const barDate = new Date(tsList[i] * 1000 + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
      if (barDate !== dubaiToday) continue;
      const h = qHigh[i], l = qLow[i];
      if (h != null && h > 500 && (gcfHigh == null || h > gcfHigh)) gcfHigh = h;
      if (l != null && l > 500 && (gcfLow  == null || l < gcfLow))  gcfLow  = l;
    }
    if (gcfHigh == null && gcfLow == null) {
      logger.warn({ dubaiToday }, "[H/L GC=F] No bars for today's Dubai date");
      return null;
    }

    const high = gcfHigh != null ? gcfHigh - dynamicBasis : null;
    const low  = gcfLow  != null ? gcfLow  - dynamicBasis : null;
    logger.info(
      {
        dubaiToday,
        gcfH: gcfHigh?.toFixed(2), gcfL: gcfLow?.toFixed(2),
        gcfCurrent: gcfCurrentPrice.toFixed(2),
        otcMid: liveSpot.usdPerOz.toFixed(2),
        basis: dynamicBasis.toFixed(2),
        otcH: high?.toFixed(2), otcL: low?.toFixed(2),
      },
      "[H/L GC=F] Dynamic-basis seed (fallback)"
    );
    return { high, low };
  } catch (err) {
    logger.warn({ err }, "[H/L GC=F] Seed failed");
    return null;
  }
}

/** Seed daily H/L from GC=F dynamic basis and merge into running extremes. */
async function seedHL(): Promise<void> {
  const gcf = await seedHLFromGCF();
  if (!gcf) return;

  // Merge: expand daily extremes (never shrink — live ticks may already be
  // more extreme than what the seed sees)
  const today2 = todayUTC();
  let changed = false;
  if (gcf.high != null && gcf.high > 500 && (dailyHighUsdPerOz == null || gcf.high > dailyHighUsdPerOz)) {
    dailyHighUsdPerOz    = gcf.high;
    dailyTrackingDateUTC = today2;
    changed = true;
  }
  if (gcf.low != null && gcf.low > 500 && (dailyLowUsdPerOz == null || gcf.low < dailyLowUsdPerOz)) {
    dailyLowUsdPerOz     = gcf.low;
    dailyTrackingDateUTC = today2;
    changed = true;
  }
  if (changed) {
    saveDailyHL();
    broadcast("PRICE_MUTATION");
  }
}

// ── Midnight watchdog ─────────────────────────────────────────────────────────
// Checks every minute; when UTC date flips, resets H/L then re-seeds from
// GC=F so the new day starts with overnight H/L rather than just the first tick.
// ─────────────────────────────────────────────────────────────────────────────
setInterval(() => {
  const today = todayUTC();
  if (dailyTrackingDateUTC && dailyTrackingDateUTC !== today) {
    dailyTrackingDateUTC = today;
    dailyLowUsdPerOz     = null;
    dailyHighUsdPerOz    = null;
    saveDailyHL();
    logger.info({ date: today }, "[H/L] Midnight UTC — daily H/L reset; re-seeding (GoldAPI → GC=F fallback)");
    seedHL().catch((err: unknown) => logger.warn({ err }, "[H/L] Midnight re-seed failed"));
  }
}, 60_000);

// ── Swissquote — primary fast price source (every 15 s) ──────────────────────
// URL: https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD
// Free, no API key, institutional OTC XAU/USD bid/ask feed.
// Provides real bid/ask directly (no synthetic spread needed).
// Polling every 15 s gives ~5,760 req/day — no rate-limit concern.
// UniRateAPI remains as a slow-poll confirmation source (every 90 s).
// ─────────────────────────────────────────────────────────────────────────────
const SWISSQUOTE_URL      = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD";
const SWISSQUOTE_POLL_MS  = 1_000;   // 1 s — Swissquote returns new tick every ~150 ms, no rate-limit observed

interface SwissquoteProfile {
  spreadProfile: string;
  bidSpread:     number;
  askSpread:     number;
  bid:           number;
  ask:           number;
}
interface SwissquoteEntry {
  topo:                { platform: string; server: string };
  spreadProfilePrices: SwissquoteProfile[];
  ts:                  number;
}

let swissquoteFailStreak   = 0;
let lastSwissquoteTick: Date | null = null;   // tracks last successful Swissquote tick
// UniRateAPI only updates liveSpot when Swissquote has been silent for this long.
// This prevents stale UniRateAPI data (~$4 off) from overwriting accurate live Swissquote prices.
const SWISSQUOTE_STALE_MS = 30_000;

async function pollSwissquote(): Promise<void> {
  try {
    const resp = await fetch(SWISSQUOTE_URL, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal:  AbortSignal.timeout(8_000),
    });
    if (!resp.ok) {
      swissquoteFailStreak++;
      logger.warn({ status: resp.status, streak: swissquoteFailStreak }, "[Swissquote] Request failed");
      return;
    }
    const data = await resp.json() as SwissquoteEntry[];
    const item = Array.isArray(data) ? data[0] : null;
    if (!item?.spreadProfilePrices?.length) {
      swissquoteFailStreak++;
      logger.warn("[Swissquote] Unexpected response shape");
      return;
    }

    // "elite" profile = tightest institutional spread; fall back to first available
    const profile = item.spreadProfilePrices.find(p => p.spreadProfile === "elite")
                 ?? item.spreadProfilePrices[0];
    const bid = profile.bid;
    const ask = profile.ask;
    if (!bid || !ask || bid < 500 || ask < 500 || ask < bid) {
      swissquoteFailStreak++;
      logger.warn({ bid, ask }, "[Swissquote] Price out of range");
      return;
    }

    swissquoteFailStreak = 0;
    lastSwissquoteTick   = new Date();
    const mid = (bid + ask) / 2;

    await loadAdminConfig();
    const rawAedPerGram = (ask / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
    const aedPerGram    = rawAedPerGram * (1 + adminSpreadPercent / 100);

    trackDailyRange(mid);

    liveSpot = {
      rawAedPerGram,
      aedPerGram,
      baseAedPerGram: rawAedPerGram,
      usdPerOz:        mid,
      bidUsdPerOz:     bid,
      askUsdPerOz:     ask,
      dailyLowUsdPerOz,
      dailyHighUsdPerOz,
      receivedAt:      new Date(),
    };

    broadcast("PRICE_MUTATION");

    logger.info(
      {
        bid:       bid.toFixed(2),
        ask:       ask.toFixed(2),
        mid:       mid.toFixed(2),
        aedPerGram: aedPerGram.toFixed(4),
        dailyLow:  dailyLowUsdPerOz?.toFixed(2)  ?? "—",
        dailyHigh: dailyHighUsdPerOz?.toFixed(2) ?? "—",
      },
      "[Swissquote] New tick"
    );
  } catch (err) {
    swissquoteFailStreak++;
    logger.warn({ err, streak: swissquoteFailStreak }, "[Swissquote] Poll failed");
  }
}

// ── UniRateAPI — secondary confirmation source (every 90 s) ──────────────────
// Still polled every 90 s to confirm Swissquote isn't drifting, and to write
// the canonical AED price to the DB for invoice / non-TV use.
// Endpoint: GET https://api.unirateapi.com/api/commodities/rates?api_key=KEY&from=USD&to=XAU
// Response fields used:
//   rate   → USD per troy oz (direct, e.g. 4054.40)  — preferred
//   result → XAU per USD (inverse; fallback: 1/result = USD/oz)
//
// Polling: 90 s (960 req/day) — safely within the 1,000/day paid-plan limit.
// Adaptive back-off: 300 s when x-ratelimit-remaining < 100.
// ─────────────────────────────────────────────────────────────────────────────

interface UniRateResponse {
  base?:   string;
  to?:     string;
  rate?:   number;
  result?: number;
  error?:  string;
}

let uniRateActive = false;

export function setUniRateActive(val: boolean): void {
  uniRateActive = val;
}

// No-op stubs kept for backward-compat with settings.ts imports
export function setGoldApiActive(_val: boolean): void { /* removed — UniRate is sole source */ }
export function triggerGoldApiPoll(): void              { /* removed — UniRate is sole source */ }

// ── Adaptive poll scheduler ────────────────────────────────────────────────────
// We use a self-rescheduling setTimeout (rather than setInterval) so we can
// vary the interval dynamically based on the x-ratelimit-remaining header.
// ─────────────────────────────────────────────────────────────────────────────
function scheduleNextPoll(delayMs: number): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await pollUniRate();
    scheduleNextPoll(activePollIntervalMs);
  }, delayMs);
}

async function pollUniRate(): Promise<void> {
  try {
    const [row] = await db
      .select({
        uniRateApiToken:   companySettingsTable.uniRateApiToken,
        uniRateApiEnabled: companySettingsTable.uniRateApiEnabled,
      })
      .from(companySettingsTable)
      .limit(1);

    const token   = row?.uniRateApiToken ?? process.env.UNIRATE_API_KEY ?? null;
    const enabled = row?.uniRateApiEnabled ?? true;

    if (!enabled) {
      uniRateActive = false;
      logger.info("[UniRateAPI] Polling disabled by admin toggle");
      return;
    }
    if (!token) {
      logger.warn("[UniRateAPI] No API token configured — set token in Settings");
      return;
    }

    const url  = `https://api.unirateapi.com/api/commodities/rates?api_key=${encodeURIComponent(token)}&from=USD&to=XAU`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json" },
      signal:  AbortSignal.timeout(15_000),
    });

    // ── Rate-limit header tracking ─────────────────────────────────────────────
    const remaining = parseInt(resp.headers.get("x-ratelimit-remaining") ?? "", 10);
    const resetEpoch = parseInt(resp.headers.get("x-ratelimit-reset")    ?? "", 10);
    const limit      = parseInt(resp.headers.get("x-ratelimit-limit")    ?? "", 10);
    if (Number.isFinite(remaining) && Number.isFinite(limit)) {
      const resetIn = Number.isFinite(resetEpoch)
        ? Math.round((resetEpoch * 1000 - Date.now()) / 3600_000 * 10) / 10
        : null;
      logger.info(
        { remaining, limit, resetInHours: resetIn },
        "[UniRateAPI] Rate-limit quota"
      );
      // Adaptive back-off: if fewer than RATE_LIMIT_BACKOFF_THRESHOLD requests remain,
      // lengthen the poll interval to conserve quota for the rest of the window.
      if (remaining < RATE_LIMIT_BACKOFF_THRESHOLD) {
        if (activePollIntervalMs !== POLL_INTERVAL_BACKOFF_MS) {
          activePollIntervalMs = POLL_INTERVAL_BACKOFF_MS;
          logger.warn(
            { remaining, newIntervalSeconds: POLL_INTERVAL_BACKOFF_MS / 1000 },
            "[UniRateAPI] Rate-limit low — switching to back-off polling interval"
          );
        }
      } else if (activePollIntervalMs !== POLL_INTERVAL_NORMAL_MS) {
        // Quota has been replenished (new window) — restore normal interval
        activePollIntervalMs = POLL_INTERVAL_NORMAL_MS;
        logger.info(
          { remaining, newIntervalSeconds: POLL_INTERVAL_NORMAL_MS / 1000 },
          "[UniRateAPI] Rate-limit quota restored — resuming normal polling interval"
        );
      }
    }

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        uniRateActive = false;
        logger.warn({ status: resp.status }, "[UniRateAPI] Auth error — check API token in Settings");
      } else {
        logger.warn({ status: resp.status }, "[UniRateAPI] Request failed");
      }
      return;
    }

    const data = await resp.json() as UniRateResponse;

    // Prefer `rate` (direct USD/oz); fall back to 1/result
    const usdPerOz = (data?.rate && Number.isFinite(data.rate) && data.rate > 500)
      ? data.rate
      : (data?.result && Number.isFinite(data.result) && data.result > 0)
        ? 1 / data.result
        : NaN;

    if (!Number.isFinite(usdPerOz) || usdPerOz < 500) {
      logger.warn({ data }, "[UniRateAPI] Unexpected response shape or price out of range");
      return;
    }

    await loadAdminConfig();

    const bidUsdPerOz   = usdPerOz - HALF_SPREAD_USD;
    const askUsdPerOz   = usdPerOz + HALF_SPREAD_USD;
    const rawAedPerGram = (askUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
    const aedPerGram    = rawAedPerGram * (1 + adminSpreadPercent / 100);

    trackDailyRange(usdPerOz);

    // Only overwrite liveSpot when Swissquote has been silent (fallback mode).
    // Swissquote provides accurate real-time OTC institutional bid/ask every 1 s.
    // UniRateAPI can lag by $2–$5 due to caching/batching; overwriting would make
    // item prices wrong for ~1 s every 90 s.  When Swissquote is alive we only
    // use UniRateAPI for H/L tracking and the DB write below.
    const swissquoteStale = !lastSwissquoteTick
      || (Date.now() - lastSwissquoteTick.getTime() > SWISSQUOTE_STALE_MS);

    if (swissquoteStale) {
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
      uniRateActive = true;
      broadcast("PRICE_MUTATION");
      logger.info(
        {
          usdPerOz:   usdPerOz.toFixed(2),
          bid:        bidUsdPerOz.toFixed(2),
          ask:        askUsdPerOz.toFixed(2),
          aedPerGram: aedPerGram.toFixed(4),
          dailyLow:   dailyLowUsdPerOz?.toFixed(2)  ?? "—",
          dailyHigh:  dailyHighUsdPerOz?.toFixed(2) ?? "—",
        },
        "[UniRateAPI] Fallback tick broadcast (Swissquote silent)"
      );
    } else {
      uniRateActive = true;
      logger.info(
        { usdPerOz: usdPerOz.toFixed(2), aedPerGram: aedPerGram.toFixed(4) },
        "[UniRateAPI] Tick received (Swissquote active — display unchanged, H/L+DB only)"
      );
    }

    // Throttle DB writes to once per 5 minutes to avoid excessive churn
    const now = Date.now();
    if (!lastDbWriteAt || now - lastDbWriteAt.getTime() > 5 * 60_000) {
      lastDbWriteAt = new Date();
      db.update(pricesTable)
        .set({
          goldBullionRate:   String(aedPerGram),
          goldPricePerGram:  String(aedPerGram),
          liveModeConnected: true,
          updatedAt:         new Date(),
        })
        .catch((err: unknown) => logger.warn({ err }, "[UniRateAPI] DB write failed"));
    }
  } catch (err) {
    logger.warn({ err }, "[UniRateAPI] Poll failed");
  }
}

// Exported so the settings route can trigger an immediate poll when a new
// token is saved — avoids up to 90 s of "Connecting…" delay on the TV board.
export function triggerUniRatePoll(): void {
  pollUniRate().catch((err: unknown) => logger.warn({ err }, "[UniRateAPI] Triggered poll failed"));
}

// ── Startup sequence ──────────────────────────────────────────────────────────
// 1. Restore today's H/L from disk (date-checked — stale day starts fresh)
// 2. Fire first Swissquote poll → liveSpot now available
// 3. Seed H/L from GC=F dynamic basis (free, no API key needed)
// 4. Fire first UniRateAPI poll (confirmation + DB write)
// 5. Schedule Swissquote every 1 s (primary live-tick source)
// 6. Schedule UniRateAPI every 90 s (confirmation + rate-limited DB writes)
// 7. Periodic H/L refresh every 10 min via GC=F (free/unlimited, no API key)
// ─────────────────────────────────────────────────────────────────────────────
async function startup(): Promise<void> {
  loadDailyHL();
  await pollSwissquote();                            // first real bid/ask tick → liveSpot ready
  await seedHL();                                    // GC=F dynamic basis → OTC H/L
  await pollUniRate();                               // confirmation poll
  setInterval(pollSwissquote, SWISSQUOTE_POLL_MS);  // 1 s fast ticks
  scheduleNextPoll(activePollIntervalMs);            // 90 s confirmation
  // Periodic basis refresh via GC=F only (free/unlimited).
  // GoldAPI.io is NOT called here — reserved for startup & midnight to stay
  // within the 100 req/month free plan limit (~2/day = ~62/month).
  setInterval(
    () => applyHL(seedHLFromGCF()).catch((err: unknown) => logger.warn({ err }, "[H/L Seed] Periodic GC=F re-seed failed")),
    10 * 60_000,
  );
}

/** Apply a seed result (from any source) into the daily H/L, save, and broadcast. */
async function applyHL(promise: Promise<{ high: number | null; low: number | null } | null>): Promise<void> {
  const gcf = await promise;
  if (!gcf) return;
  const today2 = todayUTC();
  let changed = false;
  if (gcf.high != null && gcf.high > 500 && (dailyHighUsdPerOz == null || gcf.high > dailyHighUsdPerOz)) {
    dailyHighUsdPerOz    = gcf.high;
    dailyTrackingDateUTC = today2;
    changed = true;
  }
  if (gcf.low != null && gcf.low > 500 && (dailyLowUsdPerOz == null || gcf.low < dailyLowUsdPerOz)) {
    dailyLowUsdPerOz     = gcf.low;
    dailyTrackingDateUTC = today2;
    changed = true;
  }
  if (changed) { saveDailyHL(); broadcast("PRICE_MUTATION"); }
}

startup().catch((err: unknown) => logger.warn({ err }, "[Startup] Startup sequence failed"));

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
    res.status(503).json({ error: "UniRateAPI not yet polled — check token in Settings" });
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
      spreadPercent:      adminSpreadPercent,
      laborCostPercent:   adminLaborPercent,
      gold9999Offset:     adminGold9999Offset,
      jewellery22kOffset: adminJewellery22kOffset,
      updatedAt:          liveSpot.receivedAt.toISOString(),
    });
    return;
  }

  // ── DB fallback: token not yet configured or first poll pending ───────────────
  // Serve the last-persisted price so the TV board shows a meaningful value
  // rather than "Connecting…" immediately after a cold start.
  try {
    await loadAdminConfig();
    const prices = await getOrCreate();
    const base   = parseFloat(String(prices.goldPricePerGram));
    if (base && base > 50) {
      const rawBase  = adminSpreadPercent > 0 ? base / (1 + adminSpreadPercent / 100) : base;
      const usdPerOz = (rawBase / USD_TO_AED) * TROY_OUNCE_TO_GRAM;
      res.json({
        usdPerOz,
        aedPerGram:        base,
        baseAedPerGram:    rawBase,
        bidUsdPerOz:       null,
        askUsdPerOz:       null,
        dailyLowUsdPerOz:  null,
        dailyHighUsdPerOz: null,
        spreadPercent:      adminSpreadPercent,
        laborCostPercent:   adminLaborPercent,
        gold9999Offset:     adminGold9999Offset,
        jewellery22kOffset: adminJewellery22kOffset,
        updatedAt:          prices.updatedAt.toISOString(),
      });
      return;
    }
  } catch (err) {
    logger.warn({ err }, "[prices/spot] DB fallback failed");
  }

  res.status(503).json({ error: "UniRateAPI connecting — configure token in Settings" });
});

publicPricesRouter.get("/prices/public", async (_req, res): Promise<void> => {
  const prices       = await getOrCreate();
  const parsed       = parsePrices(prices);
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
      liveGoldBid:        liveSpot?.bidUsdPerOz        ?? null,
      liveGoldAsk:        liveSpot?.askUsdPerOz        ?? null,
      liveGoldHigh:       liveSpot?.dailyHighUsdPerOz  ?? null,
      liveGoldLow:        liveSpot?.dailyLowUsdPerOz   ?? null,
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

  if (body.spreadPremiumPercent != null) {
    const v = Number(body.spreadPremiumPercent);
    if (Number.isFinite(v)) {
      updates.spreadPremiumAed = String(v);
      adminSpreadPercent = v;
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
