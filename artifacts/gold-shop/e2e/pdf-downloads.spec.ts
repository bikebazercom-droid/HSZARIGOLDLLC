import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type APIResponse, type Page, type TestInfo } from "@playwright/test";

const FIXTURE_PREFIX = "PDFE2E";
const testAdminMobile = process.env.TEST_ADMIN_MOBILE;
const testAdminPin = process.env.TEST_ADMIN_PIN;
const runId = process.env.PDF_E2E_RUN_ID;
const recoveryProbeRunId = process.env.PDF_E2E_RECOVERY_PROBE_RUN_ID;
if (!testAdminMobile || !testAdminPin || !runId || !recoveryProbeRunId) {
  throw new Error("PDF browser tests require ephemeral admin credentials and registered PDF run IDs");
}
const TEST_ADMIN = {
  mobile: testAdminMobile,
  pin: testAdminPin,
};

type CreatedRecord = { id: number };
type Rgb = [number, number, number];

function pdfPages(pdfPath: string): string[] {
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 4_000_000,
  });
  return text.split("\f").filter((page) => page.trim().length > 0);
}

function pdfInfo(pdfPath: string): { pages: number; width: number; height: number } {
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const pages = Number(info.match(/^Pages:\s+(\d+)$/m)?.[1]);
  const size = info.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts \(A4\)$/m);
  if (!pages || !size) throw new Error(`Could not read A4 geometry from ${pdfPath}\n${info}`);
  return { pages, width: Number(size[1]), height: Number(size[2]) };
}

function ocrPdfPages(pdfPath: string, pageSegmentationMode = 6): string[] {
  const dir = dirname(pdfPath);
  const prefix = join(dir, `${FIXTURE_PREFIX.toLowerCase()}-page`);
  execFileSync("pdftoppm", ["-png", "-r", "240", pdfPath, prefix], {
    maxBuffer: 4_000_000,
  });
  const pageImages = readdirSync(dir)
    .filter((name) => name.startsWith(`${FIXTURE_PREFIX.toLowerCase()}-page-`) && name.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  try {
    return pageImages.map((name) => execFileSync(
      "tesseract",
      [join(dir, name), "stdout", "--psm", String(pageSegmentationMode)],
      { encoding: "utf8", maxBuffer: 4_000_000 },
    ));
  } finally {
    for (const name of pageImages) rmSync(join(dir, name), { force: true });
  }
}

function ocrPdf(pdfPath: string): string {
  return ocrPdfPages(pdfPath).join("\n\f\n");
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

function isNearColor(actual: Rgb, expected: Rgb, tolerance = 20): boolean {
  return actual.every((channel, index) => Math.abs(channel - expected[index]) <= tolerance);
}

function finalPageVisualMetrics(pdfPath: string): {
  navyAtBottom: boolean;
  goldAtBottom: boolean;
  authorisedStampDarkFraction: number;
} {
  const dir = dirname(pdfPath);
  const finalPage = pdfInfo(pdfPath).pages;
  const prefix = join(dir, `${FIXTURE_PREFIX.toLowerCase()}-visual-final`);
  const imagePath = `${prefix}.png`;
  execFileSync(
    "pdftoppm",
    ["-png", "-singlefile", "-r", "144", "-f", String(finalPage), "-l", String(finalPage), pdfPath, prefix],
    { maxBuffer: 4_000_000 },
  );
  try {
    const [width, height] = execFileSync(
      "magick",
      [imagePath, "-format", "%w %h", "info:"],
      { encoding: "utf8" },
    ).trim().split(/\s+/).map(Number);
    const stampCrop = {
      x: Math.floor(width * 0.70),
      y: Math.floor(height * 0.78),
      width: Math.floor(width * 0.27),
      height: Math.floor(height * 0.17),
    };
    const authorisedStampDarkFraction = Number(execFileSync(
      "magick",
      [
        imagePath,
        "-crop", `${stampCrop.width}x${stampCrop.height}+${stampCrop.x}+${stampCrop.y}`,
        "+repage",
        "-colorspace", "Gray",
        "-threshold", "90%",
        "-format", "%[fx:1-mean]",
        "info:",
      ],
      { encoding: "utf8" },
    ));
    return {
      navyAtBottom: isNearColor(imagePixel(imagePath, 12, height - 32), [30, 58, 95]),
      goldAtBottom: isNearColor(imagePixel(imagePath, 12, height - 3), [200, 164, 58]),
      authorisedStampDarkFraction,
    };
  } finally {
    rmSync(imagePath, { force: true });
  }
}

function normalized(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

async function expectSuccessful(response: APIResponse, action: string) {
  expect(response.ok(), `${action} failed (${response.status()}): ${await response.text()}`).toBe(true);
}

async function login(page: Page): Promise<void> {
  const response = await page.request.post("/api/auth/login", {
    data: { ...TEST_ADMIN, role: "admin" },
  });
  await expectSuccessful(response, "log in with the configured PDF test admin");
}

function fixtureHeaders(runIdForFixture: string): Record<string, string> {
  return { "X-Pdf-E2e-Run-Id": runIdForFixture };
}

async function removeOwnedFixtures(
  page: Page,
  invoiceIds: number[],
  purchaseIds: number[],
): Promise<void> {
  const errors: string[] = [];
  for (const id of [...invoiceIds].reverse()) {
    const deleted = await page.request.delete(`/api/invoices/${id}`, {
      headers: { "X-Allow-Invoice-Delete": "true" },
    });
    if (![204, 404].includes(deleted.status())) {
      errors.push(`invoice ${id}: ${deleted.status()} ${await deleted.text()}`);
    }
  }
  for (const id of [...purchaseIds].reverse()) {
    const deleted = await page.request.delete(`/api/stock/purchases/${id}`);
    if (![204, 404].includes(deleted.status())) {
      errors.push(`purchase ${id}: ${deleted.status()} ${await deleted.text()}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Could not clean up owned PDF fixtures:\n${errors.join("\n")}`);
  }
}

async function createInvoice(
  page: Page,
  customerName: string,
  itemCount: number,
  runIdForFixture: string | null = runId,
): Promise<{ id: number; invoiceNumber: string }> {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    description: index === 0
      ? "FIRSTMARKER PDF REGRESSION ITEM"
      : index === itemCount - 1
        ? "FINALMARKER PDF REGRESSION ITEM"
        : `PDF REGRESSION ITEM ${String(index + 1).padStart(2, "0")}`,
    category: "gold",
    quantity: 1,
    grossWeight: 0,
    unitPrice: 1,
    totalPrice: 1,
  }));
  const response = await page.request.post("/api/invoices", {
    ...(runIdForFixture ? { headers: fixtureHeaders(runIdForFixture) } : {}),
    data: {
      customerName,
      paymentMethod: "cash",
      subtotal: itemCount,
      discount: 0,
      total: itemCount,
      vatRate: 5,
      vatAmount: 0,
      totalBeforeVat: itemCount,
      totalIncludingVat: itemCount,
      roundOffDiscount: 0,
      notes: "Oversized browser PDF regression fixture",
      isPending: true,
      items,
    },
  });
  await expectSuccessful(response, `create invoice ${customerName}`);
  return response.json() as Promise<{ id: number; invoiceNumber: string }>;
}

async function createPurchase(
  page: Page,
  supplierName: string,
  index: number,
  runIdForFixture: string | null = runId,
): Promise<number> {
  const response = await page.request.post("/api/stock/purchases", {
    ...(runIdForFixture ? { headers: fixtureHeaders(runIdForFixture) } : {}),
    data: {
      category: "silver",
      supplierName,
      purchaseDate: `2026-08-${String((index % 19) + 1).padStart(2, "0")}`,
      weightGrams: 0.001,
      totalPriceAed: 0,
      narrative: `PDF supplier statement row ${index + 1}`,
    },
  });
  await expectSuccessful(response, `create supplier row ${index + 1}`);
  return ((await response.json()) as CreatedRecord).id;
}

async function recoverAbandonedFixtures(page: Page): Promise<{ invoices: number; purchases: number; runIds: string[] }> {
  const listed = await page.request.get("/api/test-fixtures/pdf/abandoned", {
    headers: fixtureHeaders(runId),
  });
  await expectSuccessful(listed, "list abandoned PDF fixtures");
  const { fixtures, runIds } = await listed.json() as {
    fixtures: { runId: string; entityType: "invoice" | "stock_purchase"; entityId: number }[];
    runIds: string[];
  };
  const invoices = fixtures.filter((fixture) => fixture.entityType === "invoice");
  const purchases = fixtures.filter((fixture) => fixture.entityType === "stock_purchase");
  await removeOwnedFixtures(page, invoices.map((fixture) => fixture.entityId), purchases.map((fixture) => fixture.entityId));
  if (runIds.length > 0) {
    const completed = await page.request.post("/api/test-fixtures/pdf/recovery-complete", {
      headers: fixtureHeaders(runId),
      data: { runIds },
    });
    await expectSuccessful(completed, "complete abandoned PDF fixture recovery");
  }
  return { invoices: invoices.length, purchases: purchases.length, runIds };
}

async function abandonRun(page: Page, runIdToAbandon: string): Promise<void> {
  const abandoned = await page.request.post("/api/test-fixtures/pdf/abandon", {
    headers: fixtureHeaders(runIdToAbandon),
  });
  await expectSuccessful(abandoned, "mark recovery probe as interrupted");
}

async function downloadPdf(
  page: Page,
  buttonName: string,
  outputName: string,
  testInfo: TestInfo,
): Promise<string> {
  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await downloadPromise;
  const failure = await download.failure();
  expect(failure, `browser download failed: ${failure}`).toBeNull();
  const path = testInfo.outputPath(outputName);
  await download.saveAs(path);
  expect(readFileSync(path).subarray(0, 4).toString("utf8")).toBe("%PDF");
  return path;
}

function expectStatementBranding(pages: string[], ocrPages: string[]): void {
  expect(pages.length).toBeGreaterThan(1);
  expect(ocrPages).toHaveLength(pages.length);
  expect(pages[0]).toContain("Hazari Gold L.L.C");
  expect(pages[0]).toContain("+971509364193");
  expect(pages[0]).toContain("hazarigoldllc@gmail.com");
  for (const page of pages.slice(1)) {
    expect(page).not.toContain("Hazari Gold L.L.C");
    expect(page).not.toContain("+971509364193");
    expect(page).not.toContain("hazarigoldllc@gmail.com");
  }
  for (const page of pages.slice(0, -1)) {
    expect(page).not.toContain("Thank you for your business!");
    expect(page).not.toContain("Page ");
  }
  expect(pages.at(-1)).toContain("Thank you for your business!");
  expect(pages.at(-1)).toContain(`Page ${pages.length} of ${pages.length}`);
  for (const page of pages.slice(1)) {
    expect(page).toContain("Date");
    expect(page).toContain("Total (AED)");
  }
  for (const removedLabel of ["Customer's Signature", "Checked By"]) {
    const normalizedLabel = normalized(removedLabel);
    expect(ocrPages.every((page) => !page.includes(normalizedLabel))).toBe(true);
  }
  const authorisedLabel = normalized("Authorised Signature");
  expect(ocrPages.slice(0, -1).every((page) => !page.includes(authorisedLabel))).toBe(true);
  expect(ocrPages.at(-1)).toContain(authorisedLabel);
  expect(ocrPages.at(-1)).toContain("GRANDTOTAL");
}

test("browser PDF downloads keep branding, frames, continuation headings, totals, and signatures", async ({ page }, testInfo) => {
  const runTag = `${FIXTURE_PREFIX}${Date.now().toString(36).toUpperCase()}`;
  const oversizedCustomer = `${runTag} OVERSIZED`;
  const salesCustomer = `${runTag} SALE`;
  const supplier = `${runTag} SUPPLIER`;
  const pageErrors: string[] = [];
  const invoiceIds: number[] = [];
  const purchaseIds: number[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await login(page);

  try {
    await test.step("a prior interrupted PDF run is recovered by registered IDs only", async () => {
      const decoyInvoice = await createInvoice(page, `${FIXTURE_PREFIX} UNREGISTERED DECOY`, 1, null);
      const decoyPurchase = await createPurchase(page, `${FIXTURE_PREFIX} UNREGISTERED DECOY`, 0, null);
      invoiceIds.push(decoyInvoice.id);
      purchaseIds.push(decoyPurchase);

      await createInvoice(page, `${FIXTURE_PREFIX} RECOVERY PROBE`, 1, recoveryProbeRunId);
      await createPurchase(page, `${FIXTURE_PREFIX} RECOVERY PROBE`, 0, recoveryProbeRunId);

      const whileActive = await page.request.get("/api/test-fixtures/pdf/abandoned", {
        headers: fixtureHeaders(runId),
      });
      await expectSuccessful(whileActive, "list abandoned PDF fixtures while the probe is active");
      const activeListing = await whileActive.json() as { runIds: string[] };
      expect(activeListing.runIds).not.toContain(recoveryProbeRunId);

      const prematureRecovery = await page.request.post("/api/test-fixtures/pdf/recovery-complete", {
        headers: fixtureHeaders(runId),
        data: { runIds: [recoveryProbeRunId] },
      });
      expect(prematureRecovery.status(), "recovery must refuse a run that is still active").toBe(409);

      await abandonRun(page, recoveryProbeRunId);
      const recovered = await recoverAbandonedFixtures(page);
      expect(recovered.invoices).toBeGreaterThanOrEqual(1);
      expect(recovered.purchases).toBeGreaterThanOrEqual(1);
      expect(recovered.runIds).toContain(recoveryProbeRunId);

      const decoyInvoiceDelete = await page.request.delete(`/api/invoices/${decoyInvoice.id}`, {
        headers: { "X-Allow-Invoice-Delete": "true" },
      });
      expect(decoyInvoiceDelete.status(), "unregistered invoice with the same prefix must survive recovery").toBe(204);
      const decoyPurchaseDelete = await page.request.delete(`/api/stock/purchases/${decoyPurchase}`);
      expect(decoyPurchaseDelete.status(), "unregistered purchase with the same prefix must survive recovery").toBe(204);
    });

    const oversized = await createInvoice(page, oversizedCustomer, 24);
    invoiceIds.push(oversized.id);
    for (let index = 0; index < 10; index += 1) {
      invoiceIds.push((await createInvoice(page, salesCustomer, 1)).id);
    }
    for (let index = 0; index < 34; index += 1) {
      purchaseIds.push(await createPurchase(page, supplier, index));
    }

    await test.step("oversized invoice remains one complete A4 page", async () => {
      await page.goto(`/invoices/${oversized.id}`);
      const document = page.locator("[data-invoice-doc]");
      await expect(document).toContainText("FIRSTMARKER");
      await expect(document).toContainText("FINALMARKER");
      await expect(document).toContainText("Hazari Gold L.L.C");
      await expect(document).not.toContainText("Customer's Signature");
      await expect(document).not.toContainText("Checked By");
      await expect(document).toContainText("Authorised Signature");
      expect(await document.evaluate((element) => element.scrollHeight)).toBeGreaterThan(1123);

      const path = await downloadPdf(page, "Download PDF", "oversized-invoice.pdf", testInfo);
      const info = pdfInfo(path);
      expect(info.pages).toBe(1);
      expect(info.width).toBeLessThan(info.height);

      const ocr = normalized(ocrPdf(path));
      expect(ocr).toContain("HAZARIGOLD");
      expect(ocr).toContain("FIRSTMARKER");
      expect(ocr).toContain("FINALMARKER");
      expect(ocr).not.toContain("CUSTOMERSSIGNATURE");
      expect(ocr).not.toContain("CHECKEDBY");
      expect(ocr).toContain("AUTHORISEDSIGNATURE");
      expect(ocr).toContain("THANKYOUFORYOURBUSINESS");
      const visual = finalPageVisualMetrics(path);
      expect(visual.authorisedStampDarkFraction, "invoice seal must be visible above the authorised signature").toBeGreaterThan(0.04);
    });

    await test.step("multi-page sales statement repeats its safe frame and headings", async () => {
      await page.goto("/invoices");
      await page.getByPlaceholder("Invoice #, customer name or phone...").fill(runTag);
      await expect(page.getByText(oversizedCustomer).first()).toBeVisible();

      const path = await downloadPdf(page, "Download PDF Statement", "sales-statement.pdf", testInfo);
      const info = pdfInfo(path);
      expect(info.pages).toBeGreaterThan(1);
      expect(info.width).toBeLessThan(info.height);
      const pages = pdfPages(path);
      const ocrPages = ocrPdfPages(path, 3).map(normalized);
      expectStatementBranding(pages, ocrPages);
      const visual = finalPageVisualMetrics(path);
      expect(visual.navyAtBottom, "final thank-you banner must be flush with the bottom edge").toBe(true);
      expect(visual.goldAtBottom, "final gold rule must reach the absolute bottom edge").toBe(true);
      expect(visual.authorisedStampDarkFraction, "round stamp must be visible above the authorised signature").toBeGreaterThan(0.04);
      for (const pageText of pages.slice(1)) {
        expect(pageText).toContain("Invoice #");
        expect(pageText).toContain("Customer");
      }

      const ocr = ocrPages.join("");
      expect(ocr).toContain(FIXTURE_PREFIX);
      expect(ocr).toContain("GRANDTOTAL");
    });

    await test.step("multi-page supplier statement repeats its safe frame and headings", async () => {
      await page.goto("/products");
      await page.getByPlaceholder("Search supplier or category...").fill(runTag);
      await expect(page.getByText(supplier).first()).toBeVisible();

      const path = await downloadPdf(page, "Download PDF Statement", "supplier-statement.pdf", testInfo);
      const info = pdfInfo(path);
      expect(info.pages).toBeGreaterThan(1);
      expect(info.width).toBeLessThan(info.height);
      const pages = pdfPages(path);
      const ocrPages = ocrPdfPages(path, 3).map(normalized);
      expectStatementBranding(pages, ocrPages);
      const visual = finalPageVisualMetrics(path);
      expect(visual.navyAtBottom, "final thank-you banner must be flush with the bottom edge").toBe(true);
      expect(visual.goldAtBottom, "final gold rule must reach the absolute bottom edge").toBe(true);
      expect(visual.authorisedStampDarkFraction, "round stamp must be visible above the authorised signature").toBeGreaterThan(0.04);
      for (const pageText of pages.slice(1)) {
        expect(pageText).toContain("Supplier");
        expect(pageText).toContain("Category");
      }

      const ocr = ocrPages.join("");
      expect(ocr).toContain(FIXTURE_PREFIX);
      expect(ocr).toContain("GRANDTOTAL");
    });

    expect(pageErrors, `uncaught browser errors: ${pageErrors.join("\n")}`).toEqual([]);
  } finally {
    await removeOwnedFixtures(page, invoiceIds, purchaseIds);
    const completed = await page.request.post("/api/test-fixtures/pdf/complete", {
      headers: fixtureHeaders(runId),
    });
    await expectSuccessful(completed, "complete current PDF fixture run");
  }
});