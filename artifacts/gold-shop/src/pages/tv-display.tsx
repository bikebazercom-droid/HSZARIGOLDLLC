import React, { useEffect, useState, useCallback, useRef } from "react";
import { io, type Socket } from "socket.io-client";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TvItem {
  id:          number;
  name:        string;
  weightLabel: string;
  price:       number | null;
  formulaType?: string;
}
interface TvData {
  bidUsd:         number | null;
  askUsd:         number | null;
  dailyHigh:      number | null;
  dailyLow:       number | null;
  baseAedPerGram: number | null;
  updatedAt:      string | null;
  source:         string | null;
  error:          string | null;
  items:          TvItem[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchTvData(): Promise<TvData> {
  const res = await fetch(`${BASE}/api/tv/prices`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<TvData>;
}

// Format price — no thousands separator for values shown in reference screenshot
function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "2-digit" });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
}

// ── Hazari Gold ornate logo SVG ───────────────────────────────────────────────
function HazariGoldLogo() {
  return (
    <svg viewBox="0 0 220 110" width="160" height="80" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#f0d060" />
          <stop offset="40%"  stopColor="#c8a43a" />
          <stop offset="70%"  stopColor="#e8c050" />
          <stop offset="100%" stopColor="#a07820" />
        </linearGradient>
        <linearGradient id="goldGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#f0d878" />
          <stop offset="50%"  stopColor="#c8a43a" />
          <stop offset="100%" stopColor="#8a6010" />
        </linearGradient>
      </defs>

      {/* Outer ornate circle */}
      <circle cx="62" cy="44" r="38" fill="none" stroke="url(#goldGrad)" strokeWidth="1.5" />
      <circle cx="62" cy="44" r="34" fill="none" stroke="url(#goldGrad)" strokeWidth="0.5" opacity="0.6"/>

      {/* Top ornament */}
      <path d="M62 6 L65 11 L62 9 L59 11 Z" fill="url(#goldGrad)" />
      <path d="M50 8 Q56 5 62 6 Q68 5 74 8" fill="none" stroke="url(#goldGrad)" strokeWidth="0.8" />
      {/* Bottom ornament */}
      <path d="M62 82 L65 77 L62 79 L59 77 Z" fill="url(#goldGrad)" />
      {/* Side ornaments */}
      <path d="M24 44 L28 41 L26 44 L28 47 Z" fill="url(#goldGrad)" />
      <path d="M100 44 L96 41 L98 44 L96 47 Z" fill="url(#goldGrad)" />

      {/* Stylised H */}
      <text x="34" y="60"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontWeight="bold"
        fontSize="52"
        fill="url(#goldGrad2)"
        letterSpacing="-2"
      >H</text>

      {/* Stylised G overlay */}
      <text x="52" y="60"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontWeight="bold"
        fontSize="52"
        fill="url(#goldGrad)"
        opacity="0.95"
        letterSpacing="-2"
      >G</text>

      {/* "Hazari" text */}
      <text x="124" y="34"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontWeight="bold"
        fontSize="22"
        fill="url(#goldGrad)"
        letterSpacing="1"
      >Hazari</text>

      {/* "Gold ✦" text */}
      <text x="124" y="58"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontWeight="bold"
        fontSize="22"
        fill="url(#goldGrad)"
        letterSpacing="1"
      >Gold</text>
      <text x="186" y="56"
        fontFamily="sans-serif"
        fontSize="14"
        fill="url(#goldGrad)"
      >✦</text>
    </svg>
  );
}

// ── Item icon SVGs ─────────────────────────────────────────────────────────────
function GoldBarIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44">
      <rect x="4" y="14" width="40" height="20" rx="3" fill="#b8860b"/>
      <rect x="4" y="14" width="40" height="7"  rx="2" fill="#d4a820"/>
      <rect x="8" y="18" width="32" height="12" rx="1.5" fill="#8b6600" opacity="0.35"/>
      <rect x="4" y="14" width="40" height="20" rx="3" fill="none" stroke="#e0b830" strokeWidth="0.8"/>
      <text x="24" y="28" textAnchor="middle" fill="#fff8dc" fontSize="8" fontWeight="bold" fontFamily="sans-serif">GOLD</text>
    </svg>
  );
}
function JewelryIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44">
      {/* Ring band */}
      <ellipse cx="24" cy="30" rx="16" ry="7" fill="none" stroke="#c8a43a" strokeWidth="5"/>
      <ellipse cx="24" cy="30" rx="16" ry="7" fill="none" stroke="#e0c050" strokeWidth="2"/>
      {/* Stone setting */}
      <polygon points="24,8 30,18 24,22 18,18" fill="#e0b830"/>
      <polygon points="24,8 30,18 24,14 18,18" fill="#f0d050"/>
      <polygon points="24,22 30,18 24,14" fill="#c09020"/>
      <polygon points="24,22 18,18 24,14" fill="#d0a030"/>
    </svg>
  );
}
function SmallBarIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44">
      <rect x="6" y="10" width="36" height="28" rx="2.5" fill="#b8860b"/>
      <rect x="6" y="10" width="36" height="10" rx="2"   fill="#d4a820"/>
      <rect x="10" y="14" width="28" height="19" rx="1.5" fill="#8b6600" opacity="0.3"/>
      <text x="24" y="24" textAnchor="middle" fill="#ffe878" fontSize="5.5" fontWeight="bold" fontFamily="sans-serif">PURE</text>
      <text x="24" y="31" textAnchor="middle" fill="#ffe878" fontSize="5.5" fontWeight="bold" fontFamily="sans-serif">GOLD</text>
      <text x="24" y="37" textAnchor="middle" fill="#ffe878" fontSize="4.5" fontFamily="sans-serif">999.9</text>
      <rect x="6" y="10" width="36" height="28" rx="2.5" fill="none" stroke="#e0c040" strokeWidth="0.7"/>
    </svg>
  );
}
function KiloBarIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44">
      <rect x="3" y="12" width="42" height="24" rx="3" fill="#b8860b"/>
      <rect x="3" y="12" width="42" height="9"  rx="2.5" fill="#d4a820"/>
      <rect x="7" y="16" width="34" height="16" rx="1.5" fill="#8b6600" opacity="0.3"/>
      <text x="24" y="26" textAnchor="middle" fill="#ffe878" fontSize="5.5" fontWeight="bold" fontFamily="sans-serif">1 KG</text>
      <text x="24" y="33" textAnchor="middle" fill="#ffe878" fontSize="4.5" fontFamily="sans-serif">999.9</text>
      <rect x="3" y="12" width="42" height="24" rx="3" fill="none" stroke="#e0c040" strokeWidth="0.7"/>
    </svg>
  );
}

function itemIcon(name: string) {
  const n = name.toUpperCase();
  if (n.includes("JEWEL") || n.includes("22K") || n.includes("21K") || n.includes("18K"))
    return <JewelryIcon />;
  if (n.includes("TOLA") || n.includes("TTB"))
    return <GoldBarIcon />;
  if (n.includes("1KG") || n.includes("KILO") || n.includes("995"))
    return <KiloBarIcon />;
  return <SmallBarIcon />;
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TvDisplay() {
  const [data,    setData]    = useState<TvData | null>(null);
  const [now,     setNow]     = useState(new Date());
  const socketRef = useRef<Socket | null>(null);

  const load = useCallback(async () => {
    try { setData(await fetchTvData()); } catch {}
  }, []);

  useEffect(() => {
    load();
    const sock = io({ path: "/api/socket.io", transports: ["websocket", "polling"] });
    socketRef.current = sock;
    sock.on("PRICE_MUTATION", load);
    const fallback = setInterval(load, 10_000);
    return () => { sock.disconnect(); clearInterval(fallback); };
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const isLive = data != null && data.source !== "none" && !data.error;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#111",
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cpolygon points='0,0 180,0 220,40 180,80 0,80' fill='%23181818'/%3E%3Cpolygon points='220,0 400,0 400,100 340,130 220,80' fill='%231c1c1c'/%3E%3Cpolygon points='0,80 180,80 220,40 260,100 200,150 0,150' fill='%23161616'/%3E%3Cpolygon points='200,150 260,100 400,100 400,200 300,220' fill='%231a1a1a'/%3E%3Cpolygon points='0,150 200,150 300,220 250,280 0,280' fill='%23181818'/%3E%3Cpolygon points='250,280 300,220 400,200 400,320 310,340' fill='%231e1e1e'/%3E%3Cpolygon points='0,280 250,280 310,340 260,400 0,400' fill='%23141414'/%3E%3Cpolygon points='260,400 310,340 400,320 400,400' fill='%231c1c1c'/%3E%3C/svg%3E")`,
      backgroundSize: "400px 400px",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      color: "#fff",
      display: "flex",
      flexDirection: "column",
      padding: "12px",
      gap: "8px",
      paddingBottom: "70px",
    }}>

      {/* ── Logo ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "center", paddingTop: "4px", paddingBottom: "4px" }}>
        <HazariGoldLogo />
      </div>

      {/* ── Date / Time bar ───────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "#1e1e1e",
        border: "1px solid #333",
        borderRadius: "14px",
        padding: "10px 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "15px" }}>📅</span>
          <span style={{ fontSize: "14px", fontWeight: 600 }}>{fmtDate(now)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "15px" }}>🕐</span>
          <span style={{ fontSize: "14px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmtTime(now)}</span>
        </div>
      </div>

      {/* ── BID / ASK ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        {([
          { label: "BID oz", value: data?.bidUsd },
          { label: "ASK oz", value: data?.askUsd },
        ] as const).map(({ label, value }) => (
          <div key={label} style={{
            background: "#1e1e1e",
            border: "1px solid rgba(200,164,58,0.5)",
            borderRadius: "14px",
            padding: "14px 10px",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff", marginBottom: "4px" }}>{label}</div>
            <div style={{
              fontSize: "clamp(1.5rem,5vw,2.2rem)",
              fontWeight: 800,
              color: "#fff",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}>
              {fmtPrice(value ?? null)}
            </div>
          </div>
        ))}
      </div>

      {/* ── Low / High ────────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <div style={{
          background: "#1e1e1e",
          border: "1px solid #2a2a2a",
          borderRadius: "14px",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "4px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "#ef4444", fontSize: "18px", fontWeight: 700 }}>↓</span>
            <span style={{ color: "#ef4444", fontSize: "15px", fontWeight: 700 }}>Low</span>
          </div>
          <div style={{ fontSize: "clamp(1rem,3.5vw,1.4rem)", fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
            {fmtPrice(data?.dailyLow ?? null)}
          </div>
        </div>
        <div style={{
          background: "#1e1e1e",
          border: "1px solid #2a2a2a",
          borderRadius: "14px",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "4px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "#22c55e", fontSize: "18px", fontWeight: 700 }}>↑</span>
            <span style={{ color: "#22c55e", fontSize: "15px", fontWeight: 700 }}>High</span>
          </div>
          <div style={{ fontSize: "clamp(1rem,3.5vw,1.4rem)", fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
            {fmtPrice(data?.dailyHigh ?? null)}
          </div>
        </div>
      </div>

      {/* ── Item rows ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {data?.items?.map((item) => (
          <div key={item.id} style={{
            background: "#1e1e1e",
            border: "1px solid #2a2a2a",
            borderRadius: "14px",
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}>
            {/* Icon */}
            <div style={{
              width: "46px",
              height: "46px",
              borderRadius: "10px",
              background: "#252525",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              {itemIcon(item.name)}
            </div>

            {/* Name + unit */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>
                {item.name}
              </div>
            </div>

            {/* Unit label */}
            <div style={{
              fontSize: "13px",
              color: "#888",
              fontWeight: 600,
              width: "36px",
              textAlign: "center",
              flexShrink: 0,
            }}>
              {item.weightLabel}
            </div>

            {/* Price */}
            <div style={{
              fontSize: "clamp(0.95rem,3vw,1.15rem)",
              fontWeight: 700,
              color: "#fff",
              textAlign: "right",
              flexShrink: 0,
              fontVariantNumeric: "tabular-nums",
              minWidth: "90px",
            }}>
              {fmtPrice(item.price)}
            </div>
          </div>
        ))}

        {(!data?.items || data.items.length === 0) && (
          <div style={{ textAlign: "center", color: "#555", padding: "20px" }}>
            Loading prices…
          </div>
        )}
      </div>

      {/* ── Bottom nav ────────────────────────────────────────────────────────── */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "#1a1a1a",
        borderTop: "1px solid #2a2a2a",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        padding: "8px 0 10px",
        zIndex: 100,
      }}>
        {[
          { icon: "🏠", label: "Home",       active: true  },
          { icon: "📈", label: "Charts",     active: false },
          { icon: "🔢", label: "Calculator", active: false },
          { icon: "📇", label: "Contact",    active: false },
        ].map(({ icon, label, active }) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", cursor: "pointer" }}>
            <span style={{ fontSize: "22px", filter: active ? "none" : "grayscale(1) opacity(0.5)" }}>{icon}</span>
            <span style={{
              fontSize: "11px",
              fontWeight: active ? 700 : 400,
              color: active ? "#c8a43a" : "#666",
            }}>{label}</span>
            {active && <div style={{ width: "20px", height: "2px", background: "#c8a43a", borderRadius: "2px" }} />}
          </div>
        ))}
      </div>

      {/* ── Live indicator (subtle) ───────────────────────────────────────────── */}
      {data?.updatedAt && (
        <div style={{ textAlign: "center", fontSize: "10px", color: "#444" }}>
          <span style={{
            display: "inline-block",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: isLive ? "#22c55e" : "#ef4444",
            marginRight: "5px",
            verticalAlign: "middle",
            boxShadow: isLive ? "0 0 5px #22c55e" : "none",
          }} />
          {data.source} · {new Date(data.updatedAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
