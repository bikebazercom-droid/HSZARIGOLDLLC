import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type APIResponse, type Page, type TestInfo } from "@playwright/test";

const FIXTURE_PREFIX = "PDFE2E";
const testAdminMobile = process.env.TEST_ADMIN_MOBILE;
const testAdminPin = process.env.TEST_ADMIN_PIN;
if (!testAdminMobile || !testAdminPin) {
  throw new Error("PDF browser tests require an ephemeral TEST_ADMIN_MOBILE and TEST_ADMIN_PIN");
}
const TEST_ADMIN = {
  mobile: testAdminMobile,
  pin: testAdminPin,
};

type CreatedRecord = { id: number };

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

function ocrPdf(pdfPath: string): string {
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
      [join(dir, name), "stdout", "--psm", "6"],
      { encoding: "utf8", maxBuffer: 4_000_000 },
    )).join("\n\f\n");
  } finally {
    for (const name of pageImages) rmSync(join(dir, name), { force: true });
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

async function createPurchase(page: Page, supplierName: string, index: number): Promise<number> {
  const response = await page.request.post("/api/stock/purchases", {
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

function expectStatementBranding(pages: string[]): void {
  expect(pages.length).toBeGreaterThan(1);
  for (const [index, page] of pages.entries()) {
    expect(page).toContain("Hazari Gold L.L.C");
    expect(page).toContain("+971509364193");
    expect(page).toContain("hazarigoldllc@gmail.com");
    expect(page).toContain("Thank you for your business!");
    expect(page).toContain(`Page ${index + 1} of ${pages.length}`);
  }
  for (const page of pages.slice(1)) {
    expect(page).toContain("Date");
    expect(page).toContain("Total (AED)");
  }
  for (const label of ["Customer's Signature", "Checked By", "Authorised Signature"]) {
    expect(pages.slice(0, -1).every((page) => !page.includes(label))).toBe(true);
    expect(pages.at(-1)).toContain(label);
  }
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
      await expect(document).toContainText("Customer's Signature");
      expect(await document.evaluate((element) => element.scrollHeight)).toBeGreaterThan(1123);

      const path = await downloadPdf(page, "Download PDF", "oversized-invoice.pdf", testInfo);
      const info = pdfInfo(path);
      expect(info.pages).toBe(1);
      expect(info.width).toBeLessThan(info.height);

      const ocr = normalized(ocrPdf(path));
      expect(ocr).toContain("HAZARIGOLD");
      expect(ocr).toContain("FIRSTMARKER");
      expect(ocr).toContain("FINALMARKER");
      expect(ocr).toContain("CUSTOMERSSIGNATURE");
      expect(ocr).toContain("AUTHORISEDSIGNATURE");
      expect(ocr).toContain("THANKYOUFORYOURBUSINESS");
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
      expectStatementBranding(pages);
      for (const pageText of pages.slice(1)) {
        expect(pageText).toContain("Invoice #");
        expect(pageText).toContain("Customer");
      }

      const ocr = normalized(ocrPdf(path));
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
      expectStatementBranding(pages);
      for (const pageText of pages.slice(1)) {
        expect(pageText).toContain("Supplier");
        expect(pageText).toContain("Category");
      }

      const ocr = normalized(ocrPdf(path));
      expect(ocr).toContain(FIXTURE_PREFIX);
      expect(ocr).toContain("GRANDTOTAL");
    });

    expect(pageErrors, `uncaught browser errors: ${pageErrors.join("\n")}`).toEqual([]);
  } finally {
    await removeOwnedFixtures(page, invoiceIds, purchaseIds);
  }
});