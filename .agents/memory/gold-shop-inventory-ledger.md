---
name: Gold-shop inventory stock ledger
description: Rules for the stock purchase / auto-deduction inventory system (stock_purchases, stock_levels, stock_movements)
---

Inventory is a movement ledger, not blocking control:
- **Rule:** Invoice creation never blocks on insufficient stock — it deducts anyway (levels can go negative) and returns `stockWarnings` in the response; the frontend shows destructive toasts. All level changes go through `applyStockDelta` (atomic upsert with RETURNING + movement-log row) — never update `stock_levels` directly.
- **Why:** A gold shop must never be prevented from making a sale because bookkeeping lags reality; and a separate SELECT-then-check races under concurrent sales, so warnings derive from the RETURNING balance.
- **How to apply:** Any new stock-affecting operation (sale, purchase, reversal, adjustment) must call `applyStockDelta` inside a transaction; deletions must use `DELETE ... RETURNING` and reverse only when a row was actually removed (prevents double-reversal). Invoice deletion reverses the invoice's net sale movements.

Category mapping quirk: invoice item "995" prices as tt_bar in the frontend rate engine but is its OWN stock bucket ("995"); all jewelry karats (22K/21K/18K) draw from the single `gold_jewelry_22k` stock pool. Mapping lives in `itemStockCategory` in the invoices route.
