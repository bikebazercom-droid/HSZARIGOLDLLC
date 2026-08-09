---
name: Gold-shop FIFO batch COGS engine
description: Exact multi-batch FIFO COGS replaces weighted-average; consumers must read inventory_consumptions, and delete-order matters because of the cascade FK.
---

- COGS is exact per-batch FIFO: `inventory_consumptions` rows (invoice_id, invoice_item_id, purchase_id, weight_grams, cost_aed) written at invoice creation by the inventory engine; `stock_purchases.remaining_weight_grams` tracks open lot balances. Never recompute COGS from weighted averages — dashboards (KPIs, summary-cards, statement) all read the consumption ledger. Statement items with no consumption rows (custom/non-stock) fall back to category avg cost.
- Remaining stock value = SUM(remaining × price_per_gram) per lot, not purchase-total minus COGS.
- Shortfall (batches exhausted) is costed at category all-time avg rate with purchase_id NULL and surfaced as a stock warning; sales are never blocked.
- **Why the delete order matters:** `inventory_consumptions.invoice_id` has ON DELETE CASCADE, so invoice deletion must run the FIFO reversal (restore remaining, capped at lot weight) BEFORE deleting the invoice row — otherwise the cascade wipes the rows first and lot balances are silently never restored. Guarded by SELECT ... FOR UPDATE on the invoice to keep concurrent deletes single-shot.
- Invoice create is one atomic tx: invoice + items + stock deltas + consumeFifo. consumeFifo locks open batches FOR UPDATE ordered created_at, id (consistent order = no deadlock).
- Idempotent backfill script exists (`scripts/backfill-fifo.ts`); run by bundling with esbuild to cjs (`--external:pg-native`) since tsx isn't installed.

**FIFO order (Aug 2026):** batches consume in `purchase_date ASC, created_at ASC, id ASC` order — back-dated purchases are eaten before newer-dated ones regardless of insertion order. Statement PDF/xlsx ledger shows per-row invoice ref, exact cost/sale/profit, running per-bucket stock balance (opening seeded when startDate filters; live-balance grand total must respect the category filter), and compact consumed-batch refs.

**Statement format (Aug 2026):** statement PDF is a 5-section report — (1) Purchases & Product Listing (voucher `#BATCH-<id>`, cash outflow, metal credit), (2) Sales Invoices Ledger (selling rate, cash inflow, metal debit), (3) Realized Profit & Loss (exact FIFO COGS), (4) Live Remaining Stock Valuation (per batch; all-time snapshot, category-filterable but NOT date-filtered by design), (5) Consolidated Dual-Ledger Summary grid (cash in/out/net vs metal in/out/live balance from stock_levels). The xlsx export still uses the older 3-section layout. Every table's column widths must sum to exactly 762pt.
