import { createBrandedPdf, PDF_BRAND } from "./pdfBranding.js";
import { STOCK_CATEGORY_LABEL } from "./stockCategories.js";

export interface PurchaseStatementRow {
  billDate: string;
  billNo: string;
  supplierName: string;
  category: string;
  grossWeightGrams: number;
  purityPercent: number;
  pureWeightGrams: number;
  rateAedPerG: number;
  lineTotalAed: number;
}

export const PURCHASE_STATEMENT_TEXT_LIMIT = 300;

export interface PurchaseStatementFilters {
  supplier: string | null;
  category: string | null;
  startDate: string | null;
  endDate: string | null;
}

const CATEGORY_LABEL: Record<string, string> = STOCK_CATEGORY_LABEL;

function formatNumber(value: number, fractionDigits: number): string {
  return value.toLocaleString("en-AE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function createPurchaseStatementPdf(
  rows: PurchaseStatementRow[],
  filters: PurchaseStatementFilters,
  generatedAt = new Date(),
) {
  const overLimit = [
    filters.supplier,
    ...rows.flatMap((row) => [row.billNo, row.supplierName]),
  ].find((value) => value && value.length > PURCHASE_STATEMENT_TEXT_LIMIT);
  if (overLimit) {
    throw new RangeError(`Purchase statement text must not exceed ${PURCHASE_STATEMENT_TEXT_LIMIT} characters`);
  }

  const pdf = createBrandedPdf({
    title: "Supplier Purchase Statement",
    layout: "landscape",
    generatedAt,
  });
  const { doc } = pdf;
  const NAVY = PDF_BRAND.navy;
  const GOLD = PDF_BRAND.gold;
  const GRID = PDF_BRAND.grid;
  const LIGHT = "#f5f3ee";
  const ZEBRA = "#f8fafc";
  const W = pdf.width;

  const totalGross = rows.reduce((sum, row) => sum + row.grossWeightGrams, 0);
  const totalPure = rows.reduce((sum, row) => sum + row.pureWeightGrams, 0);
  const totalAed = rows.reduce((sum, row) => sum + row.lineTotalAed, 0);

  const period = filters.startDate || filters.endDate
    ? `${filters.startDate ?? "…"} to ${filters.endDate ?? "…"}`
    : "All Time";
  const criteria = [
    ["Supplier", filters.supplier?.toUpperCase() ?? "All Suppliers"],
    ["Category", filters.category ? (CATEGORY_LABEL[filters.category] ?? filters.category) : "All Categories"],
    ["Period", period],
  ] as const;
  const criteriaGap = 8;
  const criteriaWidth = (W - criteriaGap * 2) / 3;
  doc.font("Helvetica-Bold").fontSize(8.6);
  const criteriaValueHeight = Math.max(...criteria.map(([, value]) => (
    doc.heightOfString(value, { width: criteriaWidth - 20, lineGap: 1 })
  )));
  const criteriaHeight = Math.max(42, Math.ceil(criteriaValueHeight + 28));
  if (criteriaHeight > pdf.contentBottom - pdf.contentTop) {
    throw new RangeError("Purchase statement criteria do not fit within the printable page");
  }
  criteria.forEach(([label, value], index) => {
    const x = pdf.left + index * (criteriaWidth + criteriaGap);
    doc.rect(x, pdf.contentTop, criteriaWidth, criteriaHeight).fillAndStroke(LIGHT, GRID);
    doc.fillColor("#667085").font("Helvetica").fontSize(7)
      .text(label, x + 10, pdf.contentTop + 8, { width: criteriaWidth - 20, lineBreak: false });
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(8.6)
      .text(value, x + 10, pdf.contentTop + 21, {
        width: criteriaWidth - 20,
        height: criteriaHeight - 25,
        lineGap: 1,
      });
  });

  let y = pdf.contentTop + criteriaHeight + 15;
  if (y + 115 > pdf.contentBottom) {
    y = pdf.addPage();
  }
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12)
    .text("Purchase Summary", pdf.left, y);
  y += 20;

  const summaryGap = 10;
  const summaryWidth = (W - summaryGap * 2) / 3;
  const summaryCards: Array<[string, string]> = [
    ["Total Purchased Gross Weight", `${formatNumber(totalGross, 4)} g  (${formatNumber(totalGross / 1000, 4)} kg)`],
    ["Total Net Pure Weight", `${formatNumber(totalPure, 4)} g`],
    ["Total Purchase Spend / Cash Outflow", `AED ${formatNumber(totalAed, 2)}`],
  ];
  summaryCards.forEach(([label, value], index) => {
    const x = pdf.left + index * (summaryWidth + summaryGap);
    doc.rect(x, y, summaryWidth, 48).fillAndStroke(index === 2 ? "#fdf9ee" : "white", GRID);
    doc.fillColor("#667085").font("Helvetica").fontSize(7.2)
      .text(label, x + 10, y + 9, { width: summaryWidth - 20, lineBreak: false, ellipsis: true });
    doc.fillColor(index === 2 ? "#a16207" : NAVY).font("Helvetica-Bold").fontSize(10.5)
      .text(value, x + 10, y + 25, { width: summaryWidth - 20, lineBreak: false, ellipsis: true });
  });
  y += 67;

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12)
    .text("Itemized Purchase Bills", pdf.left, y);
  y += 18;

  type Cell = [text: string, width: number, alignRight?: boolean];
  const tableHeader: Cell[] = [
    ["Date", 64],
    ["Bill / Ref No", 122],
    ["Supplier Name", 126],
    ["Category", 76],
    ["Gross Wt (g)", 65, true],
    ["Touch / Purity", 60, true],
    ["Pure Wt (g)", 65, true],
    ["Rate (AED/g)", 78, true],
    ["Total Amount (AED)", 106, true],
  ];

  let activeHeader: Cell[] | null = null;
  let zebraIndex = 0;
  const drawCells = (
    cells: Cell[],
    options: { background: string; color: string; bold: boolean; height: number; wrap?: boolean },
  ) => {
    if (y + options.height + 13 > pdf.contentBottom) {
      y = pdf.addPage();
      if (activeHeader && cells !== activeHeader) {
        drawCells(activeHeader, { background: NAVY, color: "white", bold: true, height: 20 });
      }
    }
    let x = pdf.left;
    for (const [text, width, alignRight] of cells) {
      doc.rect(x, y, width, options.height).fillAndStroke(options.background, GRID);
      doc.fillColor(options.color).font(options.bold ? "Helvetica-Bold" : "Helvetica").fontSize(6.8);
      if (options.wrap) {
        doc.text(text, x + 4, y + 4, {
          width: width - 8,
          height: options.height - 4,
          align: alignRight ? "right" : "left",
          lineGap: 0,
        });
      } else {
        doc.text(text, x + 4, y + (options.height - 8) / 2, {
          width: width - 8,
          height: options.height - 4,
          align: alignRight ? "right" : "left",
          lineBreak: false,
          ellipsis: true,
        });
      }
      x += width;
    }
    y += options.height;
  };

  const drawTableHeader = () => {
    if (y + 38 > pdf.contentBottom) y = pdf.addPage();
    activeHeader = tableHeader;
    drawCells(tableHeader, { background: NAVY, color: "white", bold: true, height: 20 });
  };
  drawTableHeader();

  if (rows.length === 0) {
    drawCells(
      [["No purchase-bill items match the selected filters.", W]],
      { background: "white", color: "#667085", bold: false, height: 24 },
    );
  } else {
    rows.forEach((row) => {
      const rowCells: Cell[] = [
        [row.billDate, 64],
        [row.billNo, 122],
        [row.supplierName, 126],
        [CATEGORY_LABEL[row.category] ?? row.category, 76],
        [formatNumber(row.grossWeightGrams, 4), 65, true],
        [`${formatNumber(row.purityPercent, 3)}%`, 60, true],
        [formatNumber(row.pureWeightGrams, 4), 65, true],
        [formatNumber(row.rateAedPerG, 4), 78, true],
        [`AED ${formatNumber(row.lineTotalAed, 2)}`, 106, true],
      ];
      doc.font("Helvetica").fontSize(6.8);
      const rowHeight = Math.max(
        18,
        Math.ceil(Math.max(...rowCells.map(([text, width]) => (
          doc.heightOfString(text, { width: width - 8, lineGap: 0 })
        ))) + 8),
      );
      const continuationRowCapacity = pdf.contentBottom - pdf.contentTop - 33;
      if (rowHeight > continuationRowCapacity) {
        throw new RangeError("Purchase statement row does not fit within the printable page");
      }
      drawCells(
        rowCells,
        {
          background: zebraIndex++ % 2 === 0 ? "white" : ZEBRA,
          color: "#1a1a1a",
          bold: false,
          height: rowHeight,
          wrap: true,
        },
      );
    });
    drawCells(
      [
        ["TOTAL", 388],
        [`${formatNumber(totalGross, 4)} g`, 65, true],
        ["", 60],
        [`${formatNumber(totalPure, 4)} g`, 65, true],
        ["", 78],
        [`AED ${formatNumber(totalAed, 2)}`, 106, true],
      ],
      { background: "#eee6cf", color: NAVY, bold: true, height: 20 },
    );
  }

  activeHeader = null;
  return {
    doc: pdf.doc,
    finish: () => pdf.finish(y),
  };
}