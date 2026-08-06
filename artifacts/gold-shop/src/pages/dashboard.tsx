import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetDashboard, getGetDashboardQueryKey,
  useGetDashboardKpis, getGetDashboardKpisQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format, startOfWeek, startOfMonth } from "date-fns";
import {
  Plus, ArrowDownToLine, ArrowUpFromLine, Scale, Banknote,
  Wallet, AlertCircle, Hammer, ReceiptText,
} from "lucide-react";

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
  const { data, isLoading } = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });

  const todayDate = format(new Date(), "MMMM d, yyyy");

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
      title: "Total Sales Revenue", icon: Banknote,
      value: `AED ${fmtAED(kpis.totalRevenueAed)}`, sub: "All generated invoices",
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
        <Link href="/invoices/new" className="self-start sm:self-auto">
          <Button size="sm" className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-1.5" /> New Invoice</Button>
        </Link>
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
                  <div className={`text-lg font-bold ${c.danger ? "text-destructive" : ""}`}>{c.value}</div>
                  <div className="text-[11px] text-muted-foreground">{c.sub}</div>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Live rates & totals */}
      {isLoading || !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Gold/g</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-lg font-bold">AED {data.goldPricePerGram}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Silver/g</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-lg font-bold">AED {data.silverPricePerGram}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total Customers</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-lg font-bold">{data.totalCustomers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Pending Payments</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <div className="text-lg font-bold text-destructive">{data.pendingPaymentsCount}</div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
