import React, { useEffect, useState } from "react";
import { useGetPublicPrices, getGetPublicPricesQueryKey } from "@workspace/api-client-react";

const GOLD = "#d4af37";
const GOLD_SOFT = "#c9a94a";
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
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
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
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
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
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
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
      className="relative rounded-xl flex flex-col justify-center gap-2"
      style={{
        background: "linear-gradient(160deg, #151515 0%, #0a0a0a 100%)",
        border: `1px solid ${GOLD}3d`,
        padding: "1.25rem 1.5rem",
        minHeight: 120,
      }}
    >
      <div className="uppercase tracking-widest font-semibold text-neutral-400" style={{ fontSize: "0.95rem", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div className="flex items-center gap-3">
        {arrow && (
          <span style={{ color: arrowColor, fontSize: "1.75rem", fontWeight: 900, lineHeight: 1 }}>
            {arrow === "down" ? "↓" : "↑"}
          </span>
        )}
        <span
          className="font-extrabold tabular-nums text-white"
          style={{ fontSize: "2.25rem", lineHeight: 1, fontFamily: "monospace", letterSpacing: "-0.02em" }}
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
        padding: "1.5rem 2rem",
      }}
    >
      <div className="flex items-center gap-5">
        <div
          className="rounded-full flex items-center justify-center shrink-0"
          style={{ width: 56, height: 56, background: "#1a1a1a", border: `1px solid ${GOLD}55` }}
        >
          {icon}
        </div>
        <div>
          <div className="font-bold uppercase text-white" style={{ fontSize: "1.4rem", letterSpacing: "0.03em" }}>
            {title}
          </div>
          <div className="uppercase font-semibold" style={{ color: GOLD, fontSize: "0.95rem", letterSpacing: "0.1em" }}>
            {tag}
          </div>
        </div>
      </div>
      <div
        className="font-extrabold tabular-nums"
        style={{ color: GOLD, fontSize: "3rem", lineHeight: 1, fontFamily: "monospace", letterSpacing: "-0.02em", textShadow: `0 0 24px ${GOLD}33` }}
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
      className="min-h-screen w-full flex flex-col items-center"
      style={{
        background: `
          linear-gradient(160deg, #0b0b0b 0%, #121212 100%),
          repeating-linear-gradient(0deg, ${GOLD}0d 0px, ${GOLD}0d 1px, transparent 1px, transparent 64px),
          repeating-linear-gradient(90deg, ${GOLD}0d 0px, ${GOLD}0d 1px, transparent 1px, transparent 64px)
        `,
        backgroundBlendMode: "normal, normal, normal",
        padding: "3rem 4rem",
      }}
    >
      <div className="flex flex-col items-center gap-5 mb-8">
        <div
          className="font-black uppercase flex items-center gap-3"
          style={{
            color: GOLD,
            fontSize: "2.75rem",
            letterSpacing: "0.16em",
            textShadow: `0 0 30px ${GOLD}55`,
            fontFamily: "serif",
          }}
        >
          Hazari Gold <span style={{ color: "#f5f5f5", fontSize: "1.75rem" }}>✦</span>
        </div>
        <div
          className="flex items-center justify-between gap-10 rounded-full px-10 py-3"
          style={{ border: `1px solid ${GOLD}66`, background: "#111111", minWidth: 520 }}
        >
          <span className="text-neutral-300 font-semibold" style={{ fontSize: "1.2rem" }}>
            {formatDate(now)}
          </span>
          <span
            className="font-bold tabular-nums"
            style={{ color: GOLD, fontSize: "1.4rem", fontFamily: "monospace" }}
          >
            {formatClock(now)}
          </span>
        </div>
      </div>

      <div className="grid gap-4 w-full mb-8" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", maxWidth: 1400 }}>
        <MetricTile label="BID oz" value={fmt(prices?.liveGoldBid)} />
        <MetricTile label="ASK oz" value={fmt(prices?.liveGoldAsk)} />
        <MetricTile label="Low" value={fmt(prices?.liveGoldLow)} arrow="down" />
        <MetricTile label="High" value={fmt(prices?.liveGoldHigh)} arrow="up" />
      </div>

      <div className="flex flex-col gap-4 w-full" style={{ maxWidth: 1400 }}>
        {rows.map((row, i) => (
          <AssetRow key={`${row.title}-${row.tag}-${i}`} {...row} />
        ))}
      </div>

      <div className="mt-8 text-neutral-500 text-sm tracking-wide">
        {prices?.liveModeConnected ? "Live rates — updating automatically" : "Manual rates"}
        {prices?.updatedAt && ` · Last updated ${new Date(prices.updatedAt).toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" })}`}
      </div>
    </div>
  );
}
