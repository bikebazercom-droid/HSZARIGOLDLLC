---
name: Destructive-suite fixture isolation
description: Durable rules for how destructive test suites own and recover their DB fixtures on the shared dev database.
---

Rules:
- Cleanup/recovery of test fixtures must target only exact IDs durably recorded at creation time — never text-prefix or tag matching, which can hit legitimate shop data.
- Registration must be atomic with creation (server-side, same transaction); registering after the HTTP response leaves a crash window with an unrecoverable committed record.
- All destructive suites (including the browser PDF one) serialize on ONE shared lock; liveness of a run is established by that serialization, with an age gate only as defense in depth. Recovery claims must themselves be lease-based so a recovery killed mid-claim is reclaimable.
- The suite and browser-PDF registries share tables but are disjoint namespaces; neither recovery path may mutate the other's runs, or a live run gets abandoned and its fixtures wrongly reaped.
- Recovery scopes and deleters must stay namespace-aware, and the deleter must receive the owning run ID so it can prove parent/child ownership before removing related records.
- Registered stock batches are FIFO-private: normal requests skip all registered batches, and suite requests may consume only batches registered to their own run.
- Stock recovery takes the global stock-mutation lock and reverses only the owned movement deltas/FIFO slices; never rebuild a whole category aggregate, which would overwrite unrelated shortfalls or concurrent changes.
- Mutations that create dependent fixture records must reject registered parents owned by another run (or by no supplied run), preventing cross-run graphs that exact-ID cleanup cannot safely unwind.

**Why:** hard kills skip in-process cleanup; age alone cannot prove an owner is dead; cross-run parent references or FIFO consumption can make an owned fixture undeletable or cause cleanup to alter unrelated live data.

**How to apply:** new destructive suites reuse the lock-wrapped registry lifecycle, use a namespace-specific recovery scope, propagate the run ID through all create/mutation/FIFO paths, and finalize in `finally`. With the DB pool imported, set `process.exitCode` rather than calling `process.exit()`.
