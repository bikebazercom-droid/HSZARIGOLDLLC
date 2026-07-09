---
name: Gold-shop pricing engine (spot-based)
description: How the 24K base rate and all downstream rate rows are computed from international XAU/USD spot. No admin spread or labor markup — removed permanently.
---

The pricing engine derives `Base_24K_AED` directly from the international gold spot price (XAU/USD).

- Formula pipeline:
  ```
  Base_24K_AED  = (Ask_USD / 31.1034768) × 3.6725
  Adjusted_Base = Base_24K_AED × (1 + adminSpreadPercent / 100)
  Bar/bullion   = Adjusted_Base × purity
  Jewelry rows  = Adjusted_Base × purity × (1 + adminLaborPercent / 100)
  ```
  **Why:** admin-configurable spread and labor cost were re-added as percentage inputs (not flat AED) via a "Live Price Tuning" card on the Admin Dashboard.
  **How to apply:** `aedPerGram` from `/prices/spot` IS `Adjusted_Base` (spread applied server-side). `spreadPercent` and `laborCostPercent` are also returned from `/prices/spot` so the frontend can apply jewelry labor. Bars (TT Bar, KG Bar, GOLD 9999) never get the labor multiplier.

- DB storage: `spreadPremiumAed` column (numeric) is reused to store the spread **percentage** (not a flat AED buffer). `laborCostPercent` column stores labor %. No migration needed — both columns existed from a prior iteration.

- Admin in-memory state: `adminSpreadPercent` and `adminLaborPercent` are module-level vars in `prices.ts`, loaded from DB on startup via `loadAdminConfig()`. PATCH /api/prices with `{spreadPremiumPercent, laborCostPercent}` updates both DB and in-memory vars; `liveSpot.aedPerGram` is re-computed immediately so the next 1s poll picks up the change instantly (no restart needed).

- Jewelry purities (22K/21K/18K): `Adjusted_Base × purity × (1 + laborPct/100)` applied in `live-price.tsx`. Bar/bullion rows use `Adjusted_Base × purity` only.

- Free feed formula (verified against livepriceofgold.com Dubai AED/gram — matches to 1 cent):
  `Ask = XAUUSD` (ASK_OFFSET_USD = 0), `Bid = Ask − 0.30` (BID_ASK_SPREAD_USD = 0.30).
  Daily Low/High tracked in-memory from XAUUSD since UTC midnight (reset on day rollover, not persisted).
  **How to apply:** constants live as `ASK_OFFSET_USD = 0` / `BID_ASK_SPREAD_USD = 0.30` in `prices.ts`. Do NOT restore a +offset — it was wrong.

- The paid GoldAPI.io feed (`liveApiProvider`, `liveApiKey`, `paidLiveSpot`, `feedSource`, `paidFeedError`) was permanently removed from `prices.ts`. The socket feed from livepriceofgold.com is the only live source.

- `app.disable("etag")` is set globally in `app.ts`, and `/prices/spot` sets `Cache-Control: no-store`; the frontend poll uses `staleTime: 0, gcTime: 0`.
  **Why:** ETag conditional-GET returned 304s on byte-identical ticks, which looked "stale" even when data was correct.

- API server `dev` script is `build && start` (no hot reload). After editing `routes/*.ts`, restart the `API Server` workflow.

- The "Making Rate / Making Amt" fields in invoices are a separate, independent, manual per-row labor charge (not `laborCostPercent`). Do not confuse the two.
