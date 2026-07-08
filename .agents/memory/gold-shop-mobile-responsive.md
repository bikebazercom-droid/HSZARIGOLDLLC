---
name: Gold-shop mobile responsive patterns
description: Conventions applied when making the admin app mobile-friendly — fixed-width print documents, table overflow, header stacking.
---

The app (dashboard, invoices list/new/detail, /tv) was made mobile-responsive with Tailwind. Key pattern worth staying consistent with:

**Print-fidelity documents (invoice detail `[id].tsx`) are NOT reflowed for mobile.** The invoice is a fixed 210mm-wide A4 document (uses inline px/mm styles, not Tailwind) — this must stay pixel-accurate for print/PDF export. On narrow viewports it is wrapped in its own `overflow-x-auto` container (with `print:overflow-visible` so print output is unaffected) so only that document scrolls horizontally, never the outer page/body.

**Why:** Reflowing the invoice for mobile would break print/PDF layout fidelity (uses `html2pdf.js` against the same DOM node). Isolating the scroll to a wrapper div gets mobile usability without touching the print-critical inline styles.

**How to apply:** Any new print/PDF-exported document component should follow the same wrapper pattern — fixed width + own `overflow-x-auto` wrapper — rather than trying to make the print layout itself responsive.

Other pages (dashboard, invoices list, invoice line-item entry table) use plain Tailwind responsive classes: headers stack `flex-col sm:flex-row`, data tables sit in `overflow-x-auto` wrappers (not `overflow-hidden`, which clips content instead of scrolling it), and side-by-side detail cards use `grid-cols-1 lg:grid-cols-2`.
