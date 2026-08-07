import React, { useRef, useState } from "react";
import { Link, useParams } from "wouter";
import {
  useGetInvoice,
  getGetInvoiceQueryKey,
  useGetSettings,
  getGetSettingsQueryKey,
  useGetInvoiceProfit,
  getGetInvoiceProfitQueryKey,
} from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Download, ChevronDown, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/auth";

const NAVY = "#1e3a5f";
const GOLD = "#c8a43a";

// Shared style for underlined "label : value" fields (e.g. Customer Details) —
// keeps a clean gap between text and the underline, and comfortable line spacing
// for wrapped multi-line values (e.g. long addresses).
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

// ─── Admin-only batch-level profit analysis (screen only, never printed) ────
function ProfitAnalysis({ invoiceId }: { invoiceId: number }) {
  const { data: profit, isLoading } = useGetInvoiceProfit(invoiceId, {
    query: { queryKey: getGetInvoiceProfitQueryKey(invoiceId), enabled: !!invoiceId },
  });
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtWt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  if (isLoading) {
    return <div className="mt-6 no-print"><Skeleton className="h-40" /></div>;
  }
  if (!profit) return null;

  const hasUntracked = profit.items.some((i) => !i.tracked);
  const profitPositive = profit.profitAed >= 0;

  return (
    <div className="mt-6 no-print rounded-lg border bg-card text-card-foreground shadow-sm" data-testid="profit-analysis">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-base flex items-center gap-2">
          {profitPositive
            ? <TrendingUp className="w-4 h-4 text-green-600" />
            : <TrendingDown className="w-4 h-4 text-red-600" />}
          Profit Analysis
          <span className="text-xs font-normal text-muted-foreground">(admin only — not printed)</span>
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-md bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">Revenue (billed)</div>
            <div className="font-bold text-sm sm:text-base" data-testid="text-profit-revenue">AED {fmt(profit.revenueAed)}</div>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">Exact COGS (FIFO)</div>
            <div className="font-bold text-sm sm:text-base" data-testid="text-profit-cogs">AED {fmt(profit.cogsAed)}</div>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">Profit</div>
            <div className={`font-bold text-sm sm:text-base ${profitPositive ? "text-green-600" : "text-red-600"}`} data-testid="text-profit-net">
              AED {fmt(profit.profitAed)}
            </div>
          </div>
        </div>
        {hasUntracked && (
          <p className="mt-2 text-xs text-muted-foreground">
            Items marked "not tracked" have no inventory batch records (custom/non-stock items); they are excluded from COGS and profit.
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
              <th className="p-2 pl-4 w-6"></th>
              <th className="p-2">Item</th>
              <th className="p-2 text-right">Gross Wt. (g)</th>
              <th className="p-2 text-right">Revenue (AED)</th>
              <th className="p-2 text-right">COGS (AED)</th>
              <th className="p-2 pr-4 text-right">Profit (AED)</th>
            </tr>
          </thead>
          <tbody>
            {profit.items.map((item) => {
              const isOpen = !!expanded[item.invoiceItemId];
              const canExpand = item.lots.length > 0;
              return (
                <React.Fragment key={item.invoiceItemId}>
                  <tr
                    className={`border-b ${canExpand ? "cursor-pointer hover:bg-muted/30" : ""}`}
                    onClick={() => canExpand && setExpanded((e) => ({ ...e, [item.invoiceItemId]: !e[item.invoiceItemId] }))}
                    data-testid={`row-profit-item-${item.invoiceItemId}`}
                  >
                    <td className="p-2 pl-4 text-muted-foreground">
                      {canExpand && (isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                    </td>
                    <td className="p-2 font-medium">
                      {item.description}
                      {!item.tracked && <span className="ml-2 text-xs text-muted-foreground italic">not tracked</span>}
                    </td>
                    <td className="p-2 text-right">{item.grossWeight != null ? fmtWt(item.grossWeight) : "-"}</td>
                    <td className="p-2 text-right">{fmt(item.revenueAed)}</td>
                    <td className="p-2 text-right">{item.tracked ? fmt(item.cogsAed) : "-"}</td>
                    <td className={`p-2 pr-4 text-right font-semibold ${!item.tracked ? "" : item.profitAed >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {item.tracked ? fmt(item.profitAed) : "-"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b bg-muted/20">
                      <td></td>
                      <td colSpan={5} className="p-2 pr-4">
                        <div className="text-xs text-muted-foreground mb-1 font-medium">Consumed purchase lots</div>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              <th className="py-1">Lot</th>
                              <th className="py-1">Date</th>
                              <th className="py-1">Supplier</th>
                              <th className="py-1 text-right">Grams</th>
                              <th className="py-1 text-right">Rate (AED/g)</th>
                              <th className="py-1 text-right">Cost (AED)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.lots.map((lot, i) => (
                              <tr key={i} className="border-t border-border/50">
                                <td className="py-1">{lot.purchaseId != null ? `#${lot.purchaseId}` : "avg-rate (no batch)"}</td>
                                <td className="py-1">{lot.purchaseDate ?? "-"}</td>
                                <td className="py-1">{lot.supplierName ?? "-"}</td>
                                <td className="py-1 text-right">{fmtWt(lot.weightGrams)}</td>
                                <td className="py-1 text-right">{lot.pricePerGram != null ? fmt(lot.pricePerGram) : "-"}</td>
                                <td className="py-1 text-right">{fmt(lot.costAed)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function InvoiceDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  const invoiceRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  const { data: invoice, isLoading } = useGetInvoice(id, {
    query: { queryKey: getGetInvoiceQueryKey(id), enabled: !!id }
  });
  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), staleTime: 60_000 }
  });
  // Admin-only: exact FIFO consumption per item, used for the "Consumed from"
  // batch badges under each line item (screen only — stripped from print/PDF).
  const isAdmin = user?.role === "admin";
  const { data: profitData } = useGetInvoiceProfit(id, {
    query: { queryKey: getGetInvoiceProfitQueryKey(id), enabled: !!id && isAdmin },
  });
  const lotsByItemId = new Map<number, NonNullable<typeof profitData>["items"][number]["lots"]>();
  for (const pi of profitData?.items ?? []) {
    if (pi.lots.length > 0) lotsByItemId.set(pi.invoiceItemId, pi.lots);
  }

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;
  }
  if (!invoice) {
    return <div className="p-8">Invoice not found</div>;
  }

  // Company info from settings (fall back to defaults)
  const companyName = settings?.companyName ?? "HAZARI GOLD L.L.C";
  const companyAddress = settings?.address ?? "Matar Abdul Rahman Khalfan Al Muhairi Building, 1st Floor, Room# 101, Deira, Dubai, UAE";
  const companyPhone = settings?.phone ?? "+971 50 536 4193";
  const companyEmail = settings?.email ?? "hazarigoldllc@gmail.com";
  const companyTrn = settings?.trn ?? "105301944200003";
  const locationUrl = settings?.locationUrl ?? "";
  const logoType = settings?.logoType ?? "monogram";
  const logoInitial = settings?.logoInitial ?? "H";
  const logoImageUrl = settings?.logoImageUrl ?? "";
  const tagline = settings?.tagline ?? "";

  const fmt = (n: number | null | undefined) =>
    (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtWt = (n: number | null | undefined) =>
    (n == null || n === 0) ? "-" : n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const paymentLabel =
    invoice.paymentMethod === "cash" ? "CASH PAYMENT"
    : invoice.paymentMethod === "card" ? "CARD PAYMENT"
    : "BANK TRANSFER";

  const totalBeforeVat = invoice.totalBeforeVat ?? invoice.subtotal ?? 0;
  const vatRate = invoice.vatRate ?? 5;
  const vatAmount = invoice.vatAmount ?? (totalBeforeVat * vatRate / 100);
  const roundOffDiscount = invoice.roundOffDiscount ?? invoice.discount ?? 0;
  const totalIncludingVat = invoice.totalIncludingVat ?? invoice.total ?? 0;
  const metalRate = invoice.metalRate ?? 0;
  const itemCount = invoice.items?.length ?? 0;

  const totalGross = invoice.items?.reduce((s, i) => s + (i.grossWeight ?? 0), 0) ?? 0;
  const totalPure = invoice.items?.reduce((s, i) => s + (i.pureWeight ?? 0), 0) ?? 0;
  const totalMakingAmt = invoice.items?.reduce((s, i) => s + (i.makingAmt ?? 0), 0) ?? 0;
  const totalPrice = invoice.items?.reduce((s, i) => s + (i.totalPrice ?? 0), 0) ?? 0;

  // Split address only on explicit newlines (as typed in the textarea)
  const addressLines = companyAddress.split("\n").map(s => s.trim()).filter(Boolean);

  const handleDownloadPdf = async () => {
    if (!invoiceRef.current) return;
    const html2pdf = (await import("html2pdf.js")).default;
    // A4 at 96 dpi: 210mm = 794px wide, 297mm = 1123px tall.
    // Setting both `height` and `windowHeight` to 1123 crops the html2canvas
    // capture to exactly one A4 page — jsPDF then maps that image to 210×297mm
    // with no pagination and no second blank page.
    const A4_W_PX = 794;
    const A4_H_PX = Math.round(A4_W_PX * 297 / 210); // 1123
    html2pdf()
      .set({
        margin: [0, 0, 0, 0],
        filename: `Invoice-${invoice.invoiceNumber}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          // Strip screen-only elements (e.g. admin batch badges) from the
          // downloaded PDF, matching the browser-print behavior of .no-print.
          onclone: (clonedDoc: Document) => {
            clonedDoc.querySelectorAll(".no-print").forEach((el) => el.remove());
          },
          windowWidth: A4_W_PX,
          windowHeight: A4_H_PX,
          height: A4_H_PX,      // crop canvas to exactly 1 A4 page height
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(invoiceRef.current)
      .toPdf()
      .get("pdf")
      // html2pdf's Worker is a thenable whose chain keeps worker methods
      // (.save) after .then — but its TS types say plain Promise, so cast.
      .then((pdf: any) => {
        // Hard guarantee: delete any pages beyond page 1 so the downloaded
        // PDF is always exactly one A4 page (kills the trailing blank page
        // that pagination rounding sometimes produces).
        const totalPages = pdf.internal.getNumberOfPages();
        for (let i = totalPages; i > 1; i--) {
          pdf.deletePage(i);
        }
        return pdf;
      })
      .then((pdf: any) => pdf.save());
  };

  return (
    <div data-invoice-page className="mx-auto pb-20 px-2 sm:px-0 print:p-0 print:m-0 print:w-full print:max-w-full" style={{ maxWidth: "210mm" }}>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-6 no-print">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <Link href="/invoices">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <h1 className="text-lg sm:text-2xl font-bold tracking-tight text-primary truncate">Invoice {invoice.invoiceNumber}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleDownloadPdf}><Download className="w-4 h-4 mr-2" /> Download PDF</Button>
          <Button className="flex-1 sm:flex-none" onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print Invoice</Button>
        </div>
      </div>

      {/* ─── INVOICE DOCUMENT ───
          Fixed A4 (210mm) width by design for print/PDF fidelity — on narrow
          viewports it scrolls horizontally inside this contained wrapper
          instead of breaking the page's own layout. */}
      <div data-invoice-scroll className="overflow-x-auto print:overflow-hidden">
      <div ref={invoiceRef} data-invoice-doc className="bg-white text-black print:shadow-none" style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", border: `2px solid ${GOLD}`, width: "210mm", minHeight: "297mm", maxWidth: "none", margin: "0 auto", boxSizing: "border-box", paddingTop: "15mm", paddingLeft: "15mm", paddingRight: "15mm", paddingBottom: "58mm", position: "relative", display: "flex", flexDirection: "column" }}>

        {/* Gold top border — negative margin escapes the 15mm container padding
            so it stays flush with the outer div edges */}
        <div style={{ height: "5px", background: `linear-gradient(to right, ${GOLD}, #f5d77a, ${GOLD})`, margin: "-15mm -15mm 0" }} />

        {/* Top line: Arabic + PARTY COPY */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 16px 1px" }}>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: "center", color: GOLD, fontSize: "13px", fontWeight: "bold", fontFamily: "serif", flex: 2 }}>
            بسم الله الرحمن الرحيم
          </div>
          <div style={{ textAlign: "right", fontWeight: "bold", fontSize: "12px", letterSpacing: "1px", flex: 1, color: NAVY }}>
            PARTY COPY
          </div>
        </div>

        {/* Main header */}
        <div style={{ display: "flex", alignItems: "flex-start", padding: "8px 16px", gap: "12px" }}>

          {/* LEFT: Logo + Company Info */}
          <div style={{ flex: "0 0 38%" }}>
            {/* Logo — large block */}
            {logoType === "image" && logoImageUrl ? (
              <div style={{ marginBottom: "8px" }}>
                <img
                  src={logoImageUrl}
                  alt="Logo"
                  style={{ width: "140px", height: "auto", display: "block", borderRadius: "8px" }}
                />
              </div>
            ) : logoType === "monogram" ? (
              <div style={{
                width: "100px", height: "100px", background: NAVY, borderRadius: "8px",
                display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "8px"
              }}>
                <span style={{ color: GOLD, fontSize: "48px", fontWeight: "bold", fontFamily: "Georgia, serif" }}>
                  {logoInitial}
                </span>
              </div>
            ) : null}

            {/* Company name */}
            <div style={{ fontWeight: "bold", fontSize: "13px", color: NAVY, marginBottom: "4px" }}>{companyName}</div>
            {tagline && <div style={{ fontSize: "10px", color: "#555", marginBottom: "4px", fontStyle: "italic" }}>{tagline}</div>}

            {/* Contact details */}
            <div style={{ color: "#333", lineHeight: "1.8", fontSize: "10px" }}>
              <div style={{ display: "flex", gap: "4px" }}>
                <span>📍</span>
                <div>
                  {addressLines.map((line, i) => <div key={i}>{line}</div>)}
                </div>
              </div>
              <div>📞 Phone: &nbsp;{companyPhone}</div>
              <div>✉ Email: &nbsp;&nbsp;{companyEmail}</div>
              <div>🏢 TRN: &nbsp;&nbsp;&nbsp;&nbsp;{companyTrn}</div>
            </div>
          </div>

          {/* CENTER: TAX INVOICE + QR */}
          <div style={{ flex: "0 0 28%", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <div style={{
              background: NAVY, color: "white", padding: "10px 18px", textAlign: "center",
              fontWeight: "bold", fontSize: "16px", letterSpacing: "2px", width: "100%",
              borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
            }}>
              <span style={{ color: GOLD }}>❖</span>
              TAX INVOICE
              <span style={{ color: GOLD }}>❖</span>
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
                  Add location in Settings
                </div>
              )}
            </div>
            {locationUrl && (
              <div style={{ fontSize: "8px", color: "#777", textAlign: "center" }}>Scan to find us</div>
            )}
          </div>

          {/* RIGHT: Invoice details */}
          <div style={{ flex: "0 0 30%", fontSize: "11px" }}>
            {[
              { label: "Invoice No:", value: invoice.invoiceNumber },
              { label: "Date:", value: format(new Date(invoice.createdAt), "dd/MM/yyyy") },
              { label: "Payment Terms:", value: invoice.paymentMethod === "cash" ? "Cash" : invoice.paymentMethod === "card" ? "Card" : "Bank Transfer" },
              { label: "Metal Rate:", value: metalRate ? `AED ${metalRate}/g` : "" },
              { label: "Place of Supply:", value: (invoice as any).placeOfSupply ?? "" },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: "flex", marginBottom: "5px", alignItems: "baseline", lineHeight: "1.5" }}>
                <span style={{ fontWeight: "bold", minWidth: "105px", color: NAVY, lineHeight: "1.5" }}>{label}</span>
                <span style={{ borderBottom: "1px solid #aaa", flex: 1, minWidth: "70px", paddingLeft: "4px", paddingBottom: "4px", lineHeight: "1.5" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Customer Details */}
        <div style={{ margin: "8px 16px" }}>
          <div style={{ background: NAVY, color: "white", padding: "5px 10px", fontWeight: "bold", fontSize: "11px", letterSpacing: "1px" }}>
            CUSTOMER DETAILS (BUYER)
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${NAVY}` }}>
            <tbody>
              {/* Row 1: Name | Address */}
              <tr>
                <td style={{ ...fieldLabelCellStyle, width: "11%" }}>Name</td>
                <td style={{ ...fieldColonCellStyle, width: "1%" }}>:</td>
                <td style={{ ...fieldValueCellStyle, width: "30%", borderRight: `2px solid ${NAVY}` }}>
                  <div style={underlineFieldStyle}>{invoice.customerName ?? ""}</div>
                </td>
                <td style={{ ...fieldLabelCellStyle, width: "11%" }}>Address</td>
                <td style={{ ...fieldColonCellStyle, width: "1%" }}>:</td>
                <td style={fieldValueCellStyle}>
                  <div style={underlineFieldStyle}>{invoice.customerAddress ?? ""}</div>
                </td>
              </tr>
              {/* Row 2: Phone | (empty right) */}
              <tr>
                <td style={fieldLabelCellStyle}>Phone</td>
                <td style={fieldColonCellStyle}>:</td>
                <td style={{ ...fieldValueCellStyle, borderRight: `2px solid ${NAVY}` }}>
                  <div style={underlineFieldStyle}>{invoice.customerMobile ?? ""}</div>
                </td>
                <td colSpan={3} style={{ padding: "5px 8px" }}></td>
              </tr>
              {/* Row 3: Email | Nationality */}
              <tr>
                <td style={fieldLabelCellStyle}>Email</td>
                <td style={fieldColonCellStyle}>:</td>
                <td style={{ ...fieldValueCellStyle, borderRight: `2px solid ${NAVY}` }}>
                  <div style={underlineFieldStyle}>{invoice.customerEmail ?? ""}</div>
                </td>
                <td style={fieldLabelCellStyle}>Nationality</td>
                <td style={fieldColonCellStyle}>:</td>
                <td style={fieldValueCellStyle}>
                  <div style={underlineFieldStyle}>{(invoice as any).customerNationality ?? ""}</div>
                </td>
              </tr>
              {/* Row 4: Passport | Country */}
              <tr>
                <td style={fieldLabelCellStyle}>Passport</td>
                <td style={fieldColonCellStyle}>:</td>
                <td style={{ ...fieldValueCellStyle, borderRight: `2px solid ${NAVY}` }}>
                  <div style={underlineFieldStyle}>{invoice.customerPassportNumber ?? invoice.customerEmiratesId ?? ""}</div>
                </td>
                <td style={fieldLabelCellStyle}>Country</td>
                <td style={fieldColonCellStyle}>:</td>
                <td style={fieldValueCellStyle}>
                  <div style={underlineFieldStyle}>{(invoice as any).customerCountry ?? ""}</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Items Table */}
        <div style={{ margin: "4px 16px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
            <thead>
              <tr style={{ background: NAVY, color: "white" }}>
                {["S.No.", "Stock Description", "Gross Wt.", "Purity", "Pure Wt.", "Making Rate", "Making Amt. (AED)", "Total (AED)"].map((h, i) => (
                  <th key={i} style={{
                    padding: "6px 6px", textAlign: i <= 1 ? "left" : "center",
                    border: `1px solid ${NAVY}`,
                    width: ["4%","26%","10%","10%","10%","10%","15%","15%"][i]
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoice.items?.map((item, index) => {
                const lots = isAdmin ? lotsByItemId.get(item.id) : undefined;
                return (
                <React.Fragment key={item.id}>
                <tr style={{ borderBottom: `1px solid #ddd`, background: index % 2 === 1 ? "#f9f9f9" : "white" }}>
                  <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{index + 1}</td>
                  <td style={{ padding: "3px 6px", border: "1px solid #ddd", fontWeight: "500" }}>{item.description}</td>
                  <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.grossWeight)}</td>
                  <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{item.purity || "-"}</td>
                  <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.pureWeight)}</td>
                  <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.makingRate)}</td>
                  <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd" }}>{item.makingAmt ? fmt(item.makingAmt) : "-"}</td>
                  <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ddd", fontWeight: "bold" }}>{fmt(item.totalPrice)}</td>
                </tr>
                {lots && lots.length > 0 && (
                  <tr className="no-print" data-testid={`row-batches-${item.id}`}>
                    <td style={{ border: "1px solid #ddd" }}></td>
                    <td colSpan={7} style={{ padding: "2px 6px 4px", border: "1px solid #ddd", background: "#fbf8ef" }}>
                      <span style={{ fontSize: "9px", color: "#8a7627", fontWeight: 600 }}>Consumed from: </span>
                      {lots.map((lot, li) => (
                        <span key={li} style={{
                          display: "inline-block", margin: "1px 4px 1px 0", padding: "0px 6px",
                          fontSize: "9px", color: NAVY, background: "#eef2f7",
                          border: "1px solid #d3ddea", borderRadius: "8px",
                        }}>
                          {lot.purchaseId != null ? `#BATCH-${lot.purchaseId}` : "avg-rate (no batch)"}
                          {` (${(lot.weightGrams).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}g`}
                          {lot.pricePerGram != null ? ` @ AED ${fmt(lot.pricePerGram)}/g)` : ")"}
                        </span>
                      ))}
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
              {/* Placeholder rows — pad table to minimum 7 rows for a structured layout */}
              {Array.from({ length: Math.max(0, 7 - (invoice.items?.length ?? 0)) }).map((_, i) => {
                const rowIdx = (invoice.items?.length ?? 0) + i;
                return (
                  <tr key={`ph-${i}`} style={{ background: rowIdx % 2 === 1 ? "#f9f9f9" : "white" }}>
                    <td style={{ padding: "2px 5px", textAlign: "center", border: "1px solid #ddd", color: "#bbb" }}>{rowIdx + 1}</td>
                    {[...Array(7)].map((__, c) => (
                      <td key={c} style={{ padding: "2px 5px", border: "1px solid #ddd" }}>&nbsp;</td>
                    ))}
                  </tr>
                );
              })}
              {/* Totals row */}
              <tr style={{ background: "#eef2f7", fontWeight: "bold" }}>
                <td colSpan={2} style={{ padding: "3px 8px", border: "1px solid #ccc" }}>Total ({itemCount} Items)</td>
                <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>{fmtWt(totalGross)}</td>
                <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>-</td>
                <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>{fmtWt(totalPure)}</td>
                <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>-</td>
                <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>{totalMakingAmt ? fmt(totalMakingAmt) : "-"}</td>
                <td style={{ padding: "3px 5px", textAlign: "center", border: "1px solid #ccc" }}>{fmt(totalPrice)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div style={{ margin: "2px 16px 4px", display: "flex", justifyContent: "flex-end" }}>
          <table style={{ width: "58%", borderCollapse: "collapse", fontSize: "10px" }}>
            <tbody>
              {[
                { label: `GOLD VALUE @ ${metalRate > 0 ? metalRate.toFixed(3) : "0.000"} / gram (AED)`, value: fmt(totalBeforeVat), bold: false, show: true },
                { label: "Total Amount Before VAT (AED)", value: fmt(totalBeforeVat), bold: false, show: vatAmount > 0 },
                { label: `Total VAT Amount (${vatRate}%) (AED)`, value: fmt(vatAmount), bold: false, show: vatAmount > 0 },
                { label: "Round Off Discount (AED)", value: fmt(roundOffDiscount), bold: false, show: true },
              ].filter(row => row.show).map(({ label, value }) => (
                <tr key={label}>
                  <td style={{ padding: "3px 8px", border: "1px solid #ccc" }}>{label}</td>
                  <td style={{ padding: "3px 8px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold", minWidth: "80px" }}>{value}</td>
                </tr>
              ))}
              <tr style={{ background: NAVY, color: "white" }}>
                <td style={{ padding: "4px 10px", fontWeight: "bold", fontSize: "11px" }}>Total Amount Including VAT (AED)</td>
                <td style={{ padding: "4px 10px", textAlign: "right", fontWeight: "bold", fontSize: "12px" }}>{fmt(totalIncludingVat)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Flex spacer — pushes Amount In Words / Payment Mode down to fill blank space */}
        <div style={{ flex: 1 }} />

        {/* Amount in Words + Payment Mode */}
        <div style={{ margin: "0 16px 8px", border: `1px solid #ccc`, borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "4px 8px", borderBottom: "1px solid #eee", gap: "8px" }}>
            <span style={{ fontSize: "14px" }}>💰</span>
            <span style={{ fontWeight: "bold", color: NAVY, minWidth: "160px" }}>Amount In Words (AED):</span>
            <span style={{ fontStyle: "italic" }}>{numberToWords(totalIncludingVat)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "4px 8px", gap: "8px" }}>
            <span style={{ fontSize: "14px" }}>💳</span>
            <span style={{ fontWeight: "bold", color: NAVY, minWidth: "160px" }}>Payment Mode:</span>
            <span style={{ fontWeight: "bold" }}>{paymentLabel}</span>
          </div>
        </div>

        {/* Notes — rendered as plain text so it appears in both screen and print/PDF */}
        {invoice.notes && (
          <div style={{ margin: "2px 16px 4px", border: `1px solid #ccc`, borderRadius: "4px", padding: "4px 8px", fontSize: "10px", color: "#000", background: "#fff" }}>
            <span style={{ fontWeight: "bold", color: NAVY }}>Notes: </span>
            <span style={{ whiteSpace: "pre-wrap" }}>{invoice.notes}</span>
          </div>
        )}

        {/* ── BOTTOM FOOTER WRAPPER ──────────────────────────────────────────
            Absolutely pinned to the bottom of the A4 frame so that signatures
            and the navy ribbon always sit at the foot of the page regardless
            of how many item rows are in the invoice.  The wrapper spans edge-
            to-edge (left/right: 0) so the full-width navy & gold strips need
            no negative-margin escape. Signatures are padded inward to match
            the 15mm content boundary. */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, pageBreakBefore: "avoid" }}>
          {/* Signatures */}
          <div style={{ padding: "8px 15mm 6px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            {["Customer's Signature", "Checked By", "Authorised Signature"].map((label) => (
              <div key={label} style={{ width: "30%" }}>
                {label === "Authorised Signature" && settings?.stampSignatureUrl && (
                  <img
                    src={settings.stampSignatureUrl}
                    alt="Authorized stamp and signature"
                    style={{
                      display: "block",
                      width: "130px",
                      maxWidth: "100%",
                      height: "auto",
                      margin: "0 auto -10px",
                    }}
                  />
                )}
                <div style={{ borderTop: "1px solid #333", paddingTop: "4px", fontSize: "10px", fontWeight: "bold", color: NAVY, textAlign: "center" }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          {/* Navy "Thank you" ribbon — full width inside the wrapper */}
          <div className="thank-you-footer" style={{ background: NAVY, color: "white", textAlign: "center", padding: "6px", fontWeight: "bold", fontSize: "12px", letterSpacing: "1px", pageBreakBefore: "avoid" }}>
            Thank you for your business!
          </div>

          {/* Gold bottom border — full width, flush at the very bottom */}
          <div style={{ height: "5px", background: `linear-gradient(to right, ${GOLD}, #f5d77a, ${GOLD})` }} />
        </div>
      </div>
      </div>

      {invoice.notes && (
        <div className="mt-4 p-4 bg-muted/40 rounded text-sm no-print" style={{ whiteSpace: "pre-wrap" }}>
          <span className="font-medium">Notes: </span>{invoice.notes}
        </div>
      )}

      {user?.role === "admin" && <ProfitAnalysis invoiceId={id} />}

      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }

          /* ── Clamp every layer to a single A4 page ── */
          html, body {
            width: 210mm !important;
            height: 297mm !important;
            max-height: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* React root */
          #root, [data-reactroot] {
            width: 210mm !important;
            height: 297mm !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
            display: block !important;
          }

          /* Outer page wrapper */
          [data-invoice-page] {
            width: 210mm !important;
            height: 297mm !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }

          /* Horizontal-scroll wrapper — must NOT be overflow:visible in print */
          [data-invoice-scroll] {
            width: 210mm !important;
            height: 297mm !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          /* The invoice document itself */
          [data-invoice-doc] {
            width: 210mm !important;
            height: 297mm !important;
            min-height: unset !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            page-break-inside: avoid !important;
            page-break-after: avoid !important;
            break-inside: avoid !important;
            break-after: avoid !important;
          }

          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
