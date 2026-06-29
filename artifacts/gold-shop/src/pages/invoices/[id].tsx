import React from "react";
import { Link, useParams } from "wouter";
import { useGetInvoice, getGetInvoiceQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

const NAVY = "#1e3a5f";
const GOLD = "#c8a43a";

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

  const { data: invoice, isLoading } = useGetInvoice(id, {
    query: { queryKey: getGetInvoiceQueryKey(id), enabled: !!id }
  });

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;
  }
  if (!invoice) {
    return <div className="p-8">Invoice not found</div>;
  }

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

  return (
    <div className="max-w-4xl mx-auto pb-20 print:p-0 print:m-0 print:max-w-none">
      <div className="flex justify-between items-center mb-6 no-print">
        <div className="flex items-center gap-4">
          <Link href="/invoices">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Invoice {invoice.invoiceNumber}</h1>
        </div>
        <Button onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print Invoice</Button>
      </div>

      {/* ─── INVOICE DOCUMENT ─── */}
      <div className="bg-white text-black print:shadow-none" style={{ fontFamily: "Arial, sans-serif", fontSize: "11px", border: `2px solid ${GOLD}` }}>

        {/* Gold top border accent */}
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
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
              <div style={{
                width: "60px", height: "60px", background: NAVY, borderRadius: "6px",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
              }}>
                <span style={{ color: GOLD, fontSize: "28px", fontWeight: "bold", fontFamily: "Georgia, serif", letterSpacing: "-2px" }}>H</span>
              </div>
              <div>
                <div style={{ fontSize: "20px", fontWeight: "bold", color: GOLD, fontFamily: "Georgia, serif", lineHeight: 1.1 }}>Hazari</div>
                <div style={{ fontSize: "20px", fontWeight: "bold", color: GOLD, fontFamily: "Georgia, serif", lineHeight: 1.1 }}>Gold</div>
              </div>
            </div>
            <div style={{ fontWeight: "bold", fontSize: "13px", color: NAVY, marginBottom: "4px" }}>HAZARI GOLD L.L.C</div>
            <div style={{ color: "#333", lineHeight: "1.6" }}>
              <div>📍 Matar Abdul Rahman Khalfan Al Muhairi Building</div>
              <div style={{ paddingLeft: "18px" }}>1st Floor, Room# 101, Deira, Dubai, UAE</div>
              <div>📞 Phone: &nbsp;+971 50 536 4193</div>
              <div>✉ Email: &nbsp;&nbsp;hazarigoldllc@gmail.com</div>
              <div>🏢 TRN: &nbsp;&nbsp;&nbsp;&nbsp;105301944200003</div>
            </div>
          </div>

          {/* CENTER: TAX INVOICE banner */}
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
            <div style={{
              width: "80px", height: "80px", border: `1px solid #ccc`,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "#999"
            }}>
              QR Code
            </div>
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
              <div key={label} style={{ display: "flex", marginBottom: "5px", alignItems: "baseline" }}>
                <span style={{ fontWeight: "bold", minWidth: "100px", color: NAVY }}>{label}</span>
                <span style={{ borderBottom: "1px solid #999", flex: 1, minWidth: "80px", paddingLeft: "4px" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Customer Details */}
        <div style={{ margin: "8px 16px" }}>
          <div style={{ background: NAVY, color: "white", padding: "5px 10px", fontWeight: "bold", fontSize: "11px", letterSpacing: "1px", marginBottom: "0" }}>
            CUSTOMER DETAILS (BUYER)
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", border: `1px solid ${NAVY}` }}>
            <tbody>
              <tr>
                <td style={{ padding: "4px 8px", fontWeight: "bold", width: "10%", color: NAVY }}>Name</td>
                <td style={{ padding: "4px 8px", width: "2%" }}>:</td>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid #ccc", width: "28%" }}>{invoice.customerName || ""}</td>
                <td style={{ padding: "4px 8px", fontWeight: "bold", width: "10%", color: NAVY }}>Address</td>
                <td style={{ padding: "4px 8px", width: "2%" }}>:</td>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid #ccc" }}></td>
              </tr>
              <tr>
                <td style={{ padding: "4px 8px", fontWeight: "bold", color: NAVY }}>Phone</td>
                <td style={{ padding: "4px 8px" }}>:</td>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid #ccc" }}>{invoice.customerMobile || ""}</td>
                <td style={{ padding: "4px 8px", fontWeight: "bold", color: NAVY }}>Nationality</td>
                <td style={{ padding: "4px 8px" }}>:</td>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid #ccc" }}>{(invoice as any).customerNationality || ""}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 8px", fontWeight: "bold", color: NAVY }}>Email</td>
                <td style={{ padding: "4px 8px" }}>:</td>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid #ccc" }}>{invoice.customerEmail || ""}</td>
                <td style={{ padding: "4px 8px", fontWeight: "bold", color: NAVY }}>Country</td>
                <td style={{ padding: "4px 8px" }}>:</td>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid #ccc" }}>{(invoice as any).customerCountry || ""}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 8px", fontWeight: "bold", color: NAVY }}>Passport</td>
                <td style={{ padding: "4px 8px" }}>:</td>
                <td style={{ padding: "4px 8px", borderBottom: "1px solid #ccc" }}>{invoice.customerPassportNumber || ""}</td>
                <td colSpan={3}></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Items Table */}
        <div style={{ margin: "8px 16px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
            <thead>
              <tr style={{ background: NAVY, color: "white" }}>
                <th style={{ padding: "6px 6px", textAlign: "center", border: `1px solid ${NAVY}`, width: "5%" }}>S.No.</th>
                <th style={{ padding: "6px 8px", textAlign: "left", border: `1px solid ${NAVY}`, width: "22%" }}>Stock Description</th>
                <th style={{ padding: "6px 6px", textAlign: "center", border: `1px solid ${NAVY}`, width: "10%" }}>Gross Wt.</th>
                <th style={{ padding: "6px 6px", textAlign: "center", border: `1px solid ${NAVY}`, width: "10%" }}>Purity</th>
                <th style={{ padding: "6px 6px", textAlign: "center", border: `1px solid ${NAVY}`, width: "10%" }}>Pure Wt.</th>
                <th style={{ padding: "6px 6px", textAlign: "center", border: `1px solid ${NAVY}`, width: "10%" }}>Making<br />Rate</th>
                <th style={{ padding: "6px 6px", textAlign: "center", border: `1px solid ${NAVY}`, width: "12%" }}>Making Amt.<br />(AED)</th>
                <th style={{ padding: "6px 6px", textAlign: "center", border: `1px solid ${NAVY}`, width: "10%" }}>Total<br />(AED)</th>
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
              {/* Total row */}
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
          <table style={{ width: "60%", borderCollapse: "collapse", fontSize: "10px" }}>
            <tbody>
              <tr>
                <td style={{ padding: "4px 10px", border: "1px solid #ccc" }}>
                  GOLD VALUE @ {metalRate > 0 ? metalRate.toFixed(3) : "0.000"} / GOZ (AED)
                </td>
                <td style={{ padding: "4px 10px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold", minWidth: "80px" }}>
                  {fmt(totalBeforeVat)}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", border: "1px solid #ccc" }}>Total Amount Before VAT (AED)</td>
                <td style={{ padding: "4px 10px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold" }}>{fmt(totalBeforeVat)}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", border: "1px solid #ccc" }}>Total VAT Amount ({vatRate}%) (AED)</td>
                <td style={{ padding: "4px 10px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold" }}>{fmt(vatAmount)}</td>
              </tr>
              <tr>
                <td style={{ padding: "4px 10px", border: "1px solid #ccc" }}>Round Off Discount (AED)</td>
                <td style={{ padding: "4px 10px", textAlign: "right", border: "1px solid #ccc", fontWeight: "bold" }}>{fmt(roundOffDiscount)}</td>
              </tr>
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
        <div style={{ margin: "16px 16px 8px", display: "flex", justifyContent: "space-between" }}>
          {["Customer's Signature", "Checked By", "Authorised Signature"].map((label) => (
            <div key={label} style={{ textAlign: "center", width: "30%" }}>
              <div style={{ fontWeight: "bold", fontSize: "10px", color: NAVY, marginBottom: "24px" }}>{label}</div>
              <div style={{ borderTop: "1px solid #333", paddingTop: "4px", fontSize: "9px", color: "#666" }}>
                ____________________
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

      {invoice.notes && (
        <div className="mt-4 p-4 bg-muted/40 rounded text-sm no-print">
          <span className="font-medium">Notes: </span>{invoice.notes}
        </div>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; margin: 0; padding: 0; }
          @page { margin: 10mm; }
        }
      `}</style>
    </div>
  );
}
