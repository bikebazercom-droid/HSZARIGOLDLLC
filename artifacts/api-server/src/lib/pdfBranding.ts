import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

export const PDF_BRAND = {
  companyName: "Hazari Gold L.L.C",
  address: "Matar Abdul Rahman Khalfan Al Muhairi Building, 1st Floor, Room# 101, Deira, Dubai, UAE",
  phone: "+971509364193",
  email: "hazarigoldllc@gmail.com",
  trn: "105301944200003",
  navy: "#1e3a5f",
  gold: "#c8a43a",
  paleBlue: "#e9eff6",
  grid: "#d1d5db",
} as const;

const SIDE_MARGIN = 40;
const FIRST_PAGE_CONTENT_TOP = 136;
const CONTINUATION_CONTENT_TOP = 40;
const BANNER_HEIGHT = 30;
const BANNER_GOLD_HEIGHT = 4;
const SIGNATURE_BLOCK_HEIGHT = 88;
const SIGNATURE_GAP = 12;
const FINAL_CONTENT_RESERVE = BANNER_HEIGHT + SIGNATURE_BLOCK_HEIGHT + SIGNATURE_GAP;

function resolveBrandAsset(filename: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const entryDir = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : moduleDir;
  const candidates = [
    path.resolve(process.cwd(), "assets", filename),
    path.resolve(process.cwd(), "artifacts/api-server/assets", filename),
    path.resolve(entryDir, "../assets", filename),
    path.resolve(moduleDir, "../assets", filename),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Missing required PDF brand asset: ${filename}`);
  }
  return found;
}

const LOGO_PATH = resolveBrandAsset("hazari-gold-logo.jpg");
const STAMP_PATH = resolveBrandAsset("hazari-gold-stamp.png");

export interface BrandedPdfOptions {
  title: string;
  layout?: "portrait" | "landscape";
  generatedAt?: Date;
}

export interface BrandedPdfLayout {
  readonly doc: PDFKit.PDFDocument;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly contentTop: number;
  readonly contentBottom: number;
  addPage(): number;
  ensureSpace(y: number, height: number): number;
  finish(y: number): void;
}

function drawOfficialHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  generatedAt: Date,
): void {
  const pageWidth = doc.page.width;
  const right = pageWidth - SIDE_MARGIN;
  const logoWidth = 116;
  const logoHeight = 58;
  const infoX = SIDE_MARGIN + logoWidth + 16;
  const infoWidth = right - infoX;

  doc.save();
  doc.rect(0, 0, pageWidth, 5).fill(PDF_BRAND.gold);
  doc.image(LOGO_PATH, SIDE_MARGIN, 15, {
    fit: [logoWidth, logoHeight],
    valign: "center",
  });

  doc.fillColor(PDF_BRAND.navy)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(PDF_BRAND.companyName, infoX, 15, {
      width: infoWidth,
      lineBreak: false,
    });
  doc.fillColor("#303640")
    .font("Helvetica")
    .fontSize(8.2)
    .text(PDF_BRAND.address, infoX, 36, {
      width: infoWidth,
      height: 21,
      ellipsis: true,
    });
  doc.fontSize(8)
    .text(
      `Phone: ${PDF_BRAND.phone}    Email: ${PDF_BRAND.email}    TRN: ${PDF_BRAND.trn}`,
      infoX,
      62,
      { width: infoWidth, lineBreak: false },
    );

  doc.rect(0, 90, pageWidth, 32).fill(PDF_BRAND.navy);
  doc.fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(title.toUpperCase(), SIDE_MARGIN, 101, {
      width: pageWidth - SIDE_MARGIN * 2 - 180,
      lineBreak: false,
    });
  doc.fillColor("#dbe7f6")
    .font("Helvetica")
    .fontSize(7.5)
    .text(`Generated: ${generatedAt.toLocaleString("en-AE")}`, right - 180, 102, {
      width: 180,
      align: "right",
      lineBreak: false,
    });
  doc.rect(0, 122, pageWidth, 2).fill(PDF_BRAND.gold);
  doc.restore();
  doc.x = SIDE_MARGIN;
  doc.y = FIRST_PAGE_CONTENT_TOP;
}

function drawPageBanner(doc: PDFKit.PDFDocument, pageNumber: number, totalPages: number): void {
  const y = doc.page.height - BANNER_HEIGHT;
  const originalBottomMargin = doc.page.margins.bottom;
  // PDFKit auto-adds a page when text is drawn inside the configured bottom
  // margin. The banner intentionally occupies that margin, so temporarily make
  // the full page drawable while painting it.
  doc.page.margins.bottom = 0;
  doc.save();
  try {
    doc.rect(0, y, doc.page.width, BANNER_HEIGHT - BANNER_GOLD_HEIGHT).fill(PDF_BRAND.navy);
    doc.fillColor("white")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Thank you for your business!", SIDE_MARGIN, y + 8, {
        width: doc.page.width - SIDE_MARGIN * 2,
        align: "center",
        lineBreak: false,
      });
    doc.fillColor("#dbe7f6")
      .font("Helvetica")
      .fontSize(6.5)
      .text(`Page ${pageNumber} of ${totalPages}`, doc.page.width - SIDE_MARGIN - 70, y + 10, {
        width: 70,
        align: "right",
        lineBreak: false,
      });
    doc.rect(0, doc.page.height - BANNER_GOLD_HEIGHT, doc.page.width, BANNER_GOLD_HEIGHT)
      .fill(PDF_BRAND.gold);
  } finally {
    doc.restore();
    doc.page.margins.bottom = originalBottomMargin;
  }
}

function drawFinalSignatures(doc: PDFKit.PDFDocument, topY: number): void {
  const lineY = topY + 68;
  const availableWidth = doc.page.width - SIDE_MARGIN * 2;
  const gap = 34;
  const blockWidth = (availableWidth - gap * 2) / 3;
  const labels = ["Customer's Signature", "Checked By", "Authorised Signature"];

  doc.save();
  labels.forEach((label, index) => {
    const x = SIDE_MARGIN + index * (blockWidth + gap);
    if (index === 2) {
      doc.image(STAMP_PATH, x + blockWidth / 2 - 43, topY, {
        fit: [86, 68],
        align: "center",
        valign: "bottom",
      });
    }
    doc.strokeColor("#4b5563").lineWidth(0.7)
      .moveTo(x, lineY)
      .lineTo(x + blockWidth, lineY)
      .stroke();
    doc.fillColor(PDF_BRAND.navy)
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .text(label, x, lineY + 6, {
        width: blockWidth,
        align: "center",
        lineBreak: false,
      });
  });
  doc.restore();
}

export function createBrandedPdf(options: BrandedPdfOptions): BrandedPdfLayout {
  const generatedAt = options.generatedAt ?? new Date();
  const doc = new PDFDocument({
    size: "A4",
    layout: options.layout ?? "portrait",
    bufferPages: true,
    margins: {
      top: FIRST_PAGE_CONTENT_TOP,
      left: SIDE_MARGIN,
      right: SIDE_MARGIN,
      bottom: FINAL_CONTENT_RESERVE,
    },
  });

  drawOfficialHeader(doc, options.title, generatedAt);

  const addContinuationPage = (): number => {
    doc.addPage({
      size: "A4",
      layout: options.layout ?? "portrait",
      margins: {
        top: CONTINUATION_CONTENT_TOP,
        left: SIDE_MARGIN,
        right: SIDE_MARGIN,
        bottom: FINAL_CONTENT_RESERVE,
      },
    });
    doc.x = SIDE_MARGIN;
    doc.y = CONTINUATION_CONTENT_TOP;
    return CONTINUATION_CONTENT_TOP;
  };

  const contentBottom = doc.page.height - FINAL_CONTENT_RESERVE;

  const layout: BrandedPdfLayout = {
    doc,
    left: SIDE_MARGIN,
    right: doc.page.width - SIDE_MARGIN,
    width: doc.page.width - SIDE_MARGIN * 2,
    contentTop: FIRST_PAGE_CONTENT_TOP,
    contentBottom,
    addPage: addContinuationPage,
    ensureSpace: (y, height) => {
      if (y + height > contentBottom) {
        return addContinuationPage();
      }
      return y;
    },
    finish: (currentY) => {
      const bannerY = doc.page.height - BANNER_HEIGHT;
      const signatureTop = currentY + SIGNATURE_GAP;
      if (signatureTop + SIGNATURE_BLOCK_HEIGHT > bannerY) {
        throw new Error(
          `PDF final content exceeded the reserved signature area (${currentY.toFixed(1)} > ${contentBottom.toFixed(1)})`,
        );
      }
      drawFinalSignatures(doc, signatureTop);

      const range = doc.bufferedPageRange();
      const finalPageIndex = range.start + range.count - 1;
      doc.switchToPage(finalPageIndex);
      drawPageBanner(doc, range.count, range.count);
      doc.flushPages();
      doc.end();
    },
  };

  return layout;
}