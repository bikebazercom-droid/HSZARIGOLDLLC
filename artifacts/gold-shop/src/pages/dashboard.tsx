import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetDashboardKpis, getGetDashboardKpisQueryKey,
  useGetDashboardSummaryCards, getGetDashboardSummaryCardsQueryKey,
  useGetWholesaleDashboard, getGetWholesaleDashboardQueryKey,
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
  Plus, ArrowDownToLine, ArrowUpFromLine, Scale, Banknote,
  Wallet, AlertCircle, Hammer, ReceiptText, ShoppingCart, TrendingUp, FileDown, FileSpreadsheet,
  Database, Layers, Briefcase
} from "lucide-react";

const STATEMENT_CATEGORIES: [string, string][] = [
  ["all", "All Categories"],
  ["gold_9999", "GOLD 9999"],
  ["ten_tola_bar", "TEN TOLA BAR"],
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

const KPI_CARD_TONES = {
  profit: {
    card: "border-emerald-200 border-t-4 border-t-emerald-600 bg-emerald-50/80",
    title: "text-emerald-800",
    value: "text-emerald-700",
    icon: "text-emerald-600",
  },
  vault: {
    card: "border-amber-200 border-t-4 border-t-amber-600 bg-amber-50/85",
    title: "text-amber-900",
    value: "text-amber-800",
    icon: "text-amber-600",
  },
  expense: {
    card: "border-rose-200 border-t-4 border-t-rose-600 bg-rose-50/85",
    title: "text-rose-900",
    value: "text-rose-700",
    icon: "text-rose-600",
  },
  navy: {
    card: "border-slate-200 border-t-4 border-t-slate-800 bg-white",
    title: "text-slate-700",
    value: "text-slate-950",
    icon: "text-slate-600",
  },
} as const;

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
  const { data: wholesaleDash, isLoading: wholesaleLoading } = useGetWholesaleDashboard(
    {},
    { query: { queryKey: getGetWholesaleDashboardQueryKey({}) } }
  );

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
      tone: "vault" as const,
    },
    {
      title: "Stock OUT (Sold)", icon: ArrowUpFromLine,
      value: `${fmtG(kpis.stockOutGrams)} g`, sub: `${kg(kpis.stockOutGrams)} KG to customers`,
      tone: "expense" as const,
    },
    {
      title: "Net Stock (IN − OUT)", icon: Scale,
      value: `${fmtG(kpis.netStockGrams)} g`, sub: `${kg(kpis.netStockGrams)} KG`,
      danger: kpis.netStockGrams < 0,
      tone: kpis.netStockGrams < 0 ? ("expense" as const) : ("vault" as const),
    },
    {
      title: "Total Purchase Cost", icon: ShoppingCart,
      value: `AED ${fmtAED(kpis.purchaseCostAed)}`, sub: "Paid to suppliers",
      tone: "expense" as const,
    },
    {
      title: "Total Sales Revenue", icon: Banknote,
      value: `AED ${fmtAED(kpis.totalRevenueAed)}`, sub: "All generated invoices",
      tone: "profit" as const,
    },
    {
      title: "Net Profit", icon: TrendingUp,
      value: `AED ${fmtAED(kpis.netProfitAed)}`,
      sub: `Revenue − est. cost of sold items (AED ${fmtAED(kpis.cogsAed)})`,
      green: kpis.netProfitAed >= 0, danger: kpis.netProfitAed < 0,
      tone: kpis.netProfitAed < 0 ? ("expense" as const) : ("profit" as const),
    },
    {
      title: "Cash Received", icon: Wallet,
      value: `AED ${fmtAED(kpis.cashReceivedAed)}`, sub: "Collected via cash/card/bank",
      tone: "profit" as const,
    },
    {
      title: "Outstanding Due", icon: AlertCircle,
      value: `AED ${fmtAED(kpis.outstandingDueAed)}`, sub: "Pending from customers",
      danger: kpis.outstandingDueAed > 0,
      tone: "expense" as const,
    },
    {
      title: "Making Charge Revenue", icon: Hammer,
      value: `AED ${fmtAED(kpis.makingChargesAed)}`, sub: "From making/handling charges",
      tone: "profit" as const,
    },
    {
      title: "Invoices", icon: ReceiptText,
      value: `${kpis.invoiceCount}`, sub: `Avg AED ${fmtAED(kpis.avgInvoiceAed)} / invoice`,
      tone: "navy" as const,
    },
  ] : [];

  return (
    <div className="min-h-full space-y-7 rounded-2xl bg-slate-50 p-4 pb-10 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-700">Hazari Gold · Command Centre</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">{todayDate}</p>
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
                  Leave dates empty for an all-time statement. Includes itemized retail and wholesale sales, purchases, remaining stock and net profit.
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
            <Button
              size="sm"
              className="border-amber-600 bg-gradient-to-r from-amber-500 to-amber-600 font-semibold text-slate-950 shadow-md shadow-amber-600/20 hover:from-amber-600 hover:to-amber-700"
            >
              <Plus className="mr-1.5 h-4 w-4" /> New Invoice
            </Button>
          </Link>
        </div>
      </div>

      {/* Hero Control Desk */}
      {summaryLoading || !summary ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Skeleton className="h-[140px] xl:col-span-2" />
          <Skeleton className="h-[140px] xl:col-span-1" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Financial Control */}
          <Card className="col-span-1 overflow-hidden border-slate-200 bg-white shadow-md shadow-slate-900/[0.04] xl:col-span-2">
            <CardHeader className="border-b border-slate-100 bg-white py-4">
              <CardTitle className="flex items-center gap-2 border-l-4 border-amber-600 pl-3 text-sm font-bold text-slate-900">
                <Banknote className="h-4 w-4 text-amber-600" /> Financial Control &amp; Profit <span className="font-medium text-slate-400">(AED)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-4">
                <div className="flex flex-col justify-center bg-rose-50/80 p-5">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-800">Purchase Debit (Cash Out)</p>
                  <p className="font-mono text-xl font-bold text-rose-700">{fmtAED(summary.totalPurchaseDebitAed)}</p>
                </div>
                <div className="flex flex-col justify-center bg-emerald-50/80 p-5">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800">Sales Credit (Invoiced)</p>
                  <p className="font-mono text-xl font-bold text-emerald-700">{fmtAED(summary.totalSalesCreditAed)}</p>
                </div>
                <div className="flex flex-col justify-center bg-rose-50/50 p-5">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-800">FIFO Cost of Sold</p>
                  <p className="font-mono text-xl font-bold text-rose-700">{fmtAED(summary.soldCostAed)}</p>
                </div>
                <div className={summary.netProfitAed < 0 ? "flex flex-col justify-center bg-rose-100 p-5" : "flex flex-col justify-center bg-emerald-100 p-5"}>
                  <p className={summary.netProfitAed < 0 ? "mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-900" : "mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-900"}>Overall Net Profit</p>
                  <p className={`font-mono text-2xl font-bold ${summary.netProfitAed < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {fmtAED(summary.netProfitAed)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vault Physical Control */}
          <Card className="col-span-1 overflow-hidden border-amber-200 bg-white shadow-md shadow-amber-900/[0.05]">
            <CardHeader className="border-b border-amber-100 bg-amber-50/50 py-4">
              <CardTitle className="flex items-center gap-2 border-l-4 border-amber-600 pl-3 text-sm font-bold text-slate-900">
                <Database className="h-4 w-4 text-amber-600" /> Physical Vault Control <span className="font-medium text-slate-500">(Grams)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid h-full grid-cols-1 divide-y divide-amber-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-1 xl:divide-x-0 xl:divide-y">
                <div className="flex flex-col justify-center bg-amber-50 p-5">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-900">Total Physical Remaining</p>
                  <p className="font-mono text-2xl font-bold text-amber-800">
                    {fmtG(summary.totalPhysicalRemainingGrams)}
                    <span className="ml-1 text-sm font-normal text-amber-700">g</span>
                  </p>
                </div>
                <div className="grid grid-cols-2 items-center gap-4 bg-white p-5">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Gold &amp; Other</p>
                    <p className="font-mono text-sm font-bold text-amber-700">{fmtG(summary.availableStockGrams)} g</p>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Silver</p>
                    <p className="font-mono text-sm font-bold text-slate-800">{fmtG(summary.silverStockGrams)} g</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Wholesale Overview */}
      {wholesaleDash && (
        <Card className="overflow-hidden border-slate-200 bg-white shadow-md shadow-slate-900/[0.04]">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-white py-4">
            <CardTitle className="flex items-center gap-2 border-l-4 border-amber-600 pl-3 text-sm font-bold text-slate-900">
              <Briefcase className="h-4 w-4 text-amber-600" /> Wholesale &amp; Traders Overview
            </CardTitle>
            <Link href="/wholesale">
              <Button size="sm" variant="outline" className="h-7 border-slate-200 px-2 text-[10px] text-slate-700">View Wholesale Dashboard</Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-2 gap-px bg-slate-100 md:grid-cols-4">
              <div className="flex flex-col justify-center bg-emerald-50/75 p-5">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800">Total AED Posted</p>
                <p className="font-mono text-lg font-bold text-emerald-700">{fmtAED(wholesaleDash.totalFixedAed)}</p>
              </div>
              <div className="flex flex-col justify-center bg-amber-50 p-5">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-900">Open Pure Grams</p>
                <p className="font-mono text-lg font-bold text-amber-800">{fmtG(wholesaleDash.openPureGrams)} g</p>
              </div>
              <div className="flex flex-col justify-center bg-slate-50 p-5">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">Returned Grams</p>
                <p className="font-mono text-lg font-bold text-slate-900">{fmtG(wholesaleDash.returnedGrossGrams)} g</p>
              </div>
              <div className="flex flex-col justify-center bg-slate-900 p-5">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">Active Traders</p>
                <p className="font-mono text-lg font-bold text-amber-400">{wholesaleDash.traderCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category Breakdown Table */}
      {summaryLoading || !summary ? (
        <Skeleton className="h-64 mt-6" />
      ) : (
        <Card className="overflow-hidden border-slate-200 bg-white shadow-md shadow-slate-900/[0.04]">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-white py-4">
            <CardTitle className="flex items-center gap-2 border-l-4 border-amber-600 pl-3 text-sm font-bold text-slate-900">
              <Layers className="h-4 w-4 text-amber-600" /> Category-wise Vault Breakdown
            </CardTitle>
            <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 shadow-sm">
              Real-time Balance
            </span>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-900 [&_tr]:border-slate-800">
                <TableRow>
                  <TableHead className="font-bold text-white">Category Name</TableHead>
                  <TableHead className="text-right font-bold text-white">Metal Purchased / In <span className="ml-1 text-[10px] font-medium uppercase text-slate-300">(Debit g)</span></TableHead>
                  <TableHead className="text-right font-bold text-white">Metal Sold / Out <span className="ml-1 text-[10px] font-medium uppercase text-slate-300">(Credit g)</span></TableHead>
                  <TableHead className="w-56 border-l border-slate-700 bg-slate-800 text-right font-bold text-amber-300">Net Remaining Vault <span className="ml-1 text-[10px] font-medium uppercase text-slate-300">(Balance g)</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.categoryBreakdown.map((row, index) => (
                  <TableRow key={row.category} className={`${index % 2 === 0 ? "bg-white" : "bg-slate-50"} border-slate-100 transition-colors hover:bg-amber-50/70`}>
                    <TableCell className="py-3 font-bold text-slate-900">{row.label}</TableCell>
                    <TableCell className="text-right font-mono text-slate-600">{fmtG(row.purchasedGrams)} <span className="text-xs">g</span></TableCell>
                    <TableCell className="text-right font-mono text-slate-600">{fmtG(row.soldGrams)} <span className="text-xs">g</span></TableCell>
                    <TableCell className="border-l border-amber-100 bg-amber-50/60 py-3 text-right font-mono font-bold text-amber-800">{fmtG(row.remainingGrams)} <span className="text-xs font-medium text-amber-700">g</span></TableCell>
                  </TableRow>
                ))}
                {/* Totals Footer Row */}
                <TableRow className="border-t-2 border-slate-300 bg-slate-100 hover:bg-slate-100">
                  <TableCell className="py-3 text-[11px] font-bold uppercase tracking-wider text-slate-900">Total Vault</TableCell>
                  <TableCell className="text-right font-mono font-bold text-slate-900">{fmtG(summary.categoryBreakdown.reduce((acc, r) => acc + r.purchasedGrams, 0))} <span className="text-xs font-normal">g</span></TableCell>
                  <TableCell className="text-right font-mono font-bold text-slate-900">{fmtG(summary.categoryBreakdown.reduce((acc, r) => acc + r.soldGrams, 0))} <span className="text-xs font-normal">g</span></TableCell>
                  <TableCell className="border-l border-amber-200 bg-amber-100 py-3 text-right font-mono text-sm font-bold text-amber-900">{fmtG(summary.totalPhysicalRemainingGrams)} <span className="text-xs font-medium text-amber-800">g</span></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Time range filter & KPIs */}
      <div className="mt-6 border-t border-slate-200 pt-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
          <div>
            <h2 className="border-l-4 border-amber-600 pl-3 text-base font-bold tracking-tight text-slate-900">Operational KPIs</h2>
            <p className="mt-1 text-xs text-slate-500">Metrics filtered by selected time range</p>
          </div>
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
                className={range === key
                  ? "h-8 border-slate-900 bg-slate-900 text-xs text-white shadow-sm hover:bg-slate-800"
                  : "h-8 border-slate-200 bg-white text-xs text-slate-700 shadow-sm hover:border-amber-300 hover:bg-amber-50"}
              >
                {label}
              </Button>
            ))}
            {range === "custom" && (
              <>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Start Date</Label>
                  <Input type="date" className="w-36 h-8 text-xs" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">End Date</Label>
                  <Input type="date" className="w-36 h-8 text-xs" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* 8-card KPI grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {kpisLoading || !kpis
            ? [...Array(8)].map((_, i) => <Skeleton key={i} className="h-[112px] rounded-xl" />)
            : kpiCards.map((c) => {
                const tone = KPI_CARD_TONES[c.tone];
                return (
                <Card key={c.title} className={`overflow-hidden rounded-xl shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md ${tone.card}`}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-black/5 bg-white/30 px-4 pb-2 pt-3">
                    <CardTitle className={`text-[11px] font-bold uppercase tracking-wider ${tone.title}`}>{c.title}</CardTitle>
                    <c.icon className={`h-4 w-4 ${tone.icon}`} />
                  </CardHeader>
                  <CardContent className="px-4 pb-3 pt-2.5">
                    <div className={`font-mono text-lg font-bold tracking-tight ${c.danger ? "text-rose-700" : tone.value}`}>
                      {c.value}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-slate-600">{c.sub}</div>
                  </CardContent>
                </Card>
                );
              })}
        </div>
      </div>
    </div>
  );
}
