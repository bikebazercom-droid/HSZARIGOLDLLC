import React, { createContext, useContext, useMemo } from "react";
import {
  useGetPricesSpot,
  getGetPricesSpotQueryKey,
} from "@workspace/api-client-react";

// ── International Spot Gold (XAU/USD) pricing engine — 1-second real-time sync ──
// The atomic baseline `Final_24K` (exposed here as `aedPerGram`) is derived
// from the live international Gold Spot (XAU/USD) price via the backend
// /prices/spot endpoint:
//
//   Base_24K_AED = (XAU_USD_Price / 31.1034768) * 3.6725
//   Final_24K    = Base_24K_AED + admin spreadPremiumAed
//
// Row derivations from Final_24K:
//   TT. BAR (0.995)  = Final_24K × 116.640 × 0.995
//   TT. BAR (0.9999) = Final_24K × 116.640 × 0.9999
//   GOLD (0.9999)    = Final_24K × 0.9999
//   GOLD KG (0.9999) = Final_24K × 1000 × 0.9999 (TV total) / × 0.9999 (1GM invoice rate)
//   KG BAR (0.995)   = Final_24K × 1000 × 0.995
//   Gold Jewelry 22K = Final_24K × (22 / 24) × (1 + laborCostPercent / 100)
//   Gold Jewelry 21K = Final_24K × (21 / 24) × (1 + laborCostPercent / 100)
//   Gold Jewelry 18K = Final_24K × (18 / 24) × (1 + laborCostPercent / 100)
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
  aedPerGram:    number | null;  // Final_24K (Base_24K_AED + admin spread) — invoice baseline
  baseAedPerGram: number | null; // Base_24K_AED — raw international conversion, no spread
  spreadPremiumAed: number | null; // Admin-configured fixed AED buffer currently applied
  laborCostPercent: number | null; // Admin-configured jewelry labor cost % currently applied
  ttBar995Total: number | null;  // TT. BAR (0.995) total price per bar
  ttBar9999Total: number | null;  // TT. BAR (0.9999) total price per bar
  gold9999Rate:  number | null;  // GOLD (0.9999) per gram
  goldKg9999Total: number | null; // GOLD KG (0.9999) total price per 1KG bar (TV)
  goldKg9999Rate:  number | null; // GOLD KG (0.9999) per gram (admin / invoice)
  kgBar995Total: number | null;  // KG BAR (0.995) total price per kg
  gold22kRate:   number | null;  // Gold Jewelry 22K per gram (incl. labor cost)
  gold21kRate:   number | null;  // Gold Jewelry 21K per gram (incl. labor cost)
  gold18kRate:   number | null;  // Gold Jewelry 18K per gram (incl. labor cost)
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
  spreadPremiumAed: null,
  laborCostPercent: null,
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
    // aedPerGram is Final_24K — the international-spot-derived 24K rate per
    // gram (AED), computed server-side as Base_24K_AED + admin spread. Guard
    // on this — not usdPerOz — since the backend may return usdPerOz=0 when
    // falling back to a pre-cached rate.
    if (!spot?.aedPerGram || spot.aedPerGram <= 0) return EMPTY_RATES;

    // Atomic base: Final_24K AED/gram from the live Socket.IO feed.
    // Round to 2dp FIRST so every derived row is exactly verifiable from the
    // displayed base — i.e. if the board shows 491.86, then
    //   TT BAR 0.9999 = 491.86 × 116.640 × 0.9999 = 57,319.00  (pocket-calc match)
    // Using the unrounded float would give a result that differs from what a
    // user would compute from the displayed base, causing apparent "errors".
    const base = round2(spot.aedPerGram);
    const laborCostPercent = spot.laborCostPercent ?? 0;
    const laborMultiplier = 1 + laborCostPercent / 100;

    return {
      usdPerOz:      spot.usdPerOz ?? null,
      aedPerGram:    base,
      baseAedPerGram: spot.baseAedPerGram != null ? round2(spot.baseAedPerGram) : null,
      spreadPremiumAed: spot.spreadPremiumAed ?? null,
      laborCostPercent: spot.laborCostPercent ?? null,
      ttBar995Total: round2(base * TOLA_BAR_GRAMS * PURITY_995),
      ttBar9999Total: round2(base * TOLA_BAR_GRAMS * PURITY_9999),
      gold9999Rate:  round2(base * PURITY_9999),
      goldKg9999Total: round2(base * 1000 * PURITY_9999),
      goldKg9999Rate:  round2(base * PURITY_9999),
      kgBar995Total: round2(base * 1000 * PURITY_995),
      gold22kRate:   round2(base * PURITY_22K * laborMultiplier),
      gold21kRate:   round2(base * PURITY_21K * laborMultiplier),
      gold18kRate:   round2(base * PURITY_18K * laborMultiplier),
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
