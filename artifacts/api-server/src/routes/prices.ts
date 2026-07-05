import { Router, type IRouter } from "express";
import { db, pricesTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse, ConnectLiveRateResponse, DisconnectLiveRateResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// GoldAPI.io reports metal spot prices in USD per troy ounce (and USD/gram
// karat breakdowns for gold). AED is pegged to USD at this fixed rate.
const USD_TO_AED = 3.6725;
const TROY_OUNCE_TO_GRAM = 31.1034768;

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
    goldPricePerGram: Number(p.goldPricePerGram),
    silverPricePerGram: Number(p.silverPricePerGram),
    goldJewelryRate: Number(p.goldJewelryRate),
    goldBullionRate: Number(p.goldBullionRate),
    ttBarRate: Number(p.ttBarRate),
    kgBarRate: Number(p.kgBarRate),
    customDescriptions,
    updatedAt: p.updatedAt.toISOString(),
    liveModeConnected: p.liveModeConnected,
    liveApiKeyConfigured: Boolean(process.env.GOLDAPI_KEY),
    liveGoldRate24k: toNum(p.liveGoldRate24k),
    liveGoldRate22k: toNum(p.liveGoldRate22k),
    liveSilverRate: toNum(p.liveSilverRate),
    liveLastSyncedAt: p.liveLastSyncedAt ? p.liveLastSyncedAt.toISOString() : null,
  };
}

interface GoldApiMetalResponse {
  price?: number;
  price_gram_24k?: number;
  price_gram_22k?: number;
}

async function fetchGoldApiMetal(symbol: "XAU" | "XAG", apiKey: string): Promise<GoldApiMetalResponse> {
  const res = await fetch(`https://www.goldapi.io/api/${symbol}/USD`, {
    headers: { "x-access-token": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GoldAPI.io request failed (${symbol}): ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GoldApiMetalResponse;
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

router.put("/prices", async (req, res): Promise<void> => {
  const body = req.body as {
    goldPricePerGram?: number;
    silverPricePerGram?: number;
    goldJewelryRate?: number;
    goldBullionRate?: number;
    ttBarRate?: number;
    kgBarRate?: number;
    customDescriptions?: { name: string; rate: number }[];
  };

  await getOrCreate();

  const updates: Record<string, string | Date> = { updatedAt: new Date() };
  if (body.goldPricePerGram != null) updates.goldPricePerGram = String(body.goldPricePerGram);
  if (body.silverPricePerGram != null) updates.silverPricePerGram = String(body.silverPricePerGram);
  if (body.goldJewelryRate != null) updates.goldJewelryRate = String(body.goldJewelryRate);
  if (body.goldBullionRate != null) updates.goldBullionRate = String(body.goldBullionRate);
  if (body.ttBarRate != null) updates.ttBarRate = String(body.ttBarRate);
  if (body.kgBarRate != null) updates.kgBarRate = String(body.kgBarRate);
  if (body.customDescriptions != null) updates.customDescriptions = JSON.stringify(body.customDescriptions);

  const [updated] = await db
    .update(pricesTable)
    .set(updates)
    .returning();

  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
});

router.post("/prices/live/connect", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { apiKey?: string };
  const apiKey = process.env.GOLDAPI_KEY || body.apiKey;

  if (!apiKey) {
    res.status(400).json({ error: "No GoldAPI.io API key configured. Provide one to connect." });
    return;
  }

  const current = await getOrCreate();

  let gold: GoldApiMetalResponse;
  let silver: GoldApiMetalResponse;
  try {
    [gold, silver] = await Promise.all([
      fetchGoldApiMetal("XAU", apiKey),
      fetchGoldApiMetal("XAG", apiKey),
    ]);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch live rates from GoldAPI.io");
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch live rates from GoldAPI.io" });
    return;
  }

  const gold24kUsd = gold.price_gram_24k ?? (gold.price != null ? gold.price / TROY_OUNCE_TO_GRAM : null);
  const gold22kUsd = gold.price_gram_22k ?? (gold24kUsd != null ? gold24kUsd * (22 / 24) : null);
  const silverUsd = silver.price_gram_24k ?? (silver.price != null ? silver.price / TROY_OUNCE_TO_GRAM : null);

  if (gold24kUsd == null || gold22kUsd == null || silverUsd == null) {
    res.status(502).json({ error: "GoldAPI.io returned an unexpected response — could not determine per-gram rates." });
    return;
  }

  const gold24kAed = Math.round(gold24kUsd * USD_TO_AED * 100) / 100;
  const gold22kAed = Math.round(gold22kUsd * USD_TO_AED * 100) / 100;
  const silverAed = Math.round(silverUsd * USD_TO_AED * 100) / 100;

  const wasConnected = current.liveModeConnected;

  const [updated] = await db
    .update(pricesTable)
    .set({
      liveModeConnected: true,
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
        preLiveKgBarRate: current.kgBarRate,
        preLiveSilverPricePerGram: current.silverPricePerGram,
      }),
      goldPricePerGram: String(gold24kAed),
      goldJewelryRate: String(gold22kAed),
      goldBullionRate: String(gold24kAed),
      ttBarRate: String(gold24kAed),
      kgBarRate: String(gold24kAed),
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
      kgBarRate: current.preLiveKgBarRate ?? current.kgBarRate,
      silverPricePerGram: current.preLiveSilverPricePerGram ?? current.silverPricePerGram,
      goldPricePerGram: current.preLiveGoldBullionRate ?? current.goldPricePerGram,
      preLiveGoldJewelryRate: null,
      preLiveGoldBullionRate: null,
      preLiveTtBarRate: null,
      preLiveKgBarRate: null,
      preLiveSilverPricePerGram: null,
      updatedAt: new Date(),
    })
    .returning();

  res.json(DisconnectLiveRateResponse.parse(parsePrices(updated)));
});

export default router;
