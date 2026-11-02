---
name: Hostinger startup schema bootstrap
description: Production database tables may be absent when the API first connects, so startup schema creation must precede data migrations and seeds.
---

Treat the production database as potentially missing application tables. Do not assume a separate schema push has already run.

**Why:** Hostinger startup reached the category data migration while `stock_levels` was absent, causing PostgreSQL error `42P01` and a retry loop.

**How to apply:** Create the required core tables idempotently and in dependency order before migrations that query them, session initialization, admin seeding, or readiness. The database role must have the DDL privileges needed for this bootstrap.
