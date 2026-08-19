---
name: FIFO statement test isolation
description: Shared-database isolation rules for statement tests that exercise FIFO and live stock.
---

Statement reconciliation tests must not assume an empty database. Recover a crashed prior run's records only by the exact IDs in the durable suite run registry (never by tag/prefix matching), fail safely if the reserved earliest date range is still occupied, and verify cleanup restores every touched category. Runs against the shared database must also be serialized across processes.

**Why:** Date filters isolate report totals but do not isolate FIFO: sales consume the oldest open batches across all data. A stale fixture or older shared batch can silently change COGS while live stock also includes pre-existing balances. Run-unique fixture tags do not prevent one simultaneous preflight from deleting another run's fixtures.

**How to apply:** For integration tests that reconcile statements, FIFO, and stock, invoke them through their package script so the shared cross-process lock is honored; let registry recovery handle leftovers, abort (don't delete) when unowned records occupy the reserved period, delete invoices before purchases, validate every cleanup response, and compare final stock to the captured baseline.