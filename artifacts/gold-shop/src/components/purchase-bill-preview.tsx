import React from "react";
import { Download, Printer } from "lucide-react";
import { format } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import {
  getGetPurchaseBillQueryKey,
  useGetPurchaseBill,
  useGetSettings,
  getGetSettingsQueryKey,
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
import { BISMILLAH_ARABIC, PdfCompanyDetails, PdfFooter, NAVY, GOLD } from "@/components/pdf-branding";

const underlineFieldStyle: React.CSSProperties = {
  borderBottom: "1px solid #aaa",
  minWidth: 120,
  minHeight: 14,
  paddingBottom: "3px",
  lineHeight: 1.4,
};

const fieldLabelCellStyle: React.CSSProperties = {
  padding: "4px 8px",
  fontWeight: "bold",
  color: NAVY,
  whiteSpace: "nowrap",
  verticalAlign: "bottom",
};

const fieldColonCellStyle: React.CSSProperties = {
  padding: "4px 2px",
  color: NAVY,
  verticalAlign: "bottom",
};

const fieldValueCellStyle: React.CSSProperties = {
  padding: "4px 8px",
  verticalAlign: "bottom",
};

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWt(n: number | null | undefined): string {
  return (n == null || n === 0) ? "-" : n.toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function purchaseTypeLabel(type: string): string {
  return type === "fixed" ? "Cash Payment" : "Unfixed Purchase";
}

function paymentLabel(status: string): string {
  if (status === "paid") return "PAID IN CASH";
  if (status === "unpaid") return "UNPAID / LIABILITY";
  return "UNFIXED BALANCE";
}

function displayDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

function numberToWords(value: number): string {
  if (value === 0) return "Zero Dirhams Only";
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const convert = (num: number): string => {
    if (num === 0) return "";
    if (num < 20) return ones[num] ?? "";
    if (num < 100) return `${tens[Math.floor(num / 10)]}${num % 10 ? ` ${ones[num % 10]}` : ""}`;
    if (num < 1000) return `${ones[Math.floor(num / 100)]} Hundred${num % 100 ? ` ${convert(num % 100)}` : ""}`;
    if (num < 1000000) return `${convert(Math.floor(num / 1000))} Thousand${num % 1000 ? ` ${convert(num % 1000)}` : ""}`;
    return `${convert(Math.floor(num / 1000000))} Million${num % 1000000 ? ` ${convert(num % 1000000)}` : ""}`;
  };

  const absolute = Math.abs(value);
  const dirhams = Math.floor(absolute);
  const fils = Math.round((absolute - dirhams) * 100);
  return `${convert(dirhams)} Dirhams${fils ? ` and ${convert(fils)} Fils` : ""} Only`;
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

  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), staleTime: 60_000 }
  });

  const locationUrl = settings?.locationUrl ?? "";

  const uniqueRates = bill ? [...new Set(bill.items.map((item) => fmt(item.rateAedPerG)))] : [];
  const metalRate = uniqueRates.length === 1 ? `AED ${uniqueRates[0]}/g` : uniqueRates.length > 1 ? "Multiple rates" : "";

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
      <DialogContent className="h-[calc(100vh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl p-0 flex flex-col gap-0 overflow-hidden bg-muted/30 sm:h-[90vh] print:p-0 print:border-none print:shadow-none print:bg-white print:overflow-visible">
        <DialogHeader className="p-4 border-b bg-background no-print shadow-sm z-10 shrink-0 print:hidden">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <DialogTitle>
                {bill ? `Purchase Bill ${bill.billNo}` : "Purchase Bill Preview"}
              </DialogTitle>
              <DialogDescription>
                {bill ? `${bill.supplierName} · ${displayDate(bill.billDate)}` : "Loading generated purchase bill"}
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

        <div className="relative min-h-0 flex-1 overflow-auto p-4 sm:p-8 print:p-0 print:overflow-visible" data-purchase-bill-scroll>
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
                box-shadow: none !important;
                border: none !important;
                padding: 0 !important;
                background: white !important;
                max-width: none !important;
                width: 100% !important;
                height: auto !important;
                transform: none !important;
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
              }
              [role="dialog"] > button,
              .no-print {
                display: none !important;
              }
              [data-purchase-bill-scroll] {
                overflow: visible !important;
                padding: 0 !important;
              }
              [data-purchase-bill-doc] {
                width: 210mm !important;
                min-height: 297mm !important;
                box-shadow: none !important;
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
              className="mx-auto bg-white text-black shadow-md print:shadow-none"
              style={{
                fontFamily: "Arial, sans-serif",
                fontSize: "11px",
                width: "210mm",
                minHeight: "297mm",
                boxSizing: "border-box",
                paddingTop: "15mm",
                paddingLeft: "15mm",
                paddingRight: "15mm",
                paddingBottom: "58mm",
                position: "relative",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "4px", background: GOLD }} />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 16px", gap: "12px", marginTop: "10px" }}>
                <div style={{ flex: "0 0 38%" }}>
                  <PdfCompanyDetails />
                </div>

                <div style={{ flex: "0 0 28%", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                  <div
                    dir="rtl"
                    style={{
                      textAlign: "center",
                      color: GOLD,
                      fontSize: "16px",
                      lineHeight: 1.25,
                      fontFamily: '"Amiri PDF", serif',
                      marginTop: "-15px",
                      marginBottom: "2px",
                    }}
                  >
                    {BISMILLAH_ARABIC}
                  </div>
                  <div style={{
                    background: NAVY, color: "white", padding: "10px 18px", textAlign: "center",
                    fontWeight: "bold", fontSize: "16px", letterSpacing: "2px", width: "100%",
                    borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", position: "relative"
                  }}>
                    <div style={{ position: "absolute", left: "10px", width: "6px", height: "6px", background: GOLD, transform: "rotate(45deg)" }} />
                    PURCHASE
                    <div style={{ position: "absolute", right: "10px", width: "6px", height: "6px", background: GOLD, transform: "rotate(45deg)" }} />
                  </div>
                  <div style={{ padding: "4px", border: `1px solid #ddd`, background: "white", borderRadius: "4px", marginTop: "4px" }}>
                    {locationUrl ? (
                      <QRCodeSVG value={locationUrl} size={60} />
                    ) : (
                      <div style={{
                        width: "60px", height: "60px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "9px", color: "#aaa", textAlign: "center", padding: "8px"
                      }}>
                        Location QR
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: "8px", color: "#777", textAlign: "center", marginTop: "-4px" }}>
                    Scan to find us
                  </div>
                </div>

                <div style={{ flex: "0 0 30%", fontSize: "11px", position: "relative" }}>
                  <div style={{ textAlign: "right", fontWeight: "bold", fontSize: "11px", letterSpacing: "1px", color: NAVY, position: "absolute", top: "-15px", right: 0 }}>
                    PARTY COPY
                  </div>
                  <div style={{ marginTop: "12px" }}>
                    {[
                      { label: "Bill / Ref No:", value: bill.billNo },
                      { label: "Date:", value: displayDate(bill.billDate) },
                      { label: "Payment Terms:", value: paymentLabel(bill.paymentStatus) },
                      { label: "Purchase Type:", value: purchaseTypeLabel(bill.purchaseType) },
                      { label: "Metal Rate:", value: metalRate },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ display: "flex", marginBottom: "6px", alignItems: "baseline", lineHeight: "1.5" }}>
                        <span style={{ fontWeight: "bold", minWidth: "90px", color: NAVY, lineHeight: "1.5" }}>{label}</span>
                        <span style={{
                          borderBottom: "1px solid #aaa",
                          flex: 1,
                          minWidth: "70px",
                          paddingLeft: "4px",
                          paddingBottom: "4px",
                          lineHeight: "1.5",
                        }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ margin: "16px 16px 8px" }}>
                <div style={{ background: NAVY, color: "white", padding: "6px 12px", fontWeight: "bold", fontSize: "11px", letterSpacing: "1px" }}>
                  SUPPLIER / VENDOR DETAILS
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${NAVY}` }}>
                  <tbody>
                    <tr>
                      <td style={{ ...fieldLabelCellStyle, width: "18%" }}>Supplier / Party Name</td>
                      <td style={{ ...fieldColonCellStyle, width: "1%" }}>:</td>
                      <td style={{ ...fieldValueCellStyle, width: "30%", borderRight: `1px solid ${NAVY}` }}>
                        <div style={underlineFieldStyle}>{bill.supplierName}</div>
                      </td>
                      <td style={{ ...fieldLabelCellStyle, width: "18%" }}>Address / Location</td>
                      <td style={{ ...fieldColonCellStyle, width: "1%" }}>:</td>
                      <td style={{ ...fieldValueCellStyle, width: "32%" }}>
                        <div style={underlineFieldStyle}>{bill.supplierAddress || ""}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style={fieldLabelCellStyle}>Phone Number</td>
                      <td style={fieldColonCellStyle}>:</td>
                      <td style={{ ...fieldValueCellStyle, borderRight: `1px solid ${NAVY}` }}>
                        <div style={underlineFieldStyle}>{bill.supplierPhone || ""}</div>
                      </td>
                      <td style={fieldLabelCellStyle}>Email Address</td>
                      <td style={fieldColonCellStyle}>:</td>
                      <td style={fieldValueCellStyle}>
                        <div style={underlineFieldStyle}>{bill.supplierEmail || ""}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ margin: "16px 16px 4px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
                  <thead>
                    <tr style={{ background: NAVY, color: "white" }}>
                      {["S.No.", "Stock Description", "Gross Wt.", "Purity", "Pure Wt.", "Making\nRate", "Making Amt.\n(AED)", "Total\n(AED)"].map((h, i) => (
                        <th key={i} style={{
                          padding: "8px 6px", textAlign: i === 1 ? "left" : (i === 7 ? "right" : "center"),
                          border: `1px solid #ccc`,
                          width: ["5%","24%","11%","10%","12%","12%","13%","13%"][i],
                          whiteSpace: "pre-wrap"
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bill.items?.map((item, index) => {
                      const desc = `${stockCategoryLabel(item.category)} @ AED ${fmt(item.rateAedPerG)}/g`;
                      return (
                        <tr key={item.id} style={{ borderBottom: `1px solid #ddd`, background: index % 2 === 1 ? "#f9f9f9" : "white" }}>
                          <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ddd" }}>{index + 1}</td>
                          <td style={{ padding: "6px 6px", border: "1px solid #ddd" }}>{desc}</td>
                          <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.grossWeightGrams)}</td>
                          <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.purityPercent)}%</td>
                          <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.pureWeightGrams)}</td>
                          <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ddd" }}>-</td>
                          <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ddd" }}>{item.makingChargeAed ? fmt(item.makingChargeAed) : "-"}</td>
                          <td style={{ padding: "6px 5px", textAlign: "right", border: "1px solid #ddd", fontWeight: "bold" }}>{fmt(item.lineTotalAed)}</td>
                        </tr>
                      );
                    })}
                    {Array.from({ length: Math.max(0, 7 - (bill.items?.length ?? 0)) }).map((_, i) => {
                      const rowIdx = (bill.items?.length ?? 0) + i;
                      return (
                        <tr key={`ph-${i}`} style={{ background: rowIdx % 2 === 1 ? "#f9f9f9" : "white" }}>
                          <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ddd", color: "#bbb" }}>{rowIdx + 1}</td>
                          {[...Array(7)].map((__, c) => (
                            <td key={c} style={{ padding: "6px 5px", border: "1px solid #ddd" }}>&nbsp;</td>
                          ))}
                        </tr>
                      );
                    })}
                    <tr style={{ background: "#eef2f7", fontWeight: "bold", color: NAVY }}>
                      <td colSpan={2} style={{ padding: "6px 8px", border: "1px solid #ccc" }}>Total ({bill.items?.length ?? 0} Items)</td>
                      <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ccc" }}>{fmtWt(bill.totalGrossGrams)}</td>
                      <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ccc" }}>-</td>
                      <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ccc" }}>{fmtWt(bill.totalPureGrams)}</td>
                      <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ccc" }}>-</td>
                      <td style={{ padding: "6px 5px", textAlign: "center", border: "1px solid #ccc" }}>
                        {fmt(bill.items?.reduce((sum, item) => sum + (item.makingChargeAed || 0), 0))}
                      </td>
                      <td style={{ padding: "6px 5px", textAlign: "right", border: "1px solid #ccc" }}>{fmt(bill.totalAed)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ margin: "2px 16px 4px", display: "flex", justifyContent: "flex-end" }}>
                <table style={{ width: "62%", borderCollapse: "collapse", fontSize: "10px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "5px 8px", border: "1px solid #ccc" }}>GOLD VALUE {uniqueRates.length === 1 ? `@ ${uniqueRates[0]} / gram ` : ""}(AED)</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold", minWidth: "90px" }}>
                        {fmt(bill.totalAed)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "5px 8px", border: "1px solid #ccc" }}>Discount (AED)</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold", minWidth: "90px" }}>0.00</td>
                    </tr>
                    <tr style={{ background: NAVY, color: "white" }}>
                      <td style={{ padding: "6px 10px", fontWeight: "bold", fontSize: "11px" }}>NET AMOUNT (AED)</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: "bold", fontSize: "12px" }}>{fmt(bill.totalAed)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {bill.notes && (
                <div style={{ margin: "8px 16px 4px", border: `1px solid #ccc`, borderRadius: "4px", padding: "6px 10px", fontSize: "10px", color: "#000", background: "#fff" }}>
                  <span style={{ fontWeight: "bold", color: NAVY }}>Notes: </span>
                  <span style={{ whiteSpace: "pre-wrap" }}>{bill.notes}</span>
                </div>
              )}

              <div style={{ flex: 1 }} />

              <div style={{ margin: "8px 16px", border: `1px solid #ccc`, borderRadius: "4px", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", borderBottom: "1px solid #eee", gap: "8px" }}>
                  <span style={{ fontWeight: "bold", color: NAVY, minWidth: "160px" }}>Amount In Words (AED):</span>
                  <span style={{ fontStyle: "italic" }}>{numberToWords(bill.totalAed)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", gap: "8px" }}>
                  <span style={{ fontWeight: "bold", color: NAVY, minWidth: "160px" }}>Payment Mode:</span>
                  <span style={{ fontWeight: "bold" }}>{paymentLabel(bill.paymentStatus)}</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#777", margin: "auto 16px -10px", flexShrink: 0 }}>
                <div>Generated on {format(new Date(bill.createdAt), "dd/MM/yyyy, hh:mm:ss a")}</div>
              </div>

              <PdfFooter absolute />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}