---
name: Wholesale making-charge lifecycle
description: Business accounting rules that keep wholesale invoices, settlements, trader ledger balances, and returns aligned.
---

For an unfixed wholesale delivery, making charges become an AED obligation immediately. A later rate fix adds only the newly fixed metal value to invoice AED, posted/settled AED, and the trader ledger. A physical return reverses the exact cumulative pro-rata making charge attributable to the returned unfixed goods.

Period reporting is event-dated: deliveries belong to the invoice date, rate fixes to the settlement date, and physical returns to the return date. Historical ranges must sum immutable events, not filter invoices and read their current net totals.

**Why:** Making is earned at delivery even while metal remains unfixed. Omitting it understates trader debt; reversing it incorrectly on partial returns creates cent drift and breaks reconciliation. Reading current invoice totals also back-propagates later fixes or returns into earlier statements and omits return-only periods.

**How to apply:** At every partial step, the invoice AED total, posted/settled AED, sum of immutable AED ledger deltas, and trader AED balance must reconcile. Use cumulative pro-rata return math rather than independently rounding each return. Date-filtered reports must project delivery, fix, and return events separately, including exact return COGS reversals.