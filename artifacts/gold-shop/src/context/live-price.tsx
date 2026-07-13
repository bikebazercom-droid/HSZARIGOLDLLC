import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import {
  useGetPricesSpot,
  getGetPricesSpotQueryKey,
  getGetPublicPriceItemsQueryKey,
} from "@workspace/api-client-react";

// ── Public socket singleton ───────────────────────────────────────────────────
// Shared across all hook instances so only one WebSocket is opened per tab.
// No authentication required — the TV board (showroom) is a public page.
// Primary mechanism: when the server broadcasts PRICE_MUTATION (every live
// tick from livepriceofgold.com), we immediately invalidate the spot cache
// so React Query fires a refetch within milliseconds, not up to 1 second later.
let _pubSock: ReturnType<typeof io> | null = null;
function getPubSocket() {
  if (!_pubSock) {
    _pubSock = io({
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3_000,
    });
  }
  return _pubSock;
}

// ── International Spot Gold (XAU/USD) pricing engine — 1-second real-time sync ──
//
// Formula pipeline:
//   Raw_Ask_USD  = XAUUSD tick from livepriceofgold.com Socket.IO feed
//   Base_24K_AED = (Raw_Ask_USD / 31.1034768) × 3.6725
//   Adjusted_Base = Base_24K_AED × (1 + spreadPercent / 100)   ← server applies
//
// Dubai market convention (livepriceofgold.com):
//   Spot price per gram IS the 9999 gold rate — no separate 0.9999 deduction.
//   9999 bars  = Adjusted_Base × weight          (purity factor = 1.0)
//   995 bars   = Adjusted_Base × weight × 0.9950
//   Jewellery  = Adjusted_Base × karat_factor × (1 + laborCostPercent / 100)
//
// `aedPerGram` from /prices/spot is already the Adjusted_Base (spread applied
// server-side). `laborCostPercent` is also returned from the spot endpoint and
// applied here for jewellery rows only (22K/21K/18K).
// ─────────────────────────────────────────────────────────────────────────────

// Dubai local tola convention: 1 Tola = 11.664g → 10 Tola Bar = 116.64g
const TOLA_BAR_GRAMS = 116.64;
const PURITY_995     = 0.995;
// Scientific standard: 22K = 22/24 = 0.91666… ≈ 0.91667
// Per the Dubai retail formula: Rate_22K = (Spot_USD × 3.6725 / 31.1034768) × (22/24)
const PURITY_22K     = 22 / 24;  // 0.91666…
const PURITY_21K     = 21 / 24;
const PURITY_18K     = 18 / 24;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LiveRates {
  usdPerOz:           number | null;
  aedPerGram:         number | null;   // Adjusted_Base rounded to 2dp — invoices/admin display
  baseAedPerGram:     number | null;   // Raw Base_24K_AED before spread — international spot reference
  adjustedBaseAedPerGram: number | null; // Full-float spread-adjusted base — TV board item engine uses this
  bidUsdPerOz:        number | null;
  askUsdPerOz:        number | null;
  dailyLowUsdPerOz:   number | null;
  dailyHighUsdPerOz:  number | null;
  spreadPercent:      number;
  laborCostPercent:   number;

  // ── Admin manual offsets (AED/g added after all formula math) ────────────────
  gold9999Offset:     number;
  jewellery22kOffset: number;

  // ── Spread+labor-adjusted rates (admin Prices page / invoice pricing only) ──
  // TV board computes per-item prices dynamically from baseAedPerGram +
  // each item's own formula params fetched from /prices/items/public.
  ttBar995Total:      number | null;
  ttBar9999Total:     number | null;
  gold9999Rate:       number | null;
  goldKg9999Total:    number | null;
  goldKg9999Rate:     number | null;
  kgBar995Total:      number | null;
  gold22kRate:        number | null;
  gold21kRate:        number | null;
  gold18kRate:        number | null;

  isLive:             boolean;
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
  adjustedBaseAedPerGram: null,
  bidUsdPerOz:        null,
  askUsdPerOz:        null,
  dailyLowUsdPerOz:   null,
  dailyHighUsdPerOz:  null,
  spreadPercent:      0,
  laborCostPercent:   0,
  gold9999Offset:     0,
  jewellery22kOffset: 0,
  ttBar995Total:      null,
  ttBar9999Total:     null,
  gold9999Rate:       null,
  goldKg9999Total:    null,
  goldKg9999Rate:     null,
  kgBar995Total:      null,
  gold22kRate:        null,
  gold21kRate:        null,
  gold18kRate:        null,
  isLive:             false,
  isStale:            false,
  updatedAt:          null,
};

const LivePriceContext = createContext<LivePriceContextValue>({
  liveRates: EMPTY_RATES,
});

export function LivePriceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // ── Socket push: instant update on every server-side price tick ───────────
  // The server broadcasts PRICE_MUTATION each time a new XAU/USD tick arrives
  // from livepriceofgold.com (~every few seconds). We immediately invalidate
  // the spot cache so React Query refetches without waiting for the polling
  // interval — reducing effective latency from ≤1 000 ms to ~50–150 ms.
  useEffect(() => {
    const sock = getPubSocket();
    const onPrice = () => {
      // Invalidate spot price so live-price context refetches immediately on every XAU tick.
      // Also invalidate public price items so the TV board picks up premiumOffsetAed changes
      // made by the admin (e.g. adding a making charge) without waiting for the 30s poll.
      void queryClient.invalidateQueries({ queryKey: getGetPricesSpotQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetPublicPriceItemsQueryKey() });
    };
    sock.on("PRICE_MUTATION", onPrice);
    return () => { sock.off("PRICE_MUTATION", onPrice); };
  }, [queryClient]);

  // Polling kept at 2 s as a safety-net fallback (market closed, socket lag).
  // Socket push is now the primary real-time mechanism.
  const { data: spot } = useGetPricesSpot({
    query: {
      queryKey: getGetPricesSpotQueryKey(),
      refetchInterval: 2_000,
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
    const adjustedBase    = spot.aedPerGram;                               // full float
    const marketBase      = spot.baseAedPerGram ?? spot.aedPerGram;        // raw before spread
    const spreadPct       = spot.spreadPercent    ?? 0;
    const laborPct        = spot.laborCostPercent ?? 0;
    const laborMult       = 1 + laborPct / 100;
    const g9999Off        = spot.gold9999Offset      ?? 0;
    const j22kOff         = spot.jewellery22kOffset  ?? 0;

    return {
      usdPerOz:          spot.usdPerOz ?? null,
      aedPerGram:        round2(adjustedBase),
      baseAedPerGram:    marketBase,               // full float pre-spread — international spot reference
      adjustedBaseAedPerGram: adjustedBase,        // full float with admin spread — TV board item engine
      bidUsdPerOz:       spot.bidUsdPerOz        != null ? round2(spot.bidUsdPerOz)        : null,
      askUsdPerOz:       spot.askUsdPerOz        != null ? round2(spot.askUsdPerOz)        : null,
      dailyLowUsdPerOz:  spot.dailyLowUsdPerOz  != null ? round2(spot.dailyLowUsdPerOz)  : null,
      dailyHighUsdPerOz: spot.dailyHighUsdPerOz != null ? round2(spot.dailyHighUsdPerOz) : null,
      spreadPercent:     spreadPct,
      laborCostPercent:  laborPct,
      gold9999Offset:    g9999Off,
      jewellery22kOffset: j22kOff,

      // ── Admin/invoice rates (spread + labor + manual offset applied) ──────────
      // Dubai convention: spot = 9999 rate, no 0.9999 factor; 995 discount applied only for 995 bars.
      // Offsets are added AFTER all formula math so the admin's +/- adjustment is
      // a simple flat AED amount on top of the fully computed price.
      ttBar995Total:   round2(adjustedBase * TOLA_BAR_GRAMS * PURITY_995),
      ttBar9999Total:  round2(adjustedBase * TOLA_BAR_GRAMS),
      gold9999Rate:    round2(adjustedBase + g9999Off),
      goldKg9999Total: round2(adjustedBase * 1000),
      goldKg9999Rate:  round2(adjustedBase),
      kgBar995Total:   round2(adjustedBase * 1000 * PURITY_995),
      gold22kRate:     round2(adjustedBase * PURITY_22K * laborMult + j22kOff),
      gold21kRate:     round2(adjustedBase * PURITY_21K * laborMult),
      gold18kRate:     round2(adjustedBase * PURITY_18K * laborMult),

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
