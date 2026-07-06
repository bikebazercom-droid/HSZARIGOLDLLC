---
name: Gold-shop public (unauthenticated) routes pattern
description: How to add a page/endpoint that must work without a login session, e.g. an always-on showroom display board.
---

The app's default posture is authenticated-only: the API mounts `requireAuth` globally in `routes/index.ts`, and the frontend wraps every route in an `AuthGate` inside `AuthProvider`. Adding one unauthenticated surface requires two separate bypasses, not one:

1. **API side**: export a small dedicated router from the feature's route file (not the main authenticated router for that resource) and mount it in `routes/index.ts` *before* the `router.use(requireAuth)` line. Only expose the minimal, non-sensitive fields needed — never reuse the full authenticated response shape verbatim.
2. **Frontend side**: `AuthProvider` still wraps the whole app and will still fire its "who am I" check (expect a benign 401 in console on a public page — this is fine, it doesn't redirect, it just sets `user = null`). The routing itself needs a wouter `<Switch>` matched *before* the `AuthGate` fallback, so the public route resolves without ever needing `user` to be set.

**Why:** the codebase has no existing "public page" precedent — auth gating is baked in at both the Express middleware layer and the top-level router layer, so a single change (e.g. skipping the frontend gate) is not sufficient; the API will still 401.

**How to apply:** when asked for a public/kiosk/display-only page (or any other route that must work for anonymous users), grep for `requireAuth` placement in `routes/index.ts` and the `AuthGate`/`Switch` structure in `App.tsx` first, then replicate this two-layer bypass rather than trying to special-case the existing authenticated router.
