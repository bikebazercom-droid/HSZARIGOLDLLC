import React, { useEffect, useState, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TvItem {
  id:          number;
  name:        string;
  weightLabel: string;
  price:       number | null;
  formulaType: string;
}

interface TvData {
  bidUsd:         number | null;
  askUsd:         number | null;
  dailyHigh:      number | null;
  dailyLow:       number | null;
  baseAedPerGram: number | null;
  updatedAt:      string | null;
  error:          string | null;
  items:          TvItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchTvData(): Promise<TvData> {
  const res = await fetch(`${BASE}/api/tv/prices`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<TvData>;
}

function fmtNum(n: number | null, decimals = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour:   "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

// ── Gold bar SVG icons ────────────────────────────────────────────────────────
function GoldBarIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 60 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="8" width="56" height="20" rx="3" fill="url(#barGrad)" />
      <rect x="8" y="4" width="44" height="28" rx="3" fill="url(#barGradMain)" />
      <rect x="10" y="6" width="40" height="24" rx="2" fill="none" stroke="#b8860b" strokeWidth="0.5" opacity="0.6" />
      <text x="30" y="20" textAnchor="middle" dominantBaseline="middle" fontSize="7" fill="#8B6914" fontWeight="bold" fontFamily="sans-serif">GOLD</text>
      <text x="30" y="27" textAnchor="middle" dominantBaseline="middle" fontSize="5" fill="#8B6914" fontFamily="sans-serif">999.9</text>
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4a017" />
          <stop offset="100%" stopColor="#8B6914" />
        </linearGradient>
        <linearGradient id="barGradMain" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0c040" />
          <stop offset="30%" stopColor="#c8a020" />
          <stop offset="60%" stopColor="#e0b030" />
          <stop offset="100%" stopColor="#a07010" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function JewelleryIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="12" fill="none" stroke="url(#ringGrad)" strokeWidth="4" />
      <circle cx="20" cy="20" r="12" fill="none" stroke="#f0c040" strokeWidth="1.5" opacity="0.4" />
      <ellipse cx="20" cy="8" rx="4" ry="2.5" fill="url(#stoneGrad)" />
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f0c040" />
          <stop offset="50%" stopColor="#c8a020" />
          <stop offset="100%" stopColor="#e8b830" />
        </linearGradient>
        <linearGradient id="stoneGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a0d8f0" />
          <stop offset="100%" stopColor="#6090c0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Diamond background pattern ────────────────────────────────────────────────
const DiamondBg = () => (
  <svg
    className="absolute inset-0 w-full h-full"
    xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="xMidYMid slice"
  >
    <defs>
      <pattern id="diamond" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
        <polygon points="20,2 38,20 20,38 2,20" fill="none" stroke="#ffffff07" strokeWidth="1" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#diamond)" />
  </svg>
);

// ── Main component ────────────────────────────────────────────────────────────
export default function TvDisplay() {
  const [data,    setData]    = useState<TvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now,     setNow]     = useState(new Date());

  // Clock — update every second
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(t);
  }, []);

  // Fetch prices
  const load = useCallback(async () => {
    try {
      const d = await fetchTvData();
      setData(d);
    } catch {
      // keep stale data on failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 90_000);
    return () => clearInterval(t);
  }, [load]);

  const hasLive = data?.bidUsd != null;

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden flex flex-col"
      style={{ background: "#1a1a1a", fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* Background diamond pattern */}
      <DiamondBg />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-screen p-4 gap-3">

        {/* ── Top bar: date + time ──────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 py-2.5 rounded-xl"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex items-center gap-2 text-gray-200">
            <span className="text-lg">📅</span>
            <span className="font-semibold text-base tracking-wide">{fmtDate(now)}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-200">
            <span className="text-lg">🕐</span>
            <span className="font-semibold text-base tracking-wide font-mono">{fmtTime(now)}</span>
          </div>
        </div>

        {/* ── BID / ASK cards ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          {/* BID */}
          <div
            className="rounded-xl p-4 flex flex-col items-center justify-center gap-1"
            style={{ background: "rgba(40,40,40,0.9)", border: "1px solid rgba(200,164,58,0.4)" }}
          >
            <span className="text-gray-400 text-sm font-semibold tracking-widest uppercase">BID oz</span>
            <span
              className="font-bold leading-none"
              style={{ fontSize: "clamp(1.6rem, 4vw, 3.2rem)", color: "#f0c040" }}
            >
              {loading ? "—" : fmtNum(data?.bidUsd ?? null)}
            </span>
          </div>
          {/* ASK */}
          <div
            className="rounded-xl p-4 flex flex-col items-center justify-center gap-1"
            style={{ background: "rgba(40,40,40,0.9)", border: "1px solid rgba(200,164,58,0.4)" }}
          >
            <span className="text-gray-400 text-sm font-semibold tracking-widest uppercase">ASK oz</span>
            <span
              className="font-bold leading-none"
              style={{ fontSize: "clamp(1.6rem, 4vw, 3.2rem)", color: "#f0c040" }}
            >
              {loading ? "—" : fmtNum(data?.askUsd ?? null)}
            </span>
          </div>
        </div>

        {/* ── Low / High cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          {/* Low */}
          <div
            className="rounded-xl p-3 flex items-center justify-between"
            style={{ background: "rgba(40,40,40,0.9)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">↓</span>
              <span className="font-semibold text-red-400 text-base">Low</span>
            </div>
            <span className="font-bold text-gray-100 text-xl font-mono">
              {loading ? "—" : fmtNum(data?.dailyLow ?? null)}
            </span>
          </div>
          {/* High */}
          <div
            className="rounded-xl p-3 flex items-center justify-between"
            style={{ background: "rgba(40,40,40,0.9)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">↑</span>
              <span className="font-semibold text-green-400 text-base">High</span>
            </div>
            <span className="font-bold text-gray-100 text-xl font-mono">
              {loading ? "—" : fmtNum(data?.dailyHigh ?? null)}
            </span>
          </div>
        </div>

        {/* ── Item rows ────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 flex-1 overflow-auto">
          {loading && (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-lg">
              Loading…
            </div>
          )}
          {!loading && (data?.items ?? []).length === 0 && (
            <div className="flex-1 flex items-center justify-center text-gray-500 text-base">
              No items configured — enable TV visibility in the admin Price Items page.
            </div>
          )}
          {!loading && (data?.items ?? []).map((item) => {
            const isJewellery = item.name.toUpperCase().includes("JEWELLERY");
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{
                  background: "rgba(35,35,35,0.92)",
                  border: "1px solid rgba(200,164,58,0.15)",
                }}
              >
                {/* Icon */}
                <div className="flex-shrink-0 w-10 flex items-center justify-center">
                  {isJewellery
                    ? <JewelleryIcon size={36} />
                    : <GoldBarIcon   size={40} />
                  }
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <span
                    className="font-bold tracking-wide uppercase"
                    style={{ fontSize: "clamp(0.85rem, 2vw, 1.1rem)", color: "#e8e8e8" }}
                  >
                    {item.name}
                  </span>
                </div>

                {/* Weight label */}
                <div
                  className="flex-shrink-0 text-center font-semibold"
                  style={{ fontSize: "clamp(0.8rem, 1.8vw, 1rem)", color: "#9ca3af", minWidth: "3rem" }}
                >
                  {item.weightLabel}
                </div>

                {/* Price */}
                <div
                  className="flex-shrink-0 text-right font-bold font-mono"
                  style={{ fontSize: "clamp(1rem, 2.5vw, 1.4rem)", color: "#f0c040", minWidth: "7rem" }}
                >
                  {item.price != null ? fmtNum(item.price, 2) : (hasLive ? "—" : "No data")}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer: update info ───────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: hasLive ? "#22c55e" : "#6b7280", boxShadow: hasLive ? "0 0 6px #22c55e" : "none" }}
            />
            <span className="text-xs text-gray-500">
              {hasLive ? "Live  ·  XAU/USD via UniRateAPI" : "Waiting for live data…"}
            </span>
          </div>
          {data?.updatedAt && (
            <span className="text-xs text-gray-600">
              Updated {new Date(data.updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {data?.error && (
        <div
          className="absolute bottom-12 left-4 right-4 z-20 px-4 py-2 rounded-lg text-xs text-center"
          style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5" }}
        >
          ⚠ {data.error}
        </div>
      )}
    </div>
  );
}
