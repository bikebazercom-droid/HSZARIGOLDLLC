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

async function loadAdminPricingConfig() {
  try {
    const [row] = await db.select().from(pricesTable).limit(1);
    if (row) {
      adminSpreadPremiumAed = Number(row.spreadPremiumAed) || 0;
      adminLaborCostPercent = Number(row.laborCostPercent) || 0;
    }
  } catch (err) {
    logger.warn({ err }, "[live-gold] Failed to load admin pricing config on boot");
  }
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
  bidUsdPerOz: number;     // Live Bid (USD/oz), synthesized at tick time
  askUsdPerOz: number;     // Live Ask (USD/oz), synthesized at tick time — pricing-engine source of truth
  receivedAt: Date;
}

let liveSpot: LiveSpot | null = null;
let lastDbWriteAt: Date | null = null;

// ── Bid/Ask + Daily Low/High tracking ─────────────────────────────────────────
// The upstream feed only provides a single mid-market XAUUSD tick — there is no
// native bid/ask spread or daily high/low. We synthesize a realistic Bid/Ask by
// splitting a fixed market spread symmetrically around the raw usdPerOz tick,
// and track the daily low/high by recording the min/max usdPerOz tick observed
// since UTC midnight (in-memory; resets automatically on day rollover).
const BID_ASK_SPREAD_USD = 0.90; // matches typical live spot-gold bid/ask spread width

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

    // Bid/Ask are synthesized symmetrically around the mid-market tick — the
    // upstream feed only exposes a single mid price, no native bid/ask.
    const bidUsdPerOz = usdPerOz - BID_ASK_SPREAD_USD / 2;
    const askUsdPerOz = usdPerOz + BID_ASK_SPREAD_USD / 2;

    // Pricing-engine source of truth per admin spec: the shop buys at the
    // international ASK price, so Base_24K_AED must be derived from Ask —
    // NOT the raw mid tick — to match real-world market execution price.
    //   Final_24K_Base = (Live_International_Ask_Price / 31.1034768) * 3.6725 + Dashboard_Spread_Input
    const baseAedPerGram = (askUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
    const aedPerGram = baseAedPerGram + adminSpreadPremiumAed;

    liveSpot = { aedPerGram, baseAedPerGram, usdPerOz, bidUsdPerOz, askUsdPerOz, receivedAt: new Date() };
    trackDailyRange(usdPerOz);

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

// ── Helpers ──────────────────────────────────────────────────────────────────
function toNum(v: string | number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
    liveApiKeyConfigured: false,
    liveApiKeyMasked: null as null,
    liveApiProvider: "apilayer" as const,
    liveGoldRate24k: toNum(p.liveGoldRate24k),
    liveGoldRate22k: toNum(p.liveGoldRate22k),
    liveSilverRate: toNum(p.liveSilverRate),
    liveGoldBid: null as null,
    liveGoldAsk: null as null,
    liveGoldHigh: null as null,
    liveGoldLow: null as null,
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
  if (liveSpot) {
    res.json({
      usdPerOz: liveSpot.usdPerOz,
      aedPerGram: liveSpot.aedPerGram,
      baseAedPerGram: liveSpot.baseAedPerGram,
      spreadPremiumAed: adminSpreadPremiumAed,
      laborCostPercent: adminLaborCostPercent,
      bidUsdPerOz: liveSpot.bidUsdPerOz,
      askUsdPerOz: liveSpot.askUsdPerOz,
      dailyLowUsdPerOz: dailyLowUsdPerOz,
      dailyHighUsdPerOz: dailyHighUsdPerOz,
      updatedAt: liveSpot.receivedAt.toISOString(),
    });
    return;
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
      ttBarRate: parsed.ttBarRate,
      ttBar24kRate: parsed.ttBar24kRate,
      kgBarRate: parsed.kgBarRate,
      silverPricePerGram: parsed.silverPricePerGram,
      gold22kRate: parsed.gold22kRate,
      gold21kRate: parsed.gold21kRate,
      gold18kRate: parsed.gold18kRate,
      gold9999Rate: parsed.gold9999Rate,
      goldKg9999Rate: parsed.goldKg9999Rate,
      liveModeConnected: liveSpot !== null,
      liveSilverRate: parsed.liveSilverRate,
      liveGoldBid: null,
      liveGoldAsk: null,
      liveGoldHigh: null,
      liveGoldLow: null,
      updatedAt: liveSpot?.receivedAt.toISOString() ?? parsed.updatedAt,
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

  const [updated] = await db.update(pricesTable).set(updates).returning();
  if (updates.spreadPremiumAed != null) adminSpreadPremiumAed = Number(updated.spreadPremiumAed) || 0;
  if (updates.laborCostPercent != null) adminLaborCostPercent = Number(updated.laborCostPercent) || 0;
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

  const [updated] = await db.update(pricesTable).set(updates).returning();
  if (updates.spreadPremiumAed != null) adminSpreadPremiumAed = Number(updated.spreadPremiumAed) || 0;
  if (updates.laborCostPercent != null) adminLaborCostPercent = Number(updated.laborCostPercent) || 0;
  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
});

export default router;
