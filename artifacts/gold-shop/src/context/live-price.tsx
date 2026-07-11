import React, { createContext, useContext, useMemo } from "react";
import {
  useGetPricesSpot,
  getGetPricesSpotQueryKey,
} from "@workspace/api-client-react";

// ── International Spot Gold (XAU/USD) pricing engine — 1-second real-time sync ──
//
// Formula pipeline:
//   Raw_Ask_USD  = XAUUSD tick from livepriceofgold.com Socket.IO feed
//   Base_24K_AED = (Raw_Ask_USD / 31.1034768) × 3.6725
//   Adjusted_Base = Base_24K_AED × (1 + spreadPercent / 100)   ← server applies
//   Bar rows     = Adjusted_Base × purity
//   Jewelry rows = Adjusted_Base × purity × (1 + laborCostPercent / 100)
//
// `aedPerGram` from /prices/spot is already the Adjusted_Base (spread applied
// server-side). `laborCostPercent` is also returned from the spot endpoint and
// applied here for jewelry rows only (22K/21K/18K).
// ─────────────────────────────────────────────────────────────────────────────

const TOLA_BAR_GRAMS = 116.640;
const PURITY_995     = 0.995;
const PURITY_9999    = 0.9999;
const PURITY_22K     = 22 / 24;
const PURITY_21K     = 21 / 24;
const PURITY_18K     = 18 / 24;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LiveRates {
  usdPerOz:           number | null;
  aedPerGram:         number | null;   // Adjusted_Base (spread applied server-side) — invoices/admin
  baseAedPerGram:     number | null;   // Raw Base_24K_AED before spread
  bidUsdPerOz:        number | null;
  askUsdPerOz:        number | null;
  dailyLowUsdPerOz:   number | null;
  dailyHighUsdPerOz:  number | null;
  spreadPercent:      number;          // currently active admin spread %
  laborCostPercent:   number;          // currently active admin labor %

  // ── Spread+labor-adjusted rates (admin Prices page / invoice pricing) ───────
  ttBar995Total:      number | null;
  ttBar9999Total:     number | null;
  gold9999Rate:       number | null;
  goldKg9999Total:    number | null;
  goldKg9999Rate:     number | null;
  kgBar995Total:      number | null;
  gold22kRate:        number | null;
  gold21kRate:        number | null;
  gold18kRate:        number | null;

  // ── Raw market rates (TV board public display — NO spread, NO labor) ─────────
  rawTtBar995Total:   number | null;
  rawTtBar9999Total:  number | null;
  rawGold9999Rate:    number | null;
  rawKgBar995Total:   number | null;
  rawGoldKg9999Total: number | null;
  rawGold22kRate:     number | null;
  rawGold21kRate:     number | null;
  rawGold18kRate:     number | null;

  isLive:             boolean;
  /** True when prices are sourced from the DB last-close fallback rather than
   *  a real-time feed (e.g. market closed on weekend, feed not yet connected). */
  isStale:            boolean;
  updatedAt:          string | null;
}

interface LivePriceContextValue {
  liveRates: LiveRates;
}

const EMPTY_RATES: LiveRates = {
  usdPerOz:           null,
  aedPerGram:         null,
  baseAedPerGram:     null,
  bidUsdPerOz:        null,
  askUsdPerOz:        null,
  dailyLowUsdPerOz:   null,
  dailyHighUsdPerOz:  null,
  spreadPercent:      0,
  laborCostPercent:   0,
  ttBar995Total:      null,
  ttBar9999Total:     null,
  gold9999Rate:       null,
  goldKg9999Total:    null,
  goldKg9999Rate:     null,
  kgBar995Total:      null,
  gold22kRate:        null,
  gold21kRate:        null,
  gold18kRate:        null,
  rawTtBar995Total:   null,
  rawTtBar9999Total:  null,
  rawGold9999Rate:    null,
  rawKgBar995Total:   null,
  rawGoldKg9999Total: null,
  rawGold22kRate:     null,
  rawGold21kRate:     null,
  rawGold18kRate:     null,
  isLive:             false,
  isStale:            false,
  updatedAt:          null,
};

const LivePriceContext = createContext<LivePriceContextValue>({
  liveRates: EMPTY_RATES,
});

export function LivePriceProvider({ children }: { children: React.ReactNode }) {
  const { data: spot } = useGetPricesSpot({
    query: {
      queryKey: getGetPricesSpotQueryKey(),
      refetchInterval: 1000,
      refetchIntervalInBackground: true,
      staleTime: 0,
      gcTime: 0,
    },
  });

  const liveRates = useMemo<LiveRates>(() => {
    // aedPerGram is the spread-adjusted Adjusted_Base returned by the server.
    // Guard on this — not usdPerOz — since the backend may return usdPerOz=0
    // when falling back to a pre-cached rate.
    if (!spot?.aedPerGram || spot.aedPerGram <= 0) return EMPTY_RATES;

    // Two bases:
    //   adjustedBase — spread applied server-side; used by admin Prices page
    //                  and invoice pricing engine where markup is intentional.
    //   marketBase   — pure (XAU_USD / 31.1034768) × 3.6725, no spread, no labor;
    //                  used by the TV board public display so it mirrors the
    //                  international spot exactly.
    const adjustedBase = spot.aedPerGram;                               // full float
    const marketBase   = spot.baseAedPerGram ?? spot.aedPerGram;        // raw before spread
    const spreadPct    = spot.spreadPercent    ?? 0;
    const laborPct     = spot.laborCostPercent ?? 0;
    const laborMult    = 1 + laborPct / 100;

    return {
      usdPerOz:          spot.usdPerOz ?? null,
      aedPerGram:        round2(adjustedBase),
      baseAedPerGram:    round2(marketBase),
      bidUsdPerOz:       spot.bidUsdPerOz        != null ? round2(spot.bidUsdPerOz)        : null,
      askUsdPerOz:       spot.askUsdPerOz        != null ? round2(spot.askUsdPerOz)        : null,
      dailyLowUsdPerOz:  spot.dailyLowUsdPerOz  != null ? round2(spot.dailyLowUsdPerOz)  : null,
      dailyHighUsdPerOz: spot.dailyHighUsdPerOz != null ? round2(spot.dailyHighUsdPerOz) : null,
      spreadPercent:     spreadPct,
      laborCostPercent:  laborPct,

      // ── Admin/invoice rates (spread + labor applied) ──────────────────────────
      ttBar995Total:   round2(adjustedBase * TOLA_BAR_GRAMS * PURITY_995),
      ttBar9999Total:  round2(adjustedBase * TOLA_BAR_GRAMS * PURITY_9999),
      gold9999Rate:    round2(adjustedBase * PURITY_9999),
      goldKg9999Total: round2(adjustedBase * 1000 * PURITY_9999),
      goldKg9999Rate:  round2(adjustedBase * PURITY_9999),
      kgBar995Total:   round2(adjustedBase * 1000 * PURITY_995),
      gold22kRate:     round2(adjustedBase * PURITY_22K * laborMult),
      gold21kRate:     round2(adjustedBase * PURITY_21K * laborMult),
      gold18kRate:     round2(adjustedBase * PURITY_18K * laborMult),

      // ── Raw market rates (TV board — pure spot, NO spread, NO labor) ──────────
      // Formula: (XAU_USD / 31.1034768) × 3.6725 × purity  (jewelry: no labor)
      rawTtBar995Total:   round2(marketBase * TOLA_BAR_GRAMS * PURITY_995),
      rawTtBar9999Total:  round2(marketBase * TOLA_BAR_GRAMS * PURITY_9999),
      rawGold9999Rate:    round2(marketBase * PURITY_9999),
      rawKgBar995Total:   round2(marketBase * 1000 * PURITY_995),
      rawGoldKg9999Total: round2(marketBase * 1000 * PURITY_9999),
      rawGold22kRate:     round2(marketBase * PURITY_22K),
      rawGold21kRate:     round2(marketBase * PURITY_21K),
      rawGold18kRate:     round2(marketBase * PURITY_18K),

      // isStale = DB fallback (no real-time bid/ask available, market closed)
      isLive:    true,
      isStale:   spot.bidUsdPerOz == null,
      updatedAt: spot.updatedAt,
    };
  }, [spot]);

  return (
    <LivePriceContext.Provider value={{ liveRates }}>
      {children}
    </LivePriceContext.Provider>
  );
}

export function useLivePrice() {
  return useContext(LivePriceContext);
}
