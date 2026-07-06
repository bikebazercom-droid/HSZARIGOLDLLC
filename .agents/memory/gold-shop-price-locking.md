---
name: Gold-shop invoice price-locking
description: Invoices and invoice line items are immutable numeric snapshots; detail/PDF views must never re-derive rates from live sources.
---

Invoices and their line items are write-once financial records. Once an invoice is created, its metal rate, purity multiplier, and computed totals must never change or be recalculated from a live source (GoldAPI, prices dashboard) again.

**Why:** Financial documents (invoices, receipts) must remain historically accurate regardless of later price/purity changes. Recomputing from live data on read would silently alter a customer's already-issued invoice.

**How to apply:**
- `invoices.metalRate` (invoice-level) and `invoice_items.unitPrice` (per-item) store the literal frozen rate at time of sale.
- `invoice_items.purityMultiplier` stores the literal frozen decimal multiplier (e.g. 0.995) used for that line's pure-weight calc; `invoice_items.purity` keeps the human-readable label/text.
- There is intentionally no PUT/PATCH route for invoices or invoice items — immutability is enforced by absence of an update path, not just convention.
- Any invoice detail/print/PDF view must render only these stored fields from the GET response. Never call live price/rate endpoints (e.g. `useGetPrices`, GoldAPI) from an invoice view/PDF page.
- When adding new invoice-related UI, grep for `useGetPrices`/`goldapi` usage in that file before shipping to confirm no live-fetch leak.
