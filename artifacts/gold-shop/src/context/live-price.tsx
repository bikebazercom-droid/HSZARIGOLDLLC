import React, { createContext, useContext, useMemo } from "react";
import {
  useGetPricesSpot,
  getGetPricesSpotQueryKey,
} from "@workspace/api-client-react";

// ── Pure Dubai gold calculator ────────────────────────────────────────────────
// All values are derived exclusively from the live XAUUSD spot price.
// Zero spreads, zero premiums, zero making charges — raw international gold
// converted to UAE Dirham using the fixed AED/USD peg.
//
// Core formula (24K AED/gram):
//   rawAedPerGram = (XAUUSD / TROY_OZ_TO_GRAM) * USD_AED_PEG
//
// Row derivations:
//   Gold 9999 1GM  = rawAedPerGram
//   Jewellery 22K  = rawAedPerGram × (22 / 24)
//   Ten Tola Bar   = rawAedPerGram × 116.640
//   Gold 9999 1KG  = rawAedPerGram × 1000
//   Kilo Bar 995   = rawAedPerGram × 1000 × 0.995
// ─────────────────────────────────────────────────────────────────────────────

const TROY_OZ_TO_GRAM = 31.1034768;
const USD_AED_PEG     = 3.6725;
const TOLA_BAR_GRAMS  = 116.640;
const PURITY_22K      = 22 / 24;
const PURITY_995      = 0.995;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LiveRates {
  usdPerOz:     number | null;
  aedPerGram:   number | null;   // raw 24K per gram — invoice baseline seed
  gold9999Rate: number | null;   // Gold 9999  1GM
  gold22kRate:  number | null;   // Jewellery 22K 1GM
  ttBarTotal:   number | null;   // Ten Tola Bar total
  gold9999Total: number | null;  // Gold 9999  1KG
  kgBarTotal:   number | null;   // Kilo Bar 995 1KG
  isLive:       boolean;
  updatedAt:    string | null;
}

interface LivePriceContextValue {
  liveRates: LiveRates;
}

const EMPTY_RATES: LiveRates = {
  usdPerOz:     null,
  aedPerGram:   null,
  gold9999Rate: null,
  gold22kRate:  null,
  ttBarTotal:   null,
  gold9999Total: null,
  kgBarTotal:   null,
  isLive:       false,
  updatedAt:    null,
};

const LivePriceContext = createContext<LivePriceContextValue>({
  liveRates: EMPTY_RATES,
});

export function LivePriceProvider({ children }: { children: React.ReactNode }) {
  // Lightweight spot endpoint — 10-second server-side cache, polled every 3s.
  // No DB rates are fetched — all calculations are pure maths from XAUUSD.
  const { data: spot } = useGetPricesSpot({
    query: {
      queryKey: getGetPricesSpotQueryKey(),
      refetchInterval: 3000,
      refetchIntervalInBackground: true,
    },
  });

  const liveRates = useMemo<LiveRates>(() => {
    if (!spot?.usdPerOz || spot.usdPerOz <= 0) return EMPTY_RATES;

    // Step 1: derive the pure 24K AED/gram from the live XAUUSD spot
    const raw = (spot.usdPerOz / TROY_OZ_TO_GRAM) * USD_AED_PEG;

    return {
      usdPerOz:      spot.usdPerOz,
      aedPerGram:    round2(raw),
      gold9999Rate:  round2(raw),
      gold22kRate:   round2(raw * PURITY_22K),
      ttBarTotal:    round2(raw * TOLA_BAR_GRAMS),
      gold9999Total: round2(raw * 1000),
      kgBarTotal:    round2(raw * 1000 * PURITY_995),
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
