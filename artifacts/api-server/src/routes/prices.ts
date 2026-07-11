import { Router, type IRouter } from "express";
import { db, pricesTable } from "@workspace/db";
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

publicPricesRouter.get("/prices/spot", (_req, res): void => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");

  if (liveSpot) {
    res.json({
      usdPerOz:          liveSpot.usdPerOz,
      aedPerGram:        liveSpot.aedPerGram,        // spread-adjusted base
      baseAedPerGram:    liveSpot.rawAedPerGram,      // raw, unadjusted
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
