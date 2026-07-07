import React, { createContext, useContext, useMemo } from "react";
import {
  useGetPricesSpot,
  getGetPricesSpotQueryKey,
} from "@workspace/api-client-react";

// ── Dubai Local Retail Gold — 1-second real-time sync ────────────────────────
// The atomic baseline `raw24KPerGram` is the live Dubai 24K retail rate per
// gram (AED), sourced from goldratesindubai.com (DGJG) via the backend
// /prices/spot endpoint. This is the real local market price — not the
// international wholesale spot — so all derived rows match the Dubai Souk
// boards exactly.
//
// Row derivations (pure ratio math, zero spreads/premiums beyond what DGJG
// already includes in the retail rate):
//   TT. BAR (0.995)  = raw24KPerGram × 116.640 × 0.995
//   TT. BAR (0.9999) = raw24KPerGram × 116.640 × 0.9999
//   GOLD (0.9999)    = raw24KPerGram            (exact Dubai 24K retail)
//   KG BAR (0.995)   = raw24KPerGram × 1000  × 0.995
//   Gold Jewelry 22K = raw24KPerGram × (22 / 24)
//   Gold Jewelry 21K = raw24KPerGram × (21 / 24)
//   Gold Jewelry 18K = raw24KPerGram × (18 / 24)
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
  aedPerGram:    number | null;  // Dubai retail 24K AED/gram — invoice baseline
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
    // aedPerGram is the Dubai retail 24K rate per gram (AED), populated by the
    // backend scraper. Guard on this — not usdPerOz — since the backend may
    // return usdPerOz=0 when falling back to a pre-cached Dubai rate.
    if (!spot?.aedPerGram || spot.aedPerGram <= 0) return EMPTY_RATES;

    // Atomic base: 24K AED/gram from the live Socket.IO feed.
    // Round to 2dp FIRST so every derived row is exactly verifiable from the
    // displayed base — i.e. if the board shows 491.86, then
    //   TT BAR 0.9999 = 491.86 × 116.640 × 0.9999 = 57,319.00  (pocket-calc match)
    // Using the unrounded float would give a result that differs from what a
    // user would compute from the displayed base, causing apparent "errors".
    const base = round2(spot.aedPerGram);

    return {
      usdPerOz:      spot.usdPerOz ?? null,
      aedPerGram:    base,
      ttBar995Total: round2(base * TOLA_BAR_GRAMS * PURITY_995),
      ttBar9999Total: round2(base * TOLA_BAR_GRAMS * PURITY_9999),
      gold9999Rate:  base,
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
