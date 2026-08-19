---
name: Gold-shop audit validation overlap
description: Distinguishes genuine audit-guard failures from fixture collisions caused by overlapping completion checks.
---

Completion validation may launch the standalone invoice-delete audit at the same time as the aggregate audit-guards command, which invokes that same audit again. Their shared deterministic invoice-number fixture can then collide even though each suite passes when run serially.

**Why:** A completion check produced a duplicate-invoice insert failure only under overlapping commands; the full aggregate guard chain passed cleanly when run by itself through the local API proxy.

**How to apply:** If completion validation reports a duplicate test invoice while these two checks overlap, rerun the aggregate guard chain serially with the local proxied API URL. Treat other assertion failures as real until investigated.