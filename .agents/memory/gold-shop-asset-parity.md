---
name: Gold-shop core asset parity
description: Rule for adding new metal/karat rate types to the Live Prices system so they behave identically to existing assets (TT. BAR, KG BAR, GOLD, Silver).
---

The Live Prices system (`prices.tsx` + `prices` table + `/api/prices` routes) has one uniform pattern for every "core asset" (TT. BAR 0.995/0.999, KG BAR 0.995, GOLD 0.9999 → `gold9999Rate`, Silver 0.999, Gold Jewelry 22K/21K/18K).

Any UI surface that displays a core asset's rate (Price List, TV/showroom display, invoices) must read the same persisted DB field — never recompute `goldBullionRate × factor` independently in more than one place. A prior bug: the showroom TV board recomputed rates client-side from raw `goldBullionRate` while the Price List read the persisted per-asset field, so a manually-edited rate (while Live Mode was disconnected) would show correctly on the Price List but silently revert to the auto-ratio on the TV board.

**Why:** An earlier iteration made the three jewelry-karat cards "derived/read-only" (computed inline as `goldBullionRate × purity factor`, no DB column, no manual save). This was rejected — the user wanted full parity with the other 5 assets, including independent manual editing and DB storage. Any new gold/silver product type should default to full parity, not a derived shortcut, unless explicitly asked for read-only behavior.

**How to apply — a first-class asset needs all of:**
- A dedicated `numeric(12,4)` column + a `preLive<X>Rate` snapshot column in `lib/db/src/schema/prices.ts`.
- Read/write handling in `artifacts/api-server/src/routes/prices.ts`: `parsePrices()`, the PUT body/updates, the live `connect` route (compute from `gold24kAed × karat factor` and snapshot the pre-live value), and the `disconnect` route (restore from the snapshot).
- Properties added to both `Prices` and `PricesInput` schemas in `lib/api-spec/openapi.yaml`, then `pnpm --filter @workspace/api-spec run codegen`.
- A manual `AssetCard` entry in `prices.tsx`'s `assetCards` array (not a separate "derived" card type) plus the new `RateKey` and `localRates` state field.
- In `artifacts/gold-shop/src/pages/invoices/new.tsx`, `getRateForDesc`/`getRateForPurity` must read the saved/live DB field directly — never recompute inline from another asset's spot rate.
