---
name: Gold-shop purchase bills
description: Purchase Bill module conventions — bill lines materialize as FIFO stock batches, guarded delete, server-authoritative totals
---

# Purchase Bill conventions

- Each bill line inserts its own `stock_purchases` FIFO batch (narrative `Bill <no> · <purity>% purity (<type>)`) plus `applyStockDelta` (refType `purchase_bill`). This keeps inventory, dual-ledger, and statement outputs working with no special-casing.
- **Delete is guarded:** the delete transaction `SELECT ... FOR UPDATE`s linked batches and returns 409 if any `remainingWeightGrams < weightGrams` (stock partially/fully sold). Reversal only when batches are fully unconsumed.
  **Why:** unguarded reversal of consumed batches corrupts stock levels and FIFO COGS (architect-flagged severe issue).
- **Server-authoritative money math:** line total is recomputed as gross×rate+making (2dp); client value is only a cross-check (tolerance 0.05, else 400). Never trust client `lineTotalAed`.
- **How to apply:** any new document type that creates stock (transfers, returns) must follow the same three rules: materialize as FIFO batches, guard reversal on consumption, recompute money server-side.
- Known gap: the single stock-purchase DELETE in stock.ts lacks the same consumed-batch guard.
