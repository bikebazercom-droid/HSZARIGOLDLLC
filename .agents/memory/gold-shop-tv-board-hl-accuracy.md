---
name: Gold-shop TV board H/L accuracy
description: How daily High/Low is seeded and corrected for the TV display board, and why UniRateAPI must not overwrite Swissquote prices.
---

## Daily H/L seeding (Yahoo GC=F hourly bars)

**Rule:** Use `interval=1h&range=2d&includePrePost=true` to get full 23-hour gold session bars (midnight UTC onward). Seed BOTH HIGH and LOW from today's bars, re-run every 10 minutes throughout the day to catch new intraday extremes.

**Why:** `interval=1d` only gives the regular session (04:00 UTC / 9:30 AM ET). `regularMarketDayHigh` includes the full session but is futures-inflated by ~$12. Hourly bars with `includePrePost=true` give the overnight Asian session high which matches OTC spot to within ~$1.5.

**How to apply:** Call `seedHLFromYahoo()` in startup AND via `setInterval(seedHLFromYahoo, 10 * 60_000)`. Use `range=2d` to ensure today's bars appear. Filter bars by today's UTC date.

---

## GC=F futures basis correction (HIGH only)

**Rule:** Subtract `GCF_HIGH_BASIS_CORRECTION = 1.50` USD/oz from the seeded HIGH. Do NOT adjust LOW.

**Why:** Empirical measurement (Dubai market, 2026-07-28): GC=F hourly HIGH = 4,075.50 vs OTC spot HIGH = 4,074.02 → basis +$1.48. LOW discrepancy was only $0.04. The overnight Asian session has the largest futures premium (~$1–2) which is why HIGH is inflated but LOW is not.

**How to apply:** `adjustedHigh = seedHigh - GCF_HIGH_BASIS_CORRECTION`. Always overwrite `dailyHighUsdPerOz` with the adjusted value (don't use "only expand" merge — stored value may predate the correction being added).

---

## UniRateAPI must NOT overwrite Swissquote prices

**Rule:** In `pollUniRate()`, only update `liveSpot` when `lastSwissquoteTick` is null or older than `SWISSQUOTE_STALE_MS` (30 s). Otherwise, just track H/L and write to DB — do NOT broadcast or update the display price.

**Why:** UniRateAPI has been observed returning a stale price (e.g., 4,042.23 consistently for hours while the actual market was at 4,046+). Every 90 s it would overwrite Swissquote's accurate data, causing a ~$0.27/g dip in item prices for ~1 second. Swissquote (institutional OTC XAU/USD, 1 s interval, 0.50 spread) is always more accurate than UniRateAPI.

**How to apply:** Track `let lastSwissquoteTick: Date | null = null`. Set it on each successful Swissquote tick. In UniRateAPI handler: check `Date.now() - lastSwissquoteTick.getTime() > SWISSQUOTE_STALE_MS` before assigning to `liveSpot`.

---

## Price source priority

1. **Swissquote** (primary): institutional OTC XAU/USD, bid/ask, 1 s intervals. Always used for display when active.
2. **UniRateAPI** (fallback only): used for display only when Swissquote has been silent >30 s. Also: H/L `trackDailyRange()` + DB writes.
3. **Yahoo GC=F hourly bars** (seed): H/L initialization at startup and every 10 min. Basis-corrected for HIGH.
