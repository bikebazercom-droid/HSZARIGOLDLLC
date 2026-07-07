import React, { useEffect, useRef, useState } from "react";
import { useLivePrice } from "@/context/live-price";
import {
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
  useGetPublicPrices,
  getGetPublicPricesQueryKey,
} from "@workspace/api-client-react";

const GOLD = "#d4af37";
const GREEN_TICK = "#22c55e";
const RED_TICK   = "#ef4444";

// ── Ticker clock ─────────────────────────────────────────────────────────────
function useTicker() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-AE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function formatClock(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
}

function fmt(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Direction tracking ────────────────────────────────────────────────────────
type Direction = "up" | "down" | "neutral";

function useDirections(values: (number | null)[]) {
  const prevRef = useRef<(number | null)[]>(values.map(() => null));
  const [dirs, setDirs] = useState<Direction[]>(values.map(() => "neutral"));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    const next: Direction[] = values.map((v, i) => {
      const p = prev[i];
      if (v == null || p == null) return "neutral";
      if (v > p) return "up";
      if (v < p) return "down";
      return "neutral";
    });

    const changed = next.some((d, i) => d !== "neutral" && d !== dirs[i]);
    if (changed) {
      setDirs(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      // Reset to neutral after animation completes (1.8 s)
      timerRef.current = setTimeout(() => setDirs(values.map(() => "neutral")), 1800);
    }

    prevRef.current = [...values];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return dirs;
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function GoldBarIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 40 40" fill="none">
      <polygon points="6,26 10,14 34,14 30,26" fill="url(#barGrad)" stroke={GOLD} strokeWidth="1" />
      <polygon points="10,14 12,12 32,12 34,14" fill="#f4d873" opacity="0.7" />
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6e27a" />
          <stop offset="55%" stopColor={GOLD} />
          <stop offset="100%" stopColor="#8a6a1a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function GoldRingIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="22" r="11" stroke="url(#ringGrad)" strokeWidth="4" fill="none" />
      <polygon points="20,6 24,12 16,12" fill="#f6e27a" stroke={GOLD} strokeWidth="0.5" />
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f6e27a" />
          <stop offset="100%" stopColor="#8a6a1a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function GoldIngotIcon() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 40 40" fill="none">
      <polygon points="8,28 12,12 28,12 32,28" fill="url(#ingotGrad)" stroke={GOLD} strokeWidth="1" />
      <line x1="12" y1="20" x2="28" y2="20" stroke="#8a6a1a" strokeWidth="0.75" opacity="0.6" />
      <defs>
        <linearGradient id="ingotGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6e27a" />
          <stop offset="100%" stopColor={GOLD} />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Keyframe injection ────────────────────────────────────────────────────────
const STYLE_ID = "tick-animations";
function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes tickUp {
      0%   { color: ${GREEN_TICK}; text-shadow: 0 0 16px ${GREEN_TICK}cc, 0 0 40px ${GREEN_TICK}66; }
      40%  { color: ${GREEN_TICK}; text-shadow: 0 0 24px ${GREEN_TICK}ff, 0 0 60px ${GREEN_TICK}88; }
      100% { color: ${GOLD};       text-shadow: 0 0 24px ${GOLD}33; }
    }
    @keyframes tickDown {
      0%   { color: ${RED_TICK}; text-shadow: 0 0 16px ${RED_TICK}cc, 0 0 40px ${RED_TICK}66; }
      40%  { color: ${RED_TICK}; text-shadow: 0 0 24px ${RED_TICK}ff, 0 0 60px ${RED_TICK}88; }
      100% { color: ${GOLD};     text-shadow: 0 0 24px ${GOLD}33; }
    }
    @keyframes borderUp {
      0%   { border-color: ${GREEN_TICK}99; box-shadow: 0 0 0 1px ${GREEN_TICK}22 inset, 0 0 18px -4px ${GREEN_TICK}44; }
      100% { border-color: ${GOLD}55;      box-shadow: none; }
    }
    @keyframes borderDown {
      0%   { border-color: ${RED_TICK}99; box-shadow: 0 0 0 1px ${RED_TICK}22 inset, 0 0 18px -4px ${RED_TICK}44; }
      100% { border-color: ${GOLD}55;     box-shadow: none; }
    }
  `;
  document.head.appendChild(style);
}

// ── AssetRow ──────────────────────────────────────────────────────────────────
interface AssetRowProps {
  title: string;
  tag: string;
  value: string;
  icon: React.ReactNode;
  direction: Direction;
}

function AssetRow({ title, tag, value, icon, direction }: AssetRowProps) {
  useEffect(() => { ensureKeyframes(); }, []);

  const isUp   = direction === "up";
  const isDown = direction === "down";
  const isTick = isUp || isDown;

  const tickColor = isUp ? GREEN_TICK : isDown ? RED_TICK : GOLD;

  const containerAnim = isTick
    ? `${isUp ? "borderUp" : "borderDown"} 1.8s ease-out forwards`
    : undefined;

  const priceAnim = isTick
    ? `${isUp ? "tickUp" : "tickDown"} 1.8s ease-out forwards`
    : undefined;

  return (
    <div
      className="relative rounded-2xl flex items-center justify-between"
      style={{
        background: "linear-gradient(90deg, #131313 0%, #0a0a0a 100%)",
        border: `1px solid ${GOLD}55`,
        padding: "clamp(0.5rem, 1.6vh, 1.5rem) clamp(0.75rem, 2.2vw, 2rem)",
        height: "100%",
        minHeight: 0,
        animation: containerAnim,
        willChange: isTick ? "border-color, box-shadow" : undefined,
      }}
    >
      <div className="flex items-center min-w-0" style={{ gap: "clamp(0.5rem, 1.5vw, 1.25rem)" }}>
        <div
          className="rounded-full flex items-center justify-center shrink-0"
          style={{
            width: "clamp(2rem, calc(3vh + 1.5vw), 3.5rem)",
            height: "clamp(2rem, calc(3vh + 1.5vw), 3.5rem)",
            padding: "clamp(0.4rem, 0.9vh, 0.7rem)",
            background: "#1a1a1a",
            border: `1px solid ${GOLD}55`,
          }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div
            className="font-bold uppercase text-white truncate"
            style={{ fontSize: "clamp(0.8rem, calc(0.85vh + 0.7vw), 1.4rem)", letterSpacing: "0.03em" }}
          >
            {title}
          </div>
          <div
            className="uppercase font-semibold"
            style={{ color: GOLD, fontSize: "clamp(0.6rem, calc(0.5vh + 0.45vw), 0.95rem)", letterSpacing: "0.1em" }}
          >
            {tag}
          </div>
        </div>
      </div>

      {/* Price + direction arrow */}
      <div className="flex items-center gap-1 shrink-0">
        {isTick && (
          <span
            style={{
              color: tickColor,
              fontSize: "clamp(1rem, calc(1.5vh + 1.3vw), 2.6rem)",
              fontWeight: 900,
              lineHeight: 1,
              animation: priceAnim,
              willChange: "color",
              userSelect: "none",
            }}
          >
            {isUp ? "↑" : "↓"}
          </span>
        )}
        <div
          className="font-extrabold tabular-nums"
          style={{
            color: GOLD,
            fontSize: "clamp(1.15rem, calc(1.8vh + 1.6vw), 3rem)",
            lineHeight: 1,
            fontFamily: "monospace",
            letterSpacing: "-0.02em",
            textShadow: `0 0 24px ${GOLD}33`,
            whiteSpace: "nowrap",
            animation: priceAnim,
            willChange: isTick ? "color, text-shadow" : undefined,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

// ── ShowroomBoard ─────────────────────────────────────────────────────────────
export default function ShowroomBoard() {
  const now = useTicker();
  const { liveRates } = useLivePrice();
  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey(), refetchInterval: 60000, refetchIntervalInBackground: true },
  });
  // Poll visibility every 5 s — no auth needed, changes from admin appear quickly
  const { data: publicPrices } = useGetPublicPrices({
    query: { queryKey: getGetPublicPricesQueryKey(), refetchInterval: 5000, refetchIntervalInBackground: true },
  });
  const showroomLogoUrl = publicSettings?.showroomLogoUrl || null;

  // Always track all 7 values for direction — stable array length regardless of visibility
  const rowValues: (number | null)[] = [
    liveRates.ttBar995Total,
    liveRates.ttBar9999Total,
    liveRates.gold9999Rate,
    liveRates.kgBar995Total,
    liveRates.gold22kRate,
    liveRates.gold21kRate,
    liveRates.gold18kRate,
    liveRates.goldKg9999Total,
  ];

  const directions = useDirections(rowValues);

  // All 7 rows with their original index (for direction lookup) and visibility flag
  const allRows = [
    { idx: 0, title: "TT. BAR (0.995)",  tag: "TTB", value: fmt(liveRates.ttBar995Total), icon: <GoldBarIcon />,   visible: publicPrices?.tvShowTtBar995 ?? true },
    { idx: 1, title: "TT. BAR (0.9999)", tag: "TTB", value: fmt(liveRates.ttBar9999Total), icon: <GoldBarIcon />,   visible: publicPrices?.tvShowTtBar999 ?? true },
    { idx: 2, title: "GOLD (0.9999)",    tag: "1GM", value: fmt(liveRates.gold9999Rate),  icon: <GoldIngotIcon />, visible: publicPrices?.tvShowGold9999   ?? true },
    { idx: 3, title: "KG BAR (0.995)",   tag: "1KG", value: fmt(liveRates.kgBar995Total), icon: <GoldBarIcon />,   visible: publicPrices?.tvShowKgBar995  ?? true },
    { idx: 4, title: "Gold Jewelry 22K", tag: "1GM", value: fmt(liveRates.gold22kRate),   icon: <GoldRingIcon />,  visible: publicPrices?.tvShowGold22k   ?? true },
    { idx: 5, title: "Gold Jewelry 21K", tag: "1GM", value: fmt(liveRates.gold21kRate),   icon: <GoldRingIcon />,  visible: publicPrices?.tvShowGold21k   ?? true },
    { idx: 6, title: "Gold Jewelry 18K", tag: "1GM", value: fmt(liveRates.gold18kRate),   icon: <GoldRingIcon />,  visible: publicPrices?.tvShowGold18k    ?? true },
    { idx: 7, title: "GOLD KG (0.9999)", tag: "1KG", value: fmt(liveRates.goldKg9999Total), icon: <GoldIngotIcon />, visible: publicPrices?.tvShowGoldKg9999 ?? true },
  ];

  // Only render rows toggled ON; direction tracked by original idx (stable)
  const rows = allRows.filter(r => r.visible);

  return (
    <div
      className="w-full flex flex-col items-center min-h-screen lg:h-screen lg:overflow-hidden"
      style={{
        background: `
          linear-gradient(160deg, #0b0b0b 0%, #121212 100%),
          repeating-linear-gradient(0deg, ${GOLD}0d 0px, ${GOLD}0d 1px, transparent 1px, transparent 64px),
          repeating-linear-gradient(90deg, ${GOLD}0d 0px, ${GOLD}0d 1px, transparent 1px, transparent 64px)
        `,
        backgroundBlendMode: "normal, normal, normal",
        padding: "clamp(0.5rem, 1.2vh, 1.5rem) clamp(0.75rem, 2.5vw, 3rem)",
      }}
    >
      <div className="w-full flex flex-col mx-auto lg:h-full" style={{ maxWidth: 1400 }}>

        {/* ── Header: logo + date/clock pill ── */}
        <div
          className="flex flex-col items-center shrink-0"
          style={{ gap: "clamp(0.3rem, 0.7vh, 0.75rem)", paddingBottom: "clamp(0.3rem, 0.8vh, 0.75rem)" }}
        >
          {showroomLogoUrl ? (
            <div
              className="flex items-center justify-center"
              style={{
                height: "clamp(3.5rem, 10vh, 80px)",
                marginBottom: "clamp(0.2rem, 0.5vh, 0.5rem)",
                filter: `drop-shadow(0 0 28px ${GOLD}66)`,
              }}
            >
              <img
                src={showroomLogoUrl}
                alt="Showroom logo"
                className="max-h-full max-w-full object-contain"
                style={{ maxWidth: "min(90vw, 280px)" }}
              />
            </div>
          ) : (
            <div
              className="font-black uppercase flex items-center justify-center"
              style={{
                color: GOLD,
                fontSize: "clamp(1.15rem, calc(1.4vh + 1.4vw), 2.4rem)",
                letterSpacing: "0.14em",
                textShadow: `0 0 30px ${GOLD}55`,
                fontFamily: "serif",
                gap: "clamp(0.35rem, 0.8vw, 0.75rem)",
                whiteSpace: "nowrap",
              }}
            >
              Hazari Gold <span style={{ color: "#f5f5f5", fontSize: "0.65em" }}>✦</span>
            </div>
          )}

          <div
            className="flex items-center justify-between rounded-full w-full"
            style={{
              border: `1px solid ${GOLD}66`,
              background: "#111111",
              maxWidth: 560,
              padding: "clamp(0.3rem, 0.7vh, 0.65rem) clamp(1rem, 2.5vw, 2.5rem)",
              gap: "clamp(0.75rem, 2vw, 2.5rem)",
            }}
          >
            <span
              className="text-neutral-300 font-semibold truncate"
              style={{ fontSize: "clamp(0.65rem, calc(0.55vh + 0.55vw), 1.1rem)" }}
            >
              {formatDate(now)}
            </span>
            <span
              className="font-bold tabular-nums shrink-0"
              style={{ color: GOLD, fontSize: "clamp(0.75rem, calc(0.65vh + 0.6vw), 1.25rem)", fontFamily: "monospace" }}
            >
              {formatClock(now)}
            </span>
          </div>
        </div>

        {/* ── 7 asset rows ── */}
        <div
          className="flex flex-col w-full lg:flex-1 lg:min-h-0"
          style={{ gap: "clamp(0.25rem, 0.6vh, 0.6rem)" }}
        >
          {rows.map(row => (
            <div
              key={row.title}
              className="lg:flex-1 lg:min-h-0"
              style={{ minHeight: "clamp(3rem, 7vh, 5rem)" }}
            >
              <AssetRow {...row} direction={directions[row.idx]} />
            </div>
          ))}
        </div>

        <div
          className="text-neutral-500 text-center tracking-wide shrink-0"
          style={{ fontSize: "clamp(0.55rem, calc(0.45vh + 0.35vw), 0.8rem)", paddingTop: "clamp(0.25rem, 0.6vh, 0.6rem)" }}
        >
          {liveRates.isLive ? "((●)) Live — Real-time 1s Sync" : "Connecting to live feed…"}
          {liveRates.updatedAt && ` · ${new Date(liveRates.updatedAt).toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
        </div>
      </div>
    </div>
  );
}
