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
function derivePrices(aedPerGram: number) {
  const base = aedPerGram;
  return {
    goldPricePerGram: base,
    goldBullionRate:  base,
    gold9999Rate:     +(base * 0.9999).toFixed(4),
    gold22kRate:      +(base * (22 / 24)).toFixed(4),
    gold21kRate:      +(base * (21 / 24)).toFixed(4),
    gold18kRate:      +(base * (18 / 24)).toFixed(4),
    ttBarRate:        +(base * 0.995).toFixed(4),
    ttBar24kRate:     +(base * 0.999).toFixed(4),
    kgBarRate:        +(base * 0.995).toFixed(4),
    goldJewelryRate:  +(base * (22 / 24)).toFixed(4),
    goldKg9999Rate:   +(base * 0.9999 * 1000).toFixed(2),
    silverPricePerGram: 0,
    manualInvoiceMode: false,
    updatedAt:  new Date().toISOString(),
    source:     getExternalSyncState().source,
    liveMode:   getExternalSyncState().source !== "none",
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
