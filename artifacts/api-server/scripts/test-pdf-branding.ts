#!/usr/bin/env tsx
/**
 * PDF branding regression test.
 *
 * Renders representative portrait and landscape PDFKit documents, deliberately
 * forces continuation pages, and inspects the emitted PDF rather than mocks.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:pdf-branding
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrandedPdf, PDF_BRAND } from "../src/lib/pdfBranding.js";

let passed = 0;
let failed = 0;

type Rgb = [number, number, number];

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed += 1;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed += 1;
  }
}

function imageDimensions(imagePath: string): { width: number; height: number } {
  const [width, height] = execFileSync(
    "magick",
    [imagePath, "-format", "%w %h", "info:"],
    { encoding: "utf8" },
  ).trim().split(/\s+/).map(Number);
  return { width, height };
}

function imagePixel(imagePath: string, x: number, y: number): Rgb {
  const output = execFileSync(
    "magick",
    [imagePath, "-format", `%[pixel:p{${x},${y}}]`, "info:"],
    { encoding: "utf8" },
  );
  const match = output.match(/srgba?\((\d+),(\d+),(\d+)/);
  if (!match) throw new Error(`Could not read pixel color from ${imagePath}: ${output}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNearColor(actual: Rgb, expected: Rgb, tolerance = 18): boolean {
  return actual.every((channel, index) => Math.abs(channel - expected[index]) <= tolerance);
}

function darkPixelFraction(
  imagePath: string,
  crop: { x: number; y: number; width: number; height: number },
): number {
  return Number(execFileSync(
    "magick",
    [
      imagePath,
      "-crop", `${crop.width}x${crop.height}+${crop.x}+${crop.y}`,
      "+repage",
      "-colorspace", "Gray",
      "-threshold", "90%",
      "-format", "%[fx:1-mean]",
      "info:",
    ],
    { encoding: "utf8" },
  ));
}

async function renderRepresentativePdf(
  layout: "portrait" | "landscape",
): Promise<Buffer> {
  const pdf = createBrandedPdf({
    title: `${layout} regression report`,
    layout,
    generatedAt: new Date("2026-08-19T10:30:00.000Z"),
  });
  const chunks: Buffer[] = [];
  pdf.doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    pdf.doc.once("end", () => resolve(Buffer.concat(chunks)));
    pdf.doc.once("error", reject);
  });

  let y = pdf.contentTop;
  for (let row = 1; row <= 52; row += 1) {
    y = pdf.ensureSpace(y, 18);
    pdf.doc
      .fillColor("#111827")
      .font("Helvetica")
      .fontSize(9)
      .text(`${layout} continuation row ${row}`, pdf.left, y, {
        width: pdf.width,
        lineBreak: false,
      });
    y += 18;
  }
  pdf.finish(y);
  return completed;
}

async function inspectPdf(layout: "portrait" | "landscape"): Promise<void> {
  const bytes = await renderRepresentativePdf(layout);
  assert(bytes.subarray(0, 4).toString("utf8") === "%PDF", `${layout} output is a PDF download`);

  const dir = await mkdtemp(join(tmpdir(), "hazari-pdf-branding-"));
  try {
    const pdfPath = join(dir, `${layout}.pdf`);
    await writeFile(pdfPath, bytes);
    const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 2_000_000,
    });
    const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
    const pages = text.split("\f").filter((page) => page.trim().length > 0);
    const pageSize = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts \(A4\)/);
    const pageWidth = Number(pageSize?.[1]);
    const pageHeight = Number(pageSize?.[2]);

    assert(pages.length >= 2, `${layout} report creates continuation pages`);
    assert(
      pageSize !== null
        && (layout === "portrait" ? pageWidth < pageHeight : pageWidth > pageHeight),
      `${layout} output retains complete A4 page geometry`,
    );

    assert(pages[0]?.includes(PDF_BRAND.companyName) ?? false, `${layout} first page keeps the official identity`);
    assert(
      pages[0]?.includes(PDF_BRAND.phone) && pages[0]?.includes(PDF_BRAND.email),
      `${layout} first page keeps contact details`,
    );
    assert(
      pages.slice(1).every((page) => !page.includes(PDF_BRAND.companyName) && !page.includes(PDF_BRAND.phone)),
      `${layout} continuation pages do not repeat the legal header`,
    );
    assert(
      pages.slice(0, -1).every((page) => !page.includes("Thank you for your business!") && !page.includes("Page ")),
      `${layout} intermediate pages do not repeat the closing footer`,
    );
    assert(
      pages.at(-1)?.includes("Thank you for your business!")
        && pages.at(-1)?.includes(`Page ${pages.length} of ${pages.length}`),
      `${layout} final page keeps the single closing banner and page count`,
    );

    for (const [index, page] of pages.entries()) {
      const number = index + 1;
      assert(
        new RegExp(`${layout} continuation row \\d+`).test(page),
        `${layout} page ${number} contains continuous report content`,
      );
    }

    for (const removedLabel of ["Customer's Signature", "Checked By"]) {
      assert(
        pages.every((page) => !page.includes(removedLabel)),
        `${layout} output removes "${removedLabel}"`,
      );
    }
    assert(
      pages.slice(0, -1).every((page) => !page.includes("Authorised Signature")),
      `${layout} continuation pages do not contain the authorised signature`,
    );
    assert(pages.at(-1)?.includes("Authorised Signature") ?? false, `${layout} final page contains the authorised signature`);
    assert(pages.at(-1)?.includes(`${layout} continuation row 52`) ?? false, `${layout} final row is not cropped`);

    const finalPageImage = join(dir, `${layout}-final.png`);
    execFileSync("pdftoppm", [
      "-png",
      "-singlefile",
      "-r", "144",
      "-f", String(pages.length),
      "-l", String(pages.length),
      pdfPath,
      finalPageImage.slice(0, -4),
    ]);
    const image = imageDimensions(finalPageImage);
    assert(
      isNearColor(imagePixel(finalPageImage, 12, image.height - 32), [30, 58, 95]),
      `${layout} final thank-you banner is flush with the bottom edge`,
    );
    assert(
      isNearColor(imagePixel(finalPageImage, 12, image.height - 3), [200, 164, 58]),
      `${layout} final gold rule reaches the absolute bottom edge`,
    );

    const pageWidthPt = pageWidth;
    const pageHeightPt = pageHeight;
    const scaleX = image.width / pageWidthPt;
    const scaleY = image.height / pageHeightPt;
    const signatureToBannerGap = 36;
    const signatureBlockHeight = 88;
    const bannerHeight = 30;
    const signatureTop = pageHeightPt - bannerHeight - signatureToBannerGap - signatureBlockHeight;
    const authorisedBlockWidth = 180;
    const authorisedX = pageWidthPt - 40 - authorisedBlockWidth;
    const stampCrop = {
      x: Math.floor((authorisedX + authorisedBlockWidth / 2 - 43) * scaleX),
      y: Math.floor(signatureTop * scaleY),
      width: Math.ceil(86 * scaleX),
      height: Math.ceil(68 * scaleY),
    };
    assert(
      darkPixelFraction(finalPageImage, stampCrop) > 0.04,
      `${layout} final authorised-signature block contains the round stamp`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("\n━━━ PDF branding regression tests ━━━");
  await inspectPdf("portrait");
  await inspectPdf("landscape");
  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nUnhandled error:", error);
  process.exitCode = 1;
});