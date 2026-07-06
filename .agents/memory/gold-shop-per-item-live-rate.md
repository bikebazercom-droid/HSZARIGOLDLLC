---
name: Gold-shop per-item live rate injection in invoices
description: How the New Invoice page derives each line item's own metal rate from live prices, vs. a single shared/global rate.
---

Each invoice line item computes and stores its own `rate` field (not a shared global `metalRate`), derived from the live-synced `prices` fields (`goldBullionRate`, `gold22kRate`, etc.) via description/purity lookup helpers. The row's rate re-derives automatically whenever description, purity, or the polled `prices` object changes (5s poll), and Pure Weight/Total recompute from that per-row rate.

**Why:** Different rows can hold different assets/purities in the same invoice, so a single shared rate would be wrong the moment more than one metal/purity appears on an invoice. Locking a single "live rate" at panel-open time (a prior `lockedDashboardRate` pattern) also went stale during a long checkout — replaced with continuous polling instead.

**How to apply:** When adding new invoice-adjacent UI that shows "the rate," always ask which row/asset it belongs to — never reintroduce a single page-level `metalRate` variable feeding multiple heterogeneous rows. A single blended/weighted-average rate (`blendedMetalRate`) is fine for header-level summary display and for the frozen invoice-level `metalRate` DB field, but must never drive per-item math. When live mode is connected, the reference rate becomes read-only (no manual override) since the live API is the sole source of truth; only show a manual override input when live mode is disconnected.
