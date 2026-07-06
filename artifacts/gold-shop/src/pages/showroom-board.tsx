import React, { useEffect, useState } from "react";
import { useGetPublicPrices, getGetPublicPricesQueryKey } from "@workspace/api-client-react";

const GOLD = "#d4af37";
const GOLD_SOFT = "#c8a43a";

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

interface AssetRow {
  label: string;
  purityLabel: string;
  rate: number;
}

function RateCard({ label, purityLabel, rate }: AssetRow) {
  return (
    <div
      className="relative rounded-2xl flex flex-col justify-between overflow-hidden"
      style={{
        background: "linear-gradient(160deg, #161616 0%, #0c0c0c 100%)",
        border: `1px solid ${GOLD}44`,
        boxShadow: `0 0 0 1px #00000080, 0 12px 40px -12px ${GOLD}22`,
        padding: "1.75rem 2rem",
        minHeight: 220,
      }}
    >
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: 4, background: `linear-gradient(90deg, ${GOLD_SOFT}, ${GOLD}, ${GOLD_SOFT})` }}
      />
      <div>
        <div className="uppercase tracking-widest font-bold" style={{ color: GOLD, fontSize: "1.5rem", letterSpacing: "0.06em" }}>
          {label}
        </div>
        <div className="text-neutral-400 font-medium mt-1" style={{ fontSize: "1.1rem" }}>
          Purity {purityLabel}
        </div>
      </div>
      <div className="flex items-end justify-between mt-6">
        <div className="text-neutral-500 font-semibold" style={{ fontSize: "1.1rem" }}>AED / gram</div>
        <div
          className="font-extrabold tabular-nums"
          style={{ color: "#ffffff", fontSize: "3.25rem", lineHeight: 1, fontFamily: "monospace", letterSpacing: "-0.02em" }}
        >
          {rate > 0 ? rate.toFixed(2) : "—"}
        </div>
      </div>
    </div>
  );
}

export default function ShowroomBoard() {
  const now = useTicker();
  const { data: prices } = useGetPublicPrices({
    query: { queryKey: getGetPublicPricesQueryKey(), refetchInterval: 5000, refetchIntervalInBackground: true },
  });

  const silverRate = prices?.liveModeConnected ? (prices?.liveSilverRate ?? prices?.silverPricePerGram ?? 0) : (prices?.silverPricePerGram ?? 0);

  // Every asset here reads its own persisted per-gram rate directly from the
  // public prices API — the same fields the Price List page reads/edits —
  // rather than recomputing from goldBullionRate client-side. This keeps the
  // TV Display perfectly in sync with the Price List at all times, whether
  // Live Mode is connected (auto-synced) or disconnected (manually edited).
  const rows: AssetRow[] = [
    { label: "TT. BAR", purityLabel: "0.995", rate: prices?.ttBarRate ?? 0 },
    { label: "TT. BAR", purityLabel: "0.999", rate: prices?.ttBar24kRate ?? 0 },
    { label: "KG BAR", purityLabel: "0.995", rate: prices?.kgBarRate ?? 0 },
    { label: "GOLD", purityLabel: "0.9999", rate: prices?.gold9999Rate ?? 0 },
    { label: "Silver", purityLabel: "0.999", rate: silverRate },
    { label: "Gold Jewelry 22K", purityLabel: "0.916", rate: prices?.gold22kRate ?? 0 },
    { label: "Gold Jewelry 21K", purityLabel: "0.875", rate: prices?.gold21kRate ?? 0 },
    { label: "Gold Jewelry 18K", purityLabel: "0.750", rate: prices?.gold18kRate ?? 0 },
  ];

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center"
      style={{ background: "#050505", padding: "3rem 4rem" }}
    >
      <div className="flex flex-col items-center gap-4 mb-10">
        <h1
          className="text-center font-black uppercase"
          style={{
            color: GOLD,
            fontSize: "3.25rem",
            letterSpacing: "0.12em",
            textShadow: `0 0 30px ${GOLD}55`,
            fontFamily: "serif",
          }}
        >
          Hazari Gold <span style={{ color: "#f5f5f5" }}>—</span> Live Market Rates
        </h1>
        <div
          className="flex items-center gap-6 rounded-full px-8 py-3"
          style={{ border: `1px solid ${GOLD}55`, background: "#111111" }}
        >
          <span className="text-neutral-300 font-semibold" style={{ fontSize: "1.35rem" }}>
            {formatDate(now)}
          </span>
          <span style={{ color: GOLD, fontSize: "1.35rem" }}>•</span>
          <span
            className="font-bold tabular-nums"
            style={{ color: GOLD, fontSize: "1.5rem", fontFamily: "monospace" }}
          >
            {formatClock(now)}
          </span>
        </div>
      </div>

      <div
        className="grid gap-6 w-full"
        style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", maxWidth: 1600 }}
      >
        {rows.map((row, i) => (
          <RateCard key={`${row.label}-${row.purityLabel}-${i}`} {...row} />
        ))}
      </div>

      <div className="mt-10 text-neutral-500 text-sm tracking-wide">
        {prices?.liveModeConnected ? "Live rates — updating automatically" : "Manual rates"}
        {prices?.updatedAt && ` · Last updated ${new Date(prices.updatedAt).toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" })}`}
      </div>
    </div>
  );
}
