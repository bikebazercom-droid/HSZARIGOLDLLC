---
name: FIFO statement test isolation
description: Shared-database isolation rules for statement tests that exercise FIFO and live stock.
---

Statement reconciliation tests must not assume an empty database. Remove stale tagged fixtures before capturing a live-stock baseline, reserve and verify an otherwise empty earliest date range, and verify cleanup restores every touched category. Runs against the shared database must also be serialized across processes.

**Why:** Date filters isolate report totals but do not isolate FIFO: sales consume the oldest open batches across all data. A stale fixture or older shared batch can silently change COGS while live stock also includes pre-existing balances. Run-unique fixture tags do not prevent one simultaneous preflight from deleting another run's fixtures.

**How to apply:** For integration tests that reconcile statements, FIFO, and stock, invoke them through their package script so the cross-process lock is honored; preflight the reserved period, use run-unique tags, delete invoices before purchases, validate every cleanup response, and compare final stock to the captured baseline.