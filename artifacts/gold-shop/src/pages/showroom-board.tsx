import React, { useEffect, useState } from "react";
import {
  useGetPublicPrices,
  getGetPublicPricesQueryKey,
  useGetPublicSettings,
  getGetPublicSettingsQueryKey,
} from "@workspace/api-client-react";

const GOLD = "#d4af37";
const TOLA_BAR_GRAMS = 116.638;

function roundTo(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

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
  return n != null && Number.isFinite(n) ? n.toFixed(2) : "—";
}

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

interface MetricTileProps {
  label: string;
  value: string;
  arrow?: "up" | "down";
}

function MetricTile({ label, value, arrow }: MetricTileProps) {
  const arrowColor = arrow === "down" ? "#ef4444" : "#22c55e";
  return (
    <div
      className="relative rounded-2xl flex flex-col items-center justify-center text-center overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #171717 0%, #0a0a0a 100%)",
        border: "2px solid #D4AF37",
        boxShadow: `0 0 0 1px ${GOLD}22 inset, 0 10px 30px -12px ${GOLD}40`,
        padding: "clamp(0.75rem, 2.2vh, 1.75rem) clamp(0.75rem, 2vw, 2rem)",
        gap: "clamp(0.25rem, 0.9vh, 0.75rem)",
        height: "100%",
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ background: `linear-gradient(180deg, ${GOLD}14 0%, transparent 40%)` }}
      />
      <div
        className="relative uppercase tracking-widest font-bold text-neutral-300"
        style={{ fontSize: "clamp(0.7rem, calc(0.7vh + 0.55vw), 1.15rem)", letterSpacing: "0.12em", whiteSpace: "nowrap" }}
      >
        {label}
      </div>
      <div className="relative flex items-center justify-center gap-3">
        {arrow && (
          <span
            style={{ color: arrowColor, fontSize: "clamp(1.2rem, calc(1.6vh + 1.2vw), 3rem)", fontWeight: 900, lineHeight: 1 }}
          >
            {arrow === "down" ? "↓" : "↑"}
          </span>
        )}
        <span
          className="font-extrabold tabular-nums text-white"
          style={{
            fontSize: "clamp(1.6rem, calc(2.4vh + 2vw), 4.5rem)",
            lineHeight: 1,
            fontFamily: "monospace",
            letterSpacing: "-0.02em",
            whiteSpace: "nowrap",
            textShadow: `0 0 30px ${GOLD}33`,
          }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

interface AssetRowProps {
  title: string;
  tag: string;
  value: string;
  icon: React.ReactNode;
}

function AssetRow({ title, tag, value, icon }: AssetRowProps) {
  return (
    <div
      className="relative rounded-2xl flex items-center justify-between"
      style={{
        background: "linear-gradient(90deg, #131313 0%, #0a0a0a 100%)",
        border: `1px solid ${GOLD}55`,
        padding: "clamp(0.5rem, 1.6vh, 1.5rem) clamp(0.75rem, 2.2vw, 2rem)",
        height: "100%",
        minHeight: 0,
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
      <div
        className="font-extrabold tabular-nums shrink-0"
        style={{
          color: GOLD,
          fontSize: "clamp(1.15rem, calc(1.8vh + 1.6vw), 3rem)",
          lineHeight: 1,
          fontFamily: "monospace",
          letterSpacing: "-0.02em",
          textShadow: `0 0 24px ${GOLD}33`,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function ShowroomBoard() {
  const now = useTicker();
  const { data: prices } = useGetPublicPrices({
    query: { queryKey: getGetPublicPricesQueryKey(), refetchInterval: 5000, refetchIntervalInBackground: true },
  });
  const { data: publicSettings } = useGetPublicSettings({
    query: { queryKey: getGetPublicSettingsQueryKey(), refetchInterval: 60000, refetchIntervalInBackground: true },
  });
  const showroomLogoUrl = publicSettings?.showroomLogoUrl || null;

  // Every asset value here is derived directly from the persisted per-gram
  // rates returned by /prices/public — the same source of truth the Price
  // List page reads/edits — so the TV board always matches it exactly,
  // whether Live Mode is connected (auto-synced every 5s) or a rate was
  // manually edited while disconnected.
  const ttBarTotal = prices?.ttBarRate != null ? roundTo(prices.ttBarRate * TOLA_BAR_GRAMS, 2) : null;
  const jewellery22kPerGram = prices?.gold22kRate ?? null;
  const gold9999PerGram = prices?.gold9999Rate ?? null;
  const gold9999PerKg = prices?.gold9999Rate != null ? roundTo(prices.gold9999Rate * 1000, 2) : null;
  const kiloBar995Total = prices?.kgBarRate != null ? roundTo(prices.kgBarRate * 1000, 2) : null;

  const rows = [
    { title: "Ten Tola Bar", tag: "TTB", value: fmt(ttBarTotal), icon: <GoldBarIcon /> },
    { title: "Jewellery 22K", tag: "1GM", value: fmt(jewellery22kPerGram), icon: <GoldRingIcon /> },
    { title: "Gold 9999", tag: "1GM", value: fmt(gold9999PerGram), icon: <GoldIngotIcon /> },
    { title: "Gold 9999", tag: "1KG", value: fmt(gold9999PerKg), icon: <GoldIngotIcon /> },
    { title: "Kilo Bar 995", tag: "1KG", value: fmt(kiloBar995Total), icon: <GoldBarIcon /> },
  ];

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
        padding: "clamp(0.75rem, 2vh, 2rem) clamp(0.75rem, 2.5vw, 3rem)",
      }}
    >
      <div
        className="w-full flex flex-col mx-auto lg:h-full"
        style={{ maxWidth: 1400 }}
      >
        <div
          className="flex flex-col items-center shrink-0"
          style={{ gap: "clamp(0.4rem, 1.2vh, 1.25rem)", paddingBottom: "clamp(0.5rem, 1.6vh, 1.5rem)" }}
        >
          {showroomLogoUrl ? (
            <div
              className="flex items-center justify-center"
              style={{
                height: "clamp(3rem, 9vh, 6.5rem)",
                filter: `drop-shadow(0 0 24px ${GOLD}55)`,
              }}
            >
              <img
                src={showroomLogoUrl}
                alt="Showroom logo"
                className="max-h-full max-w-full object-contain"
                style={{ maxWidth: "min(90vw, 640px)" }}
              />
            </div>
          ) : (
            <div
              className="font-black uppercase flex items-center justify-center"
              style={{
                color: GOLD,
                fontSize: "clamp(1.15rem, calc(1.6vh + 1.6vw), 2.75rem)",
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
              padding: "clamp(0.4rem, 1vh, 0.75rem) clamp(1rem, 2.5vw, 2.5rem)",
              gap: "clamp(0.75rem, 2vw, 2.5rem)",
            }}
          >
            <span
              className="text-neutral-300 font-semibold truncate"
              style={{ fontSize: "clamp(0.7rem, calc(0.65vh + 0.6vw), 1.2rem)" }}
            >
              {formatDate(now)}
            </span>
            <span
              className="font-bold tabular-nums shrink-0"
              style={{ color: GOLD, fontSize: "clamp(0.8rem, calc(0.75vh + 0.7vw), 1.4rem)", fontFamily: "monospace" }}
            >
              {formatClock(now)}
            </span>
          </div>
        </div>

        <div
          className="relative rounded-3xl shrink-0"
          style={{
            border: "2px solid #D4AF37",
            background: `linear-gradient(160deg, ${GOLD}12 0%, transparent 60%), #0a0a0a`,
            boxShadow: `0 0 0 1px ${GOLD}1a inset, 0 20px 50px -20px ${GOLD}40`,
            padding: "clamp(0.6rem, 1.6vh, 1.25rem)",
            marginBottom: "clamp(0.5rem, 1.6vh, 1.5rem)",
          }}
        >
          <div
            className="grid grid-cols-2"
            style={{ gap: "clamp(0.5rem, 1.4vh, 1.25rem)" }}
          >
            <MetricTile label="BID oz" value={fmt(prices?.liveGoldBid)} />
            <MetricTile label="ASK oz" value={fmt(prices?.liveGoldAsk)} />
            <MetricTile label="Low" value={fmt(prices?.liveGoldLow)} arrow="down" />
            <MetricTile label="High" value={fmt(prices?.liveGoldHigh)} arrow="up" />
          </div>
        </div>

        <div
          className="flex flex-col w-full lg:flex-1 lg:min-h-0"
          style={{ gap: "clamp(0.4rem, 1.1vh, 1rem)" }}
        >
          {rows.map((row, i) => (
            <div key={`${row.title}-${row.tag}-${i}`} className="lg:flex-1 lg:min-h-0" style={{ minHeight: "clamp(3.5rem, 9vh, 6rem)" }}>
              <AssetRow {...row} />
            </div>
          ))}
        </div>

        <div
          className="text-neutral-500 text-center tracking-wide shrink-0"
          style={{ fontSize: "clamp(0.6rem, calc(0.5vh + 0.4vw), 0.85rem)", paddingTop: "clamp(0.4rem, 1vh, 1rem)" }}
        >
          {prices?.liveModeConnected ? "Live rates — updating automatically" : "Manual rates"}
          {prices?.updatedAt && ` · Last updated ${new Date(prices.updatedAt).toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" })}`}
        </div>
      </div>
    </div>
  );
}
