import { Router, type IRouter } from "express";
import { db, pricesTable, companySettingsTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse, GetPublicPricesResponse } from "@workspace/api-zod";

import { logger } from "../lib/logger.js";
import { broadcast } from "../lib/socket.js";

const router: IRouter = Router();

const USD_TO_AED = 3.6725;
const TROY_OUNCE_TO_GRAM = 31.1034768;


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

// ── Startup: seed liveSpot from DB ────────────────────────────────────────────
// The TV board is a live display mirror of hazarigold.com's own backend.
// All external OTC feed integrations have been removed. Prices are stored in
// the database and set by the admin via the settings page. On startup the last
// persisted bid/ask/high/low values are read into memory so the TV board
// immediately reflects the most recent admin-set prices without a page reload.
// When the admin saves new prices via PUT/PATCH /prices the applyUpdates helper
// writes them to DB, patches liveSpot in memory, and broadcasts PRICE_MUTATION
// so every connected TV board refreshes within one WebSocket round-trip.
// ─────────────────────────────────────────────────────────────────────────────
async function loadLiveSpotFromDb(): Promise<void> {
  try {
    await loadAdminConfig();
    const prices = await getOrCreate();
    const bid  = toNum(prices.liveGoldBid);
    const ask  = toNum(prices.liveGoldAsk);
    const high = toNum(prices.liveGoldHigh);
    const low  = toNum(prices.liveGoldLow);

    if (!bid || !ask || bid < 500) {
      logger.info("[prices] No bid/ask in DB yet — TV board shows '—' until admin sets prices");
      return;
    }

    const mid           = (bid + ask) / 2;
    const rawAedPerGram = (ask / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
    const aedPerGram    = rawAedPerGram * (1 + adminSpreadPercent / 100);

    if (high && low && high > 1000 && low > 1000) {
      dailyHighUsdPerOz    = high;
      dailyLowUsdPerOz     = low;
      dailyTrackingDateUTC = todayUTC();
    }

    liveSpot = {
      rawAedPerGram,
      aedPerGram,
      baseAedPerGram: rawAedPerGram,
      usdPerOz:       mid,
      bidUsdPerOz:    bid,
      askUsdPerOz:    ask,
      dailyLowUsdPerOz,
      dailyHighUsdPerOz,
      receivedAt: prices.liveLastSyncedAt ?? prices.updatedAt,
    };

    logger.info(
      { bid: bid.toFixed(2), ask: ask.toFixed(2), high, low },
      "[prices] liveSpot seeded from DB"
    );
  } catch (err) {
    logger.warn({ err }, "[prices] Failed to seed liveSpot from DB on startup");
  }
}

loadLiveSpotFromDb();

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

  // ── Live gold spot (Bid / Ask / High / Low) — set directly by admin ─────────
  const liveFields: Array<{ key: string; col: string }> = [
    { key: "liveGoldBid",  col: "liveGoldBid"  },
    { key: "liveGoldAsk",  col: "liveGoldAsk"  },
    { key: "liveGoldHigh", col: "liveGoldHigh" },
    { key: "liveGoldLow",  col: "liveGoldLow"  },
  ];
  let liveChanged = false;
  for (const { key, col } of liveFields) {
    if (body[key] != null) {
      const v = Number(body[key]);
      if (Number.isFinite(v) && v > 0) { updates[col] = String(v); liveChanged = true; }
    }
  }
  // Rebuild liveSpot immediately so TV boards see new prices on this request
  if (liveChanged) {
    updates.liveLastSyncedAt = new Date();
    const bid  = Number(updates.liveGoldBid  ?? body.liveGoldBid)  || liveSpot?.bidUsdPerOz;
    const ask  = Number(updates.liveGoldAsk  ?? body.liveGoldAsk)  || liveSpot?.askUsdPerOz;
    const high = Number(updates.liveGoldHigh ?? body.liveGoldHigh) || liveSpot?.dailyHighUsdPerOz;
    const low  = Number(updates.liveGoldLow  ?? body.liveGoldLow)  || liveSpot?.dailyLowUsdPerOz;
    if (bid && ask && bid > 500 && ask > 500) {
      const mid           = (bid + ask) / 2;
      const rawAedPerGram = (ask / TROY_OUNCE_TO_GRAM) * USD_TO_AED;
      const aedPerGram    = rawAedPerGram * (1 + adminSpreadPercent / 100);
      liveSpot = {
        rawAedPerGram,
        aedPerGram,
        baseAedPerGram: rawAedPerGram,
        usdPerOz:       mid,
        bidUsdPerOz:    bid,
        askUsdPerOz:    ask,
        dailyLowUsdPerOz:  (low  && low  > 500) ? low  : liveSpot?.dailyLowUsdPerOz  ?? null,
        dailyHighUsdPerOz: (high && high > 500) ? high : liveSpot?.dailyHighUsdPerOz ?? null,
        receivedAt: new Date(),
      };
    }
  }

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
