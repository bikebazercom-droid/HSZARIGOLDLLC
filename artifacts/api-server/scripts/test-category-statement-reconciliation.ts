#!/usr/bin/env tsx
/**
 * Integration regression test for the dashboard Stock & Profit Statement.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:category-statement-reconciliation
 *
 * The API server must be running. The script logs in as an admin, creates
 * labelled short-lived stock/invoice fixtures, reads the statement XLSX/PDF,
 * then removes the invoices before removing their purchase batches.
 */

import ExcelJS from "exceljs";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "@workspace/db";
import {
  ensureRegistryProvisioned,
  finalizeSuiteRun,
  recoverAbandonedSuiteRuns,
  startSuiteRun,
  type SuiteEntityType,
} from "./suite-run-registry";

const devDomain = process.env["REPLIT_DEV_DOMAIN"];
const port = process.env["PORT"] ?? "3000";
const BASE = process.env["API_BASE_URL"]
  ?? (devDomain ? `https://${devDomain}/api` : `http://localhost:${port}/api`);
const ADMIN_MOBILE = process.env["TEST_ADMIN_MOBILE"] ?? "01855580555";
const ADMIN_PIN = process.env["TEST_ADMIN_PIN"] ?? "1234";
const TEST_PREFIX = "TEST-STMT";
const RUN_ID = `${process.pid}-${Date.now().toString(36).slice(-4)}`;
const FIXTURE_PREFIX = `${TEST_PREFIX}-${RUN_ID}`;
const PERIOD_START = "0001-01-01";
const PERIOD_END = "0001-02-28";

let cookie = "";
let suiteRunId = "";
let adminUserId = 0;
let passed = 0;
let failed = 0;
const purchaseIds: number[] = [];
const invoiceIds: number[] = [];

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function equal(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 0.001, `${message} (expected ${expected}, got ${actual})`);
}

async function apiReq(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (cookie) headers["Cookie"] = cookie;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function login(): Promise<void> {
  const res = await apiReq("/auth/login", {
    method: "POST",
    body: JSON.stringify({ mobile: ADMIN_MOBILE, pin: ADMIN_PIN, role: "admin" }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0]!;
  const user = (await res.json()) as { id: number };
  adminUserId = user.id;
  console.log("  ✓ Logged in as admin");
}

// ── Durable registry deleter ───────────────────────────────────────────────────

async function deleteRegisteredFixture(entityType: SuiteEntityType, entityId: number): Promise<"deleted" | "missing" | "kept"> {
  const target =
    entityType === "invoice" ? { path: `/invoices/${entityId}`, headers: { "X-Allow-Invoice-Delete": "true" } } :
    entityType === "stock_purchase" ? { path: `/stock/purchases/${entityId}`, headers: {} } :
    entityType === "purchase_bill" ? { path: `/purchase-bills/${entityId}`, headers: { "x-allow-paid-delete": "true" } } :
    { path: `/admin/users/${entityId}`, headers: {} };
  try {
    const res = await apiReq(target.path, { method: "DELETE", headers: target.headers });
    if (res.ok) return "deleted";
    if (res.status === 404) return "missing";
    return "kept";
  } catch { return "kept"; }
}

async function getStockLevels(): Promise<Record<string, number>> {
  const res = await apiReq("/stock/levels");
  if (!res.ok) throw new Error(`Could not read stock levels (${res.status}): ${await res.text()}`);
  const levels = await res.json() as { category: string; weightGrams: number }[];
  return Object.fromEntries(levels.map((level) => [level.category, level.weightGrams]));
}

async function createPurchase(
  category: string,
  grams: number,
  totalPriceAed: number,
  purchaseDate: string,
  label: string,
): Promise<number> {
  const res = await apiReq("/stock/purchases", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
    body: JSON.stringify({
      category,
      supplierName: `${FIXTURE_PREFIX}-${label}`,
      purchaseDate,
      weightGrams: grams,
      totalPriceAed,
    }),
  });
  if (!res.ok) throw new Error(`Could not create ${label} purchase (${res.status}): ${await res.text()}`);
  const created = await res.json() as { id: number };
  purchaseIds.push(created.id);
  return created.id;
}

async function createInvoice(
  label: string,
  createdAt: string,
  description: string,
  category: string,
  grams: number,
  saleValue: number,
): Promise<{ id: number; invoiceNumber: string }> {
  const res = await apiReq("/invoices", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
    body: JSON.stringify({
      customerName: `${FIXTURE_PREFIX}-${label}`,
      paymentMethod: "cash",
      subtotal: saleValue,
      discount: 0,
      total: saleValue,
      vatRate: 5,
      vatAmount: 0,
      totalBeforeVat: saleValue,
      totalIncludingVat: saleValue,
      roundOffDiscount: 0,
      isPending: true,
      createdAt,
      items: [{
        description,
        category,
        quantity: 1,
        grossWeight: grams,
        unitPrice: saleValue / grams,
        totalPrice: saleValue,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Could not create ${label} invoice (${res.status}): ${await res.text()}`);
  const created = await res.json() as { id: number; invoiceNumber: string };
  invoiceIds.push(created.id);
  return created;
}

type CategoryRow = { purchased: number; sold: number; remaining: number };
type Statement = {
  financial: Record<string, number>;
  categories: Record<string, CategoryRow>;
  sales: { invoice: string; cost: number; revenue: number; profit: number; batches: string }[];
};

function cellText(value: ExcelJS.CellValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text;
  }
  return "";
}

async function getStatement(query = ""): Promise<Statement> {
  const response = await apiReq(`/dashboard/statement-xlsx${query}`);
  if (!response.ok) throw new Error(`Statement XLSX failed (${response.status}): ${await response.text()}`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await response.arrayBuffer());
  const summary = workbook.getWorksheet("Summary");
  const statement = workbook.getWorksheet("Statement");
  if (!summary || !statement) throw new Error("Statement workbook is missing Summary or Statement sheets");

  const financial: Record<string, number> = {};
  for (let row = 2; row <= 6; row++) {
    financial[cellText(summary.getCell(row, 1).value)] = Number(summary.getCell(row, 2).value);
  }

  const categories: Record<string, CategoryRow> = {};
  for (let row = 9; row <= summary.rowCount; row++) {
    const label = cellText(summary.getCell(row, 1).value);
    if (!label || label === "TOTAL PHYSICAL METAL") break;
    categories[label] = {
      purchased: Number(summary.getCell(row, 2).value),
      sold: Number(summary.getCell(row, 3).value),
      remaining: Number(summary.getCell(row, 4).value),
    };
  }

  const sales: Statement["sales"] = [];
  let salesHeader = 0;
  for (let row = 1; row <= statement.rowCount; row++) {
    if (cellText(statement.getCell(row, 1).value) === "SECTION 2: SALES & PROFIT") {
      salesHeader = row + 1;
      break;
    }
  }
  if (!salesHeader) throw new Error("Statement sheet is missing sales section");
  for (let row = salesHeader + 1; row <= statement.rowCount; row++) {
    const invoice = cellText(statement.getCell(row, 3).value);
    if (!invoice.startsWith("INV-")) break;
    sales.push({
      invoice,
      cost: Number(statement.getCell(row, 8).value),
      revenue: Number(statement.getCell(row, 9).value),
      profit: Number(statement.getCell(row, 10).value),
      batches: cellText(statement.getCell(row, 11).value),
    });
  }
  return { financial, categories, sales };
}

function category(statement: Statement, label: string): CategoryRow {
  const row = statement.categories[label];
  if (!row) throw new Error(`Missing category row: ${label}`);
  return row;
}

async function listTaggedInvoices(tag: string): Promise<{ id: number }[]> {
  const res = await apiReq(`/invoices?search=${encodeURIComponent(tag)}`);
  if (!res.ok) throw new Error(`Could not list tagged invoices (${res.status}): ${await res.text()}`);
  return res.json() as Promise<{ id: number }[]>;
}

async function listTaggedPurchases(tag: string): Promise<{ id: number }[]> {
  const res = await apiReq(`/stock/purchases?supplier=${encodeURIComponent(tag)}`);
  if (!res.ok) throw new Error(`Could not list tagged purchases (${res.status}): ${await res.text()}`);
  return res.json() as Promise<{ id: number }[]>;
}

async function deleteInvoice(id: number): Promise<void> {
  const res = await apiReq(`/invoices/${id}`, {
    method: "DELETE",
    headers: { "X-Allow-Invoice-Delete": "true" },
  });
  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`Could not delete invoice ${id} (${res.status}): ${await res.text()}`);
  }
}

async function deletePurchase(id: number): Promise<void> {
  const res = await apiReq(`/stock/purchases/${id}`, { method: "DELETE" });
  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`Could not delete purchase ${id} (${res.status}): ${await res.text()}`);
  }
}

async function assertReservedPeriodIsFree(): Promise<void> {
  // No older purchase may exist: FIFO must consume this run's two gold lots.
  const purchaseRes = await apiReq(`/stock/purchases?endDate=${PERIOD_END}`);
  if (!purchaseRes.ok) throw new Error(`Could not verify reserved purchase period: ${await purchaseRes.text()}`);
  const oldPurchases = await purchaseRes.json() as unknown[];

  const invoiceRes = await apiReq(`/invoices?startDate=${PERIOD_START}&endDate=${PERIOD_END}`);
  if (!invoiceRes.ok) throw new Error(`Could not verify reserved invoice period: ${await invoiceRes.text()}`);
  const oldInvoices = await invoiceRes.json() as unknown[];

  if (oldPurchases.length > 0 || oldInvoices.length > 0) {
    throw new Error(
      `Reserved statement-test period is occupied (${oldPurchases.length} purchases, ${oldInvoices.length} invoices)`,
    );
  }
}

async function cleanUp(baseline: Record<string, number>): Promise<void> {
  const errors: string[] = [];
  for (const id of [...invoiceIds].reverse()) {
    try {
      await deleteInvoice(id);
    } catch (error) {
      errors.push(String(error));
    }
  }
  for (const id of [...purchaseIds].reverse()) {
    try {
      await deletePurchase(id);
    } catch (error) {
      errors.push(String(error));
    }
  }

  try {
    const [leftoverInvoices, leftoverPurchases, restoredLevels] = await Promise.all([
      listTaggedInvoices(FIXTURE_PREFIX),
      listTaggedPurchases(FIXTURE_PREFIX),
      getStockLevels(),
    ]);
    if (leftoverInvoices.length > 0 || leftoverPurchases.length > 0) {
      errors.push(
        `Cleanup left ${leftoverInvoices.length} invoices and ${leftoverPurchases.length} purchases for ${FIXTURE_PREFIX}`,
      );
    }
    for (const key of ["gold_9999", "ten_tola_bar", "kg_bar", "995", "gold_jewelry_22k", "silver"]) {
      if (Math.abs((restoredLevels[key] ?? 0) - (baseline[key] ?? 0)) >= 0.001) {
        errors.push(`Stock level ${key} was not restored to its pre-test balance`);
      }
    }
  } catch (error) {
    errors.push(String(error));
  }

  if (errors.length > 0) {
    throw new Error(`Fixture cleanup verification failed:\n${errors.join("\n")}`);
  }
}

async function main(): Promise<void> {
  console.log("\n━━━ Category statement reconciliation tests ━━━");
  console.log(`API base: ${BASE}`);
  await login();

  await ensureRegistryProvisioned();
  const recovery = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  if (recovery.claimedRunIds.length > 0) console.log(`  ✓ Recovered ${recovery.deleted} abandoned registered fixture(s) from ${recovery.claimedRunIds.length} prior run(s)${recovery.kept > 0 ? ` (${recovery.kept} kept)` : ""}`);
  suiteRunId = await startSuiteRun("category-statement-reconciliation", adminUserId);

  let suiteSucceeded = false;
  try {
    // A crashed prior run's records are recovered above strictly by the exact
    // IDs in the suite run registry — never by text-prefix matching, which
    // could hit legitimate records. If anything (legacy or unowned) still
    // occupies the reserved period, fail safely instead of deleting it.
    await assertReservedPeriodIsFree();
    const baseline = await getStockLevels();
    try {
    // The reserved earliest AD dates isolate totals and guarantee these lots
    // are first in FIFO order after the preflight check above.
    const goldFirst = await createPurchase("gold_9999", 10, 1000, "0001-01-01", "GOLD-OLD");
    const goldSecond = await createPurchase("gold_9999", 10, 2000, "0001-01-02", "GOLD-NEW");
    await createPurchase("ten_tola_bar", 8, 800, "0001-01-03", "TT");
    await createPurchase("995", 6, 720, "0001-01-04", "995");
    await createPurchase("gold_jewelry_22k", 4, 1600, "0001-01-05", "JEWELRY");
    await createPurchase("silver", 20, 200, "0001-01-06", "SILVER");

    const goldSale = await createInvoice("GOLD-SPLIT", "0001-01-10T10:00:00.000Z", "Gold bar", "gold_9999", 15, 4500);
    await createInvoice("TT", "0001-01-11T10:00:00.000Z", "TT Bar", "ten_tola_bar", 3, 450);
    await createInvoice("995", "0001-01-12T10:00:00.000Z", "995", "ten_tola_bar", 2, 360);
    await createInvoice("JEWELRY", "0001-01-13T10:00:00.000Z", "22K chain", "gold_jewelry", 1, 600);
    await createInvoice("SILVER", "0001-01-14T10:00:00.000Z", "Silver", "silver", 5, 100);

    // Enough rows to force the PDF's tables and final summary through page breaks.
    for (let i = 0; i < 42; i++) {
      await createPurchase("kg_bar", 1, 50, `0001-02-${String((i % 28) + 1).padStart(2, "0")}`, `LONG-${i}`);
    }

    console.log("\nTest 1: Category mapping and exact FIFO profit");
    const january = await getStatement("?startDate=0001-01-01&endDate=0001-01-31");
    const expected: Record<string, { key: string } & CategoryRow> = {
      "GOLD 9999": { key: "gold_9999", purchased: 20, sold: 15, remaining: 5 },
      "TEN TOLA BAR": { key: "ten_tola_bar", purchased: 8, sold: 3, remaining: 5 },
      "995": { key: "995", purchased: 6, sold: 2, remaining: 4 },
      "Gold Jewelry 22K": { key: "gold_jewelry_22k", purchased: 4, sold: 1, remaining: 3 },
      Silver: { key: "silver", purchased: 20, sold: 5, remaining: 15 },
    };
    for (const [label, values] of Object.entries(expected)) {
      const row = category(january, label);
      equal(row.purchased, values.purchased, `${label} purchased weight maps correctly`);
      equal(row.sold, values.sold, `${label} sold weight maps correctly`);
      equal(
        row.remaining,
        (baseline[values.key] ?? 0) + values.remaining,
        `${label} remaining weight reconciles to the live vault`,
      );
    }
    equal(january.financial["Total Cash Outflow - Purchases Debit (AED)"], 6320, "January purchase cash total is exact");
    equal(january.financial["Total Cash Inflow - Sales Revenue Credit (AED)"], 6010, "January sales revenue is exact");
    equal(january.financial["Purchase Cost of Goods Sold - COGS (AED)"], 2990, "exact FIFO COGS is used");
    equal(january.financial["Overall Net Realized Profit (AED)"], 3020, "realized profit reconciles to revenue minus FIFO COGS");
    const splitSale = january.sales.find((sale) => sale.invoice === goldSale.invoiceNumber);
    assert(splitSale !== undefined, "split FIFO invoice is present in statement sales");
    if (splitSale) {
      equal(splitSale.cost, 2000, "split FIFO invoice COGS uses both purchase rates");
      equal(splitSale.revenue, 4500, "split FIFO invoice revenue is retained");
      equal(splitSale.profit, 2500, "split FIFO invoice profit is exact");
      assert(
        splitSale.batches.includes(`#${goldFirst} (10g)`) && splitSale.batches.includes(`#${goldSecond} (5g)`),
        `split FIFO invoice names both consumed batches (got "${splitSale.batches}")`,
      );
    }

    console.log("\nTest 2: Period/category filters do not turn live stock into historical stock");
    const goldOnly = await getStatement("?startDate=0001-01-10&endDate=0001-01-10&category=gold_9999");
    const filteredGold = category(goldOnly, "GOLD 9999");
    equal(filteredGold.purchased, 0, "period filter excludes earlier gold purchases");
    equal(filteredGold.sold, 15, "period filter includes the gold sale");
    equal(filteredGold.remaining, (baseline.gold_9999 ?? 0) + 5, "gold remaining balance stays the current live vault balance");
    equal(goldOnly.financial["Total Cash Outflow - Purchases Debit (AED)"], 0, "filtered purchase cash total is zero");
    equal(goldOnly.financial["Total Cash Inflow - Sales Revenue Credit (AED)"], 4500, "category-filtered revenue is exact");
    equal(goldOnly.financial["Purchase Cost of Goods Sold - COGS (AED)"], 2000, "category-filtered FIFO COGS is exact");
    assert(Object.keys(goldOnly.categories).length === 1, "category filter excludes other category rows");

    console.log("\nTest 3: Long statement PDF preserves paginated report output");
    const pdf = await apiReq(`/dashboard/statement-pdf?startDate=${PERIOD_START}&endDate=${PERIOD_END}`);
    const pdfBytes = Buffer.from(await pdf.arrayBuffer());
    assert(pdf.status === 200, `statement PDF returns 200 (got ${pdf.status})`);
    assert(pdf.headers.get("content-type")?.includes("application/pdf") ?? false, "statement export is a PDF");
    assert(pdfBytes.length > 10_000, "long statement PDF has substantial document content");

    const pdfDir = await mkdtemp(join(tmpdir(), "category-statement-"));
    try {
      const pdfPath = join(pdfDir, "statement.pdf");
      await writeFile(pdfPath, pdfBytes);
      const renderedText = execFileSync("pdftotext", ["-layout", pdfPath, "-"], {
        encoding: "utf8",
        maxBuffer: 2_000_000,
      });
      const pages = renderedText.split("\f").filter((page) => page.trim().length > 0);
      assert(pages.length >= 3, `long fixture spans multiple rendered PDF pages (got ${pages.length})`);

      const purchaseHeaderPages = pages.filter(
        (page) => page.includes("Ref / Batch") && page.includes("Cash Outflow (AED)"),
      );
      assert(
        purchaseHeaderPages.length >= 2,
        `purchase table header repeats on continuation pages (found on ${purchaseHeaderPages.length} pages)`,
      );

      const categoryPage = pages.find((page) => page.includes("3. Category-wise Vault Breakdown"));
      assert(categoryPage !== undefined, "category-wise vault table is present in rendered PDF text");
      if (categoryPage) {
        const categoryTableComplete = [
          "Category Name", "Metal Purchased / In", "Metal Sold / Out",
          "Net Remaining Vault Balance", "995", "GOLD 9999", "TEN TOLA BAR", "KG Bar",
          "Gold Jewelry 22K", "Silver", "TOTAL PHYSICAL METAL",
        ].every((text) => categoryPage.includes(text));
        assert(categoryTableComplete, "category table headers, mapped rows, and total stay readable together");
      }

      const summaryPage = pages.find((page) => page.includes("4. Financial Debit / Credit & Profit Summary"));
      assert(summaryPage !== undefined, "financial summary is present in rendered PDF text");
      if (summaryPage) {
        const summaryComplete = [
          "Total Sold Weight", "Total Cash Outflow", "Total Cash Inflow",
          "Purchase Cost of Goods Sold", "OVERALL NET REALIZED PROFIT",
          "TOTAL PHYSICAL METAL REMAINING",
        ].every((text) => summaryPage.includes(text));
        assert(summaryComplete, "the complete financial summary remains together on one rendered page");
      }

      assert(
        renderedText.includes(`${FIXTURE_PREFIX}-LONG-0`)
          && renderedText.includes(`${FIXTURE_PREFIX}-LONG-41`),
        "rendered PDF contains the first and last long-fixture purchase rows",
      );
    } finally {
      await rm(pdfDir, { recursive: true, force: true });
    }

    if (failed === 0) suiteSucceeded = true;
    } finally {
      await cleanUp(baseline);
      console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
      if (failed > 0) process.exitCode = 1;
    }
  } finally {
    const finalized = await finalizeSuiteRun(suiteRunId, suiteSucceeded);
    if (!finalized.cleaned) console.warn(`Retaining suite run registry for later recovery (${finalized.remainingFixtures} registered fixture(s) still present).`);
    await pool.end().catch(() => {});
  }
}

main().catch(async (error) => {
  console.error("\nUnhandled error:", error);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});