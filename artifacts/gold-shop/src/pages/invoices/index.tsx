import React, { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useListInvoices, getListInvoicesQueryKey, useDeleteInvoice,
  useGetSalesReport, getGetSalesReportQueryKey,
  useGetSettings, getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Trash2, Eye, FileDown, Scale, Banknote, ReceiptText } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/auth";
import { STOCK_CATEGORIES, stockCategoryLabel } from "../products/stock";

const NAVY = "#1e3a5f";
const GOLD = "#c8a43a";

// For known stock buckets show the friendly label; for custom items show the
// exact user-entered item name (never a generic "Custom" fallback).
function rowCategoryDisplay(r: { category: string; description: string }): string {
  return STOCK_CATEGORIES.some((c) => c.id === r.category)
    ? stockCategoryLabel(r.category)
    : (r.description.trim() || r.category);
}

function fmtG(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Invoices() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [isDownloading, setIsDownloading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const companyName = settings?.companyName ?? "HAZARI GOLD L.L.C";
  const companyTrn = settings?.trn ?? "";

  const filterParams = {
    search: search || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    category: category === "all" ? undefined : (category as any),
  };

  const { data: invoices, isLoading } = useListInvoices(
    filterParams,
    { query: { queryKey: getListInvoicesQueryKey(filterParams) } }
  );
  const { data: report } = useGetSalesReport(
    filterParams,
    { query: { queryKey: getGetSalesReportQueryKey(filterParams) } }
  );

  const summary = report?.summary;

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteInvoice = useDeleteInvoice();

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this invoice? Deducted stock will be restored.")) {
      deleteInvoice.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Invoice deleted successfully" });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSalesReportQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to delete invoice", variant: "destructive" });
        }
      });
    }
  };

  const criteriaLine = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Category: ${category === "all" ? "All Categories" : stockCategoryLabel(category)}`);
    if (startDate || endDate) {
      const from = startDate ? format(new Date(`${startDate}T00:00:00`), "dd/MM/yyyy") : "Beginning";
      const to = endDate ? format(new Date(`${endDate}T00:00:00`), "dd/MM/yyyy") : "Today";
      parts.push(`Date: ${from} to ${to}`);
    }
    if (search) parts.push(`Search: "${search}"`);
    return parts.join(" | ");
  }, [category, startDate, endDate, search]);

  const handleDownloadPdf = async () => {
    if (!reportRef.current || !report || report.rows.length === 0) return;
    setIsDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const catTag = category === "all" ? "All-Categories" : stockCategoryLabel(category).replace(/\s+/g, "-");
      await html2pdf()
        .set({
          margin: [10, 10, 10, 10],
          filename: `Sales-Statement_${catTag}_${format(new Date(), "yyyy-MM-dd")}.pdf`,
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
    <div className="space-y-4 sm:space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">Invoices</h1>
        <Link href="/invoices/new" className="self-start sm:self-auto">
          <Button className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" /> Create Invoice</Button>
        </Link>
      </div>

      {/* Live summary stats (respect active filters) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Sold</CardTitle>
            <Scale className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold">{fmtG(summary?.totalGrams)} g</div>
            <div className="text-[11px] text-muted-foreground">{((summary?.totalGrams ?? 0) / 1000).toFixed(3)} KG</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Revenue (AED)</CardTitle>
            <Banknote className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold">AED {fmtAED(summary?.totalAed)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Invoices</CardTitle>
            <ReceiptText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold">{summary?.invoiceCount ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filter controls bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Start Date</Label>
          <Input type="date" className="w-40" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">End Date</Label>
          <Input type="date" className="w-40" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {STOCK_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-48">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Invoice #, customer name or phone..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <Button variant="outline" onClick={handleDownloadPdf} disabled={!report || report.rows.length === 0 || isDownloading}>
          <FileDown className="w-4 h-4 mr-1.5" />
          {isDownloading ? "Preparing PDF..." : "Download PDF Statement"}
        </Button>
      </div>

      <div className="bg-card rounded-md border overflow-x-auto">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Payment Method</TableHead>
              <TableHead className="text-right">Total (AED)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">Loading...</TableCell>
              </TableRow>
            ) : invoices?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No invoices found.
                </TableCell>
              </TableRow>
            ) : (
              invoices?.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">
                    <Link href={`/invoices/${invoice.id}`} className="hover:underline text-primary">
                      {invoice.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(invoice.createdAt), "MMM d, yyyy HH:mm")}
                  </TableCell>
                  <TableCell>
                    {invoice.customerName || "Walk-in Customer"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={invoice.paymentMethod === 'cash' ? 'default' : invoice.paymentMethod === 'card' ? 'secondary' : 'outline'}>
                      {invoice.paymentMethod === 'cash' ? 'Cash Customer' : invoice.paymentMethod === 'card' ? 'Card Payment' : 'Bank Transfer'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {invoice.total?.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link href={`/invoices/${invoice.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(invoice.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Hidden printable A4 sales statement (html2pdf source) */}
      <div style={{ position: "fixed", top: 0, left: "-9999px", width: "190mm" }}>
        <div ref={reportRef} style={{ width: "190mm", fontFamily: "Arial, sans-serif", color: "#222", background: "#fff", padding: "6mm 8mm", boxSizing: "border-box" }}>
          <div style={{ height: "4px", background: `linear-gradient(to right, ${GOLD}, #f5d77a, ${GOLD})`, marginBottom: "10px" }} />
          <div style={{ textAlign: "center", marginBottom: "10px", borderBottom: `2px solid ${NAVY}`, paddingBottom: "8px" }}>
            <div style={{ fontSize: "18px", fontWeight: "bold", color: NAVY, letterSpacing: "0.5px" }}>{companyName}</div>
            {companyTrn && <div style={{ fontSize: "10px", color: "#555", marginTop: "2px" }}>TRN: {companyTrn}</div>}
            <div style={{ fontSize: "9px", color: "#777", marginTop: "2px" }}>
              Date of Report Generation: {format(new Date(), "dd/MM/yyyy hh:mm a")}
            </div>
          </div>
          <div style={{ textAlign: "center", marginBottom: "12px" }}>
            <div style={{ fontSize: "14px", fontWeight: "bold", color: NAVY, letterSpacing: "1px", marginBottom: "4px" }}>
              SALES STATEMENT
            </div>
            <div style={{ fontSize: "11px", color: "#333" }}>{criteriaLine}</div>
          </div>
          {/* Summary box */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
            <div style={{ flex: 1, border: `1.5px solid ${NAVY}`, borderRadius: "4px", padding: "8px 10px", background: "#f4f0e4" }}>
              <div style={{ fontSize: "9px", color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Weight Sold</div>
              <div style={{ fontSize: "13px", fontWeight: "bold", color: NAVY }}>
                {fmtG(summary?.totalGrams)} g ({((summary?.totalGrams ?? 0) / 1000).toFixed(3)} KG)
              </div>
            </div>
            <div style={{ flex: 1, border: `1.5px solid ${NAVY}`, borderRadius: "4px", padding: "8px 10px", background: "#f4f0e4" }}>
              <div style={{ fontSize: "9px", color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Amount</div>
              <div style={{ fontSize: "13px", fontWeight: "bold", color: NAVY }}>AED {fmtAED(summary?.totalAed)}</div>
            </div>
            <div style={{ flex: 1, border: `1.5px solid ${NAVY}`, borderRadius: "4px", padding: "8px 10px", background: "#f4f0e4" }}>
              <div style={{ fontSize: "9px", color: "#555", textTransform: "uppercase", letterSpacing: "0.5px" }}>Invoices</div>
              <div style={{ fontSize: "13px", fontWeight: "bold", color: NAVY }}>{summary?.invoiceCount ?? 0}</div>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
            <thead>
              <tr>
                {["Invoice #", "Date", "Customer", "Category", "Weight (g)", "Rate/Gram (AED)", "Total (AED)"].map((h, i) => (
                  <th key={h} style={{ background: NAVY, color: "#fff", textAlign: i >= 4 ? "right" : "left", padding: "7px 6px", border: `1px solid ${NAVY}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report?.rows.map((r, idx) => (
                <tr key={`${r.invoiceId}-${idx}`} style={{ background: idx % 2 === 0 ? "#fff" : "#f7f7f7" }}>
                  <td style={{ padding: "6px", border: "1px solid #ddd", whiteSpace: "nowrap" }}>{r.invoiceNumber}</td>
                  <td style={{ padding: "6px", border: "1px solid #ddd", whiteSpace: "nowrap" }}>{format(new Date(r.date), "dd/MM/yyyy")}</td>
                  <td style={{ padding: "6px", border: "1px solid #ddd" }}>{r.customerName || "Walk-in Customer"}</td>
                  <td style={{ padding: "6px", border: "1px solid #ddd" }}>{rowCategoryDisplay(r)}</td>
                  <td style={{ padding: "6px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{fmtG(r.weightGrams)}</td>
                  <td style={{ padding: "6px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{fmtAED(r.ratePerGram)}</td>
                  <td style={{ padding: "6px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>AED {fmtAED(r.totalAed)}</td>
                </tr>
              ))}
              <tr style={{ background: "#eee6cf" }}>
                <td colSpan={4} style={{ padding: "8px 6px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY }}>
                  Grand Total ({summary?.invoiceCount ?? 0} invoices)
                </td>
                <td style={{ padding: "8px 6px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY, textAlign: "right", whiteSpace: "nowrap" }}>
                  {fmtG(summary?.totalGrams)} g
                </td>
                <td style={{ border: `2px solid ${NAVY}` }} />
                <td style={{ padding: "8px 6px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY, textAlign: "right", whiteSpace: "nowrap" }}>
                  AED {fmtAED(summary?.totalAed)}
                </td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: "28px", display: "flex", justifyContent: "flex-end" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: "160px", borderTop: "1px solid #555", paddingTop: "4px", fontSize: "10px", color: "#333" }}>
                Authorised Signature
              </div>
            </div>
          </div>
          <div style={{ marginTop: "16px", paddingTop: "8px", borderTop: "1px solid #ccc", display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#777" }}>
            <div>Generated by {user?.fullName ?? "Admin"} on {format(new Date(), "dd/MM/yyyy hh:mm a")}</div>
            <div>{companyName} — Sales Statement</div>
          </div>
        </div>
      </div>
    </div>
  );
}
