---
name: Destructive-suite fixture isolation
description: Durable rules for how destructive test suites own and recover their DB fixtures on the shared dev database.
---

Rules:
- Cleanup/recovery of test fixtures must target only exact IDs durably recorded at creation time — never text-prefix or tag matching, which can hit legitimate shop data.
- Registration must be atomic with creation (server-side, same transaction); registering after the HTTP response leaves a crash window with an unrecoverable committed record.
- All destructive suites (including the browser PDF one) serialize on ONE shared lock; liveness of a run is established by that serialization, with an age gate only as defense in depth. Recovery claims must themselves be lease-based so a recovery killed mid-claim is reclaimable.
- The suite and browser-PDF registries share tables but are disjoint namespaces; neither recovery path may mutate the other's runs, or a live run gets abandoned and its fixtures wrongly reaped.

**Why:** hard kills skip in-process cleanup; age alone cannot prove an owner is dead; cross-namespace mutation caused a review-rejected live-run corruption scenario.

**How to apply:** new destructive suites reuse the existing suite-registry lifecycle (lock-wrapped package script, owned run, ownership header on creates, finalize-in-finally) instead of per-suite cleanup. Also: with the DB pool imported, `process.exit()` or SIGPIPE (piping suite output through `head`) kills a run mid-flight — set `process.exitCode` and let `finally` run.
