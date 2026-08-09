---
name: Gold-shop dual-ledger statement
description: Posting rules and conventions for the dual-ledger (cash + metal) account PDF
---

# Dual-ledger account statement (`GET /api/dashboard/ledger-pdf`, admin-only, raw PDF route outside OpenAPI)

- Posting rule: stock purchase = Cash Debit + Metal Credit; sale (invoice) = Cash Credit + Metal Debit. One ledger row per invoice (not per item); item descriptions become the narrative sub-line.
- Running balances = cumulative(credit − debit); rendered `<abs> CR` when ≥0 else `<abs> DR`, for both cash (2dp) and metal grams (3dp).
- `party` param matches supplier_name (purchases) OR customer_name (sales) via parameterized ILIKE; omitted/"all" = all parties.
- With `startDate`, an Opening Balance (brought forward) row seeds both running balances from party-scoped pre-period sums — and renders even when the period has zero transactions. Grand totals stay period-only.
- **Why:** a date-filtered account statement must show the true carried-forward balance, not a period-only net (architect review finding).
- 9 columns landscape, widths sum to exactly 762pt; narrative renders as a gray italic sub-line under Type & Narrative (row height +11pt).
- `stock_purchases.narrative` is an optional free-text column with full-stack parity (schema, API, OpenAPI, entry drawer, listing "Narrative / Batch Ref" column).
- Purchase entry drawer: Purchase Rate (AED/g) auto-computes Total Cost; editing total clears rate; clearing rate clears the auto total; manual totals (rate empty) are never touched by weight/unit changes.
