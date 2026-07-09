import React, { useEffect, useRef, useState } from "react";
import { useLivePrice } from "@/context/live-price";
import {
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
  useGetPublicPrices,
  getGetPublicPricesQueryKey,
} from "@workspace/api-client-react";

const GOLD       = "#d4af37";
const ASK_COLOR  = "#f87171";   // coral/red for ASK side
const BID_COLOR  = "#4ade80";   // green for BID side
const GREEN_TICK = "#22c55e";
const RED_TICK   = "#ef4444";
const HEADER_BG  = "#3b2409";   // dark brown/copper for table header
const HEADER_BORDER = "#b97a30";

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
  return d.toLocaleDateString("en-AE", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}
function formatClock(d: Date) {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });
}

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-AE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Direction tracking (for row flash animations) ─────────────────────────────
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
      timerRef.current = setTimeout(() => setDirs(values.map(() => "neutral")), 1800);
    }
    prevRef.current = [...values];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return dirs;
}

// ── Keyframes ─────────────────────────────────────────────────────────────────
const STYLE_ID = "tv-tick-anims";
function ensureKeyframes() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes tvTickUp {
      0%   { color: ${GREEN_TICK}; text-shadow: 0 0 20px ${GREEN_TICK}cc, 0 0 50px ${GREEN_TICK}55; }
      40%  { color: ${GREEN_TICK}; text-shadow: 0 0 32px ${GREEN_TICK}ff, 0 0 80px ${GREEN_TICK}77; }
      100% { color: #ffffff;       text-shadow: none; }
    }
    @keyframes tvTickDown {
      0%   { color: ${RED_TICK}; text-shadow: 0 0 20px ${RED_TICK}cc, 0 0 50px ${RED_TICK}55; }
      40%  { color: ${RED_TICK}; text-shadow: 0 0 32px ${RED_TICK}ff, 0 0 80px ${RED_TICK}77; }
      100% { color: #ffffff;     text-shadow: none; }
    }
    @keyframes tvRowUp {
      0%   { border-color: ${GREEN_TICK}; box-shadow: 0 0 0 1px ${GREEN_TICK}44 inset, 0 0 28px -6px ${GREEN_TICK}88; }
      100% { border-color: ${GOLD}44;     box-shadow: none; }
    }
    @keyframes tvRowDown {
      0%   { border-color: ${RED_TICK}; box-shadow: 0 0 0 1px ${RED_TICK}44 inset, 0 0 28px -6px ${RED_TICK}88; }
      100% { border-color: ${GOLD}44;   box-shadow: none; }
    }
  `;
  document.head.appendChild(s);
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
function IconGoldBar() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 48 48" fill="none">
      <defs>
        <linearGradient id="gb1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f9e97a" />
          <stop offset="55%" stopColor="#d4af37" />
          <stop offset="100%" stopColor="#7a5a10" />
        </linearGradient>
      </defs>
      <polygon points="7,32 13,16 41,16 35,32" fill="url(#gb1)" />
      <polygon points="13,16 15,13 39,13 41,16" fill="#f9e97a" opacity="0.7" />
      <line x1="20" y1="24" x2="28" y2="24" stroke="#7a5a10" strokeWidth="1" opacity="0.6" />
    </svg>
  );
}

function IconNecklace() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 48 48" fill="none">
      <defs>
        <linearGradient id="nk1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f9e97a" />
          <stop offset="100%" stopColor="#7a5a10" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="28" r="13" stroke="url(#nk1)" strokeWidth="4.5" fill="none" />
      <path d="M16 20 Q24 10 32 20" stroke="url(#nk1)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <circle cx="24" cy="38" r="3" fill="#d4af37" />
    </svg>
  );
}

function IconGoldBricks() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 48 48" fill="none">
      <defs>
        <linearGradient id="gi1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f9e97a" />
          <stop offset="100%" stopColor="#d4af37" />
        </linearGradient>
        <linearGradient id="gi2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4af37" />
          <stop offset="100%" stopColor="#7a5a10" />
        </linearGradient>
      </defs>
      <rect x="6" y="27" width="36" height="14" rx="2" fill="url(#gi2)" />
      <rect x="10" y="17" width="28" height="13" rx="2" fill="url(#gi1)" />
      <rect x="14" y="8" width="20" height="12" rx="2" fill="#f9e97a" />
      <line x1="6" y1="34" x2="42" y2="34" stroke="#7a5a10" strokeWidth="0.75" opacity="0.5" />
      <line x1="10" y1="23" x2="38" y2="23" stroke="#7a5a10" strokeWidth="0.75" opacity="0.5" />
    </svg>
  );
}

// ── Gold Spot Panel ───────────────────────────────────────────────────────────
interface GoldSpotPanelProps {
  ask: number | null;
  bid: number | null;
  low: number | null;
  high: number | null;
}

function GoldSpotPanel({ ask, bid, low, high }: GoldSpotPanelProps) {
  return (
    <div
      style={{
        background: "linear-gradient(160deg, #1a1a1a 0%, #0d0d0d 100%)",
        border: `1px solid ${GOLD}44`,
        borderRadius: "clamp(0.75rem, 1.5vw, 1.5rem)",
        padding: "clamp(0.6rem, 1.4vh, 1.25rem) clamp(0.75rem, 2vw, 2rem)",
        boxShadow: "0 8px 40px -12px #000000cc",
      }}
    >
      <div
        className="text-center font-black uppercase tracking-widest"
        style={{
          color: GOLD,
          fontSize: "clamp(0.9rem, calc(0.9vh + 1vw), 1.9rem)",
          letterSpacing: "0.25em",
          textShadow: `0 0 30px ${GOLD}77`,
          marginBottom: "clamp(0.5rem, 1.2vh, 1rem)",
        }}
      >
        Gold Spot
      </div>

      <div
        className="grid grid-cols-2"
        style={{ gap: "clamp(0.5rem, 1.5vw, 1.5rem)" }}
      >
        {/* ── ASK PRICE box ── */}
        <div
          style={{
            background: "linear-gradient(135deg, #1e0a0a 0%, #120505 100%)",
            border: `1px solid ${ASK_COLOR}55`,
            borderRadius: "clamp(0.5rem, 1vw, 1rem)",
            padding: "clamp(0.6rem, 1.4vh, 1.25rem) clamp(0.75rem, 2vw, 1.75rem)",
            boxShadow: `0 0 0 1px ${ASK_COLOR}18 inset`,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center font-bold uppercase tracking-wider"
            style={{
              color: ASK_COLOR,
              fontSize: "clamp(0.65rem, calc(0.6vh + 0.65vw), 1.15rem)",
              letterSpacing: "0.14em",
              gap: "0.4em",
              marginBottom: "clamp(0.35rem, 0.8vh, 0.75rem)",
            }}
          >
            <span
              className="flex items-center justify-center font-black shrink-0"
              style={{
                width: "1.5em", height: "1.5em",
                borderRadius: "50%",
                background: `${ASK_COLOR}25`,
                border: `1px solid ${ASK_COLOR}55`,
                color: ASK_COLOR,
                fontSize: "0.9em",
              }}
            >
              $
            </span>
            ASK PRICE (oz)
          </div>
          {/* Price */}
          <div
            className="tabular-nums font-black"
            style={{
              color: "#ffffff",
              fontSize: "clamp(1.6rem, calc(2.4vh + 2.4vw), 4.8rem)",
              fontFamily: "monospace",
              lineHeight: 1,
              letterSpacing: "-0.03em",
              textShadow: "0 2px 20px #00000088",
            }}
          >
            {fmt(ask)}
          </div>
          {/* Low */}
          <div
            className="flex items-center font-semibold tabular-nums"
            style={{
              color: ASK_COLOR,
              fontSize: "clamp(0.7rem, calc(0.65vh + 0.7vw), 1.25rem)",
              marginTop: "clamp(0.3rem, 0.7vh, 0.65rem)",
              gap: "0.35em",
            }}
          >
            <span style={{ opacity: 0.75, fontSize: "0.85em" }}>▼</span>
            Low &nbsp;{fmt(low)}
          </div>
        </div>

        {/* ── BID PRICE box ── */}
        <div
          style={{
            background: "linear-gradient(135deg, #061a0d 0%, #040f08 100%)",
            border: `1px solid ${BID_COLOR}55`,
            borderRadius: "clamp(0.5rem, 1vw, 1rem)",
            padding: "clamp(0.6rem, 1.4vh, 1.25rem) clamp(0.75rem, 2vw, 1.75rem)",
            boxShadow: `0 0 0 1px ${BID_COLOR}18 inset`,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center font-bold uppercase tracking-wider"
            style={{
              color: BID_COLOR,
              fontSize: "clamp(0.65rem, calc(0.6vh + 0.65vw), 1.15rem)",
              letterSpacing: "0.14em",
              gap: "0.4em",
              marginBottom: "clamp(0.35rem, 0.8vh, 0.75rem)",
            }}
          >
            <span
              className="flex items-center justify-center font-black shrink-0"
              style={{
                width: "1.5em", height: "1.5em",
                borderRadius: "50%",
                background: `${BID_COLOR}22`,
                border: `1px solid ${BID_COLOR}55`,
                color: BID_COLOR,
                fontSize: "0.9em",
              }}
            >
              $
            </span>
            BID PRICE (oz)
          </div>
          {/* Price */}
          <div
            className="tabular-nums font-black"
            style={{
              color: "#ffffff",
              fontSize: "clamp(1.6rem, calc(2.4vh + 2.4vw), 4.8rem)",
              fontFamily: "monospace",
              lineHeight: 1,
              letterSpacing: "-0.03em",
              textShadow: "0 2px 20px #00000088",
            }}
          >
            {fmt(bid)}
          </div>
          {/* High */}
          <div
            className="flex items-center font-semibold tabular-nums"
            style={{
              color: BID_COLOR,
              fontSize: "clamp(0.7rem, calc(0.65vh + 0.7vw), 1.25rem)",
              marginTop: "clamp(0.3rem, 0.7vh, 0.65rem)",
              gap: "0.35em",
            }}
          >
            <span style={{ opacity: 0.75, fontSize: "0.85em" }}>▲</span>
            High &nbsp;{fmt(high)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Metals Table ──────────────────────────────────────────────────────────────
interface MetalRowData {
  icon: React.ReactNode;
  name: string;
  weight: string;
  price: number | null;
  direction: Direction;
}

function MetalRow({ icon, name, weight, price, direction }: MetalRowData) {
  useEffect(() => { ensureKeyframes(); }, []);
  const isUp   = direction === "up";
  const isDown = direction === "down";
  const isTick = isUp || isDown;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        alignItems: "center",
        gap: "clamp(0.5rem, 1.5vw, 1.75rem)",
        background: "linear-gradient(90deg, #161616 0%, #0e0e0e 100%)",
        border: `1px solid ${GOLD}44`,
        borderRadius: "clamp(0.5rem, 1vw, 1rem)",
        padding: "clamp(0.45rem, 1.1vh, 1rem) clamp(0.75rem, 2vw, 1.75rem)",
        animation: isTick
          ? `${isUp ? "tvRowUp" : "tvRowDown"} 1.8s ease-out forwards`
          : undefined,
        willChange: isTick ? "border-color, box-shadow" : undefined,
      }}
    >
      {/* ── METALS column ── */}
      <div
        className="flex items-center min-w-0"
        style={{ gap: "clamp(0.5rem, 1.3vw, 1.25rem)" }}
      >
        <div
          className="shrink-0 flex items-center justify-center rounded-full"
          style={{
            width: "clamp(2rem, calc(3vh + 1.2vw), 3.5rem)",
            height: "clamp(2rem, calc(3vh + 1.2vw), 3.5rem)",
            padding: "clamp(0.3rem, 0.7vh, 0.6rem)",
            background: "#1c1c1c",
            border: `1px solid ${GOLD}44`,
          }}
        >
          {icon}
        </div>
        <div
          className="font-black uppercase tracking-wider text-white truncate"
          style={{ fontSize: "clamp(0.9rem, calc(1vh + 0.9vw), 1.8rem)", letterSpacing: "0.04em" }}
        >
          {name}
        </div>
      </div>

      {/* ── WEIGHT column ── */}
      <div
        className="font-black uppercase tracking-widest shrink-0"
        style={{
          color: GOLD,
          fontSize: "clamp(0.8rem, calc(0.9vh + 0.8vw), 1.55rem)",
          letterSpacing: "0.2em",
          background: `${GOLD}14`,
          border: `1px solid ${GOLD}44`,
          borderRadius: "0.45rem",
          padding: "clamp(0.2rem, 0.5vh, 0.45rem) clamp(0.6rem, 1.5vw, 1.2rem)",
          whiteSpace: "nowrap",
        }}
      >
        {weight}
      </div>

      {/* ── PRICE column ── */}
      <div
        className="flex items-center justify-end shrink-0"
        style={{ gap: "0.35em" }}
      >
        {isTick && (
          <span
            style={{
              color: isUp ? GREEN_TICK : RED_TICK,
              fontSize: "clamp(1rem, calc(1.3vh + 1.1vw), 2.2rem)",
              fontWeight: 900,
              lineHeight: 1,
              animation: `${isUp ? "tvTickUp" : "tvTickDown"} 1.8s ease-out forwards`,
              willChange: "color",
              userSelect: "none",
            }}
          >
            {isUp ? "↑" : "↓"}
          </span>
        )}
        <div
          className="tabular-nums font-extrabold"
          style={{
            color: "#ffffff",
            fontSize: "clamp(1.1rem, calc(1.5vh + 1.4vw), 2.8rem)",
            fontFamily: "monospace",
            lineHeight: 1,
            letterSpacing: "-0.02em",
            whiteSpace: "nowrap",
            animation: isTick
              ? `${isUp ? "tvTickUp" : "tvTickDown"} 1.8s ease-out forwards`
              : undefined,
            willChange: isTick ? "color, text-shadow" : undefined,
          }}
        >
          {fmt(price)}{" "}
          <span
            style={{
              fontSize: "0.42em",
              fontFamily: "sans-serif",
              fontWeight: 700,
              color: GOLD,
              opacity: 0.85,
            }}
          >
            AED
          </span>
        </div>
      </div>
    </div>
  );
}

function MetalsTable({
  rows,
}: {
  rows: MetalRowData[];
}) {
  return (
    <div
      className="flex flex-col w-full"
      style={{ gap: 0 }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: "clamp(0.5rem, 1.5vw, 1.75rem)",
          background: `linear-gradient(90deg, ${HEADER_BG} 0%, #2e1a06 100%)`,
          border: `1px solid ${HEADER_BORDER}`,
          borderRadius: "clamp(0.5rem, 1vw, 1rem) clamp(0.5rem, 1vw, 1rem) 0 0",
          padding: "clamp(0.35rem, 0.9vh, 0.8rem) clamp(0.75rem, 2vw, 1.75rem)",
        }}
      >
        <div
          className="font-black uppercase tracking-widest"
          style={{
            color: GOLD,
            fontSize: "clamp(0.65rem, calc(0.6vh + 0.65vw), 1.15rem)",
            letterSpacing: "0.2em",
          }}
        >
          METALS
        </div>
        <div
          className="font-black uppercase tracking-widest text-right"
          style={{
            color: GOLD,
            fontSize: "clamp(0.65rem, calc(0.6vh + 0.65vw), 1.15rem)",
            letterSpacing: "0.2em",
            whiteSpace: "nowrap",
          }}
        >
          WEIGHT
        </div>
        <div
          className="font-black uppercase tracking-widest text-right"
          style={{
            color: GOLD,
            fontSize: "clamp(0.65rem, calc(0.6vh + 0.65vw), 1.15rem)",
            letterSpacing: "0.2em",
            whiteSpace: "nowrap",
          }}
        >
          PRICE (AED)
        </div>
      </div>

      {/* ── Rows ── */}
      <div
        className="flex flex-col"
        style={{ gap: "clamp(0.2rem, 0.5vh, 0.45rem)", paddingTop: "clamp(0.2rem, 0.5vh, 0.45rem)" }}
      >
        {rows.map((row, i) => (
          <MetalRow key={i} {...row} />
        ))}
      </div>
    </div>
  );
}

// ── ShowroomBoard ─────────────────────────────────────────────────────────────
export default function ShowroomBoard() {
  const now = useTicker();
  const { liveRates } = useLivePrice();
  const { data: publicSettings } = useGetPublicSettings({
    query: {
      queryKey: getGetPublicSettingsQueryKey(),
      refetchInterval: 60_000,
      refetchIntervalInBackground: true,
    },
  });
  const { data: publicPrices } = useGetPublicPrices({
    query: {
      queryKey: getGetPublicPricesQueryKey(),
      refetchInterval: 5_000,
      refetchIntervalInBackground: true,
    },
  });
  const showroomLogoUrl = publicSettings?.showroomLogoUrl ?? null;

  // Stable 5-value array for direction tracking — order matches rows below
  const priceValues: (number | null)[] = [
    liveRates.ttBar9999Total,
    liveRates.gold22kRate,
    liveRates.gold9999Rate,
    liveRates.goldKg9999Total,
    liveRates.kgBar995Total,
  ];
  const dirs = useDirections(priceValues);

  const rows: MetalRowData[] = [
    {
      icon: <IconGoldBar />,
      name: "TEN TOLA BAR",
      weight: "TTB",
      price: liveRates.ttBar9999Total,
      direction: dirs[0],
      visible: publicPrices?.tvShowTtBar999 ?? true,
    },
    {
      icon: <IconNecklace />,
      name: "JEWELLERY 22K",
      weight: "1GM",
      price: liveRates.gold22kRate,
      direction: dirs[1],
      visible: publicPrices?.tvShowGold22k ?? true,
    },
    {
      icon: <IconGoldBricks />,
      name: "GOLD 9999",
      weight: "1GM",
      price: liveRates.gold9999Rate,
      direction: dirs[2],
      visible: publicPrices?.tvShowGold9999 ?? true,
    },
    {
      icon: <IconGoldBricks />,
      name: "GOLD 9999",
      weight: "1KG",
      price: liveRates.goldKg9999Total,
      direction: dirs[3],
      visible: publicPrices?.tvShowGoldKg9999 ?? true,
    },
    {
      icon: <IconGoldBar />,
      name: "KILO BAR 995",
      weight: "1KG",
      price: liveRates.kgBar995Total,
      direction: dirs[4],
      visible: publicPrices?.tvShowKgBar995 ?? true,
    },
  ].filter(r => (r as any).visible) as MetalRowData[];

  return (
    <div
      className="w-full min-h-screen lg:h-screen lg:overflow-hidden flex flex-col"
      style={{
        background: `
          linear-gradient(160deg, #0b0b0b 0%, #111111 100%),
          repeating-linear-gradient(0deg,  ${GOLD}09 0px, ${GOLD}09 1px, transparent 1px, transparent 72px),
          repeating-linear-gradient(90deg, ${GOLD}09 0px, ${GOLD}09 1px, transparent 1px, transparent 72px)
        `,
        padding: "clamp(0.4rem, 1vh, 1.2rem) clamp(0.6rem, 2vw, 2.5rem)",
      }}
    >
      <div
        className="w-full mx-auto flex flex-col lg:h-full lg:min-h-0"
        style={{ maxWidth: 1500, flex: 1 }}
      >

        {/* ── Header: logo + date/clock ── */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{
            gap: "clamp(0.5rem, 1.5vw, 1.5rem)",
            paddingBottom: "clamp(0.35rem, 0.9vh, 0.8rem)",
          }}
        >
          {/* Logo or shop name */}
          {showroomLogoUrl ? (
            <img
              src={showroomLogoUrl}
              alt="Showroom logo"
              style={{
                height: "clamp(2.5rem, 7vh, 64px)",
                maxWidth: "min(50vw, 220px)",
                objectFit: "contain",
                filter: `drop-shadow(0 0 22px ${GOLD}66)`,
              }}
            />
          ) : (
            <div
              className="font-black uppercase"
              style={{
                color: GOLD,
                fontSize: "clamp(1rem, calc(1.2vh + 1.2vw), 2.2rem)",
                letterSpacing: "0.14em",
                textShadow: `0 0 30px ${GOLD}55`,
                fontFamily: "serif",
                whiteSpace: "nowrap",
              }}
            >
              Hazari Gold
            </div>
          )}

          {/* Date + clock pill */}
          <div
            className="flex items-center rounded-full"
            style={{
              border: `1px solid ${GOLD}55`,
              background: "#141414",
              padding: "clamp(0.25rem, 0.6vh, 0.55rem) clamp(0.9rem, 2vw, 2rem)",
              gap: "clamp(0.6rem, 1.5vw, 2rem)",
            }}
          >
            <span
              className="text-neutral-300 font-semibold"
              style={{ fontSize: "clamp(0.6rem, calc(0.55vh + 0.5vw), 1rem)" }}
            >
              {formatDate(now)}
            </span>
            <span
              className="font-bold tabular-nums"
              style={{
                color: GOLD,
                fontSize: "clamp(0.7rem, calc(0.65vh + 0.6vw), 1.2rem)",
                fontFamily: "monospace",
              }}
            >
              {formatClock(now)}
            </span>
          </div>
        </div>

        {/* ── Gold Spot Panel ── */}
        <div className="shrink-0">
          <GoldSpotPanel
            ask={liveRates.askUsdPerOz}
            bid={liveRates.bidUsdPerOz}
            low={liveRates.dailyLowUsdPerOz}
            high={liveRates.dailyHighUsdPerOz}
          />
        </div>

        {/* ── Metals Table ── */}
        <div
          className="lg:flex-1 lg:min-h-0 flex flex-col justify-start"
          style={{ marginTop: "clamp(0.4rem, 1vh, 1rem)" }}
        >
          <MetalsTable rows={rows} />
        </div>

        {/* ── Live status footer ── */}
        <div
          className="text-center shrink-0"
          style={{
            color: liveRates.isLive ? "#555" : "#774",
            fontSize: "clamp(0.5rem, calc(0.4vh + 0.35vw), 0.8rem)",
            paddingTop: "clamp(0.2rem, 0.5vh, 0.5rem)",
            letterSpacing: "0.05em",
          }}
        >
          {liveRates.isLive
            ? `((●)) Live · Real-time Free Market Feed${liveRates.updatedAt ? " · " + new Date(liveRates.updatedAt).toLocaleTimeString("en-AE") : ""}`
            : "Connecting to live feed…"}
        </div>
      </div>
    </div>
  );
}
