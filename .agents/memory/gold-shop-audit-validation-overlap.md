---
name: Gold-shop audit validation overlap
description: Distinguishes genuine audit-guard failures from fixture collisions caused by overlapping completion checks.
---

Completion validation may launch the standalone invoice-delete audit at the same time as the aggregate audit-guards command, which invokes that same audit again. Their shared deterministic invoice-number fixture can then collide even though each suite passes when run serially.

The aggregate audit guards and browser-PDF regression also serialize on the same suite-registry file lock. A long browser run can exhaust the audit suite's lock-wait budget, while an overly tight Playwright test timeout can expire during fixture-heavy setup before cleanup releases that lock.

**Why:** Completion checks have produced duplicate-invoice collisions and lock-wait failures only under overlapping commands even though the affected suites pass cleanly when run serially. The browser suite also exhausted a whole-test timeout while an already-open UI menu was ready, confirming cumulative fixture/PDF time rather than a stuck selector.

**How to apply:** If completion validation reports duplicate fixtures, a bare early `flock` failure, or a browser timeout near the whole-test budget, inspect the retained snapshot and rerun the affected suites serially. Keep the browser test budget long enough to include exact cleanup; treat assertion-specific failures as real until investigated.