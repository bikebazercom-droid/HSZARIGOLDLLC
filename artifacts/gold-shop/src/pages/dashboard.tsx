import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetDashboardKpis, getGetDashboardKpisQueryKey,
  useGetDashboardSummaryCards, getGetDashboardSummaryCardsQueryKey,
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
  Database, Layers
} from "lucide-react";

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
    <div className="space-y-6 pb-12">
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

      {/* Hero Control Desk */}
      {summaryLoading || !summary ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Skeleton className="h-[140px] xl:col-span-2" />
          <Skeleton className="h-[140px] xl:col-span-1" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Financial Control */}
          <Card className="col-span-1 xl:col-span-2 overflow-hidden border-border/50 shadow-sm">
            <CardHeader className="bg-muted/30 border-b border-border/50 pb-3 py-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <Banknote className="w-4 h-4 text-muted-foreground" /> Financial Control &amp; Profit (AED)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border/50">
                <div className="p-5 flex flex-col justify-center">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Purchase Debit (Cash Out)</p>
                  <p className="text-xl font-bold font-mono text-foreground">{fmtAED(summary.totalPurchaseDebitAed)}</p>
                </div>
                <div className="p-5 flex flex-col justify-center">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Sales Credit (Cash In)</p>
                  <p className="text-xl font-bold font-mono text-foreground">{fmtAED(summary.totalSalesCreditAed)}</p>
                </div>
                <div className="p-5 flex flex-col justify-center">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">FIFO Cost of Sold</p>
                  <p className="text-xl font-bold font-mono text-foreground">{fmtAED(summary.soldCostAed)}</p>
                </div>
                <div className="p-5 bg-muted/20 flex flex-col justify-center border-t-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Overall Net Profit</p>
                  <p className={`text-2xl font-bold font-mono ${summary.netProfitAed < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-500'}`}>
                    {fmtAED(summary.netProfitAed)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vault Physical Control */}
          <Card className="col-span-1 overflow-hidden border-border/50 shadow-sm">
            <CardHeader className="bg-muted/30 border-b border-border/50 pb-3 py-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <Database className="w-4 h-4 text-muted-foreground" /> Physical Vault Control (Grams)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 divide-y sm:divide-y-0 xl:divide-y sm:divide-x xl:divide-x-0 divide-border/50 h-full">
                <div className="p-5 flex flex-col justify-center bg-muted/10">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Total Physical Remaining</p>
                  <p className="text-2xl font-bold font-mono text-foreground">
                    {fmtG(summary.totalPhysicalRemainingGrams)}
                    <span className="text-sm font-normal text-muted-foreground ml-1">g</span>
                  </p>
                </div>
                <div className="p-5 grid grid-cols-2 gap-4 items-center">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Gold &amp; Other</p>
                    <p className="text-sm font-bold font-mono text-foreground">{fmtG(summary.availableStockGrams)} g</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Silver</p>
                    <p className="text-sm font-bold font-mono text-foreground">{fmtG(summary.silverStockGrams)} g</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Category Breakdown Table */}
      {summaryLoading || !summary ? (
        <Skeleton className="h-64 mt-6" />
      ) : (
        <Card className="overflow-hidden border-border/50 shadow-sm">
          <CardHeader className="bg-muted/30 border-b border-border/50 pb-3 py-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <Layers className="w-4 h-4 text-muted-foreground" /> Category-wise Vault Breakdown
            </CardTitle>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-background text-muted-foreground rounded px-2.5 py-1 flex items-center gap-1 border border-border/50 shadow-sm">
              Real-time Balance
            </span>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/10">
                <TableRow>
                  <TableHead className="font-semibold text-muted-foreground">Category Name</TableHead>
                  <TableHead className="text-right font-semibold text-muted-foreground">Metal Purchased / In <span className="text-[10px] font-normal uppercase ml-1">(Debit g)</span></TableHead>
                  <TableHead className="text-right font-semibold text-muted-foreground">Metal Sold / Out <span className="text-[10px] font-normal uppercase ml-1">(Credit g)</span></TableHead>
                  <TableHead className="text-right font-semibold text-foreground bg-muted/20 w-56 border-l border-border/50">Net Remaining Vault <span className="text-[10px] font-normal uppercase ml-1">(Balance g)</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.categoryBreakdown.map((row) => (
                  <TableRow key={row.category} className="hover:bg-muted/5 transition-colors">
                    <TableCell className="font-medium text-foreground py-3">{row.label}</TableCell>
                    <TableCell className="text-right text-muted-foreground font-mono">{fmtG(row.purchasedGrams)} <span className="text-xs">g</span></TableCell>
                    <TableCell className="text-right text-muted-foreground font-mono">{fmtG(row.soldGrams)} <span className="text-xs">g</span></TableCell>
                    <TableCell className="text-right font-bold text-foreground bg-muted/5 font-mono py-3 border-l border-border/50">{fmtG(row.remainingGrams)} <span className="text-xs text-muted-foreground">g</span></TableCell>
                  </TableRow>
                ))}
                {/* Totals Footer Row */}
                <TableRow className="bg-muted/20 hover:bg-muted/20 border-t-2 border-border">
                  <TableCell className="font-bold text-foreground py-3 uppercase text-[11px] tracking-wider">Total Vault</TableCell>
                  <TableCell className="text-right text-foreground font-bold font-mono">{fmtG(summary.categoryBreakdown.reduce((acc, r) => acc + r.purchasedGrams, 0))} <span className="text-xs font-normal">g</span></TableCell>
                  <TableCell className="text-right text-foreground font-bold font-mono">{fmtG(summary.categoryBreakdown.reduce((acc, r) => acc + r.soldGrams, 0))} <span className="text-xs font-normal">g</span></TableCell>
                  <TableCell className="text-right font-bold text-foreground font-mono py-3 text-sm border-l border-border/50">{fmtG(summary.totalPhysicalRemainingGrams)} <span className="text-xs font-normal text-muted-foreground">g</span></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Time range filter & KPIs */}
      <div className="pt-4 mt-6 border-t border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">Operational KPIs</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Metrics filtered by selected time range</p>
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
                className="h-8 text-xs shadow-sm"
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
            ? [...Array(8)].map((_, i) => <Skeleton key={i} className="h-[90px]" />)
            : kpiCards.map((c) => (
                <Card key={c.title} className="shadow-sm border-border/50 overflow-hidden">
                  <CardHeader className="bg-muted/10 pb-2 pt-3 px-4 flex flex-row items-center justify-between space-y-0 border-b border-border/50">
                    <CardTitle className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{c.title}</CardTitle>
                    <c.icon className="w-3.5 h-3.5 text-muted-foreground/70" />
                  </CardHeader>
                  <CardContent className="px-4 pb-3 pt-2.5">
                    <div className={`text-lg font-bold font-mono tracking-tight ${c.danger ? "text-destructive" : (c as { green?: boolean }).green ? "text-emerald-600 dark:text-emerald-500" : "text-foreground"}`}>
                      {c.value}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{c.sub}</div>
                  </CardContent>
                </Card>
              ))}
        </div>
      </div>
    </div>
  );
}
