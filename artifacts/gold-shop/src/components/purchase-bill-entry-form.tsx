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

const PURCHASE_BILL_PURITY_PERCENT: Record<string, string> = {
  gold_9999: "99.99",
  ten_tola_bar: "99.99",
  kg_bar: "99.99",
  "995": "99.5",
  gold_jewelry_22k: "91.6",
  silver: "99.9",
};

function purityPercentForCategory(category: string): string {
  return PURCHASE_BILL_PURITY_PERCENT[category] ?? "100";
}

const emptyLine = (): LineDraft => ({
  category: "gold_9999",
  grossWeight: "",
  purity: purityPercentForCategory("gold_9999"),
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
  const [purchaseTypeUI, setPurchaseTypeUI] = useState<"cash" | "unfixed">("cash");
  const purchaseType = purchaseTypeUI === "cash" ? "fixed" : "unfixed";
  const paymentStatus = purchaseTypeUI === "cash" ? "paid" : "unfixed";
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [localLiableSuppliers, setLocalLiableSuppliers] = useState<Set<string>>(new Set());

  const activeSessionLiableSuppliers = sessionLiableSuppliers ?? localLiableSuppliers;
  const isUnfixedForm = purchaseTypeUI === "unfixed";
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
    setPurchaseTypeUI("cash");
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
    <div className={variant === "inline" ? "space-y-6" : "mt-6 space-y-6"}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">Line Items</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines((current) => [...current, emptyLine()])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Line Item
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border border-emerald-200">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-emerald-900 text-white">
                <th className="w-10 px-3 py-2.5 text-center text-xs font-semibold">#</th>
                <th className="min-w-[160px] px-3 py-2.5 text-left text-xs font-semibold">Category</th>
                <th className="w-28 px-3 py-2.5 text-center text-xs font-semibold">Gross Wt (g)</th>
                <th className="w-24 px-3 py-2.5 text-center text-xs font-semibold">Purity % / Touch</th>
                <th className="w-28 px-3 py-2.5 text-center text-xs font-semibold">Rate (AED/g)</th>
                <th className="w-32 px-3 py-2.5 text-center text-xs font-semibold">Making / Premium (AED)</th>
                <th className="w-32 px-3 py-2.5 text-center text-xs font-semibold">Line Total</th>
                <th className="w-10 px-1 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const calculated = calculatedLines[index];
                return (
                  <tr key={index} className="border-b border-emerald-100 last:border-0 even:bg-emerald-50/30">
                    <td className="px-3 py-3 text-center text-muted-foreground">{index + 1}</td>
                    <td className="px-3 py-3">
                      <Select
                        value={line.category}
                        onValueChange={(value) => setLine(index, {
                          category: value,
                          purity: purityPercentForCategory(value),
                        })}
                      >
                        <SelectTrigger
                          className="h-9"
                          aria-label={`Category for purchase line ${index + 1}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STOCK_CATEGORIES.map((category) => (
                            <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        className="h-9 text-center"
                        type="number"
                        min="0"
                        step="any"
                        value={line.grossWeight}
                        onChange={(event) => setLine(index, { grossWeight: event.target.value })}
                        placeholder="0.000"
                        aria-label={`Gross Wt (g) for purchase line ${index + 1}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        className="h-9 text-center"
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        value={line.purity}
                        onChange={(event) => setLine(index, { purity: event.target.value })}
                        placeholder="100"
                        aria-label={`Purity % / Touch for purchase line ${index + 1}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        className="h-9 text-center"
                        type="number"
                        min="0"
                        step="any"
                        value={isUnfixedForm ? "" : line.rate}
                        onChange={(event) => setLine(index, { rate: event.target.value })}
                        placeholder={isUnfixedForm ? "-" : "0.00"}
                        disabled={isUnfixedForm}
                        aria-label={`Rate (AED/g) for purchase line ${index + 1}`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        className="h-9 text-center"
                        type="number"
                        min="0"
                        step="any"
                        value={isUnfixedForm ? "" : line.making}
                        onChange={(event) => setLine(index, { making: event.target.value })}
                        placeholder={isUnfixedForm ? "-" : "0.00"}
                        disabled={isUnfixedForm}
                        aria-label={`Making / Premium (AED) for purchase line ${index + 1}`}
                      />
                    </td>
                    <td className="bg-emerald-50/50 px-3 py-3 text-center font-mono font-semibold text-emerald-700">
                      AED {isUnfixedForm ? "0.00" : formatAed(calculated.total)}
                    </td>
                    <td className="px-1 py-3 text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
                        disabled={lines.length === 1}
                        aria-label={`Remove purchase line ${index + 1}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end pt-2">
          <div className="w-full space-y-1.5 rounded-md border border-emerald-100 bg-emerald-50/30 px-4 py-3 text-sm sm:w-1/2 lg:w-1/3">
            <div className="flex justify-between">
              <span className="text-emerald-900/70">Total Gross</span>
              <span className="font-semibold text-emerald-950">{formatGrams(totals.gross)} g</span>
            </div>
            <div className="flex justify-between">
              <span className="text-emerald-900/70">Total Pure</span>
              <span className="font-semibold text-emerald-950">{formatGrams(totals.pure)} g</span>
            </div>
            <div className="flex justify-between border-t border-emerald-200/50 pt-1.5 mt-1.5">
              <span className="font-medium text-emerald-900">Bill Total</span>
              <span className="font-bold text-emerald-700 text-base">AED {formatAed(totals.aed)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="border-b border-emerald-100 pb-2 font-semibold text-emerald-950">Purchase Bill Details</h3>

        {supplierHasLiability && (
          <div className="mb-2 flex gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
            <Label>Purchase Type</Label>
            <Select
              value={purchaseTypeUI}
              onValueChange={(value) => setPurchaseTypeUI(value as "cash" | "unfixed")}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash Payment</SelectItem>
                <SelectItem value="unfixed">Unfixed Purchase</SelectItem>
              </SelectContent>
            </Select>
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
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-2 xl:col-span-2">
            <Label>Supplier Address</Label>
            <Input
              autoComplete="street-address"
              value={supplierAddress}
              onChange={(event) => setSupplierAddress(event.target.value)}
              placeholder="e.g. Deira, Dubai, UAE"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3 xl:col-span-4">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional note" />
          </div>
        </div>
      </div>

      <Button
        type="button"
        className="h-11 w-full bg-emerald-700 text-base text-white hover:bg-emerald-800"
        onClick={handleSave}
        disabled={createBill.isPending}
      >
        <FilePlus2 className="mr-2 h-5 w-5" />
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