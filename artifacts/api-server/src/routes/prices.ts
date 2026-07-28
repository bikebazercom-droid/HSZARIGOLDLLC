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

// ── Yahoo Finance LOW seed ────────────────────────────────────────────────────
// Called once at startup (and at midnight rollover) to seed today's daily LOW
// from Yahoo Finance GC=F (continuous gold futures).
//   • LOW  only: GC=F day-low tracks OTC spot low closely (~$1 off).
//   • HIGH skipped: futures daily-high is inflated by ~$12 vs OTC spot.
// ─────────────────────────────────────────────────────────────────────────────
async function seedLowFromYahoo(): Promise<void> {
  try {
    const url  = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d";
    const resp = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return;
    const meta = ((await resp.json() as any)?.chart?.result?.[0]?.meta) as Record<string, unknown> | undefined;
    const low  = typeof meta?.regularMarketDayLow === "number" ? meta.regularMarketDayLow : null;
    if (!low || low < 500) return;
    const today = todayUTC();
    if (dailyLowUsdPerOz == null || low < dailyLowUsdPerOz) {
      dailyTrackingDateUTC = today;
      dailyLowUsdPerOz     = low;
      saveDailyHL();
      logger.info({ low: low.toFixed(2) }, "[H/L Seed] Daily LOW seeded from Yahoo GC=F (HIGH left for live ticks)");
    }
  } catch (err) {
    logger.warn({ err }, "[H/L Seed] Yahoo seed failed — LOW builds from live ticks");
  }
}

// ── Midnight watchdog ─────────────────────────────────────────────────────────
// Checks every minute; when UTC date flips, resets H/L and re-seeds LOW from
// Yahoo so the new day starts with a reasonable low rather than the first tick.
// ─────────────────────────────────────────────────────────────────────────────
setInterval(async () => {
  const today = todayUTC();
  if (dailyTrackingDateUTC && dailyTrackingDateUTC !== today) {
    dailyTrackingDateUTC = today;
    dailyLowUsdPerOz     = null;
    dailyHighUsdPerOz    = null;
    saveDailyHL();
    logger.info({ date: today }, "[UniRateAPI] Midnight UTC — daily H/L reset for new day");
    await seedLowFromYahoo();
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
const SWISSQUOTE_POLL_MS  = 15_000;

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

let swissquoteFailStreak = 0;

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
      "[UniRateAPI] New tick received and broadcast to TV"
    );

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
// 1. Restore persisted H/L from disk (same day → restores accumulated range)
// 2. Seed today's LOW from Yahoo Finance GC=F (fast, accurate ±$1 vs OTC)
// 3. Fire first Swissquote poll (real bid/ask immediately available)
// 4. Fire first UniRateAPI poll (confirmation + DB write)
// 5. Schedule Swissquote every 15 s (primary fast-tick source)
// 6. Schedule UniRateAPI every 90 s (confirmation + rate-limited DB writes)
// ─────────────────────────────────────────────────────────────────────────────
async function startup(): Promise<void> {
  loadDailyHL();
  await seedLowFromYahoo();          // seed today's LOW before first tick
  await pollSwissquote();            // first real bid/ask tick (~instant)
  await pollUniRate();               // confirmation poll
  setInterval(pollSwissquote, SWISSQUOTE_POLL_MS);   // 15 s fast ticks
  scheduleNextPoll(activePollIntervalMs);             // 90 s confirmation
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
