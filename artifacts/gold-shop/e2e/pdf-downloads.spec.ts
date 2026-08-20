import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test, type APIResponse, type Page, type TestInfo } from "@playwright/test";

const FIXTURE_PREFIX = "PDFE2E";
const BISMILLAH_ARABIC = "بسم الله الرحمن الرحيم";
const BISMILLAH_ARABIC_WORDS = BISMILLAH_ARABIC.split(" ");
const ENGLISH_BISMILLAH = "In the name of Allah, the Most Gracious, the Most Merciful";
const PURCHASE_BILL_SUPPLIER_CONTACT = {
  phone: "+971 50 123 4567",
  email: "pdf.vendor@example.com",
  address: "Room 101, Deira, Dubai, UAE",
} as const;
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
type OwnedFixture = { id: number; runId: string };

function pdfPages(pdfPath: string): string[] {
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 4_000_000,
  });
  return text.split("\f").filter((page) => page.trim().length > 0);
}

function pdfRawText(pdfPath: string): string {
  return execFileSync("pdftotext", ["-raw", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 4_000_000,
  });
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

function containsExtractedArabicWord(text: string, word: string): boolean {
  const compatibilityNormalized = text.normalize("NFKC");
  const reversedWord = [...word].reverse().join("");
  return compatibilityNormalized.includes(word) || compatibilityNormalized.includes(reversedWord);
}

function expectArabicBismillah(text: string): void {
  for (const word of BISMILLAH_ARABIC_WORDS) {
    expect(containsExtractedArabicWord(text, word), `missing Arabic word "${word}"`).toBe(true);
  }
  expect(text).not.toContain(ENGLISH_BISMILLAH);
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
  purchaseBillIds: number[] = [],
  wholesaleInvoices: OwnedFixture[] = [],
  wholesaleTraders: OwnedFixture[] = [],
): Promise<void> {
  const errors: string[] = [];
  for (const id of [...purchaseBillIds].reverse()) {
    const deleted = await page.request.delete(`/api/purchase-bills/${id}`, {
      headers: { "X-Allow-Paid-Delete": "true" },
    });
    if (![204, 404].includes(deleted.status())) {
      errors.push(`purchase bill ${id}: ${deleted.status()} ${await deleted.text()}`);
    }
  }
  for (const id of [...invoiceIds].reverse()) {
    const deleted = await page.request.delete(`/api/invoices/${id}`, {
      headers: { "X-Allow-Invoice-Delete": "true" },
    });
    if (![204, 404].includes(deleted.status())) {
      errors.push(`invoice ${id}: ${deleted.status()} ${await deleted.text()}`);
    }
  }
  for (const fixture of [...wholesaleInvoices].reverse()) {
    const deleted = await page.request.delete(`/api/wholesale/invoices/${fixture.id}`);
    if (![204, 404].includes(deleted.status())) {
      errors.push(`wholesale invoice ${fixture.id}: ${deleted.status()} ${await deleted.text()}`);
    }
  }
  for (const id of [...purchaseIds].reverse()) {
    const deleted = await page.request.delete(`/api/stock/purchases/${id}`);
    if (![204, 404].includes(deleted.status())) {
      errors.push(`purchase ${id}: ${deleted.status()} ${await deleted.text()}`);
    }
  }
  for (const fixture of [...wholesaleTraders].reverse()) {
    const query = new URLSearchParams({ runId: fixture.runId });
    const deleted = await page.request.delete(
      `/api/test-fixtures/pdf/wholesale-traders/${fixture.id}?${query}`,
      { headers: fixtureHeaders(runId) },
    );
    if (![204, 404].includes(deleted.status())) {
      errors.push(`wholesale trader ${fixture.id}: ${deleted.status()} ${await deleted.text()}`);
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
    category: "gold_9999",
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

async function createPurchaseBill(
  page: Page,
  supplierName: string,
  options: {
    purchaseType?: "fixed" | "unfixed";
    paymentStatus?: "paid" | "unpaid" | "unfixed";
    billNo?: string;
    items?: Array<{
      category: string;
      grossWeightGrams: number;
      purityPercent: number;
      rateAedPerG: number;
      makingChargeAed: number;
      lineTotalAed: number;
    }>;
  } = {},
): Promise<{ id: number; billNo: string }> {
  const billNo = options.billNo ?? `PB-${supplierName.replace(/[^A-Z0-9]/gi, "").slice(0, 22)}`;
  const purchaseType = options.purchaseType ?? "fixed";
  const paymentStatus = options.paymentStatus ?? "unpaid";
  const initialRate = purchaseType === "unfixed" ? 0 : 320;
  const items = options.items ?? [{
    category: "995",
    grossWeightGrams: 10,
    purityPercent: 99.5,
    rateAedPerG: initialRate,
    makingChargeAed: 0,
    lineTotalAed: initialRate * 10,
  }];
  const response = await page.request.post("/api/purchase-bills", {
    headers: fixtureHeaders(runId),
    data: {
      billNo,
      billDate: "2026-08-18",
      supplierName,
      supplierPhone: PURCHASE_BILL_SUPPLIER_CONTACT.phone,
      supplierEmail: PURCHASE_BILL_SUPPLIER_CONTACT.email,
      supplierAddress: PURCHASE_BILL_SUPPLIER_CONTACT.address,
      purchaseType,
      paymentStatus,
      notes: "Invoice-style purchase bill PDF regression fixture",
      items,
    },
  });
  await expectSuccessful(response, `create purchase bill ${billNo}`);
  return response.json() as Promise<{ id: number; billNo: string }>;
}

function firstPageQrDarkFraction(pdfPath: string): number {
  const dir = dirname(pdfPath);
  const prefix = join(dir, `${FIXTURE_PREFIX.toLowerCase()}-purchase-qr`);
  const imagePath = `${prefix}.png`;
  execFileSync(
    "pdftoppm",
    ["-png", "-singlefile", "-r", "144", "-f", "1", "-l", "1", pdfPath, prefix],
    { maxBuffer: 4_000_000 },
  );
  try {
    const [width, height] = execFileSync(
      "magick",
      [imagePath, "-format", "%w %h", "info:"],
      { encoding: "utf8" },
    ).trim().split(/\s+/).map(Number);
    const crop = {
      x: Math.floor(width * 0.44),
      y: Math.floor(height * 0.08),
      width: Math.floor(width * 0.13),
      height: Math.floor(height * 0.10),
    };
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
  } finally {
    rmSync(imagePath, { force: true });
  }
}

async function recoverAbandonedFixtures(page: Page): Promise<{
  invoices: number;
  purchases: number;
  wholesaleInvoices: number;
  wholesaleTraders: number;
  runIds: string[];
}> {
  const listed = await page.request.get("/api/test-fixtures/pdf/abandoned", {
    headers: fixtureHeaders(runId),
  });
  await expectSuccessful(listed, "list abandoned PDF fixtures");
  const { fixtures, runIds } = await listed.json() as {
    fixtures: {
      runId: string;
      entityType:
        | "invoice"
        | "stock_purchase"
        | "purchase_bill"
        | "wholesale_invoice"
        | "wholesale_trader";
      entityId: number;
    }[];
    runIds: string[];
  };
  const invoices = fixtures.filter((fixture) => fixture.entityType === "invoice");
  const purchases = fixtures.filter((fixture) => fixture.entityType === "stock_purchase");
  const purchaseBills = fixtures.filter((fixture) => fixture.entityType === "purchase_bill");
  const wholesaleInvoices = fixtures.filter((fixture) => fixture.entityType === "wholesale_invoice");
  const wholesaleTraders = fixtures.filter((fixture) => fixture.entityType === "wholesale_trader");
  await removeOwnedFixtures(
    page,
    invoices.map((fixture) => fixture.entityId),
    purchases.map((fixture) => fixture.entityId),
    purchaseBills.map((fixture) => fixture.entityId),
    wholesaleInvoices.map((fixture) => ({ id: fixture.entityId, runId: fixture.runId })),
    wholesaleTraders.map((fixture) => ({ id: fixture.entityId, runId: fixture.runId })),
  );
  if (runIds.length > 0) {
    const completed = await page.request.post("/api/test-fixtures/pdf/recovery-complete", {
      headers: fixtureHeaders(runId),
      data: { runIds },
    });
    await expectSuccessful(completed, "complete abandoned PDF fixture recovery");
  }
  return {
    invoices: invoices.length,
    purchases: purchases.length,
    wholesaleInvoices: wholesaleInvoices.length,
    wholesaleTraders: wholesaleTraders.length,
    runIds,
  };
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

test("browser PDF downloads and wholesale preview keep their registered journeys stable", async ({ page }, testInfo) => {
  const runTag = `${FIXTURE_PREFIX}${Date.now().toString(36).toUpperCase()}`;
  const oversizedCustomer = `${runTag} OVERSIZED`;
  const salesCustomer = `${runTag} SALE`;
  const supplier = `${runTag} SUPPLIER`;
  const pageErrors: string[] = [];
  const invoiceIds: number[] = [];
  const purchaseIds: number[] = [];
  const purchaseBillIds: number[] = [];
  const wholesaleInvoiceIds: number[] = [];
  const wholesaleTraderIds: number[] = [];
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
    const purchaseBill = await createPurchaseBill(page, `${runTag} VENDOR`);
    purchaseBillIds.push(purchaseBill.id);
    const statementBillNo = `PB-${runTag}-LONG-REFERENCE-2026-AUG-0001`;
    const statementSupplier = `${runTag} INTERNATIONAL PRECIOUS METALS WHOLESALE VENDOR`;
    const statementItems = Array.from({ length: 18 }, (_, index) => {
      const grossWeightGrams = index === 0 ? 10.1234 : 1 + index / 10_000;
      const purityPercent = index === 0 ? 99.512 : 99.5;
      const rateAedPerG = index === 0 ? 320.1234 : 300 + index / 10_000;
      return {
        category: "995",
        grossWeightGrams,
        purityPercent,
        rateAedPerG,
        makingChargeAed: 0,
        lineTotalAed: Number((grossWeightGrams * rateAedPerG).toFixed(2)),
      };
    });
    const statementPurchaseBill = await createPurchaseBill(page, statementSupplier, {
      billNo: statementBillNo,
      items: statementItems,
    });
    purchaseBillIds.push(statementPurchaseBill.id);
    const boundarySupplier = (`${runTag}-` + "W".repeat(300)).slice(0, 300);
    const boundaryBillNo = (`PB-${runTag}-` + "W".repeat(300)).slice(0, 300);
    const boundaryStatementBill = await createPurchaseBill(page, boundarySupplier, {
      billNo: boundaryBillNo,
    });
    purchaseBillIds.push(boundaryStatementBill.id);
    const settledUnfixedBill = await createPurchaseBill(
      page,
      `${runTag} UNFIXED`,
      { purchaseType: "unfixed", paymentStatus: "unfixed" },
    );
    purchaseBillIds.push(settledUnfixedBill.id);
    const settled = await page.request.patch(
      `/api/purchase-bills/${settledUnfixedBill.id}/payment-status`,
      { data: { paymentStatus: "paid", fixingRateAedPerG: 320 } },
    );
    await expectSuccessful(settled, `settle unfixed purchase bill ${settledUnfixedBill.billNo}`);
    expect(((await settled.json()) as { totalAed: number }).totalAed).toBe(3184);

    await test.step("purchase statement filters validate and open the selected PDF export", async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/purchase-bills");
      const panel = page.getByTestId("purchase-statement-filters");
      await expect(panel).toBeVisible();
      const selects = panel.getByRole("combobox");
      await expect(selects).toHaveCount(3);
      await expect(selects.nth(0)).toContainText("All Suppliers");
      await expect(selects.nth(1)).toContainText("All Categories");
      await expect(selects.nth(2)).toContainText("All Time");
      await expect(panel.getByText("No date restriction")).toBeVisible();
      const downloadButton = panel.getByRole("button", { name: "Download Purchase Statement" });
      await expect(downloadButton).toBeVisible();

      await selects.nth(2).click();
      await page.getByRole("option", { name: "Today", exact: true }).click();
      const presetRange = panel.getByText(/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/);
      await expect(presetRange).toBeVisible();
      const [presetStart, presetEnd] = (await presetRange.textContent())!.split(" to ");
      expect(presetStart).toBe(presetEnd);

      await selects.nth(2).click();
      await page.getByRole("option", { name: "Custom Date Range", exact: true }).click();
      const dateInputs = panel.locator('input[type="date"]');
      await expect(dateInputs).toHaveCount(2);
      await dateInputs.nth(0).fill("2026-08-18");
      await dateInputs.nth(1).fill("");
      await downloadButton.click();
      await expect(page.getByText("Choose both custom statement dates", { exact: true })).toBeVisible();

      await dateInputs.nth(0).fill("2026-08-19");
      await dateInputs.nth(1).fill("2026-08-18");
      await downloadButton.click();
      await expect(page.getByText("Start date must be on or before the end date", { exact: true })).toBeVisible();

      await dateInputs.nth(0).fill("2026-08-18");
      await selects.nth(1).click();
      await page.getByRole("option", { name: "995", exact: true }).click();
      const pdfResponsePromise = page.context().waitForEvent("response", {
        predicate: (response) => response.url().includes("/api/purchase-bills/statement-pdf?"),
      });
      const popupPromise = page.waitForEvent("popup");
      await downloadButton.click();
      const [pdfResponse, popup] = await Promise.all([pdfResponsePromise, popupPromise]);
      expect(pdfResponse.status()).toBe(200);
      expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
      const exportUrl = new URL(pdfResponse.url());
      expect(exportUrl.searchParams.get("category")).toBe("995");
      expect(exportUrl.searchParams.get("startDate")).toBe("2026-08-18");
      expect(exportUrl.searchParams.get("endDate")).toBe("2026-08-18");
      await popup.close();

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(downloadButton).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const panelBox = await panel.boundingBox();
      expect(panelBox).not.toBeNull();
      expect(panelBox!.width).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 1440, height: 1000 });
    });

    await test.step("wholesale registration selects the trader and opens a frozen same-page PDF preview", async () => {
      const traderName = `${runTag} GOLD TRADING`;
      const traderContact = `SAMIR ${runTag}`;
      const traderPhone = "+971 50 765 4321";
      const traderEmail = `${runTag.toLowerCase()}@example.test`;
      const traderAddress = `SHOP 42 ${runTag} GOLD SOUQ DEIRA DUBAI UAE`;

      await page.route("**/api/wholesale/**", async (route) => {
        if (route.request().method() === "POST") {
          await route.continue({
            headers: {
              ...route.request().headers(),
              ...fixtureHeaders(runId),
            },
          });
          return;
        }
        await route.continue();
      });

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/invoices/new");
      await page.getByRole("tab", { name: "Wholesale / Trader", exact: true }).click();
      await expect(page).toHaveURL(/\/invoices\/new$/);

      const traderField = page.getByText("Trader", { exact: true }).locator("..");
      const traderSelect = traderField.getByRole("combobox");
      await traderSelect.click();
      await page.getByRole("option", { name: "Add New Wholesaler", exact: true }).click();

      const registrationDialog = page.getByRole("dialog", { name: "Add New Wholesaler" });
      await expect(registrationDialog).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await registrationDialog.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map(async (animation) => {
          try {
            await animation.finished;
          } catch {
            // A responsive layout change may cancel an in-flight open animation.
          }
        }));
      });
      const registrationBox = await registrationDialog.boundingBox();
      expect(registrationBox).not.toBeNull();
      expect(registrationBox!.x).toBeGreaterThanOrEqual(0);
      expect(registrationBox!.x + registrationBox!.width).toBeLessThanOrEqual(391);
      expect(registrationBox!.height).toBeLessThanOrEqual(844);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      await registrationDialog.getByLabel(/Company \/ Firm Name/).fill(traderName);
      await registrationDialog.getByLabel(/Full Name \(Contact Person\)/).fill(traderContact);
      await registrationDialog.getByLabel("Phone Number").fill(traderPhone);
      await registrationDialog.getByLabel("Email Address").fill(traderEmail);
      await registrationDialog.getByLabel("Full Address / Location Details").fill(traderAddress);

      const traderResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname.endsWith("/api/wholesale/traders")
        && response.request().method() === "POST"
      ));
      await registrationDialog.getByRole("button", { name: "Save Trader", exact: true }).click();
      const traderResponse = await traderResponsePromise;
      expect(traderResponse.status()).toBe(201);
      const trader = await traderResponse.json() as {
        id: number;
        name: string;
        contactPerson: string | null;
        phone: string | null;
        email: string | null;
        address: string | null;
      };
      wholesaleTraderIds.push(trader.id);
      expect(trader).toMatchObject({
        name: traderName,
        contactPerson: traderContact,
        phone: traderPhone,
        email: traderEmail,
        address: traderAddress,
      });
      await expect(registrationDialog).toBeHidden();
      await expect(traderSelect).toContainText(traderName);
      await expect(page).toHaveURL(/\/invoices\/new$/);

      const beforeInvoice = await page.request.get(`/api/wholesale/invoices?traderId=${trader.id}`);
      await expectSuccessful(beforeInvoice, "check that saving a trader did not create an invoice");
      expect(await beforeInvoice.json()).toEqual([]);

      await page.setViewportSize({ width: 1440, height: 1000 });
      const itemRow = page.locator("table tbody tr").first();
      await itemRow.getByRole("combobox").click();
      await page.getByRole("option", { name: "GOLD 9999", exact: true }).click();
      const itemNumberInputs = itemRow.locator('input[type="number"]');
      await itemNumberInputs.nth(0).fill("12.3456");
      await itemNumberInputs.nth(1).fill("7.50");

      await expect(page.getByRole("button", { name: "Unfixed Gold Delivery", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Fixed Gold Pricing", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cash Payment", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Fixed Gold Pricing", exact: true }).click();
      const metalRateField = page.getByText("Metal Rate (AED/g)", { exact: true }).locator("..");
      await metalRateField.locator('input[type="number"]').fill("410.25");
      await page.getByPlaceholder("Optional delivery notes").fill(`Frozen preview ${runTag}`);

      const invoiceResponsePromise = page.waitForResponse((response) => (
        new URL(response.url()).pathname.endsWith("/api/wholesale/invoices")
        && response.request().method() === "POST"
      ));
      await page.getByRole("button", { name: "Generate Wholesale Invoice", exact: true }).click();
      const invoiceResponse = await invoiceResponsePromise;
      expect(invoiceResponse.status()).toBe(201);
      const invoice = await invoiceResponse.json() as {
        id: number;
        invoiceNumber: string;
        pricingType: "fixed" | "unfixed" | "cash";
        paymentMode: "cash" | "card" | "bank_transfer" | null;
        traderName: string;
        traderContactPerson: string | null;
        traderPhone: string | null;
        traderEmail: string | null;
        traderAddress: string | null;
      };
      wholesaleInvoiceIds.push(invoice.id);
      expect(invoice).toMatchObject({
        pricingType: "fixed",
        paymentMode: null,
        traderName,
        traderContactPerson: traderContact,
        traderPhone,
        traderEmail,
        traderAddress,
      });
      await expect(page).toHaveURL(/\/invoices\/new$/);

      const changedTrader = await page.request.patch(`/api/wholesale/traders/${trader.id}`, {
        data: {
          contactPerson: "CHANGED AFTER INVOICE",
          phone: "+971 50 000 0000",
          email: "changed-after-invoice@example.test",
          address: "CHANGED AFTER INVOICE",
        },
      });
      await expectSuccessful(changedTrader, "change the live trader after taking the invoice snapshot");
      const frozenInvoiceResponse = await page.request.get(`/api/wholesale/invoices/${invoice.id}`);
      await expectSuccessful(frozenInvoiceResponse, "reload the frozen wholesale invoice");
      expect(await frozenInvoiceResponse.json()).toMatchObject({
        traderName,
        traderContactPerson: traderContact,
        traderPhone,
        traderEmail,
        traderAddress,
        pricingType: "fixed",
        paymentMode: null,
      });

      const previewDialog = page.getByRole("dialog", { name: `Invoice ${invoice.invoiceNumber}` });
      await expect(previewDialog).toBeVisible();
      const previewDocument = previewDialog.locator("[data-invoice-doc]");
      await expect(previewDocument).toContainText(traderName);
      await expect(previewDocument).toContainText(traderContact);
      await expect(previewDocument).toContainText(traderPhone);
      await expect(previewDocument).toContainText(traderEmail);
      await expect(previewDocument).toContainText(traderAddress);
      await expect(previewDocument.getByText("Pricing Type:", { exact: true }).first()).toBeVisible();
      await expect(previewDocument.getByText("Fixed Gold Pricing", { exact: true }).first()).toBeVisible();
      await expect(previewDocument.getByText("Payment Mode:", { exact: true }).first()).toBeVisible();
      await expect(previewDocument.getByText("Ledger Posting (Legacy)", { exact: true }).first()).toBeVisible();

      await page.setViewportSize({ width: 390, height: 844 });
      await previewDialog.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map(async (animation) => {
          try {
            await animation.finished;
          } catch {
            // A responsive layout change may cancel an in-flight open animation.
          }
        }));
      });
      const previewBox = await previewDialog.boundingBox();
      expect(previewBox).not.toBeNull();
      expect(previewBox!.x).toBeGreaterThanOrEqual(0);
      expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(391);
      expect(previewBox!.height).toBeLessThanOrEqual(844);
      const previewScroll = previewDialog.locator("[data-invoice-scroll]");
      const previewScrollBox = await previewScroll.boundingBox();
      expect(previewScrollBox).not.toBeNull();
      expect(previewScrollBox!.x).toBeGreaterThanOrEqual(0);
      expect(previewScrollBox!.x + previewScrollBox!.width).toBeLessThanOrEqual(391);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      const wholesalePdfPath = await downloadPdf(
        page,
        "Download PDF",
        "wholesale-invoice-preview.pdf",
        testInfo,
      );
      const wholesalePdfInfo = pdfInfo(wholesalePdfPath);
      expect(wholesalePdfInfo.pages).toBe(1);
      expect(wholesalePdfInfo.width).toBeLessThan(wholesalePdfInfo.height);
      const wholesaleOcr = normalized(ocrPdf(wholesalePdfPath));
      for (const { label, text } of [
        { label: "trader company prefix", text: `${runTag} GOLD` },
        { label: "trader company suffix", text: "TRADING" },
        { label: "trader contact", text: "SAMIR" },
        { label: "trader phone", text: traderPhone },
        { label: "trader email domain", text: "example.test" },
        { label: "trader address shop", text: "SHOP 42" },
        { label: "trader address market", text: "GOLD SOUQ DEIRA" },
        { label: "trader address city", text: "DUBAI UAE" },
        { label: "pricing type", text: "Fixed Gold Pricing" },
        { label: "payment mode", text: "Ledger Posting (Legacy)" },
      ]) {
        expect(wholesaleOcr, `wholesale PDF is missing ${label}: ${text}`).toContain(normalized(text));
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    });

    await test.step("oversized invoice remains one complete A4 page", async () => {
      await page.goto(`/invoices/${oversized.id}`);
      const document = page.locator("[data-invoice-doc]");
      await expect(document).toContainText("FIRSTMARKER");
      await expect(document).toContainText("FINALMARKER");
      await expect(document).toContainText("Hazari Gold L.L.C");
      await expect(document).toContainText("Customer's Signature");
      await expect(document).toContainText("Checked By");
      await expect(document).toContainText("Authorised Signature");
      const bismillah = document.getByText(BISMILLAH_ARABIC, { exact: true });
      await expect(bismillah).toBeVisible();
      expect(await bismillah.evaluate((element) => getComputedStyle(element).fontFamily)).toContain("Amiri PDF");
      expect(await page.evaluate(
        (text) => document.fonts.check('16px "Amiri PDF"', text),
        BISMILLAH_ARABIC,
      )).toBe(true);
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
      expect(ocr).toContain("CHECKEDBY");
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
      expectArabicBismillah(pages[0]);
      expect(containsExtractedArabicWord(pages.slice(1).join("\n"), BISMILLAH_ARABIC_WORDS[0])).toBe(false);
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

    await test.step("purchase bill matches the customer invoice document structure", async () => {
      const response = await page.request.get(`/api/purchase-bills/${purchaseBill.id}/pdf`);
      await expectSuccessful(response, `download purchase bill ${purchaseBill.billNo}`);
      expect(response.headers()["content-type"]).toContain("application/pdf");
      expect(response.headers()["content-disposition"]).toContain(`purchase-bill-${purchaseBill.billNo}.pdf`);

      const path = testInfo.outputPath("purchase-bill.pdf");
      writeFileSync(path, await response.body());
      expect(readFileSync(path).subarray(0, 4).toString("utf8")).toBe("%PDF");

      const info = pdfInfo(path);
      expect(info.pages).toBe(1);
      expect(info.width).toBeLessThan(info.height);
      const pages = pdfPages(path);
      const text = pages.join("\n");
      const normalizedText = normalized(text);
      const ocr = normalized(ocrPdf(path));

      expect(normalizedText).toContain("PURCHASEBILL");
      expectArabicBismillah(text);
      expect(text).toContain(PURCHASE_BILL_SUPPLIER_CONTACT.phone);
      expect(text).toContain(PURCHASE_BILL_SUPPLIER_CONTACT.email);
      expect(text).toContain(PURCHASE_BILL_SUPPLIER_CONTACT.address);
      for (const requiredText of [
        "Bill / Ref No:",
        "SUPPLIER / VENDOR DETAILS",
        `${runTag} VENDOR`,
        "Supplier / Party Name",
        "Phone Number",
        "Email Address",
        "Address / Location",
        "Stock Description",
        "Gross Wt.",
        "Purity",
        "Pure Wt.",
        "Making",
        "GOLD VALUE",
        "Discount (AED)",
        "NET AMOUNT (AED)",
        "Amount In Words (AED)",
        "Payment Mode",
      ]) {
        expect(text).toContain(requiredText);
      }
      expect(normalized(pdfRawText(path))).toContain(normalized(purchaseBill.billNo));
      for (const requiredOcr of [
        "CUSTOMERSSIGNATURE",
        "CHECKEDBY",
        "AUTHORISEDSIGNATURE",
        "THANKYOUFORYOURBUSINESS",
      ]) {
        expect(ocr).toContain(requiredOcr);
      }

      const visual = finalPageVisualMetrics(path);
      expect(visual.navyAtBottom, "purchase-bill thank-you banner must be flush with the bottom edge").toBe(true);
      expect(visual.goldAtBottom, "purchase-bill gold rule must reach the absolute bottom edge").toBe(true);
      expect(visual.authorisedStampDarkFraction, "purchase-bill seal must be visible above the authorised signature").toBeGreaterThan(0.04);
      expect(firstPageQrDarkFraction(path), "purchase-bill location QR must be visible in the header").toBeGreaterThan(0.08);
    });

    await test.step("filtered supplier purchase statement preserves precision and multi-page branding", async () => {
      const params = new URLSearchParams({
        supplier: statementSupplier,
        category: "995",
        startDate: "2026-08-18",
        endDate: "2026-08-18",
      });
      const response = await page.request.get(`/api/purchase-bills/statement-pdf?${params}`);
      await expectSuccessful(response, "download filtered supplier purchase statement");
      expect(response.headers()["content-type"]).toContain("application/pdf");
      expect(response.headers()["content-disposition"]).toContain("supplier-purchase-statement-");

      const path = testInfo.outputPath("supplier-purchase-statement.pdf");
      writeFileSync(path, await response.body());
      const info = pdfInfo(path);
      expect(info.width).toBeGreaterThan(info.height);
      expect(info.pages).toBeGreaterThan(1);
      const pages = pdfPages(path);
      const text = pages.join("\n");
      expectArabicBismillah(text);
      for (const requiredText of [
        "SUPPLIER PURCHASE STATEMENT",
        "Supplier",
        "Category",
        "995",
        "Period",
        "2026-08-18 to 2026-08-18",
        "Total Purchased Gross Weight",
        "Total Net Pure Weight",
        "Total Purchase Spend / Cash Outflow",
        "Itemized Purchase Bills",
        "Touch / Purity",
        "10.1234",
        "99.512%",
        "10.0740",
        "320.1234",
      ]) {
        expect(text).toContain(requiredText);
      }
      const rawText = normalized(pdfRawText(path));
      expect(rawText).toContain(normalized(statementBillNo));
      expect(rawText).toContain(normalized(statementSupplier));
      expect(text).not.toContain("…");
      for (const pageText of pages) {
        expect(pageText).toContain("Bill / Ref No");
        expect(pageText).toContain("Total Amount (AED)");
      }
      for (const continuationPage of pages.slice(0, -1)) {
        expect(continuationPage).not.toContain("Authorised Signature");
        expect(continuationPage).not.toContain("Thank you for your business!");
      }
      expect(pages.at(-1)).toContain("Authorised Signature");
      expect(pages.at(-1)).toContain("Thank you for your business!");
      const visual = finalPageVisualMetrics(path);
      expect(visual.navyAtBottom, "purchase statement thank-you banner must be flush with the bottom edge").toBe(true);
      expect(visual.goldAtBottom, "purchase statement gold rule must reach the absolute bottom edge").toBe(true);
      expect(visual.authorisedStampDarkFraction, "purchase statement seal must be visible above the authorised signature").toBeGreaterThan(0.04);

      const boundaryParams = new URLSearchParams({ supplier: boundarySupplier });
      const boundaryResponse = await page.request.get(`/api/purchase-bills/statement-pdf?${boundaryParams}`);
      await expectSuccessful(boundaryResponse, "download maximum-length purchase statement");
      const boundaryPath = testInfo.outputPath("maximum-length-purchase-statement.pdf");
      writeFileSync(boundaryPath, await boundaryResponse.body());
      const boundaryRawText = normalized(pdfRawText(boundaryPath));
      expect(boundaryRawText).toContain(normalized(boundarySupplier));
      expect(boundaryRawText).toContain(normalized(boundaryBillNo));
      expect(pdfPages(boundaryPath).join("\n")).not.toContain("…");

      const rejectedResponse = await page.request.get(
        `/api/purchase-bills/statement-pdf?supplier=${"W".repeat(301)}`,
      );
      expect(rejectedResponse.status()).toBe(400);
      expect((await rejectedResponse.json()) as { error: string }).toEqual({
        error: "supplier must not exceed 300 characters",
      });
    });

    await test.step("settled unfixed purchase bill keeps stored pure-weight totals", async () => {
      const response = await page.request.get(`/api/purchase-bills/${settledUnfixedBill.id}/pdf`);
      await expectSuccessful(response, `download settled unfixed purchase bill ${settledUnfixedBill.billNo}`);
      const path = testInfo.outputPath("settled-unfixed-purchase-bill.pdf");
      writeFileSync(path, await response.body());

      const text = pdfPages(path).join("\n");
      expect(normalized(pdfRawText(path))).toContain(normalized(settledUnfixedBill.billNo));
      expect(text).toContain("99.500%");
      expect(text).toContain("PAID IN CASH");
      expect(text).toContain("GOLD VALUE @ 320.000 / gram (AED)");
      expect(text).toContain("Three Thousand One Hundred Eighty Four Dirhams Only");
      expect(text.match(/3,184\.00/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
      expect(text).not.toContain("3,200.00");
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
      expectArabicBismillah(pages[0]);
      expect(containsExtractedArabicWord(pages.slice(1).join("\n"), BISMILLAH_ARABIC_WORDS[0])).toBe(false);
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

    await test.step("registered wholesale invoice and trader IDs are cleaned exactly", async () => {
      const invoiceIdsToVerify = [...wholesaleInvoiceIds];
      const traderIdsToVerify = [...wholesaleTraderIds];
      await removeOwnedFixtures(
        page,
        [],
        [],
        [],
        invoiceIdsToVerify.map((id) => ({ id, runId })),
        traderIdsToVerify.map((id) => ({ id, runId })),
      );
      for (const id of invoiceIdsToVerify) {
        expect((await page.request.get(`/api/wholesale/invoices/${id}`)).status()).toBe(404);
      }
      for (const id of traderIdsToVerify) {
        expect((await page.request.get(`/api/wholesale/traders/${id}`)).status()).toBe(404);
      }
      wholesaleInvoiceIds.length = 0;
      wholesaleTraderIds.length = 0;
    });

    expect(pageErrors, `uncaught browser errors: ${pageErrors.join("\n")}`).toEqual([]);
  } finally {
    await removeOwnedFixtures(
      page,
      invoiceIds,
      purchaseIds,
      purchaseBillIds,
      wholesaleInvoiceIds.map((id) => ({ id, runId })),
      wholesaleTraderIds.map((id) => ({ id, runId })),
    );
    const completed = await page.request.post("/api/test-fixtures/pdf/complete", {
      headers: fixtureHeaders(runId),
    });
    await expectSuccessful(completed, "complete current PDF fixture run");
  }
});