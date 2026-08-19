---
name: PDF e2e run registry
description: Ownership/recovery model for browser PDF test fixtures in the shared dev DB
---
Browser PDF test fixtures are owned via a run registry (pdf_test_runs / pdf_test_fixtures), keyed by unguessable 32-hex run IDs authenticated to the ephemeral test admin.

Rules that must hold:
- Fixture registration happens INSIDE the same DB transaction as record creation (invoices/stock POST) — never after.
- Cleanup/recovery deletes only exact registered entity IDs; never prefix-wide deletion of PDFE2E-named rows.
- Stale ephemeral admins are deleted only by owner IDs recorded in run rows — never by scanning mutable username/fullName fields (those are defense-in-depth predicates only).
- Startup abandonment is age-gated (>5 min) so a concurrent/live run is never marked abandoned; `/recovery-complete` locks each run row (FOR UPDATE) and 409s if any target is not status=abandoned.
- `/complete` marks status=completed but keeps the row so a crashed runner's admin stays findable by ownerUserId.
- The suite itself exercises recovery via a probe run plus unregistered decoy records that must survive.
- DELETE routes unregister fixture rows in the same transaction — the registry must only list records that still exist, so end-of-run verification can tell cleaned runs from interrupted ones.
- The runner deletes run rows + admin ONLY after the suite passed AND zero fixtures remain (finalizeRun); otherwise it retains the registry and deactivates the admin for later age-gated recovery. An interruption-recovery regression script runs before the browser suite under the same flock.

**Why:** SIGKILL bypasses Playwright `finally` cleanup; the shared dev DB must never lose real data or an active concurrent run's registry.
