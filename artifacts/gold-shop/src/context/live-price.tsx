import React, { createContext, useContext, useMemo } from "react";
import {
  useGetPricesSpot,
  getGetPricesSpotQueryKey,
} from "@workspace/api-client-react";

// ── International Spot Gold (XAU/USD) pricing engine — 1-second real-time sync ──
// The atomic baseline `Final_24K` (exposed here as `aedPerGram`) is derived
// from the live international Gold Spot ASK price via the backend
// /prices/spot endpoint (no server-side caching — every poll returns the
// freshest in-memory tick):
//
//   Base_24K_AED = (Live_International_Ask_Price / 31.1034768) * 3.6725
//
// Row derivations from Base_24K_AED:
//   TT. BAR (0.995)  = Base_24K_AED × 116.640 × 0.995
//   TT. BAR (0.9999) = Base_24K_AED × 116.640 × 0.9999
//   GOLD (0.9999)    = Base_24K_AED × 0.9999
//   GOLD KG (0.9999) = Base_24K_AED × 1000 × 0.9999 (TV total) / × 0.9999 (1GM invoice rate)
//   KG BAR (0.995)   = Base_24K_AED × 1000 × 0.995
//   Gold Jewelry 22K = Base_24K_AED × (22 / 24)
//   Gold Jewelry 21K = Base_24K_AED × (21 / 24)
//   Gold Jewelry 18K = Base_24K_AED × (18 / 24)
// ─────────────────────────────────────────────────────────────────────────────

const TOLA_BAR_GRAMS = 116.640;
const PURITY_995     = 0.995;
const PURITY_9999    = 0.9999;
const PURITY_22K     = 22 / 24;
const PURITY_21K     = 21 / 24;
const PURITY_18K     = 18 / 24;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LiveRates {
  usdPerOz:      number | null;
  aedPerGram:    number | null;  // Base_24K_AED — invoice baseline
  baseAedPerGram: number | null; // same as aedPerGram (no spread applied)
  bidUsdPerOz:   number | null;  // Live Bid (USD/oz)
  askUsdPerOz:   number | null;  // Live Ask (USD/oz)
  dailyLowUsdPerOz:  number | null; // Lowest usdPerOz tick since UTC midnight
  dailyHighUsdPerOz: number | null; // Highest usdPerOz tick since UTC midnight
  ttBar995Total: number | null;  // TT. BAR (0.995) total price per bar
  ttBar9999Total: number | null;  // TT. BAR (0.9999) total price per bar
  gold9999Rate:  number | null;  // GOLD (0.9999) per gram
  goldKg9999Total: number | null; // GOLD KG (0.9999) total price per 1KG bar (TV)
  goldKg9999Rate:  number | null; // GOLD KG (0.9999) per gram (admin / invoice)
  kgBar995Total: number | null;  // KG BAR (0.995) total price per kg
  gold22kRate:   number | null;  // Gold Jewelry 22K per gram
  gold21kRate:   number | null;  // Gold Jewelry 21K per gram
  gold18kRate:   number | null;  // Gold Jewelry 18K per gram
  isLive:        boolean;
  updatedAt:     string | null;
}

interface LivePriceContextValue {
  liveRates: LiveRates;
}

const EMPTY_RATES: LiveRates = {
  usdPerOz:      null,
  aedPerGram:    null,
  baseAedPerGram: null,
  bidUsdPerOz:   null,
  askUsdPerOz:   null,
  dailyLowUsdPerOz:  null,
  dailyHighUsdPerOz: null,
  ttBar995Total: null,
  ttBar9999Total: null,
  gold9999Rate:  null,
  goldKg9999Total: null,
  goldKg9999Rate:  null,
  kgBar995Total: null,
  gold22kRate:   null,
  gold21kRate:   null,
  gold18kRate:   null,
  isLive:        false,
  updatedAt:     null,
};

const LivePriceContext = createContext<LivePriceContextValue>({
  liveRates: EMPTY_RATES,
});

export function LivePriceProvider({ children }: { children: React.ReactNode }) {
  // /prices/spot has NO server-side caching (no ETag, no Cache-Control) and
  // no client-side staleness window either — every 1s poll always refetches
  // and is immediately treated as fresh, so the TV board and invoice seed
  // never render a stale in-memory tick.
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
    // aedPerGram is Base_24K_AED — the international-spot-derived 24K rate per
    // gram (AED), computed server-side as (XAUUSD / 31.1034768) × 3.6725.
    // Guard on this — not usdPerOz — since the backend may return usdPerOz=0
    // when falling back to a pre-cached rate.
    if (!spot?.aedPerGram || spot.aedPerGram <= 0) return EMPTY_RATES;

    // Round to 2dp FIRST so every derived row is exactly verifiable from the
    // displayed base — i.e. if the board shows 491.86, then
    //   TT BAR 0.9999 = 491.86 × 116.640 × 0.9999 = 57,319.00  (pocket-calc match)
    const base = round2(spot.aedPerGram);

    return {
      usdPerOz:      spot.usdPerOz ?? null,
      aedPerGram:    base,
      baseAedPerGram: spot.baseAedPerGram != null ? round2(spot.baseAedPerGram) : null,
      bidUsdPerOz:   spot.bidUsdPerOz != null ? round2(spot.bidUsdPerOz) : null,
      askUsdPerOz:   spot.askUsdPerOz != null ? round2(spot.askUsdPerOz) : null,
      dailyLowUsdPerOz:  spot.dailyLowUsdPerOz != null ? round2(spot.dailyLowUsdPerOz) : null,
      dailyHighUsdPerOz: spot.dailyHighUsdPerOz != null ? round2(spot.dailyHighUsdPerOz) : null,
      ttBar995Total: round2(base * TOLA_BAR_GRAMS * PURITY_995),
      ttBar9999Total: round2(base * TOLA_BAR_GRAMS * PURITY_9999),
      gold9999Rate:  round2(base * PURITY_9999),
      goldKg9999Total: round2(base * 1000 * PURITY_9999),
      goldKg9999Rate:  round2(base * PURITY_9999),
      kgBar995Total: round2(base * 1000 * PURITY_995),
      gold22kRate:   round2(base * PURITY_22K),
      gold21kRate:   round2(base * PURITY_21K),
      gold18kRate:   round2(base * PURITY_18K),
      isLive:        true,
      updatedAt:     spot.updatedAt,
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
