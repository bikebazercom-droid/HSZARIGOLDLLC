---
name: Wholesale fixed-return allocation
description: Accounting order and ledger effects when physically returned wholesale goods include already-fixed metal.
---

Physical returns allocate returned pure grams to the still-open metal obligation first. Any remainder reverses fixed metal: originally fixed invoices use cumulative pro-rata snapshot AED, while originally unfixed invoices consume the most recent per-item rate-fix allocations first. Making always reverses cumulative pro-rata by physical gross weight.

**Why:** Fixed metal no longer exists in the trader’s pure-gram obligation. Subtracting all returned pure grams would drive that ledger negative, while averaging changing rate-fix totals can misstate multi-rate returns and lose rounded residual AED.

**How to apply:** Post the return ledger’s pure delta for only the open portion. Post its AED delta for pro-rata making plus fixed metal reversed. Track cumulative return counters on fixed allocations so partial returns sum exactly to each allocation’s original AED; restore FIFO grams and COGS for the full physical quantity.