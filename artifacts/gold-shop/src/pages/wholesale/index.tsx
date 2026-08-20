import React, { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  useGetWholesaleDashboard,
  getGetWholesaleDashboardQueryKey,
  useListWholesaleInvoices,
  getListWholesaleInvoicesQueryKey,
  useListWholesaleTraders,
  getListWholesaleTradersQueryKey,
  useDeleteWholesaleInvoice,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FileDown, Plus, Search, Eye, TrendingUp, Briefcase, FileText, Anchor, History, Key, CheckCircle, Scale, Trash2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { InvoiceModeSelector } from "@/components/invoice-mode-selector";
import { useAuth } from "@/context/auth";
import { WholesaleInvoicePreview } from "@/components/wholesale-invoice-preview";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

function fmtG(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function kg(n: number | undefined | null): string {
  return ((n ?? 0) / 1000).toFixed(3);
}

export default function WholesaleDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [traderId, setTraderId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [previewInvoiceId, setPreviewInvoiceId] = useState<number | null>(null);
  const [deleteInvoiceId, setDeleteInvoiceId] = useState<number | null>(null);

  const dashboardParams = { startDate: startDate || undefined, endDate: endDate || undefined };
  const { data: dashboard, isLoading: dashLoading } = useGetWholesaleDashboard(
    dashboardParams,
    { query: { queryKey: getGetWholesaleDashboardQueryKey(dashboardParams) } }
  );

  const invoiceParams = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    traderId: traderId !== "all" ? parseInt(traderId) : undefined,
    status: status !== "all" ? status as any : undefined,
  };

  const { data: invoices, isLoading: invoicesLoading } = useListWholesaleInvoices(
    invoiceParams,
    { query: { queryKey: getListWholesaleInvoicesQueryKey(invoiceParams) } }
  );

  const { data: traders } = useListWholesaleTraders(
    {},
    { query: { queryKey: getListWholesaleTradersQueryKey({}) } }
  );
  const deleteInvoice = useDeleteWholesaleInvoice();

  const handleDownloadPdf = () => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (traderId !== "all") params.set("traderId", traderId);
    if (status !== "all") params.set("status", status);

    window.open(`/api/wholesale/summary/pdf?${params.toString()}`, "_blank");
  };

  const handleDeleteConfirm = () => {
    if (deleteInvoiceId === null || !isAdmin) return;

    const invoiceNumber = invoiceToDelete?.invoiceNumber;
    deleteInvoice.mutate({ id: deleteInvoiceId }, {
      onSuccess: () => {
        setDeleteInvoiceId(null);
        setPreviewInvoiceId(null);
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = JSON.stringify(query.queryKey);
            return key.includes("/api/wholesale") || key.includes("/api/stock");
          },
        });
        toast({
          title: "Wholesale invoice deleted",
          description: invoiceNumber
            ? `${invoiceNumber} was removed and its stock and trader ledger movements were reversed.`
            : "The invoice was removed and its stock and trader ledger movements were reversed.",
        });
      },
      onError: (error: Error) => {
        toast({
          title: "Unable to delete wholesale invoice",
          description: error.message,
          variant: "destructive",
        });
      },
    });
  };

  const invoiceToDelete = invoices?.find(i => i.id === deleteInvoiceId);

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary mb-2 sm:mb-4">Wholesale &amp; Traders</h1>
          <InvoiceModeSelector mode="wholesale" />
        </div>
        <div className="flex gap-2 self-start sm:self-auto pb-4">
          <Button onClick={handleDownloadPdf} variant="outline">
            <FileDown className="w-4 h-4 mr-1.5" /> Summary PDF
          </Button>
          <Link href="/wholesale/new">
            <Button><Plus className="w-4 h-4 mr-1.5" /> Create Invoice</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Invoices</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold">{dashboard?.invoiceCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              {dashboard?.fixedInvoiceCount ?? 0} fixed, {dashboard?.unfixedInvoiceCount ?? 0} unfixed, {dashboard?.cashInvoiceCount ?? 0} cash
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Open Pure Grams</CardTitle>
            <Scale className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold text-amber-600">{fmtG(dashboard?.openPureGrams)} g</div>
            <p className="text-xs text-muted-foreground">Pending rate fix</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Fixed AED</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold">{fmtAED(dashboard?.totalFixedAed)}</div>
            <p className="text-xs text-muted-foreground">Settled value</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground">Traders</CardTitle>
            <Briefcase className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-xl font-bold">{dashboard?.traderCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">Active wholesale partners</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
            <CardTitle className="text-lg">Wholesale Invoices</CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-32">
                <Input type="date" className="h-8 text-xs" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <span className="text-xs text-muted-foreground">to</span>
              <div className="w-32">
                <Input type="date" className="h-8 text-xs" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <div className="w-40">
                <Select value={traderId} onValueChange={setTraderId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All Traders" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Traders</SelectItem>
                    {traders?.map(t => (
                      <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-32">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="All Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="partially_settled">Partially Settled</SelectItem>
                    <SelectItem value="settled">Settled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-28 text-xs font-semibold uppercase tracking-wider">Date</TableHead>
                <TableHead className="w-28 text-xs font-semibold uppercase tracking-wider">Invoice #</TableHead>
                <TableHead className="w-48 text-xs font-semibold uppercase tracking-wider">Trader</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider text-center">Type</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">Total Pure Wt</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">Open Pure Wt</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">Fixed AED</TableHead>
                <TableHead className="text-center text-xs font-semibold uppercase tracking-wider">Status</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoicesLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading invoices...</TableCell>
                </TableRow>
              ) : invoices?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No invoices found for this criteria.</TableCell>
                </TableRow>
              ) : (
                invoices?.map(inv => (
                  <TableRow key={inv.id} className="hover:bg-muted/10 group">
                    <TableCell className="font-medium text-xs whitespace-nowrap">
                      {format(new Date(`${inv.invoiceDate}T00:00:00`), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{inv.invoiceNumber}</TableCell>
                    <TableCell>
                      <div className="font-semibold text-sm truncate max-w-[200px]">{inv.traderName}</div>
                      {inv.traderId && (
                        <Link href={`/wholesale/traders/${inv.traderId}`} className="text-[10px] text-primary hover:underline">
                          View Ledger
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={inv.pricingType === "fixed" ? "default" : "outline"}
                        className={`text-[10px] tracking-wider ${inv.pricingType === "cash" ? "border-emerald-600/30 bg-emerald-50 text-emerald-700" : ""}`}
                      >
                        {inv.pricingType === "fixed" ? "Fixed Gold Pricing" : inv.pricingType === "cash" ? "Cash Payment" : "Unfixed Gold Delivery"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{fmtG(inv.totalPureGrams)} g</TableCell>
                    <TableCell className="text-right">
                      {inv.openPureGrams > 0 ? (
                        <span className="text-amber-600 font-bold">{fmtG(inv.openPureGrams)} g</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">{fmtAED(inv.settledAed)}</TableCell>
                    <TableCell className="text-center">
                      {inv.status === "open" && <Badge variant="outline" className="text-[10px] uppercase tracking-wider text-amber-600 border-amber-600/30">Open</Badge>}
                      {inv.status === "partially_settled" && <Badge variant="secondary" className="text-[10px] uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Partial</Badge>}
                      {inv.status === "settled" && <Badge variant="secondary" className="text-[10px] uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Settled</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-primary group-hover:bg-primary/10"
                          onClick={() => setPreviewInvoiceId(inv.id)}
                          aria-label={`Preview wholesale invoice ${inv.invoiceNumber}`}
                          title="Preview invoice"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive group-hover:bg-destructive/10"
                            onClick={() => setDeleteInvoiceId(inv.id)}
                            aria-label={`Delete wholesale invoice ${inv.invoiceNumber}`}
                            title="Delete invoice"
                          >
                            <Trash2 className="w-4 h-4" />
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
      </Card>

      <WholesaleInvoicePreview
        invoiceId={previewInvoiceId}
        onClose={() => setPreviewInvoiceId(null)}
        isAdmin={isAdmin}
        onDeleteClick={(id) => setDeleteInvoiceId(id)}
      />

      <AlertDialog open={deleteInvoiceId !== null} onOpenChange={(open) => !open && setDeleteInvoiceId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Delete Wholesale Invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete invoice <strong>{invoiceToDelete?.invoiceNumber}</strong>?
              This will permanently reverse all associated stock movements and trader ledger entries. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleDeleteConfirm();
              }}
              disabled={deleteInvoice.isPending}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleteInvoice.isPending ? "Deleting..." : "Delete Invoice"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
