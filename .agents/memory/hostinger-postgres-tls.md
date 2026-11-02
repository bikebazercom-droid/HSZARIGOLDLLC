---
name: Hostinger PostgreSQL TLS choice
description: User-directed TLS behavior for Supabase PostgreSQL connections hosted on Hostinger.
---

The user explicitly wants the production PostgreSQL connection to keep TLS encryption while setting `rejectUnauthorized: false`, without depending on a CA file or SSL configuration environment variables. The shared pool is used by Drizzle, startup price seeding, and the PostgreSQL session store.

**Why:** Hostinger repeatedly failed startup with `self-signed certificate in certificate chain`, returning 503s. The user chose a permanent code-level workaround after being told it disables server identity verification and permits man-in-the-middle impersonation.

**How to apply:** Preserve this behavior in the shared database pool and production bundle unless the user asks to change it. If proposing to restore certificate verification, explain the tradeoff and confirm first; retain a clear startup warning.
