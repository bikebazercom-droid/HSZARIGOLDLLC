---
name: Gold-shop pricing engine (spot-based)
description: How the 24K base rate and all downstream rate rows are computed from international XAU/USD spot. No admin spread or labor markup — removed permanently.
---

The pricing engine derives `Base_24K_AED` directly from the international gold spot price (XAU/USD).

- Formula: `Base_24K_AED = (Live_ASK_Price_USD / 31.1034768) × 3.6725`
  All rate rows (TT Bar 0.9999, GOLD 0.9999, GOLD KG 0.9999, KG BAR 0.995, jewelry 22K/21K/18K) are derived from `Base_24K_AED` by pure purity multiplication — no spread, no labor markup.
  **Why:** international spot is the pricing source of truth; the business no longer uses admin-configurable spread or labor %. Both fields (`spreadPremiumAed`, `laborCostPercent`) were permanently removed from the API surface and all frontend logic (components, context, invoice page) — DB columns kept to avoid a migration.
  **How to apply:** `aedPerGram` from `/prices/spot` IS `Base_24K_AED` (verified vs. livepriceofgold.com Dubai display to ±1¢). Do not re-introduce a spread offset.

- Jewelry purities (22K/21K/18K): rate = `Base_24K_AED × (karat / 24)`. No labor multiplier.
  Previously `laborCostPercent` was applied to jewelry rows only. That multiplier is now fully removed everywhere: `live-price.tsx`, `getRateForPurity`, `getRateForDesc`, `resolvePrimaryRate`, `invoices/new.tsx`.

- Free feed formula (verified against livepriceofgold.com Dubai AED/gram — matches to 1 cent):
  `Ask = XAUUSD` (ASK_OFFSET_USD = 0), `Bid = Ask − 0.30` (BID_ASK_SPREAD_USD = 0.30).
  Daily Low/High tracked in-memory from XAUUSD since UTC midnight (reset on day rollover, not persisted).
  **How to apply:** constants live as `ASK_OFFSET_USD = 0` / `BID_ASK_SPREAD_USD = 0.30` in `prices.ts`. Do NOT restore a +offset — it was wrong.

- The paid GoldAPI.io feed (`liveApiProvider`, `liveApiKey`, `paidLiveSpot`, `feedSource`, `paidFeedError`) was permanently removed from `prices.ts`. The socket feed from livepriceofgold.com is the only live source.

- `app.disable("etag")` is set globally in `app.ts`, and `/prices/spot` sets `Cache-Control: no-store`; the frontend poll uses `staleTime: 0, gcTime: 0`.
  **Why:** ETag conditional-GET returned 304s on byte-identical ticks, which looked "stale" even when data was correct.

- API server `dev` script is `build && start` (no hot reload). After editing `routes/*.ts`, restart the `API Server` workflow.

- The "Making Rate / Making Amt" fields in invoices are a separate, independent, manual per-row labor charge (not `laborCostPercent`). Do not confuse the two.
