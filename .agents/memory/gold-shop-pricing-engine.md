---
name: Gold-shop pricing engine (spot-based)
description: How the 24K base rate and all downstream rate rows are computed from international XAU/USD spot, and how admin spread/labor config feeds in.
---

The pricing engine was restructured to derive `Base_24K_AED` from the international gold spot price (XAU/USD) instead of a Dubai retail scrape.

- Formula: `Base_24K_AED = (XAU_USD / 31.1034768) * 3.6725`, then `Final_24K = Base_24K_AED + Admin_Spread_Buffer`. All rate rows (TT Bar 0.9999, GOLD 0.9999, GOLD KG 0.9999, KG BAR 0.995, jewelry 22K/21K/18K) are recalculated from `Final_24K`.
  **Why:** international spot is the pricing source of truth requested by the business; the old Dubai scrape source (`GXAUUSD_AED`) is kept only as a fallback if raw `XAUUSD` isn't available.
- Admin-configurable `spreadPremiumAed` (flat AED buffer added to `Base_24K_AED`) and `laborCostPercent` (% markup) live in the `prices` table, alongside the pre-existing rate columns.
  **Why:** business needed a way to add margin/labor cost on top of raw spot without hardcoding it.
- `laborCostPercent` markup applies **only** to jewelry purities (22K/21K/18K) shown/used in the invoice line-item "Metal Rate", not to bullion/bar products (TT Bar, KG Bar, GOLD 9999, GOLD KG 9999).
  **How to apply:** when adding new rate rows or invoice rate-resolution paths, check whether the row represents jewelry (labor applies) vs. bullion/bar (labor does not apply).
- The invoice "Making Rate" / "Making Amt." fields are a **separate, pre-existing, manual** labor-charge input (defaults to 0, has a "Suggested: {metalRate} AED/g" helper button) — unrelated to `laborCostPercent`. Don't confuse the two; `laborCostPercent` is already baked into the displayed "Metal Rate", "Making Rate" is an additional manual charge on top.
- The API server's `dev` script runs `build && start` once at boot — it does **not** hot-reload route/business-logic changes. After editing `artifacts/api-server/src/routes/*.ts`, you must restart the `API Server` workflow to see the change reflected in responses (Vite HMR on the frontend does NOT imply the backend picked up changes).
