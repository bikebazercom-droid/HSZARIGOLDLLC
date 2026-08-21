import React, { useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, Bell, BookOpen, Check, ChevronRight,
  CircleDollarSign, ClipboardCheck, Download, FileText, Filter, Landmark,
  LayoutGrid, Menu, PackageCheck, Search, ShieldCheck, SlidersHorizontal,
  Sparkles, WalletCards, X,
} from "lucide-react";

type Movement = {
  id: string;
  label: string;
  ref: string;
  person: string;
  time: string;
  grams: string;
  value: string;
  kind: "in" | "out" | "alert";
  status: string;
};

const movements: Movement[] = [
  { id: "1", label: "Supplier delivery", ref: "PB-2408-019", person: "Al Noor Metals", time: "09:42", grams: "+2,184.500 g", value: "AED 517,920.00", kind: "in", status: "Verified" },
  { id: "2", label: "Wholesale invoice", ref: "WS-1184", person: "Mira Jewellery", time: "09:18", grams: "−640.250 g", value: "AED 151,448.40", kind: "out", status: "Posted" },
  { id: "3", label: "Retail invoice", ref: "INV-5021", person: "S. Rahman", time: "08:55", grams: "−74.100 g", value: "AED 18,773.50", kind: "out", status: "Posted" },
  { id: "4", label: "Supplier delivery", ref: "PB-2408-018", person: "Gulf Refinery Co.", time: "Yesterday", grams: "+980.000 g", value: "AED 232,750.00", kind: "in", status: "Awaiting review" },
  { id: "5", label: "Stock variance", ref: "CHK-0820", person: "Vault count · Bay 02", time: "Yesterday", grams: "−12.400 g", value: "Needs review", kind: "alert", status: "Flagged" },
];

const nav = [
  { icon: LayoutGrid, label: "Overview" },
  { icon: ArrowDownLeft, label: "Purchases", count: "3" },
  { icon: ArrowUpRight, label: "Sales" },
  { icon: Landmark, label: "Vault" },
  { icon: BookOpen, label: "Audit trail" },
];

export default function LedgerVault() {
  const [activeNav, setActiveNav] = useState("Overview");
  const [range, setRange] = useState("Today");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(movements[0]);
  const [reviewed, setReviewed] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const visible = useMemo(
    () => movements.filter((m) =>
      `${m.label} ${m.ref} ${m.person}`.toLowerCase().includes(query.toLowerCase())
    ),
    [query],
  );

  return (
    <div className="min-h-screen w-full overflow-hidden bg-[#f5f1e8] text-[#172433]" style={{ fontFamily: "'Trebuchet MS', sans-serif" }}>
      <div className="flex min-h-screen">
        <aside className="hidden w-[232px] shrink-0 flex-col bg-[#102a43] px-5 py-6 text-[#e9efe8] md:flex">
          <div className="mb-12 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e4b55b] text-[#102a43]">
              <span className="font-serif text-2xl font-bold">H</span>
            </div>
            <div>
              <div className="text-[15px] font-bold tracking-wide text-[#f0c86d]">HAZARI GOLD</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.24em] text-[#9cb5ba]">Control room</div>
            </div>
          </div>
          <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#78949c]">Workspace</div>
          <nav className="space-y-1">
            {nav.map(({ icon: Icon, label, count }) => (
              <button
                key={label}
                onClick={() => setActiveNav(label)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-[13px] transition-all ${activeNav === label ? "bg-[#e4b55b] font-bold text-[#102a43]" : "text-[#b3c7c8] hover:bg-[#1b3a53] hover:text-white"}`}
              >
                <span className="flex items-center gap-3"><Icon size={17} strokeWidth={1.8} />{label}</span>
                {count && <span className="rounded-full bg-[#c4573c] px-1.5 py-0.5 text-[10px] font-bold text-white">{count}</span>}
              </button>
            ))}
          </nav>
          <div className="mt-auto rounded-xl border border-[#335266] bg-[#173750] p-4">
            <div className="mb-3 flex items-center gap-2 text-[#e4b55b]"><ShieldCheck size={16} /><span className="text-[11px] font-bold uppercase tracking-wider">Ledger healthy</span></div>
            <p className="text-[11px] leading-relaxed text-[#a9c0c2]">All entries reconciled through 20 Aug 2024.</p>
            <div className="mt-4 h-1 overflow-hidden rounded bg-[#36566a]"><div className="h-full w-[92%] bg-[#e4b55b]" /></div>
            <div className="mt-2 flex justify-between text-[10px] text-[#8ca8ae]"><span>Audit coverage</span><span className="text-[#e4b55b]">92%</span></div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex items-center justify-between border-b border-[#d9d1c2] bg-[#f8f5ee] px-5 py-4 md:px-9">
            <div className="flex items-center gap-3">
              <button className="md:hidden" aria-label="Open navigation"><Menu size={20} /></button>
              <div><div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8c9a94]">{activeNav}</div><div className="font-serif text-xl text-[#172433]">Good morning, Huda</div></div>
            </div>
            <div className="flex items-center gap-4">
              <button className="relative rounded-full p-2 text-[#62777a] hover:bg-[#ebe4d8]" aria-label="Notifications"><Bell size={18} /><span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#c4573c]" /></button>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#c9d8cf] text-xs font-bold text-[#193b4d]">HM</div>
            </div>
          </header>

          <div className="mx-auto max-w-[1400px] px-5 py-7 md:px-9 md:py-9">
            <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div><p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#b47a32]">Tuesday · 20 August 2024</p><h1 className="font-serif text-4xl leading-none text-[#172433] md:text-5xl">The ledger at a glance.</h1><p className="mt-3 max-w-lg text-sm text-[#6e7c78]">A living view of every gram, dirham, and decision moving through your shop.</p></div>
              <div className="flex gap-2">
                {["Today", "7 days", "30 days"].map((item) => <button key={item} onClick={() => setRange(item)} className={`rounded-full border px-4 py-2 text-xs font-bold transition-colors ${range === item ? "border-[#173750] bg-[#173750] text-white" : "border-[#d4ccbd] bg-transparent text-[#657570] hover:border-[#173750]"}`}>{item}</button>)}
                <button onClick={() => setShowFilters(!showFilters)} className="rounded-full border border-[#d4ccbd] p-2 text-[#657570] hover:bg-[#ebe4d8]" aria-label="Filters"><SlidersHorizontal size={16} /></button>
              </div>
            </div>

            {showFilters && <div className="mb-5 flex items-center gap-3 rounded-xl border border-[#d9d1c2] bg-[#fbf9f4] px-4 py-3 text-xs text-[#6e7c78]"><Filter size={15} className="text-[#b47a32]" /><span>Showing settled and pending entries</span><button onClick={() => setShowFilters(false)} className="ml-auto"><X size={15} /></button></div>}

            <section className="mb-8 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-[#e4b55b] p-5 text-[#172433] md:col-span-1">
                <div className="mb-8 flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-wider">Net position</span><CircleDollarSign size={19} /></div>
                <div className="font-mono text-3xl font-bold tracking-tight">AED 1,284,760</div><div className="mt-2 flex items-center gap-1 text-xs font-bold text-[#44604e]"><ArrowUpRight size={14} /> 8.4% from last {range.toLowerCase()}</div>
              </div>
              <div className="rounded-2xl border border-[#d9d1c2] bg-[#fbf9f4] p-5">
                <div className="mb-8 flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-wider text-[#74837d]">Vault balance</span><PackageCheck size={19} className="text-[#b47a32]" /></div>
                <div className="font-mono text-3xl font-bold tracking-tight text-[#172433]">18,642.75 <span className="text-sm font-normal text-[#78847f]">g</span></div><div className="mt-2 text-xs text-[#71807b]">Across 6 active categories</div>
              </div>
              <div className="rounded-2xl border border-[#d9d1c2] bg-[#fbf9f4] p-5">
                <div className="mb-8 flex items-center justify-between"><span className="text-[11px] font-bold uppercase tracking-wider text-[#74837d]">Needs attention</span><ClipboardCheck size={19} className="text-[#c4573c]" /></div>
                <div className="font-mono text-3xl font-bold tracking-tight text-[#c4573c]">03 <span className="text-sm font-normal text-[#78847f]">entries</span></div><div className="mt-2 text-xs text-[#71807b]">2 bills · 1 stock check</div>
              </div>
            </section>

            <section className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_350px]">
              <div className="min-w-0">
                <div className="mb-3 flex items-center justify-between"><div><h2 className="font-serif text-2xl text-[#172433]">Activity stream</h2><p className="mt-1 text-xs text-[#78847f]">Every movement, in the order it happened.</p></div><button onClick={() => alert("Export prepared")} className="flex items-center gap-2 rounded-lg border border-[#d4ccbd] px-3 py-2 text-xs font-bold text-[#526762] hover:bg-[#ebe4d8]"><Download size={14} /> Export</button></div>
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-[#d9d1c2] bg-[#fbf9f4] px-3 py-2.5"><Search size={16} className="text-[#899691]" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reference, supplier, or movement..." className="w-full bg-transparent text-xs outline-none placeholder:text-[#a0aaa5]" /></div>
                <div className="overflow-hidden rounded-2xl border border-[#d9d1c2] bg-[#fbf9f4]">
                  {visible.map((item) => <button key={item.id} onClick={() => { setSelected(item); setReviewed(false); }} className={`flex w-full items-center gap-4 border-b border-[#e5dfd4] px-4 py-4 text-left transition-colors last:border-0 hover:bg-[#f2ede4] ${selected.id === item.id ? "bg-[#f1eadb]" : ""}`}>
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${item.kind === "in" ? "bg-[#d9e7db] text-[#3f6c4e]" : item.kind === "out" ? "bg-[#dce5ea] text-[#345b72]" : "bg-[#f2d8ce] text-[#b34d36]"}`}>{item.kind === "in" ? <ArrowDownLeft size={17} /> : item.kind === "out" ? <ArrowUpRight size={17} /> : <Bell size={16} />}</div>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-[#263b45]">{item.label}</span><span className="font-mono text-[10px] text-[#899691]">{item.ref}</span></div><div className="mt-1 truncate text-xs text-[#77857f]">{item.person} · {item.time}</div></div>
                    <div className="hidden text-right sm:block"><div className={`font-mono text-sm font-bold ${item.kind === "in" ? "text-[#3f6c4e]" : item.kind === "alert" ? "text-[#c4573c]" : "text-[#345b72]"}`}>{item.grams}</div><div className="mt-1 text-[10px] text-[#899691]">{item.value}</div></div>
                    <ChevronRight size={16} className="shrink-0 text-[#a8afa9]" />
                  </button>)}
                  {!visible.length && <div className="p-10 text-center text-sm text-[#78847f]">No ledger entries match “{query}”.</div>}
                </div>
              </div>

              <aside className="rounded-2xl border border-[#d9d1c2] bg-[#173750] p-6 text-[#e8efe8]">
                <div className="mb-7 flex items-start justify-between"><div><div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#e4b55b]">Selected entry</div><h2 className="font-serif text-2xl">{selected.label}</h2></div><Sparkles size={17} className="text-[#e4b55b]" /></div>
                <div className="space-y-4 border-y border-[#36566a] py-5 text-xs"><div className="flex justify-between"><span className="text-[#91adb1]">Reference</span><span className="font-mono text-[#e5ece6]">{selected.ref}</span></div><div className="flex justify-between"><span className="text-[#91adb1]">Counterparty</span><span className="max-w-[170px] text-right text-[#e5ece6]">{selected.person}</span></div><div className="flex justify-between"><span className="text-[#91adb1]">Metal movement</span><span className="font-mono font-bold text-[#e4b55b]">{selected.grams}</span></div><div className="flex justify-between"><span className="text-[#91adb1]">Value</span><span className="font-mono text-[#e5ece6]">{selected.value}</span></div></div>
                {selected.kind === "alert" ? <div className="mt-5 rounded-lg bg-[#723c38] p-3 text-xs leading-relaxed text-[#f7ddd0]">This variance is outside the 5 g tolerance. Confirm the physical count before closing.</div> : <div className="mt-5 rounded-lg bg-[#234b57] p-3 text-xs leading-relaxed text-[#b9d5cf]">System checks passed. This entry is ready for the next reconciliation run.</div>}
                <button onClick={() => setReviewed(!reviewed)} className={`mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-xs font-bold transition-colors ${reviewed ? "bg-[#527662] text-white" : "bg-[#e4b55b] text-[#102a43] hover:bg-[#f0c86d]"}`}>{reviewed ? <><Check size={15} /> Marked as reviewed</> : <><WalletCards size={15} /> Mark for review</>}</button>
                <button onClick={() => alert(`Opening ${selected.ref}`)} className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-xs font-bold text-[#a7c0c0] hover:text-white">Open full record <ChevronRight size={14} /></button>
              </aside>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}