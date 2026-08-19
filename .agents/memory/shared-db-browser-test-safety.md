---
name: Shared-DB browser test safety
description: Safety requirements for end-to-end checks that create and delete records in the shared development database.
---

Browser regressions that mutate the shared development database must be serialized, explicitly gated to a development target, and clean up only record IDs created by their own run. Never use prefix-wide deletion where concurrent or legitimate data could match.

Privileged test credentials must be high entropy and short-lived. Use a reserved multi-field identity so a later run can safely remove an account left by a hard process termination; do not embed or fall back to seeded credentials.

**Why:** Normal `finally` cleanup does not run after SIGKILL, OOM, or host termination, and broad cleanup can delete another run's fixtures. A stranded low-entropy admin is a security issue even when the test normally passes.

**How to apply:** For any browser test that writes shared data, add an internal lock, explicit dev-only target guard, per-run ID registries with reverse-order cleanup, and durable stale cleanup restricted by an unmistakable reserved identity.