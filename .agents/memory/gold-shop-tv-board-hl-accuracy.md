---
name: Gold-shop TV board H/L accuracy
description: How daily High/Low is tracked for the TV display board — OTC spot ticks only, no futures seeding.
---

## H/L strategy (current — Aug 2026)

**Rule:** H/L is built **exclusively from live Swissquote OTC spot ticks** via `trackDailyRange(mid)`.
No futures or external seeding. `loadDailyHL()` restores today's persisted H/L on restart (date-checked).
At UTC midnight the watchdog resets H/L to null; the first Swissquote tick seeds both.

**Why:**
- Yahoo GC=F futures basis vs OTC spot is **unpredictable**: ~$1.50 in late July 2026 (near contract expiry), but $55+ in early August 2026 (after roll to next delivery month).
- A fixed `−$1.50` correction was calibrated on ONE day and broke completely after the futures roll.
- No free OTC spot H/L API was found to work: GoldAPI.io returned 403 (invalid key), XAUUSD=X returns no hourly bars, Kitco 404, metals.live broken.
- Best approach: track H/L from the Swissquote OTC feed that drives all other prices — guaranteed to be consistent.

**How to apply:**
- Do NOT reinstate Yahoo GC=F / any futures seeding for H/L.
- `trackDailyRange(mid)` is called on each Swissquote tick (every 1 s) → accurate intraday H/L.
- `saveDailyHL()` writes `{ date, low, high }` to `daily_hl.json` on every change.
- `loadDailyHL()` on restart: restores if `state.date === todayUTC()`, else starts fresh (both null).
- On fresh start, H/L begins at the first Swissquote tick value and expands naturally.
- On production deployment (24/7 uptime), H/L is captured for the full 23-hour OTC session.

---

## UniRateAPI must NOT overwrite Swissquote prices (display)

**Rule:** In `pollUniRate()`, only assign to `liveSpot` when `lastSwissquoteTick` is null or older than `SWISSQUOTE_STALE_MS` (30 s). Otherwise, only call `trackDailyRange()` and do the DB write.

**Why:** UniRateAPI can lag by $2–$20 depending on day. On 2026-07-28 it was stuck at $4,042 while Swissquote showed $4,044–$4,047. Would cause visible 1-second dip every 90 s.

**How to apply:** Track `let lastSwissquoteTick: Date | null`. Set on each successful Swissquote tick. Check `Date.now() - lastSwissquoteTick.getTime() > SWISSQUOTE_STALE_MS` before assigning `liveSpot` in UniRateAPI handler.

---

## GC=F futures basis — NEVER use for OTC spot H/L

**Warning:** GC=F futures price ≠ OTC spot XAU/USD. Basis varies from < $2 (days before contract expiry) to > $50 (after roll to next delivery month). Applying a fixed correction (e.g. −$1.50) will be accurate for one day and completely wrong after the next roll. This caused HIGH=4,133 (futures) when actual OTC spot was 4,058–4,062 on 2026-08-03.

---

## Price source priority

1. **Swissquote** (primary): institutional OTC XAU/USD, bid/ask, 1 s intervals. Drives display + H/L tracking.
2. **UniRateAPI** (fallback): display only when Swissquote silent >30 s. Also: `trackDailyRange()` + DB writes.
3. No futures seeding (removed permanently).
