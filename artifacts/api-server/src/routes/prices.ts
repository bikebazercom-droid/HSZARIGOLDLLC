import { Router, type IRouter } from "express";
import { db, pricesTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse, GetPublicPricesResponse } from "@workspace/api-zod";
import { io as socketIO } from "socket.io-client";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const USD_TO_AED = 3.6725;
const TROY_OUNCE_TO_GRAM = 31.1034768;

// ── Admin-configurable pricing engine controls ────────────────────────────────
// spreadPremiumAed / laborCostPercent are DB-backed (admin edits them from the
// Live Prices page) but the live Socket.IO tick handler needs them synchronously
// on every tick, so we mirror them into memory here and refresh whenever the
// admin saves new values (see PUT/PATCH handlers below) or on server boot.
let adminSpreadPremiumAed = 0;
let adminLaborCostPercent = 0;
let adminPriceFeedSource: "free" | "goldapi" = "free";
let adminLiveApiKey: string | null = null;

async function loadAdminPricingConfig() {
  try {
    const [row] = await db.select().from(pricesTable).limit(1);
    if (row) {
      adminSpreadPremiumAed = Number(row.spreadPremiumAed) || 0;
      adminLaborCostPercent = Number(row.laborCostPercent) || 0;
      adminPriceFeedSource = row.liveApiProvider === "goldapi" ? "goldapi" : "free";
      adminLiveApiKey = row.liveApiKey || null;
    }
  } catch (err) {
    logger.warn({ err }, "[live-gold] Failed to load admin pricing config on boot");
  }
  syncPaidPolling();
}
void loadAdminPricingConfig();

// ── Live Socket.IO feed — livepriceofgold.com ────────────────────────────────
// Connects to the Socket.IO server that powers livepriceofgold.com's Dubai
// price page. The payload includes the raw international Gold Spot (XAU/USD)
// price (`XAUUSD`), which is our source of truth for the pricing engine.
//
// Pricing architecture (international spot market structure):
//   Ask_USD_Price = XAU_USD_Price (mid) + BID_ASK_SPREAD_USD / 2
//   Base_24K_AED  = (Ask_USD_Price / 31.1034768) * 3.6725
//   Final_24K     = Base_24K_AED + admin spreadPremiumAed (Dashboard "Spread" input, +/-)
// `Final_24K` is what the rest of the app calls `aedPerGram` — the single
// atomic baseline every derived row (TT BAR, KG BAR, GOLD 9999, jewelry
// karats) is computed from. Base is derived from ASK, not the raw mid tick,
// because that mirrors the real-world price the shop actually buys/sells at.
// ─────────────────────────────────────────────────────────────────────────────

interface LiveSpot {
  aedPerGram: number;      // Final_24K = Base_24K_AED + spreadPremiumAed
  baseAedPerGram: number;  // Base_24K_AED — derived from the live ASK price, no spread
  usdPerOz: number;        // raw mid-market XAUUSD international spot tick
  bidUsdPerOz: number;     // Live Bid (USD/oz)
  askUsdPerOz: number;     // Live Ask (USD/oz) — pricing-engine source of truth
  dailyLowUsdPerOz: number | null;
  dailyHighUsdPerOz: number | null;
  receivedAt: Date;
}

let liveSpot: LiveSpot | null = null;
let lastDbWriteAt: Date | null = null;

// ── Dual price-feed sources ────────────────────────────────────────────────
// "free": livepriceofgold.com socket only sends one XAUUSD tick per second.
//   Calibration (verified against livepriceofgold.com's own Dubai page):
//     XAUUSD tick IS the Ask price — confirmed by:
//       XAUUSD / 31.1034768 × 3.6725 = livepriceofgold.com Dubai AED/gram (exact)
//     So ASK_OFFSET_USD = 0 (no synthetic adjustment needed).
//     BID = Ask − 0.30 (standard tight interbank gold spot spread).
//   Daily High/Low are tracked in-memory from each XAUUSD tick across the day.
// "goldapi": GoldAPI.io REST feed returns real ask/bid/high_price/low_price —
//   no estimation needed, values are bound straight from the response.
// Which source is active is controlled from the Admin Dashboard
// ("Price Feed Source") and switches instantly — see syncPaidPolling() below.
const ASK_OFFSET_USD = 0;    // XAUUSD tick = Ask (confirmed vs livepriceofgold.com Dubai)
const BID_ASK_SPREAD_USD = 0.30; // Bid = Ask − 0.30 (standard interbank gold spread)

let dailyLowUsdPerOz: number | null = null;
let dailyHighUsdPerOz: number | null = null;
let dailyTrackingDateUTC: string | null = null;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function trackDailyRange(usdPerOz: number) {
  const today = todayUTC();
  if (dailyTrackingDateUTC !== today) {
    // Day rolled over (or first tick) — reset the range.
    dailyTrackingDateUTC = today;
    dailyLowUsdPerOz = usdPerOz;
    dailyHighUsdPerOz = usdPerOz;
    return;
  }
  if (dailyLowUsdPerOz == null || usdPerOz < dailyLowUsdPerOz) dailyLowUsdPerOz = usdPerOz;
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
  // Mark live in DB immediately on (re)connect
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

liveSocket.on("update", (raw: string) => {
  try {
    const data = JSON.parse(raw) as Record<string, string | number>;

    // XAUUSD is the raw international Gold Spot price (USD per troy ounce) —
    // the source of truth for our pricing engine's international architecture.
    const usdRaw = parseFloat(String(data["XAUUSD"]));
    // Fallback only: livepriceofgold.com's own pre-converted Dubai retail AED/g,
    // used solely if XAUUSD is ever absent/invalid from this particular tick.
    const aedRawFallback = parseFloat(String(data["GXAUUSD_AED"]));

    let usdPerOz: number;

    if (Number.isFinite(usdRaw) && usdRaw > 1000) {
      usdPerOz = usdRaw;
    } else if (Number.isFinite(aedRawFallback) && aedRawFallback > 300 && aedRawFallback < 800) {
      usdPerOz = (aedRawFallback / USD_TO_AED) * TROY_OUNCE_TO_GRAM;
    } else {
      return;
    }

    // Calibrated Ask/Bid — XAUUSD tick = Ask (verified against livepriceofgold.com
    // Dubai display: XAUUSD / 31.1034768 × 3.6725 = their published AED/gram exactly).
    //   Ask = XAUUSD (no offset)
    //   Bid = Ask − 0.30 (standard interbank gold spot spread)
    const askUsdPerOz = usdPerOz + ASK_OFFSET_USD;
    const bidUsdPerOz = askUsdPerOz - BID_ASK_SPREAD_USD;

    // Base AED/gram derived directly from Ask (= XAUUSD tick).
    //   Verified: XAUUSD / 31.1034768 × 3.6725 = livepriceofgold.com Dubai AED/gram (±1¢).
    //   Base_24K_AED = (XAUUSD / 31.1034768) × 3.6725
    //   Final_24K    = Base_24K_AED + admin spreadPremiumAed
    const baseAedPerGram = (askUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
    const aedPerGram = baseAedPerGram + adminSpreadPremiumAed;

    trackDailyRange(usdPerOz);
    liveSpot = {
      aedPerGram, baseAedPerGram, usdPerOz, bidUsdPerOz, askUsdPerOz,
      dailyLowUsdPerOz, dailyHighUsdPerOz, receivedAt: new Date(),
    };

    // Write to DB at most once every 5 minutes so the admin page stays current.
    const now = Date.now();
    if (!lastDbWriteAt || now - lastDbWriteAt.getTime() > 5 * 60 * 1000) {
      lastDbWriteAt = new Date();
      db.update(pricesTable)
        .set({
          goldBullionRate: String(aedPerGram),
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

// ── Paid feed (GoldAPI.io) ───────────────────────────────────────────────────
// Only active when the admin sets Price Feed Source = "Paid Premium API" and
// saves a valid API key. Polls every 30s (GoldAPI.io plans are metered by
// monthly request quota, so we deliberately poll far less often than the 1s
// /prices/spot client refresh — the frontend still gets a fresh tick every
// second, just re-serving the latest cached poll in between); returns real
// ask/bid/high/low straight from the provider — no estimation. Falls back to
// the free feed automatically (see /prices/spot below) if the paid fetch has
// never succeeded; once it has succeeded at least once, transient failures
// (e.g. a momentary quota/network blip) keep serving the last-known-good paid
// tick with `paidFeedError` surfaced for transparency, rather than flapping
// back and forth between sources on every failed poll.
let paidLiveSpot: LiveSpot | null = null;
let paidFeedError: string | null = null;
let paidPollTimer: ReturnType<typeof setInterval> | null = null;

async function fetchPaidGoldPrice(apiKey: string) {
  try {
    const resp = await fetch("https://www.goldapi.io/api/XAU/USD", {
      headers: { "x-access-token": apiKey, "Content-Type": "application/json" },
    });
    if (!resp.ok) {
      paidFeedError = `GoldAPI.io returned HTTP ${resp.status}`;
      logger.warn({ status: resp.status }, "[live-gold] Paid feed request failed");
      return;
    }
    const data = (await resp.json()) as Record<string, number>;
    const askUsdPerOz = Number(data.ask);
    const bidUsdPerOz = Number(data.bid);
    const usdPerOz = Number(data.price);
    const lowUsdPerOz = Number(data.low_price);
    const highUsdPerOz = Number(data.high_price);
    if (!Number.isFinite(askUsdPerOz) || !Number.isFinite(bidUsdPerOz) || !Number.isFinite(usdPerOz)) {
      paidFeedError = "GoldAPI.io response missing ask/bid/price fields";
      return;
    }

    // Same Ask-based pricing engine, but the Ask/Bid/High/Low are the
    // provider's real numbers — nothing synthesized.
    const baseAedPerGram = (askUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
    const aedPerGram = baseAedPerGram + adminSpreadPremiumAed;

    paidLiveSpot = {
      aedPerGram, baseAedPerGram, usdPerOz, bidUsdPerOz, askUsdPerOz,
      dailyLowUsdPerOz: Number.isFinite(lowUsdPerOz) ? lowUsdPerOz : null,
      dailyHighUsdPerOz: Number.isFinite(highUsdPerOz) ? highUsdPerOz : null,
      receivedAt: new Date(),
    };
    paidFeedError = null;

    db.update(pricesTable)
      .set({
        liveGoldBid: String(bidUsdPerOz),
        liveGoldAsk: String(askUsdPerOz),
        liveGoldHigh: Number.isFinite(highUsdPerOz) ? String(highUsdPerOz) : null,
        liveGoldLow: Number.isFinite(lowUsdPerOz) ? String(lowUsdPerOz) : null,
        liveLastSyncedAt: new Date(),
        liveModeConnected: true,
      })
      .catch((err: unknown) => logger.warn({ err }, "[live-gold] Paid feed DB write failed"));
  } catch (err) {
    paidFeedError = err instanceof Error ? err.message : "Paid feed fetch failed";
    logger.warn({ err }, "[live-gold] Paid feed fetch error");
  }
}

// Starts/stops the 1s paid-feed poller to match the currently saved admin
// config. Called on boot and every time the admin saves Price Feed Source /
// API Key from the dashboard — the switch takes effect within one tick.
function syncPaidPolling() {
  if (paidPollTimer) {
    clearInterval(paidPollTimer);
    paidPollTimer = null;
  }
  if (adminPriceFeedSource === "goldapi" && adminLiveApiKey) {
    const apiKey = adminLiveApiKey;
    void fetchPaidGoldPrice(apiKey);
    paidPollTimer = setInterval(() => void fetchPaidGoldPrice(apiKey), 30_000);
  } else {
    paidLiveSpot = null;
    paidFeedError = adminPriceFeedSource === "goldapi" ? "No API key configured" : null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toNum(v: string | number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function maskApiKey(key: string): string {
  if (key.length <= 4) return "•".repeat(key.length);
  return "•".repeat(key.length - 4) + key.slice(-4);
}

function parsePrices(p: typeof pricesTable.$inferSelect) {
  let customDescriptions: { name: string; rate: number }[] = [];
  try {
    customDescriptions = JSON.parse(p.customDescriptions || "[]");
  } catch {}
  return {
    ...p,
    goldPricePerGram: Number(p.goldPricePerGram),
    silverPricePerGram: Number(p.silverPricePerGram),
    goldJewelryRate: Number(p.goldJewelryRate),
    goldBullionRate: Number(p.goldBullionRate),
    ttBarRate: Number(p.ttBarRate),
    ttBar24kRate: Number(p.ttBar24kRate),
    kgBarRate: Number(p.kgBarRate),
    gold22kRate: Number(p.gold22kRate),
    gold21kRate: Number(p.gold21kRate),
    gold18kRate: Number(p.gold18kRate),
    gold9999Rate: Number(p.gold9999Rate),
    goldKg9999Rate: Number(p.goldKg9999Rate),
    spreadPremiumAed: Number(p.spreadPremiumAed),
    laborCostPercent: Number(p.laborCostPercent),
    customDescriptions,
    updatedAt: p.updatedAt.toISOString(),
    liveModeConnected: p.liveModeConnected,
    liveApiKeyConfigured: !!p.liveApiKey,
    liveApiKeyMasked: p.liveApiKey ? maskApiKey(p.liveApiKey) : null,
    liveApiProvider: p.liveApiProvider === "goldapi" ? "goldapi" as const : "free" as const,
    liveGoldRate24k: toNum(p.liveGoldRate24k),
    liveGoldRate22k: toNum(p.liveGoldRate22k),
    liveSilverRate: toNum(p.liveSilverRate),
    liveGoldBid: toNum(p.liveGoldBid),
    liveGoldAsk: toNum(p.liveGoldAsk),
    liveGoldHigh: toNum(p.liveGoldHigh),
    liveGoldLow: toNum(p.liveGoldLow),
    liveLastSyncedAt: p.liveLastSyncedAt
      ? p.liveLastSyncedAt.toISOString()
      : null,
    tvShowTtBar995: p.tvShowTtBar995,
    tvShowTtBar999: p.tvShowTtBar999,
    tvShowGold9999: p.tvShowGold9999,
    tvShowKgBar995: p.tvShowKgBar995,
    tvShowGold22k:  p.tvShowGold22k,
    tvShowGold21k:  p.tvShowGold21k,
    tvShowGold18k:  p.tvShowGold18k,
    tvShowGoldKg9999: p.tvShowGoldKg9999,
  };
}

async function getOrCreate() {
  let [row] = await db.select().from(pricesTable).limit(1);
  if (!row) {
    [row] = await db.insert(pricesTable).values({}).returning();
  }
  return row;
}

// ── Routes ───────────────────────────────────────────────────────────────────
router.get("/prices", async (_req, res): Promise<void> => {
  const prices = await getOrCreate();
  res.json(GetPricesResponse.parse(parsePrices(prices)));
});

// ── POST /prices/spot/refresh ─────────────────────────────────────────────────
// Admin-only: returns the current live Socket.IO tick.
// With the Socket.IO feed the value is already always fresh — this endpoint
// just surfaces whatever the most recent tick was.
router.post("/prices/spot/refresh", async (_req, res): Promise<void> => {
  if (liveSpot) {
    logger.info({ rate: liveSpot.aedPerGram }, "[live-gold] Spot refresh requested by admin");
    res.json({ aedPerGram: liveSpot.aedPerGram, updatedAt: liveSpot.receivedAt.toISOString(), refreshed: true });
  } else {
    res.status(503).json({ error: "Live feed not yet connected" });
  }
});

// Public, unauthenticated router — mounted before requireAuth so the showroom
// TV board and invoice new-invoice form can poll it without a session.
export const publicPricesRouter: IRouter = Router();

// ── GET /prices/spot ──────────────────────────────────────────────────────────
// No cache — returns the latest Socket.IO tick directly, converted through the
// international spot pricing engine (Base_24K_AED + admin spread = Final_24K).
// Frontend polls every 1 second; each response is the freshest available tick.
publicPricesRouter.get("/prices/spot", (_req, res): void => {
  // Belt-and-suspenders: app-level `app.disable("etag")` already prevents
  // conditional-GET 304s, but explicitly forbid any intermediary/browser
  // caching too — every poll must hit this live in-memory tick, never a
  // stale cached copy.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");

  // Paid feed is authoritative when selected and healthy; otherwise fall back
  // to the free feed automatically (surfacing the error for transparency).
  const usePaid = adminPriceFeedSource === "goldapi" && paidLiveSpot != null;
  const active = usePaid ? paidLiveSpot : liveSpot;

  if (active) {
    res.json({
      usdPerOz: active.usdPerOz,
      aedPerGram: active.aedPerGram,
      baseAedPerGram: active.baseAedPerGram,
      spreadPremiumAed: adminSpreadPremiumAed,
      laborCostPercent: adminLaborCostPercent,
      bidUsdPerOz: active.bidUsdPerOz,
      askUsdPerOz: active.askUsdPerOz,
      dailyLowUsdPerOz: active.dailyLowUsdPerOz,
      dailyHighUsdPerOz: active.dailyHighUsdPerOz,
      updatedAt: active.receivedAt.toISOString(),
      feedSource: usePaid ? "paid" as const : "free" as const,
      paidFeedError: adminPriceFeedSource === "goldapi" ? paidFeedError : null,
    });
    return;
  }
  res.status(503).json({ error: "Live price feed connecting — please wait" });
});

publicPricesRouter.get("/prices/public", async (_req, res): Promise<void> => {
  const prices = await getOrCreate();
  const parsed = parsePrices(prices);
  const usePaid = adminPriceFeedSource === "goldapi" && paidLiveSpot != null;
  const active = usePaid ? paidLiveSpot : liveSpot;
  const goldBullionRate = active?.aedPerGram ?? parsed.goldBullionRate;
  res.json(
    GetPublicPricesResponse.parse({
      goldBullionRate,
      ttBarRate: parsed.ttBarRate,
      ttBar24kRate: parsed.ttBar24kRate,
      kgBarRate: parsed.kgBarRate,
      silverPricePerGram: parsed.silverPricePerGram,
      gold22kRate: parsed.gold22kRate,
      gold21kRate: parsed.gold21kRate,
      gold18kRate: parsed.gold18kRate,
      gold9999Rate: parsed.gold9999Rate,
      goldKg9999Rate: parsed.goldKg9999Rate,
      liveModeConnected: active !== null,
      liveSilverRate: parsed.liveSilverRate,
      liveGoldBid: active?.bidUsdPerOz ?? null,
      liveGoldAsk: active?.askUsdPerOz ?? null,
      liveGoldHigh: active?.dailyHighUsdPerOz ?? null,
      liveGoldLow: active?.dailyLowUsdPerOz ?? null,
      updatedAt: active?.receivedAt.toISOString() ?? parsed.updatedAt,
      tvShowTtBar995: parsed.tvShowTtBar995,
      tvShowTtBar999: parsed.tvShowTtBar999,
      tvShowGold9999: parsed.tvShowGold9999,
      tvShowKgBar995: parsed.tvShowKgBar995,
      tvShowGold22k:  parsed.tvShowGold22k,
      tvShowGold21k:  parsed.tvShowGold21k,
      tvShowGold18k:  parsed.tvShowGold18k,
      tvShowGoldKg9999: parsed.tvShowGoldKg9999,
    }),
  );
});

router.put("/prices", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;

  await getOrCreate();

  const updates: Record<string, string | boolean | Date> = { updatedAt: new Date() };

  const numFields = [
    "goldPricePerGram", "silverPricePerGram", "goldJewelryRate",
    "goldBullionRate", "ttBarRate", "ttBar24kRate", "kgBarRate",
    "gold22kRate", "gold21kRate", "gold18kRate", "gold9999Rate", "goldKg9999Rate",
    "spreadPremiumAed", "laborCostPercent",
  ];
  for (const f of numFields) {
    if (body[f] != null) updates[f] = String(body[f]);
  }

  if (body.customDescriptions != null)
    updates.customDescriptions = JSON.stringify(body.customDescriptions);

  // Boolean fields — handled identically to the PATCH alias
  const boolFields = [
    "manualInvoiceMode",
    "tvShowTtBar995", "tvShowTtBar999", "tvShowGold9999", "tvShowKgBar995",
    "tvShowGold22k", "tvShowGold21k", "tvShowGold18k", "tvShowGoldKg9999",
  ] as const;
  for (const f of boolFields) {
    if (typeof body[f] === "boolean") updates[f] = body[f] as boolean;
  }

  if (body.liveApiProvider === "free" || body.liveApiProvider === "goldapi") {
    updates.liveApiProvider = body.liveApiProvider;
  }
  if (typeof body.liveApiKey === "string" && body.liveApiKey.length > 0) {
    updates.liveApiKey = body.liveApiKey;
  }

  const [updated] = await db.update(pricesTable).set(updates).returning();
  if (updates.spreadPremiumAed != null) adminSpreadPremiumAed = Number(updated.spreadPremiumAed) || 0;
  if (updates.laborCostPercent != null) adminLaborCostPercent = Number(updated.laborCostPercent) || 0;
  if (updates.liveApiProvider != null || updates.liveApiKey != null) {
    adminPriceFeedSource = updated.liveApiProvider === "goldapi" ? "goldapi" : "free";
    adminLiveApiKey = updated.liveApiKey || null;
    syncPaidPolling();
  }
  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
});

// PATCH alias used by the admin UI (generated client sends PATCH)
router.patch("/prices", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  await getOrCreate();

  const updates: Record<string, string | boolean | Date> = {
    updatedAt: new Date(),
  };
  const numFields = [
    "goldPricePerGram", "silverPricePerGram", "goldJewelryRate",
    "goldBullionRate", "ttBarRate", "ttBar24kRate", "kgBarRate",
    "gold22kRate", "gold21kRate", "gold18kRate", "gold9999Rate",
    "spreadPremiumAed", "laborCostPercent",
  ];
  for (const f of numFields) {
    if (body[f] != null) updates[f] = String(body[f]);
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

  if (body.liveApiProvider === "free" || body.liveApiProvider === "goldapi") {
    updates.liveApiProvider = body.liveApiProvider;
  }
  if (typeof body.liveApiKey === "string" && body.liveApiKey.length > 0) {
    updates.liveApiKey = body.liveApiKey;
  }

  const [updated] = await db.update(pricesTable).set(updates).returning();
  if (updates.spreadPremiumAed != null) adminSpreadPremiumAed = Number(updated.spreadPremiumAed) || 0;
  if (updates.laborCostPercent != null) adminLaborCostPercent = Number(updated.laborCostPercent) || 0;
  if (updates.liveApiProvider != null || updates.liveApiKey != null) {
    adminPriceFeedSource = updated.liveApiProvider === "goldapi" ? "goldapi" : "free";
    adminLiveApiKey = updated.liveApiKey || null;
    syncPaidPolling();
  }
  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
});

export default router;
