---
name: FIFO statement test isolation
description: Shared-database isolation rules for statement tests that exercise FIFO and live stock.
---

Statement reconciliation tests must not assume an empty database. Remove stale tagged fixtures before capturing a live-stock baseline, reserve and verify an otherwise empty earliest date range, and verify cleanup restores every touched category.

**Why:** Date filters isolate report totals but do not isolate FIFO: sales consume the oldest open batches across all data. A stale fixture or older shared batch can silently change COGS while live stock also includes pre-existing balances.

**How to apply:** For integration tests that reconcile statements, FIFO, and stock, preflight the reserved period, use run-unique tags, delete invoices before purchases, validate every cleanup response, and compare final stock to the captured baseline.