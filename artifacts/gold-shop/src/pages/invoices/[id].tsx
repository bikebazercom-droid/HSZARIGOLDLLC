import React, { useRef } from "react";
import { Link, useParams } from "wouter";
import {
  useGetInvoice,
  getGetInvoiceQueryKey,
  useGetSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Download } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

const NAVY = "#1e3a5f";
const GOLD = "#c8a43a";

// Shared style for underlined "label : value" fields (e.g. Customer Details) —
// keeps a clean gap between text and the underline, and comfortable line spacing
// for wrapped multi-line values (e.g. long addresses).
const underlineFieldStyle: React.CSSProperties = {
  borderBottom: "1px solid #aaa",
  minWidth: 120,
  minHeight: 16,
  paddingBottom: "6px",
  lineHeight: 1.5,
};

const fieldLabelCellStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontWeight: "bold",
  color: NAVY,
  whiteSpace: "nowrap",
  verticalAlign: "bottom",
};

const fieldColonCellStyle: React.CSSProperties = {
  padding: "5px 2px",
  color: NAVY,
  verticalAlign: "bottom",
};

const fieldValueCellStyle: React.CSSProperties = {
  padding: "5px 8px",
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

export default function InvoiceDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  const invoiceRef = useRef<HTMLDivElement>(null);

  const { data: invoice, isLoading } = useGetInvoice(id, {
    query: { queryKey: getGetInvoiceQueryKey(id), enabled: !!id }
  });
  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), staleTime: 60_000 }
  });

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
    html2pdf()
      .set({
        margin: [12, 10, 12, 10],
        filename: `Invoice-${invoice.invoiceNumber}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(invoiceRef.current)
      .save();
  };

  return (
    <div className="max-w-4xl mx-auto pb-20 px-2 sm:px-0 print:p-0 print:m-0" style={{ maxWidth: "210mm" }}>
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
      <div className="overflow-x-auto print:overflow-visible">
      <div ref={invoiceRef} className="bg-white text-black print:shadow-none" style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", border: `2px solid ${GOLD}`, width: "210mm", maxWidth: "none", margin: "0 auto" }}>

        {/* Gold top border */}
        <div style={{ height: "5px", background: `linear-gradient(to right, ${GOLD}, #f5d77a, ${GOLD})` }} />

        {/* Top line: Arabic + PARTY COPY */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 16px 2px" }}>
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
        <div style={{ margin: "8px 16px" }}>
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
              {invoice.items?.map((item, index) => (
                <tr key={item.id} style={{ borderBottom: `1px solid #ddd`, background: index % 2 === 1 ? "#f9f9f9" : "white" }}>
                  <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ddd" }}>{index + 1}</td>
                  <td style={{ padding: "5px 8px", border: "1px solid #ddd", fontWeight: "500" }}>{item.description}</td>
                  <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.grossWeight)}</td>
                  <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ddd" }}>{item.purity || "-"}</td>
                  <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.pureWeight)}</td>
                  <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ddd" }}>{fmtWt(item.makingRate)}</td>
                  <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ddd" }}>{item.makingAmt ? fmt(item.makingAmt) : "-"}</td>
                  <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ddd", fontWeight: "bold" }}>{fmt(item.totalPrice)}</td>
                </tr>
              ))}
              {/* Totals row */}
              <tr style={{ background: "#eef2f7", fontWeight: "bold" }}>
                <td colSpan={2} style={{ padding: "5px 8px", border: "1px solid #ccc" }}>Total ({itemCount} Items)</td>
                <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ccc" }}>{fmtWt(totalGross)}</td>
                <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ccc" }}>-</td>
                <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ccc" }}>{fmtWt(totalPure)}</td>
                <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ccc" }}>-</td>
                <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ccc" }}>{totalMakingAmt ? fmt(totalMakingAmt) : "-"}</td>
                <td style={{ padding: "5px 6px", textAlign: "center", border: "1px solid #ccc" }}>{fmt(totalPrice)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Summary */}
        <div style={{ margin: "4px 16px 8px", display: "flex", justifyContent: "flex-end" }}>
          <table style={{ width: "58%", borderCollapse: "collapse", fontSize: "10px" }}>
            <tbody>
              {[
                { label: `GOLD VALUE @ ${metalRate > 0 ? metalRate.toFixed(3) : "0.000"} / gram (AED)`, value: fmt(totalBeforeVat), bold: false, show: true },
                { label: "Total Amount Before VAT (AED)", value: fmt(totalBeforeVat), bold: false, show: vatAmount > 0 },
                { label: `Total VAT Amount (${vatRate}%) (AED)`, value: fmt(vatAmount), bold: false, show: vatAmount > 0 },
                { label: "Round Off Discount (AED)", value: fmt(roundOffDiscount), bold: false, show: true },
              ].filter(row => row.show).map(({ label, value }) => (
                <tr key={label}>
                  <td style={{ padding: "4px 10px", border: "1px solid #ccc" }}>{label}</td>
                  <td style={{ padding: "4px 10px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold", minWidth: "80px" }}>{value}</td>
                </tr>
              ))}
              <tr style={{ background: NAVY, color: "white" }}>
                <td style={{ padding: "6px 10px", fontWeight: "bold", fontSize: "11px" }}>Total Amount Including VAT (AED)</td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: "bold", fontSize: "12px" }}>{fmt(totalIncludingVat)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Amount in Words + Payment Mode */}
        <div style={{ margin: "4px 16px", border: `1px solid #ccc`, borderRadius: "4px", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", borderBottom: "1px solid #eee", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>💰</span>
            <span style={{ fontWeight: "bold", color: NAVY, minWidth: "160px" }}>Amount In Words (AED):</span>
            <span style={{ fontStyle: "italic" }}>{numberToWords(totalIncludingVat)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", padding: "6px 10px", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>💳</span>
            <span style={{ fontWeight: "bold", color: NAVY, minWidth: "160px" }}>Payment Mode:</span>
            <span style={{ fontWeight: "bold" }}>{paymentLabel}</span>
          </div>
        </div>

        {/* Signatures */}
        <div style={{ margin: "16px 16px 8px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          {["Customer's Signature", "Checked By", "Authorised Signature"].map((label) => (
            <div key={label} style={{ width: "30%" }}>
              {/* Standard normal-flow block centering — no position: absolute.
                  The stamp is rendered before the line/label as a normal
                  block element with margin: 0 auto, so it can never overflow
                  or shove sibling content out of the container. A small
                  negative margin-bottom pulls it down to overlap the line. */}
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

        {/* Footer */}
        <div style={{ background: NAVY, color: "white", textAlign: "center", padding: "8px", fontWeight: "bold", fontSize: "12px", letterSpacing: "1px" }}>
          Thank you for your business!
        </div>

        {/* Gold bottom border */}
        <div style={{ height: "5px", background: `linear-gradient(to right, ${GOLD}, #f5d77a, ${GOLD})` }} />
      </div>
      </div>

      {invoice.notes && (
        <div className="mt-4 p-4 bg-muted/40 rounded text-sm no-print">
          <span className="font-medium">Notes: </span>{invoice.notes}
        </div>
      )}

      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm 10mm 12mm 10mm;
          }
          .no-print { display: none !important; }
          body {
            background: white !important;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  );
}
