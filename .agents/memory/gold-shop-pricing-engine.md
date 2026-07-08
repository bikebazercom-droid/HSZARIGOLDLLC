---
name: Gold-shop pricing engine (spot-based)
description: How the 24K base rate and all downstream rate rows are computed from international XAU/USD spot, and how admin spread/labor config feeds in.
---

The pricing engine was restructured to derive `Base_24K_AED` from the international gold spot price (XAU/USD) instead of a Dubai retail scrape.

- Formula: `Base_24K_AED = (Live_ASK_Price_USD / 31.1034768) * 3.6725`, then `Final_24K = Base_24K_AED + Admin_Spread_Buffer` (spread can be +/-). All rate rows (TT Bar 0.9999, GOLD 0.9999, GOLD KG 0.9999, KG BAR 0.995, jewelry 22K/21K/18K) are recalculated from `Final_24K`.
  **Why:** international spot is the pricing source of truth requested by the business (Dubai scrape source `GXAUUSD_AED` is kept only as a fallback if raw `XAUUSD` is absent); base must derive from the market ASK, not the raw mid tick, since that's the shop's real execution price. Deriving from mid instead of ask caused visible drift versus the user's external reference (corrected 2026-07-08).
  **How to apply:** if this ever regresses, check that `baseAedPerGram` in `prices.ts` is computed from `askUsdPerOz`, not `usdPerOz`.
- Admin-configurable `spreadPremiumAed` (flat AED buffer added to `Base_24K_AED`) and `laborCostPercent` (% markup) live in the `prices` table, alongside the pre-existing rate columns.
  **Why:** business needed a way to add margin/labor cost on top of raw spot without hardcoding it.
- `laborCostPercent` markup applies **only** to jewelry purities (22K/21K/18K) shown/used in the invoice line-item "Metal Rate", not to bullion/bar products (TT Bar, KG Bar, GOLD 9999, GOLD KG 9999).
  **How to apply:** when adding new rate rows or invoice rate-resolution paths, check whether the row represents jewelry (labor applies) vs. bullion/bar (labor does not apply).
- The invoice "Making Rate" / "Making Amt." fields are a **separate, pre-existing, manual** labor-charge input (defaults to 0, has a "Suggested: {metalRate} AED/g" helper button) — unrelated to `laborCostPercent`. Don't confuse the two; `laborCostPercent` is already baked into the displayed "Metal Rate", "Making Rate" is an additional manual charge on top.
- The API server's `dev` script runs `build && start` once at boot — it does **not** hot-reload route/business-logic changes. After editing `artifacts/api-server/src/routes/*.ts`, you must restart the `API Server` workflow to see the change reflected in responses (Vite HMR on the frontend does NOT imply the backend picked up changes).
- The admin-facing "Global Price Control Panel" (spread + labor % editor) is a shared component (`GlobalPricingConfig` in gold-shop's components dir), rendered on both the Prices page and the top of the Admin Dashboard — not duplicated inline in each page.
  **Why:** avoids two copies of save/validation logic drifting apart; both pages get updates for free.
  **How to apply:** if further pricing-config UI/behavior changes are needed, edit the shared component once; don't re-inline it into a page.
- "Instant TV sync" is achieved purely via the existing 1s polling (`refetchInterval: 1000` against `/api/prices/spot`) plus the PATCH route updating server in-memory state immediately — no websocket infra was needed or added.
- The free feed only provides a single XAU/USD spot value (no real bid/ask/high/low), so its Bid/Ask are estimated with an **asymmetric** offset per explicit business spec (not a symmetric half-spread): `Estimated_Ask = Raw_XAUUSD + 1.04`, `Estimated_Bid = Estimated_Ask - 0.90`. Daily Low/High are tracked in-memory since UTC midnight and reset on day rollover (not persisted — restarting the API server resets the day's range).
  **Why:** no free upstream feed exposes real bid/ask/range data; offsets were given explicitly by the business, not derived — don't "simplify" back to a symmetric split.
  **How to apply:** the constants live as `ASK_OFFSET_USD`/`BID_ASK_SPREAD_USD` in `prices.ts`.
- `app.disable("etag")` is set globally in `app.ts`, and `/prices/spot` also sets `Cache-Control: no-store`; the frontend poll additionally uses `staleTime: 0, gcTime: 0`.
  **Why:** Express's default ETag conditional-GET returned 304s when a tick was byte-identical to the previous one, which the user perceived as "stale/cached" pricing even though the underlying data was correct — removed to guarantee every 1s poll is visibly a fresh, uncached fetch end-to-end.
- Dual price-feed source (admin-switchable, dashboard "Price Feed Source" dropdown): "free" = estimated bid/ask above; "goldapi" = real ask/bid/high_price/low_price fetched directly from GoldAPI.io using an admin-saved key (masked in all GET responses, never echoed raw). Both sources feed the same Ask-based `Base_24K_AED` formula so downstream rows (KG BAR 0.995, jewelry karats) are unaffected by which is active.
  **Why:** the free feed has no real bid/ask; GoldAPI.io was the only evaluated paid provider that actually returns bid/ask/high/low (MetalpriceAPI.com does not, so it was never implemented as a second real provider).
  **How to apply:** `/prices/spot` picks `paidLiveSpot` over `liveSpot` only once the paid feed has succeeded at least once (`paidLiveSpot != null`); until then, or if it's never configured, it silently serves the free feed. `feedSource`/`paidFeedError` in the response make the active source and any paid-fetch problem visible to the frontend.
- GoldAPI.io paid feed polls upstream every **30s**, not every 1s — the 1s cadence is preserved only for the frontend's own `/prices/spot` poll (which re-serves the latest cached tick). Once the paid feed has a successful tick, later transient failures (e.g. quota exceeded) keep serving that last-known-good tick with `paidFeedError` set, rather than flapping back to "free" every failed poll.
  **Why:** GoldAPI.io plans are metered by monthly request quota; 1s polling burns through a trial-tier quota in minutes (observed firsthand — a real trial key returned `403 Monthly API quota exceeded` after only a couple minutes of 1s polling during testing).
  **How to apply:** if bumping the paid-poll frequency, check the user's GoldAPI.io plan's request/month limit first.
