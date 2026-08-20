---
name: Wholesale oversell returns
description: How physical returns reconcile wholesale deliveries that exceeded available FIFO stock.
---

Wholesale FIFO consumption records must persist whether a null source purchase represents a deliberate oversell shortfall. A physical return may reconcile such a shortfall by increasing its returned amount, but must not fabricate a new supplier purchase lot. A consumption from a real purchase lot whose source later disappears is an inventory-integrity conflict and must be rejected.

**Why:** A nullable source purchase ID alone is ambiguous because the foreign key is cleared if a real purchase row is deleted. Treating both cases alike can create stock without a matching FIFO lot, or silently hide a missing source batch.

**How to apply:** When adding wholesale return or FIFO behavior, preserve the shortfall marker. Restore remaining weight only to an existing source lot; reconcile marked shortfalls through their recorded deficit; abort the transaction for an unmarked slice with no source lot.