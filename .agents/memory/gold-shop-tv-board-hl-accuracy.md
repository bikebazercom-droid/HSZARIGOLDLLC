---
name: Gold-shop TV board H/L accuracy
description: How daily High/Low is seeded for the TV board — GC=F dynamic-basis correction converts futures H/L to accurate OTC spot H/L.
---

## H/L strategy (current — Aug 2026)

**Primary seed: GC=F hourly bars with DYNAMIC BASIS correction** (`seedHLFromGCF()`).
**Secondary: live Swissquote OTC ticks** (`trackDailyRange(mid)`) extend H/L as new extremes occur.
**Persisted: `daily_hl.json`** (date-checked) restores H/L on restart within the same day.
**Midnight watchdog**: resets H/L to null then immediately re-seeds from GC=F.

---

## Dynamic basis approach (why it works)

**Rule:** `OTC_H = GCF_H − (GCF_current − Swissquote_OTC_mid)`, same for LOW.

The GC=F futures contract trades at a premium over OTC spot ("carry basis").  
The carry basis is **stable intraday** (< ±$2 variation), so subtracting today's current basis from historical same-day bars converts futures H/L → OTC spot H/L accurately.

**Empirical validation (2026-08-03):**
- GCF HIGH = 4,135.80 | GCF LOW = 4,102.70
- GCF current = 4,114.60 | Swissquote OTC mid = 4,058.01 → basis = **56.59**
- OTC HIGH = 4,079.21 (Netdania ref: 4,082.35, Δ **$3.14**) ✅
- OTC LOW = 4,046.12 (Netdania ref: 4,047.18, Δ **$1.06**) ✅

**Why the basis varies so much day-to-day:**
- Near contract expiry: basis → ~$0–2 (July 28: $1.50)
- After roll to next delivery month: basis → $50–80 (Aug 3: $56.59)
- Fixed correction (−$1.50) is ONLY valid near expiry; after roll it is catastrophically wrong.

---

## GC=F bars must be filtered by Dubai date (UTC+4), not UTC date

**Rule:** Use `new Date(ts * 1000 + 4*3600000).toISOString().slice(0,10)` for bar date.

**Why:** The gold market day in UAE starts at midnight Dubai (= 20:00 UTC previous UTC day). The overnight Asian session high/low bars land in UTC date "yesterday" but are part of today's Dubai session. Filtering by UTC date misses those critical bars.

Example: The HIGH bar `2026-08-02T22:00Z` (= 02:00 AM Dubai Aug 3) would be missed with UTC filtering but is correctly included with Dubai filtering.

---

## Merge strategy for seed vs live ticks

- **HIGH**: `max(seed, liveTrack)` — seed captures overnight; live ticks win if new intraday high set after restart.
- **LOW**: `min(seed, liveTrack)` — same reasoning.
- Seed broadcasts `PRICE_MUTATION` so frontend updates immediately on seed change.

---

## Periodic re-seed (every 10 min)

`setInterval(seedHLFromGCF, 10 * 60_000)` re-seeds throughout the day so:
- New intraday GCF bars (if bar extreme moves) get captured.
- The dynamic basis stays fresh (Swissquote mid changes throughout the day, keeping the basis accurate for newly added bars).

---

## UniRateAPI must NOT overwrite Swissquote prices (display)

**Rule:** Only assign `liveSpot` from UniRateAPI when `lastSwissquoteTick` is null or older than `SWISSQUOTE_STALE_MS` (30 s). Otherwise: `trackDailyRange()` + DB write only.

**Why:** UniRateAPI can lag by $2–20. Overwriting causes ~0.27 AED/g dip every 90 s.

---

## Price source priority

1. **Swissquote** (display + H/L tracking): institutional OTC XAU/USD, bid/ask, 1 s intervals.
2. **GC=F via Yahoo** (H/L seed): dynamic basis corrected; Dubai-date filtered; startup + 10 min + midnight.
3. **UniRateAPI** (fallback display when Swissquote silent >30 s; always DB write + H/L track).

---

## Failed free OTC H/L sources (do not retry)

- Yahoo `XAUUSD=X` hourly: 0 bars returned (Yahoo disabled this feed)
- Yahoo `XAUUSD=X` v7/v10 quote: "Unauthorized"
- GoldAPI.io: 403 "Invalid API Key" (GOLDAPI_KEY secret is invalid or wrong service)
- metals.live: fetch failed
- goldprice.org: Forbidden
- stooq.com: JavaScript bot protection
- GLD ETF proxy: US-session only, misses overnight; ratio calculation unreliable
