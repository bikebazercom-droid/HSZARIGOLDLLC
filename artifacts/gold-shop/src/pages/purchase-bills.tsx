import React, { useState, useEffect } from "react";
import {
  useListPurchaseBills, getListPurchaseBillsQueryKey,
  useCreatePurchaseBill, useDeletePurchaseBill,
  useListStockSuppliers, getListStockSuppliersQueryKey,
  useListStockLevels, getListStockLevelsQueryKey,
  useListStockPurchases, getListStockPurchasesQueryKey,
  useGetSupplierLiability, getGetSupplierLiabilityQueryKey,
  useUpdatePurchaseBillPaymentStatus,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, FileDown, FilePlus2, Lock, LockOpen, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { STOCK_CATEGORIES, stockCategoryLabel } from "@/pages/products/stock";

function fmtG(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface LineDraft {
  category: string;
  grossWeight: string;
  purity: string;
  rate: string;
  making: string;
}
const emptyLine = (): LineDraft => ({ category: "gold", grossWeight: "", purity: "100", rate: "", making: "" });

function lineCalc(l: LineDraft) {
  const gross = parseFloat(l.grossWeight) || 0;
  const purity = parseFloat(l.purity) || 0;
  const rate = parseFloat(l.rate) || 0;
  const making = parseFloat(l.making) || 0;
  const pure = gross * (purity / 100);
  const total = gross * rate + making;
  return { gross, purity, rate, making, pure, total };
}

interface AuditLogEntry {
  id: number;
  actorId: number | null;
  entityType: string;
  entityId: number;
  action: string;
  billNo: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

interface AuditLogResponse {
  entries: AuditLogEntry[];
  totalCount: number;
  warnThreshold: number;
  capacityWarning: boolean;
  retentionMonths: number;
}

async function fetchAuditLog(baseUrl: string): Promise<AuditLogResponse> {
  const res = await fetch(`${baseUrl}api/purchase-bills/audit-log`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const AUDIT_LOG_QUERY_KEY = ["purchase-bills-audit-log"] as const;

const PAYMENT_LABEL: Record<string, string> = {
  paid: "Paid in Cash", unpaid: "Unpaid / Liability", unfixed: "Unfixed Balance",
};

const PAYMENT_OPTIONS = [
  { value: "paid", label: "Paid in Cash" },
  { value: "unpaid", label: "Unpaid / Liability" },
  { value: "unfixed", label: "Unfixed Balance" },
];

export default function PurchaseBillsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const baseUrl = import.meta.env.BASE_URL as string;
  const [open, setOpen] = useState(false);
  const [settleId, setSettleId] = useState<number | null>(null);
  const [settleStatus, setSettleStatus] = useState<"paid" | "unpaid" | "unfixed">("paid");
  const [fixingRate, setFixingRate] = useState("");
  const [showDowngradeConfirm, setShowDowngradeConfirm] = useState(false);
  const [deleteConfirmBill, setDeleteConfirmBill] = useState<{ id: number; ref: string } | null>(null);
  const [deleteAuditEntry, setDeleteAuditEntry] = useState<{ id: number; ref: string } | null>(null);
  const [auditDeletePendingId, setAuditDeletePendingId] = useState<number | null>(null);
  // Session-level unlock: paid bills are protected by default; user must explicitly
  // toggle this on to enable deletion (hard guard — server also enforces it).
  const [paidDeleteUnlocked, setPaidDeleteUnlocked] = useState(false);
  const [deleteChallenge, setDeleteChallenge] = useState("");

  // Client-side accumulator: tracks supplier names that received an unpaid/unfixed
  // bill in this session. Lets the warning fire instantly when the drawer reopens
  // for the same supplier, without waiting for the React Query cache to refresh.
  const [sessionLiableSuppliers, setSessionLiableSuppliers] = useState<Set<string>>(new Set());

  const { data: bills, isLoading } = useListPurchaseBills(undefined, {
    query: { queryKey: getListPurchaseBillsQueryKey(undefined), refetchOnWindowFocus: true, staleTime: 0 },
  });

  const { data: auditLogData, isLoading: auditLogLoading, refetch: refetchAuditLog } = useQuery<AuditLogResponse>({
    queryKey: AUDIT_LOG_QUERY_KEY,
    queryFn: () => fetchAuditLog(baseUrl),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const auditLog = auditLogData?.entries;

  // Permanently remove one audit-log entry (no trace kept anywhere).
  const handleDeleteAuditEntry = async (id: number) => {
    setAuditDeletePendingId(id);
    try {
      const res = await fetch(`${baseUrl}api/purchase-bills/audit-log/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Audit entry permanently deleted" });
      await queryClient.invalidateQueries({ queryKey: AUDIT_LOG_QUERY_KEY });
    } catch {
      toast({ title: "Failed to delete audit entry", variant: "destructive" });
    } finally {
      setAuditDeletePendingId(null);
      setDeleteAuditEntry(null);
    }
  };
  const { data: liability, isLoading: liabilityLoading } = useGetSupplierLiability({
    query: { queryKey: getGetSupplierLiabilityQueryKey(), refetchOnWindowFocus: true, staleTime: 0 },
  });
  const { data: suppliers } = useListStockSuppliers({ query: { queryKey: getListStockSuppliersQueryKey() } });
  const createBill = useCreatePurchaseBill();
  const deleteBill = useDeletePurchaseBill();
  const updatePaymentStatus = useUpdatePurchaseBillPaymentStatus();

  // Reconcile session accumulator against fresh server liability data.
  // Runs whenever the liability query result changes (e.g. after a refetch
  // triggered by page-focus, a cross-tab settle, or an explicit invalidation).
  // Any supplier that the server no longer considers liable is pruned from the
  // accumulator so stale warnings never linger after the liability is gone.
  useEffect(() => {
    if (!liability) return;
    setSessionLiableSuppliers((prev) => {
      if (prev.size === 0) return prev;
      const stillLiable = new Set(
        liability.rows
          .filter((r) => r.unpaidCount > 0 || r.unfixedCount > 0)
          .map((r) => r.supplierName.toLowerCase())
      );
      const next = new Set([...prev].filter((key) => stillLiable.has(key)));
      // Avoid a re-render if nothing actually changed.
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [liability]);

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(todayStr);
  const [supplierName, setSupplierName] = useState("");
  const [purchaseType, setPurchaseType] = useState<"fixed" | "unfixed">("fixed");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "unpaid" | "unfixed">("paid");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  // Unfixed purchases are created without pricing: rate/making/total stay 0
  // and only the weights are captured. Pricing is fixed later at settlement.
  const isUnfixedForm = purchaseType === "unfixed";
  const calc = lines.map(lineCalc).map((c) => (isUnfixedForm ? { ...c, rate: 0, making: 0, total: 0 } : c));
  const totals = {
    gross: calc.reduce((s, c) => s + c.gross, 0),
    pure: calc.reduce((s, c) => s + c.pure, 0),
    aed: calc.reduce((s, c) => s + c.total, 0),
  };

  const resetForm = () => {
    setBillNo(""); setBillDate(todayStr); setSupplierName("");
    setPurchaseType("fixed"); setPaymentStatus("paid"); setNotes("");
    setLines([emptyLine()]);
  };

  const invalidate = (includeAuditLog = false) => {
    queryClient.invalidateQueries({ queryKey: getListPurchaseBillsQueryKey(undefined) });
    queryClient.invalidateQueries({ queryKey: getGetSupplierLiabilityQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockLevelsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockPurchasesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockSuppliersQueryKey() });
    if (includeAuditLog) refetchAuditLog();
  };

  const handleSave = () => {
    if (!billNo.trim()) { toast({ title: "Bill No / Ref is required", variant: "destructive" }); return; }
    if (!supplierName.trim()) { toast({ title: "Supplier name is required", variant: "destructive" }); return; }
    for (let i = 0; i < lines.length; i++) {
      const c = calc[i];
      if (!(c.gross > 0)) { toast({ title: `Line ${i + 1}: enter a valid gross weight`, variant: "destructive" }); return; }
      if (!(c.purity > 0 && c.purity <= 100)) { toast({ title: `Line ${i + 1}: purity must be between 0 and 100`, variant: "destructive" }); return; }
      if (!isUnfixedForm && (!(c.rate >= 0) || lines[i].rate === "")) { toast({ title: `Line ${i + 1}: enter the purchase rate`, variant: "destructive" }); return; }
    }
    createBill.mutate({
      data: {
        billNo: billNo.trim(),
        billDate,
        supplierName: supplierName.trim(),
        purchaseType,
        paymentStatus,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: lines.map((l, i) => ({
          category: l.category as any,
          grossWeightGrams: calc[i].gross,
          purityPercent: calc[i].purity,
          rateAedPerG: calc[i].rate,
          makingChargeAed: calc[i].making,
          lineTotalAed: Math.round(calc[i].total * 100) / 100,
        })),
      },
    }, {
      onSuccess: (bill) => {
        toast({ title: `Purchase bill ${bill.billNo} saved`, description: `${fmtG(bill.totalGrossGrams)} g · AED ${fmtAED(bill.totalAed)} posted to stock & ledgers` });
        // Track this supplier immediately in the session accumulator so the warning
        // fires the next time the drawer opens for them — before the server query refreshes.
        if (bill.paymentStatus === "unpaid" || bill.paymentStatus === "unfixed") {
          setSessionLiableSuppliers((prev) => new Set(prev).add(bill.supplierName.toLowerCase()));
        }
        invalidate();
        resetForm();
        setOpen(false);
      },
      onError: (e: any) => toast({ title: "Failed to save bill", description: e?.message, variant: "destructive" }),
    });
  };

  const handleDelete = (id: number, ref: string, paymentStatus: string) => {
    if (paymentStatus === "paid") {
      if (!paidDeleteUnlocked) {
        toast({
          title: "Paid bill is protected",
          description: "Enable the 'Unlock paid bill deletion' toggle above the table before deleting a settled bill.",
          variant: "destructive",
        });
        return;
      }
      // Paid + unlocked → open the challenge dialog
      setDeleteChallenge("");
      setDeleteConfirmBill({ id, ref });
      return;
    }
    if (!confirm(`Delete bill ${ref}? Its stock batches will be removed and stock reduced accordingly.`)) return;
    deleteBill.mutate({ id }, {
      onSuccess: () => { toast({ title: "Bill deleted" }); invalidate(true); },
      onError: () => toast({ title: "Failed to delete bill", variant: "destructive" }),
    });
  };

  const confirmDeletePaidBill = async () => {
    if (!deleteConfirmBill) return;
    if (deleteChallenge.trim() !== deleteConfirmBill.ref) {
      toast({ title: "Bill number does not match", description: "Type the exact bill number to confirm deletion.", variant: "destructive" });
      return;
    }
    const billRef = deleteConfirmBill.ref;
    const billId = deleteConfirmBill.id;
    // Close the dialog immediately so the user isn't left waiting with it open.
    setDeleteConfirmBill(null);
    setDeleteChallenge("");
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}api/purchase-bills/${billId}`, {
        method: "DELETE",
        headers: { "X-Allow-Paid-Delete": "true" },
        credentials: "include",
      });
      if (!response.ok) {
        let errorMsg = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          if (typeof body?.error === "string") errorMsg = body.error;
        } catch { /* ignore parse errors */ }
        toast({ title: "Failed to delete bill", description: errorMsg, variant: "destructive" });
        return;
      }
      toast({ title: "Paid bill deleted", description: `Bill ${billRef} has been permanently removed.` });
      invalidate(true);
    } catch (err: any) {
      toast({ title: "Failed to delete bill", description: err?.message ?? "Network error", variant: "destructive" });
    }
  };

  const openSettle = (id: number, currentStatus: string) => {
    setSettleId(id);
    setSettleStatus(currentStatus === "paid" ? "paid" : currentStatus === "unfixed" ? "unfixed" : "unpaid");
    setFixingRate("");
  };

  const handleSettle = () => {
    if (settleId == null) return;
    // Settling an unfixed bill to paid can carry a fixing rate: server reprices
    // every line (pure weight x rate) and updates bill/stock/ledger atomically.
    const isFixingSettlement =
      settlingBill?.paymentStatus === "unfixed" && settleStatus === "paid";
    const rateNum = parseFloat(fixingRate);
    if (isFixingSettlement && !(rateNum > 0)) {
      toast({ title: "Enter the fixing rate (AED/g)", description: "The rate is required to settle an unfixed bill.", variant: "destructive" });
      return;
    }
    updatePaymentStatus.mutate({
      id: settleId,
      data: {
        paymentStatus: settleStatus,
        ...(isFixingSettlement ? { fixingRateAedPerG: rateNum } : {}),
      },
    }, {
      onSuccess: (bill) => {
        toast({ title: `Bill ${bill.billNo} updated to "${PAYMENT_LABEL[bill.paymentStatus]}"` });

        // Immediately flip the badge in the table without waiting for the invalidation
        // refetch — setQueryData makes the change visible in the same render cycle.
        queryClient.setQueryData(
          getListPurchaseBillsQueryKey(undefined),
          (old: typeof bills) =>
            old?.map((b) => b.id === bill.id ? { ...b, paymentStatus: bill.paymentStatus } : b),
        );

        // If the bill was settled to "paid", check whether this supplier still has any
        // other unpaid/unfixed bills. If not, remove them from the session accumulator
        // so the warning no longer fires when the new-bill drawer is opened for them.
        if (bill.paymentStatus === "paid") {
          const supplierKey = bill.supplierName.toLowerCase();
          if (sessionLiableSuppliers.has(supplierKey)) {
            const otherOutstanding = bills?.some(
              (b) => b.id !== bill.id &&
                b.supplierName.toLowerCase() === supplierKey &&
                (b.paymentStatus === "unpaid" || b.paymentStatus === "unfixed")
            );
            if (!otherOutstanding) {
              setSessionLiableSuppliers((prev) => {
                const next = new Set(prev);
                next.delete(supplierKey);
                return next;
              });
            }
          }
        }
        // includeAuditLog=true so the Audit Log tab immediately reflects the change.
        invalidate(true);
        setSettleId(null);
      },
      onError: (e: any) => {
        toast({ title: "Failed to update status", description: e?.message, variant: "destructive" });
        // Reset the select back to the bill's actual server-side status so the
        // sheet doesn't keep showing the failed attempted value.
        if (settlingBill) {
          setSettleStatus(
            settlingBill.paymentStatus === "paid" ? "paid"
            : settlingBill.paymentStatus === "unfixed" ? "unfixed"
            : "unpaid",
          );
        }
      },
    });
  };

  const settlingBill = settleId != null ? bills?.find((b) => b.id === settleId) : null;

  const hasOutstanding = liability != null && (liability.totalUnpaidAed > 0 || liability.totalUnfixedPureGrams > 0);

  // Warning: does the supplier typed in the new-bill form already have open liabilities?
  // We check both the server-side liability data (React Query cache) AND the client-side
  // session accumulator so the warning fires immediately after saving a bill in the same
  // session, even before the cache has refreshed.
  const trimmedSupplier = supplierName.trim();
  const supplierLiabilityRow = trimmedSupplier
    ? liability?.rows.find((r) => r.supplierName.toLowerCase() === trimmedSupplier.toLowerCase())
    : undefined;
  const supplierHasLiability =
    (supplierLiabilityRow != null &&
      (supplierLiabilityRow.unpaidCount > 0 || supplierLiabilityRow.unfixedCount > 0)) ||
    (trimmedSupplier !== "" && sessionLiableSuppliers.has(trimmedSupplier.toLowerCase()));

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-2xl font-bold">Purchase Bills</h1>
          <p className="text-sm text-muted-foreground">Supplier bills (fixed & unfixed) — each line posts stock + supplier ledger entries.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> New Purchase Bill
        </Button>
      </div>

      <Tabs defaultValue="bills">
        <TabsList>
          <TabsTrigger value="bills">All Bills</TabsTrigger>
          <TabsTrigger value="liability" className="relative">
            Supplier Liability
            {hasOutstanding && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-destructive w-2 h-2" />
            )}
          </TabsTrigger>
          <TabsTrigger value="audit-log" className="relative" onClick={() => refetchAuditLog()}>
            <ShieldAlert className="w-3.5 h-3.5 mr-1.5" />
            Audit Log
          </TabsTrigger>
        </TabsList>

        {/* ─── All Bills tab ─── */}
        <TabsContent value="bills">
          {/* Paid-bill deletion lock toggle */}
          <div className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 mb-3 text-sm ${paidDeleteUnlocked ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"}`}>
            <div className="flex items-center gap-2">
              {paidDeleteUnlocked
                ? <LockOpen className="h-4 w-4 text-destructive shrink-0" />
                : <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
              }
              <div>
                <span className="font-medium">Paid bill deletion</span>
                {paidDeleteUnlocked
                  ? <span className="ml-2 text-destructive font-semibold">UNLOCKED — deletion is enabled for this session</span>
                  : <span className="ml-2 text-muted-foreground">Locked — paid bills are protected from accidental deletion</span>
                }
              </div>
            </div>
            <Switch
              checked={paidDeleteUnlocked}
              onCheckedChange={(checked) => {
                setPaidDeleteUnlocked(checked);
                if (!checked) setDeleteConfirmBill(null);
              }}
              aria-label="Unlock paid bill deletion"
            />
          </div>
          {paidDeleteUnlocked && (
            <div className="flex gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 mb-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <strong>Deletion unlocked.</strong> Deleting a paid bill permanently removes settled financial records
                and reverses stock batches. A bill-number confirmation is required for each deletion.
                Turn off the toggle when done.
              </p>
            </div>
          )}
          <div className="bg-card rounded-md border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-4">Bill Date</TableHead>
                    <TableHead>Bill No / Ref</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Gross Wt (g)</TableHead>
                    <TableHead className="text-right">Pure Wt (g)</TableHead>
                    <TableHead className="text-right">Total (AED)</TableHead>
                    <TableHead className="text-right pr-4">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={9} className="h-24 text-center">Loading...</TableCell></TableRow>
                  ) : !bills || bills.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="h-24 text-center text-muted-foreground">No purchase bills recorded yet.</TableCell></TableRow>
                  ) : (
                    bills.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="pl-4 whitespace-nowrap">{b.billDate}</TableCell>
                        <TableCell className="font-medium">{b.billNo}</TableCell>
                        <TableCell>{b.supplierName}</TableCell>
                        <TableCell>
                          <Badge variant={b.purchaseType === "fixed" ? "default" : "secondary"}>
                            {b.purchaseType === "fixed" ? "Fixed" : "Unfixed"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={b.paymentStatus === "paid" ? "outline" : "destructive"}>
                            {PAYMENT_LABEL[b.paymentStatus] ?? b.paymentStatus}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">{fmtG(b.totalGrossGrams)}</TableCell>
                        <TableCell className="text-right">{fmtG(b.totalPureGrams)}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtAED(b.totalAed)}</TableCell>
                        <TableCell className="text-right pr-4 whitespace-nowrap">
                          {(b.paymentStatus !== "paid" || b.id === settleId) && (
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:text-green-700"
                              title="Update payment status"
                              onClick={() => openSettle(b.id, b.paymentStatus)}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="icon" className="h-8 w-8" title="Download bill PDF"
                            onClick={() => window.open(`${import.meta.env.BASE_URL}api/purchase-bills/${b.id}/pdf`, "_blank")}
                          >
                            <FileDown className="h-4 w-4" />
                          </Button>
                          {b.paymentStatus === "paid" && !paidDeleteUnlocked ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground/40 cursor-not-allowed">
                                    <Lock className="h-4 w-4" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="max-w-[220px] text-center">
                                  Paid bills are protected. Enable "Unlock paid bill deletion" above the table to allow deletion.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(b.id, b.billNo, b.paymentStatus)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ─── Supplier Liability tab ─── */}
        <TabsContent value="liability">
          {liabilityLoading ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">Loading...</div>
          ) : !liability || liability.rows.length === 0 ? (
            <div className="rounded-md border bg-card p-8 text-center space-y-2">
              <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />
              <p className="font-semibold">All clear — no outstanding supplier liabilities.</p>
              <p className="text-sm text-muted-foreground">All purchase bills are marked as paid.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Toolbar */}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(`${import.meta.env.BASE_URL}api/purchase-bills/supplier-liability/pdf`, "_blank")}
                >
                  <FileDown className="w-4 h-4 mr-1.5" /> Download PDF
                </Button>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-md border bg-card p-4 space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Unpaid (Cash)</p>
                  <p className="text-2xl font-bold text-destructive">AED {fmtAED(liability.totalUnpaidAed)}</p>
                  <p className="text-xs text-muted-foreground">{liability.rows.reduce((s, r) => s + r.unpaidCount, 0)} unpaid bill(s)</p>
                </div>
                <div className="rounded-md border bg-card p-4 space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Unfixed (Metal)</p>
                  <p className="text-2xl font-bold text-amber-600">{fmtG(liability.totalUnfixedPureGrams)} g</p>
                  <p className="text-xs text-muted-foreground">{liability.rows.reduce((s, r) => s + r.unfixedCount, 0)} unfixed bill(s)</p>
                </div>
              </div>

              {/* Per-supplier breakdown */}
              <div className="bg-card rounded-md border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-4">Supplier</TableHead>
                        <TableHead className="text-right">Unpaid Bills</TableHead>
                        <TableHead className="text-right">Unpaid (AED)</TableHead>
                        <TableHead className="text-right">Unfixed Bills</TableHead>
                        <TableHead className="text-right">Unfixed (Pure g)</TableHead>
                        <TableHead className="text-right pr-4">Settle</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {liability.rows.map((row) => {
                        const supplierBills = bills?.filter((b) => row.billIds.includes(b.id)) ?? [];
                        return (
                          <TableRow key={row.supplierName}>
                            <TableCell className="pl-4 font-semibold">{row.supplierName}</TableCell>
                            <TableCell className="text-right">
                              {row.unpaidCount > 0 ? (
                                <Badge variant="destructive">{row.unpaidCount}</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {row.unpaidCount > 0 ? `AED ${fmtAED(row.unpaidTotalAed)}` : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.unfixedCount > 0 ? (
                                <Badge variant="secondary" className="bg-amber-100 text-amber-800">{row.unfixedCount}</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {row.unfixedCount > 0 ? `${fmtG(row.unfixedPureGrams)} g` : "—"}
                            </TableCell>
                            <TableCell className="text-right pr-4">
                              <div className="flex gap-1 justify-end flex-wrap">
                                {supplierBills.map((b) => (
                                  <Button
                                    key={b.id}
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => openSettle(b.id, b.paymentStatus)}
                                  >
                                    {b.billNo}
                                  </Button>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Click a bill number above to update its payment status and remove it from the liability report.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ─── Audit Log tab ─── */}
        <TabsContent value="audit-log">
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p>
                This log records all significant actions — including invoice creations (and backdated invoices),
                invoice deletions, purchase bill deletions, and payment-status changes. Entries cannot be edited,
                but an admin can permanently delete an entry.{" "}
                {auditLogData && (
                  <span>
                    Entries older than {auditLogData.retentionMonths} months are automatically pruned daily.
                    {auditLogData.totalCount > 0 && (
                      <> {auditLogData.totalCount.toLocaleString("en-AE")} total entries stored.</>
                    )}
                  </span>
                )}
              </p>
            </div>

            {/* Capacity warning banner */}
            {auditLogData?.capacityWarning && (
              <div className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p>
                  <strong>Audit log capacity warning:</strong> The log has{" "}
                  {auditLogData.totalCount.toLocaleString("en-AE")} entries, which exceeds the{" "}
                  {auditLogData.warnThreshold.toLocaleString("en-AE")}-entry warning threshold. The daily
                  automatic cleanup removes entries older than {auditLogData.retentionMonths} months. If
                  entries are accumulating faster than they are pruned, consider reducing{" "}
                  <code className="font-mono text-xs">AUDIT_LOG_RETENTION_MONTHS</code> or{" "}
                  <code className="font-mono text-xs">AUDIT_LOG_WARN_THRESHOLD</code> in your environment
                  configuration.
                </p>
              </div>
            )}

            {auditLogLoading ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground">Loading…</div>
            ) : !auditLog || auditLog.length === 0 ? (
              <div className="rounded-md border bg-card p-8 text-center space-y-2">
                <CheckCircle2 className="mx-auto h-8 w-8 text-green-500" />
                <p className="font-semibold">No audit events yet.</p>
                <p className="text-sm text-muted-foreground">Payment-status changes and bill deletions will appear here.</p>
              </div>
            ) : (
              <div className="bg-card rounded-md border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-4">Timestamp</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Party</TableHead>
                        <TableHead>Details</TableHead>
                        <TableHead className="text-right">Total (AED)</TableHead>
                        <TableHead className="text-right">Actor</TableHead>
                        <TableHead className="text-right pr-4 w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLog.map((entry) => {
                        const d = entry.details as Record<string, unknown>;
                        const isInvoice = entry.entityType === "invoice";
                        const isStatusChange = entry.action === "update_payment_status";
                        const isCreate = entry.action === "create";
                        const isDelete = entry.action === "delete";
                        const isRetentionPrune = entry.action === "retention_prune";
                        // Actor name: create events store createdByUserName, delete events store deletedByUserName.
                        const actorNameFromDetails = isCreate
                          ? (typeof d.createdByUserName === "string" ? d.createdByUserName : null)
                          : isDelete
                            ? (typeof d.deletedByUserName === "string" ? d.deletedByUserName : null)
                            : null;
                        const actorLabel = isRetentionPrune
                          ? "system"
                          : actorNameFromDetails ?? (entry.actorId != null ? `#${entry.actorId}` : "unknown");
                        // "Party" is supplier for bill events, customer for invoice events.
                        const partyLabel = isInvoice
                          ? (typeof d.customerName === "string" ? d.customerName : "—")
                          : (typeof d.supplierName === "string" ? d.supplierName : "—");
                        // Total: invoices store numeric `total`, bills store `totalAed`.
                        const totalRaw = isInvoice ? d.total : d.totalAed;
                        // Backdated metadata (invoice create events only).
                        const isBackdated = isInvoice && isCreate && d.backdated === true;
                        const suppliedDateStr = isBackdated && typeof d.suppliedCreatedAt === "string"
                          ? (() => {
                              try { return format(new Date(d.suppliedCreatedAt), "dd MMM yyyy"); }
                              catch { return null; }
                            })()
                          : null;
                        return (
                          <TableRow key={entry.id} className={isRetentionPrune ? "bg-slate-50/60" : undefined}>
                            <TableCell className="pl-4 whitespace-nowrap text-xs text-muted-foreground">
                              {new Date(entry.createdAt).toLocaleString("en-AE")}
                            </TableCell>
                            <TableCell>
                              {isRetentionPrune ? (
                                <Badge className="uppercase text-xs tracking-wide bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-100">
                                  Auto-Pruned
                                </Badge>
                              ) : isStatusChange ? (
                                <Badge className="uppercase text-xs tracking-wide bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100">
                                  Status Changed
                                </Badge>
                              ) : isInvoice && isCreate ? (
                                <span className="inline-flex items-center gap-1.5 flex-wrap">
                                  <Badge className="uppercase text-xs tracking-wide bg-green-100 text-green-800 border-green-300 hover:bg-green-100">
                                    <FilePlus2 className="mr-1 h-3 w-3" />
                                    Invoice Created
                                  </Badge>
                                  {isBackdated && (
                                    <Badge className="text-xs bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-100">
                                      Backdated{suppliedDateStr ? ` · ${suppliedDateStr}` : ""}
                                    </Badge>
                                  )}
                                </span>
                              ) : isInvoice && isDelete ? (
                                <Badge variant="destructive" className="uppercase text-xs tracking-wide bg-red-700 hover:bg-red-700">
                                  Invoice Deleted
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="uppercase text-xs tracking-wide">
                                  {entry.action}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="font-medium">{entry.billNo ?? "—"}</TableCell>
                            <TableCell>{isRetentionPrune ? "—" : partyLabel}</TableCell>
                            <TableCell className="text-sm">
                              {isRetentionPrune ? (
                                typeof d.deletedCount === "number" ? (
                                  <span className="text-muted-foreground">
                                    {d.deletedCount.toLocaleString("en-AE")} entries removed
                                    {typeof d.retentionMonths === "number" ? ` (older than ${d.retentionMonths} months)` : ""}
                                  </span>
                                ) : "Automatic retention cleanup"
                              ) : isStatusChange ? (
                                typeof d.from === "string" && typeof d.to === "string" ? (
                                  <span>
                                    <span className="text-muted-foreground">{PAYMENT_LABEL[d.from] ?? d.from}</span>
                                    {" → "}
                                    <span className="font-medium">{PAYMENT_LABEL[d.to] ?? d.to}</span>
                                  </span>
                                ) : "—"
                              ) : isInvoice && isCreate ? (
                                typeof d.paymentMethod === "string"
                                  ? `Payment: ${d.paymentMethod}`
                                  : "—"
                              ) : isInvoice && isDelete ? (
                                typeof d.paymentMethod === "string"
                                  ? `Payment: ${d.paymentMethod}`
                                  : "Deleted"
                              ) : (
                                typeof d.paymentStatus === "string"
                                  ? `Was: ${PAYMENT_LABEL[d.paymentStatus] ?? d.paymentStatus}`
                                  : "—"
                              )}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {isRetentionPrune ? "—" : (
                                typeof totalRaw === "string" || typeof totalRaw === "number"
                                  ? fmtAED(Number(totalRaw))
                                  : "—"
                              )}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">
                              {actorLabel}
                            </TableCell>
                            <TableCell className="text-right pr-4">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-red-600"
                                title="Permanently delete this entry"
                                disabled={auditDeletePendingId === entry.id}
                                onClick={() => setDeleteAuditEntry({ id: entry.id, ref: entry.billNo ?? `#${entry.id}` })}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ─── Permanently delete audit entry confirm ─── */}
      <AlertDialog open={deleteAuditEntry != null} onOpenChange={(o) => { if (!o && auditDeletePendingId == null) setDeleteAuditEntry(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" />
              Permanently delete audit entry?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Entry for <strong>{deleteAuditEntry?.ref}</strong> will be removed forever. No record of this
              entry — or of its deletion — will remain anywhere. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={auditDeletePendingId != null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={auditDeletePendingId != null}
              onClick={(e) => {
                e.preventDefault();
                if (deleteAuditEntry) void handleDeleteAuditEntry(deleteAuditEntry.id);
              }}
            >
              {auditDeletePendingId != null ? "Deleting..." : "Delete Forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Settle / update payment status sheet ─── */}
      <Sheet open={settleId != null} onOpenChange={(o) => { if (!o) setSettleId(null); }}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Update Payment Status</SheetTitle>
            <SheetDescription>
              {settlingBill ? (
                <>Bill <strong>{settlingBill.billNo}</strong> · {settlingBill.supplierName} · AED {fmtAED(settlingBill.totalAed)}</>
              ) : "Update the payment status of this purchase bill."}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label>New Payment Status</Label>
              <Select value={settleStatus} onValueChange={(v) => setSettleStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Fixing-rate input: only when settling an unfixed bill to paid */}
            {settlingBill?.paymentStatus === "unfixed" && settleStatus === "paid" && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
                <Label className="text-amber-900">Fixing Rate (AED/g)</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={fixingRate}
                  onChange={(e) => setFixingRate(e.target.value)}
                  placeholder="e.g. 470.00"
                  className="bg-white"
                />
                <div className="text-xs text-amber-800 space-y-0.5">
                  <p>
                    Net Pure Weight: <span className="font-semibold">{fmtG(settlingBill.totalPureGrams)} g</span>
                  </p>
                  <p>
                    Total Settled Amount:{" "}
                    <span className="font-bold">
                      AED {fmtAED(parseFloat(fixingRate) > 0 ? settlingBill.totalPureGrams * parseFloat(fixingRate) : 0)}
                    </span>
                  </p>
                  <p className="text-amber-700">
                    On save, the bill's rate and totals are fixed at this rate and the cash debit posts to the supplier ledger.
                  </p>
                </div>
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => {
                // Downgrading a paid bill back to unpaid/unfixed needs confirmation
                if (
                  settlingBill?.paymentStatus === "paid" &&
                  (settleStatus === "unpaid" || settleStatus === "unfixed")
                ) {
                  setShowDowngradeConfirm(true);
                } else {
                  handleSettle();
                }
              }}
              disabled={updatePaymentStatus.isPending || settleStatus === settlingBill?.paymentStatus}
            >
              {updatePaymentStatus.isPending ? "Saving..." : "Save Status"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ─── Downgrade-from-paid confirmation dialog ─── */}
      <AlertDialog open={showDowngradeConfirm} onOpenChange={setShowDowngradeConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Reopen a settled bill?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  You are changing bill <strong className="text-foreground">{settlingBill?.billNo}</strong> from{" "}
                  <strong className="text-foreground">Paid in Cash</strong> back to{" "}
                  <strong className="text-foreground">{PAYMENT_LABEL[settleStatus]}</strong>.
                </p>
                <p>
                  This will re-add the bill to the supplier liability report and it will
                  appear as an outstanding obligation until it is marked paid again.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setShowDowngradeConfirm(false);
                handleSettle();
              }}
            >
              Yes, reopen bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Delete paid bill confirmation dialog ─── */}
      <AlertDialog open={deleteConfirmBill != null} onOpenChange={(o) => { if (!o) { setDeleteConfirmBill(null); setDeleteChallenge(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete a settled bill — this cannot be undone
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Bill <strong className="text-foreground">{deleteConfirmBill?.ref}</strong> is marked{" "}
                  <strong className="text-foreground">Paid in Cash</strong>. Deleting it will:
                </p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Permanently erase this settled payment record from financial history</li>
                  <li>Reverse the linked stock batches and reduce inventory accordingly</li>
                  <li>Remove any FIFO cost data associated with this purchase</li>
                </ul>
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-medium text-foreground">
                    Type the bill number <strong>{deleteConfirmBill?.ref}</strong> to confirm:
                  </label>
                  <Input
                    value={deleteChallenge}
                    onChange={(e) => setDeleteChallenge(e.target.value)}
                    placeholder={deleteConfirmBill?.ref}
                    className="h-9 font-mono"
                    autoFocus
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setDeleteConfirmBill(null); setDeleteChallenge(""); }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteChallenge.trim() !== deleteConfirmBill?.ref}
              onClick={(e) => { e.preventDefault(); confirmDeletePaidBill(); }}
            >
              Permanently delete bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── New purchase bill sheet ─── */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>New Purchase Bill</SheetTitle>
            <SheetDescription>Record a supplier bill. Each line item creates a stock batch and posts Metal Credit + Cash Debit to the ledgers.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Bill No / Ref</Label>
                <Input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="e.g. SUP-1042" />
              </div>
              <div className="space-y-1.5">
                <Label>Bill Date</Label>
                <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Supplier Name</Label>
                <Input list="bill-supplier-names" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="e.g. Rahim" />
                <datalist id="bill-supplier-names">
                  {suppliers?.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label>Purchase Type</Label>
                <Select value={purchaseType} onValueChange={(v) => {
                  setPurchaseType(v as any);
                  // Unfixed purchases start as an unfixed metal liability by default.
                  if (v === "unfixed") setPaymentStatus("unfixed");
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed Purchase</SelectItem>
                    <SelectItem value="unfixed">Unfixed Purchase</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Payment Status</Label>
                <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid in Cash</SelectItem>
                    <SelectItem value="unpaid">Unpaid / Liability</SelectItem>
                    <SelectItem value="unfixed">Unfixed Balance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Notes (optional)</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional note" />
              </div>
            </div>

            {supplierHasLiability && (
              <div className="flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div className="space-y-0.5">
                  <p className="font-semibold">This supplier has outstanding liabilities</p>
                  {supplierLiabilityRow ? (
                    <p className="text-amber-800">
                      {supplierLiabilityRow.unpaidCount > 0 && (
                        <span>{supplierLiabilityRow.unpaidCount} unpaid bill{supplierLiabilityRow.unpaidCount > 1 ? "s" : ""} — AED {fmtAED(supplierLiabilityRow.unpaidTotalAed)}</span>
                      )}
                      {supplierLiabilityRow.unpaidCount > 0 && supplierLiabilityRow.unfixedCount > 0 && <span className="mx-1">·</span>}
                      {supplierLiabilityRow.unfixedCount > 0 && (
                        <span>{supplierLiabilityRow.unfixedCount} unfixed bill{supplierLiabilityRow.unfixedCount > 1 ? "s" : ""} — {fmtG(supplierLiabilityRow.unfixedPureGrams)} g pure</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-amber-800">An unpaid or unfixed bill was added for this supplier earlier in this session.</p>
                  )}
                  <p className="text-xs text-amber-700">Consider settling open balances before adding more.</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line Items</Label>
                <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Line
                </Button>
              </div>
              <div className="space-y-3">
                {lines.map((l, i) => {
                  const c = calc[i];
                  return (
                    <div key={i} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">Line {i + 1}</span>
                        {lines.length > 1 && (
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Category</Label>
                          <Select value={l.category} onValueChange={(v) => setLine(i, { category: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {STOCK_CATEGORIES.map((cat) => <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Gross Wt (g)</Label>
                          <Input className="h-9" type="number" min="0" step="any" value={l.grossWeight} onChange={(e) => setLine(i, { grossWeight: e.target.value })} placeholder="100" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Purity % / Touch</Label>
                          <Input className="h-9" type="number" min="0" max="100" step="any" value={l.purity} onChange={(e) => setLine(i, { purity: e.target.value })} placeholder="91.6" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Rate (AED/g)</Label>
                          <Input className="h-9" type="number" min="0" step="any" value={isUnfixedForm ? "" : l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder={isUnfixedForm ? "Fixed later" : "470"} disabled={isUnfixedForm} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Making / Premium (AED)</Label>
                          <Input className="h-9" type="number" min="0" step="any" value={isUnfixedForm ? "" : l.making} onChange={(e) => setLine(i, { making: e.target.value })} placeholder={isUnfixedForm ? "Fixed later" : "0"} disabled={isUnfixedForm} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                        <span>Net Pure Weight: <span className="font-semibold text-foreground">{fmtG(c.pure)} g</span></span>
                        {isUnfixedForm ? (
                          <span>Line Total: <span className="font-semibold text-foreground">AED 0.00 (unfixed — rate set at settlement)</span></span>
                        ) : (
                          <span>Line Total: <span className="font-semibold text-foreground">AED {fmtAED(c.total)}</span></span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Total Gross Weight</span><span className="font-semibold">{fmtG(totals.gross)} g</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Total Pure Weight</span><span className="font-semibold">{fmtG(totals.pure)} g</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Bill Total</span><span className="font-bold">AED {fmtAED(totals.aed)}</span></div>
            </div>

            <Button className="w-full" onClick={handleSave} disabled={createBill.isPending}>
              {createBill.isPending ? "Saving..." : "Save Purchase Bill"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
