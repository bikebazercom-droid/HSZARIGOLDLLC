import React, { useRef, useState, useEffect } from "react";
import { Link } from "wouter";
import {
  useGetDashboard, getGetDashboardQueryKey,
  useGetMonthlySales, getGetMonthlySalesQueryKey,
  useGetCategorySummary, getGetCategorySummaryQueryKey,
  useGetSettings, getGetSettingsQueryKey,
  useGetPrices, getGetPricesQueryKey,
  useUpdatePrices,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLivePrice } from "@/context/live-price";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { Plus, Filter, FileDown, Sliders, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/context/auth";

const NAVY = "#1e3a5f";
const GOLD = "#c8a43a";

function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtGrams(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtDisplayDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return format(d, "dd/MM/yyyy");
}

function CategorySalesSummary() {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [appliedRange, setAppliedRange] = useState({ startDate: todayStr, endDate: todayStr });
  const [isDownloading, setIsDownloading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const { user } = useAuth();
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const companyName = settings?.companyName ?? "HAZARI GOLD L.L.C";
  const companyTrn = settings?.trn ?? "105301944200003";

  const { data, isLoading, isFetching } = useGetCategorySummary(appliedRange, {
    query: { queryKey: getGetCategorySummaryQueryKey(appliedRange) },
  });

  const handleGenerate = () => {
    setAppliedRange({ startDate, endDate });
  };

  const handleDownloadPdf = async () => {
    if (!reportRef.current || !data) return;
    setIsDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `Category-Sales-Summary_${appliedRange.startDate}_to_${appliedRange.endDate}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(reportRef.current)
        .save();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Category-wise Sales Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 w-[calc(50%-0.375rem)] sm:w-auto">
            <Label className="text-xs text-muted-foreground">From Date</Label>
            <Input
              type="date"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <div className="space-y-1 w-[calc(50%-0.375rem)] sm:w-auto">
            <Label className="text-xs text-muted-foreground">To Date</Label>
            <Input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full sm:w-40"
            />
          </div>
          <Button size="sm" onClick={handleGenerate} disabled={isFetching} className="flex-1 sm:flex-none">
            <Filter className="w-4 h-4 mr-1.5" />
            {isFetching ? "Generating..." : "Generate Report"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownloadPdf} disabled={!data || isDownloading} className="flex-1 sm:flex-none">
            <FileDown className="w-4 h-4 mr-1.5" />
            {isDownloading ? "Preparing PDF..." : "Download PDF Report"}
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-56" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Category</TableHead>
                    <TableHead className="text-right">Total Gross Wt. (g)</TableHead>
                    <TableHead className="text-right">Total Grams Sold (g)</TableHead>
                    <TableHead className="text-right pr-4">Total Sales Revenue (AED)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.rows.map((row) => (
                    <TableRow key={row.category}>
                      <TableCell className="font-medium pl-4">{row.label}</TableCell>
                      <TableCell className="text-right">{fmtGrams(row.grossGrams)} g</TableCell>
                      <TableCell className="text-right">{fmtGrams(row.grams)} g</TableCell>
                      <TableCell className="text-right pr-4">AED {fmtAED(row.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40 font-bold border-t-2">
                    <TableCell className="pl-4">Grand Total</TableCell>
                    <TableCell className="text-right">{fmtGrams(data?.grandTotalGrossGrams)} g</TableCell>
                    <TableCell className="text-right">{fmtGrams(data?.grandTotalGrams)} g</TableCell>
                    <TableCell className="text-right pr-4">AED {fmtAED(data?.grandTotalAmount)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div>
              <div className="text-sm font-semibold text-primary mb-2">Payment Method Breakdown</div>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Payment Method</TableHead>
                      <TableHead className="text-right pr-4">Total (AED)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="pl-4">Cash</TableCell>
                      <TableCell className="text-right pr-4">AED {fmtAED(data?.paymentBreakdown.totalCash)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-4">Card</TableCell>
                      <TableCell className="text-right pr-4">AED {fmtAED(data?.paymentBreakdown.totalCard)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-4">Credit / Due (Account)</TableCell>
                      <TableCell className="text-right pr-4">AED {fmtAED(data?.paymentBreakdown.totalCredit)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/40 font-bold border-t-2">
                      <TableCell className="pl-4">Grand Total</TableCell>
                      <TableCell className="text-right pr-4">AED {fmtAED(data?.paymentBreakdown.grandTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
        )}
      </CardContent>

      {/* Hidden printable A4 template used for PDF generation via html2pdf.js */}
      <div style={{ position: "fixed", top: 0, left: "-9999px", width: "190mm" }}>
        <div
          ref={reportRef}
          style={{
            width: "190mm",
            fontFamily: "Arial, sans-serif",
            color: "#222",
            background: "#fff",
            padding: "6mm 8mm",
            boxSizing: "border-box",
          }}
        >
          {/* Gold top border */}
          <div style={{ height: "4px", background: `linear-gradient(to right, ${GOLD}, #f5d77a, ${GOLD})`, marginBottom: "10px" }} />

          {/* Header: shop branding */}
          <div style={{ textAlign: "center", marginBottom: "10px", borderBottom: `2px solid ${NAVY}`, paddingBottom: "8px" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: NAVY, letterSpacing: "0.5px" }}>{companyName}</div>
            <div style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}>TRN: {companyTrn}</div>
            <div style={{ fontSize: "9px", color: "#777", marginTop: "2px" }}>
              Date of Report Generation: {format(new Date(), "dd/MM/yyyy hh:mm a")}
            </div>
          </div>

          {/* Report title + selected period */}
          <div style={{ textAlign: "center", marginBottom: "14px" }}>
            <div style={{ fontSize: "14px", fontWeight: "bold", color: NAVY, letterSpacing: "1px", marginBottom: "4px" }}>
              CATEGORY-WISE SALES SUMMARY REPORT
            </div>
            <div style={{ fontSize: "11px", color: "#333" }}>
              Sales Report Period: {fmtDisplayDate(appliedRange.startDate)} to {fmtDisplayDate(appliedRange.endDate)}
            </div>
          </div>

          {/* Summary table */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr>
                <th style={{ background: NAVY, color: "#fff", textAlign: "left", padding: "8px 8px", border: `1px solid ${NAVY}` }}>
                  Category
                </th>
                <th style={{ background: NAVY, color: "#fff", textAlign: "right", padding: "8px 8px", border: `1px solid ${NAVY}` }}>
                  Total Gross Wt. (g)
                </th>
                <th style={{ background: NAVY, color: "#fff", textAlign: "right", padding: "8px 8px", border: `1px solid ${NAVY}` }}>
                  Total Grams Sold (g)
                </th>
                <th style={{ background: NAVY, color: "#fff", textAlign: "right", padding: "8px 8px", border: `1px solid ${NAVY}` }}>
                  Total Revenue (AED)
                </th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((row, idx) => (
                <tr key={row.category} style={{ background: idx % 2 === 0 ? "#fff" : "#f7f7f7" }}>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd" }}>{row.label}</td>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{fmtGrams(row.grossGrams)} g</td>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{fmtGrams(row.grams)} g</td>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>AED {fmtAED(row.amount)}</td>
                </tr>
              ))}
              <tr style={{ background: "#eee6cf" }}>
                <td style={{ padding: "9px 8px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY }}>Grand Total</td>
                <td style={{ padding: "9px 8px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY, textAlign: "right", whiteSpace: "nowrap" }}>
                  {fmtGrams(data?.grandTotalGrossGrams)} g
                </td>
                <td style={{ padding: "9px 8px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY, textAlign: "right", whiteSpace: "nowrap" }}>
                  {fmtGrams(data?.grandTotalGrams)} g
                </td>
                <td style={{ padding: "9px 8px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY, textAlign: "right", whiteSpace: "nowrap" }}>
                  AED {fmtAED(data?.grandTotalAmount)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Payment Method Breakdown — official financial summary */}
          <div style={{ marginTop: "18px" }}>
            <div style={{ fontSize: "12px", fontWeight: "bold", color: NAVY, letterSpacing: "0.5px", marginBottom: "6px" }}>
              PAYMENT METHOD BREAKDOWN
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr>
                  <th style={{ background: NAVY, color: "#fff", textAlign: "left", padding: "8px 8px", border: `1px solid ${NAVY}` }}>
                    Payment Method
                  </th>
                  <th style={{ background: NAVY, color: "#fff", textAlign: "right", padding: "8px 8px", border: `1px solid ${NAVY}` }}>
                    Total (AED)
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ background: "#fff" }}>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd" }}>Cash</td>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>
                    AED {fmtAED(data?.paymentBreakdown.totalCash)}
                  </td>
                </tr>
                <tr style={{ background: "#f7f7f7" }}>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd" }}>Card</td>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>
                    AED {fmtAED(data?.paymentBreakdown.totalCard)}
                  </td>
                </tr>
                <tr style={{ background: "#fff" }}>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd" }}>Credit / Due (Account)</td>
                  <td style={{ padding: "7px 8px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>
                    AED {fmtAED(data?.paymentBreakdown.totalCredit)}
                  </td>
                </tr>
                <tr style={{ background: "#eee6cf" }}>
                  <td style={{ padding: "9px 8px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY }}>Grand Total</td>
                  <td style={{ padding: "9px 8px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY, textAlign: "right", whiteSpace: "nowrap" }}>
                    AED {fmtAED(data?.paymentBreakdown.grandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div style={{
            marginTop: "20px", paddingTop: "8px", borderTop: "1px solid #ccc",
            display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#777",
          }}>
            <div>Generated by {user?.fullName ?? "Admin"} on {format(new Date(), "dd/MM/yyyy hh:mm a")}</div>
            <div>{companyName} — Category-wise Sales Summary</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Live Price Tuning ─────────────────────────────────────────────────────────
function LivePriceTuning() {
  const queryClient = useQueryClient();
  const { data: prices } = useGetPrices({ query: { queryKey: getGetPricesQueryKey(), refetchInterval: 5000 } });
  const { liveRates } = useLivePrice();
  const mutation = useUpdatePrices();

  const [spread, setSpread]   = useState("");
  const [labor,  setLabor]    = useState("");
  const [saved,  setSaved]    = useState(false);

  // Seed inputs from DB values once they load
  useEffect(() => {
    if (prices && spread === "" && labor === "") {
      setSpread(String((prices as any).spreadPremiumPercent ?? 0));
      setLabor(String((prices as any).laborCostPercent ?? 0));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices]);

  const handleSave = () => {
    const spreadVal = parseFloat(spread);
    const laborVal  = parseFloat(labor);
    if (!Number.isFinite(spreadVal) || !Number.isFinite(laborVal)) return;
    mutation.mutate(
      { data: { spreadPremiumPercent: spreadVal, laborCostPercent: laborVal } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        },
      },
    );
  };

  // Live preview: show what the adjusted base and key rates will look like
  const rawBase  = liveRates.baseAedPerGram;
  const spreadPct = parseFloat(spread) || 0;
  const laborPct  = parseFloat(labor)  || 0;
  const adjBase  = rawBase != null ? rawBase * (1 + spreadPct / 100) : null;
  const preview22k = adjBase != null ? adjBase * (22 / 24) * (1 + laborPct / 100) : null;
  const previewBar = adjBase != null ? adjBase * 0.9999 : null;

  const fmt2 = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Card className="border-amber-200/40">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Sliders className="w-4 h-4 text-amber-500" />
          Live Price Tuning
          <span className="text-xs font-normal text-muted-foreground ml-1">
            — adjustments applied instantly to the /tv board
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end">
          {/* Spread % input */}
          <div className="flex-1 min-w-[140px]">
            <Label htmlFor="spread-pct" className="text-xs font-medium mb-1.5 block">
              Spread % <span className="text-muted-foreground font-normal">(margin on top of raw spot)</span>
            </Label>
            <div className="relative">
              <Input
                id="spread-pct"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={spread}
                onChange={e => setSpread(e.target.value)}
                className="pr-8 h-9"
                placeholder="0"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
            </div>
          </div>

          {/* Labor Cost % input */}
          <div className="flex-1 min-w-[140px]">
            <Label htmlFor="labor-pct" className="text-xs font-medium mb-1.5 block">
              Labor Cost % <span className="text-muted-foreground font-normal">(jewelry rows only)</span>
            </Label>
            <div className="relative">
              <Input
                id="labor-pct"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={labor}
                onChange={e => setLabor(e.target.value)}
                className="pr-8 h-9"
                placeholder="0"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">%</span>
            </div>
          </div>

          {/* Save button */}
          <Button
            onClick={handleSave}
            disabled={mutation.isPending}
            size="sm"
            className="h-9 min-w-[90px] shrink-0"
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <><Check className="w-4 h-4 mr-1.5" /> Saved</>
            ) : (
              "Save"
            )}
          </Button>
        </div>

        {/* Live preview strip */}
        {liveRates.isLive && (
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-3 py-1.5">
              <span className="text-muted-foreground">Adj. Base (24K)</span>
              <span className="font-mono font-semibold tabular-nums">{fmt2(adjBase)} AED/g</span>
            </div>
            <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-3 py-1.5">
              <span className="text-muted-foreground">Gold 9999</span>
              <span className="font-mono font-semibold tabular-nums">{fmt2(previewBar)} AED/g</span>
            </div>
            <div className="flex items-center gap-1.5 bg-muted/50 rounded-md px-3 py-1.5">
              <span className="text-muted-foreground">Jewellery 22K</span>
              <span className="font-mono font-semibold tabular-nums">{fmt2(preview22k)} AED/g</span>
            </div>
          </div>
        )}

        {mutation.isError && (
          <p className="mt-2 text-xs text-destructive">Failed to save — please try again.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });
  const { data: monthlySales, isLoading: isMonthlySalesLoading } = useGetMonthlySales({ query: { queryKey: getGetMonthlySalesQueryKey() } });

  if (isLoading || isMonthlySalesLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (!data) return <div>Failed to load dashboard</div>;

  const todayDate = format(new Date(), "MMMM d, yyyy");

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

      {/* Quick stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
        <Card className="bg-primary text-primary-foreground border-primary col-span-2 md:col-span-1">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium opacity-80">Today's Total</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold">AED {fmtAED(data.todayTotalSale)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Monthly Total</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold">AED {fmtAED(data.monthlySale)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold text-destructive">{data.pendingPaymentsCount}</div>
          </CardContent>
        </Card>
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
      </div>

      {/* Live Price Tuning */}
      <LivePriceTuning />

      {/* Charts + recent invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Revenue Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {monthlySales && monthlySales.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySales} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
                  />
                  <Legend iconType="circle" />
                  <Bar dataKey="cash" name="Cash" stackId="a" fill="hsl(var(--chart-1))" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="card" name="Card" stackId="a" fill="hsl(var(--chart-2))" />
                  <Bar dataKey="bankTransfer" name="Bank Transfer" stackId="a" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No sales data yet</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Recent Invoices</CardTitle>
            <Link href="/invoices">
              <Button variant="outline" size="sm">View All</Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {data.recentInvoices && data.recentInvoices.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Invoice #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right pr-4">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentInvoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium pl-4">
                          <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">{inv.invoiceNumber}</Link>
                        </TableCell>
                        <TableCell className="max-w-[100px] truncate">{inv.customerName || "Walk-in"}</TableCell>
                        <TableCell>
                          <Badge variant={inv.paymentMethod === "cash" ? "default" : inv.paymentMethod === "card" ? "secondary" : "outline"} className="text-[10px]">
                            {inv.paymentMethod.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold pr-4">
                          AED {Number(inv.total).toLocaleString("en-AE", { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground text-sm">No recent invoices</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Customers</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-semibold">{data.totalCustomers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Products</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-semibold">{data.totalProducts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Invoices</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-semibold">{data.totalInvoices}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Cash Collection</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-semibold">AED {fmtAED(data.cashCollection)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Category-wise Sales Summary */}
      <CategorySalesSummary />
    </div>
  );
}
