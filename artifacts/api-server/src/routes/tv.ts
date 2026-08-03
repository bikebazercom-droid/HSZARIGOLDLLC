/**
 * TV Board routes — Module 3 of the PRD.
 *
 * GET /tv/prices  — public (no auth), returns live prices from ExternalSync.
 * GET /tv/test    — public test endpoint (admin can call before enabling sync).
 */
import { Router, type IRouter } from "express";
import { db, priceItemsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { getExternalSyncState, doSyncTick } from "../services/external-sync.js";

const TROY        = 31.1034768;
const AED_PER_USD = 3.6725;

function computeItemPrice(
  item: typeof priceItemsTable.$inferSelect,
  baseAedPerGram: number,
  sync: ReturnType<typeof import("../services/external-sync.js").getExternalSyncState>,
): number | null {
  const purity = parseFloat(item.purityFactor);
  const offset = parseFloat(item.premiumOffsetAed ?? "0");

  if (item.formulaType === "manual") {
    return item.manualRateAed == null ? null : parseFloat(item.manualRateAed) + offset;
  }

  // Use GoldAPI's direct per-karat AED rates when available — most accurate
  if (sync.aed22k > 0) {
    if (Math.abs(purity - 22/24) < 0.001) return +(sync.aed22k + offset);
    if (Math.abs(purity - 21/24) < 0.001) return +(sync.aed21k + offset);
    if (Math.abs(purity - 18/24) < 0.001) return +(sync.aed18k + offset);
  }

  if (item.formulaType === "spot_bar") {
    const wg = parseFloat(item.weightGrams ?? "0");
    return baseAedPerGram * wg * purity + offset;
  }
  return baseAedPerGram * purity + offset;
}

export const publicTvRouter: IRouter = Router();

// ── GET /tv/prices — live price snapshot ────────────────────────────────────
publicTvRouter.get("/tv/prices", async (_req, res) => {
  try {
    const sync = getExternalSyncState();

    const items = await db
      .select()
      .from(priceItemsTable)
      .where(eq(priceItemsTable.tvVisible, true))
      .orderBy(asc(priceItemsTable.displayOrder));

    const baseAed = sync.baseAedPerGram > 0 ? sync.baseAedPerGram : null;

    res.json({
      bidUsd:         sync.bidUsd > 0            ? +sync.bidUsd.toFixed(2)      : null,
      askUsd:         sync.askUsd > 0            ? +sync.askUsd.toFixed(2)      : null,
      midUsd:         sync.midUsd > 0            ? +sync.midUsd.toFixed(2)      : null,
      dailyHigh:      sync.dailyHigh > 0         ? +sync.dailyHigh.toFixed(2)   : null,
      dailyLow:       sync.dailyLow > 0 && sync.dailyLow !== Infinity
                        ? +sync.dailyLow.toFixed(2) : null,
      baseAedPerGram: baseAed != null            ? +baseAed.toFixed(4)          : null,
      // GoldAPI per-karat AED rates (most accurate — direct from market feed)
      aed22k:         sync.aed22k > 0            ? +sync.aed22k.toFixed(4)      : null,
      aed21k:         sync.aed21k > 0            ? +sync.aed21k.toFixed(4)      : null,
      aed18k:         sync.aed18k > 0            ? +sync.aed18k.toFixed(4)      : null,
      updatedAt:      sync.updatedAt,
      source: sync.source as string,
      error:          sync.error,
      items: items.map((item) => {
        const scrapedPrice  = sync.itemPrices[item.name];
        const computedPrice = baseAed != null ? computeItemPrice(item, baseAed, sync) : null;
        return {
          id:          item.id,
          name:        item.name,
          weightLabel: item.weightLabel,
          price:       (scrapedPrice && scrapedPrice > 0)
                         ? +scrapedPrice.toFixed(2)
                         : computedPrice != null
                           ? +computedPrice.toFixed(2)
                           : null,
          formulaType: item.formulaType,
          source:      (scrapedPrice && scrapedPrice > 0) ? "scraped" : "computed",
        };
      }),
    });
  } catch (err) {
    logger.error({ err }, "[tv] GET /tv/prices failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /tv/test — one-shot fetch for connection test ────────────────────────
publicTvRouter.get("/tv/test", async (_req, res) => {
  try {
    await doSyncTick();
    const sync = getExternalSyncState();
    res.json({
      ok:     sync.midUsd > 0,
      source: sync.source,
      midUsd: sync.midUsd,
      error:  sync.error,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message });
  }
});

export default publicTvRouter;
