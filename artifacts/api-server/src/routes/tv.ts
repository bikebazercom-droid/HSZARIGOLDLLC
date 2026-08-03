import { Router, type IRouter } from "express";
import { db, priceItemsTable, companySettingsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const TROY        = 31.1034768;
const AED_PER_USD = 3.6725;

// ── In-memory live state ──────────────────────────────────────────────────────
interface LiveState {
  usdPerOz:   number;
  bidUsd:     number;
  askUsd:     number;
  dailyHigh:  number;
  dailyLow:   number;
  updatedAt:  string | null;
  lastUtcDay: number;
  error:      string | null;
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
  // Prefer DB-stored token (set via Settings page), fall back to env var.
  // This allows the admin to update the key at runtime without restarting.
  let apiKey: string | null | undefined;
  try {
    const [row] = await db
      .select({ token: companySettingsTable.uniRateApiToken, enabled: companySettingsTable.uniRateApiEnabled })
      .from(companySettingsTable)
      .limit(1);

    if (row?.enabled === false) {
      state.error = "UniRateAPI disabled in settings";
      logger.info("[tv] UniRateAPI disabled — skipping poll");
      return;
    }
    apiKey = row?.token ?? process.env.UNIRATE_API_KEY;
  } catch {
    // DB not yet ready on very first startup tick — use env var
    apiKey = process.env.UNIRATE_API_KEY;
  }

  if (!apiKey) {
    state.error = "No API key — add your UniRateAPI key in Settings → Live TV";
    logger.warn("[tv] No UniRateAPI key configured");
    return;
  }

  try {
    // UniRateAPI standard rates endpoint (base = USD).
    // XAU (physical gold spot) is not in their standard tier; however XAUT
    // (Tether Gold) is included — it is a tokenised instrument backed 1:1 by
    // one fine troy ounce of gold and tracks XAU to within <0.1%.
    //
    // Response format: { rates: { XAUT: <xaut_per_usd> } }
    // → USD per troy oz = 1 / rates.XAUT
    const url = `https://api.unirateapi.com/api/rates?api_key=${apiKey}&symbols=XAUT`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json() as Record<string, any>;
    const rates: Record<string, number> = data?.rates ?? data?.data ?? {};

    // XAU first (some premium plans expose it), then XAUT as proxy
    const rawRate: number | undefined = rates.XAU ?? rates.XAUT;

    if (!rawRate || typeof rawRate !== "number" || rawRate <= 0) {
      logger.warn({ keys: Object.keys(rates).slice(0, 20) }, "[tv] XAU/XAUT not found in response");
      state.error = "Gold rate not found in API response — check your API key";
      return;
    }

    const mid        = 1 / rawRate;   // USD per troy oz
    const halfSpread = 0.45;          // typical market spread ≈ $0.90
    const bid        = mid - halfSpread;
    const ask        = mid + halfSpread;

    // Reset daily H/L at UTC midnight
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

    logger.info(`[tv] $${mid.toFixed(2)}/oz  bid=${bid.toFixed(2)}  ask=${ask.toFixed(2)}  H=${state.dailyHigh.toFixed(2)}  L=${state.dailyLow.toFixed(2)}`);
  } catch (err: any) {
    state.error = err?.message ?? "Fetch error";
    logger.warn({ err: err?.message }, "[tv] UniRateAPI fetch failed");
  }
}

// Kick off immediately, then every 90 s (≤ 960 req/day for paid plans)
fetchUniRate();
const _tvPollTimer = setInterval(fetchUniRate, 90_000);

// ── Exported trigger — settings route calls this after saving a new key ───────
export function triggerTvFetch(): void {
  fetchUniRate().catch(() => {});
}

// ── Price computation ─────────────────────────────────────────────────────────
function computeItemPrice(item: typeof priceItemsTable.$inferSelect, baseAed: number): number | null {
  const purity = parseFloat(item.purityFactor);
  const offset = parseFloat(item.premiumOffsetAed ?? "0");

  if (item.formulaType === "manual") {
    return item.manualRateAed == null ? null : parseFloat(item.manualRateAed) + offset;
  }
  if (item.formulaType === "spot_bar") {
    const wg = parseFloat(item.weightGrams ?? "0");
    return baseAed * wg * purity + offset;
  }
  return baseAed * purity + offset;
}

// ── Public TV router (no auth required) ──────────────────────────────────────
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
      bidUsd:         state.bidUsd    > 0         ? +state.bidUsd.toFixed(2)     : null,
      askUsd:         state.askUsd    > 0         ? +state.askUsd.toFixed(2)     : null,
      dailyHigh:      state.dailyHigh > 0         ? +state.dailyHigh.toFixed(2)  : null,
      dailyLow:       state.dailyLow !== Infinity  ? +state.dailyLow.toFixed(2)  : null,
      baseAedPerGram: baseAed != null             ? +baseAed.toFixed(4)          : null,
      updatedAt:      state.updatedAt,
      error:          state.error,
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
