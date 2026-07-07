import { Router, type IRouter } from "express";
import { db, pricesTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse, GetPublicPricesResponse } from "@workspace/api-zod";
import axios from "axios";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// AED is pegged to USD at this fixed rate. Metal spot prices are reported in
// USD per troy ounce.
const USD_TO_AED = 3.6725;
const TROY_OUNCE_TO_GRAM = 31.1034768;
const PURITY_995_FACTOR = 0.995;
const PURITY_999_FACTOR = 0.999;

// ── In-memory scraper cache (5-minute interval, writes to DB) ───────────────
// goldBullionRate = (scrapedUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED
let cachedGoldBullionRate: number | null = null;
let lastScrapedAt: Date | null = null;

// ── In-memory spot cache (10-second TTL, real-time frontend polling) ────────
// Separate from the 5-min DB-write scraper so the lightweight /prices/spot
// endpoint can serve fresh prices every 10 seconds without touching the DB.
interface SpotCache {
  usdPerOz: number;
  aedPerGram: number;
  fetchedAt: Date;
}
let spotCache: SpotCache | null = null;
const SPOT_CACHE_TTL_MS = 10_000;

async function fetchSpot(): Promise<SpotCache> {
  if (spotCache && Date.now() - spotCache.fetchedAt.getTime() < SPOT_CACHE_TTL_MS) {
    return spotCache;
  }
  const { data } = await axios.get(
    "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF",
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GoldShopServer/1.0)",
        Accept: "application/json",
      },
      timeout: 8000,
    },
  );
  const rawUsdPerOz: unknown = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof rawUsdPerOz !== "number" || !Number.isFinite(rawUsdPerOz) || rawUsdPerOz <= 0) {
    throw new Error(`Yahoo Finance spot: invalid price (${rawUsdPerOz})`);
  }
  spotCache = {
    usdPerOz: rawUsdPerOz,
    aedPerGram: Math.round(((rawUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED) * 100) / 100,
    fetchedAt: new Date(),
  };
  return spotCache;
}

// ── Yahoo Finance JSON API ──────────────────────────────────────────────────
// Uses Yahoo Finance's free /v8/finance/chart endpoint which returns JSON.
// This avoids HTML parsing, cheerio, and Node.js header-size limitations.
async function scrapeAndCache(): Promise<void> {
  const { data } = await axios.get(
    "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF",
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GoldShopServer/1.0)",
        Accept: "application/json",
      },
      timeout: 15000,
    },
  );

  // Response shape: data.chart.result[0].meta.regularMarketPrice (USD/oz)
  const rawUsdPerOz: unknown =
    data?.chart?.result?.[0]?.meta?.regularMarketPrice;

  if (typeof rawUsdPerOz !== "number" || !Number.isFinite(rawUsdPerOz) || rawUsdPerOz <= 0) {
    throw new Error(
      `Yahoo Finance API: unexpected regularMarketPrice value (${rawUsdPerOz})`,
    );
  }

  // Locked-in formula: (USDXAU / troy_oz_per_gram) * USD_to_AED
  const goldBullionRate =
    Math.round(((rawUsdPerOz / TROY_OUNCE_TO_GRAM) * USD_TO_AED) * 100) / 100;

  cachedGoldBullionRate = goldBullionRate;
  lastScrapedAt = new Date();
  // Keep spot cache in sync with the main scraper to avoid a redundant fetch
  // immediately after a 5-minute scraper run.
  spotCache = { usdPerOz: rawUsdPerOz as number, aedPerGram: goldBullionRate, fetchedAt: new Date() };

  logger.info(
    { rawUsdPerOz, goldBullionRate },
    "[gold-scraper] Gold rate updated",
  );

  // Write back to DB so the admin /prices page reflects the latest scraped rate.
  await db
    .update(pricesTable)
    .set({
      goldBullionRate: String(goldBullionRate),
      goldPricePerGram: String(goldBullionRate),
      liveModeConnected: true,
      updatedAt: new Date(),
    });
}

// ── Scraper interval ────────────────────────────────────────────────────────
// Runs immediately on server start, then every 5 minutes.
(function startScraper() {
  scrapeAndCache().catch((err: unknown) => {
    logger.warn(
      { err },
      "[gold-scraper] Initial scrape failed — will retry in 5 min",
    );
  });
  setInterval(() => {
    scrapeAndCache().catch((err: unknown) => {
      logger.warn({ err }, "[gold-scraper] Periodic scrape failed");
    });
  }, 5 * 60 * 1000);
})();

// ── Helpers ─────────────────────────────────────────────────────────────────
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

// Public, unauthenticated router — mounted before requireAuth so the showroom
// TV board and invoice new-invoice form can poll it without a session.
export const publicPricesRouter: IRouter = Router();

// ── /prices/spot ─────────────────────────────────────────────────────────────
// Lightweight real-time endpoint. 10-second server-side cache; no DB read.
// Frontend polls this every 3 seconds to drive second-by-second rate updates.
publicPricesRouter.get("/prices/spot", async (_req, res): Promise<void> => {
  try {
    const spot = await fetchSpot();
    res.json({
      usdPerOz: spot.usdPerOz,
      aedPerGram: spot.aedPerGram,
      updatedAt: spot.fetchedAt.toISOString(),
    });
  } catch {
    // Fall back to the 5-min scraper cache so the endpoint never goes dark
    if (cachedGoldBullionRate !== null) {
      res.json({
        usdPerOz: 0,
        aedPerGram: cachedGoldBullionRate,
        updatedAt: lastScrapedAt?.toISOString() ?? new Date().toISOString(),
      });
      return;
    }
    res.status(503).json({ error: "Spot price temporarily unavailable" });
  }
});

publicPricesRouter.get("/prices/public", async (_req, res): Promise<void> => {
  const prices = await getOrCreate();
  const parsed = parsePrices(prices);
  // Prefer the in-memory scraped rate (freshest); fall back to last DB value.
  const goldBullionRate = cachedGoldBullionRate ?? parsed.goldBullionRate;
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
      liveModeConnected: cachedGoldBullionRate !== null,
      liveSilverRate: parsed.liveSilverRate,
      liveGoldBid: null,
      liveGoldAsk: null,
      liveGoldHigh: null,
      liveGoldLow: null,
      updatedAt:
        lastScrapedAt?.toISOString() ?? parsed.updatedAt,
    }),
  );
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
  if (body.goldPricePerGram != null)
    updates.goldPricePerGram = String(body.goldPricePerGram);
  if (body.silverPricePerGram != null)
    updates.silverPricePerGram = String(body.silverPricePerGram);
  if (body.goldJewelryRate != null)
    updates.goldJewelryRate = String(body.goldJewelryRate);
  if (body.goldBullionRate != null)
    updates.goldBullionRate = String(body.goldBullionRate);
  if (body.ttBarRate != null) updates.ttBarRate = String(body.ttBarRate);
  if (body.ttBar24kRate != null)
    updates.ttBar24kRate = String(body.ttBar24kRate);
  if (body.kgBarRate != null) updates.kgBarRate = String(body.kgBarRate);
  if (body.gold22kRate != null) updates.gold22kRate = String(body.gold22kRate);
  if (body.gold21kRate != null) updates.gold21kRate = String(body.gold21kRate);
  if (body.gold18kRate != null) updates.gold18kRate = String(body.gold18kRate);
  if (body.gold9999Rate != null)
    updates.gold9999Rate = String(body.gold9999Rate);
  if (body.customDescriptions != null)
    updates.customDescriptions = JSON.stringify(body.customDescriptions);

  const [updated] = await db.update(pricesTable).set(updates).returning();

  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
});

export default router;
