import { Router, type IRouter } from "express";
import { db, priceItemsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const TROY        = 31.1034768;
const AED_PER_USD = 3.6725;

// ── In-memory live state ──────────────────────────────────────────────────────
interface LiveState {
  usdPerOz:     number;
  bidUsd:       number;
  askUsd:       number;
  dailyHigh:    number;
  dailyLow:     number;
  updatedAt:    string | null;
  lastUtcDay:   number;
  error:        string | null;
}

const state: LiveState = {
  usdPerOz:   0,
  bidUsd:     0,
  askUsd:     0,
  dailyHigh:  0,
  dailyLow:   Infinity,
  updatedAt:  null,
  lastUtcDay: new Date().getUTCDate(),
  error:      null,
};

// ── UniRateAPI polling ────────────────────────────────────────────────────────
async function fetchUniRate(): Promise<void> {
  const apiKey = process.env.UNIRATE_API_KEY;
  if (!apiKey) {
    state.error = "UNIRATE_API_KEY not configured";
    logger.warn("[tv] UNIRATE_API_KEY not set — TV board will show no live data");
    return;
  }

  try {
    // UniRateAPI standard rates endpoint (base = USD).
    // Their API does not expose raw XAU (gold spot) directly, but it includes
    // XAUT (Tether Gold), which is a tokenised gold instrument backed 1:1 by
    // one fine troy ounce of physical gold. Its USD price tracks XAU spot
    // to within <0.1%, making it a reliable proxy for the TV display board.
    //
    // XAUT value in response = XAUT per 1 USD (inverse price).
    // → USD per troy oz = 1 / rates.XAUT
    const url = `https://api.unirateapi.com/api/rates?api_key=${apiKey}&symbols=XAUT`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json() as Record<string, any>;
    const rates: Record<string, number> = data?.rates ?? data?.data ?? {};

    // Try XAU first (physical gold spot, available on some API tiers), then
    // fall back to XAUT (Tether Gold, backed 1:1 by one troy oz of gold).
    const rawRate: number | undefined =
      rates.XAU    ??   // XAU per USD (inverse) — preferred
      rates.XAUT   ??   // XAUT per USD (inverse) — proxy
      undefined;

    if (!rawRate || typeof rawRate !== "number" || rawRate <= 0) {
      logger.warn({ keys: Object.keys(rates).slice(0, 20) }, "[tv] XAU/XAUT not found in UniRateAPI response");
      state.error = "Gold rate not found in UniRateAPI response";
      return;
    }

    const mid = 1 / rawRate;            // USD per troy oz
    const halfSpread = 0.45;            // typical gold market spread ~$0.90
    const bid = mid - halfSpread;
    const ask = mid + halfSpread;

    // Reset daily H/L on UTC midnight
    const today = new Date().getUTCDate();
    if (today !== state.lastUtcDay) {
      state.dailyHigh  = mid;
      state.dailyLow   = mid;
      state.lastUtcDay = today;
      logger.info("[tv] Daily H/L reset for new UTC day");
    }

    state.usdPerOz  = mid;
    state.bidUsd    = bid;
    state.askUsd    = ask;
    state.dailyHigh = state.dailyHigh === 0 ? mid : Math.max(state.dailyHigh, mid);
    state.dailyLow  = state.dailyLow === Infinity ? mid : Math.min(state.dailyLow, mid);
    state.updatedAt = new Date().toISOString();
    state.error     = null;

    logger.info(`[tv] Live: $${mid.toFixed(2)}/oz  bid=${bid.toFixed(2)}  ask=${ask.toFixed(2)}  H=${state.dailyHigh.toFixed(2)}  L=${state.dailyLow.toFixed(2)}`);
  } catch (err: any) {
    state.error = err?.message ?? "Fetch error";
    logger.warn({ err: err?.message }, "[tv] UniRateAPI fetch failed");
  }
}

// Kick off immediately, then every 90 s (stays within 960 req/day for paid plans)
fetchUniRate();
const _tvPollTimer = setInterval(fetchUniRate, 90_000);

// ── Price computation helper ──────────────────────────────────────────────────
function computeItemPrice(item: typeof priceItemsTable.$inferSelect, baseAed: number): number | null {
  const purity = parseFloat(item.purityFactor);
  const offset = parseFloat(item.premiumOffsetAed ?? "0");

  if (item.formulaType === "manual") {
    if (item.manualRateAed == null) return null;
    return parseFloat(item.manualRateAed) + offset;
  }
  if (item.formulaType === "spot_bar") {
    const wg = parseFloat(item.weightGrams ?? "0");
    return baseAed * wg * purity + offset;
  }
  // spot_per_gram
  return baseAed * purity + offset;
}

// ── Public TV router (no auth) ────────────────────────────────────────────────
export const publicTvRouter: IRouter = Router();

publicTvRouter.get("/tv/prices", async (_req, res) => {
  try {
    const items = await db
      .select()
      .from(priceItemsTable)
      .where(eq(priceItemsTable.tvVisible, true))
      .orderBy(asc(priceItemsTable.displayOrder));

    const baseAed = state.usdPerOz > 0
      ? (state.usdPerOz / TROY) * AED_PER_USD
      : null;

    res.json({
      bidUsd:        state.bidUsd  > 0         ? +state.bidUsd.toFixed(2)       : null,
      askUsd:        state.askUsd  > 0         ? +state.askUsd.toFixed(2)       : null,
      dailyHigh:     state.dailyHigh > 0       ? +state.dailyHigh.toFixed(2)    : null,
      dailyLow:      state.dailyLow !== Infinity ? +state.dailyLow.toFixed(2)   : null,
      baseAedPerGram: baseAed != null          ? +baseAed.toFixed(4)            : null,
      updatedAt:     state.updatedAt,
      error:         state.error,
      items: items.map((item) => ({
        id:          item.id,
        name:        item.name,
        weightLabel: item.weightLabel,
        price:       baseAed != null ? computeItemPrice(item, baseAed) : null,
        formulaType: item.formulaType,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[tv] GET /tv/prices failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default publicTvRouter;
