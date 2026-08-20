import React, { useRef } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Download, ExternalLink, Trash2 } from "lucide-react";
import {
  useGetWholesaleInvoice,
  getGetWholesaleInvoiceQueryKey,
  useGetSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { BISMILLAH_ARABIC, PdfCompanyDetails, PdfFooter, NAVY, GOLD } from "@/components/pdf-branding";

const underlineFieldStyle: React.CSSProperties = {
  borderBottom: "1px solid #aaa",
  minWidth: 120,
  minHeight: 14,
  paddingBottom: "3px",
  lineHeight: 1.4,
};

const fieldLabelCellStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontWeight: "bold",
  color: NAVY,
  whiteSpace: "nowrap",
  verticalAlign: "bottom",
};

const fieldColonCellStyle: React.CSSProperties = {
  padding: "3px 2px",
  color: NAVY,
  verticalAlign: "bottom",
};

const fieldValueCellStyle: React.CSSProperties = {
  padding: "3px 8px",
  verticalAlign: "bottom",
};

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtWt(n: number | null | undefined): string {
  return (n == null || n === 0) ? "-" : n.toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function pricingTypeLabel(pricingType: "fixed" | "unfixed"): string {
  return pricingType === "fixed" ? "Fixed Gold Pricing" : "Unfixed Gold Delivery";
}

function paymentModeLabel(paymentMode: "cash" | "card" | "bank_transfer" | null | undefined): string {
  if (paymentMode === "cash") return "Cash Payment";
  if (paymentMode === "card") return "Card Payment";
  if (paymentMode === "bank_transfer") return "Bank Transfer";
  return "Ledger Posting (Legacy)";
}

function numberToWords(n: number): string {
  if (n === 0) return "Zero Dirhams Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven",
    "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  function convert(num: number): string {
    if (num === 0) return "";
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? " " + ones[num % 10] : "");
    if (num < 1000) return ones[Math.floor(num / 100)] + " Hundred" + (num % 100 ? " " + convert(num % 100) : "");
    if (num < 1000000) return convert(Math.floor(num / 1000)) + " Thousand" + (num % 1000 ? " " + convert(num % 1000) : "");
    return convert(Math.floor(num / 1000000)) + " Million" + (num % 1000000 ? " " + convert(num % 1000000) : "");
  }
  const intPart = Math.floor(Math.abs(n));
  const decPart = Math.round((Math.abs(n) - intPart) * 100);
  let result = convert(intPart) + " Dirhams";
  if (decPart > 0) result += " and " + convert(decPart) + " Fils";
  return result + " Only";
}

export interface WholesaleInvoicePreviewProps {
  invoiceId: number | null;
  onClose: () => void;
  onDeleteClick?: (id: number) => void;
  isAdmin: boolean;
}

export function WholesaleInvoicePreview({ invoiceId, onClose, onDeleteClick, isAdmin }: WholesaleInvoicePreviewProps) {
  const invoiceRef = useRef<HTMLDivElement>(null);

  const { data: invoice, isLoading, error } = useGetWholesaleInvoice(invoiceId || 0, {
    query: {
      enabled: invoiceId !== null,
      queryKey: getGetWholesaleInvoiceQueryKey(invoiceId || 0)
    }
  });

  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), staleTime: 60_000 }
  });

  const locationUrl = settings?.locationUrl ?? "";
  const goldValueAed = invoice?.pricingType === "fixed"
    ? (invoice.items ?? []).reduce((sum, item) => sum + item.totalAed - item.makingAed, 0)
    : null;
  const metalRateAed = invoice?.pricingType === "fixed" && invoice.totalPureGrams > 0
    ? (goldValueAed ?? 0) / invoice.totalPureGrams
    : null;
  const makingRate = (item: { makingAed: number; grossGrams: number }) =>
    item.grossGrams > 0 ? item.makingAed / item.grossGrams : null;

  const handleDownloadPdf = async () => {
    if (!invoiceRef.current || !invoice) return;
    await document.fonts.load('16px "Amiri PDF"', BISMILLAH_ARABIC);
    await document.fonts.ready;
    const html2pdf = (await import("html2pdf.js")).default;

    const A4_W_PX = 794;
    const A4_H_PX = Math.round(A4_W_PX * 297 / 210);
    const captureHeight = Math.max(invoiceRef.current.scrollHeight, A4_H_PX);
    let capturedCanvas: HTMLCanvasElement | null = null;

    const worker: any = (html2pdf()
      .set({
        margin: [0, 0, 0, 0],
        filename: `Wholesale-Invoice-${invoice.invoiceNumber}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          onclone: (clonedDoc: Document) => {
            clonedDoc.querySelectorAll(".no-print").forEach((el) => el.remove());
          },
          windowWidth: A4_W_PX,
          windowHeight: captureHeight,
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(invoiceRef.current)
      .toCanvas()
      .get("canvas") as any)
      .then((canvas: HTMLCanvasElement) => {
        capturedCanvas = canvas;
      })
      .toPdf()
      .get("pdf")
      .then((pdf: any) => {
        if (!capturedCanvas) throw new Error("PDF canvas not created");
        const totalPages = pdf.internal.getNumberOfPages();
        pdf.addPage();
        for (let i = totalPages; i > 1; i--) pdf.deletePage(i);
        pdf.deletePage(1);
        pdf.setPage(1);

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const aspect = capturedCanvas.width / capturedCanvas.height;
        let renderWidth = pageWidth;
        let renderHeight = renderWidth / aspect;
        if (renderHeight > pageHeight) {
          renderHeight = pageHeight;
          renderWidth = renderHeight * aspect;
        }

        const x = (pageWidth - renderWidth) / 2;
        const y = (pageHeight - renderHeight) / 2;
        const imageData = capturedCanvas.toDataURL("image/jpeg", 0.98);
        pdf.addImage(imageData, "JPEG", x, y, renderWidth, renderHeight, undefined, "FAST");
        return pdf;
      });

    await worker.save();
  };

  return (
    <Dialog open={invoiceId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[100vw] sm:max-w-5xl h-[100dvh] sm:h-[90vh] p-0 flex flex-col gap-0 overflow-hidden bg-muted/30 print:p-0 print:border-none print:shadow-none print:bg-white print:overflow-visible">
        <DialogHeader className="p-4 border-b bg-background no-print shadow-sm z-10 shrink-0 print:hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-xl">
                {invoice ? `Invoice ${invoice.invoiceNumber}` : "Invoice Preview"}
              </DialogTitle>
              <DialogDescription>
                {invoice ? `${invoice.traderName} \u2022 ${format(new Date(invoice.invoiceDate), "dd MMM yyyy")}` : ""}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!invoice}>
                <Download className="w-4 h-4 mr-2" /> Download PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!invoice}>
                <Printer className="w-4 h-4 mr-2" /> Print
              </Button>
              {invoice && (
                <Link href={`/wholesale/${invoice.id}`}>
                  <Button variant="secondary" size="sm">
                    <ExternalLink className="w-4 h-4 mr-2" /> Open Full Detail
                  </Button>
                </Link>
              )}
              {isAdmin && invoice && onDeleteClick && (
                <Button variant="destructive" size="sm" onClick={() => onDeleteClick(invoice.id)}>
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto p-4 sm:p-8 print:p-0 print:overflow-visible relative" data-invoice-scroll>
          <style>{`
            @media print {
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
            }
          `}</style>

          {isLoading && (
            <div className="max-w-2xl mx-auto space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-[400px] w-full" />
            </div>
          )}

          {error && (
            <div className="text-center p-12 text-destructive">
              Failed to load invoice details.
            </div>
          )}

          {invoice && (
            <div
              ref={invoiceRef}
              data-invoice-doc
              className="bg-white text-black print:shadow-none mx-auto shadow-md"
              style={{
                fontFamily: "Arial, sans-serif",
                fontSize: "11px",
                border: `2px solid ${GOLD}`,
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
              <div style={{ height: "5px", background: `linear-gradient(to right, ${GOLD}, #f5d77a, ${GOLD})`, margin: "-15mm -15mm 0" }} />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 16px 1px" }}>
                <div style={{ flex: 1 }} />
                <div
                  dir="rtl"
                  style={{
                    textAlign: "center",
                    color: GOLD,
                    fontSize: "16px",
                    lineHeight: 1.25,
                    fontFamily: '"Amiri PDF", serif',
                    flex: 2,
                  }}
                >
                  {BISMILLAH_ARABIC}
                </div>
                <div style={{ textAlign: "right", fontWeight: "bold", fontSize: "12px", letterSpacing: "1px", flex: 1, color: NAVY }}>
                  PARTY COPY
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "flex-start", padding: "8px 16px", gap: "12px" }}>
                <div style={{ flex: "0 0 38%" }}>
                  <PdfCompanyDetails />
                </div>

                <div style={{ flex: "0 0 28%", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                  <div style={{
                    background: NAVY, color: "white", padding: "10px 18px", textAlign: "center",
                    fontWeight: "bold", fontSize: "16px", letterSpacing: "2px", width: "100%",
                    borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
                  }}>
                    <span style={{ color: GOLD }}>◆</span>
                    TAX INVOICE
                    <span style={{ color: GOLD }}>◆</span>
                  </div>
                  <div style={{ padding: "4px", border: `1px solid #ddd`, background: "white", borderRadius: "4px" }}>
                    {locationUrl ? (
                      <QRCodeSVG value={locationUrl} size={80} />
                    ) : (
                      <div style={{
                        width: "80px", height: "80px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "9px", color: "#aaa", textAlign: "center", padding: "8px"
                      }}>
                        Location QR
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ flex: "0 0 30%", fontSize: "11px" }}>
                  {[
                    { label: "Invoice No:", value: invoice.invoiceNumber },
                    { label: "Date:", value: format(new Date(invoice.invoiceDate), "dd/MM/yyyy") },
                    { label: "Pricing Type:", value: pricingTypeLabel(invoice.pricingType) },
                    { label: "Payment Mode:", value: paymentModeLabel(invoice.paymentMode) },
                    { label: "Metal Rate (AED/g):", value: metalRateAed == null ? "Pending rate fix" : fmt(metalRateAed) },
                    { label: "Place of Supply:", value: "Dubai, UAE" },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ display: "flex", marginBottom: "5px", alignItems: "baseline", lineHeight: "1.5" }}>
                      <span style={{ fontWeight: "bold", minWidth: "90px", color: NAVY, lineHeight: "1.5" }}>{label}</span>
                      <span style={{ borderBottom: "1px solid #aaa", flex: 1, minWidth: "70px", paddingLeft: "4px", paddingBottom: "4px", lineHeight: "1.5" }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ margin: "8px 16px" }}>
                <div style={{ background: NAVY, color: "white", padding: "5px 10px", fontWeight: "bold", fontSize: "11px", letterSpacing: "1px" }}>
                  TRADER DETAILS (PARTY)
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${NAVY}` }}>
                  <tbody>
                    <tr>
                      <td style={{ ...fieldLabelCellStyle, width: "11%" }}>Name</td>
                      <td style={{ ...fieldColonCellStyle, width: "1%" }}>:</td>
                      <td style={{ ...fieldValueCellStyle, width: "30%", borderRight: `2px solid ${NAVY}` }}>
                        <div style={underlineFieldStyle}>{invoice.traderName ?? ""}</div>
                      </td>
                      <td style={{ ...fieldLabelCellStyle, width: "11%" }}>Address</td>
                      <td style={{ ...fieldColonCellStyle, width: "1%" }}>:</td>
                      <td style={fieldValueCellStyle}>
                        <div style={underlineFieldStyle}>{invoice.traderAddress ?? ""}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style={fieldLabelCellStyle}>Phone</td>
                      <td style={fieldColonCellStyle}>:</td>
                      <td style={{ ...fieldValueCellStyle, borderRight: `2px solid ${NAVY}` }}>
                        <div style={underlineFieldStyle}>{invoice.traderPhone ?? ""}</div>
                      </td>
                      <td style={fieldLabelCellStyle}>TRN</td>
                      <td style={fieldColonCellStyle}>:</td>
                      <td style={fieldValueCellStyle}>
                        <div style={underlineFieldStyle}>{invoice.traderTrn ?? ""}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style={fieldLabelCellStyle}>Contact</td>
                      <td style={fieldColonCellStyle}>:</td>
                      <td style={{ ...fieldValueCellStyle, borderRight: `2px solid ${NAVY}` }}>
                        <div style={underlineFieldStyle}>{invoice.traderContactPerson || "-"}</div>
                      </td>
                      <td style={fieldLabelCellStyle}>Email</td>
                      <td style={fieldColonCellStyle}>:</td>
                      <td style={fieldValueCellStyle}>
                        <div style={underlineFieldStyle}>{invoice.traderEmail ?? ""}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ margin: "4px 16px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
                  <thead>
                    <tr style={{ background: NAVY, color: "white" }}>
                      {["S.No.", "Stock Description", "Gross Wt.", "Purity", "Pure Wt.", "Metal Rate", "Making Rate", "Making Amt. (AED)", "Total (AED)"].map((h, i) => (
                        <th key={i} style={{
                          padding: "6px 6px", textAlign: i <= 1 ? "left" : "center",
                          border: `1px solid ${NAVY}`,
                          width: ["4%","24%","9%","9%","9%","10%","10%","12%","13%"][i]
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items?.map((item, index) => (
                      <tr key={item.id} style={{ borderBottom: `1px solid #ddd`, background: index % 2 === 1 ? "#f9f9f9" : "white" }}>
                        <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{index + 1}</td>
                        <td style={{ padding: "3px 6px", border: "1px solid #ddd", fontWeight: "500" }}>{item.description}</td>
                        <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.grossGrams)}</td>
                        <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{item.purityMultiplier}</td>
                        <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.pureGrams)}</td>
                        <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>
                          {invoice.pricingType === 'fixed' ? (item.rateAedPerGram ? fmt(item.rateAedPerGram) : "-") : "UNFIXED"}
                        </td>
                        <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{makingRate(item) == null ? "-" : fmt(makingRate(item) ?? 0)}</td>
                        <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{item.makingAed ? fmt(item.makingAed) : "-"}</td>
                        <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd", fontWeight: "bold" }}>{fmt(item.totalAed)}</td>
                      </tr>
                    ))}
                    {Array.from({ length: Math.max(0, 7 - (invoice.items?.length ?? 0)) }).map((_, i) => {
                      const rowIdx = (invoice.items?.length ?? 0) + i;
                      return (
                        <tr key={`ph-${i}`} style={{ background: rowIdx % 2 === 1 ? "#f9f9f9" : "white" }}>
                          <td style={{ padding: "2px 5px", textAlign: "center", border: "1px solid #ddd", color: "#bbb" }}>{rowIdx + 1}</td>
                          {[...Array(8)].map((__, c) => (
                            <td key={c} style={{ padding: "2px 5px", border: "1px solid #ddd" }}>&nbsp;</td>
                          ))}
                        </tr>
                      );
                    })}
                    <tr style={{ background: "#eef2f7", fontWeight: "bold" }}>
                      <td colSpan={2} style={{ padding: "3px 8px", border: "1px solid #ccc" }}>Total ({invoice.items?.length ?? 0} Items)</td>
                      <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>{fmtWt(invoice.totalGrossGrams)}</td>
                      <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>-</td>
                      <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>{fmtWt(invoice.totalPureGrams)}</td>
                      <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>-</td>
                      <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>-</td>
                      <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>{invoice.totalMakingAed ? fmt(invoice.totalMakingAed) : "-"}</td>
                      <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>{fmt(invoice.totalAed)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ margin: "2px 16px 4px", display: "flex", justifyContent: "flex-end" }}>
                <table style={{ width: "58%", borderCollapse: "collapse", fontSize: "10px" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "3px 8px", border: "1px solid #ccc" }}>Gold Value (AED)</td>
                      <td style={{ padding: "3px 8px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold", minWidth: "80px" }}>
                        {goldValueAed == null ? "Pending rate fix" : fmt(goldValueAed)}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "3px 8px", border: "1px solid #ccc" }}>Open Pure Gold (g)</td>
                      <td style={{ padding: "3px 8px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold", minWidth: "80px" }}>
                        {invoice.pricingType === "unfixed" ? fmtWt(invoice.openPureGrams) : "-"}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "3px 8px", border: "1px solid #ccc" }}>Round Off Discount (AED)</td>
                      <td style={{ padding: "3px 8px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold", minWidth: "80px" }}>0.00</td>
                    </tr>
                    <tr style={{ background: NAVY, color: "white" }}>
                      <td style={{ padding: "4px 10px", fontWeight: "bold", fontSize: "11px" }}>Total Amount Including VAT (AED)</td>
                      <td style={{ padding: "4px 10px", textAlign: "right", fontWeight: "bold", fontSize: "12px" }}>{fmt(invoice.totalAed)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ flex: 1 }} />

              <div style={{ margin: "0 16px 8px", border: `1px solid #ccc`, borderRadius: "4px", overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", padding: "4px 8px", borderBottom: "1px solid #eee", gap: "8px" }}>
                  <span style={{ fontWeight: "bold", color: NAVY, minWidth: "160px" }}>Amount In Words (AED):</span>
                  <span style={{ fontStyle: "italic" }}>{numberToWords(invoice.totalAed)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", padding: "4px 8px", borderBottom: "1px solid #eee", gap: "8px" }}>
                  <span style={{ fontWeight: "bold", color: NAVY, minWidth: "160px" }}>Pricing Type:</span>
                  <span style={{ fontWeight: "bold" }}>{pricingTypeLabel(invoice.pricingType)}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", padding: "4px 8px", gap: "8px" }}>
                  <span style={{ fontWeight: "bold", color: NAVY, minWidth: "160px" }}>Payment Mode:</span>
                  <span style={{ fontWeight: "bold" }}>{paymentModeLabel(invoice.paymentMode)}</span>
                </div>
              </div>

              {invoice.notes && (
                <div style={{ margin: "2px 16px 4px", border: `1px solid #ccc`, borderRadius: "4px", padding: "4px 8px", fontSize: "10px", color: "#000", background: "#fff" }}>
                  <span style={{ fontWeight: "bold", color: NAVY }}>Notes: </span>
                  <span style={{ whiteSpace: "pre-wrap" }}>{invoice.notes}</span>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#777", paddingTop: "4px", margin: "auto 16px 0", flexShrink: 0 }}>
                <div>Generated by {invoice.createdByUserName ?? "Admin"} on {format(new Date(invoice.createdAt), "dd/MM/yyyy hh:mm a")}</div>
              </div>

              <PdfFooter absolute />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
