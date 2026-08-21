import React from "react";
import { Download, Printer } from "lucide-react";
import {
  getGetPurchaseBillQueryKey,
  useGetPurchaseBill,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { stockCategoryLabel } from "@/pages/products/stock";

function formatAed(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatGrams(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString("en-AE", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 4,
  });
}

function purchaseTypeLabel(purchaseType: string): string {
  return purchaseType === "unfixed" ? "Unfixed Purchase" : "Cash Payment";
}

interface PurchaseBillPreviewProps {
  billId: number | null;
  onClose: () => void;
}

export function PurchaseBillPreview({ billId, onClose }: PurchaseBillPreviewProps) {
  const { data: bill, isLoading, error } = useGetPurchaseBill(billId ?? 0, {
    query: {
      enabled: billId !== null,
      queryKey: getGetPurchaseBillQueryKey(billId ?? 0),
    },
  });

  const downloadPdf = () => {
    if (!bill) return;
    window.open(
      `${import.meta.env.BASE_URL}api/purchase-bills/${bill.id}/pdf`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <Dialog open={billId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden bg-muted/30 p-0 sm:h-[90vh]">
        <DialogHeader className="no-print shrink-0 border-b bg-background p-4 shadow-sm">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <DialogTitle>
                {bill ? `Purchase Bill ${bill.billNo}` : "Purchase Bill Preview"}
              </DialogTitle>
              <DialogDescription>
                {bill ? `${bill.supplierName} · ${bill.billDate}` : "Loading generated purchase bill"}
              </DialogDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={downloadPdf} disabled={!bill}>
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => window.print()} disabled={!bill}>
                <Printer className="mr-2 h-4 w-4" />
                Print
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-8" data-purchase-bill-scroll>
          <style>{`
            @media print {
              @page {
                size: A4 portrait;
                margin: 0;
              }
              body > *:not([data-radix-portal]) {
                display: none !important;
              }
              [data-radix-portal] > div > div:not([role="dialog"]) {
                display: none !important;
              }
              [role="dialog"] {
                position: absolute !important;
                inset: 0 !important;
                width: 210mm !important;
                max-width: none !important;
                height: auto !important;
                max-height: none !important;
                transform: none !important;
                border: 0 !important;
                box-shadow: none !important;
                background: white !important;
                overflow: visible !important;
              }
              [data-purchase-bill-scroll] {
                overflow: visible !important;
                padding: 0 !important;
              }
              [data-purchase-bill-doc] {
                min-height: 297mm !important;
                box-shadow: none !important;
              }
              .no-print {
                display: none !important;
              }
            }
          `}</style>

          {isLoading && (
            <div className="mx-auto max-w-3xl space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-[520px] w-full" />
            </div>
          )}

          {error && (
            <div className="p-12 text-center text-destructive">
              Unable to load the generated purchase bill.
            </div>
          )}

          {bill && (
            <div
              data-purchase-bill-doc
              className="mx-auto min-h-[297mm] w-[210mm] bg-white p-[14mm] text-slate-950 shadow-lg"
            >
              <div className="border-b-4 border-emerald-800 pb-5">
                <div className="flex items-start justify-between gap-8">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-700">
                      Supplier Purchase Bill
                    </p>
                    <h2 className="mt-2 text-3xl font-black text-emerald-950">
                      {bill.billNo}
                    </h2>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-slate-500">Bill Date</p>
                    <p className="font-bold">{bill.billDate}</p>
                    <p className="mt-2 text-slate-500">Purchase Type</p>
                    <p className="font-bold text-emerald-800">{purchaseTypeLabel(bill.purchaseType)}</p>
                  </div>
                </div>
              </div>

              <section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Supplier Details</p>
                <p className="mt-2 text-lg font-bold">{bill.supplierName}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                  <p><span className="text-slate-500">Phone:</span> {bill.supplierPhone || "—"}</p>
                  <p><span className="text-slate-500">Email:</span> {bill.supplierEmail || "—"}</p>
                  <p className="col-span-2"><span className="text-slate-500">Address:</span> {bill.supplierAddress || "—"}</p>
                </div>
              </section>

              <section className="mt-6">
                <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-950">Line Items</h3>
                <table className="mt-3 w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-emerald-900 text-white">
                      <th className="px-2 py-2 text-left">#</th>
                      <th className="px-2 py-2 text-left">Category</th>
                      <th className="px-2 py-2 text-right">Gross Wt</th>
                      <th className="px-2 py-2 text-right">Purity</th>
                      <th className="px-2 py-2 text-right">Pure Wt</th>
                      <th className="px-2 py-2 text-right">Rate</th>
                      <th className="px-2 py-2 text-right">Making</th>
                      <th className="px-2 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.items.map((item, index) => (
                      <tr key={item.id} className="border-b border-slate-200">
                        <td className="px-2 py-2">{index + 1}</td>
                        <td className="px-2 py-2 font-medium">{stockCategoryLabel(item.category)}</td>
                        <td className="px-2 py-2 text-right">{formatGrams(item.grossWeightGrams)} g</td>
                        <td className="px-2 py-2 text-right">{item.purityPercent.toFixed(3)}%</td>
                        <td className="px-2 py-2 text-right">{formatGrams(item.pureWeightGrams)} g</td>
                        <td className="px-2 py-2 text-right">{formatAed(item.rateAedPerG)}</td>
                        <td className="px-2 py-2 text-right">{formatAed(item.makingChargeAed)}</td>
                        <td className="px-2 py-2 text-right font-bold">AED {formatAed(item.lineTotalAed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="ml-auto mt-6 w-[88mm] rounded-lg border border-emerald-200 bg-emerald-50/70 p-4">
                <div className="flex justify-between py-1 text-sm">
                  <span className="text-slate-600">Total Gross</span>
                  <span className="font-bold">{formatGrams(bill.totalGrossGrams)} g</span>
                </div>
                <div className="flex justify-between py-1 text-sm">
                  <span className="text-slate-600">Total Pure</span>
                  <span className="font-bold">{formatGrams(bill.totalPureGrams)} g</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-emerald-300 pt-3 text-base">
                  <span className="font-bold text-emerald-950">Bill Total</span>
                  <span className="font-black text-emerald-800">AED {formatAed(bill.totalAed)}</span>
                </div>
              </section>

              {bill.notes && (
                <section className="mt-6 border-t border-slate-200 pt-4 text-sm">
                  <span className="font-bold">Notes: </span>
                  {bill.notes}
                </section>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}