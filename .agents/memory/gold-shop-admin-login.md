---
name: Gold-shop seeded admin login
description: Why the "default" admin credentials in the seed script may not work for e2e testing.
---

The api-server seed script only creates a default admin (mobile `0000000000`, PIN `1234`) when no admin user exists yet. In an already-used dev DB, an admin was created earlier with different real credentials, so the seed defaults silently don't apply.

**Why:** Wasted multiple e2e test attempts assuming the seed defaults always work; they only work on a truly empty `users` table.

**How to apply:** Before writing an e2e test plan that needs to log in, query the `users` table (`SELECT username, mobile, role FROM users`) to see what accounts actually exist. If you don't know the real PIN (it's bcrypt-hashed, unrecoverable), don't guess — either ask the user, or insert a temporary throwaway admin/staff user with a known bcrypt hash for testing purposes and delete it after the test run.
