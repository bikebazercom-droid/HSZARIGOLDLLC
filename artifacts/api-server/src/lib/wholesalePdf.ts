/**
 * Wholesale PDF generators using the shared branded PDF layout.
 */

import { createBrandedPdf, PDF_BRAND } from "./pdfBranding.js";
import { STOCK_CATEGORY_LABEL } from "./stockCategories.js";

const SIDE_MARGIN = 40;

function money(v: number): string {
  return v.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function wt(v: number): string {
  return v.toLocaleString("en-AE", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}
function displayDate(d: string): string {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

function pricingTypeLabel(pricingType: string): string {
  if (pricingType === "fixed") return "Fixed Gold Pricing";
  if (pricingType === "cash") return "Cash Payment";
  return "Unfixed Gold Delivery";
}

// ── Wholesale Invoice PDF ────────────────────────────────────────────────────

export interface WholesaleInvoicePdfItem {
  description: string;
  category: string;
  quantity: number;
  grossGrams: number;
  purityMultiplier: number;
  pureGrams: number;
  rateAedPerGram: number | null;
  makingAed: number;
  totalAed: number;
}

export interface WholesaleInvoicePdfData {
  invoiceNumber: string;
  invoiceDate: string;
  traderName: string;
  traderPhone?: string | null;
  traderEmail?: string | null;
  traderAddress?: string | null;
  traderTrn?: string | null;
  pricingType: string;
  status: string;
  totalGrossGrams: number;
  totalPureGrams: number;
  totalMakingAed: number;
  totalAed: number;
  notes?: string | null;
  items: WholesaleInvoicePdfItem[];
  generatedAt?: Date;
}

export function createWholesaleInvoicePdf(data: WholesaleInvoicePdfData): PDFKit.PDFDocument {
  const { doc, left, width, contentBottom, finish, ensureSpace } = createBrandedPdf({
    title: `Wholesale Invoice ${data.invoiceNumber}`,
    generatedAt: data.generatedAt,
  });

  let y = 136; // content starts here after the branded header

  // Meta info
  const metaRows: Array<[string, string]> = [
    ["Invoice No:", data.invoiceNumber],
    ["Date:", displayDate(data.invoiceDate)],
    ["Pricing Type:", pricingTypeLabel(data.pricingType)],
    ["Status:", data.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())],
  ];
  doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(8);
  for (const [label, val] of metaRows) {
    doc.text(label, left, y, { width: 72, lineBreak: false });
    if (label === "Pricing Type:") {
      const badgeX = left + 74;
      const badgeWidth = Math.min(width - 74, doc.font("Helvetica-Bold").widthOfString(val) + 14);
      doc.roundedRect(badgeX, y - 3, badgeWidth, 13, 4).fill(PDF_BRAND.gold);
      doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7)
        .text(val, badgeX + 7, y, { width: badgeWidth - 14, lineBreak: false });
    } else {
      doc.font("Helvetica").fillColor("#20252b").fontSize(8)
        .text(val, left + 74, y, { width: width - 74, lineBreak: false });
    }
    doc.font("Helvetica-Bold").fontSize(8).fillColor(PDF_BRAND.navy);
    y += 14;
  }

  // Trader panel
  y += 8;
  doc.rect(left, y, width, 18).fill(PDF_BRAND.navy);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(8).text("TRADER / PARTY DETAILS", left + 6, y + 5, { width: width - 12, lineBreak: false });
  y += 18;
  const traderFields: Array<[string, string]> = [
    ["Name:", data.traderName],
    ["Phone:", data.traderPhone ?? "-"],
    ["Email:", data.traderEmail ?? "-"],
    ["Address:", data.traderAddress ?? "-"],
    ["TRN:", data.traderTrn ?? "-"],
  ];
  for (const [label, val] of traderFields) {
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7.5).text(`${label} `, left + 6, y, { continued: true, lineBreak: false });
    doc.font("Helvetica").fillColor("#20252b").text(val, { lineBreak: false });
    y += 12;
  }

  // Items table
  y += 10;
  const cols = [
    { label: "Item / Description", w: 120 },
    { label: "Qty", w: 30 },
    { label: "Gross g", w: 55 },
    { label: "Purity", w: 45 },
    { label: "Pure g", w: 55 },
    { label: "Rate AED/g", w: 60 },
    { label: "Making AED", w: 60 },
    { label: "Total AED", w: 0 }, // fills remaining
  ];
  const lastColW = Math.max(70, width - cols.slice(0, -1).reduce((s, c) => s + c.w, 0));
  cols[cols.length - 1]!.w = lastColW;

  // Header row
  let x = left;
  for (const col of cols) {
    doc.rect(x, y, col.w, 20).fillAndStroke(PDF_BRAND.navy, "#fff");
    doc.fillColor("white").font("Helvetica-Bold").fontSize(6.5)
      .text(col.label, x + 3, y + 7, { width: col.w - 6, align: "center", lineBreak: false });
    x += col.w;
  }
  y += 20;

  for (const [idx, item] of data.items.entries()) {
    y = ensureSpace(y, 18);
    const bg = idx % 2 === 0 ? "#f9fafb" : "#ffffff";
    const vals = [
      `${STOCK_CATEGORY_LABEL[item.category] ?? item.category}: ${item.description}`,
      String(item.quantity),
      wt(item.grossGrams),
      `${(item.purityMultiplier * 100).toFixed(2)}%`,
      wt(item.pureGrams),
      item.rateAedPerGram != null ? money(item.rateAedPerGram) : "-",
      money(item.makingAed),
      money(item.totalAed),
    ];
    x = left;
    for (const [ci, col] of cols.entries()) {
      doc.rect(x, y, col.w, 18).fillAndStroke(bg, "#d1d5db");
      doc.fillColor("#20252b").font("Helvetica").fontSize(6.5)
        .text(vals[ci] ?? "", x + 3, y + 5, { width: col.w - 6, lineBreak: false, ellipsis: true, align: ci > 0 ? "center" : "left" });
      x += col.w;
    }
    y += 18;
  }

  // Totals row
  y = ensureSpace(y, 20);
  const totVals = ["TOTALS", "", wt(data.totalGrossGrams), "", wt(data.totalPureGrams), "", money(data.totalMakingAed), money(data.totalAed)];
  x = left;
  for (const [ci, col] of cols.entries()) {
    doc.rect(x, y, col.w, 20).fillAndStroke("#eef2f7", "#c9ced6");
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7)
      .text(totVals[ci] ?? "", x + 3, y + 6, { width: col.w - 6, lineBreak: false, align: ci > 0 ? "center" : "left" });
    x += col.w;
  }
  y += 20;

  if (data.notes) {
    y += 8;
    y = ensureSpace(y, 30);
    doc.roundedRect(left, y, width, 24, 2).fillAndStroke("#fff", "#d1d5db");
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7).text("Notes: ", left + 6, y + 8, { continued: true, lineBreak: false });
    doc.font("Helvetica").fillColor("#20252b").text(data.notes, { lineBreak: false, ellipsis: true, width: width - 60 });
    y += 24;
  }

  void contentBottom;
  finish(y + 10);
  return doc;
}

// ── Wholesale Return Voucher PDF ─────────────────────────────────────────────

export interface WholesaleReturnLinePdf {
  description: string;
  category: string;
  grossWeightGrams: number;
  pureWeightGrams: number;
  returnedMakingAed: number;
  returnedMetalAed: number;
  returnedAed: number;
}

export interface WholesaleReturnPdfData {
  returnNumber: string;
  invoiceNumber: string;
  returnDate: string;
  traderName: string;
  note?: string | null;
  totalReturnedGrossGrams: number;
  totalReturnedPureGrams: number;
  totalReturnedMakingAed: number;
  totalReturnedMetalAed: number;
  totalReturnedAed: number;
  lines: WholesaleReturnLinePdf[];
  generatedAt?: Date;
}

export function createWholesaleReturnPdf(data: WholesaleReturnPdfData): PDFKit.PDFDocument {
  const { doc, left, width, finish, ensureSpace } = createBrandedPdf({
    title: `Wholesale Return Voucher ${data.returnNumber}`,
    generatedAt: data.generatedAt,
  });

  let y = 136;

  const metaRows: Array<[string, string]> = [
    ["Return No:", data.returnNumber],
    ["Against Invoice:", data.invoiceNumber],
    ["Date:", displayDate(data.returnDate)],
    ["Trader:", data.traderName],
  ];
  for (const [label, val] of metaRows) {
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(8).text(`${label} `, left, y, { continued: true, lineBreak: false });
    doc.font("Helvetica").fillColor("#20252b").text(val, { lineBreak: false });
    y += 14;
  }

  y += 10;
  const cols = [
    { label: "Item / Category", w: 168 },
    { label: "Gross (g)", w: 82 },
    { label: "Pure (g)", w: 82 },
    { label: "Making AED", w: 82 },
    { label: "Metal AED", w: 0 },
  ];
  cols[4]!.w = width - 168 - 82 - 82 - 82;
  let x = left;
  for (const col of cols) {
    doc.rect(x, y, col.w, 20).fillAndStroke(PDF_BRAND.navy, "#fff");
    doc.fillColor("white").font("Helvetica-Bold").fontSize(7).text(col.label, x + 3, y + 6, { width: col.w - 6, align: "center", lineBreak: false });
    x += col.w;
  }
  y += 20;

  for (const [idx, line] of data.lines.entries()) {
    y = ensureSpace(y, 18);
    const bg = idx % 2 === 0 ? "#f9fafb" : "#ffffff";
    const vals = [
      `${STOCK_CATEGORY_LABEL[line.category] ?? line.category}: ${line.description}`,
      wt(line.grossWeightGrams),
      wt(line.pureWeightGrams),
      money(line.returnedMakingAed),
      money(line.returnedMetalAed),
    ];
    x = left;
    for (const [ci, col] of cols.entries()) {
      doc.rect(x, y, col.w, 18).fillAndStroke(bg, "#d1d5db");
      doc.fillColor("#20252b").font("Helvetica").fontSize(7)
        .text(vals[ci] ?? "", x + 3, y + 5, { width: col.w - 6, lineBreak: false, align: ci > 0 ? "center" : "left" });
      x += col.w;
    }
    y += 18;
  }

  y = ensureSpace(y, 20);
  const tVals = [
    "TOTALS",
    wt(data.totalReturnedGrossGrams),
    wt(data.totalReturnedPureGrams),
    money(data.totalReturnedMakingAed),
    money(data.totalReturnedMetalAed),
  ];
  x = left;
  for (const [ci, col] of cols.entries()) {
    doc.rect(x, y, col.w, 20).fillAndStroke("#eef2f7", "#c9ced6");
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7.5)
      .text(tVals[ci] ?? "", x + 3, y + 6, { width: col.w - 6, lineBreak: false, align: ci > 0 ? "center" : "left" });
    x += col.w;
  }
  y += 20;
  y = ensureSpace(y, 18);
  doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(8)
    .text(`Total AED Reversed: ${money(data.totalReturnedAed)}`, left, y + 5, {
      width,
      align: "right",
      lineBreak: false,
    });
  y += 18;

  if (data.note) {
    y += 8;
    y = ensureSpace(y, 24);
    doc.roundedRect(left, y, width, 20, 2).fillAndStroke("#fff", "#d1d5db");
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7).text("Note: ", left + 6, y + 6, { continued: true, lineBreak: false });
    doc.font("Helvetica").fillColor("#20252b").text(data.note, { lineBreak: false });
    y += 20;
  }

  finish(y + 10);
  return doc;
}

// ── Trader Statement PDF ─────────────────────────────────────────────────────

export interface TraderStatementEntry {
  id: number;
  eventDate: string;
  eventType: string;
  aedDelta: number;
  pureGoldGramsDelta: number;
  note?: string | null;
  wholesaleInvoiceId?: number | null;
}

export interface TraderStatementPdfData {
  traderName: string;
  traderPhone?: string | null;
  traderTrn?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  entries: TraderStatementEntry[];
  balanceAed: number;
  balancePureGrams: number;
  generatedAt?: Date;
}

export function createTraderStatementPdf(data: TraderStatementPdfData): PDFKit.PDFDocument {
  const { doc, left, width, finish, ensureSpace } = createBrandedPdf({
    title: `Trader Statement: ${data.traderName}`,
    generatedAt: data.generatedAt,
  });

  let y = 136;

  doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(8).text(`Trader: ${data.traderName}`, left, y, { lineBreak: false });
  y += 13;
  if (data.traderPhone) { doc.fontSize(7.5).text(`Phone: ${data.traderPhone}`, left, y, { lineBreak: false }); y += 12; }
  if (data.traderTrn) { doc.fontSize(7.5).text(`TRN: ${data.traderTrn}`, left, y, { lineBreak: false }); y += 12; }
  if (data.startDate || data.endDate) {
    doc.fontSize(7.5).text(`Period: ${data.startDate ?? "beginning"} to ${data.endDate ?? "present"}`, left, y, { lineBreak: false });
    y += 12;
  }

  y += 8;
  const cols = [
    { label: "Date", w: 80 },
    { label: "Type", w: 100 },
    { label: "Note", w: 0 },
    { label: "AED (+/-)", w: 90 },
    { label: "Pure g (+/-)", w: 90 },
  ];
  cols[2]!.w = width - 80 - 100 - 90 - 90;

  let x = left;
  for (const col of cols) {
    doc.rect(x, y, col.w, 20).fillAndStroke(PDF_BRAND.navy, "#fff");
    doc.fillColor("white").font("Helvetica-Bold").fontSize(6.5).text(col.label, x + 3, y + 6, { width: col.w - 6, align: "center", lineBreak: false });
    x += col.w;
  }
  y += 20;

  for (const [idx, entry] of data.entries.entries()) {
    y = ensureSpace(y, 16);
    const bg = idx % 2 === 0 ? "#f9fafb" : "#fff";
    const eventLabel: Record<string, string> = {
      delivery: "Delivery (unfixed)",
      fixed_sale: "Fixed Sale",
      cash_payment: "Cash Payment",
      cash_refund: "Cash Refund",
      rate_fix: "Rate Fix",
      physical_return: "Return",
    };
    const vals = [
      new Date(`${entry.eventDate}T00:00:00Z`).toLocaleDateString("en-AE"),
      eventLabel[entry.eventType] ?? entry.eventType,
      entry.note ?? "-",
      entry.aedDelta >= 0 ? `+${money(entry.aedDelta)}` : money(entry.aedDelta),
      entry.pureGoldGramsDelta >= 0 ? `+${wt(entry.pureGoldGramsDelta)}` : wt(entry.pureGoldGramsDelta),
    ];
    x = left;
    for (const [ci, col] of cols.entries()) {
      doc.rect(x, y, col.w, 16).fillAndStroke(bg, "#d1d5db");
      const isAed = ci === 3;
      const isGram = ci === 4;
      const val = vals[ci] ?? "";
      const color = (isAed || isGram) && val.startsWith("+") ? "#15803d" : (isAed || isGram) && val.startsWith("-") ? "#dc2626" : "#20252b";
      doc.fillColor(color).font("Helvetica").fontSize(6.5)
        .text(val, x + 3, y + 4, { width: col.w - 6, lineBreak: false, ellipsis: true, align: ci >= 3 ? "right" : "left" });
      x += col.w;
    }
    y += 16;
  }

  // Balance row
  y = ensureSpace(y, 22);
  const balVals = ["", "BALANCE", "", `AED ${money(data.balanceAed)}`, `${wt(data.balancePureGrams)} g`];
  x = left;
  for (const [ci, col] of cols.entries()) {
    doc.rect(x, y, col.w, 22).fillAndStroke("#eef2f7", "#c9ced6");
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7.5)
      .text(balVals[ci] ?? "", x + 3, y + 7, { width: col.w - 6, lineBreak: false, align: ci >= 3 ? "right" : "left" });
    x += col.w;
  }
  y += 22;

  finish(y + 10);
  return doc;
}

// ── Wholesale Summary Report PDF ─────────────────────────────────────────────

export interface WholesaleSummaryPdfData {
  startDate?: string | null;
  endDate?: string | null;
  invoiceCount: number;
  fixedInvoiceCount: number;
  unfixedInvoiceCount: number;
  cashInvoiceCount: number;
  settledInvoiceCount: number;
  totalFixedAed: number;
  openPureGrams: number;
  returnedGrossGrams: number;
  traderCount: number;
  generatedAt?: Date;
}

export function createWholesaleSummaryPdf(data: WholesaleSummaryPdfData): PDFKit.PDFDocument {
  const { doc, left, width, finish } = createBrandedPdf({
    title: "Wholesale Summary Report",
    generatedAt: data.generatedAt,
  });

  let y = 136;

  if (data.startDate || data.endDate) {
    doc.fillColor(PDF_BRAND.navy).font("Helvetica").fontSize(8)
      .text(`Period: ${data.startDate ?? "all time"} to ${data.endDate ?? "present"}`, left, y, { lineBreak: false });
    y += 16;
  }

  const rows: Array<[string, string]> = [
    ["Total Invoices", String(data.invoiceCount)],
    ["Fixed Invoices", String(data.fixedInvoiceCount)],
    ["Unfixed Invoices", String(data.unfixedInvoiceCount)],
    ["Cash Payment Invoices", String(data.cashInvoiceCount)],
    ["Settled Invoices", String(data.settledInvoiceCount)],
    ["Total AED Posted", `AED ${money(data.totalFixedAed)}`],
    ["Open Pure Grams (Unfixed)", `${wt(data.openPureGrams)} g`],
    ["Total Returned Gross Grams", `${wt(data.returnedGrossGrams)} g`],
    ["Active Traders", String(data.traderCount)],
  ];

  const rowH = 26;
  for (const [idx, [label, val]] of rows.entries()) {
    const bg = idx % 2 === 0 ? "#f9fafb" : "#fff";
    doc.rect(left, y, width / 2, rowH).fillAndStroke(bg, "#d1d5db");
    doc.rect(left + width / 2, y, width / 2, rowH).fillAndStroke(bg, "#d1d5db");
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(9)
      .text(label, left + 8, y + 8, { width: width / 2 - 16, lineBreak: false });
    doc.fillColor("#20252b").font("Helvetica-Bold").fontSize(10)
      .text(val, left + width / 2 + 8, y + 7, { width: width / 2 - 16, lineBreak: false, align: "right" });
    y += rowH;
  }

  finish(y + 10);
  return doc;
}

void SIDE_MARGIN;
