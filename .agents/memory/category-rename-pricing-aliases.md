---
name: Category rename pricing aliases
description: Why inventory category terminology changes need pricing-path tests beyond label and database migrations.
---

When renaming an inventory category, treat any exact description strings used by rate dispatch as part of the behavioral contract. Keep legacy aliases for old records, add the canonical description explicitly, and test canonical and legacy descriptions in both live-rate and stored-rate modes.

**Why:** A canonical TEN TOLA BAR 9999 description once displayed correctly and persisted the right category, but missed an exact-string live-rate branch and silently received the 995 multiplier.

**How to apply:** For future category or product-description renames, trace exact-string classifiers and rate resolvers as well as forms, reports, and persisted IDs. Add focused assertions for every purity variant before rollout.