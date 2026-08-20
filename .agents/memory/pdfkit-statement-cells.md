---
name: Lossless PDFKit statement cells
description: Rules for preserving long identifiers and stored numeric precision in branded PDFKit statements.
---

Archival statement fields such as bill references, supplier names, filter criteria, and stored decimal snapshots must never use `lineBreak: false` or ellipsis. Measure wrapped text before drawing, reserve the resulting height, repeat table headers after page breaks, and keep closing branding on the final page only.

**Why:** A fixed-height PDFKit cell can silently hide part of a valid identifier. Extremely long accepted text can also exceed an entire page, so wrapping alone is not a complete safety boundary.

**How to apply:** Use a shared, documented maximum at the input contract, form, export preflight, and renderer. Reject legacy over-limit data explicitly, assert measured criteria/rows fit the printable body, and cover the exact accepted boundary with raw-PDF text checks plus rendered-page inspection.