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

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed += 1;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed += 1;
  }
}

async function renderRepresentativePdf(layout: "portrait" | "landscape"): Promise<Buffer> {
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

    for (const [index, page] of pages.entries()) {
      const number = index + 1;
      assert(page.includes(PDF_BRAND.companyName), `${layout} page ${number} keeps the official identity`);
      assert(page.includes(PDF_BRAND.phone) && page.includes(PDF_BRAND.email), `${layout} page ${number} keeps contact details`);
      assert(page.includes("Thank you for your business!"), `${layout} page ${number} keeps the footer banner`);
      assert(page.includes(`Page ${number} of ${pages.length}`), `${layout} page ${number} has the correct page number`);
      assert(
        new RegExp(`${layout} continuation row \\d+`).test(page),
        `${layout} page ${number} contains report content inside its frame`,
      );
    }

    const signatureLabels = ["Customer's Signature", "Checked By", "Authorised Signature"];
    for (const label of signatureLabels) {
      assert(
        pages.slice(0, -1).every((page) => !page.includes(label)),
        `${layout} continuation pages do not contain "${label}"`,
      );
      assert(pages.at(-1)?.includes(label) ?? false, `${layout} final page contains "${label}"`);
    }
    assert(pages.at(-1)?.includes(`${layout} continuation row 52`) ?? false, `${layout} final row is not cropped`);
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