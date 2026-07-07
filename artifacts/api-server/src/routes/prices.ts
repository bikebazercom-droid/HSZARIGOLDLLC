import { Router, type IRouter } from "express";
import { db, pricesTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse, GetPublicPricesResponse } from "@workspace/api-zod";
import { io as socketIO } from "socket.io-client";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const USD_TO_AED = 3.6725;
const TROY_OUNCE_TO_GRAM = 31.1034768;

// ── Live Socket.IO feed — livepriceofgold.com ────────────────────────────────
// Connects to the Socket.IO server that powers livepriceofgold.com's Dubai
// price page. On every `update` event the payload contains pre-converted
// AED per gram values (GXAUUSD_AED for 24K, 22GXAUUSD_AED for 22K, etc.)
// so no manual conversion is needed. No server-side cache — liveSpot always
// holds the most recent tick pushed by the feed.
// ─────────────────────────────────────────────────────────────────────────────

interface LiveSpot {
  aedPerGram: number;  // 24K per gram in AED (GXAUUSD_AED from socket)
  usdPerOz: number;    // raw XAUUSD for reference
  receivedAt: Date;
}

let liveSpot: LiveSpot | null = null;
let lastDbWriteAt: Date | null = null;

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

    // GXAUUSD_AED is the 24K AED/gram value computed server-side by livepriceofgold.com
    // (their server converts XAUUSD → AED/g using the live AED/USD fix rate).
    const aedRaw = parseFloat(String(data["GXAUUSD_AED"]));
    const usdRaw = parseFloat(String(data["XAUUSD"]));

    const aedPerGram = Number.isFinite(aedRaw) && aedRaw > 300 && aedRaw < 800
      ? aedRaw
      : Number.isFinite(usdRaw) && usdRaw > 1000
        // Fallback: derive from XAUUSD if AED key absent
        ? (usdRaw / TROY_OUNCE_TO_GRAM) * USD_TO_AED
        : null;

    if (aedPerGram === null) return;

    const usdPerOz = Number.isFinite(usdRaw) ? usdRaw
      : (aedPerGram / USD_TO_AED) * TROY_OUNCE_TO_GRAM;

    liveSpot = { aedPerGram, usdPerOz, receivedAt: new Date() };

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
// No cache — returns the latest Socket.IO tick directly.
// Frontend polls every 1 second; each response is the freshest available tick.
publicPricesRouter.get("/prices/spot", (_req, res): void => {
  if (liveSpot) {
    res.json({
      usdPerOz: liveSpot.usdPerOz,
      aedPerGram: liveSpot.aedPerGram,
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
      liveModeConnected: liveSpot !== null,
      liveSilverRate: parsed.liveSilverRate,
      liveGoldBid: null,
      liveGoldAsk: null,
      liveGoldHigh: null,
      liveGoldLow: null,
      updatedAt: liveSpot?.receivedAt.toISOString() ?? parsed.updatedAt,
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
  ];
  for (const f of numFields) {
    if (body[f] != null) updates[f] = String(body[f]);
  }
  if (body.customDescriptions != null)
    updates.customDescriptions = JSON.stringify(body.customDescriptions);
  if (typeof body.manualInvoiceMode === "boolean")
    updates.manualInvoiceMode = body.manualInvoiceMode;

  const [updated] = await db.update(pricesTable).set(updates).returning();
  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
});

export default router;
