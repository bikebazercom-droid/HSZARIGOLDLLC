---
name: Wholesale cash pricing
description: Business and reporting rules for the third wholesale pricing mode, Cash Payment.
---

Cash Payment is a persisted wholesale pricing type, not a display-only payment flag. It requires a positive item rate, values metal plus making immediately, leaves no open pure grams, and starts settled with cash as the payment mode.

Its ledger must record both sides: the sale value and an equal immediate cash payment. A physical return reverses sale revenue and records an equal cash refund, keeping the trader's AED exposure at zero.

Revenue metrics include sale, rate-fix, and return events but exclude cash payment/refund settlement events. Cash-received metrics include payments minus refunds; outstanding-due metrics include all ledger deltas.

**Why:** Netting payment legs into revenue makes fully paid cash sales appear as zero revenue, while omitting refund legs makes returned cash sales create a false negative trader balance.

**How to apply:** Any new wholesale dashboard, statement, export, return path, or reconciliation must preserve the distinction between sale value, cash movement, and outstanding balance.