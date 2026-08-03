import React, { useEffect, useState, useCallback, useRef } from "react";
import { io, type Socket } from "socket.io-client";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TvItem {
  id:          number;
  name:        string;
  weightLabel: string;
  price:       number | null;
  source?:     string;
}

interface TvData {
  bidUsd:         number | null;
  askUsd:         number | null;
  midUsd:         number | null;
  dailyHigh:      number | null;
  dailyLow:       number | null;
  baseAedPerGram: number | null;
  updatedAt:      string | null;
  source:         string | null;
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
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Gold-bar SVG icon ──────────────────────────────────────────────────────────
function GoldBarIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 48 30" fill="none">
      <rect x="2" y="6" width="44" height="18" rx="3" fill="#c8a43a" />
      <rect x="2" y="6" width="44" height="6"  rx="2" fill="#e0b84a" />
      <rect x="6" y="10" width="36" height="10" rx="2" fill="#b8941a" opacity="0.4" />
      <text x="24" y="20" textAnchor="middle" fill="#fff8e0" fontSize="8" fontWeight="bold" fontFamily="monospace">GOLD</text>
    </svg>
  );
}

function JewelIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="20" fill="#c8a43a" opacity="0.2" stroke="#c8a43a" strokeWidth="2" />
      <circle cx="24" cy="24" r="12" fill="#c8a43a" opacity="0.5" />
      <circle cx="24" cy="24" r="6"  fill="#e0b84a" />
    </svg>
  );
}

function itemIcon(name: string, size = 36) {
  const lower = name.toLowerCase();
  if (lower.includes("jewel") || lower.includes("22k") || lower.includes("21k") || lower.includes("18k"))
    return <JewelIcon size={size} />;
  return <GoldBarIcon size={size} />;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TvDisplay() {
  const [data,    setData]    = useState<TvData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now,     setNow]     = useState(new Date());
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchTvData();
      setData(d);
    } catch {
      // keep stale data
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + Socket.IO real-time push (PRICE_MUTATION → immediate refetch)
  useEffect(() => {
    load();

    // Connect to Socket.IO for instant updates — no polling needed
    const sock = io({ path: "/api/socket.io", transports: ["websocket", "polling"] });
    socketRef.current = sock;
    sock.on("PRICE_MUTATION", () => { load(); });

    // Fallback poll every 10s in case WS drops
    const fallback = setInterval(load, 10_000);

    return () => {
      sock.disconnect();
      clearInterval(fallback);
    };
  }, [load]);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Diamond background pattern ──────────────────────────────────────────────
  const bg: React.CSSProperties = {
    minHeight: "100vh",
    background: "#1a1a1a",
    backgroundImage: `repeating-linear-gradient(
      45deg,
      transparent,
      transparent 18px,
      rgba(200,164,58,0.04) 18px,
      rgba(200,164,58,0.04) 19px
    ), repeating-linear-gradient(
      -45deg,
      transparent,
      transparent 18px,
      rgba(200,164,58,0.04) 18px,
      rgba(200,164,58,0.04) 19px
    )`,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: "#f0f0f0",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  };

  const sourceLabel = data?.source === "hazarigold.com"
    ? "Live · hazarigold.com"
    : data?.source === "UniRateAPI"
      ? "Live · XAU/USD via UniRateAPI"
      : "Waiting for live data…";

  return (
    <div style={bg}>
      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 rounded-xl"
        style={{ background: "rgba(30,30,30,0.95)", border: "1px solid rgba(200,164,58,0.3)" }}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">📅</span>
          <span className="text-white font-semibold text-lg">{fmtDate(now)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl">🕐</span>
          <span className="text-white font-bold text-xl font-mono">{fmtTime(now)}</span>
        </div>
      </div>

      {/* ── BID / ASK cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "BID oz", value: data?.bidUsd ?? null },
          { label: "ASK oz", value: data?.askUsd ?? null },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl p-4 flex flex-col items-center gap-1"
            style={{ background: "rgba(40,40,40,0.9)", border: "1px solid rgba(200,164,58,0.4)" }}>
            <span className="text-gray-400 text-sm font-semibold tracking-widest uppercase">{label}</span>
            <span className="font-bold leading-none"
              style={{ fontSize: "clamp(1.6rem,4vw,3.2rem)", color: "#f0c040" }}>
              {loading ? "—" : fmtNum(value)}
            </span>
          </div>
        ))}
      </div>

      {/* ── Low / High ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl p-3 flex items-center justify-between"
          style={{ background: "rgba(40,40,40,0.9)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2">
            <span className="text-2xl text-red-400">↓</span>
            <span className="font-semibold text-red-400 text-base">Low</span>
          </div>
          <span className="font-bold text-gray-100 text-xl font-mono">
            {loading ? "—" : fmtNum(data?.dailyLow ?? null)}
          </span>
        </div>
        <div className="rounded-xl p-3 flex items-center justify-between"
          style={{ background: "rgba(40,40,40,0.9)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2">
            <span className="text-2xl text-green-400">↑</span>
            <span className="font-semibold text-green-400 text-base">High</span>
          </div>
          <span className="font-bold text-gray-100 text-xl font-mono">
            {loading ? "—" : fmtNum(data?.dailyHigh ?? null)}
          </span>
        </div>
      </div>

      {/* ── Items table ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 flex-1">
        {loading && (
          <div className="text-center text-gray-400 py-8">Loading prices…</div>
        )}
        {!loading && (!data?.items || data.items.length === 0) && (
          <div className="text-center text-gray-500 py-8">No items configured for TV display</div>
        )}
        {!loading && data?.items?.map((item) => (
          <div key={item.id}
            className="rounded-xl px-4 py-3 flex items-center justify-between"
            style={{ background: "rgba(35,35,35,0.95)", border: "1px solid rgba(200,164,58,0.15)" }}>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0">{itemIcon(item.name)}</div>
              <span className="font-bold tracking-wide text-white text-base uppercase">
                {item.name}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-gray-400 text-sm font-mono">{item.weightLabel}</span>
              <span className="font-bold font-mono text-xl" style={{ color: "#f0c040" }}>
                {item.price != null ? fmtNum(item.price) : "—"}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-2 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full"
            style={{ background: data?.error ? "#ef4444" : "#22c55e", boxShadow: data?.error ? "" : "0 0 6px #22c55e" }} />
          <span>{sourceLabel}</span>
        </div>
        {data?.updatedAt && (
          <span>Updated {new Date(data.updatedAt).toLocaleTimeString()}</span>
        )}
      </div>

      {data?.error && (
        <div className="text-center text-red-400 text-xs px-4 py-2 rounded-lg"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
          ⚠ {data.error}
        </div>
      )}
    </div>
  );
}
