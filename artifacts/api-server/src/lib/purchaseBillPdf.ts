import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import {
  BISMILLAH_ARABIC,
  PDF_ARABIC_FONT_NAME,
  PDF_BRAND,
  registerPdfArabicFont,
} from "./pdfBranding.js";
import { STOCK_CATEGORY_LABEL } from "./stockCategories.js";

export interface PurchaseBillPdfItem {
  category: string;
  grossWeightGrams: number;
  purityPercent: number;
  pureWeightGrams: number;
  rateAedPerG: number;
  makingChargeAed: number;
  lineTotalAed: number;
}

export interface PurchaseBillPdfData {
  billNo: string;
  billDate: string;
  supplierName: string;
  supplierPhone?: string | null;
  supplierEmail?: string | null;
  supplierAddress?: string | null;
  purchaseType: string;
  paymentStatus: string;
  totalGrossGrams: number;
  totalPureGrams: number;
  totalAed: number;
  notes?: string | null;
  items: PurchaseBillPdfItem[];
  generatedAt?: Date;
}

const SIDE_MARGIN = 40;
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - SIDE_MARGIN * 2;
const BANNER_HEIGHT = 30;
const TABLE_ROW_HEIGHT = 20;
const TABLE_HEADER_HEIGHT = 32;
const TABLE_ROW_BOTTOM = 666;
const SIGNATURE_LINE_Y = PAGE_HEIGHT - BANNER_HEIGHT - 42;
const FINAL_CONTENT_BOTTOM = 674;

const CATEGORY_LABEL: Record<string, string> = STOCK_CATEGORY_LABEL;

function resolveAsset(filename: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const entryDir = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : moduleDir;
  const candidates = [
    path.resolve(process.cwd(), "assets", filename),
    path.resolve(process.cwd(), "artifacts/api-server/assets", filename),
    path.resolve(entryDir, "../assets", filename),
    path.resolve(moduleDir, "../assets", filename),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Missing required purchase-bill PDF asset: ${filename}`);
  return found;
}

const LOGO_PATH = resolveAsset("hazari-gold-logo.jpg");
const STAMP_PATH = resolveAsset("hazari-gold-stamp.png");
const LOCATION_QR_PATH = resolveAsset("hazari-gold-location-qr.png");

function money(value: number): string {
  return value.toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function weight(value: number): string {
  return value.toLocaleString("en-AE", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function numberToWords(value: number): string {
  if (value === 0) return "Zero Dirhams Only";
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const convert = (number: number): string => {
    if (number === 0) return "";
    if (number < 20) return ones[number] ?? "";
    if (number < 100) {
      return `${tens[Math.floor(number / 10)]}${number % 10 ? ` ${ones[number % 10]}` : ""}`;
    }
    if (number < 1_000) {
      return `${ones[Math.floor(number / 100)]} Hundred${number % 100 ? ` ${convert(number % 100)}` : ""}`;
    }
    if (number < 1_000_000) {
      return `${convert(Math.floor(number / 1_000))} Thousand${number % 1_000 ? ` ${convert(number % 1_000)}` : ""}`;
    }
    return `${convert(Math.floor(number / 1_000_000))} Million${number % 1_000_000 ? ` ${convert(number % 1_000_000)}` : ""}`;
  };

  const absolute = Math.abs(value);
  const dirhams = Math.floor(absolute);
  const fils = Math.round((absolute - dirhams) * 100);
  return `${convert(dirhams)} Dirhams${fils ? ` and ${convert(fils)} Fils` : ""} Only`;
}

function displayDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

function paymentLabel(status: string): string {
  if (status === "paid") return "PAID IN CASH";
  if (status === "unpaid") return "UNPAID / LIABILITY";
  return "UNFIXED BALANCE";
}

function purchaseTypeLabel(type: string): string {
  return type === "fixed" ? "Fixed Purchase" : "Unfixed Purchase";
}

function drawFirstPageHeader(doc: PDFKit.PDFDocument, data: PurchaseBillPdfData): void {
  const NAVY = PDF_BRAND.navy;
  const GOLD = PDF_BRAND.gold;

  doc.rect(0, 0, PAGE_WIDTH, 4).fill(GOLD);
  doc.fillColor(GOLD).font(PDF_ARABIC_FONT_NAME).fontSize(14)
    .text(BISMILLAH_ARABIC, 180, 4, {
      width: 235,
      align: "center",
      lineBreak: false,
    });
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9.5)
    .text("PARTY COPY", 440, 10, { width: 115, align: "right", lineBreak: false });

  doc.image(LOGO_PATH, SIDE_MARGIN, 26, { fit: [102, 51], valign: "center" });
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10.5)
    .text(PDF_BRAND.companyName, SIDE_MARGIN, 82, { width: 170, lineBreak: false });
  doc.fillColor("#303640").font("Helvetica").fontSize(6.8)
    .text(PDF_BRAND.address, SIDE_MARGIN, 98, { width: 170, height: 27, ellipsis: true });
  doc.fontSize(6.8)
    .text(`Phone: ${PDF_BRAND.phone}`, SIDE_MARGIN, 127, { width: 170, lineBreak: false })
    .text(`Email: ${PDF_BRAND.email}`, SIDE_MARGIN, 138, { width: 170, lineBreak: false })
    .text(`TRN: ${PDF_BRAND.trn}`, SIDE_MARGIN, 149, { width: 170, lineBreak: false });

  const badgeX = 228;
  const badgeWidth = 140;
  doc.roundedRect(badgeX, 27, badgeWidth, 39, 3).fill(NAVY);
  for (const centerX of [badgeX + 16, badgeX + badgeWidth - 16]) {
    doc.save();
    doc.translate(centerX, 46).rotate(45).rect(-3, -3, 6, 6).fill(GOLD);
    doc.restore();
  }
  doc.fillColor("white").font("Helvetica-Bold").fontSize(12)
    .text("PURCHASE\nBILL", badgeX + 24, 34, {
      width: badgeWidth - 48,
      height: 29,
      align: "center",
      lineGap: 1,
    });

  doc.roundedRect(badgeX + 37, 73, 66, 66, 2).lineWidth(0.5).strokeColor("#d1d5db").stroke();
  doc.image(LOCATION_QR_PATH, badgeX + 40, 76, { fit: [60, 60], align: "center", valign: "center" });
  doc.fillColor("#777").font("Helvetica").fontSize(6.2)
    .text("Scan to find us", badgeX, 143, { width: badgeWidth, align: "center", lineBreak: false });

  const uniqueRates = [...new Set(data.items.map((item) => money(item.rateAedPerG)))];
  const metalRate = uniqueRates.length === 1 ? `AED ${uniqueRates[0]}/g` : uniqueRates.length > 1 ? "Multiple rates" : "";
  const meta: Array<[string, string]> = [
    ["Bill / Ref No:", data.billNo],
    ["Date:", displayDate(data.billDate)],
    ["Payment Terms:", paymentLabel(data.paymentStatus)],
    ["Purchase Type:", purchaseTypeLabel(data.purchaseType)],
    ["Metal Rate:", metalRate],
  ];
  let metaY = 31;
  for (const [label, value] of meta) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(7.2)
      .text(label, 393, metaY, { width: 75, lineBreak: false });
    doc.strokeColor("#aab0b8").lineWidth(0.5).moveTo(468, metaY + 9).lineTo(555, metaY + 9).stroke();
    const valueFontSize = value.length > 22 ? 5.4 : value.length > 18 ? 6.2 : 7;
    doc.fillColor("#20252b").font("Helvetica").fontSize(valueFontSize)
      .text(value, 470, metaY + (7 - valueFontSize) / 2, { width: 84, lineBreak: false });
    metaY += 21;
  }
}

function drawSupplierPanel(doc: PDFKit.PDFDocument, data: PurchaseBillPdfData): number {
  const top = 166;
  const NAVY = PDF_BRAND.navy;
  doc.rect(SIDE_MARGIN, top, CONTENT_WIDTH, 22).fill(NAVY);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(8.7)
    .text("SUPPLIER / VENDOR DETAILS", SIDE_MARGIN + 8, top + 7, {
      width: CONTENT_WIDTH - 16,
      lineBreak: false,
    });

  const bodyTop = top + 22;
  const bodyHeight = 58;
  const middle = SIDE_MARGIN + CONTENT_WIDTH / 2;
  doc.rect(SIDE_MARGIN, bodyTop, CONTENT_WIDTH, bodyHeight).fillAndStroke("#ffffff", NAVY);
  doc.strokeColor(NAVY).lineWidth(0.7).moveTo(middle, bodyTop).lineTo(middle, bodyTop + bodyHeight).stroke();

  const fields: Array<{ x: number; y: number; label: string; value: string }> = [
    { x: SIDE_MARGIN + 8, y: bodyTop + 9, label: "Supplier / Party Name", value: data.supplierName },
    { x: SIDE_MARGIN + 8, y: bodyTop + 34, label: "Phone Number", value: data.supplierPhone ?? "" },
    { x: middle + 8, y: bodyTop + 9, label: "Address / Location", value: data.supplierAddress ?? "" },
    { x: middle + 8, y: bodyTop + 34, label: "Email Address", value: data.supplierEmail ?? "" },
  ];
  for (const field of fields) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(7.2)
      .text(field.label, field.x, field.y, { width: 86, lineBreak: false });
    doc.fillColor(NAVY).font("Helvetica").fontSize(7.2)
      .text(":", field.x + 88, field.y, { width: 5, lineBreak: false });
    doc.strokeColor("#9ca3af").lineWidth(0.45)
      .moveTo(field.x + 98, field.y + 10)
      .lineTo(field.x + CONTENT_WIDTH / 2 - 18, field.y + 10)
      .stroke();
    doc.fillColor("#20252b").font("Helvetica").fontSize(7.3)
      .text(field.value, field.x + 100, field.y, {
        width: CONTENT_WIDTH / 2 - 122,
        lineBreak: false,
        ellipsis: true,
      });
  }
  return bodyTop + bodyHeight + 10;
}

type TableColumn = {
  label: string;
  width: number;
  align: "left" | "center" | "right";
};

const TABLE_COLUMNS: TableColumn[] = [
  { label: "S.No.", width: 30, align: "center" },
  { label: "Stock Description", width: 125, align: "left" },
  { label: "Gross Wt.", width: 60, align: "center" },
  { label: "Purity", width: 50, align: "center" },
  { label: "Pure Wt.", width: 60, align: "center" },
  { label: "Making\nRate", width: 60, align: "center" },
  { label: "Making Amt.\n(AED)", width: 65, align: "center" },
  { label: "Total\n(AED)", width: 65, align: "right" },
];

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  let x = SIDE_MARGIN;
  for (const column of TABLE_COLUMNS) {
    doc.rect(x, y, column.width, TABLE_HEADER_HEIGHT).fillAndStroke(PDF_BRAND.navy, "#ffffff");
    doc.fillColor("white").font("Helvetica-Bold").fontSize(6.5)
      .text(column.label, x + 4, y + (column.label.includes("\n") ? 8 : 12), {
        width: column.width - 8,
        align: column.align,
        lineBreak: true,
      });
    x += column.width;
  }
  return y + TABLE_HEADER_HEIGHT;
}

function drawContinuationHeading(doc: PDFKit.PDFDocument, data: PurchaseBillPdfData): number {
  doc.rect(0, 0, PAGE_WIDTH, 4).fill(PDF_BRAND.gold);
  doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(9)
    .text(`PURCHASE BILL · ${data.billNo}`, SIDE_MARGIN, 20, {
      width: CONTENT_WIDTH,
      lineBreak: false,
    });
  return drawTableHeader(doc, 42);
}

function drawItemRow(
  doc: PDFKit.PDFDocument,
  item: PurchaseBillPdfItem | null,
  rowNumber: number,
  y: number,
): number {
  const values = item
    ? [
        String(rowNumber),
        `${CATEGORY_LABEL[item.category] ?? item.category} @ AED ${money(item.rateAedPerG)}/g`,
        weight(item.grossWeightGrams),
        `${weight(item.purityPercent)}%`,
        weight(item.pureWeightGrams),
        "-",
        item.makingChargeAed ? money(item.makingChargeAed) : "-",
        money(item.lineTotalAed),
      ]
    : [String(rowNumber), "", "", "", "", "", "", ""];
  let x = SIDE_MARGIN;
  for (const [index, column] of TABLE_COLUMNS.entries()) {
    const background = rowNumber % 2 === 0 ? "#f9fafb" : "#ffffff";
    doc.rect(x, y, column.width, TABLE_ROW_HEIGHT).fillAndStroke(background, "#d1d5db");
    doc.fillColor(item ? "#20252b" : "#c4c8ce")
      .font(index === 7 && item ? "Helvetica-Bold" : "Helvetica")
      .fontSize(6.8)
      .text(values[index] ?? "", x + 4, y + 7, {
        width: column.width - 8,
        align: column.align,
        lineBreak: false,
        ellipsis: true,
      });
    x += column.width;
  }
  return y + TABLE_ROW_HEIGHT;
}

function drawTotalRow(doc: PDFKit.PDFDocument, data: PurchaseBillPdfData, y: number): number {
  const widths = [155, 60, 50, 60, 60, 65, 65];
  const values = [
    `Total (${data.items.length} Items)`,
    weight(data.totalGrossGrams),
    "-",
    weight(data.totalPureGrams),
    "-",
    money(data.items.reduce((sum, item) => sum + item.makingChargeAed, 0)),
    money(data.totalAed),
  ];
  let x = SIDE_MARGIN;
  for (const [index, widthValue] of widths.entries()) {
    doc.rect(x, y, widthValue, TABLE_ROW_HEIGHT).fillAndStroke("#eef2f7", "#c9ced6");
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7)
      .text(values[index] ?? "", x + 5, y + 7, {
        width: widthValue - 10,
        align: index === 0 ? "left" : index === widths.length - 1 ? "right" : "center",
        lineBreak: false,
      });
    x += widthValue;
  }
  return y + TABLE_ROW_HEIGHT;
}

function drawFinancialSummary(doc: PDFKit.PDFDocument, data: PurchaseBillPdfData, y: number): number {
  // The persisted line/bill totals are authoritative. In particular, settling
  // an unfixed bill prices its pure weight at the fixing rate, so recomputing
  // from gross weight here would overstate the displayed value.
  const goldValue = data.totalAed;
  const uniqueRates = [...new Set(data.items.map((item) => weight(item.rateAedPerG)))];
  const rateLabel = uniqueRates.length === 1 ? ` @ ${uniqueRates[0]} / gram` : "";
  const summaryX = SIDE_MARGIN + 205;
  const summaryWidth = CONTENT_WIDTH - 205;
  const labelWidth = summaryWidth - 92;
  const rows: Array<[string, string, boolean]> = [
    [`GOLD VALUE${rateLabel} (AED)`, money(goldValue), false],
    ["Discount (AED)", money(0), false],
    ["NET AMOUNT (AED)", money(data.totalAed), true],
  ];
  for (const [label, value, primary] of rows) {
    const rowHeight = primary ? 20 : 18;
    doc.rect(summaryX, y, summaryWidth, rowHeight)
      .fillAndStroke(primary ? PDF_BRAND.navy : "#ffffff", "#c9ced6");
    doc.strokeColor(primary ? PDF_BRAND.navy : "#c9ced6").lineWidth(0.5)
      .moveTo(summaryX + labelWidth, y)
      .lineTo(summaryX + labelWidth, y + rowHeight)
      .stroke();
    doc.fillColor(primary ? "white" : "#20252b")
      .font(primary ? "Helvetica-Bold" : "Helvetica")
      .fontSize(primary ? 8 : 7)
      .text(label, summaryX + 6, y + (primary ? 7 : 6), {
        width: labelWidth - 12,
        lineBreak: false,
      });
    doc.font(primary ? "Helvetica-Bold" : "Helvetica-Bold")
      .text(value, summaryX + labelWidth + 5, y + (primary ? 7 : 6), {
        width: summaryWidth - labelWidth - 10,
        align: "right",
        lineBreak: false,
      });
    y += rowHeight;
  }
  return y;
}

function drawAmountAndPayment(doc: PDFKit.PDFDocument, data: PurchaseBillPdfData, y: number): number {
  const rowHeight = 21;
  doc.roundedRect(SIDE_MARGIN, y, CONTENT_WIDTH, rowHeight * 2, 2)
    .fillAndStroke("#ffffff", "#d1d5db");
  doc.strokeColor("#e5e7eb").lineWidth(0.5)
    .moveTo(SIDE_MARGIN, y + rowHeight)
    .lineTo(SIDE_MARGIN + CONTENT_WIDTH, y + rowHeight)
    .stroke();

  doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7.5)
    .text("Amount In Words (AED):", SIDE_MARGIN + 12, y + 7, { width: 130, lineBreak: false })
    .text("Payment Mode:", SIDE_MARGIN + 12, y + rowHeight + 7, { width: 130, lineBreak: false });
  doc.fillColor("#20252b").font("Helvetica-Oblique").fontSize(7.5)
    .text(numberToWords(data.totalAed), SIDE_MARGIN + 146, y + 7, {
      width: CONTENT_WIDTH - 158,
      lineBreak: false,
      ellipsis: true,
    });
  doc.font("Helvetica-Bold")
    .text(paymentLabel(data.paymentStatus), SIDE_MARGIN + 146, y + rowHeight + 7, {
      width: CONTENT_WIDTH - 158,
      lineBreak: false,
    });
  return y + rowHeight * 2;
}

function drawNotes(doc: PDFKit.PDFDocument, notes: string, y: number): number {
  const height = Math.min(34, Math.max(18, doc.heightOfString(notes, { width: CONTENT_WIDTH - 56 }) + 8));
  doc.roundedRect(SIDE_MARGIN, y, CONTENT_WIDTH, height, 2).fillAndStroke("#ffffff", "#d1d5db");
  doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7)
    .text("Notes:", SIDE_MARGIN + 8, y + 6, { width: 42, lineBreak: false });
  doc.fillColor("#303640").font("Helvetica").fontSize(7)
    .text(notes, SIDE_MARGIN + 50, y + 6, {
      width: CONTENT_WIDTH - 58,
      height: height - 10,
      ellipsis: true,
    });
  return y + height;
}

function drawClosing(doc: PDFKit.PDFDocument, generatedAt: Date, totalPages: number): void {
  const labels = ["Customer's Signature", "Checked By", "Authorised Signature"];
  const blockWidth = 145;
  const gap = (CONTENT_WIDTH - blockWidth * 3) / 2;
  const originalBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  try {
    for (const [index, label] of labels.entries()) {
      const x = SIDE_MARGIN + index * (blockWidth + gap);
      doc.strokeColor("#4b5563").lineWidth(0.6)
        .moveTo(x, SIGNATURE_LINE_Y)
        .lineTo(x + blockWidth, SIGNATURE_LINE_Y)
        .stroke();
      doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(7.3)
        .text(label, x, SIGNATURE_LINE_Y + 6, {
          width: blockWidth,
          align: "center",
          lineBreak: false,
        });
      if (index === 2) {
        const stampWidth = 74;
        const stampHeight = 58;
        doc.image(STAMP_PATH, x + (blockWidth - stampWidth) / 2, SIGNATURE_LINE_Y - stampHeight - 12, {
          fit: [stampWidth, stampHeight],
          align: "center",
          valign: "bottom",
        });
      }
    }

    doc.fillColor("#777").font("Helvetica").fontSize(6.2)
      .text(
        `Generated on ${generatedAt.toLocaleString("en-AE")}`,
        SIDE_MARGIN,
        SIGNATURE_LINE_Y - 86,
        { width: 205, lineBreak: false },
      );

    const bannerY = PAGE_HEIGHT - BANNER_HEIGHT;
    doc.rect(0, bannerY, PAGE_WIDTH, BANNER_HEIGHT - 4).fill(PDF_BRAND.navy);
    doc.fillColor("white").font("Helvetica-Bold").fontSize(10)
      .text("Thank you for your business!", SIDE_MARGIN, bannerY + 8, {
        width: CONTENT_WIDTH,
        align: "center",
        lineBreak: false,
      });
    if (totalPages > 1) {
      doc.fillColor("#dbe7f6").font("Helvetica").fontSize(6.2)
        .text(`Page ${totalPages} of ${totalPages}`, PAGE_WIDTH - SIDE_MARGIN - 70, bannerY + 10, {
          width: 70,
          align: "right",
          lineBreak: false,
        });
    }
    doc.rect(0, PAGE_HEIGHT - 4, PAGE_WIDTH, 4).fill(PDF_BRAND.gold);
  } finally {
    doc.restore();
    doc.page.margins.bottom = originalBottomMargin;
  }
}

export function createPurchaseBillPdf(data: PurchaseBillPdfData): PDFKit.PDFDocument {
  const generatedAt = data.generatedAt ?? new Date();
  const doc = new PDFDocument({
    size: "A4",
    bufferPages: true,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    info: {
      Title: `Purchase Bill ${data.billNo}`,
      Author: PDF_BRAND.companyName,
      Subject: `Purchase bill for ${data.supplierName}`,
    },
  });

  registerPdfArabicFont(doc);
  drawFirstPageHeader(doc, data);
  let y = drawSupplierPanel(doc, data);
  y = drawTableHeader(doc, y);

  const itemRows: Array<PurchaseBillPdfItem | null> = [
    ...data.items,
    ...Array.from({ length: Math.max(0, 7 - data.items.length) }, () => null),
  ];
  for (const [index, item] of itemRows.entries()) {
    if (y + TABLE_ROW_HEIGHT > TABLE_ROW_BOTTOM) {
      doc.addPage();
      y = drawContinuationHeading(doc, data);
    }
    y = drawItemRow(doc, item, index + 1, y);
  }

  if (y + TABLE_ROW_HEIGHT > TABLE_ROW_BOTTOM) {
    doc.addPage();
    y = drawContinuationHeading(doc, data);
  }
  y = drawTotalRow(doc, data, y);

  const summaryHeight = 56;
  const notesHeight = data.notes ? 42 : 0;
  const amountHeight = 42;
  const finalContentHeight = 14 + summaryHeight + 10 + notesHeight + 10 + amountHeight;
  if (y + finalContentHeight > FINAL_CONTENT_BOTTOM) {
    doc.addPage();
    y = 42;
    doc.fillColor(PDF_BRAND.navy).font("Helvetica-Bold").fontSize(9)
      .text(`PURCHASE BILL · ${data.billNo} · SUMMARY`, SIDE_MARGIN, 20, {
        width: CONTENT_WIDTH,
        lineBreak: false,
      });
  }

  y += 14;
  y = drawFinancialSummary(doc, data, y);
  if (data.notes) {
    y += 10;
    y = drawNotes(doc, data.notes, y);
  }
  const amountY = Math.max(y + 10, 602);
  drawAmountAndPayment(doc, data, amountY);

  const pageRange = doc.bufferedPageRange();
  const finalPageIndex = pageRange.start + pageRange.count - 1;
  doc.switchToPage(finalPageIndex);
  drawClosing(doc, generatedAt, pageRange.count);
  return doc;
}