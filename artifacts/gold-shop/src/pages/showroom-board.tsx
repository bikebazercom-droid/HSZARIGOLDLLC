import React, { useEffect, useMemo, useRef, useState } from "react";
import hazariLogoImg from "@assets/11-removebg-preview_1783860859844.png";
import { useLivePrice } from "@/context/live-price";
import {
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
  useGetPublicPriceItems,
  getGetPublicPriceItemsQueryKey,
  PriceItem,
} from "@workspace/api-client-react";

// ── Design tokens ──────────────────────────────────────────────────────────────
const GOLD        = "#d4af37";
const GOLD_LIGHT  = "#f0d060";
const GOLD_DIM    = "#a07820";
const GREEN       = "#22c55e";
const RED         = "#ef4444";
const AMBER       = "#f59e0b";   // used only for STALE live-dot indicator
const BG_DEEP     = "#080808";
const BG_CARD     = "#0f0f0f";
const BG_ROW      = "#111111";
const BORDER      = `${GOLD}33`;

// ── Clock ─────────────────────────────────────────────────────────────────────
function useTicker() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}
function formatClock(d: Date) {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
}

// ── Screen Wake Lock ──────────────────────────────────────────────────────────
function useWakeLock() {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    async function acquire() {
      try {
        if (sentinelRef.current) { await sentinelRef.current.release().catch(() => {}); sentinelRef.current = null; }
        sentinelRef.current = await navigator.wakeLock.request("screen");
      } catch { /* hidden tab — visibilitychange will retry */ }
    }
    acquire();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); sentinelRef.current?.release().catch(() => {}); sentinelRef.current = null; };
  }, []);
}

// ── Formatting ─────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-AE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ── Price item formula engine ─────────────────────────────────────────────────
// spot_bar      → adjustedBaseAedPerGram × weightGrams × purityFactor + offset
// spot_per_gram → adjustedBaseAedPerGram × purityFactor + offset
// manual        → manualRateAed + offset
const r2 = (n: number) => Math.round(n * 100) / 100;

function computeItemPrice(item: PriceItem, base: number | null): number | null {
  if (item.formulaType === "manual") return item.manualRateAed == null ? null : r2(item.manualRateAed + item.premiumOffsetAed);
  if (base == null) return null;
  if (item.formulaType === "spot_bar") return r2(base * (item.weightGrams ?? 0) * item.purityFactor + item.premiumOffsetAed);
  return r2(base * item.purityFactor + item.premiumOffsetAed);
}

// ── Direction tracking ────────────────────────────────────────────────────────
type Dir = "up" | "down" | "neutral";

function useItemDirs(priceMap: Map<number, number | null>) {
  const prevRef  = useRef<Map<number, number | null>>(new Map());
  const [dirs, setDirs] = useState<Map<number, Dir>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    const next  = new Map<number, Dir>();
    let changed = false;
    for (const [id, price] of priceMap) {
      const p = prev.get(id) ?? null;
      let dir: Dir = "neutral";
      if (price != null && p != null) { if (price > p) dir = "up"; else if (price < p) dir = "down"; }
      next.set(id, dir);
      if (dir !== "neutral" && dir !== (dirs.get(id) ?? "neutral")) changed = true;
    }
    if (changed) {
      setDirs(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setDirs(new Map([...priceMap.keys()].map(id => [id, "neutral" as Dir]))), 2000);
    }
    prevRef.current = new Map(priceMap);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceMap]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return dirs;
}

// ── Inject keyframes once ────────────────────────────────────────────────────
const STYLE_ID = "hg-tv-anims";
function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes hgUp {
      0%   { color:${GREEN}; text-shadow:0 0 24px ${GREEN}cc,0 0 60px ${GREEN}55; }
      50%  { color:${GREEN}; text-shadow:0 0 40px ${GREEN}ff,0 0 90px ${GREEN}77; }
      100% { color:#ffffff;  text-shadow:none; }
    }
    @keyframes hgDown {
      0%   { color:${RED}; text-shadow:0 0 24px ${RED}cc,0 0 60px ${RED}55; }
      50%  { color:${RED}; text-shadow:0 0 40px ${RED}ff,0 0 90px ${RED}77; }
      100% { color:#ffffff; text-shadow:none; }
    }
    @keyframes hgRowUp {
      0%   { background: linear-gradient(90deg,#041804 0%,#0b1e0b 40%,${BG_ROW} 100%); border-left-color:${GREEN}; }
      100% { background: linear-gradient(90deg,${BG_CARD} 0%,${BG_ROW} 100%);          border-left-color:${GOLD}55; }
    }
    @keyframes hgRowDown {
      0%   { background: linear-gradient(90deg,#1a0404 0%,#1e0b0b 40%,${BG_ROW} 100%); border-left-color:${RED}; }
      100% { background: linear-gradient(90deg,${BG_CARD} 0%,${BG_ROW} 100%);           border-left-color:${GOLD}55; }
    }
    @keyframes hgPulse {
      0%,100% { opacity:1; }
      50%     { opacity:0.4; }
    }
    @keyframes hgSpin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(s);
}

// ── SVG icon helpers ─────────────────────────────────────────────────────────
function IconBar() {
  return (
    <svg viewBox="0 0 40 28" fill="none" width="100%" height="100%">
      <defs>
        <linearGradient id="bar-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={GOLD_LIGHT}/>
          <stop offset="60%" stopColor={GOLD}/>
          <stop offset="100%" stopColor="#7a5a10"/>
        </linearGradient>
      </defs>
      <polygon points="3,24 8,8 36,8 31,24" fill="url(#bar-g)"/>
      <polygon points="8,8 10,5 34,5 36,8" fill={GOLD_LIGHT} opacity="0.6"/>
      <line x1="14" y1="16" x2="26" y2="16" stroke="#7a5a10" strokeWidth="1" opacity="0.5"/>
    </svg>
  );
}
function IconGem() {
  return (
    <svg viewBox="0 0 40 36" fill="none" width="100%" height="100%">
      <defs>
        <linearGradient id="gem-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={GOLD_LIGHT}/>
          <stop offset="100%" stopColor={GOLD}/>
        </linearGradient>
      </defs>
      <polygon points="20,4 36,14 28,32 12,32 4,14" stroke="url(#gem-g)" strokeWidth="2" fill={`${GOLD}22`}/>
      <polygon points="20,4 36,14 20,20" fill={`${GOLD}44`}/>
      <polygon points="20,4 4,14 20,20"  fill={`${GOLD}33`}/>
    </svg>
  );
}
function IconRing() {
  return (
    <svg viewBox="0 0 40 40" fill="none" width="100%" height="100%">
      <defs>
        <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={GOLD_LIGHT}/>
          <stop offset="100%" stopColor="#7a5a10"/>
        </linearGradient>
      </defs>
      <circle cx="20" cy="24" r="12" stroke="url(#ring-g)" strokeWidth="4" fill="none"/>
      <path d="M13 18 Q20 8 27 18" stroke="url(#ring-g)" strokeWidth="4" fill="none" strokeLinecap="round"/>
      <circle cx="20" cy="33" r="2.5" fill={GOLD}/>
    </svg>
  );
}

function iconForItem(item: PriceItem): React.ReactNode {
  if (item.formulaType === "spot_bar") return <IconBar />;
  if (item.purityFactor >= 0.99) return <IconGem />;
  return <IconRing />;
}

// ── Gold Spot Widget — TradingView live XAU/USD embed ────────────────────────
// Replaces the custom Bid/Ask/High/Low cards with TradingView's real-time
// symbol-info widget for FX_IDC:XAUUSD, rendered directly from TradingView's
// servers in the browser. No scraping, no proxy — prices come from TradingView.
function GoldSpotWidget() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.innerHTML = "";

    const inner = document.createElement("div");
    inner.className = "tradingview-widget-container__widget";
    el.appendChild(inner);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js";
    script.async = true;
    script.textContent = JSON.stringify({
      symbol: "FX_IDC:XAUUSD",
      width: "100%",
      locale: "en",
      colorTheme: "dark",
      isTransparent: true,
    });
    el.appendChild(script);

    return () => { el.innerHTML = ""; };
  }, []);

  return (
    <div
      style={{
        background: "#0d0d0d",
        border: `1px solid ${GOLD}2a`,
        borderRadius: "clamp(0.7rem,1.4vw,1.4rem)",
        padding: "clamp(0.6rem,1.4vh,1.3rem) clamp(0.8rem,2vw,1.8rem)",
        display: "flex",
        flexDirection: "column",
        gap: "clamp(0.4rem,0.9vh,0.85rem)",
        flexShrink: 0,
        boxShadow: `0 4px 48px -12px #000000dd`,
      }}
    >
      {/* ── GOLD SPOT label ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: "clamp(0.3rem,0.7vh,0.6rem)",
          borderBottom: `1px solid ${GOLD}28`,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: GOLD,
            fontWeight: 800,
            fontSize: "clamp(0.7rem,calc(0.55vh + 0.55vw),1.1rem)",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            textShadow: `0 0 20px ${GOLD}44`,
          }}
        >
          GOLD SPOT
        </span>
      </div>

      {/* ── TradingView symbol-info widget (XAU/USD live) ─────────────────────
          Injects TradingView's embed-widget-symbol-info script which renders
          a live dark-themed price panel: last price, daily change %, High, Low.
          All data streams directly from TradingView's servers to the browser. */}
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ width: "100%", minHeight: "clamp(7rem,16vh,14rem)" }}
      />
    </div>
  );
}

// ── Big price card (2-item full-screen layout) ───────────────────────────────
// Both asset rows use the brand gold accent — AMBER is reserved for the live-dot stale state only
const CARD_ACCENTS = [GOLD, GOLD] as const;

interface BigCardProps {
  item: PriceItem;
  price: number | null;
  dir: Dir;
  accent: string;
}

function BigPriceCard({ item, price, dir, accent }: BigCardProps) {
  useEffect(() => { ensureKeyframes(); }, []);
  const isUp      = dir === "up";
  const isDown    = dir === "down";
  const isTick    = isUp || isDown;
  const tickColor = isUp ? GREEN : RED;
  const priceColor = isTick ? tickColor : "#ffffff";

  return (
    <div
      className="flex flex-row items-center justify-between"
      style={{
        flex: 1,
        maxHeight: "clamp(4.5rem,13vh,8rem)",
        position: "relative",
        background: `linear-gradient(160deg,#111111 0%,#0a0a0a 60%,#0d0d0d 100%)`,
        border: `1px solid ${accent}33`,
        borderLeft: `5px solid ${accent}`,
        borderRadius: "clamp(0.5rem,1vw,1rem)",
        boxShadow: `0 0 80px -25px ${accent}33, 0 8px 40px -12px #000000cc`,
        padding: "clamp(0.35rem,1.2vh,1.2rem) clamp(0.75rem,3vw,4rem)",
        overflow: "hidden",
      }}
    >
      {/* Background radial glow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse 70% 80% at 20% 50%,${accent}08 0%,transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      {/* ── LEFT: icon + name + weight badge (always horizontal) ──────────────── */}
      <div
        className="flex flex-row items-center flex-shrink-0"
        style={{ gap: "clamp(0.3rem,1.2vw,2rem)", zIndex: 1 }}
      >
        {/* Icon */}
        <div
          style={{
            width: "clamp(1.4rem,3.5vw,5rem)",
            height: "clamp(1.4rem,3.5vw,5rem)",
            opacity: 0.8,
            flexShrink: 0,
          }}
        >
          {iconForItem(item)}
        </div>

        {/* Item name */}
        <div
          style={{
            color: accent,
            fontWeight: 900,
            fontSize: "clamp(0.6rem,calc(1.1vw+0.7vh),2rem)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            textShadow: `0 0 50px ${accent}55`,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {item.name}
        </div>

        {/* Weight badge — always visible, inline right of name */}
        <div
          className="sm:hidden flex-shrink-0"
          style={{
            color: GOLD,
            fontWeight: 700,
            fontSize: "clamp(0.5rem,1.8vw,0.8rem)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            background: "#0d0d0d",
            border: `1px solid ${GOLD}55`,
            borderRadius: "0.3rem",
            padding: "0.15rem 0.4rem",
            whiteSpace: "nowrap",
          }}
        >
          {item.weightLabel}
        </div>
      </div>

      {/* ── CENTER: vertical divider + weight badge — desktop only ── */}
      <div
        className="hidden sm:block"
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: "1px",
          transform: "translateX(-50%)",
          background: `linear-gradient(180deg, transparent 0%, ${GOLD}28 25%, ${GOLD}28 75%, transparent 100%)`,
          pointerEvents: "none",
        }}
      />
      <div
        className="hidden sm:block"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          zIndex: 2,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            color: GOLD,
            fontWeight: 800,
            fontSize: "clamp(0.7rem,calc(0.85vh + 0.75vw),1.5rem)",
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            background: "#0d0d0d",
            border: `1px solid ${GOLD}66`,
            borderRadius: "0.4rem",
            padding: "clamp(0.2rem,0.4vh,0.5rem) clamp(0.6rem,1.4vw,1.6rem)",
            textAlign: "center",
            whiteSpace: "nowrap",
            boxShadow: `0 0 20px ${GOLD}22`,
          }}
        >
          {item.weightLabel}
        </div>
      </div>

      {/* ── RIGHT: arrow + price + AED (always horizontal, fluid sizing) ── */}
      <div
        className="flex flex-row items-center justify-end flex-shrink-0"
        style={{ gap: "clamp(0.2rem,0.8vw,1.5rem)", zIndex: 1 }}
      >
        {/* Direction arrow */}
        {isTick && (
          <span
            style={{
              color: tickColor,
              fontWeight: 900,
              fontSize: "clamp(0.75rem,calc(1.4vw+1.2vh),4rem)",
              lineHeight: 1,
              animation: `${isUp ? "hgUp" : "hgDown"} 2s ease-out forwards`,
              userSelect: "none",
            }}
          >
            {isUp ? "▲" : "▼"}
          </span>
        )}

        {/* Price + AED */}
        <div className="flex items-baseline" style={{ gap: "0.25em" }}>
          <span
            className="tabular-nums"
            style={{
              color: priceColor,
              fontFamily: "monospace",
              fontWeight: 900,
              fontSize: "clamp(1.2rem,calc(2.8vw+1.6vh),7rem)",
              lineHeight: 1,
              letterSpacing: "-0.03em",
              whiteSpace: "nowrap",
              textShadow: isTick
                ? `0 0 60px ${tickColor}99`
                : `0 0 40px ${accent}22`,
              animation: isTick
                ? `${isUp ? "hgUp" : "hgDown"} 2s ease-out forwards`
                : undefined,
            }}
          >
            {fmt(price)}
          </span>
          <span
            style={{
              color: GOLD,
              fontWeight: 700,
              fontFamily: "sans-serif",
              fontSize: "clamp(0.55rem,calc(1vw+0.75vh),2rem)",
              opacity: 0.85,
              paddingBottom: "0.1em",
              whiteSpace: "nowrap",
            }}
          >
            AED
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Separator ornament ────────────────────────────────────────────────────────
function GoldDivider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0 0.5rem" }}>
      <div style={{ flex: 1, height: "1px", background: `linear-gradient(90deg,transparent,${GOLD}44,transparent)` }} />
      <span style={{ color: GOLD, fontSize: "0.8rem", opacity: 0.6, userSelect: "none" }}>◆</span>
      <div style={{ flex: 1, height: "1px", background: `linear-gradient(90deg,transparent,${GOLD}44,transparent)` }} />
    </div>
  );
}

// ── Live indicator dot ────────────────────────────────────────────────────────
function LiveDot({ isLive, isStale }: { isLive: boolean; isStale: boolean }) {
  const color = !isLive ? "#555" : isStale ? AMBER : GREEN;
  const label = !isLive ? "OFFLINE" : isStale ? "CACHED" : "LIVE";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.45em" }}>
      <div
        style={{
          width: "clamp(0.45rem,0.9vw,0.75rem)",
          height: "clamp(0.45rem,0.9vw,0.75rem)",
          borderRadius: "50%",
          background: color,
          boxShadow: isLive && !isStale ? `0 0 8px 2px ${GREEN}88` : undefined,
          animation: isLive && !isStale ? "hgPulse 2s ease-in-out infinite" : undefined,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          color,
          fontWeight: 800,
          fontSize: "clamp(0.55rem,calc(0.5vh + 0.5vw),0.9rem)",
          letterSpacing: "0.15em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── ShowroomBoard ─────────────────────────────────────────────────────────────
export default function ShowroomBoard() {
  const now = useTicker();
  useWakeLock();
  useEffect(() => { ensureKeyframes(); }, []);

  const { liveRates } = useLivePrice();

  const { data: publicSettings } = useGetPublicSettings({
    query: {
      queryKey: getGetPublicSettingsQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: true,
    },
  });

  const { data: priceItems } = useGetPublicPriceItems({
    query: {
      queryKey: getGetPublicPriceItemsQueryKey(),
      refetchInterval: 30_000,
      refetchIntervalInBackground: true,
    },
  });

  const showroomLogoUrl = publicSettings?.showroomLogoUrl ?? null;
  const shopName        = "HAZARI GOLD";

  // Show all items whose tvVisible flag is true, sorted by displayOrder.
  // Admins control this from the Live Pricing page — no hardcoded allowlist.
  const visibleItems = useMemo(
    () =>
      (priceItems ?? [])
        .filter(i => i.tvVisible)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [priceItems],
  );

  const priceMap = useMemo<Map<number, number | null>>(() => {
    const m = new Map<number, number | null>();
    for (const item of visibleItems) m.set(item.id, computeItemPrice(item, liveRates.adjustedBaseAedPerGram));
    return m;
  }, [visibleItems, liveRates.adjustedBaseAedPerGram]);

  const dirs = useItemDirs(priceMap);

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: BG_DEEP,
        backgroundImage: `
          radial-gradient(ellipse 80% 40% at 50% 0%, ${GOLD}08 0%, transparent 70%),
          repeating-linear-gradient(0deg,  ${GOLD}06 0px, ${GOLD}06 1px, transparent 1px, transparent 80px),
          repeating-linear-gradient(90deg, ${GOLD}06 0px, ${GOLD}06 1px, transparent 1px, transparent 80px)
        `,
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
      }}
    >
      <div
        className="min-h-screen sm:h-screen overflow-y-auto sm:overflow-hidden"
        style={{
          maxWidth: 1600,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          padding: "clamp(0.5rem,1.5vh,1.4rem) clamp(0.5rem,2.5vw,2.5rem)",
          gap: "clamp(0.4rem,1vh,0.9rem)",
          boxSizing: "border-box",
        }}
      >

        {/* ── HEADER ───────────────────────────────────────────────────────── */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingBottom: "clamp(0.4rem,0.9vh,0.8rem)",
            borderBottom: `1px solid ${GOLD}28`,
            flexShrink: 0,
            minHeight: "clamp(4rem,12vh,9rem)",
          }}
        >
          {/* Brand — transparent PNG logo, crisp on dark background */}
          <img
            src={hazariLogoImg}
            alt="Hazari Gold LLC"
            style={{
              height: "clamp(3.5rem,11vh,8.5rem)",
              maxWidth: "min(85vw,640px)",
              objectFit: "contain",
              objectPosition: "center",
              filter: `drop-shadow(0 0 20px ${GOLD}55)`,
            }}
          />

          {/* Clock + live indicator — absolute top-right overlay */}
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "0.35em",
            }}
          >
            <LiveDot isLive={liveRates.isLive} isStale={liveRates.isStale} />
            <div
              style={{
                color: "#cccccc",
                fontWeight: 600,
                fontSize: "clamp(0.6rem,calc(0.55vh + 0.55vw),1rem)",
                letterSpacing: "0.06em",
              }}
            >
              {formatDate(now)}
            </div>
            <div
              className="tabular-nums"
              style={{
                color: GOLD_LIGHT,
                fontFamily: "monospace",
                fontWeight: 900,
                fontSize: "clamp(1.1rem,calc(1.6vh + 1.4vw),3.2rem)",
                letterSpacing: "0.04em",
                lineHeight: 1,
                textShadow: `0 0 30px ${GOLD}55`,
              }}
            >
              {formatClock(now)}
            </div>
          </div>
        </div>

        {/* ── GOLD SPOT WIDGET (ASK / BID with LOW / HIGH) ──────────────── */}
        <GoldSpotWidget />

        {/* ── DIVIDER ──────────────────────────────────────────────────────── */}
        <GoldDivider />

        {/* ── PRICE CARDS (stacked vertically, GOLD 9999 top / JEWELLERY 22K bottom) ── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "clamp(0.4rem,0.8vh,0.9rem)",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          {visibleItems.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: `${GOLD}55`,
                fontSize: "clamp(1rem,2.5vw,2rem)",
                fontWeight: 700,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              }}
            >
              {liveRates.isLive ? "Connecting…" : "Connecting to live feed…"}
            </div>
          ) : (
            visibleItems.map((item, i) => (
              <BigPriceCard
                key={item.id}
                item={item}
                price={priceMap.get(item.id) ?? null}
                dir={dirs.get(item.id) ?? "neutral"}
                accent={CARD_ACCENTS[i % CARD_ACCENTS.length]}
              />
            ))
          )}
        </div>

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between"
          style={{
            flexShrink: 0,
            paddingTop: "clamp(0.2rem,0.5vh,0.4rem)",
            borderTop: `1px solid ${GOLD}18`,
            gap: "0.5rem",
          }}
        >
          {/* Formula text — full on desktop, abbreviated on mobile */}
          <span
            className="hidden sm:inline"
            style={{
              color: `${GOLD}55`,
              fontSize: "clamp(0.5rem,calc(0.45vh + 0.45vw),0.8rem)",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            Prices in AED · Formula: (XAU/USD ÷ 31.1034768) × 3.6725 · Rates update every second
          </span>
          <span
            className="sm:hidden"
            style={{
              color: `${GOLD}55`,
              fontSize: "clamp(0.5rem,1.8vw,0.65rem)",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Prices in AED
          </span>
          {liveRates.adjustedBaseAedPerGram != null && (
            <span
              className="tabular-nums"
              style={{
                color: `${GOLD}88`,
                fontSize: "clamp(0.6rem,calc(0.45vh + 0.45vw),0.8rem)",
                fontWeight: 700,
                letterSpacing: "0.08em",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >
              {liveRates.spreadPercent > 0
                ? `DUBAI 24K: AED ${fmt(liveRates.adjustedBaseAedPerGram, 4)}/g`
                : `BASE 24K: AED ${fmt(liveRates.adjustedBaseAedPerGram, 4)}/g`}
            </span>
          )}
        </div>

      </div>
    </div>
  );
}
