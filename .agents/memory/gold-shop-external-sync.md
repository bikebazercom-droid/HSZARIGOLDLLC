---
name: Gold-shop external sync architecture
description: How the ExternalSync service, TV board, and Settings TV tab are wired together.
---

## Architecture

- **Service**: `artifacts/api-server/src/services/external-sync.ts`
  - Started once from `index.ts` via `startExternalSyncLoop()` — singleton interval, 5s default.
  - Step 1: if `externalSyncEnabled=true` in DB, fetches configured URL (default: hazarigold.com) with cheerio.
  - Step 2: hazarigold.com is Next.js client-rendered, so static HTML prices = 0.00. Scraper returns null → falls back.
  - Step 3: UniRateAPI fallback using `UNIRATE_API_KEY` env var (or DB-stored token).
  - Stores state in module-level `state` object (in-memory, reset on restart).
  - Broadcasts `PRICE_MUTATION` via Socket.IO on every successful tick.

- **TV Route**: `artifacts/api-server/src/routes/tv.ts`
  - `GET /api/tv/prices` — public (no auth), returns sync state + computed item prices from price_items table.
  - `GET /api/tv/test` — runs one immediate sync tick and returns result (used by Settings test button).
  - Mounted before `requireAuth` in `routes/index.ts`.

- **Prices Compatibility Route**: `artifacts/api-server/src/routes/prices.ts`
  - `GET /api/prices` — auth-required, adapts ExternalSync state to the flat PricesData shape invoice page expects.
  - Returns `goldPricePerGram`, `gold9999Rate`, karat rates, etc. derived from `baseAedPerGram`.

- **DB columns** added to `company_settings`: `external_sync_url`, `external_sync_enabled`, `uni_rate_api_token`, `uni_rate_api_enabled`.

- **TV page**: `artifacts/gold-shop/src/pages/tv-display.tsx` — public route `/tv`, no auth required.
  - Socket.IO subscription: reconnects automatically, listens to `PRICE_MUTATION` and re-fetches `/api/tv/prices`.
  - Falls back to polling every 10s for resilience.

- **Settings TV tab**: Settings → "Live TV & Sync" tab.
  - Toggle and URL field for external scrape config.
  - UniRateAPI key management (stored in DB, never returned to client).
  - Test Connection button calls `GET /api/tv/test`.
  - Live price feed table: polls `/api/tv/prices` every 5s while tab is active.

- **Invoice integration**: `artifacts/gold-shop/src/pages/invoices/new.tsx`
  - Polls `/api/tv/prices` every 5s (in addition to existing `/api/prices` poll).
  - Populates `liveAed` (baseAedPerGram) and `tvPriceMap` from TV prices response.
  - `tvPriceMap` maps item names → AED/gram for `getRateForDesc` — highest priority override.

## Key constraints

**Why:** hazarigold.com is a Next.js SSR/CSR hybrid and prices are loaded via WebSocket on the client — static HTML fetch always returns 0.00. The scraper is built but currently falls through to UniRateAPI as the actual data source.

**How to apply:** If hazarigold.com ever exposes a static API (e.g. `/api/prices`), the scraper will pick it up automatically since `externalSyncEnabled=true` routes through the cheerio parser first. No code change needed.

## Rebuild after schema changes

When `lib/db` schema changes, run `cd lib/db && npx tsc -p tsconfig.json` to update dist/ before TypeScript project references resolve correctly. Same for `lib/api-client-react` when its generated types change.
