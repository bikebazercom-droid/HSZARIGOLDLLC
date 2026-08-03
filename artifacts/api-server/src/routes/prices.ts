/**
 * /api/prices — compatibility adapter for the invoice page.
 *
 * Translates the ExternalSync state (baseAedPerGram) into the flat
 * `PricesData` shape that the invoice page expects, so the invoice
 * continues to work without modification.
 */
import { Router, type IRouter } from "express";
import { getExternalSyncState } from "../services/external-sync.js";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

// AED/gram → per-karat / per-item derived rates
// Prefers GoldAPI's direct per-karat rates when available.
function derivePrices(aedPerGram: number) {
  const sync = getExternalSyncState();
  const base = aedPerGram;
  // Use GoldAPI's direct karat rates if available (most accurate)
  const k22 = sync.aed22k > 0 ? sync.aed22k : +(base * (22 / 24)).toFixed(4);
  const k21 = sync.aed21k > 0 ? sync.aed21k : +(base * (21 / 24)).toFixed(4);
  const k18 = sync.aed18k > 0 ? sync.aed18k : +(base * (18 / 24)).toFixed(4);
  return {
    goldPricePerGram:   base,
    goldBullionRate:    base,
    gold9999Rate:       +(base * 0.9999).toFixed(4),
    gold22kRate:        k22,
    gold21kRate:        k21,
    gold18kRate:        k18,
    ttBarRate:          +(base * 0.995).toFixed(4),
    ttBar24kRate:       +(base * 0.999).toFixed(4),
    kgBarRate:          +(base * 0.995).toFixed(4),
    goldJewelryRate:    k22,
    goldKg9999Rate:     +(base * 0.9999 * 1000).toFixed(2),
    silverPricePerGram: 0,
    manualInvoiceMode:  false,
    updatedAt:          new Date().toISOString(),
    source:             sync.source,
    liveMode:           sync.source !== "none",
  };
}

router.get("/prices", requireAuth, (_req, res) => {
  const sync = getExternalSyncState();
  const aed  = sync.baseAedPerGram;

  if (aed <= 0) {
    // Return zeros — invoice will show blank until live data arrives
    res.json({
      ...derivePrices(0),
      error: sync.error ?? "Awaiting first sync tick",
    });
    return;
  }

  res.json(derivePrices(aed));
});

export default router;
