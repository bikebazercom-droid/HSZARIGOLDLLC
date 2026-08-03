---
name: Gold-shop TV display (standalone rebuild)
description: TV board at /tv — UniRateAPI XAUT proxy for gold price, public route, no auth.
---

## Key facts

**Route:** `GET /api/tv/prices` (public, no auth) → served by `artifacts/api-server/src/routes/tv.ts`  
**Frontend:** `artifacts/gold-shop/src/pages/tv-display.tsx` — full-screen dark board, polling every 90s  
**App.tsx:** `/tv` route is added *before* the AuthGate in `PublicRouter`

## UniRateAPI gold price

UniRateAPI's `/api/rates` endpoint does NOT include `XAU` (gold spot).  
It includes `XAUT` = Tether Gold, a tokenised gold instrument backed 1:1 by one fine troy oz of physical gold.  
XAUT tracks XAU spot to within <0.1%.

**Formula:**
```
XAUT_per_USD = response.rates.XAUT   // e.g. 0.000247
USD_per_oz   = 1 / XAUT_per_USD      // e.g. 4044
```

The code tries `rates.XAU` first (in case a higher tier plan adds it), then falls back to `rates.XAUT`.

**Why:** UniRateAPI `/api/metals` returns 404; `/api/gold` returns 404. Only XAUT is available in paid standard rates.

**Bid/Ask synthesis:** `bid = mid - 0.45`, `ask = mid + 0.45` (≈$0.90 spread, typical gold market).

## Poll rate
90 seconds = 960 req/day — within UniRateAPI paid plan daily limit.  
Daily H/L resets at UTC midnight.

## Price items
TV board items come from `price_items` table where `tvVisible = true`, ordered by `display_order`.  
Admin can toggle visibility via the Price Items admin page.
