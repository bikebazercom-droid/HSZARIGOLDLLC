---
name: Browser PDF Arabic rendering
description: Correct shaping, direction, and regression checks for Arabic text embedded in browser-generated jsPDF documents.
---

Pass logical-order Arabic text directly to jsPDF after embedding an Arabic-capable font such as Amiri, and leave jsPDF's global `setR2L` mode disabled. jsPDF's Arabic preprocessor already shapes the glyphs and handles their visual order; enabling `setR2L` applies a second reversal and produces visibly incorrect text.

**Why:** A statement header looked plausible in extracted text but rendered with reversed/disconnected Arabic after `setR2L(true)`. An isolated render matrix confirmed that logical text without global RTL mode is the correct jsPDF combination.

**How to apply:** Register the TTF through jsPDF's virtual file system, select that font, and send the original Unicode string to `text()`. Validate the rendered PDF visually. For extraction-based tests, compatibility-normalize output because tools may return Arabic presentation-form glyphs and reversed extraction order even when the page renders correctly.