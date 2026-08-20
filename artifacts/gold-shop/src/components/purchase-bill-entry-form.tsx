import React, { useState } from "react";
import {
  getGetSupplierLiabilityQueryKey,
  getListPurchaseBillsQueryKey,
  getListStockLevelsQueryKey,
  getListStockPurchasesQueryKey,
  getListStockSuppliersQueryKey,
  PurchaseBillItemInputCategory,
  useCreatePurchaseBill,
  useGetSupplierLiability,
  useListStockSuppliers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, FilePlus2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { STOCK_CATEGORIES } from "@/pages/products/stock";

interface LineDraft {
  category: string;
  grossWeight: string;
  purity: string;
  rate: string;
  making: string;
}

interface PurchaseBillEntryFormProps {
  variant?: "inline" | "sheet";
  onSaved?: () => void;
  sessionLiableSuppliers?: ReadonlySet<string>;
  onSessionLiableSupplier?: (supplierName: string) => void;
}

const emptyLine = (): LineDraft => ({
  category: "gold_9999",
  grossWeight: "",
  purity: "100",
  rate: "",
  making: "",
});

function lineCalc(line: LineDraft) {
  const gross = parseFloat(line.grossWeight) || 0;
  const purity = parseFloat(line.purity) || 0;
  const rate = parseFloat(line.rate) || 0;
  const making = parseFloat(line.making) || 0;
  const pure = gross * (purity / 100);
  const total = gross * rate + making;
  return { gross, purity, rate, making, pure, total };
}

function formatGrams(value: number | undefined | null): string {
  return (value ?? 0).toLocaleString("en-AE", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function formatAed(value: number | undefined | null): string {
  return (value ?? 0).toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function PurchaseBillEntryForm({
  variant = "inline",
  onSaved,
  sessionLiableSuppliers,
  onSessionLiableSupplier,
}: PurchaseBillEntryFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBill = useCreatePurchaseBill();
  const { data: suppliers } = useListStockSuppliers({
    query: { queryKey: getListStockSuppliersQueryKey() },
  });
  const { data: liability } = useGetSupplierLiability({
    query: {
      queryKey: getGetSupplierLiabilityQueryKey(),
      refetchOnWindowFocus: true,
      staleTime: 0,
    },
  });

  const today = format(new Date(), "yyyy-MM-dd");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(today);
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [purchaseType, setPurchaseType] = useState<"fixed" | "unfixed">("fixed");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "unpaid" | "unfixed">("paid");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [localLiableSuppliers, setLocalLiableSuppliers] = useState<Set<string>>(new Set());

  const activeSessionLiableSuppliers = sessionLiableSuppliers ?? localLiableSuppliers;
  const isUnfixedForm = purchaseType === "unfixed";
  const calculatedLines = lines
    .map(lineCalc)
    .map((line) => (isUnfixedForm ? { ...line, rate: 0, making: 0, total: 0 } : line));
  const totals = {
    gross: calculatedLines.reduce((sum, line) => sum + line.gross, 0),
    pure: calculatedLines.reduce((sum, line) => sum + line.pure, 0),
    aed: calculatedLines.reduce((sum, line) => sum + line.total, 0),
  };

  const trimmedSupplier = supplierName.trim();
  const supplierLiabilityRow = trimmedSupplier
    ? liability?.rows.find((row) => row.supplierName.toLowerCase() === trimmedSupplier.toLowerCase())
    : undefined;
  const supplierHasLiability =
    (supplierLiabilityRow != null &&
      (supplierLiabilityRow.unpaidCount > 0 || supplierLiabilityRow.unfixedCount > 0)) ||
    (trimmedSupplier !== "" && activeSessionLiableSuppliers.has(trimmedSupplier.toLowerCase()));

  const setLine = (index: number, patch: Partial<LineDraft>) => {
    setLines((current) =>
      current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    );
  };

  const resetForm = () => {
    setBillNo("");
    setBillDate(format(new Date(), "yyyy-MM-dd"));
    setSupplierName("");
    setSupplierPhone("");
    setSupplierEmail("");
    setSupplierAddress("");
    setPurchaseType("fixed");
    setPaymentStatus("paid");
    setNotes("");
    setLines([emptyLine()]);
  };

  const invalidatePurchaseData = () => {
    queryClient.invalidateQueries({ queryKey: getListPurchaseBillsQueryKey(undefined) });
    queryClient.invalidateQueries({ queryKey: getGetSupplierLiabilityQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockLevelsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockPurchasesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListStockSuppliersQueryKey() });
  };

  const handleSave = () => {
    if (!billNo.trim()) {
      toast({ title: "Bill No / Ref is required", variant: "destructive" });
      return;
    }
    if (!supplierName.trim()) {
      toast({ title: "Supplier name is required", variant: "destructive" });
      return;
    }
    if (supplierEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplierEmail.trim())) {
      toast({ title: "Enter a valid supplier email", variant: "destructive" });
      return;
    }
    for (let index = 0; index < lines.length; index += 1) {
      const calculated = calculatedLines[index];
      if (!(calculated.gross > 0)) {
        toast({ title: `Line ${index + 1}: enter a valid gross weight`, variant: "destructive" });
        return;
      }
      if (!(calculated.purity > 0 && calculated.purity <= 100)) {
        toast({ title: `Line ${index + 1}: purity must be between 0 and 100`, variant: "destructive" });
        return;
      }
      if (!isUnfixedForm && (!(calculated.rate >= 0) || lines[index].rate === "")) {
        toast({ title: `Line ${index + 1}: enter the purchase rate`, variant: "destructive" });
        return;
      }
    }

    createBill.mutate(
      {
        data: {
          billNo: billNo.trim(),
          billDate,
          supplierName: supplierName.trim().toUpperCase(),
          ...(supplierPhone.trim() ? { supplierPhone: supplierPhone.trim() } : {}),
          ...(supplierEmail.trim() ? { supplierEmail: supplierEmail.trim() } : {}),
          ...(supplierAddress.trim() ? { supplierAddress: supplierAddress.trim() } : {}),
          purchaseType,
          paymentStatus,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          items: lines.map((line, index) => ({
            category: line.category as PurchaseBillItemInputCategory,
            grossWeightGrams: calculatedLines[index].gross,
            purityPercent: calculatedLines[index].purity,
            rateAedPerG: calculatedLines[index].rate,
            makingChargeAed: calculatedLines[index].making,
            lineTotalAed: Math.round(calculatedLines[index].total * 100) / 100,
          })),
        },
      },
      {
        onSuccess: (bill) => {
          toast({
            title: `Purchase bill ${bill.billNo} saved`,
            description: `${formatGrams(bill.totalGrossGrams)} g · AED ${formatAed(bill.totalAed)} posted to stock & ledgers`,
          });
          if (bill.paymentStatus === "unpaid" || bill.paymentStatus === "unfixed") {
            const supplierKey = bill.supplierName.toLowerCase();
            setLocalLiableSuppliers((current) => new Set(current).add(supplierKey));
            onSessionLiableSupplier?.(supplierKey);
          }
          invalidatePurchaseData();
          resetForm();
          onSaved?.();
        },
        onError: (error: unknown) => {
          toast({
            title: "Failed to save bill",
            description: error instanceof Error ? error.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  const formContent = (
    <div className={variant === "inline" ? "space-y-5" : "mt-6 space-y-4"}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Bill No / Ref</Label>
          <Input
            value={billNo}
            onChange={(event) => setBillNo(event.target.value)}
            placeholder="e.g. SUP-1042"
            maxLength={300}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Bill Date</Label>
          <Input type="date" value={billDate} onChange={(event) => setBillDate(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Supplier Name</Label>
          <Input
            list="bill-supplier-names"
            value={supplierName}
            onChange={(event) => setSupplierName(event.target.value.toUpperCase())}
            placeholder="e.g. RAHIM"
            className="uppercase"
            maxLength={300}
          />
          <datalist id="bill-supplier-names">
            {suppliers?.map((supplier) => <option key={supplier} value={supplier} />)}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label>Supplier Phone Number</Label>
          <Input
            type="tel"
            autoComplete="tel"
            value={supplierPhone}
            onChange={(event) => setSupplierPhone(event.target.value)}
            placeholder="e.g. +971 50 123 4567"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Supplier Email</Label>
          <Input
            type="email"
            autoComplete="email"
            value={supplierEmail}
            onChange={(event) => setSupplierEmail(event.target.value)}
            placeholder="e.g. supplier@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Supplier Address</Label>
          <Input
            autoComplete="street-address"
            value={supplierAddress}
            onChange={(event) => setSupplierAddress(event.target.value)}
            placeholder="e.g. Deira, Dubai, UAE"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Purchase Type</Label>
          <Select
            value={purchaseType}
            onValueChange={(value) => {
              setPurchaseType(value as "fixed" | "unfixed");
              if (value === "unfixed") setPaymentStatus("unfixed");
            }}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed Purchase</SelectItem>
              <SelectItem value="unfixed">Unfixed Purchase</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Payment Status</Label>
          <Select
            value={paymentStatus}
            onValueChange={(value) => setPaymentStatus(value as "paid" | "unpaid" | "unfixed")}
          >
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
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional note" />
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
                  <span>
                    {supplierLiabilityRow.unpaidCount} unpaid bill
                    {supplierLiabilityRow.unpaidCount > 1 ? "s" : ""} — AED{" "}
                    {formatAed(supplierLiabilityRow.unpaidTotalAed)}
                  </span>
                )}
                {supplierLiabilityRow.unpaidCount > 0 && supplierLiabilityRow.unfixedCount > 0 && (
                  <span className="mx-1">·</span>
                )}
                {supplierLiabilityRow.unfixedCount > 0 && (
                  <span>
                    {supplierLiabilityRow.unfixedCount} unfixed bill
                    {supplierLiabilityRow.unfixedCount > 1 ? "s" : ""} —{" "}
                    {formatGrams(supplierLiabilityRow.unfixedPureGrams)} g pure
                  </span>
                )}
              </p>
            ) : (
              <p className="text-amber-800">
                An unpaid or unfixed bill was added for this supplier earlier in this session.
              </p>
            )}
            <p className="text-xs text-amber-700">Consider settling open balances before adding more.</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Line Items</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((current) => [...current, emptyLine()])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Line
          </Button>
        </div>
        <div className="space-y-3">
          {lines.map((line, index) => {
            const calculated = calculatedLines[index];
            return (
              <div key={index} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">Line {index + 1}</span>
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
                      aria-label={`Remove purchase line ${index + 1}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  <div className="col-span-2 space-y-1 sm:col-span-1">
                    <Label className="text-xs">Category</Label>
                    <Select value={line.category} onValueChange={(value) => setLine(index, { category: value })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STOCK_CATEGORIES.map((category) => (
                          <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Gross Wt (g)</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      step="any"
                      value={line.grossWeight}
                      onChange={(event) => setLine(index, { grossWeight: event.target.value })}
                      placeholder="100"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Purity % / Touch</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={line.purity}
                      onChange={(event) => setLine(index, { purity: event.target.value })}
                      placeholder="91.6"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rate (AED/g)</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      step="any"
                      value={isUnfixedForm ? "" : line.rate}
                      onChange={(event) => setLine(index, { rate: event.target.value })}
                      placeholder={isUnfixedForm ? "Fixed later" : "470"}
                      disabled={isUnfixedForm}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Making / Premium (AED)</Label>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      step="any"
                      value={isUnfixedForm ? "" : line.making}
                      onChange={(event) => setLine(index, { making: event.target.value })}
                      placeholder={isUnfixedForm ? "Fixed later" : "0"}
                      disabled={isUnfixedForm}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Net Pure Weight:{" "}
                    <span className="font-semibold text-foreground">{formatGrams(calculated.pure)} g</span>
                  </span>
                  {isUnfixedForm ? (
                    <span>
                      Line Total:{" "}
                      <span className="font-semibold text-foreground">AED 0.00 (unfixed — rate set at settlement)</span>
                    </span>
                  ) : (
                    <span>
                      Line Total:{" "}
                      <span className="font-semibold text-foreground">AED {formatAed(calculated.total)}</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Gross Weight</span>
          <span className="font-semibold">{formatGrams(totals.gross)} g</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Pure Weight</span>
          <span className="font-semibold">{formatGrams(totals.pure)} g</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Bill Total</span>
          <span className="font-bold">AED {formatAed(totals.aed)}</span>
        </div>
      </div>

      <Button type="button" className="w-full bg-emerald-700 text-white hover:bg-emerald-800" onClick={handleSave} disabled={createBill.isPending}>
        <FilePlus2 className="mr-2 h-4 w-4" />
        {createBill.isPending ? "Saving..." : "Save Purchase Bill"}
      </Button>
    </div>
  );

  if (variant === "sheet") return formContent;

  return (
    <Card className="overflow-hidden border-emerald-200 shadow-sm">
      <CardHeader className="border-b border-emerald-100 bg-emerald-50/70">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-emerald-700 p-2 text-white shadow-sm">
            <FilePlus2 className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-emerald-950">Supplier Purchase Bill Entry</CardTitle>
            <p className="mt-1 text-sm text-emerald-900/70">
              Record inbound stock or metal from a supplier. Each line creates a stock batch and supplier ledger entries.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">{formContent}</CardContent>
    </Card>
  );
}