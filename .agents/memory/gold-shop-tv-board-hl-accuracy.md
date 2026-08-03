---
name: Gold-shop TV board H/L accuracy
description: How daily High/Low is seeded for the TV board — GoldAPI.io (primary exact OTC) + GC=F dynamic basis (fallback).
---

## H/L strategy (current — Aug 2026)

**Primary seed: GoldAPI.io** (`seedHLFromGoldAPI()`) — exact OTC FOREXCOM H/L, same source as Netdania.
**Fallback seed: GC=F hourly bars with dynamic basis** (`seedHLFromGCF()`) — used when GOLDAPI_KEY missing/invalid.
**Secondary: live Swissquote OTC ticks** (`trackDailyRange(mid)`) extend H/L as new extremes occur.
**Persisted: `daily_hl.json`** (date-checked) restores H/L on restart within the same day.
**Midnight watchdog**: resets H/L to null then immediately re-seeds from GoldAPI.io → GC=F fallback.
**Orchestrator**: `seedHL()` tries GoldAPI.io first, falls back to GC=F if it fails.
**Re-seed interval**: every 5 minutes.

---

## GoldAPI.io endpoint

```
GET https://www.goldapi.io/api/XAU/USD
Header: x-access-token: <GOLDAPI_KEY>
```

Response fields used:
- `high_price` — today's OTC HIGH in USD/troy-oz (FOREXCOM, same as Netdania)
- `low_price` — today's OTC LOW in USD/troy-oz

The free plan provides 100 requests/month. At 5-min re-seed intervals: ~288 req/day — exceeds free plan.

**Rate limit consideration**: 100 req/month free. At 5-min intervals that's ~8,640 req/month — OVER FREE LIMIT.
→ Seed interval should be increased to 30 min (or use GC=F for periodic re-seed, GoldAPI only on startup + midnight).

**Correction applied (2026-08-03)**: Keep 5-min interval for now; if rate limit hit, increase to 30 min.

---

## GC=F Dynamic basis fallback (when GoldAPI unavailable)

**Rule:** `OTC_H = GCF_H − (GCF_current − Swissquote_OTC_mid)`, same for LOW.

The carry-based basis is **stable intraday** (< ±$2 variation), so subtracting today's current basis from historical same-day bars converts futures H/L → OTC spot H/L accurately.

**Empirical validation (2026-08-03):**
- GC=F H=4135.80  L=4102.70  current=4115.2  OTC mid=4061  basis=54.2
- OTC HIGH estimate = 4081.60 (Netdania: 4082.35, Δ **$0.75**) ✅
- OTC LOW estimate  = 4048.50 (Netdania: 4047.18, Δ **$1.32**) ✅

**Why fixed correction fails after contract roll:** basis was $1.50 (July 28, near expiry), jumped to $54+ (Aug 3, post-roll). Dynamic basis handles both cases.

---

## GC=F bars must be filtered by Dubai date (UTC+4), not UTC date

Use `new Date(ts * 1000 + 4*3600000).toISOString().slice(0,10)` for bar date.

The gold market day in UAE starts at midnight Dubai = 20:00 UTC previous UTC day. Filtering by UTC date misses critical overnight bars.

---

## Merge strategy (both stages)

- **HIGH**: `max(seed, liveTrack)` — seed captures overnight; live ticks win if new intraday high set after restart.
- **LOW**: `min(seed, liveTrack)` — same reasoning.
- Seed broadcasts `PRICE_MUTATION` when changed so frontend updates immediately.

---

## UniRateAPI must NOT overwrite Swissquote prices (display)

Only assign `liveSpot` from UniRateAPI when `lastSwissquoteTick` is null or older than `SWISSQUOTE_STALE_MS` (30 s). Otherwise: `trackDailyRange()` + DB write only.

**Why:** UniRateAPI can lag by $2–20. Overwriting causes visible dip every 90 s.

---

## Price source priority

1. **Swissquote** (display + H/L tracking): institutional OTC XAU/USD, bid/ask, 1 s intervals.
2. **GoldAPI.io** (H/L primary seed): exact OTC FOREXCOM, startup + 5 min + midnight.
3. **GC=F via Yahoo** (H/L fallback seed): dynamic basis corrected; Dubai-date filtered.
4. **UniRateAPI** (fallback display when Swissquote silent >30 s; always DB write + H/L track).

---

## Failed free OTC H/L sources (do not retry)

- Yahoo `XAUUSD=X` hourly: 0 bars returned
- GLD ETF proxy: US-session only, misses overnight
- UniRateAPI: current mid only, no H/L fields anywhere
- metals.live, goldprice.org, stooq.com: blocked
