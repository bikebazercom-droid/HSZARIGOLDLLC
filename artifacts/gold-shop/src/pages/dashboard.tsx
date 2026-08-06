import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetDashboardKpis, getGetDashboardKpisQueryKey,
  useGetDashboardSummaryCards, getGetDashboardSummaryCardsQueryKey,
  useListStockLevels, getListStockLevelsQueryKey,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, startOfWeek, startOfMonth } from "date-fns";
import {
  Plus, ArrowDownToLine, ArrowUpFromLine, Scale, Banknote, Package, Medal,
  Wallet, AlertCircle, Hammer, ReceiptText, ShoppingCart, TrendingUp, FileDown, FileSpreadsheet,
} from "lucide-react";

const STOCK_LEVEL_CATEGORIES: [string, string][] = [
  ["gold", "GOLD"],
  ["tt_bar", "TT Bar"],
  ["kg_bar", "KG Bar"],
  ["995", "995"],
  ["gold_jewelry_22k", "Gold Jewelry 22K"],
  ["silver", "Silver"],
];

const STATEMENT_CATEGORIES: [string, string][] = [
  ["all", "All Categories"],
  ["gold", "GOLD"],
  ["tt_bar", "TT Bar"],
  ["kg_bar", "KG Bar"],
  ["995", "995"],
  ["gold_jewelry_22k", "Gold Jewelry 22K"],
  ["silver", "Silver"],
];

function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtG(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function kg(n: number | undefined | null): string {
  return ((n ?? 0) / 1000).toFixed(3);
}

type RangeKey = "today" | "week" | "month" | "custom";

export default function Dashboard() {
  const [range, setRange] = useState<RangeKey>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const { startDate, endDate } = useMemo(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    switch (range) {
      case "today": return { startDate: today, endDate: today };
      case "week": return { startDate: format(startOfWeek(new Date(), { weekStartsOn: 6 }), "yyyy-MM-dd"), endDate: today };
      case "month": return { startDate: format(startOfMonth(new Date()), "yyyy-MM-dd"), endDate: today };
      case "custom": return { startDate: customStart || undefined, endDate: customEnd || undefined };
    }
  }, [range, customStart, customEnd]);

  const kpiParams = { startDate, endDate };
  const { data: kpis, isLoading: kpisLoading } = useGetDashboardKpis(kpiParams, {
    query: { queryKey: getGetDashboardKpisQueryKey(kpiParams) },
  });
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummaryCards({
    query: { queryKey: getGetDashboardSummaryCardsQueryKey() },
  });
  const { data: stockLevels, isLoading: levelsLoading } = useListStockLevels({
    query: { queryKey: getListStockLevelsQueryKey() },
  });
  const todayDate = format(new Date(), "MMMM d, yyyy");

  // PDF statement modal state
  const [stmtOpen, setStmtOpen] = useState(false);
  const [stmtStart, setStmtStart] = useState("");
  const [stmtEnd, setStmtEnd] = useState("");
  const [stmtCategory, setStmtCategory] = useState("all");

  const downloadStatement = (kind: "pdf" | "xlsx") => {
    const params = new URLSearchParams();
    if (stmtStart) params.set("startDate", stmtStart);
    if (stmtEnd) params.set("endDate", stmtEnd);
    if (stmtCategory !== "all") params.set("category", stmtCategory);
    window.open(`/api/dashboard/statement-${kind}?${params.toString()}`, "_blank");
    setStmtOpen(false);
  };

  const kpiCards = kpis ? [
    {
      title: "Stock IN (Purchased)", icon: ArrowDownToLine,
      value: `${fmtG(kpis.stockInGrams)} g`, sub: `${kg(kpis.stockInGrams)} KG from suppliers`,
    },
    {
      title: "Stock OUT (Sold)", icon: ArrowUpFromLine,
      value: `${fmtG(kpis.stockOutGrams)} g`, sub: `${kg(kpis.stockOutGrams)} KG to customers`,
    },
    {
      title: "Net Stock (IN − OUT)", icon: Scale,
      value: `${fmtG(kpis.netStockGrams)} g`, sub: `${kg(kpis.netStockGrams)} KG`,
      danger: kpis.netStockGrams < 0,
    },
    {
      title: "Total Purchase Cost", icon: ShoppingCart,
      value: `AED ${fmtAED(kpis.purchaseCostAed)}`, sub: "Paid to suppliers",
    },
    {
      title: "Total Sales Revenue", icon: Banknote,
      value: `AED ${fmtAED(kpis.totalRevenueAed)}`, sub: "All generated invoices",
    },
    {
      title: "Net Profit", icon: TrendingUp,
      value: `AED ${fmtAED(kpis.netProfitAed)}`,
      sub: `Revenue − est. cost of sold items (AED ${fmtAED(kpis.cogsAed)})`,
      green: kpis.netProfitAed >= 0, danger: kpis.netProfitAed < 0,
    },
    {
      title: "Cash Received", icon: Wallet,
      value: `AED ${fmtAED(kpis.cashReceivedAed)}`, sub: "Collected via cash/card/bank",
    },
    {
      title: "Outstanding Due", icon: AlertCircle,
      value: `AED ${fmtAED(kpis.outstandingDueAed)}`, sub: "Pending from customers",
      danger: kpis.outstandingDueAed > 0,
    },
    {
      title: "Making Charge Revenue", icon: Hammer,
      value: `AED ${fmtAED(kpis.makingChargesAed)}`, sub: "From making/handling charges",
    },
    {
      title: "Invoices", icon: ReceiptText,
      value: `${kpis.invoiceCount}`, sub: `Avg AED ${fmtAED(kpis.avgInvoiceAed)} / invoice`,
    },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-primary">Dashboard</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">{todayDate}</p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <Dialog open={stmtOpen} onOpenChange={setStmtOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline"><FileDown className="w-4 h-4 mr-1.5" /> Download PDF Statement</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Download PDF Statement</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Start Date</Label>
                    <Input type="date" value={stmtStart} onChange={(e) => setStmtStart(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">End Date</Label>
                    <Input type="date" value={stmtEnd} onChange={(e) => setStmtEnd(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Category</Label>
                  <Select value={stmtCategory} onValueChange={setStmtCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATEMENT_CATEGORIES.map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave dates empty for an all-time statement. Includes itemized purchases, sales, remaining stock and net profit.
                </p>
              </div>
              <DialogFooter className="flex-col sm:flex-col gap-2">
                <Button className="w-full" onClick={() => downloadStatement("pdf")}>
                  <FileDown className="w-4 h-4 mr-1.5" /> Download PDF Statement (Excel Layout)
                </Button>
                <Button className="w-full" variant="outline" onClick={() => downloadStatement("xlsx")}>
                  <FileSpreadsheet className="w-4 h-4 mr-1.5" /> Download Excel Sheet (.xlsx)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Link href="/invoices/new">
            <Button size="sm"><Plus className="w-4 h-4 mr-1.5" /> New Invoice</Button>
          </Link>
        </div>
      </div>

      {/* Live summary hero cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {summaryLoading || !summary ? (
          <>
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </>
        ) : (
          <>
            {/* Card 1 — dark: live available stock + purchase cost value */}
            <div className="rounded-xl bg-[#1e293b] text-white p-5 shadow-md">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#c8a43a]" /> Current Available Stock
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-white/10 text-emerald-300 rounded-full px-2.5 py-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Inventory
                </span>
              </div>
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Stock IN (Purchased Balance)</p>
                <p className={`text-2xl font-bold mt-0.5 ${summary.availableStockGrams < 0 ? "text-red-400" : ""}`}>
                  {fmtG(summary.availableStockGrams)} g
                  <span className="text-sm font-medium text-slate-400"> / {kg(summary.availableStockGrams)} KG</span>
                </p>
              </div>
              <div className="border-t border-dashed border-slate-600 my-4" />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Total Purchase Cost Value</p>
                <p className={`text-xl font-bold mt-0.5 text-[#c8a43a] ${summary.availableStockCostAed < 0 ? "text-red-400" : ""}`}>
                  AED {fmtAED(summary.availableStockCostAed)}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">Deducts automatically on every sale</p>
              </div>
            </div>

            {/* Card 2 — silver: dedicated silver inventory & valuation */}
            <div className="rounded-xl bg-slate-100 border border-slate-300 text-slate-800 p-5 shadow-md">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
                  <Medal className="w-4 h-4 text-slate-500" /> Silver Inventory &amp; Valuation
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-600 rounded-full px-2.5 py-1 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" /> Silver Only
                </span>
              </div>
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Silver Available Weight</p>
                <p className={`text-2xl font-bold mt-0.5 ${summary.silverStockGrams < 0 ? "text-red-600" : ""}`}>
                  {fmtG(summary.silverStockGrams)} g
                  <span className="text-sm font-medium text-slate-500"> / {kg(summary.silverStockGrams)} KG</span>
                </p>
              </div>
              <div className="border-t border-dashed border-slate-300 my-4" />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Silver Total Purchase Cost</p>
                <p className={`text-xl font-bold mt-0.5 ${summary.silverStockCostAed < 0 ? "text-red-600" : "text-slate-700"}`}>
                  AED {fmtAED(summary.silverStockCostAed)}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">Deducts automatically on every silver sale</p>
              </div>
            </div>

            {/* Card 3 — emerald: sales revenue + net profit */}
            <div className="rounded-xl bg-emerald-900 text-white p-5 shadow-md">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
                  <Banknote className="w-4 h-4 text-emerald-300" /> Sales &amp; Profit Summary
                </h2>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-white/10 text-emerald-200 rounded-full px-2.5 py-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Performance
                </span>
              </div>
              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wide text-emerald-200/70">Total Sales Revenue (Invoiced)</p>
                <p className="text-2xl font-bold mt-0.5">AED {fmtAED(summary.totalRevenueAed)}</p>
              </div>
              <div className="border-t border-dashed border-emerald-700 my-4" />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-emerald-200/70">Net Profit Earned</p>
                <p className={`text-xl font-bold mt-0.5 ${summary.netProfitAed < 0 ? "text-red-400" : "text-[#4ade80]"}`}>
                  AED {fmtAED(summary.netProfitAed)}
                </p>
                <p className="text-[10px] text-emerald-200/50 mt-1">Revenue − purchase cost of sold items</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Per-category live stock boxes */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {levelsLoading || !stockLevels
          ? [...Array(6)].map((_, i) => <Skeleton key={i} className="h-20" />)
          : STOCK_LEVEL_CATEGORIES.map(([cat, label]) => {
              const grams = stockLevels.find((l) => l.category === cat)?.weightGrams ?? 0;
              return (
                <Card key={cat}>
                  <CardContent className="px-4 py-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`text-lg font-bold mt-0.5 ${grams < 0 ? "text-destructive" : ""}`}>{fmtG(grams)} g</p>
                    <p className="text-[11px] text-muted-foreground">{kg(grams)} kg</p>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* Time range filter */}
      <div className="flex flex-wrap items-end gap-2">
        {([
          ["today", "Today"],
          ["week", "This Week"],
          ["month", "This Month"],
          ["custom", "Custom Range"],
        ] as [RangeKey, string][]).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={range === key ? "default" : "outline"}
            onClick={() => setRange(key)}
          >
            {label}
          </Button>
        ))}
        {range === "custom" && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Start Date</Label>
              <Input type="date" className="w-40 h-9" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">End Date</Label>
              <Input type="date" className="w-40 h-9" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            </div>
          </>
        )}
      </div>

      {/* 8-card KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {kpisLoading || !kpis
          ? [...Array(8)].map((_, i) => <Skeleton key={i} className="h-24" />)
          : kpiCards.map((c) => (
              <Card key={c.title}>
                <CardHeader className="pb-1 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-xs font-medium text-muted-foreground">{c.title}</CardTitle>
                  <c.icon className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className={`text-lg font-bold ${c.danger ? "text-destructive" : (c as { green?: boolean }).green ? "text-green-700" : ""}`}>{c.value}</div>
                  <div className="text-[11px] text-muted-foreground">{c.sub}</div>
                </CardContent>
              </Card>
            ))}
      </div>

    </div>
  );
}
