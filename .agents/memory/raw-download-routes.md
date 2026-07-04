---
name: Raw PDF/file download routes
description: Convention for binary file download endpoints in the api-server that are intentionally excluded from the OpenAPI spec.
---

Binary/file-download endpoints (PDF, CSV, etc.) in `artifacts/api-server` are implemented as plain Express routes directly in the router file, not declared in `lib/api-spec/openapi.yaml` and not run through Orval codegen.

**Why:** Orval-generated hooks/Zod schemas are for JSON request/response contracts. File downloads return raw binary streams (e.g. `res.setHeader("Content-Type", "application/pdf")`, `doc.pipe(res)`), which don't fit the JSON contract-first codegen flow. Keeping them as raw routes avoids fighting the codegen for no benefit.

**How to apply:** When adding a new file-download endpoint, follow the existing pattern of sibling raw routes in the same router file (e.g. look for other `/download` or `/pdf` routes already present). Call them from the frontend via a direct URL (`window.open("/api/....pdf?...")` or an `<a href>`), not via a generated hook. Since `/api` is routed by the shared proxy as its own path prefix, relative absolute paths like `/api/...` work regardless of the calling frontend artifact's own `BASE_PATH`.
