import React, { createContext, useContext, useMemo } from "react";
import {
  useGetPricesSpot,
  getGetPricesSpotQueryKey,
} from "@workspace/api-client-react";

// ── Pure Dubai gold calculator — 1-second real-time sync ─────────────────────
// All 7 display rows are derived exclusively from the live XAUUSD spot price.
// Zero spreads · Zero premiums · Zero making charges.
//
// Core formula (pure 24K AED/gram):
//   raw24KPerGram = (XAUUSD / 31.1034768) * 3.6725
//
// Row derivations:
//   TT. BAR (0.995)  = raw24KPerGram × 116.640 × 0.995
//   TT. BAR (0.999)  = raw24KPerGram × 116.640 × 0.999
//   GOLD (0.9999)    = raw24KPerGram
//   KG BAR (0.995)   = raw24KPerGram × 1000 × 0.995
//   Gold Jewelry 22K = raw24KPerGram × (22 / 24)
//   Gold Jewelry 21K = raw24KPerGram × (21 / 24)
//   Gold Jewelry 18K = raw24KPerGram × (18 / 24)
// ─────────────────────────────────────────────────────────────────────────────

const TROY_OZ_TO_GRAM = 31.1034768;
const USD_AED_PEG     = 3.6725;
const TOLA_BAR_GRAMS  = 116.640;
const PURITY_995      = 0.995;
const PURITY_999      = 0.999;
const PURITY_22K      = 22 / 24;
const PURITY_21K      = 21 / 24;
const PURITY_18K      = 18 / 24;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LiveRates {
  usdPerOz:      number | null;
  aedPerGram:    number | null;  // pure 24K AED/gram — invoice baseline seed
  ttBar995Total: number | null;  // TT. BAR (0.995) total
  ttBar999Total: number | null;  // TT. BAR (0.999) total
  gold9999Rate:  number | null;  // GOLD (0.9999) per gram
  kgBar995Total: number | null;  // KG BAR (0.995) per kg
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
  ttBar995Total: null,
  ttBar999Total: null,
  gold9999Rate:  null,
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
  // /prices/spot — 10-second server-side cache, polled every 1 second for
  // tick-by-tick real-time updates on the TV board and invoice seed.
  const { data: spot } = useGetPricesSpot({
    query: {
      queryKey: getGetPricesSpotQueryKey(),
      refetchInterval: 1000,
      refetchIntervalInBackground: true,
    },
  });

  const liveRates = useMemo<LiveRates>(() => {
    if (!spot?.usdPerOz || spot.usdPerOz <= 0) return EMPTY_RATES;

    // Atomic base: pure 24K price in AED per gram
    const raw = (spot.usdPerOz / TROY_OZ_TO_GRAM) * USD_AED_PEG;

    return {
      usdPerOz:      spot.usdPerOz,
      aedPerGram:    round2(raw),
      ttBar995Total: round2(raw * TOLA_BAR_GRAMS * PURITY_995),
      ttBar999Total: round2(raw * TOLA_BAR_GRAMS * PURITY_999),
      gold9999Rate:  round2(raw),
      kgBar995Total: round2(raw * 1000 * PURITY_995),
      gold22kRate:   round2(raw * PURITY_22K),
      gold21kRate:   round2(raw * PURITY_21K),
      gold18kRate:   round2(raw * PURITY_18K),
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
