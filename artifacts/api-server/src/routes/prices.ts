import { Router, type IRouter } from "express";
import { db, pricesTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse, ConnectLiveRateResponse, DisconnectLiveRateResponse, GetPublicPricesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Both GoldAPI.io and MetalpriceAPI.com report metal spot prices in USD per
// troy ounce. AED is pegged to USD at this fixed rate.
const USD_TO_AED = 3.6725;
const TROY_OUNCE_TO_GRAM = 31.1034768;
// 995 purity (TT. BAR 995 / KG BAR 995) is 99.5% pure gold, versus the 999.9
// (24K) spot rate which is ~99.99% pure. Scale the raw 24K rate down accordingly.
const PURITY_995_FACTOR = 0.995;
// TT. BAR 24K is a strict 999.0 purity bullion bar — scale the raw 24K spot
// rate by 0.999 (distinct from the 995-purity bars above).
const PURITY_999_FACTOR = 0.999;

type ApiProvider = "goldapi" | "metalpriceapi";

function normalizeProvider(v: unknown): ApiProvider {
  return v === "metalpriceapi" ? "metalpriceapi" : "goldapi";
}

const PROVIDER_LABELS: Record<ApiProvider, string> = {
  goldapi: "GoldAPI.io",
  metalpriceapi: "MetalpriceAPI.com",
};

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
    liveApiKeyConfigured: Boolean(p.liveApiKey || process.env.GOLDAPI_KEY),
    liveApiKeyMasked: p.liveApiKey ? maskApiKey(p.liveApiKey) : (process.env.GOLDAPI_KEY ? maskApiKey(process.env.GOLDAPI_KEY) : null),
    liveApiProvider: normalizeProvider(p.liveApiProvider),
    liveGoldRate24k: toNum(p.liveGoldRate24k),
    liveGoldRate22k: toNum(p.liveGoldRate22k),
    liveSilverRate: toNum(p.liveSilverRate),
    liveLastSyncedAt: p.liveLastSyncedAt ? p.liveLastSyncedAt.toISOString() : null,
  };
}

// A minimal, provider-agnostic result: USD spot price per troy ounce, plus
// (when the provider supplies them directly) USD-per-gram karat breakdowns.
interface MetalSpot {
  usdPerOunce: number;
  usdPerGram24k?: number;
  usdPerGram22k?: number;
}

interface GoldApiMetalResponse {
  price?: number;
  price_gram_24k?: number;
  price_gram_22k?: number;
}

async function fetchGoldApiMetal(symbol: "XAU" | "XAG", apiKey: string): Promise<MetalSpot> {
  const res = await fetch(`https://www.goldapi.io/api/${symbol}/USD`, {
    headers: { "x-access-token": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GoldAPI.io request failed (${symbol}): ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as GoldApiMetalResponse;
  const usdPerOunce = data.price ?? (data.price_gram_24k != null ? data.price_gram_24k * TROY_OUNCE_TO_GRAM : NaN);
  if (!Number.isFinite(usdPerOunce)) {
    throw new Error(`GoldAPI.io returned an unexpected response for ${symbol} — missing price.`);
  }
  return { usdPerOunce, usdPerGram24k: data.price_gram_24k, usdPerGram22k: data.price_gram_22k };
}

interface MetalpriceApiResponse {
  success?: boolean;
  rates?: Record<string, number>;
  error?: { code?: number; type?: string; info?: string };
}

async function fetchMetalpriceApiMetals(apiKey: string): Promise<{ xau: MetalSpot; xag: MetalSpot }> {
  const url = `https://api.metalpriceapi.com/v1/latest?api_key=${encodeURIComponent(apiKey)}&base=USD&currencies=XAU,XAG`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MetalpriceAPI.com request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as MetalpriceApiResponse;
  if (!data.success || !data.rates) {
    throw new Error(`MetalpriceAPI.com request failed: ${data.error?.info ?? "unknown error"}`);
  }
  // `USDXAU`/`USDXAG` are the reciprocal convenience fields already expressed
  // as USD price per troy ounce. Fall back to inverting the base `XAU`/`XAG`
  // rate (troy-oz-of-metal per 1 USD) if the convenience fields are missing.
  const xauUsd = data.rates.USDXAU ?? (data.rates.XAU ? 1 / data.rates.XAU : NaN);
  const xagUsd = data.rates.USDXAG ?? (data.rates.XAG ? 1 / data.rates.XAG : NaN);
  if (!Number.isFinite(xauUsd) || !Number.isFinite(xagUsd)) {
    throw new Error("MetalpriceAPI.com returned an unexpected response — could not determine spot prices.");
  }
  return { xau: { usdPerOunce: xauUsd }, xag: { usdPerOunce: xagUsd } };
}

async function fetchLiveMetalRates(provider: ApiProvider, apiKey: string): Promise<{ gold: MetalSpot; silver: MetalSpot }> {
  if (provider === "metalpriceapi") {
    const { xau, xag } = await fetchMetalpriceApiMetals(apiKey);
    return { gold: xau, silver: xag };
  }
  const [gold, silver] = await Promise.all([
    fetchGoldApiMetal("XAU", apiKey),
    fetchGoldApiMetal("XAG", apiKey),
  ]);
  return { gold, silver };
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
  const body = (req.body ?? {}) as { apiKey?: string; apiProvider?: string };
  const current = await getOrCreate();
  const providedKey = body.apiKey?.trim();
  // Switching providers invalidates a previously-saved key for the *other*
  // provider, so only fall back to the stored key when the provider is
  // unchanged (or unspecified, i.e. re-syncing with the existing setup).
  const provider = body.apiProvider != null ? normalizeProvider(body.apiProvider) : normalizeProvider(current.liveApiProvider);
  const providerChanged = provider !== normalizeProvider(current.liveApiProvider);
  const fallbackKey = provider === "goldapi" ? process.env.GOLDAPI_KEY : undefined;
  const apiKey = providedKey || (!providerChanged ? current.liveApiKey ?? undefined : undefined) || fallbackKey || undefined;

  if (!apiKey) {
    res.status(400).json({ error: `Please enter a valid ${PROVIDER_LABELS[provider]} API Key first.` });
    return;
  }

  let gold: MetalSpot;
  let silver: MetalSpot;
  try {
    ({ gold, silver } = await fetchLiveMetalRates(provider, apiKey));
  } catch (err) {
    req.log.error({ err, provider }, `Failed to fetch live rates from ${PROVIDER_LABELS[provider]}`);
    res.status(502).json({ error: err instanceof Error ? err.message : `Failed to fetch live rates from ${PROVIDER_LABELS[provider]}` });
    return;
  }

  const gold24kUsd = gold.usdPerGram24k ?? gold.usdPerOunce / TROY_OUNCE_TO_GRAM;
  const gold22kUsd = gold.usdPerGram22k ?? gold24kUsd * (22 / 24);
  const silverUsd = silver.usdPerGram24k ?? silver.usdPerOunce / TROY_OUNCE_TO_GRAM;

  if (!Number.isFinite(gold24kUsd) || !Number.isFinite(gold22kUsd) || !Number.isFinite(silverUsd)) {
    res.status(502).json({ error: `${PROVIDER_LABELS[provider]} returned an unexpected response — could not determine per-gram rates.` });
    return;
  }

  const gold24kAed = Math.round(gold24kUsd * USD_TO_AED * 100) / 100;
  const gold22kAed = Math.round(gold22kUsd * USD_TO_AED * 100) / 100;
  const silverAed = Math.round(silverUsd * USD_TO_AED * 100) / 100;
  // TT. BAR 995 and KG BAR 995 are 995-purity bars, so their per-gram rate is
  // the raw 24K spot rate scaled by the purity factor, not the raw 24K rate.
  const gold995Aed = Math.round(gold24kAed * PURITY_995_FACTOR * 100) / 100;
  // TT. BAR 24K is a strict 999.0 purity bullion bar.
  const gold999Aed = Math.round(gold24kAed * PURITY_999_FACTOR * 100) / 100;
  // Jewelry karat rates (22K/21K/18K) are first-class core assets, computed
  // from the raw 24K spot rate the same way as the 995/999 purity bars above.
  const gold916Aed = Math.round(gold24kAed * 0.916 * 100) / 100;
  const gold875Aed = Math.round(gold24kAed * 0.875 * 100) / 100;
  const gold750Aed = Math.round(gold24kAed * 0.750 * 100) / 100;
  // GOLD 9999 (1GM / 1KG) — same per-gram rate for both weight variants,
  // scaled from the raw 24K spot rate by the 0.9999 purity factor.
  const gold9999Aed = Math.round(gold24kAed * 0.9999 * 100) / 100;

  const wasConnected = current.liveModeConnected;

  const [updated] = await db
    .update(pricesTable)
    .set({
      liveModeConnected: true,
      liveApiProvider: provider,
      ...(providedKey ? { liveApiKey: providedKey } : {}),
      liveGoldRate24k: String(gold24kAed),
      liveGoldRate22k: String(gold22kAed),
      liveSilverRate: String(silverAed),
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
