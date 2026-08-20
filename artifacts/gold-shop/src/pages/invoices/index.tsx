import React, { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useListInvoices, getListInvoicesQueryKey,
  useGetSalesReport, getGetSalesReportQueryKey,
  useGetSettings, getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Plus, Search, Trash2, Eye, FileDown, Scale, Banknote, ReceiptText, Lock, LockOpen } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/auth";
import { STOCK_CATEGORIES, stockCategoryLabel } from "../products/stock";
import {
  decorateStatementPdf,
  GOLD,
  NAVY,
  STATEMENT_FINAL_FOOTER_SPACER,
  STATEMENT_FIRST_PAGE_SPACER,
  STATEMENT_PDF_MARGIN,
} from "@/components/pdf-branding";
import { InvoiceModeSelector } from "@/components/invoice-mode-selector";

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

  // Session-level unlock: paid (non-pending) invoices are protected by default.
  // The user must explicitly enable the toggle before deletion is allowed, then
  // confirm the exact invoice reference in a challenge dialog.
  const [paidDeleteUnlocked, setPaidDeleteUnlocked] = useState(false);
  const [deleteConfirmInvoice, setDeleteConfirmInvoice] = useState<{ id: number; ref: string } | null>(null);
  const [deleteChallenge, setDeleteChallenge] = useState("");

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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSalesReportQueryKey() });
  };

  const handleDelete = (id: number, invoiceNumber: string, isPending: boolean | undefined | null) => {
    // isPending === false → invoice is paid/closed and therefore protected
    const isPaid = isPending === false;
    if (isPaid) {
      if (!paidDeleteUnlocked) {
        toast({
          title: "Paid invoice is protected",
          description: "Enable the 'Unlock invoice deletion' toggle above the table before deleting a paid invoice.",
          variant: "destructive",
        });
        return;
      }
      // Paid + unlocked → open the challenge dialog
      setDeleteChallenge("");
      setDeleteConfirmInvoice({ id, ref: invoiceNumber });
      return;
    }
    if (!confirm(`Delete invoice ${invoiceNumber}? Deducted stock will be restored.`)) return;
    fetch(`${import.meta.env.BASE_URL}api/invoices/${id}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast({ title: "Invoice deleted successfully" });
      invalidate();
    }).catch(() => {
      toast({ title: "Failed to delete invoice", variant: "destructive" });
    });
  };

  const confirmDeletePaidInvoice = async () => {
    if (!deleteConfirmInvoice) return;
    if (deleteChallenge.trim() !== deleteConfirmInvoice.ref) {
      toast({ title: "Invoice number does not match", description: "Type the exact invoice number to confirm deletion.", variant: "destructive" });
      return;
    }
    const { id, ref } = deleteConfirmInvoice;
    setDeleteConfirmInvoice(null);
    setDeleteChallenge("");
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/invoices/${id}`, {
        method: "DELETE",
        headers: { "X-Allow-Invoice-Delete": "true" },
        credentials: "include",
      });
      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          if (typeof body?.error === "string") errorMsg = body.error;
        } catch { /* ignore */ }
        toast({ title: "Failed to delete invoice", description: errorMsg, variant: "destructive" });
        return;
      }
      toast({ title: "Paid invoice deleted", description: `Invoice ${ref} has been permanently removed.` });
      invalidate();
    } catch {
      toast({ title: "Failed to delete invoice", variant: "destructive" });
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

      const worker: any = html2pdf()
        .set({
          margin: [...STATEMENT_PDF_MARGIN],
          filename: `Sales-Statement_${catTag}_${format(new Date(), "yyyy-MM-dd")}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(reportRef.current)
        .toPdf()
        .get("pdf")
        .then(async (pdf: any) => {
          await decorateStatementPdf(pdf, {
            title: "Sales Statement",
            subtitle: criteriaLine,
            userName: user?.fullName ?? "Admin",
            columns: [
              { label: "Invoice #", width: 23 },
              { label: "Date", width: 20 },
              { label: "Customer", width: 35 },
              { label: "Category", width: 35 },
              { label: "Weight (g)", width: 24, align: "right" },
              { label: "Rate/Gram (AED)", width: 27, align: "right" },
              { label: "Total (AED)", width: 26, align: "right" },
            ],
          });
        });

      await worker.save();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary mb-2 sm:mb-4">Invoices</h1>
          <InvoiceModeSelector mode="retail" />
        </div>
        <Link href="/invoices/new" className="self-start sm:self-auto pb-4">
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

      {/* Session-level deletion unlock toggle — mirrors the purchase-bills pattern */}
      {isAdmin && (
        <div className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm ${paidDeleteUnlocked ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {paidDeleteUnlocked
              ? <LockOpen className="h-4 w-4 text-destructive shrink-0" />
              : <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
            }
            <span className="font-medium">Unlock invoice deletion</span>
            {paidDeleteUnlocked
              ? <span className="ml-2 text-destructive">Unlocked — paid invoices can be deleted</span>
              : <span className="ml-2 text-muted-foreground">Locked — paid invoices are protected from accidental deletion</span>
            }
          </div>
          <Switch
            checked={paidDeleteUnlocked}
            onCheckedChange={(checked) => {
              setPaidDeleteUnlocked(checked);
              if (!checked) { setDeleteConfirmInvoice(null); setDeleteChallenge(""); }
            }}
          />
        </div>
      )}
      {paidDeleteUnlocked && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <p><strong>Deletion unlocked.</strong> Deleting a paid invoice permanently removes the revenue record and reverses FIFO COGS. This cannot be undone.</p>
        </div>
      )}

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
                        invoice.isPending === false && !paidDeleteUnlocked ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground cursor-not-allowed"
                            title="Paid invoice is locked. Enable 'Unlock invoice deletion' to delete."
                            disabled
                          >
                            <Lock className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(invoice.id, invoice.invoiceNumber, invoice.isPending)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ─── Delete paid invoice confirmation dialog ─── */}
      <AlertDialog open={deleteConfirmInvoice != null} onOpenChange={(o) => { if (!o) { setDeleteConfirmInvoice(null); setDeleteChallenge(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete a paid invoice — this cannot be undone
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Invoice <strong className="text-foreground">{deleteConfirmInvoice?.ref}</strong> is a paid record. Deleting it will:
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Permanently erase this revenue record from financial history</li>
                  <li>Restore the deducted stock to inventory</li>
                  <li>Remove any FIFO COGS data associated with this invoice</li>
                </ul>
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-medium text-foreground">
                    Type the invoice number <strong>{deleteConfirmInvoice?.ref}</strong> to confirm:
                  </label>
                  <Input
                    value={deleteChallenge}
                    onChange={(e) => setDeleteChallenge(e.target.value)}
                    placeholder={deleteConfirmInvoice?.ref}
                    className="h-9 font-mono"
                    autoFocus
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteConfirmInvoice(null); setDeleteChallenge(""); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteChallenge.trim() !== deleteConfirmInvoice?.ref}
              onClick={(e) => { e.preventDefault(); confirmDeletePaidInvoice(); }}
            >
              Permanently delete invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden printable A4 sales statement (html2pdf source) */}
      <div style={{ position: "fixed", top: 0, left: "-9999px", width: "190mm" }}>
        <div ref={reportRef} style={{ width: "190mm", fontFamily: "Arial, sans-serif", color: "#222", background: "#fff", boxSizing: "border-box" }}>
          <div aria-hidden="true" style={{ height: STATEMENT_FIRST_PAGE_SPACER }} />
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", breakInside: "avoid" }}>
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
                  <tr key={`${r.invoiceId}-${idx}`} style={{ background: idx % 2 === 0 ? "#fff" : "#f7f7f7", breakInside: "avoid" }}>
                    <td style={{ padding: "6px", border: "1px solid #ddd", whiteSpace: "nowrap" }}>{r.invoiceNumber}</td>
                    <td style={{ padding: "6px", border: "1px solid #ddd", whiteSpace: "nowrap" }}>{format(new Date(r.date), "dd/MM/yyyy")}</td>
                    <td style={{ padding: "6px", border: "1px solid #ddd" }}>{r.customerName || "Walk-in Customer"}</td>
                    <td style={{ padding: "6px", border: "1px solid #ddd" }}>{rowCategoryDisplay(r)}</td>
                    <td style={{ padding: "6px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{fmtG(r.weightGrams)}</td>
                    <td style={{ padding: "6px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{fmtAED(r.ratePerGram)}</td>
                    <td style={{ padding: "6px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>AED {fmtAED(r.totalAed)}</td>
                  </tr>
                ))}
              </tbody>
              <tbody style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
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
                <tr aria-hidden="true">
                  <td colSpan={7} style={{ height: STATEMENT_FINAL_FOOTER_SPACER, padding: 0, border: 0 }} />
                </tr>
              </tbody>
            </table>
        </div>
      </div>
    </div>
  );
}
