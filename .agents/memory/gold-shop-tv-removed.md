---
name: Gold-shop TV board fully removed
description: The entire TV/showroom board system was hard-deleted — every file, route, DB column, generated type, and UI reference is gone.
---

## Rule
The Gold Shop app no longer has any live price polling or TV/showroom display board. Do not re-add any of the following:
- `/tv` route or showroom-board component
- `live-price.tsx` React context
- UniRateAPI, GoldAPI, Swissquote, or Yahoo Finance polling
- `prices.ts` API route (live prices route file)
- TV columns in `prices` table (`tv_show_*`, `spread_premium_aed`, `labor_cost_percent`, etc.)
- `showroom_logo_url`, `uni_rate_api_token`, `uni_rate_api_enabled` in `company_settings`

## What was removed
- Files deleted: `artifacts/api-server/src/routes/prices.ts`, `artifacts/gold-shop/src/pages/showroom-board.tsx`, `artifacts/gold-shop/src/context/live-price.tsx`, `artifacts/api-server/daily_hl.json`
- DB columns dropped: all `tv_show_*`, `spread_premium_aed`, `labor_cost_percent`, `gold_9999_offset`, `jewellery_22k_offset`, `pre_live_gold_9999_rate`, `live_gold_*` columns from `prices`; `showroom_logo_url`, `uni_rate_api_token`, `uni_rate_api_enabled` from `company_settings`
- API routes removed: `/settings/public`, `/prices/spot`, `/prices/public` from OpenAPI spec and router
- Generated types emptied: `PublicPrices`, `PublicSettings`, `SpotPrice`

## What remains (intentionally kept)
- `tvVisible` column in `price_items` table — still in DB/schema; the admin UI no longer shows the toggle but the column is dormant
- `manualInvoiceMode` column in `prices` table — still active (controls whether invoices use admin-set rates)
- `price_items` table and `/prices/items` routes — still used for the admin price items management page

**Why:** User requested hard-removal of entire TV/showroom board system to simplify the app.

**How to apply:** If asked to add any live pricing, real-time gold rates, or TV display features, build them fresh from scratch — do not assume any of the old infrastructure exists.
