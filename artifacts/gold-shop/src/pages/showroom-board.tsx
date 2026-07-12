import React, { useEffect, useMemo, useRef, useState } from "react";
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
const CYAN        = "#22d3ee";
const AMBER       = "#f59e0b";
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

// ── Spot value card ───────────────────────────────────────────────────────────
interface SpotCardProps { label: string; sub: string; value: number | null; color: string; icon: string; }

function SpotCard({ label, sub, value, color, icon }: SpotCardProps) {
  return (
    <div
      style={{
        flex: 1,
        background: `linear-gradient(145deg, #0e0e0e 0%, #0a0a0a 100%)`,
        border: `1px solid ${color}33`,
        borderTop: `2px solid ${color}`,
        borderRadius: "clamp(0.5rem,1vw,1rem)",
        padding: "clamp(0.6rem,1.4vh,1.2rem) clamp(0.8rem,1.8vw,1.6rem)",
        boxShadow: `0 0 40px -15px ${color}55, 0 8px 32px -10px #000000bb`,
        display: "flex",
        flexDirection: "column",
        gap: "clamp(0.25rem,0.6vh,0.5rem)",
        minWidth: 0,
      }}
    >
      {/* Label */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.4em" }}>
        <span style={{ fontSize: "clamp(0.9rem,1.6vh,1.5rem)", lineHeight: 1 }}>{icon}</span>
        <span
          style={{
            color,
            fontWeight: 900,
            fontSize: "clamp(0.6rem,calc(0.55vh + 0.55vw),1rem)",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: `${color}88`,
            fontSize: "clamp(0.5rem,calc(0.4vh + 0.4vw),0.75rem)",
            fontWeight: 600,
            letterSpacing: "0.1em",
            marginLeft: "0.2em",
          }}
        >
          {sub}
        </span>
      </div>

      {/* Value */}
      <div
        className="tabular-nums"
        style={{
          color: "#ffffff",
          fontFamily: "monospace",
          fontWeight: 900,
          fontSize: "clamp(1.4rem,calc(2vh + 2vw),4rem)",
          lineHeight: 1,
          letterSpacing: "-0.03em",
          textShadow: `0 2px 20px #00000099`,
        }}
      >
        {fmt(value, 2)}
      </div>

      {/* Bottom accent bar */}
      <div style={{ height: "2px", background: `linear-gradient(90deg,${color}66 0%,${color}00 100%)`, borderRadius: "1px" }} />
    </div>
  );
}

// ── Big price card (2-item full-screen layout) ───────────────────────────────
const CARD_ACCENTS = [GOLD, AMBER] as const;

interface BigCardProps {
  item: PriceItem;
  price: number | null;
  dir: Dir;
  accent: string;
}

function BigPriceCard({ item, price, dir, accent }: BigCardProps) {
  useEffect(() => { ensureKeyframes(); }, []);
  const isUp   = dir === "up";
  const isDown = dir === "down";
  const isTick = isUp || isDown;
  const tickColor = isUp ? GREEN : RED;
  const priceColor = isTick ? tickColor : "#ffffff";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        background: `linear-gradient(160deg,#111008 0%,#0a0a0a 60%,#0d0d0d 100%)`,
        border: `1px solid ${accent}33`,
        borderTop: `3px solid ${accent}`,
        borderRadius: "clamp(0.5rem,1vw,1rem)",
        boxShadow: `0 0 80px -25px ${accent}33, 0 12px 50px -15px #000000cc`,
        padding: "clamp(1.5rem,4vh,4rem) clamp(1.2rem,3vw,3rem)",
        gap: "clamp(0.8rem,2vh,2.2rem)",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {/* Background radial glow */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "90%",
          height: "90%",
          background: `radial-gradient(ellipse at center,${accent}09 0%,transparent 65%)`,
          pointerEvents: "none",
        }}
      />

      {/* Icon */}
      <div
        style={{
          width: "clamp(3rem,6vh,7rem)",
          height: "clamp(3rem,6vh,7rem)",
          opacity: 0.75,
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
          fontSize: "clamp(1.2rem,calc(1.8vh + 1.5vw),3.5rem)",
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          textAlign: "center",
          textShadow: `0 0 40px ${accent}55`,
          lineHeight: 1.1,
          flexShrink: 0,
        }}
      >
        {item.name}
      </div>

      {/* Weight badge */}
      <div
        style={{
          color: GOLD,
          fontWeight: 800,
          fontSize: "clamp(0.8rem,calc(0.9vh + 0.7vw),1.5rem)",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          background: `${GOLD}14`,
          border: `1px solid ${GOLD}44`,
          borderRadius: "0.5rem",
          padding: "clamp(0.2rem,0.5vh,0.5rem) clamp(0.8rem,2vw,1.8rem)",
          flexShrink: 0,
        }}
      >
        {item.weightLabel}
      </div>

      {/* Price block */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.3em",
          flexShrink: 0,
        }}
      >
        {/* Direction arrow */}
        {isTick && (
          <span
            style={{
              color: tickColor,
              fontWeight: 900,
              fontSize: "clamp(1.4rem,4vh,5rem)",
              lineHeight: 1,
              animation: `${isUp ? "hgUp" : "hgDown"} 2s ease-out forwards`,
              userSelect: "none",
            }}
          >
            {isUp ? "▲" : "▼"}
          </span>
        )}

        {/* Price + AED */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.35em" }}>
          <span
            className="tabular-nums"
            style={{
              color: priceColor,
              fontFamily: "monospace",
              fontWeight: 900,
              fontSize: "clamp(2.8rem,calc(5vh + 4.5vw),10rem)",
              lineHeight: 1,
              letterSpacing: "-0.03em",
              whiteSpace: "nowrap",
              textShadow: isTick
                ? `0 0 50px ${tickColor}99`
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
              fontSize: "clamp(1rem,calc(1.6vh + 1.2vw),2.8rem)",
              fontFamily: "sans-serif",
              opacity: 0.85,
              paddingBottom: "0.1em",
            }}
          >
            AED
          </span>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div
        style={{
          height: "3px",
          width: "55%",
          background: `linear-gradient(90deg,transparent,${accent}88,transparent)`,
          borderRadius: "2px",
          flexShrink: 0,
        }}
      />
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

  // Hardcoded permanent allowlist — only these two items ever appear on the TV board
  // regardless of DB tvVisible flags or any admin configuration changes.
  const PINNED_NAMES = ["GOLD 9999", "JEWELLERY 22K"] as const;

  const visibleItems = useMemo(() => {
    const all = priceItems ?? [];
    return PINNED_NAMES
      .map(name => all.find(i => i.name === name))
      .filter((i): i is PriceItem => i != null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceItems]);

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
        overflow: "hidden",
      }}
    >
      <div
        style={{
          maxWidth: 1600,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          padding: "clamp(0.6rem,1.5vh,1.4rem) clamp(0.8rem,2.5vw,2.5rem)",
          gap: "clamp(0.4rem,1vh,0.9rem)",
          boxSizing: "border-box",
        }}
      >

        {/* ── HEADER ───────────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            paddingBottom: "clamp(0.4rem,0.9vh,0.8rem)",
            borderBottom: `1px solid ${GOLD}28`,
            flexShrink: 0,
          }}
        >
          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.5rem,1.2vw,1.1rem)" }}>
            {showroomLogoUrl ? (
              <img
                src={showroomLogoUrl}
                alt="Logo"
                style={{
                  height: "clamp(2.4rem,7vh,5.5rem)",
                  maxWidth: "min(45vw,220px)",
                  objectFit: "contain",
                  filter: `drop-shadow(0 0 20px ${GOLD}66)`,
                }}
              />
            ) : (
              <>
                {/* Ornamental diamond */}
                <div
                  style={{
                    width:  "clamp(2rem,5vh,4.5rem)",
                    height: "clamp(2rem,5vh,4.5rem)",
                    border: `2px solid ${GOLD}`,
                    transform: "rotate(45deg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    boxShadow: `0 0 24px ${GOLD}44, 0 0 60px ${GOLD}22`,
                  }}
                >
                  <div
                    style={{
                      width: "55%", height: "55%",
                      background: GOLD,
                      transform: "rotate(0deg)",
                    }}
                  />
                </div>

                {/* Shop name */}
                <div>
                  <div
                    style={{
                      color: GOLD,
                      fontWeight: 900,
                      fontSize: "clamp(1.2rem,calc(1.8vh + 1.6vw),4rem)",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      lineHeight: 1,
                      textShadow: `0 0 40px ${GOLD}66, 0 2px 8px #00000099`,
                    }}
                  >
                    {shopName}
                  </div>
                  <div
                    style={{
                      color: `${GOLD}88`,
                      fontWeight: 600,
                      fontSize: "clamp(0.5rem,calc(0.5vh + 0.5vw),0.9rem)",
                      letterSpacing: "0.35em",
                      textTransform: "uppercase",
                      marginTop: "0.1em",
                    }}
                  >
                    LIVE GOLD PRICE BOARD
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Clock + live indicator */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.35em", flexShrink: 0 }}>
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

        {/* ── SPOT PANEL (BID / ASK / LOW / HIGH) ─────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: "clamp(0.4rem,1vw,1rem)",
            flexShrink: 0,
          }}
        >
          <SpotCard
            label="BID oz"
            sub="USD"
            value={liveRates.bidUsdPerOz}
            color={GREEN}
            icon="⬆"
          />
          <SpotCard
            label="ASK oz"
            sub="USD"
            value={liveRates.askUsdPerOz}
            color={RED}
            icon="⬇"
          />
          <SpotCard
            label="LOW"
            sub="TODAY"
            value={liveRates.dailyLowUsdPerOz}
            color={RED}
            icon="↓"
          />
          <SpotCard
            label="HIGH"
            sub="TODAY"
            value={liveRates.dailyHighUsdPerOz}
            color={GREEN}
            icon="↑"
          />
        </div>

        {/* ── DIVIDER ──────────────────────────────────────────────────────── */}
        <GoldDivider />

        {/* ── PRICE CARDS (2-item full-screen layout) ──────────────────────── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            gap: "clamp(0.6rem,1.5vw,1.5rem)",
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
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
            paddingTop: "clamp(0.2rem,0.5vh,0.4rem)",
            borderTop: `1px solid ${GOLD}18`,
          }}
        >
          <span
            style={{
              color: `${GOLD}55`,
              fontSize: "clamp(0.5rem,calc(0.45vh + 0.45vw),0.8rem)",
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Prices in AED · Formula: (XAU/USD ÷ 31.1034768) × 3.6725 · Rates update every second
          </span>
          {liveRates.adjustedBaseAedPerGram != null && (
            <span
              className="tabular-nums"
              style={{
                color: `${GOLD}88`,
                fontSize: "clamp(0.5rem,calc(0.45vh + 0.45vw),0.8rem)",
                fontWeight: 700,
                letterSpacing: "0.08em",
                fontFamily: "monospace",
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
