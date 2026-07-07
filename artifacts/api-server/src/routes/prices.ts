import { Router, type IRouter } from "express";
import { db, pricesTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse, ConnectLiveRateResponse, DisconnectLiveRateResponse, GetPublicPricesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// AED is pegged to USD at this fixed rate. Metal spot prices are reported in
// USD per troy ounce by the APILayer Metals-API.
const USD_TO_AED = 3.6725;
const TROY_OUNCE_TO_GRAM = 31.1034768;
// 995 purity (TT. BAR 995 / KG BAR 995) is 99.5% pure gold, versus the 999.9
// (24K) spot rate which is ~99.99% pure. Scale the raw 24K rate down accordingly.
const PURITY_995_FACTOR = 0.995;
// TT. BAR 24K is a strict 999.0 purity bullion bar — scale the raw 24K spot
// rate by 0.999 (distinct from the 995-purity bars above).
const PURITY_999_FACTOR = 0.999;

function toNum(v: string | number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "*".repeat(key.length);
  const prefix = key.slice(0, 8);
  const suffix = key.slice(-4);
  return `${prefix}${"*".repeat(7)}...${suffix}`;
}

function parsePrices(p: typeof pricesTable.$inferSelect) {
  let customDescriptions: { name: string; rate: number }[] = [];
  try { customDescriptions = JSON.parse(p.customDescriptions || "[]"); } catch {}
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
    customDescriptions,
    updatedAt: p.updatedAt.toISOString(),
    liveModeConnected: p.liveModeConnected,
    liveApiKeyConfigured: Boolean(p.liveApiKey || process.env.APILAYER_KEY),
    liveApiKeyMasked: p.liveApiKey ? maskApiKey(p.liveApiKey) : (process.env.APILAYER_KEY ? maskApiKey(process.env.APILAYER_KEY) : null),
    liveApiProvider: "apilayer" as const,
    liveGoldRate24k: toNum(p.liveGoldRate24k),
    liveGoldRate22k: toNum(p.liveGoldRate22k),
    liveSilverRate: toNum(p.liveSilverRate),
    liveGoldBid: null as null,
    liveGoldAsk: null as null,
    liveGoldHigh: null as null,
    liveGoldLow: null as null,
    liveLastSyncedAt: p.liveLastSyncedAt ? p.liveLastSyncedAt.toISOString() : null,
  };
}

// APILayer Metals-API response: { rates: { USDXAU: <USD/oz>, USDXAG: <USD/oz> } }
interface ApiLayerRatesResponse {
  rates?: Record<string, number>;
}

async function fetchApiLayerMetals(apiKey: string): Promise<{ goldUsdPerOunce: number; silverUsdPerOunce: number }> {
  const res = await fetch("https://api.apilayer.com/metals/latest?base=USD&symbols=XAU,XAG", {
    headers: { apikey: apiKey },
  });
  if (!res.ok) {
    throw new Error(`APILayer Metals-API request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as ApiLayerRatesResponse;
  const usdXau = data.rates?.USDXAU;
  const usdXag = data.rates?.USDXAG;
  if (!Number.isFinite(usdXau) || !Number.isFinite(usdXag)) {
    throw new Error("APILayer Metals-API returned an unexpected response — missing USDXAU or USDXAG rate.");
  }
  return { goldUsdPerOunce: usdXau!, silverUsdPerOunce: usdXag! };
}

async function getOrCreate() {
  let [row] = await db.select().from(pricesTable).limit(1);
  if (!row) {
    [row] = await db.insert(pricesTable).values({}).returning();
  }
  return row;
}

router.get("/prices", async (_req, res): Promise<void> => {
  const prices = await getOrCreate();
  res.json(GetPricesResponse.parse(parsePrices(prices)));
});

// Public, unauthenticated router — mounted separately, before the requireAuth
// gate, so the showroom TV price-display board can poll it without a logged
// in session. Only exposes the handful of per-gram rates needed for display;
// never leaks API keys or other account/shop settings.
export const publicPricesRouter: IRouter = Router();
publicPricesRouter.get("/prices/public", async (_req, res): Promise<void> => {
  const prices = await getOrCreate();
  const parsed = parsePrices(prices);
  res.json(GetPublicPricesResponse.parse({
    goldBullionRate: parsed.goldBullionRate,
    ttBarRate: parsed.ttBarRate,
    ttBar24kRate: parsed.ttBar24kRate,
    kgBarRate: parsed.kgBarRate,
    silverPricePerGram: parsed.silverPricePerGram,
    gold22kRate: parsed.gold22kRate,
    gold21kRate: parsed.gold21kRate,
    gold18kRate: parsed.gold18kRate,
    gold9999Rate: parsed.gold9999Rate,
    liveModeConnected: parsed.liveModeConnected,
    liveSilverRate: parsed.liveSilverRate,
    liveGoldBid: null,
    liveGoldAsk: null,
    liveGoldHigh: null,
    liveGoldLow: null,
    updatedAt: parsed.updatedAt,
  }));
});

router.put("/prices", async (req, res): Promise<void> => {
  const body = req.body as {
    goldPricePerGram?: number;
    silverPricePerGram?: number;
    goldJewelryRate?: number;
    goldBullionRate?: number;
    ttBarRate?: number;
    ttBar24kRate?: number;
    kgBarRate?: number;
    gold22kRate?: number;
    gold21kRate?: number;
    gold18kRate?: number;
    gold9999Rate?: number;
    customDescriptions?: { name: string; rate: number }[];
  };

  await getOrCreate();

  const updates: Record<string, string | Date> = { updatedAt: new Date() };
  if (body.goldPricePerGram != null) updates.goldPricePerGram = String(body.goldPricePerGram);
  if (body.silverPricePerGram != null) updates.silverPricePerGram = String(body.silverPricePerGram);
  if (body.goldJewelryRate != null) updates.goldJewelryRate = String(body.goldJewelryRate);
  if (body.goldBullionRate != null) updates.goldBullionRate = String(body.goldBullionRate);
  if (body.ttBarRate != null) updates.ttBarRate = String(body.ttBarRate);
  if (body.ttBar24kRate != null) updates.ttBar24kRate = String(body.ttBar24kRate);
  if (body.kgBarRate != null) updates.kgBarRate = String(body.kgBarRate);
  if (body.gold22kRate != null) updates.gold22kRate = String(body.gold22kRate);
  if (body.gold21kRate != null) updates.gold21kRate = String(body.gold21kRate);
  if (body.gold18kRate != null) updates.gold18kRate = String(body.gold18kRate);
  if (body.gold9999Rate != null) updates.gold9999Rate = String(body.gold9999Rate);
  if (body.customDescriptions != null) updates.customDescriptions = JSON.stringify(body.customDescriptions);

  const [updated] = await db
    .update(pricesTable)
    .set(updates)
    .returning();

  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
});

router.post("/prices/live/connect", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { apiKey?: string };
  const current = await getOrCreate();
  const providedKey = body.apiKey?.trim();
  const apiKey = providedKey || (current.liveApiKey ?? undefined) || process.env.APILAYER_KEY;

  if (!apiKey) {
    res.status(400).json({ error: "Please enter a valid APILayer Metals-API key first." });
    return;
  }

  let goldUsdPerOunce: number;
  let silverUsdPerOunce: number;
  try {
    ({ goldUsdPerOunce, silverUsdPerOunce } = await fetchApiLayerMetals(apiKey));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch live rates from APILayer Metals-API");
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch live rates from APILayer Metals-API" });
    return;
  }

  // Unified goldBullionRate formula: (USDXAU / troy_oz_per_gram) * USD_to_AED
  const gold24kUsd = goldUsdPerOunce / TROY_OUNCE_TO_GRAM;
  const gold22kUsd = gold24kUsd * (22 / 24);
  const silverUsd = silverUsdPerOunce / TROY_OUNCE_TO_GRAM;

  if (!Number.isFinite(gold24kUsd) || !Number.isFinite(gold22kUsd) || !Number.isFinite(silverUsd)) {
    res.status(502).json({ error: "APILayer Metals-API returned an unexpected response — could not determine per-gram rates." });
    return;
  }

  const gold24kAed = Math.round(gold24kUsd * USD_TO_AED * 100) / 100;
  const gold22kAed = Math.round(gold22kUsd * USD_TO_AED * 100) / 100;
  const silverAed = Math.round(silverUsd * USD_TO_AED * 100) / 100;
  // TT. BAR 995 and KG BAR 995 are 995-purity bars.
  const gold995Aed = Math.round(gold24kAed * PURITY_995_FACTOR * 100) / 100;
  // TT. BAR 24K is a strict 999.0 purity bullion bar.
  const gold999Aed = Math.round(gold24kAed * PURITY_999_FACTOR * 100) / 100;
  // Jewelry karat rates computed from the raw 24K spot rate.
  const gold916Aed = Math.round(gold24kAed * 0.916 * 100) / 100;
  const gold875Aed = Math.round(gold24kAed * 0.875 * 100) / 100;
  const gold750Aed = Math.round(gold24kAed * 0.750 * 100) / 100;
  // GOLD 9999 (1GM / 1KG) — scaled from the raw 24K spot rate by 0.9999 purity.
  const gold9999Aed = Math.round(gold24kAed * 0.9999 * 100) / 100;

  const wasConnected = current.liveModeConnected;

  const [updated] = await db
    .update(pricesTable)
    .set({
      liveModeConnected: true,
      liveApiProvider: "apilayer",
      ...(providedKey ? { liveApiKey: providedKey } : {}),
      liveGoldRate24k: String(gold24kAed),
      liveGoldRate22k: String(gold22kAed),
      liveSilverRate: String(silverAed),
      liveGoldBid: null,
      liveGoldAsk: null,
      liveGoldHigh: null,
      liveGoldLow: null,
      liveLastSyncedAt: new Date(),
      // Snapshot the manual rates once, the first time we connect, so
      // disconnecting can restore exactly what the admin had before.
      ...(wasConnected ? {} : {
        preLiveGoldJewelryRate: current.goldJewelryRate,
        preLiveGoldBullionRate: current.goldBullionRate,
        preLiveTtBarRate: current.ttBarRate,
        preLiveTtBar24kRate: current.ttBar24kRate,
        preLiveKgBarRate: current.kgBarRate,
        preLiveSilverPricePerGram: current.silverPricePerGram,
        preLiveGold22kRate: current.gold22kRate,
        preLiveGold21kRate: current.gold21kRate,
        preLiveGold18kRate: current.gold18kRate,
        preLiveGold9999Rate: current.gold9999Rate,
      }),
      goldPricePerGram: String(gold24kAed),
      goldJewelryRate: String(gold22kAed),
      goldBullionRate: String(gold24kAed),
      ttBarRate: String(gold995Aed),
      ttBar24kRate: String(gold999Aed),
      kgBarRate: String(gold995Aed),
      gold22kRate: String(gold916Aed),
      gold21kRate: String(gold875Aed),
      gold18kRate: String(gold750Aed),
      gold9999Rate: String(gold9999Aed),
      silverPricePerGram: String(silverAed),
      updatedAt: new Date(),
    })
    .returning();

  res.json(ConnectLiveRateResponse.parse(parsePrices(updated)));
});

router.post("/prices/live/disconnect", async (req, res): Promise<void> => {
  const current = await getOrCreate();

  const [updated] = await db
    .update(pricesTable)
    .set({
      liveModeConnected: false,
      liveGoldRate24k: null,
      liveGoldRate22k: null,
      liveSilverRate: null,
      liveGoldBid: null,
      liveGoldAsk: null,
      liveGoldHigh: null,
      liveGoldLow: null,
      liveLastSyncedAt: null,
      goldJewelryRate: current.preLiveGoldJewelryRate ?? current.goldJewelryRate,
      goldBullionRate: current.preLiveGoldBullionRate ?? current.goldBullionRate,
      ttBarRate: current.preLiveTtBarRate ?? current.ttBarRate,
      ttBar24kRate: current.preLiveTtBar24kRate ?? current.ttBar24kRate,
      kgBarRate: current.preLiveKgBarRate ?? current.kgBarRate,
      gold22kRate: current.preLiveGold22kRate ?? current.gold22kRate,
      gold21kRate: current.preLiveGold21kRate ?? current.gold21kRate,
      gold18kRate: current.preLiveGold18kRate ?? current.gold18kRate,
      gold9999Rate: current.preLiveGold9999Rate ?? current.gold9999Rate,
      silverPricePerGram: current.preLiveSilverPricePerGram ?? current.silverPricePerGram,
      goldPricePerGram: current.preLiveGoldBullionRate ?? current.goldPricePerGram,
      preLiveGoldJewelryRate: null,
      preLiveGoldBullionRate: null,
      preLiveTtBarRate: null,
      preLiveTtBar24kRate: null,
      preLiveKgBarRate: null,
      preLiveSilverPricePerGram: null,
      preLiveGold22kRate: null,
      preLiveGold21kRate: null,
      preLiveGold18kRate: null,
      preLiveGold9999Rate: null,
      updatedAt: new Date(),
    })
    .returning();

  res.json(DisconnectLiveRateResponse.parse(parsePrices(updated)));
});

export default router;
