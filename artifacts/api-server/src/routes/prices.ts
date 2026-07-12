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
let adminSpreadPercent = 0;
let adminLaborPercent  = 0;
let adminConfigLoaded  = false;

async function loadAdminConfig(): Promise<void> {
  if (adminConfigLoaded) return;
  try {
    const [row] = await db.select().from(pricesTable).limit(1);
    if (row) {
      adminSpreadPercent = parseFloat(String(row.spreadPremiumAed)) || 0;
      adminLaborPercent  = parseFloat(String(row.laborCostPercent))  || 0;
    }
    adminConfigLoaded = true;
    logger.info({ adminSpreadPercent, adminLaborPercent }, "[live-gold] Admin config loaded");
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
  reconnectionDelay: 2000,
  reconnectionDelayMax: 6000,
  randomizationFactor: 0.5,
  timeout: 20_000,
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
      .select({ goldApiToken: companySettingsTable.goldApiToken })
      .from(companySettingsTable)
      .limit(1);
    const token = row?.goldApiToken;
    if (!token) return;

    const resp = await fetch("https://www.goldapi.io/api/XAU/USD", {
      headers: { "x-access-token": token, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
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
      : usdPerOz + ASK_OFFSET_USD;
    const bidUsdPerOz = (data.bid && Number.isFinite(data.bid) && data.bid > 500)
      ? data.bid
      : askUsdPerOz - BID_ASK_SPREAD_USD;

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

async function fetchDailyHighLow(): Promise<void> {
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
      if (!resp.ok) { logger.warn({ status: resp.status, url }, "[daily-range] HTTP error"); continue; }
      const data = await resp.json() as YahooChartResponse;
      const meta = data?.chart?.result?.[0]?.meta;
      const high = meta?.regularMarketDayHigh;
      const low  = meta?.regularMarketDayLow;
      if (high && low && Number.isFinite(high) && Number.isFinite(low) && high > 1000 && low > 1000) {
        // Expand running range — never shrink it (live ticks may already be wider)
        if (dailyHighUsdPerOz == null || high > dailyHighUsdPerOz) dailyHighUsdPerOz = high;
        if (dailyLowUsdPerOz  == null || low  < dailyLowUsdPerOz)  dailyLowUsdPerOz  = low;
        // Sync the date guard so trackDailyRange doesn't zero out our seeded values
        dailyTrackingDateUTC = todayUTC();
        logger.info({ high, low }, "[daily-range] Daily H/L seeded from Yahoo Finance GC=F");
        return;
      }
      logger.warn({ meta }, "[daily-range] Unexpected Yahoo Finance shape");
    } catch (err) {
      logger.warn({ err, url }, "[daily-range] fetch failed — trying next endpoint");
    }
  }
  logger.warn("[daily-range] All Yahoo Finance endpoints failed — H/L will track from current session only");
}

// Seed immediately on startup, then refresh every 5 minutes
fetchDailyHighLow();
setInterval(fetchDailyHighLow, 5 * 60 * 1000);

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

    const askUsdPerOz   = usdPerOz + ASK_OFFSET_USD;
    const bidUsdPerOz   = askUsdPerOz - BID_ASK_SPREAD_USD;
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
      spreadPercent:     adminSpreadPercent,
      laborCostPercent:  adminLaborPercent,
      updatedAt:         liveSpot.receivedAt.toISOString(),
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
        aedPerGram:        base,
        baseAedPerGram:    rawBase,
        bidUsdPerOz:       null,
        askUsdPerOz:       null,
        dailyLowUsdPerOz:  null,
        dailyHighUsdPerOz: null,
        spreadPercent:     adminSpreadPercent,
        laborCostPercent:  adminLaborPercent,
        updatedAt:         prices.updatedAt.toISOString(),
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
