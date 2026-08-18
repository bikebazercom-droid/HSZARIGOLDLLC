import React, { useState } from "react";
import {
  useListPurchaseBills, getListPurchaseBillsQueryKey,
  useCreatePurchaseBill, useDeletePurchaseBill,
  useListStockSuppliers, getListStockSuppliersQueryKey,
  useListStockLevels, getListStockLevelsQueryKey,
  useListStockPurchases, getListStockPurchasesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { FileDown, Plus, Trash2, X } from "lucide-react";
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

const PAYMENT_LABEL: Record<string, string> = {
  paid: "Paid in Cash", unpaid: "Unpaid / Liability", unfixed: "Unfixed Balance",
};

export default function PurchaseBillsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: bills, isLoading } = useListPurchaseBills(undefined, {
    query: { queryKey: getListPurchaseBillsQueryKey(undefined) },
  });
  const { data: suppliers } = useListStockSuppliers({ query: { queryKey: getListStockSuppliersQueryKey() } });
  const createBill = useCreatePurchaseBill();
  const deleteBill = useDeletePurchaseBill();

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

  const calc = lines.map(lineCalc);
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

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListPurchaseBillsQueryKey(undefined) });
    queryClient.invalidateQueries({ queryKey: getListStockLevelsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockPurchasesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockSuppliersQueryKey() });
  };

  const handleSave = () => {
    if (!billNo.trim()) { toast({ title: "Bill No / Ref is required", variant: "destructive" }); return; }
    if (!supplierName.trim()) { toast({ title: "Supplier name is required", variant: "destructive" }); return; }
    for (let i = 0; i < lines.length; i++) {
      const c = calc[i];
      if (!(c.gross > 0)) { toast({ title: `Line ${i + 1}: enter a valid gross weight`, variant: "destructive" }); return; }
      if (!(c.purity > 0 && c.purity <= 100)) { toast({ title: `Line ${i + 1}: purity must be between 0 and 100`, variant: "destructive" }); return; }
      if (!(c.rate >= 0) || lines[i].rate === "") { toast({ title: `Line ${i + 1}: enter the purchase rate`, variant: "destructive" }); return; }
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
        invalidate();
        resetForm();
        setOpen(false);
      },
      onError: (e: any) => toast({ title: "Failed to save bill", description: e?.message, variant: "destructive" }),
    });
  };

  const handleDelete = (id: number, ref: string) => {
    if (!confirm(`Delete bill ${ref}? Its stock batches will be removed and stock reduced accordingly.`)) return;
    deleteBill.mutate({ id }, {
      onSuccess: () => { toast({ title: "Bill deleted" }); invalidate(); },
      onError: () => toast({ title: "Failed to delete bill", variant: "destructive" }),
    });
  };

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
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8" title="Download bill PDF"
                        onClick={() => window.open(`${import.meta.env.BASE_URL}api/purchase-bills/${b.id}/pdf`, "_blank")}
                      >
                        <FileDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(b.id, b.billNo)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

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
                <Select value={purchaseType} onValueChange={(v) => setPurchaseType(v as any)}>
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
                          <Input className="h-9" type="number" min="0" step="any" value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} placeholder="470" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Making / Premium (AED)</Label>
                          <Input className="h-9" type="number" min="0" step="any" value={l.making} onChange={(e) => setLine(i, { making: e.target.value })} placeholder="0" />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                        <span>Net Pure Weight: <span className="font-semibold text-foreground">{fmtG(c.pure)} g</span></span>
                        <span>Line Total: <span className="font-semibold text-foreground">AED {fmtAED(c.total)}</span></span>
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
