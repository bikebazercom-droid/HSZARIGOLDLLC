---
name: Dashboard test-category isolation
description: Why hidden automated-test stock categories must be removed from all dashboard aggregate inputs.
---

Categories beginning with `test_` or `ws_shortfall_` must be excluded from every dashboard aggregate source, including invoice counts, revenue, payment totals, purchases, stock, FIFO COGS, wholesale ledgers, returns, statements, and category rows.

**Why:** Filtering only the rendered category breakdown conceals fixture labels but still lets fixture values alter headline stock, revenue, COGS, profit, and invoice totals, creating internally inconsistent dashboards.

**How to apply:** Whenever a dashboard query gains a category-bearing source or an invoice-level aggregate, apply the shared visibility predicate at the SQL source and prove with a registered fixture that both rows and totals remain unchanged.