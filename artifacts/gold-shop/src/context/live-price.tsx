import React, { createContext, useContext, useMemo } from "react";
import {
  useGetPricesSpot,
  getGetPricesSpotQueryKey,
  useGetPublicPrices,
  getGetPublicPricesQueryKey,
} from "@workspace/api-client-react";

// ── Live rates computed from real-time spot price ─────────────────────────────
// The spot endpoint is polled every 3 seconds. All display rates are derived
// by scaling the admin-configured DB rates proportionally to the live XAUUSD
// spot price — so every spread and premium the admin has set is preserved.
//
// Formula:  liveRate = dbRate × (spotAedPerGram / dbGoldBullionRate)
//
export interface LiveRates {
  usdPerOz: number | null;
  aedPerGram: number | null;
  ttBarTotal: number | null;
  gold22kRate: number | null;
  gold9999Rate: number | null;
  gold9999Total: number | null;
  kgBarTotal: number | null;
  isLive: boolean;
  updatedAt: string | null;
}

interface LivePriceContextValue {
  liveRates: LiveRates;
}

const EMPTY_RATES: LiveRates = {
  usdPerOz: null,
  aedPerGram: null,
  ttBarTotal: null,
  gold22kRate: null,
  gold9999Rate: null,
  gold9999Total: null,
  kgBarTotal: null,
  isLive: false,
  updatedAt: null,
};

const LivePriceContext = createContext<LivePriceContextValue>({
  liveRates: EMPTY_RATES,
});

const TOLA_BAR_GRAMS = 116.64;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function LivePriceProvider({ children }: { children: React.ReactNode }) {
  // Lightweight spot endpoint — 10-second server-side cache, polled every 3s
  const { data: spot } = useGetPricesSpot({
    query: {
      queryKey: getGetPricesSpotQueryKey(),
      refetchInterval: 3000,
      refetchIntervalInBackground: true,
    },
  });

  // Full public rates from DB — updated every 5 min by backend scraper.
  // These carry all the admin-configured premiums and product spreads.
  const { data: base } = useGetPublicPrices({
    query: {
      queryKey: getGetPublicPricesQueryKey(),
      refetchInterval: 30000,
      refetchIntervalInBackground: true,
    },
  });

  const liveRates = useMemo<LiveRates>(() => {
    if (!spot || !base || !base.goldBullionRate || base.goldBullionRate <= 0) {
      return EMPTY_RATES;
    }

    // Proportional scale factor: how much the live spot differs from the DB
    // base rate.  All product rates are multiplied by this to get live values
    // that preserve every configured margin.
    const scale = spot.aedPerGram / base.goldBullionRate;

    return {
      usdPerOz: spot.usdPerOz,
      aedPerGram: spot.aedPerGram,
      ttBarTotal:
        base.ttBarRate != null
          ? round2(base.ttBarRate * scale * TOLA_BAR_GRAMS)
          : null,
      gold22kRate:
        base.gold22kRate != null ? round2(base.gold22kRate * scale) : null,
      gold9999Rate:
        base.gold9999Rate != null ? round2(base.gold9999Rate * scale) : null,
      gold9999Total:
        base.gold9999Rate != null
          ? round2(base.gold9999Rate * scale * 1000)
          : null,
      kgBarTotal:
        base.kgBarRate != null ? round2(base.kgBarRate * scale * 1000) : null,
      isLive: true,
      updatedAt: spot.updatedAt,
    };
  }, [spot, base]);

  return (
    <LivePriceContext.Provider value={{ liveRates }}>
      {children}
    </LivePriceContext.Provider>
  );
}

export function useLivePrice() {
  return useContext(LivePriceContext);
}
