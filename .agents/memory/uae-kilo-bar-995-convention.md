---
name: UAE Kilo Bar 995 Pricing Convention
description: Dubai gold market uses 23/24 purity factor for 995 kilo bars, not 0.995 — matches reference app (livepriceofgold.com) behavior.
---

# UAE Kilo Bar 995 Pricing Convention

**Rule:** KILO BAR 995 (1000g, 99.5% purity) is priced using purity factor **23/24 ≈ 0.95833** in the Dubai gold market showroom convention — NOT the scientifically correct 0.995.

**Formula:**
```
KILO BAR 995 price = base_AED_per_gram × 1000g × (23/24)
```

**Why:**
Reverse-engineered from reference app (livepriceofgold.com) screenshot:
- GOLD 9999 1KG: 478,850 AED
- KILO BAR 995: 458,900 AED
- Ratio: 458,900 / 478,850 = 0.95835 ≈ 23/24 = 0.958333...

This is a local UAE showroom pricing convention where 995 bars are priced as a "23 karat equivalent" rather than at their true 99.5% metallic purity. Using 0.995 would give ~476,xxx which does NOT match standard Dubai showroom pricing.

**How to apply:**
- DB: `price_items` where name = "KILO BAR 995", `purity_factor` = 23/24 = 0.95833…
- CORE_DEFAULTS in `price-items.ts`: use `String(23/24)` for purityFactor of "KG BAR 995"
- Do NOT change to 0.995 even though that's the metallurgical purity — it will not match the market reference.
