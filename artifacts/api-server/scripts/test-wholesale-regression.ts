#!/usr/bin/env tsx
/**
 * Wholesale B2B regression test
 *
 * Covers:
 *   1. Fixed invoice creation — AED ledger entries, settled status, stock deduction
 *   2. Unfixed invoice creation — pure-gram ledger, open status, stock deduction
 *   3. Partial rate fix — partial settlement, status → partially_settled, over-fix rejection (409)
 *   4. Full rate fix — status → settled
 *   5. Partial physical return — FIFO restoration, stock delta, ledger, over-return rejection (409)
 *   6. Stock movement / ledger reconciliation
 *   7. Idempotency rerun — exact same result, no duplicate rows
 *   8. All fixtures cleaned up — no stock/ledger changes left
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run test:wholesale-regression
 *
 * The API server must be running.
 */

import { pool, db } from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  pdfTestFixturesTable,
  pdfTestRunsTable,
  wholesaleTradersTable,
  wholesaleInvoicesTable,
  wholesaleInvoiceItemsTable,
  wholesaleInventoryConsumptionsTable,
  wholesaleSettlementsTable,
  wholesaleSettlementAllocationsTable,
  wholesaleReturnsTable,
  wholesaleReturnLinesTable,
  traderLedgerEntriesTable,
  stockLevelsTable,
  stockPurchasesTable,
  stockMovementsTable,
  auditLogTable,
} from "@workspace/db";
import {
  ensureRegistryProvisioned,
  finalizeSuiteRun,
  recoverAbandonedSuiteRuns,
  startSuiteRun,
  unregisterSuiteFixture,
  type SuiteEntityType,
} from "./suite-run-registry.js";
import {
  applyPhysicalReturn,
  createWholesaleInvoice,
} from "../src/services/wholesaleService.js";
import { acquireStockMutationLock } from "../src/services/inventoryEngine.js";
import ExcelJS from "exceljs";

// ── Config ────────────────────────────────────────────────────────────────────

const devDomain = process.env["REPLIT_DEV_DOMAIN"];
const port = process.env["PORT"] ?? "3000";
const BASE = process.env["API_BASE_URL"]
  ?? (devDomain ? `https://${devDomain}/api` : `http://localhost:${port}/api`);

const ADMIN_MOBILE = process.env["TEST_ADMIN_MOBILE"] ?? "01855580555";
const ADMIN_PIN = process.env["TEST_ADMIN_PIN"] ?? "1234";
const CATEGORY = "gold_9999";
const WHOLESALE_CATEGORIES = [
  "gold_9999",
  "ten_tola_bar",
  "kg_bar",
  "995",
  "gold_jewelry_22k",
  "silver",
] as const;

// ── State ─────────────────────────────────────────────────────────────────────

let _cookie = "";
let adminUserId = 0;
let suiteRunId = "";
let passCount = 0;
let failCount = 0;

// Track created DB IDs for cleanup
const toClean: {
  traderIds: number[];
  invoiceIds: number[];
  returnIds: number[];
  stockPurchaseIds: number[];
  categories: string[];
} = {
  traderIds: [],
  invoiceIds: [],
  returnIds: [],
  stockPurchaseIds: [],
  categories: [CATEGORY, ...WHOLESALE_CATEGORIES],
};

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function apiReq(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(suiteRunId ? { "X-Pdf-E2e-Run-Id": suiteRunId } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (_cookie) headers["Cookie"] = _cookie;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiReq(path, init);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function assertPdf(path: string, label: string): Promise<void> {
  const res = await apiReq(path);
  const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
  assert(
    res.status === 200
      && (res.headers.get("content-type") ?? "").startsWith("application/pdf")
      && bytes > 500,
    label,
    `status=${res.status}, content-type=${res.headers.get("content-type")}, bytes=${bytes}`,
  );
}

async function assertXlsxContains(path: string, needle: string, label: string): Promise<void> {
  const res = await apiReq(path);
  if (!res.ok) {
    assert(false, label, `status=${res.status}`);
    return;
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const text = workbook.worksheets
    .flatMap((sheet) => sheet.getSheetValues())
    .flatMap((row) => Array.isArray(row) ? row : [])
    .map((value) => String(value ?? ""))
    .join("\n");
  assert(text.includes(needle), label, `missing ${needle}`);
}

async function login(): Promise<void> {
  const res = await apiReq("/auth/login", {
    method: "POST",
    body: JSON.stringify({ mobile: ADMIN_MOBILE, pin: ADMIN_PIN, role: "admin" }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) _cookie = setCookie.split(";")[0]!;
  const user = await res.json() as { id: number };
  adminUserId = user.id;
  console.log("  ✓ Logged in as admin");
}

// ── Assertions ────────────────────────────────────────────────────────────────

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passCount++;
  } else {
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
    failCount++;
  }
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertClose(actual: number, expected: number, label: string, tolerance = 0.01): void {
  assert(Math.abs(actual - expected) < tolerance, label, `expected ~${expected}, got ${actual}`);
}

// ── Stock setup ───────────────────────────────────────────────────────────────

async function createStockPurchase(
  weightGrams: number,
  pricePerGram: number,
  category = CATEGORY,
  runId = suiteRunId,
  trackForMainCleanup = true,
  purchaseDate = "2025-01-01",
): Promise<number> {
  const body = {
    category,
    supplierName: "TEST-WHOLESALE-SUPPLIER",
    purchaseDate,
    weightGrams,
    totalPriceAed: weightGrams * pricePerGram,
    narrative: "Wholesale regression test batch",
  };
  const res = await apiJson<{ id: number }>("/stock/purchases", {
    method: "POST",
    headers: runId ? { "X-Pdf-E2e-Run-Id": runId } : {},
    body: JSON.stringify(body),
  });
  if (trackForMainCleanup) toClean.stockPurchaseIds.push(res.id);
  return res.id;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

type DeleteOutcome = "deleted" | "missing" | "kept";

async function deleteWholesaleInvoiceFixture(invoiceId: number, runId: string): Promise<DeleteOutcome> {
  try {
    return await db.transaction(async (tx) => {
      await acquireStockMutationLock(tx as unknown as typeof db);
      const [invoice] = await tx.select({ id: wholesaleInvoicesTable.id })
        .from(wholesaleInvoicesTable)
        .where(eq(wholesaleInvoicesTable.id, invoiceId))
        .for("update");
      if (!invoice) return "missing";
      const [ownedInvoice] = await tx.select({ id: pdfTestFixturesTable.id })
        .from(pdfTestFixturesTable)
        .where(and(
          eq(pdfTestFixturesTable.runId, runId),
          eq(pdfTestFixturesTable.entityType, "wholesale_invoice"),
          eq(pdfTestFixturesTable.entityId, invoiceId),
        ));
      if (!ownedInvoice) return "kept";

      const consumptions = await tx.select({
        purchaseId: wholesaleInventoryConsumptionsTable.purchaseId,
        consumedGrams: wholesaleInventoryConsumptionsTable.consumedGrams,
        returnedGrams: wholesaleInventoryConsumptionsTable.returnedGrams,
        isShortfall: wholesaleInventoryConsumptionsTable.isShortfall,
        category: wholesaleInventoryConsumptionsTable.category,
      })
        .from(wholesaleInventoryConsumptionsTable)
        .where(eq(wholesaleInventoryConsumptionsTable.wholesaleInvoiceId, invoiceId));
      const returns = await tx.select({ id: wholesaleReturnsTable.id })
        .from(wholesaleReturnsTable)
        .where(eq(wholesaleReturnsTable.invoiceId, invoiceId));
      const returnIds = returns.map((row) => row.id);
      if (returnIds.length > 0) {
        const registeredReturns = await tx.select({ entityId: pdfTestFixturesTable.entityId })
          .from(pdfTestFixturesTable)
          .where(and(
            eq(pdfTestFixturesTable.runId, runId),
            eq(pdfTestFixturesTable.entityType, "wholesale_return"),
            inArray(pdfTestFixturesTable.entityId, returnIds),
          ));
        const registeredReturnIds = new Set(registeredReturns.map((row) => row.entityId));
        if (returnIds.some((returnId) => !registeredReturnIds.has(returnId))) {
          return "kept";
        }
      }

      const movements = await tx.select({
        category: stockMovementsTable.category,
        weightGrams: stockMovementsTable.weightGrams,
      })
        .from(stockMovementsTable)
        .where(or(
          and(
            eq(stockMovementsTable.refType, "wholesale_invoice"),
            eq(stockMovementsTable.refId, invoiceId),
          ),
          ...(returnIds.length > 0
            ? [and(
                eq(stockMovementsTable.refType, "wholesale_return"),
                inArray(stockMovementsTable.refId, returnIds),
              )]
            : []),
        ));

      for (const consumption of consumptions) {
        const netConsumed = Number(consumption.consumedGrams) - Number(consumption.returnedGrams);
        if (consumption.purchaseId != null && netConsumed > 0.0001) {
          const restored = await tx.execute<{ id: number }>(sql`
            UPDATE stock_purchases
            SET remaining_weight_grams = remaining_weight_grams::numeric + ${String(netConsumed)}::numeric
            WHERE id = ${consumption.purchaseId}
              AND remaining_weight_grams::numeric + ${String(netConsumed)}::numeric
                  <= weight_grams::numeric + 0.0001
            RETURNING id
          `);
          if (restored.rows.length !== 1) {
            throw new Error(`Could not restore FIFO batch ${consumption.purchaseId} for wholesale invoice ${invoiceId}`);
          }
        } else if (consumption.purchaseId == null && !consumption.isShortfall && netConsumed > 0.0001) {
          throw new Error(`Wholesale invoice ${invoiceId} has a missing non-shortfall FIFO source batch`);
        }
      }

      const stockDeltas = new Map<string, number>();
      for (const movement of movements) {
        stockDeltas.set(
          movement.category,
          (stockDeltas.get(movement.category) ?? 0) + Number(movement.weightGrams),
        );
      }
      for (const [category, fixtureDelta] of stockDeltas) {
        const reversed = await tx.update(stockLevelsTable)
          .set({
            weightGrams: sql`${stockLevelsTable.weightGrams} - ${String(fixtureDelta)}`,
            updatedAt: new Date(),
          })
          .where(eq(stockLevelsTable.category, category))
          .returning({ id: stockLevelsTable.id });
        if (reversed.length !== 1) {
          throw new Error(`Stock level ${category} is missing while recovering wholesale invoice ${invoiceId}`);
        }
      }

      await tx.delete(stockMovementsTable).where(and(
        eq(stockMovementsTable.refType, "wholesale_invoice"),
        eq(stockMovementsTable.refId, invoiceId),
      ));
      await tx.delete(auditLogTable).where(and(
        eq(auditLogTable.entityType, "wholesale_invoice"),
        eq(auditLogTable.entityId, invoiceId),
      ));
      if (returnIds.length > 0) {
        await tx.delete(stockMovementsTable).where(and(
          eq(stockMovementsTable.refType, "wholesale_return"),
          inArray(stockMovementsTable.refId, returnIds),
        ));
        await tx.delete(auditLogTable).where(and(
          eq(auditLogTable.entityType, "wholesale_return"),
          inArray(auditLogTable.entityId, returnIds),
        ));
      }

      await tx.delete(traderLedgerEntriesTable)
        .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, invoiceId));
      await tx.delete(wholesaleReturnsTable).where(eq(wholesaleReturnsTable.invoiceId, invoiceId));
      await tx.delete(wholesaleSettlementsTable).where(eq(wholesaleSettlementsTable.invoiceId, invoiceId));
      await tx.delete(wholesaleInventoryConsumptionsTable)
        .where(eq(wholesaleInventoryConsumptionsTable.wholesaleInvoiceId, invoiceId));
      await tx.delete(wholesaleInvoiceItemsTable).where(eq(wholesaleInvoiceItemsTable.invoiceId, invoiceId));
      await tx.delete(wholesaleInvoicesTable).where(eq(wholesaleInvoicesTable.id, invoiceId));
      return "deleted";
    });
  } catch (error) {
    console.warn(`    cleanup wholesale invoice ${invoiceId} failed: ${error}`);
    return "kept";
  }
}

async function deleteRegisteredFixture(
  entityType: SuiteEntityType,
  entityId: number,
  runId = suiteRunId,
): Promise<DeleteOutcome> {
  if (entityType === "wholesale_invoice") {
    if (!runId) return "kept";
    return deleteWholesaleInvoiceFixture(entityId, runId);
  }
  if (entityType === "wholesale_return") {
    const [row] = await db.select({ id: wholesaleReturnsTable.id })
      .from(wholesaleReturnsTable)
      .where(eq(wholesaleReturnsTable.id, entityId));
    // Returns are removed only through their registered parent invoice so stock,
    // FIFO slices, ledger entries, and invoice totals cannot diverge.
    return row ? "kept" : "missing";
  }
  if (entityType === "wholesale_trader") {
    try {
      const deleted = await db.transaction(async (tx) => {
        const [row] = await tx.delete(wholesaleTradersTable)
          .where(eq(wholesaleTradersTable.id, entityId))
          .returning({ id: wholesaleTradersTable.id });
        return row;
      });
      return deleted ? "deleted" : "missing";
    } catch {
      return "kept";
    }
  }

  const target =
    entityType === "invoice"
      ? { path: `/invoices/${entityId}`, headers: { "X-Allow-Invoice-Delete": "true" } }
      : entityType === "stock_purchase"
        ? { path: `/stock/purchases/${entityId}`, headers: {} }
        : entityType === "purchase_bill"
          ? { path: `/purchase-bills/${entityId}`, headers: { "x-allow-paid-delete": "true" } }
          : { path: `/admin/users/${entityId}`, headers: {} };
  try {
    const res = await apiReq(target.path, { method: "DELETE", headers: target.headers });
    if (res.ok) return "deleted";
    if (res.status === 404) return "missing";
    return "kept";
  } catch {
    return "kept";
  }
}

async function recoverAbandonedWholesaleRuns() {
  return recoverAbandonedSuiteRuns(deleteRegisteredFixture, new Date(), "wholesale");
}

async function cleanupRegisteredFixture(
  entityType: SuiteEntityType,
  entityId: number,
  runId = suiteRunId,
): Promise<void> {
  const outcome = await deleteRegisteredFixture(entityType, entityId, runId);
  if (outcome !== "kept" && runId) {
    await unregisterSuiteFixture(runId, entityType, entityId);
  }
}

async function cleanup(): Promise<void> {
  console.log("\n─── Cleaning up fixtures ───");
  for (const invoiceId of toClean.invoiceIds) {
    await cleanupRegisteredFixture("wholesale_invoice", invoiceId);
  }
  for (const returnId of toClean.returnIds) {
    await cleanupRegisteredFixture("wholesale_return", returnId);
  }
  for (const stockPurchaseId of toClean.stockPurchaseIds) {
    await cleanupRegisteredFixture("stock_purchase", stockPurchaseId);
  }
  for (const traderId of toClean.traderIds) {
    await cleanupRegisteredFixture("wholesale_trader", traderId);
  }
}

interface RecoveryBundle {
  traderId: number;
  invoiceId: number;
  returnId: number;
  stockPurchaseId: number;
}

async function createRecoveryBundle(runId: string, label: string): Promise<RecoveryBundle> {
  const stockCategory = label === "CRASHED" ? "ten_tola_bar" : "kg_bar";
  const invoiceCategory = label === "UNRELATED" ? "ten_tola_bar" : stockCategory;
  const stockPurchaseId = await createStockPurchase(10, 400, stockCategory, runId, false, "0001-01-01");
  const trader = await apiJson<{ id: number; name: string }>("/wholesale/traders", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": runId },
    body: JSON.stringify({
      name: `WHOLESALE RECOVERY ${label}`,
      phone: `+97150${String(Date.now()).slice(-7)}`,
      isActive: true,
    }),
  });
  const invoice = await apiJson<{
    id: number;
    items: { id: number }[];
  }>("/wholesale/invoices", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": runId },
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-06-01",
      pricingType: "unfixed",
      idempotencyKey: `recovery-${label.toLowerCase()}-${Date.now()}`,
      items: [{
        description: `Recovery ${label}`,
        category: invoiceCategory,
        quantity: 1,
        grossGrams: 4,
        purityMultiplier: 0.9999,
        makingAed: 0,
      }],
    }),
  });
  const returned = await apiJson<{ id: number }>(`/wholesale/invoices/${invoice.id}/return`, {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": runId },
    body: JSON.stringify({
      date: "2025-06-02",
      idempotencyKey: `recovery-return-${label.toLowerCase()}-${Date.now()}`,
      lines: [{ invoiceItemId: invoice.items[0]!.id, grossWeightGrams: 1 }],
    }),
  });
  return {
    traderId: trader.id,
    invoiceId: invoice.id,
    returnId: returned.id,
    stockPurchaseId,
  };
}

async function recoveryBundleExists(bundle: RecoveryBundle): Promise<Record<keyof RecoveryBundle, boolean>> {
  const [trader, invoice, returned, stockPurchase] = await Promise.all([
    db.select({ id: wholesaleTradersTable.id })
      .from(wholesaleTradersTable)
      .where(eq(wholesaleTradersTable.id, bundle.traderId)),
    db.select({ id: wholesaleInvoicesTable.id })
      .from(wholesaleInvoicesTable)
      .where(eq(wholesaleInvoicesTable.id, bundle.invoiceId)),
    db.select({ id: wholesaleReturnsTable.id })
      .from(wholesaleReturnsTable)
      .where(eq(wholesaleReturnsTable.id, bundle.returnId)),
    db.select({ id: stockPurchasesTable.id })
      .from(stockPurchasesTable)
      .where(eq(stockPurchasesTable.id, bundle.stockPurchaseId)),
  ]);
  return {
    traderId: trader.length === 1,
    invoiceId: invoice.length === 1,
    returnId: returned.length === 1,
    stockPurchaseId: stockPurchase.length === 1,
  };
}

async function cleanupRecoveryBundle(runId: string, bundle: RecoveryBundle): Promise<void> {
  await cleanupRegisteredFixture("wholesale_invoice", bundle.invoiceId, runId);
  await cleanupRegisteredFixture("wholesale_return", bundle.returnId, runId);
  await cleanupRegisteredFixture("stock_purchase", bundle.stockPurchaseId, runId);
  await cleanupRegisteredFixture("wholesale_trader", bundle.traderId, runId);
}

async function testInterruptionRecoveryIsolation(): Promise<void> {
  console.log("\n─── Test: interrupted-run recovery touches only registered wholesale IDs ───");
  const crashedRunId = await startSuiteRun("wholesale-regression-crashed", adminUserId);
  const unrelatedRunId = await startSuiteRun("wholesale-regression-unrelated", adminUserId);
  let crashedBundle: RecoveryBundle | null = null;
  let unrelatedBundle: RecoveryBundle | null = null;

  try {
    crashedBundle = await createRecoveryBundle(crashedRunId, "CRASHED");
    unrelatedBundle = await createRecoveryBundle(unrelatedRunId, "UNRELATED");
    const unrelatedConsumptions = await db.select({
      purchaseId: wholesaleInventoryConsumptionsTable.purchaseId,
    })
      .from(wholesaleInventoryConsumptionsTable)
      .where(eq(
        wholesaleInventoryConsumptionsTable.wholesaleInvoiceId,
        unrelatedBundle.invoiceId,
      ));
    assert(
      unrelatedConsumptions.every((row) => row.purchaseId !== crashedBundle!.stockPurchaseId),
      "Another run cannot consume this run's registered stock batch",
      JSON.stringify(unrelatedConsumptions),
    );

    const registered = await db.select({
      entityType: pdfTestFixturesTable.entityType,
      entityId: pdfTestFixturesTable.entityId,
    })
      .from(pdfTestFixturesTable)
      .where(eq(pdfTestFixturesTable.runId, crashedRunId));
    const expected = [
      ["wholesale_trader", crashedBundle.traderId],
      ["wholesale_invoice", crashedBundle.invoiceId],
      ["wholesale_return", crashedBundle.returnId],
      ["stock_purchase", crashedBundle.stockPurchaseId],
    ] as const;
    assert(
      expected.every(([entityType, entityId]) =>
        registered.some((row) => row.entityType === entityType && row.entityId === entityId)),
      "Trader, invoice, return, and stock IDs are registered by their create transactions",
      JSON.stringify(registered),
    );

    const crossRunInvoice = await apiReq("/wholesale/invoices", {
      method: "POST",
      headers: { "X-Pdf-E2e-Run-Id": unrelatedRunId },
      body: JSON.stringify({
        traderId: crashedBundle.traderId,
        invoiceDate: "2025-06-03",
        pricingType: "unfixed",
        items: [{
          description: "Cross-run trader ownership probe",
          category: "kg_bar",
          quantity: 1,
          grossGrams: 1,
          purityMultiplier: 0.9999,
          makingAed: 0,
        }],
      }),
    });
    assert(crossRunInvoice.status === 409, "Another run cannot create an invoice for this run's trader");
    const unownedInvoice = await apiReq("/wholesale/invoices", {
      method: "POST",
      body: JSON.stringify({
        traderId: crashedBundle.traderId,
        invoiceDate: "2025-06-03",
        pricingType: "unfixed",
        items: [{
          description: "Unowned trader mutation probe",
          category: "kg_bar",
          quantity: 1,
          grossGrams: 1,
          purityMultiplier: 0.9999,
          makingAed: 0,
        }],
      }),
    });
    assert(unownedInvoice.status === 409, "An unregistered request cannot use a registered wholesale trader");

    const [crashedItem] = await db.select({ id: wholesaleInvoiceItemsTable.id })
      .from(wholesaleInvoiceItemsTable)
      .where(eq(wholesaleInvoiceItemsTable.invoiceId, crashedBundle.invoiceId));
    if (!crashedItem) throw new Error("Interrupted-run fixture item was not created");
    const crossRunReturn = await apiReq(`/wholesale/invoices/${crashedBundle.invoiceId}/return`, {
      method: "POST",
      headers: { "X-Pdf-E2e-Run-Id": unrelatedRunId },
      body: JSON.stringify({
        date: "2025-06-03",
        lines: [{ invoiceItemId: crashedItem.id, grossWeightGrams: 1 }],
      }),
    });
    assert(crossRunReturn.status === 409, "Another run cannot attach a return to this run's invoice");
    const unownedReturn = await apiReq(`/wholesale/invoices/${crashedBundle.invoiceId}/return`, {
      method: "POST",
      body: JSON.stringify({
        date: "2025-06-03",
        lines: [{ invoiceItemId: crashedItem.id, grossWeightGrams: 1 }],
      }),
    });
    assert(unownedReturn.status === 409, "An unregistered request cannot mutate a registered wholesale invoice");

    await db.update(pdfTestRunsTable)
      .set({ createdAt: sql`now() - interval '10 minutes'` })
      .where(eq(pdfTestRunsTable.runId, crashedRunId));
    const recovery = await recoverAbandonedWholesaleRuns();
    assert(recovery.claimedRunIds.includes(crashedRunId), "Interrupted wholesale run is claimed");
    assert(!recovery.claimedRunIds.includes(unrelatedRunId), "Fresh unrelated run is not claimed");

    const crashedExists = await recoveryBundleExists(crashedBundle);
    assert(
      Object.values(crashedExists).every((exists) => !exists),
      "Only the interrupted run's exact wholesale records are removed",
      JSON.stringify(crashedExists),
    );
    const unrelatedExists = await recoveryBundleExists(unrelatedBundle);
    assert(
      Object.values(unrelatedExists).every(Boolean),
      "Unrelated trader, invoice, return, and stock records remain untouched",
      JSON.stringify(unrelatedExists),
    );
    const unrelatedRegistry = await db.select({ id: pdfTestFixturesTable.id })
      .from(pdfTestFixturesTable)
      .where(eq(pdfTestFixturesTable.runId, unrelatedRunId));
    assert(unrelatedRegistry.length === 4, "Unrelated run keeps all four exact fixture registrations");
  } finally {
    if (unrelatedBundle) {
      await cleanupRecoveryBundle(unrelatedRunId, unrelatedBundle);
    }
    const [unrelatedRun] = await db.select({ id: pdfTestRunsTable.id })
      .from(pdfTestRunsTable)
      .where(eq(pdfTestRunsTable.runId, unrelatedRunId));
    if (unrelatedRun) {
      const finalized = await finalizeSuiteRun(unrelatedRunId, unrelatedBundle != null);
      if (!finalized.cleaned) {
        await db.update(pdfTestRunsTable)
          .set({ status: "abandoned" })
          .where(eq(pdfTestRunsTable.runId, unrelatedRunId));
      }
    }

    // If setup failed before the simulated interruption, abandon and recover
    // whatever exact IDs were already registered; no prefix-based cleanup.
    for (const runId of [crashedRunId, unrelatedRunId]) {
      await db.update(pdfTestRunsTable)
        .set({ status: "abandoned" })
        .where(eq(pdfTestRunsTable.runId, runId));
    }
    await recoverAbandonedWholesaleRuns();
  }
}

// ── Main tests ────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log("=== Wholesale Regression Test ===\n");

  // Create stock batch for test
  console.log("\n─── Setup: stock purchase 200g @ AED 400/g ───");
  const stockPurchaseId = await createStockPurchase(200, 400);

  // Read initial stock level
  const [initialLevel] = await db.select().from(stockLevelsTable).where(eq(stockLevelsTable.category, CATEGORY));
  const initialStock = Number(initialLevel?.weightGrams ?? "0");
  console.log(`  Initial stock: ${initialStock}g`);
  const reportRange = "startDate=2025-06-01&endDate=2025-06-30";
  const returnRange = "startDate=2025-07-01&endDate=2025-07-31";
  const reportBaseline = await apiJson<{
    stockOutGrams: number;
    totalRevenueAed: number;
    outstandingDueAed: number;
    makingChargesAed: number;
    invoiceCount: number;
  }>(`/dashboard/kpis?${reportRange}`);
  const categoryBaseline = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>(`/dashboard/category-summary?${reportRange}`);
  const categoryParityBaseline = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>("/dashboard/category-summary?startDate=2025-08-01&endDate=2025-08-01");
  const categoryParityReturnBaseline = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>("/dashboard/category-summary?startDate=2025-08-02&endDate=2025-08-02");
  const returnReportBaseline = await apiJson<{
    stockOutGrams: number;
    totalRevenueAed: number;
    outstandingDueAed: number;
    makingChargesAed: number;
    invoiceCount: number;
    cogsAed: number;
  }>(`/dashboard/kpis?${returnRange}`);
  const returnCategoryBaseline = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>(`/dashboard/category-summary?${returnRange}`);
  const fixedDeliveryRange = "startDate=2025-09-01&endDate=2025-09-30";
  const fixedReturnRange = "startDate=2025-10-01&endDate=2025-10-31";
  const fixedDeliveryReportBaseline = await apiJson<{
    stockOutGrams: number; totalRevenueAed: number; makingChargesAed: number;
    invoiceCount: number; cogsAed: number;
  }>(`/dashboard/kpis?${fixedDeliveryRange}`);
  const fixedReturnReportBaseline = await apiJson<{
    stockOutGrams: number; totalRevenueAed: number; makingChargesAed: number;
    invoiceCount: number; cogsAed: number;
  }>(`/dashboard/kpis?${fixedReturnRange}`);
  const fixedDeliveryCategoryBaseline = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>(`/dashboard/category-summary?${fixedDeliveryRange}`);
  const fixedReturnCategoryBaseline = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>(`/dashboard/category-summary?${fixedReturnRange}`);
  const summaryBaseline = await apiJson<{
    totalSalesCreditAed: number;
    categoryBreakdown: Array<{ category: string; soldGrams: number }>;
  }>("/dashboard/summary-cards");

  // ── Create trader ──────────────────────────────────────────────────────────
  console.log("\n─── Test: Create trader ───");
  const trader = await apiJson<{ id: number; name: string }>("/wholesale/traders", {
    method: "POST",
    body: JSON.stringify({ name: "TEST-WS-TRADER", phone: "+971501234567", isActive: true }),
  });
  toClean.traderIds.push(trader.id);
  assert(trader.id > 0, "Trader created with id");
  assertEq(trader.name, "TEST-WS-TRADER", "Trader name set");

  // ── Test 1: Fixed invoice ─────────────────────────────────────────────────
  console.log("\n─── Test 1: Fixed invoice creation ───");
  const ikey1 = `test-fixed-${Date.now()}`;
  const fixedInvoice = await apiJson<{
    id: number; invoiceNumber: string; status: string; totalAed: number; openPureGrams: number; settledAed: number; items: { id: number }[];
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-06-01",
      pricingType: "fixed",
      idempotencyKey: ikey1,
      items: [{
        description: "Gold Bars Fixed",
        category: CATEGORY,
        quantity: 1,
        grossGrams: 50,
        purityMultiplier: 0.9999,
        makingAed: 500,
        rateAedPerGram: 420,
      }],
    }),
  });
  toClean.invoiceIds.push(fixedInvoice.id);

  assertEq(fixedInvoice.status, "settled", "Fixed invoice immediately settled");
  assertClose(fixedInvoice.openPureGrams, 0, "Fixed invoice has 0 open pure grams");
  // totalAed = pureGrams * rate + making = 50*0.9999*420 + 500 = 21497.9
  assertClose(fixedInvoice.totalAed, 21497.9, "Fixed invoice totalAed correct", 1);
  assertClose(fixedInvoice.settledAed, fixedInvoice.totalAed, "Fixed invoice fully settled");

  // Verify stock deduction
  const [postFixed] = await db.select().from(stockLevelsTable).where(eq(stockLevelsTable.category, CATEGORY));
  assertClose(Number(postFixed?.weightGrams ?? "0"), initialStock - 50, "Stock deducted by 50g for fixed invoice");

  // Verify AED ledger entries for fixed invoice
  const fixedLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, fixedInvoice.id));
  const fixedSaleEntries = fixedLedger.filter((e) => e.eventType === "fixed_sale");
  assert(fixedSaleEntries.length >= 1, "Fixed invoice has fixed_sale ledger entries");
  assertClose(
    fixedSaleEntries.reduce((s, e) => s + Number(e.aedDelta), 0),
    fixedInvoice.totalAed,
    "Ledger AED sum equals totalAed for fixed",
    1,
  );

  // Verify FIFO consumption
  const fixedConsumptions = await db.select().from(wholesaleInventoryConsumptionsTable)
    .where(eq(wholesaleInventoryConsumptionsTable.wholesaleInvoiceId, fixedInvoice.id));
  assert(fixedConsumptions.length > 0, "FIFO consumption rows created for fixed invoice");
  assertClose(
    fixedConsumptions.reduce((s, c) => s + Number(c.consumedGrams), 0),
    50,
    "Total consumed grams = 50g",
    0.001,
  );

  // Verify audit log
  const fixedAudit = await db.select().from(auditLogTable)
    .where(sql`entity_type = 'wholesale_invoice' AND entity_id = ${fixedInvoice.id} AND action = 'create'`);
  assert(fixedAudit.length === 1, "Audit log entry created for fixed invoice");

  // Test idempotency: rerun with same key → same result
  console.log("\n─── Test: Idempotency rerun (fixed invoice) ───");
  const fixedInvoice2 = await apiJson<{ id: number; invoiceNumber: string }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-06-01",
      pricingType: "fixed",
      idempotencyKey: ikey1,
      items: [{
        description: "Gold Bars Fixed",
        category: CATEGORY,
        quantity: 1,
        grossGrams: 50,
        purityMultiplier: 0.9999,
        makingAed: 500,
        rateAedPerGram: 420,
      }],
    }),
  });
  assertEq(fixedInvoice2.id, fixedInvoice.id, "Idempotent retry returns same invoice id");
  assertEq(fixedInvoice2.invoiceNumber, fixedInvoice.invoiceNumber, "Idempotent retry returns same invoice number");

  // ── Test 2: Unfixed invoice ───────────────────────────────────────────────
  console.log("\n─── Test 2: Unfixed invoice creation ───");
  const ikey2 = `test-unfixed-${Date.now()}`;
  const unfixedInvoice = await apiJson<{
    id: number; invoiceNumber: string; status: string; totalAed: number; openPureGrams: number; settledAed: number;
    totalPureGrams: number; totalGrossGrams: number; items: { id: number; pureGrams: number }[];
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-06-02",
      pricingType: "unfixed",
      idempotencyKey: ikey2,
      items: [{
        description: "Unfixed Gold Bars",
        category: CATEGORY,
        quantity: 2,
        grossGrams: 100,
        purityMultiplier: 0.9999,
        makingAed: 1000,
      }],
    }),
  });
  toClean.invoiceIds.push(unfixedInvoice.id);

  assertEq(unfixedInvoice.status, "open", "Unfixed invoice starts as open");
  assertClose(unfixedInvoice.openPureGrams, 99.99, "Open pure grams = 100 * 0.9999", 0.001);
  assertClose(unfixedInvoice.settledAed, 1000, "Unfixed invoice immediately posts making AED");
  assertClose(unfixedInvoice.totalAed, 1000, "Unfixed invoice totalAed = making only");

  // Verify pure-gram ledger entries
  const unfixedLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, unfixedInvoice.id));
  const deliveryEntries = unfixedLedger.filter((e) => e.eventType === "delivery" && Number(e.pureGoldGramsDelta) > 0);
  assert(deliveryEntries.length >= 1, "Delivery ledger entries created for unfixed invoice");
  assertClose(
    deliveryEntries.reduce((s, e) => s + Number(e.pureGoldGramsDelta), 0),
    unfixedInvoice.openPureGrams,
    "Ledger pure gram sum equals openPureGrams",
    0.001,
  );
  assertClose(
    deliveryEntries.reduce((s, e) => s + Number(e.aedDelta), 0),
    unfixedInvoice.totalAed,
    "Unfixed delivery ledger immediately posts making charge",
    0.01,
  );

  const preSubscaleFix = await apiJson<{ openPureGrams: number; totalAed: number; settledAed: number }>(
    `/wholesale/invoices/${unfixedInvoice.id}`,
  );
  const preSubscaleFixLedgerCount = unfixedLedger.length;
  const subscaleFixRes = await apiReq(`/wholesale/invoices/${unfixedInvoice.id}/fix-rate`, {
    method: "POST",
    body: JSON.stringify({
      pureWeightGrams: 0.00004,
      rateAedPerGram: 430,
      date: "2025-06-09",
      idempotencyKey: `test-subscale-fix-${Date.now()}`,
    }),
  });
  assertEq(subscaleFixRes.status, 400, "Sub-scale rate fix is rejected");
  const postSubscaleFix = await apiJson<{ openPureGrams: number; totalAed: number; settledAed: number }>(
    `/wholesale/invoices/${unfixedInvoice.id}`,
  );
  const postSubscaleFixLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, unfixedInvoice.id));
  assertClose(postSubscaleFix.openPureGrams, preSubscaleFix.openPureGrams, "Rejected sub-scale fix leaves metal unchanged", 1e-9);
  assertClose(postSubscaleFix.totalAed, preSubscaleFix.totalAed, "Rejected sub-scale fix leaves invoice AED unchanged", 1e-9);
  assertClose(postSubscaleFix.settledAed, preSubscaleFix.settledAed, "Rejected sub-scale fix leaves posted AED unchanged", 1e-9);
  assertEq(postSubscaleFixLedger.length, preSubscaleFixLedgerCount, "Rejected sub-scale fix creates no ledger entry");

  // ── Test 3: Partial rate fix ──────────────────────────────────────────────
  console.log("\n─── Test 3: Partial rate fix ───");
  const fixKey3 = `test-fix-partial-${Date.now()}`;
  const partialFixGrams = 50; // fix only half
  const fixRate = 430;
  const fixedResult = await apiJson<{
    id: number; status: string; openPureGrams: number; settledAed: number; totalAed: number;
  }>(`/wholesale/invoices/${unfixedInvoice.id}/fix-rate`, {
    method: "POST",
    body: JSON.stringify({
      pureWeightGrams: partialFixGrams,
      rateAedPerGram: fixRate,
      date: "2025-06-10",
      note: "Partial fix test",
      idempotencyKey: fixKey3,
    }),
  });

  assertEq(fixedResult.status, "partially_settled", "Invoice is partially_settled after partial fix");
  assertClose(fixedResult.openPureGrams, 99.99 - partialFixGrams, "Open pure grams reduced by fixed amount", 0.001);
  const expectedPartialAed = unfixedInvoice.totalAed + partialFixGrams * fixRate;
  assertClose(fixedResult.settledAed, expectedPartialAed, "Settled AED includes making plus fixed metal", 1);
  assertClose(fixedResult.totalAed, expectedPartialAed, "Invoice total grows by partial rate-fix value", 1);

  // Verify settlement record
  const settlements = await db.select().from(wholesaleSettlementsTable)
    .where(eq(wholesaleSettlementsTable.invoiceId, unfixedInvoice.id));
  assert(settlements.length === 1, "One settlement record created");
  assertClose(Number(settlements[0]!.aedAmount), partialFixGrams * fixRate, "Settlement AED amount", 1);

  // Verify ledger rate_fix entry
  const rateFix = (await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, unfixedInvoice.id)))
    .filter((e) => e.eventType === "rate_fix");
  assert(rateFix.length === 1, "Rate fix ledger entry created");
  assertClose(Number(rateFix[0]!.aedDelta), partialFixGrams * fixRate, "Rate fix AED delta", 1);
  assertClose(Number(rateFix[0]!.pureGoldGramsDelta), -partialFixGrams, "Rate fix pure grams delta is negative", 0.001);

  // Idempotency: same key → same result
  console.log("\n─── Test: Idempotency rerun (rate fix) ───");
  const fixedResult2 = await apiJson<{ id: number; openPureGrams: number }>(`/wholesale/invoices/${unfixedInvoice.id}/fix-rate`, {
    method: "POST",
    body: JSON.stringify({
      pureWeightGrams: partialFixGrams,
      rateAedPerGram: fixRate,
      date: "2025-06-10",
      note: "Partial fix test",
      idempotencyKey: fixKey3,
    }),
  });
  assertClose(fixedResult2.openPureGrams, fixedResult.openPureGrams, "Idempotent rate fix returns same openPureGrams", 0.001);

  // Test over-fix rejection
  console.log("\n─── Test: Over-fix rejection (409) ───");
  const overFixRes = await apiReq(`/wholesale/invoices/${unfixedInvoice.id}/fix-rate`, {
    method: "POST",
    body: JSON.stringify({
      pureWeightGrams: 999, // way more than open
      rateAedPerGram: fixRate,
      date: "2025-06-11",
    }),
  });
  assertEq(overFixRes.status, 409, "Over-fix returns 409");

  // ── Test 4: Full rate fix → settled ──────────────────────────────────────
  console.log("\n─── Test 4: Full rate fix → settled ───");
  const remainingOpen = Number((await apiJson<{ openPureGrams: number }>(`/wholesale/invoices/${unfixedInvoice.id}`)).openPureGrams);
  const finalFixed = await apiJson<{ status: string; openPureGrams: number; settledAed: number; totalAed: number }>(
    `/wholesale/invoices/${unfixedInvoice.id}/fix-rate`,
    {
      method: "POST",
      body: JSON.stringify({
        pureWeightGrams: remainingOpen,
        rateAedPerGram: fixRate,
        date: "2025-06-12",
        note: "Full fix",
      }),
    },
  );
  assertEq(finalFixed.status, "settled", "Invoice settled after full rate fix");
  assertClose(finalFixed.openPureGrams, 0, "Open pure grams = 0 after full fix", 0.001);
  const expectedFinalUnfixedAed = 1000 + 99.99 * fixRate;
  assertClose(finalFixed.totalAed, expectedFinalUnfixedAed, "Fully fixed invoice total includes making and all metal", 1);
  assertClose(finalFixed.settledAed, finalFixed.totalAed, "Fully fixed invoice settled AED reconciles to total", 0.01);
  const finalUnfixedLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, unfixedInvoice.id));
  assertClose(
    finalUnfixedLedger.reduce((sum, entry) => sum + Number(entry.aedDelta), 0),
    finalFixed.totalAed,
    "Fully fixed invoice ledger AED reconciles to invoice total",
    0.01,
  );

  // ── Test 5: Partial physical return ──────────────────────────────────────
  console.log("\n─── Test 5: Partial physical return ───");

  // Create another unfixed invoice for return testing (need unfixed portion to return)
  const returnTestInvoice = await apiJson<{
    id: number; invoiceNumber: string; status: string; openPureGrams: number;
    items: { id: number; grossGrams: number; pureGrams: number }[];
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-06-03",
      pricingType: "unfixed",
      items: [{
        description: "Returnable Gold",
        category: CATEGORY,
        quantity: 1,
        grossGrams: 30,
        purityMultiplier: 0.9999,
        makingAed: 300,
      }],
    }),
  });
  toClean.invoiceIds.push(returnTestInvoice.id);

  const returnItemId = returnTestInvoice.items[0]!.id;
  const returnGross = 10; // return 10g of 30g

  const preReturnStock = Number(
    (await db.select().from(stockLevelsTable).where(eq(stockLevelsTable.category, CATEGORY)))[0]?.weightGrams ?? "0",
  );
  const preSubscaleReturnInvoice = await apiJson<{
    openPureGrams: number;
    totalAed: number;
    settledAed: number;
  }>(`/wholesale/invoices/${returnTestInvoice.id}`);
  const subscaleReturnRes = await apiReq(`/wholesale/invoices/${returnTestInvoice.id}/return`, {
    method: "POST",
    body: JSON.stringify({
      date: "2025-06-14",
      idempotencyKey: `test-subscale-return-${Date.now()}`,
      lines: [{ invoiceItemId: returnItemId, grossWeightGrams: 0.00004 }],
    }),
  });
  assertEq(subscaleReturnRes.status, 400, "Sub-scale physical return is rejected");
  const postSubscaleReturnInvoice = await apiJson<{
    openPureGrams: number;
    totalAed: number;
    settledAed: number;
  }>(`/wholesale/invoices/${returnTestInvoice.id}`);
  const postSubscaleReturnStock = Number(
    (await db.select().from(stockLevelsTable).where(eq(stockLevelsTable.category, CATEGORY)))[0]?.weightGrams ?? "0",
  );
  assertClose(postSubscaleReturnStock, preReturnStock, "Rejected sub-scale return leaves stock unchanged", 1e-9);
  assertClose(
    postSubscaleReturnInvoice.openPureGrams,
    preSubscaleReturnInvoice.openPureGrams,
    "Rejected sub-scale return leaves metal obligation unchanged",
    1e-9,
  );
  assertClose(
    postSubscaleReturnInvoice.totalAed,
    preSubscaleReturnInvoice.totalAed,
    "Rejected sub-scale return leaves invoice AED unchanged",
    1e-9,
  );
  assertClose(
    postSubscaleReturnInvoice.settledAed,
    preSubscaleReturnInvoice.settledAed,
    "Rejected sub-scale return leaves posted AED unchanged",
    1e-9,
  );

  const returnKey = `test-return-${Date.now()}`;
  const returnResult = await apiJson<{
    id: number; returnNumber: string; totalReturnedGrossGrams: number; totalReturnedPureGrams: number; totalReturnedMakingAed: number;
    lines: { grossWeightGrams: number }[];
  }>(`/wholesale/invoices/${returnTestInvoice.id}/return`, {
    method: "POST",
    body: JSON.stringify({
      date: "2025-07-15",
      note: "Test return",
      idempotencyKey: returnKey,
      lines: [{ invoiceItemId: returnItemId, grossWeightGrams: returnGross }],
    }),
  });
  toClean.returnIds.push(returnResult.id);

  assert(returnResult.returnNumber.startsWith("WSR-"), "Return has WSR- number prefix");
  assertClose(returnResult.totalReturnedGrossGrams, returnGross, "Return total gross matches", 0.001);
  assertClose(returnResult.totalReturnedPureGrams, returnGross * 0.9999, "Return total pure = gross * purity", 0.001);
  assertClose(returnResult.totalReturnedMakingAed, 100, "Partial return reverses pro-rata making AED", 0.01);

  // Verify stock restored
  const postReturnStock = Number(
    (await db.select().from(stockLevelsTable).where(eq(stockLevelsTable.category, CATEGORY)))[0]?.weightGrams ?? "0",
  );
  assertClose(postReturnStock, preReturnStock + returnGross, "Stock restored by returned grams", 0.001);

  // Verify invoice updated
  const returnTestInvoiceUpdated = await apiJson<{
    openPureGrams: number;
    totalGrossGrams: number;
    totalPureGrams: number;
    totalMakingAed: number;
    totalAed: number;
    settledAed: number;
    status: string;
  }>(
    `/wholesale/invoices/${returnTestInvoice.id}`,
  );
  assertClose(
    returnTestInvoiceUpdated.totalGrossGrams,
    30 - returnGross,
    "Invoice totalGrossGrams reduced by return",
    0.001,
  );
  assertClose(
    returnTestInvoiceUpdated.openPureGrams,
    returnTestInvoice.openPureGrams - returnResult.totalReturnedPureGrams,
    "Physical return reduces open pure obligation",
    0.001,
  );
  assertClose(
    returnTestInvoiceUpdated.openPureGrams,
    returnTestInvoiceUpdated.totalPureGrams,
    "Fully unfixed remainder stays open after partial return",
    0.001,
  );
  assertEq(returnTestInvoiceUpdated.status, "open", "Partially returned unfixed invoice remains open");
  assertClose(returnTestInvoiceUpdated.totalMakingAed, 200, "Invoice making total decreases after return", 0.01);
  assertClose(returnTestInvoiceUpdated.totalAed, 200, "Invoice AED total decreases after return", 0.01);
  assertClose(returnTestInvoiceUpdated.settledAed, 200, "Posted AED decreases after return", 0.01);

  // Verify return ledger entry
  const returnLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleReturnId, returnResult.id));
  assert(returnLedger.length >= 1, "Ledger entry for physical return");
  assertClose(
    Number(returnLedger[0]!.pureGoldGramsDelta),
    -(returnGross * 0.9999),
    "Return ledger pure grams delta is negative",
    0.001,
  );
  assertClose(Number(returnLedger[0]!.aedDelta), -100, "Return ledger reverses making AED", 0.01);

  // Idempotency: same return key → same result
  console.log("\n─── Test: Idempotency rerun (return) ───");
  const returnResult2 = await apiJson<{ id: number; returnNumber: string }>(
    `/wholesale/invoices/${returnTestInvoice.id}/return`,
    {
      method: "POST",
      body: JSON.stringify({
        date: "2025-07-15",
        note: "Test return",
        idempotencyKey: returnKey,
        lines: [{ invoiceItemId: returnItemId, grossWeightGrams: returnGross }],
      }),
    },
  );
  assertEq(returnResult2.id, returnResult.id, "Idempotent return gives same id");
  assertEq(returnResult2.returnNumber, returnResult.returnNumber, "Idempotent return gives same number");

  // Test over-return rejection
  console.log("\n─── Test: Over-return rejection (409) ───");
  const overReturnRes = await apiReq(`/wholesale/invoices/${returnTestInvoice.id}/return`, {
    method: "POST",
    body: JSON.stringify({
      date: "2025-06-16",
      lines: [{ invoiceItemId: returnItemId, grossWeightGrams: 999 }],
    }),
  });
  assertEq(overReturnRes.status, 409, "Over-return returns 409");

  // Duplicate item lines must not bypass the per-item maximum.
  console.log("\n─── Test: Duplicate return-line rejection ───");
  const preDuplicateStock = Number(
    (await db.select().from(stockLevelsTable).where(eq(stockLevelsTable.category, CATEGORY)))[0]?.weightGrams ?? "0",
  );
  const duplicateReturnRes = await apiReq(`/wholesale/invoices/${returnTestInvoice.id}/return`, {
    method: "POST",
    body: JSON.stringify({
      date: "2025-06-16",
      lines: [
        { invoiceItemId: returnItemId, grossWeightGrams: 11 },
        { invoiceItemId: returnItemId, grossWeightGrams: 11 },
      ],
    }),
  });
  assertEq(duplicateReturnRes.status, 400, "Duplicate return lines return 400");
  const postDuplicateStock = Number(
    (await db.select().from(stockLevelsTable).where(eq(stockLevelsTable.category, CATEGORY)))[0]?.weightGrams ?? "0",
  );
  assertClose(postDuplicateStock, preDuplicateStock, "Rejected duplicate lines do not change stock", 0.001);

  // Return the remaining unfixed goods and confirm the obligation closes.
  const fullReturn = await apiJson<{ id: number; returnNumber: string }>(
    `/wholesale/invoices/${returnTestInvoice.id}/return`,
    {
      method: "POST",
      body: JSON.stringify({
        date: "2025-07-17",
        idempotencyKey: `test-full-return-${Date.now()}`,
        lines: [{ invoiceItemId: returnItemId, grossWeightGrams: 20 }],
      }),
    },
  );
  toClean.returnIds.push(fullReturn.id);
  const fullyReturnedInvoice = await apiJson<{
    openPureGrams: number;
    totalGrossGrams: number;
    totalPureGrams: number;
    totalMakingAed: number;
    totalAed: number;
    settledAed: number;
    status: string;
  }>(`/wholesale/invoices/${returnTestInvoice.id}`);
  assertClose(fullyReturnedInvoice.openPureGrams, 0, "Full return closes open pure obligation", 0.001);
  assertClose(fullyReturnedInvoice.totalGrossGrams, 0, "Full return reduces gross delivery to zero", 0.001);
  assertClose(fullyReturnedInvoice.totalPureGrams, 0, "Full return reduces pure delivery to zero", 0.001);
  assertClose(fullyReturnedInvoice.totalMakingAed, 0, "Full return reverses all making AED", 0.01);
  assertClose(fullyReturnedInvoice.totalAed, 0, "Fully returned invoice has zero AED total", 0.01);
  assertClose(fullyReturnedInvoice.settledAed, 0, "Fully returned invoice has zero posted AED", 0.01);
  assertEq(fullyReturnedInvoice.status, "settled", "Fully returned invoice is settled");
  const fullyReturnedLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, returnTestInvoice.id));
  assertClose(
    fullyReturnedLedger.reduce((sum, entry) => sum + Number(entry.aedDelta), 0),
    0,
    "Full-return ledger AED reconciles to zero",
    0.01,
  );

  // Partial fix followed by a physical return must reduce, never increase, open grams.
  console.log("\n─── Test: Partial fix followed by physical return ───");
  const mixedInvoice = await apiJson<{
    id: number;
    openPureGrams: number;
    items: { id: number }[];
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-06-04",
      pricingType: "unfixed",
      items: [{
        description: "Mixed Settlement Gold",
        category: CATEGORY,
        quantity: 1,
        grossGrams: 20,
        purityMultiplier: 0.9999,
        makingAed: 200,
      }],
    }),
  });
  toClean.invoiceIds.push(mixedInvoice.id);
  const mixedAfterFix = await apiJson<{ openPureGrams: number; totalAed: number; settledAed: number }>(
    `/wholesale/invoices/${mixedInvoice.id}/fix-rate`,
    {
      method: "POST",
      body: JSON.stringify({
        pureWeightGrams: 5,
        rateAedPerGram: 420,
        date: "2025-06-18",
        idempotencyKey: `test-mixed-fix-${Date.now()}`,
      }),
    },
  );
  const mixedReturn = await apiJson<{
    id: number;
    totalReturnedPureGrams: number;
    totalReturnedMakingAed: number;
  }>(
    `/wholesale/invoices/${mixedInvoice.id}/return`,
    {
      method: "POST",
      body: JSON.stringify({
        date: "2025-06-19",
        idempotencyKey: `test-mixed-return-${Date.now()}`,
        lines: [{ invoiceItemId: mixedInvoice.items[0]!.id, grossWeightGrams: 5 }],
      }),
    },
  );
  toClean.returnIds.push(mixedReturn.id);
  const mixedUpdated = await apiJson<{
    openPureGrams: number;
    totalPureGrams: number;
    totalMakingAed: number;
    totalAed: number;
    settledAed: number;
    status: string;
  }>(`/wholesale/invoices/${mixedInvoice.id}`);
  assertClose(
    mixedUpdated.openPureGrams,
    mixedAfterFix.openPureGrams - mixedReturn.totalReturnedPureGrams,
    "Return after partial fix reduces open grams exactly once",
    0.001,
  );
  assertEq(mixedUpdated.status, "partially_settled", "Mixed fixed/returned invoice remains partially settled");
  assertClose(mixedReturn.totalReturnedMakingAed, 50, "Mixed return reverses pro-rata making AED", 0.01);
  assertClose(mixedAfterFix.totalAed, 2300, "Mixed invoice total includes making and fixed metal", 0.01);
  assertClose(mixedUpdated.totalMakingAed, 150, "Mixed invoice retains making for remaining goods", 0.01);
  assertClose(mixedUpdated.totalAed, 2250, "Mixed invoice total reverses returned making", 0.01);
  assertClose(mixedUpdated.settledAed, mixedUpdated.totalAed, "Mixed invoice posted AED reconciles to total", 0.01);
  const mixedLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, mixedInvoice.id));
  assertClose(
    mixedLedger.reduce((sum, entry) => sum + Number(entry.aedDelta), 0),
    mixedUpdated.totalAed,
    "Mixed invoice ledger AED reconciles after fix and return",
    0.01,
  );

  // Deliberate oversells use explicit shortfall FIFO slices. Returning them
  // cancels the negative stock deficit without fabricating a purchase batch.
  console.log("\n─── Test: Unbacked oversell return reconciliation ───");
  const shortfallCategory = `test_wholesale_shortfall_${Date.now()}`;
  toClean.categories.push(shortfallCategory);
  const shortfallCreated = await createWholesaleInvoice({
    traderId: trader.id,
    traderSnapshot: { name: trader.name, phone: "+971501234567" },
    invoiceDate: "2025-06-05",
    pricingType: "unfixed",
    idempotencyKey: `test-shortfall-invoice-${Date.now()}`,
    fixtureRunId: suiteRunId,
    items: [{
      description: "Shortfall Return Test",
      category: shortfallCategory,
      quantity: 1,
      grossGrams: 5,
      purityMultiplier: 1,
      makingAed: 0,
    }],
  });
  if (!shortfallCreated.invoice) throw new Error("Shortfall invoice was not created");
  const shortfallInvoiceId = shortfallCreated.invoice.invoice.id;
  const shortfallItemId = shortfallCreated.invoice.items[0]!.id;
  toClean.invoiceIds.push(shortfallInvoiceId);
  const [shortfallSliceBefore] = await db.select()
    .from(wholesaleInventoryConsumptionsTable)
    .where(eq(wholesaleInventoryConsumptionsTable.wholesaleItemId, shortfallItemId));
  assert(shortfallSliceBefore?.isShortfall === true, "Oversold delivery records an explicit FIFO shortfall");
  const shortfallReturn = await applyPhysicalReturn({
    invoiceId: shortfallInvoiceId,
    date: "2025-06-20",
    idempotencyKey: `test-shortfall-return-${Date.now()}`,
    fixtureRunId: suiteRunId,
    lines: [{ invoiceItemId: shortfallItemId, grossWeightGrams: 5 }],
  });
  if (!shortfallReturn.result) throw new Error("Shortfall return was not created");
  toClean.returnIds.push(shortfallReturn.result.ret.id);
  const [shortfallSliceAfter] = await db.select()
    .from(wholesaleInventoryConsumptionsTable)
    .where(eq(wholesaleInventoryConsumptionsTable.wholesaleItemId, shortfallItemId));
  const [shortfallLevel] = await db.select()
    .from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, shortfallCategory));
  assertClose(Number(shortfallSliceAfter?.returnedGrams ?? "0"), 5, "Returned shortfall grams are reconciled on the FIFO slice", 0.001);
  assertClose(Number(shortfallLevel?.weightGrams ?? "0"), 0, "Full shortfall return restores the stock deficit to zero", 0.001);
  const shortfallPurchaseCount = await db.select()
    .from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.category, shortfallCategory));
  assertEq(shortfallPurchaseCount.length, 0, "Shortfall return does not fabricate a supplier purchase");

  // ── Test 6: Ledger reconciliation ─────────────────────────────────────────
  console.log("\n─── Test 6: Ledger / stock reconciliation ───");

  // Trader statement
  const statement = await apiJson<{
    balanceAed: number; balancePureGrams: number; entries: { eventType: string }[];
  }>(`/wholesale/ledger?traderId=${trader.id}`);
  assert(statement.entries.length > 0, "Trader statement has entries");
  assert(typeof statement.balanceAed === "number", "Statement has balanceAed");
  assert(typeof statement.balancePureGrams === "number", "Statement has balancePureGrams");
  const returnPeriodStatement = await apiJson<{
    balanceAed: number;
    balancePureGrams: number;
    entries: Array<{ eventType: string; eventDate: string }>;
  }>(`/wholesale/ledger?traderId=${trader.id}&startDate=2025-07-01&endDate=2025-07-31`);
  assertClose(returnPeriodStatement.balanceAed, -300, "Trader statement attributes making reversals to return dates", 0.01);
  assertClose(returnPeriodStatement.balancePureGrams, -29.997, "Trader statement attributes returned pure grams to return dates", 0.001);
  assert(returnPeriodStatement.entries.every((entry) => entry.eventDate.startsWith("2025-07-")), "Trader statement exposes business event dates");

  // Stock movements should include wholesale delivery entries
  const wsMovements = await db.select().from(stockMovementsTable)
    .where(sql`ref_type = 'wholesale_invoice'`);
  const ourMovements = wsMovements.filter((m) =>
    toClean.invoiceIds.includes(m.refId ?? -1),
  );
  assert(ourMovements.length >= 3, "Stock movements recorded for each wholesale invoice");

  // Dashboard
  const dashboard = await apiJson<{
    invoiceCount: number; openPureGrams: number; returnedGrossGrams: number;
  }>("/wholesale/dashboard");
  assert(dashboard.invoiceCount >= 3, "Dashboard shows invoice count");
  assert(typeof dashboard.openPureGrams === "number", "Dashboard has openPureGrams");
  const filteredDashboard = await apiJson<{
    invoiceCount: number;
    returnedGrossGrams: number;
    totalFixedAed: number;
  }>("/wholesale/dashboard?startDate=2025-06-01&endDate=2025-06-30");
  assert(typeof filteredDashboard.invoiceCount === "number", "Date-filtered dashboard query succeeds");
  assert(typeof filteredDashboard.returnedGrossGrams === "number", "Date-filtered returned grams query succeeds");
  const returnPeriodDashboard = await apiJson<{
    invoiceCount: number;
    returnedGrossGrams: number;
    totalFixedAed: number;
  }>("/wholesale/dashboard?startDate=2025-07-01&endDate=2025-07-31");
  assertClose(returnPeriodDashboard.returnedGrossGrams, 30, "Wholesale dashboard attributes returns to return date", 0.001);
  assertClose(returnPeriodDashboard.totalFixedAed, -300, "Wholesale dashboard attributes making reversal to return date", 0.01);

  // Existing dashboard/report surfaces must include wholesale net values, not
  // only the dedicated wholesale dashboard.
  const reportAfter = await apiJson<{
    stockOutGrams: number;
    totalRevenueAed: number;
    outstandingDueAed: number;
    makingChargesAed: number;
    invoiceCount: number;
  }>(`/dashboard/kpis?${reportRange}`);
  const expectedJuneWholesaleRevenue = fixedInvoice.totalAed + finalFixed.totalAed + 300 + mixedUpdated.totalAed;
  const expectedNetWholesaleRevenue = fixedInvoice.totalAed + finalFixed.totalAed + mixedUpdated.totalAed;
  assertClose(
    reportAfter.totalRevenueAed - reportBaseline.totalRevenueAed,
    expectedJuneWholesaleRevenue,
    "Main KPI revenue includes wholesale events dated in the period",
    0.1,
  );
  assertClose(
    reportAfter.outstandingDueAed - reportBaseline.outstandingDueAed,
    expectedJuneWholesaleRevenue,
    "Main KPI outstanding due includes dated trader AED receivable events",
    0.1,
  );
  assertClose(
    reportAfter.stockOutGrams - reportBaseline.stockOutGrams,
    195,
    "Main KPI stock out does not pull later returns into the invoice period",
    0.001,
  );
  assertClose(
    reportAfter.makingChargesAed - reportBaseline.makingChargesAed,
    1950,
    "Main KPI making revenue does not pull later reversals into the invoice period",
    0.01,
  );
  assertEq(
    reportAfter.invoiceCount - reportBaseline.invoiceCount,
    5,
    "Main KPI invoice count includes wholesale invoices",
  );

  const categoryAfter = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>(`/dashboard/category-summary?${reportRange}`);
  const baselineGold = categoryBaseline.rows.find((row) => row.category === CATEGORY)!;
  const afterGold = categoryAfter.rows.find((row) => row.category === CATEGORY)!;
  assertClose(afterGold.amount - baselineGold.amount, expectedJuneWholesaleRevenue, "Category report includes dated wholesale AED events", 0.1);
  assertClose(afterGold.grossGrams - baselineGold.grossGrams, 195, "Category report keeps later returns out of invoice period grams", 0.001);
  assertEq(afterGold.invoiceCount - baselineGold.invoiceCount, 4, "Category report counts wholesale gold invoices");

  const returnReportAfter = await apiJson<{
    stockOutGrams: number;
    totalRevenueAed: number;
    outstandingDueAed: number;
    makingChargesAed: number;
    invoiceCount: number;
    cogsAed: number;
  }>(`/dashboard/kpis?${returnRange}`);
  const datedReturns = await db.select().from(wholesaleReturnsTable)
    .where(eq(wholesaleReturnsTable.invoiceId, returnTestInvoice.id));
  const returnedCogsAed = datedReturns.reduce((sum, ret) => sum + Number(ret.totalReturnedCogsAed), 0);
  assertClose(returnReportAfter.totalRevenueAed - returnReportBaseline.totalRevenueAed, -300, "Return-period KPI reverses making AED", 0.01);
  assertClose(returnReportAfter.outstandingDueAed - returnReportBaseline.outstandingDueAed, -300, "Return-period KPI reduces trader receivable", 0.01);
  assertClose(returnReportAfter.stockOutGrams - returnReportBaseline.stockOutGrams, -30, "Return-period KPI reports negative stock out", 0.001);
  assertClose(returnReportAfter.makingChargesAed - returnReportBaseline.makingChargesAed, -300, "Return-period KPI reverses making revenue", 0.01);
  assertClose(returnReportAfter.cogsAed - returnReportBaseline.cogsAed, -returnedCogsAed, "Return-period KPI reverses exact FIFO COGS", 0.01);
  assertEq(returnReportAfter.invoiceCount - returnReportBaseline.invoiceCount, 0, "Return period does not count the earlier invoice again");

  const returnCategoryAfter = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>(`/dashboard/category-summary?${returnRange}`);
  const returnBaselineGold = returnCategoryBaseline.rows.find((row) => row.category === CATEGORY)!;
  const returnAfterGold = returnCategoryAfter.rows.find((row) => row.category === CATEGORY)!;
  assertClose(returnAfterGold.amount - returnBaselineGold.amount, -300, "Return-period category report reverses making AED", 0.01);
  assertClose(returnAfterGold.grossGrams - returnBaselineGold.grossGrams, -30, "Return-period category report records returned grams", 0.001);
  assertEq(returnAfterGold.invoiceCount - returnBaselineGold.invoiceCount, 1, "Return-period category report identifies the affected invoice");

  console.log("\n─── Test: Wholesale category reporting parity ───");
  const categoryParityInvoice = await apiJson<{
    id: number;
    items: Array<{ id: number; category: string; grossGrams: number }>;
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-08-01",
      pricingType: "unfixed",
      idempotencyKey: `ws-category-parity-${Date.now()}`,
      items: WHOLESALE_CATEGORIES.map((category, index) => ({
        description: `Category parity ${category}`,
        category,
        quantity: 1,
        grossGrams: 1,
        purityMultiplier: 1,
        makingAed: index + 1,
      })),
    }),
  });
  toClean.invoiceIds.push(categoryParityInvoice.id);

  const categoryParityAfter = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>("/dashboard/category-summary?startDate=2025-08-01&endDate=2025-08-01");
  for (const [index, category] of WHOLESALE_CATEGORIES.entries()) {
    const baseline = categoryParityBaseline.rows.find((row) => row.category === category);
    const after = categoryParityAfter.rows.find((row) => row.category === category);
    assert(after != null, `Category report preserves ${category} bucket`);
    assertClose((after?.amount ?? 0) - (baseline?.amount ?? 0), index + 1, `Category report attributes ${category} AED`, 0.01);
    assertClose((after?.grossGrams ?? 0) - (baseline?.grossGrams ?? 0), 1, `Category report attributes ${category} grams`, 0.001);
    assertEq((after?.invoiceCount ?? 0) - (baseline?.invoiceCount ?? 0), 1, `Category report counts ${category} invoice`);
  }

  const categoryParityReturn = await apiJson<{ id: number }>("/wholesale/invoices/" + categoryParityInvoice.id + "/return", {
    method: "POST",
    body: JSON.stringify({
      date: "2025-08-02",
      idempotencyKey: `ws-category-parity-return-${Date.now()}`,
      lines: categoryParityInvoice.items.map((item) => ({
        invoiceItemId: item.id,
        grossWeightGrams: item.grossGrams,
      })),
    }),
  });
  toClean.returnIds.push(categoryParityReturn.id);

  const categoryParityReturnAfter = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>("/dashboard/category-summary?startDate=2025-08-02&endDate=2025-08-02");
  for (const [index, category] of WHOLESALE_CATEGORIES.entries()) {
    const baseline = categoryParityReturnBaseline.rows.find((row) => row.category === category);
    const after = categoryParityReturnAfter.rows.find((row) => row.category === category);
    assert(after != null, `Return report preserves ${category} bucket`);
    assertClose((after?.amount ?? 0) - (baseline?.amount ?? 0), -(index + 1), `Return report reverses ${category} AED`, 0.01);
    assertClose((after?.grossGrams ?? 0) - (baseline?.grossGrams ?? 0), -1, `Return report attributes ${category} returned grams`, 0.001);
    assertEq((after?.invoiceCount ?? 0) - (baseline?.invoiceCount ?? 0), 1, `Return report counts ${category} invoice`);
  }

  console.log("\n─── Test: Fixed invoice partial and full physical returns ───");
  const [stockBeforeFixedReturn] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, CATEGORY));
  const fixedReturnInvoice = await apiJson<{
    id: number;
    totalAed: number;
    items: Array<{ id: number }>;
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-09-01",
      pricingType: "fixed",
      idempotencyKey: `ws-fixed-return-${Date.now()}`,
      items: [{
        description: "Fixed return coverage",
        category: CATEGORY,
        quantity: 1,
        grossGrams: 20,
        purityMultiplier: 1,
        makingAed: 200,
        rateAedPerGram: 410,
      }],
    }),
  });
  toClean.invoiceIds.push(fixedReturnInvoice.id);
  assertClose(fixedReturnInvoice.totalAed, 8400, "Fixed-return fixture posts making and fixed metal AED", 0.01);
  const fixedReturnConsumptions = await db.select().from(wholesaleInventoryConsumptionsTable)
    .where(eq(wholesaleInventoryConsumptionsTable.wholesaleInvoiceId, fixedReturnInvoice.id));
  const fixedReturnCogs = fixedReturnConsumptions.reduce((sum, row) => sum + Number(row.costAed), 0);

  const partialFixedReturn = await apiJson<{
    id: number;
    totalReturnedPureGrams: number;
    totalReturnedFixedPureGrams: number;
    totalReturnedMakingAed: number;
    totalReturnedMetalAed: number;
    totalReturnedAed: number;
  }>(`/wholesale/invoices/${fixedReturnInvoice.id}/return`, {
    method: "POST",
    body: JSON.stringify({
      date: "2025-10-02",
      idempotencyKey: `ws-fixed-return-partial-${Date.now()}`,
      lines: [{ invoiceItemId: fixedReturnInvoice.items[0]!.id, grossWeightGrams: 5 }],
    }),
  });
  toClean.returnIds.push(partialFixedReturn.id);
  assertClose(partialFixedReturn.totalReturnedPureGrams, 5, "Fixed partial return records physical pure grams", 0.0001);
  assertClose(partialFixedReturn.totalReturnedFixedPureGrams, 5, "Fixed partial return identifies fixed pure grams", 0.0001);
  assertClose(partialFixedReturn.totalReturnedMakingAed, 50, "Fixed partial return reverses pro-rata making", 0.01);
  assertClose(partialFixedReturn.totalReturnedMetalAed, 2050, "Fixed partial return reverses fixed metal AED", 0.01);
  assertClose(partialFixedReturn.totalReturnedAed, 2100, "Fixed partial return reverses total AED", 0.01);

  const fixedAfterPartial = await apiJson<{
    status: string; totalGrossGrams: number; totalPureGrams: number;
    totalMakingAed: number; totalAed: number; settledAed: number; openPureGrams: number;
    items: Array<{ fixedPureGrams: number; returnedFixedPureGrams: number; returnedMetalAed: number }>;
  }>(`/wholesale/invoices/${fixedReturnInvoice.id}`);
  assertEq(fixedAfterPartial.status, "settled", "Partially returned fixed invoice remains settled");
  assertClose(fixedAfterPartial.openPureGrams, 0, "Fixed return does not create or reduce a pure obligation", 0.0001);
  assertClose(fixedAfterPartial.totalGrossGrams, 15, "Fixed partial return reduces invoice gross", 0.0001);
  assertClose(fixedAfterPartial.totalPureGrams, 15, "Fixed partial return reduces invoice pure", 0.0001);
  assertClose(fixedAfterPartial.totalMakingAed, 150, "Fixed partial return reduces invoice making", 0.01);
  assertClose(fixedAfterPartial.totalAed, 6300, "Fixed partial return reduces invoice AED", 0.01);
  assertClose(fixedAfterPartial.settledAed, 6300, "Fixed partial return keeps posted AED reconciled", 0.01);
  assertClose(fixedAfterPartial.items[0]!.fixedPureGrams, 15, "Fixed partial return reduces fixed item grams", 0.0001);
  assertClose(fixedAfterPartial.items[0]!.returnedFixedPureGrams, 5, "Fixed partial return accumulates returned fixed grams", 0.0001);
  assertClose(fixedAfterPartial.items[0]!.returnedMetalAed, 2050, "Fixed partial return accumulates metal AED reversal", 0.01);

  const partialFixedLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleReturnId, partialFixedReturn.id));
  assertClose(partialFixedLedger[0]?.aedDelta ? Number(partialFixedLedger[0].aedDelta) : 0, -2100, "Fixed return ledger reverses AED", 0.01);
  assertClose(partialFixedLedger[0]?.pureGoldGramsDelta ? Number(partialFixedLedger[0].pureGoldGramsDelta) : 0, 0, "Fixed return leaves pure ledger unchanged", 0.0001);

  const fullFixedReturn = await apiJson<{
    id: number;
    totalReturnedMakingAed: number;
    totalReturnedMetalAed: number;
    totalReturnedAed: number;
  }>(`/wholesale/invoices/${fixedReturnInvoice.id}/return`, {
    method: "POST",
    body: JSON.stringify({
      date: "2025-10-03",
      idempotencyKey: `ws-fixed-return-full-${Date.now()}`,
      lines: [{ invoiceItemId: fixedReturnInvoice.items[0]!.id, grossWeightGrams: 15 }],
    }),
  });
  toClean.returnIds.push(fullFixedReturn.id);
  assertClose(fullFixedReturn.totalReturnedMakingAed, 150, "Final fixed return reverses residual making", 0.01);
  assertClose(fullFixedReturn.totalReturnedMetalAed, 6150, "Final fixed return reverses residual metal AED", 0.01);
  assertClose(fullFixedReturn.totalReturnedAed, 6300, "Final fixed return reverses residual total AED", 0.01);

  const fixedAfterFull = await apiJson<{
    status: string; totalGrossGrams: number; totalPureGrams: number;
    totalMakingAed: number; totalAed: number; settledAed: number; openPureGrams: number;
    items: Array<{ fixedPureGrams: number; returnedFixedPureGrams: number; returnedMetalAed: number }>;
  }>(`/wholesale/invoices/${fixedReturnInvoice.id}`);
  assertEq(fixedAfterFull.status, "settled", "Fully returned fixed invoice is settled");
  assertClose(fixedAfterFull.totalGrossGrams, 0, "Full fixed return clears invoice gross", 0.0001);
  assertClose(fixedAfterFull.totalPureGrams, 0, "Full fixed return clears invoice pure", 0.0001);
  assertClose(fixedAfterFull.totalMakingAed, 0, "Full fixed return clears invoice making", 0.01);
  assertClose(fixedAfterFull.totalAed, 0, "Full fixed return clears invoice AED", 0.01);
  assertClose(fixedAfterFull.settledAed, 0, "Full fixed return clears posted AED", 0.01);
  assertClose(fixedAfterFull.openPureGrams, 0, "Full fixed return keeps open pure at zero", 0.0001);
  assertClose(fixedAfterFull.items[0]!.fixedPureGrams, 0, "Full fixed return clears current fixed grams", 0.0001);
  assertClose(fixedAfterFull.items[0]!.returnedFixedPureGrams, 20, "Full fixed return accumulates all fixed grams", 0.0001);
  assertClose(fixedAfterFull.items[0]!.returnedMetalAed, 8200, "Full fixed return accumulates all metal AED", 0.01);

  const fixedReturnLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, fixedReturnInvoice.id));
  assertClose(fixedReturnLedger.reduce((sum, row) => sum + Number(row.aedDelta), 0), 0, "Fixed invoice and return AED ledger reconcile to zero", 0.01);
  assertClose(fixedReturnLedger.reduce((sum, row) => sum + Number(row.pureGoldGramsDelta), 0), 0, "Fixed invoice and return pure ledger remain zero", 0.0001);
  const fixedConsumptionAfterReturns = await db.select().from(wholesaleInventoryConsumptionsTable)
    .where(eq(wholesaleInventoryConsumptionsTable.wholesaleInvoiceId, fixedReturnInvoice.id));
  assertClose(fixedConsumptionAfterReturns.reduce((sum, row) => sum + Number(row.returnedGrams), 0), 20, "Fixed returns restore every FIFO gram", 0.0001);
  assertClose(fixedConsumptionAfterReturns.reduce((sum, row) => sum + Number(row.returnedCogsAed), 0), fixedReturnCogs, "Fixed returns reverse exact FIFO COGS", 0.01);
  const [stockAfterFixedReturn] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, CATEGORY));
  assertClose(Number(stockAfterFixedReturn?.weightGrams ?? "0"), Number(stockBeforeFixedReturn?.weightGrams ?? "0"), "Full fixed return restores stock level", 0.0001);

  const fixedDeliveryReportAfter = await apiJson<{
    stockOutGrams: number; totalRevenueAed: number; makingChargesAed: number;
    invoiceCount: number; cogsAed: number;
  }>(`/dashboard/kpis?${fixedDeliveryRange}`);
  const fixedReturnReportAfter = await apiJson<{
    stockOutGrams: number; totalRevenueAed: number; makingChargesAed: number;
    invoiceCount: number; cogsAed: number;
  }>(`/dashboard/kpis?${fixedReturnRange}`);
  assertClose(fixedDeliveryReportAfter.totalRevenueAed - fixedDeliveryReportBaseline.totalRevenueAed, 8400, "Fixed delivery period reports full AED", 0.01);
  assertClose(fixedDeliveryReportAfter.stockOutGrams - fixedDeliveryReportBaseline.stockOutGrams, 20, "Fixed delivery period reports stock out", 0.0001);
  assertClose(fixedDeliveryReportAfter.makingChargesAed - fixedDeliveryReportBaseline.makingChargesAed, 200, "Fixed delivery period reports making", 0.01);
  assertClose(fixedDeliveryReportAfter.cogsAed - fixedDeliveryReportBaseline.cogsAed, fixedReturnCogs, "Fixed delivery period reports FIFO COGS", 0.01);
  assertEq(fixedDeliveryReportAfter.invoiceCount - fixedDeliveryReportBaseline.invoiceCount, 1, "Fixed delivery period counts invoice");
  assertClose(fixedReturnReportAfter.totalRevenueAed - fixedReturnReportBaseline.totalRevenueAed, -8400, "Fixed return period reverses full AED", 0.01);
  assertClose(fixedReturnReportAfter.stockOutGrams - fixedReturnReportBaseline.stockOutGrams, -20, "Fixed return period reports negative stock out", 0.0001);
  assertClose(fixedReturnReportAfter.makingChargesAed - fixedReturnReportBaseline.makingChargesAed, -200, "Fixed return period reverses making", 0.01);
  assertClose(fixedReturnReportAfter.cogsAed - fixedReturnReportBaseline.cogsAed, -fixedReturnCogs, "Fixed return period reverses FIFO COGS", 0.01);
  assertEq(fixedReturnReportAfter.invoiceCount - fixedReturnReportBaseline.invoiceCount, 0, "Fixed return period does not recount earlier invoice");

  const fixedDeliveryCategoryAfter = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>(`/dashboard/category-summary?${fixedDeliveryRange}`);
  const fixedReturnCategoryAfter = await apiJson<{
    rows: Array<{ category: string; grossGrams: number; amount: number; invoiceCount: number }>;
  }>(`/dashboard/category-summary?${fixedReturnRange}`);
  const fixedDeliveryCategoryBeforeGold = fixedDeliveryCategoryBaseline.rows.find((row) => row.category === CATEGORY)!;
  const fixedDeliveryCategoryAfterGold = fixedDeliveryCategoryAfter.rows.find((row) => row.category === CATEGORY)!;
  const fixedReturnCategoryBeforeGold = fixedReturnCategoryBaseline.rows.find((row) => row.category === CATEGORY)!;
  const fixedReturnCategoryAfterGold = fixedReturnCategoryAfter.rows.find((row) => row.category === CATEGORY)!;
  assertClose(fixedDeliveryCategoryAfterGold.amount - fixedDeliveryCategoryBeforeGold.amount, 8400, "Fixed delivery category reports AED", 0.01);
  assertClose(fixedDeliveryCategoryAfterGold.grossGrams - fixedDeliveryCategoryBeforeGold.grossGrams, 20, "Fixed delivery category reports grams", 0.0001);
  assertClose(fixedReturnCategoryAfterGold.amount - fixedReturnCategoryBeforeGold.amount, -8400, "Fixed return category reverses AED", 0.01);
  assertClose(fixedReturnCategoryAfterGold.grossGrams - fixedReturnCategoryBeforeGold.grossGrams, -20, "Fixed return category reverses grams", 0.0001);

  console.log("\n─── Test: Return crosses from open into rate-fixed metal ───");
  const mixedFixedReturnInvoice = await apiJson<{
    id: number;
    items: Array<{ id: number }>;
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-11-01",
      pricingType: "unfixed",
      idempotencyKey: `ws-mixed-fixed-return-${Date.now()}`,
      items: [{
        description: "Mixed fixed return coverage",
        category: CATEGORY,
        quantity: 1,
        grossGrams: 10,
        purityMultiplier: 1,
        makingAed: 100,
      }],
    }),
  });
  toClean.invoiceIds.push(mixedFixedReturnInvoice.id);
  await apiJson(`/wholesale/invoices/${mixedFixedReturnInvoice.id}/fix-rate`, {
    method: "POST",
    body: JSON.stringify({
      date: "2025-11-02",
      pureWeightGrams: 6,
      rateAedPerGram: 400,
      idempotencyKey: `ws-mixed-fixed-return-fix-${Date.now()}`,
    }),
  });

  const crossingReturn = await apiJson<{
    id: number; totalReturnedPureGrams: number; totalReturnedFixedPureGrams: number;
    totalReturnedMakingAed: number; totalReturnedMetalAed: number; totalReturnedAed: number;
  }>(`/wholesale/invoices/${mixedFixedReturnInvoice.id}/return`, {
    method: "POST",
    body: JSON.stringify({
      date: "2025-11-03",
      idempotencyKey: `ws-mixed-fixed-return-cross-${Date.now()}`,
      lines: [{ invoiceItemId: mixedFixedReturnInvoice.items[0]!.id, grossWeightGrams: 8 }],
    }),
  });
  toClean.returnIds.push(crossingReturn.id);
  assertClose(crossingReturn.totalReturnedPureGrams, 8, "Crossing return records all physical pure grams", 0.0001);
  assertClose(crossingReturn.totalReturnedFixedPureGrams, 4, "Crossing return consumes open metal before fixed metal", 0.0001);
  assertClose(crossingReturn.totalReturnedMakingAed, 80, "Crossing return reverses pro-rata making", 0.01);
  assertClose(crossingReturn.totalReturnedMetalAed, 1600, "Crossing return reverses fixed allocation AED", 0.01);
  assertClose(crossingReturn.totalReturnedAed, 1680, "Crossing return reverses making plus fixed AED", 0.01);

  const crossingInvoiceAfter = await apiJson<{
    status: string; openPureGrams: number; totalPureGrams: number;
    totalMakingAed: number; totalAed: number; settledAed: number;
    items: Array<{ fixedPureGrams: number; returnedFixedPureGrams: number; returnedMetalAed: number }>;
  }>(`/wholesale/invoices/${mixedFixedReturnInvoice.id}`);
  assertEq(crossingInvoiceAfter.status, "settled", "Crossing return settles the remaining open metal");
  assertClose(crossingInvoiceAfter.openPureGrams, 0, "Crossing return clears open pure obligation first", 0.0001);
  assertClose(crossingInvoiceAfter.totalPureGrams, 2, "Crossing return leaves only unreturned fixed pure grams", 0.0001);
  assertClose(crossingInvoiceAfter.totalMakingAed, 20, "Crossing return leaves making for remaining goods", 0.01);
  assertClose(crossingInvoiceAfter.totalAed, 820, "Crossing return leaves remaining fixed AED plus making", 0.01);
  assertClose(crossingInvoiceAfter.settledAed, 820, "Crossing return keeps posted AED reconciled", 0.01);
  assertClose(crossingInvoiceAfter.items[0]!.fixedPureGrams, 2, "Crossing return leaves the unreturned fixed allocation", 0.0001);

  const finalCrossingReturn = await apiJson<{
    id: number; totalReturnedFixedPureGrams: number;
    totalReturnedMakingAed: number; totalReturnedMetalAed: number; totalReturnedAed: number;
  }>(`/wholesale/invoices/${mixedFixedReturnInvoice.id}/return`, {
    method: "POST",
    body: JSON.stringify({
      date: "2025-11-04",
      idempotencyKey: `ws-mixed-fixed-return-final-${Date.now()}`,
      lines: [{ invoiceItemId: mixedFixedReturnInvoice.items[0]!.id, grossWeightGrams: 2 }],
    }),
  });
  toClean.returnIds.push(finalCrossingReturn.id);
  assertClose(finalCrossingReturn.totalReturnedFixedPureGrams, 2, "Final crossing return reverses residual fixed grams", 0.0001);
  assertClose(finalCrossingReturn.totalReturnedMakingAed, 20, "Final crossing return reverses residual making", 0.01);
  assertClose(finalCrossingReturn.totalReturnedMetalAed, 800, "Final crossing return reverses residual fixed AED", 0.01);
  assertClose(finalCrossingReturn.totalReturnedAed, 820, "Final crossing return clears residual AED", 0.01);

  const crossingFinalInvoice = await apiJson<{
    totalGrossGrams: number; totalPureGrams: number; totalMakingAed: number;
    totalAed: number; settledAed: number; openPureGrams: number;
  }>(`/wholesale/invoices/${mixedFixedReturnInvoice.id}`);
  assertClose(crossingFinalInvoice.totalGrossGrams, 0, "Final crossing return clears gross", 0.0001);
  assertClose(crossingFinalInvoice.totalPureGrams, 0, "Final crossing return clears pure", 0.0001);
  assertClose(crossingFinalInvoice.totalMakingAed, 0, "Final crossing return clears making", 0.01);
  assertClose(crossingFinalInvoice.totalAed, 0, "Final crossing return clears invoice AED", 0.01);
  assertClose(crossingFinalInvoice.settledAed, 0, "Final crossing return clears posted AED", 0.01);
  assertClose(crossingFinalInvoice.openPureGrams, 0, "Final crossing return keeps pure obligation clear", 0.0001);

  const crossingAllocations = await db.select().from(wholesaleSettlementAllocationsTable)
    .where(eq(wholesaleSettlementAllocationsTable.invoiceItemId, mixedFixedReturnInvoice.items[0]!.id));
  assertClose(crossingAllocations.reduce((sum, row) => sum + Number(row.returnedPureWeightGrams), 0), 6, "Settlement allocations track all returned fixed grams", 0.0001);
  assertClose(crossingAllocations.reduce((sum, row) => sum + Number(row.returnedAedAmount), 0), 2400, "Settlement allocations track all reversed fixed AED", 0.01);
  const crossingLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, mixedFixedReturnInvoice.id));
  assertClose(crossingLedger.reduce((sum, row) => sum + Number(row.aedDelta), 0), 0, "Crossing-return AED ledger reconciles to zero", 0.01);
  assertClose(crossingLedger.reduce((sum, row) => sum + Number(row.pureGoldGramsDelta), 0), 0, "Crossing-return pure ledger reconciles to zero", 0.0001);

  console.log("\n─── Test: Concurrent wholesale create versus return lock order ───");
  const [stockBeforeLockRace] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, CATEGORY));
  const lockRaceSource = await apiJson<{
    id: number; items: Array<{ id: number }>;
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-12-01",
      pricingType: "fixed",
      idempotencyKey: `ws-lock-race-source-${Date.now()}`,
      items: [{
        description: "Create return lock source",
        category: CATEGORY,
        quantity: 1,
        grossGrams: 10,
        purityMultiplier: 1,
        makingAed: 100,
        rateAedPerGram: 400,
      }],
    }),
  });
  toClean.invoiceIds.push(lockRaceSource.id);
  const [stockBeforeConcurrentMutation] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, CATEGORY));

  const concurrentResults = await Promise.allSettled([
    apiJson<{
      id: number; items: Array<{ id: number }>;
    }>("/wholesale/invoices", {
      method: "POST",
      body: JSON.stringify({
        traderId: trader.id,
        invoiceDate: "2025-12-02",
        pricingType: "fixed",
        idempotencyKey: `ws-lock-race-create-${Date.now()}`,
        items: [{
          description: "Concurrent wholesale create",
          category: CATEGORY,
          quantity: 1,
          grossGrams: 3,
          purityMultiplier: 1,
          makingAed: 30,
          rateAedPerGram: 400,
        }],
      }),
    }),
    apiJson<{ id: number }>(`/wholesale/invoices/${lockRaceSource.id}/return`, {
      method: "POST",
      body: JSON.stringify({
        date: "2025-12-02",
        idempotencyKey: `ws-lock-race-return-${Date.now()}`,
        lines: [{ invoiceItemId: lockRaceSource.items[0]!.id, grossWeightGrams: 2 }],
      }),
    }),
  ]);
  const concurrentCreate = concurrentResults[0];
  const concurrentReturn = concurrentResults[1];
  assert(
    concurrentCreate.status === "fulfilled",
    `Concurrent wholesale create completes without deadlock${concurrentCreate.status === "rejected" ? `: ${String(concurrentCreate.reason)}` : ""}`,
  );
  assert(
    concurrentReturn.status === "fulfilled",
    `Concurrent wholesale return completes without deadlock${concurrentReturn.status === "rejected" ? `: ${String(concurrentReturn.reason)}` : ""}`,
  );
  if (concurrentCreate.status === "fulfilled") {
    toClean.invoiceIds.push(concurrentCreate.value.id);
  }
  if (concurrentReturn.status === "fulfilled") {
    toClean.returnIds.push(concurrentReturn.value.id);
  }

  if (concurrentCreate.status === "fulfilled" && concurrentReturn.status === "fulfilled") {
    const [stockAfterConcurrentMutation] = await db.select().from(stockLevelsTable)
      .where(eq(stockLevelsTable.category, CATEGORY));
    assertClose(
      Number(stockAfterConcurrentMutation?.weightGrams ?? "0"),
      Number(stockBeforeConcurrentMutation?.weightGrams ?? "0") - 1,
      "Concurrent create (-3g) and return (+2g) reconcile stock atomically",
      0.0001,
    );
    const raceSourceConsumptions = await db.select().from(wholesaleInventoryConsumptionsTable)
      .where(eq(wholesaleInventoryConsumptionsTable.wholesaleInvoiceId, lockRaceSource.id));
    const raceCreateConsumptions = await db.select().from(wholesaleInventoryConsumptionsTable)
      .where(eq(wholesaleInventoryConsumptionsTable.wholesaleInvoiceId, concurrentCreate.value.id));
    assertClose(
      raceSourceConsumptions.reduce((sum, row) => sum + Number(row.returnedGrams), 0),
      2,
      "Concurrent return restores its exact FIFO grams",
      0.0001,
    );
    assertClose(
      raceCreateConsumptions.reduce((sum, row) => sum + Number(row.consumedGrams), 0),
      3,
      "Concurrent create records its exact FIFO consumption",
      0.0001,
    );

    const finalSourceReturn = await apiJson<{ id: number }>(`/wholesale/invoices/${lockRaceSource.id}/return`, {
      method: "POST",
      body: JSON.stringify({
        date: "2025-12-03",
        idempotencyKey: `ws-lock-race-source-final-${Date.now()}`,
        lines: [{ invoiceItemId: lockRaceSource.items[0]!.id, grossWeightGrams: 8 }],
      }),
    });
    toClean.returnIds.push(finalSourceReturn.id);
    const finalCreatedReturn = await apiJson<{ id: number }>(`/wholesale/invoices/${concurrentCreate.value.id}/return`, {
      method: "POST",
      body: JSON.stringify({
        date: "2025-12-03",
        idempotencyKey: `ws-lock-race-create-final-${Date.now()}`,
        lines: [{ invoiceItemId: concurrentCreate.value.items[0]!.id, grossWeightGrams: 3 }],
      }),
    });
    toClean.returnIds.push(finalCreatedReturn.id);
    const [stockAfterLockRaceCleanup] = await db.select().from(stockLevelsTable)
      .where(eq(stockLevelsTable.category, CATEGORY));
    assertClose(
      Number(stockAfterLockRaceCleanup?.weightGrams ?? "0"),
      Number(stockBeforeLockRace?.weightGrams ?? "0"),
      "Full returns after concurrent create/return restore stock baseline",
      0.0001,
    );
  }

  const summaryAfter = await apiJson<{
    totalSalesCreditAed: number;
    categoryBreakdown: Array<{ category: string; soldGrams: number }>;
  }>("/dashboard/summary-cards");
  const summaryBaselineGold = summaryBaseline.categoryBreakdown.find((row) => row.category === CATEGORY)!;
  const summaryAfterGold = summaryAfter.categoryBreakdown.find((row) => row.category === CATEGORY)!;
  assertClose(
    summaryAfter.totalSalesCreditAed - summaryBaseline.totalSalesCreditAed,
    expectedNetWholesaleRevenue,
    "Main financial summary includes wholesale sales credit",
    0.1,
  );
  assertClose(
    summaryAfterGold.soldGrams - summaryBaselineGold.soldGrams,
    165,
    "Main vault summary includes wholesale stock out net of returns",
    0.001,
  );

  // Raw PDF routes intentionally live outside OpenAPI but must remain
  // authenticated and browser-downloadable.
  await assertPdf(`/wholesale/invoices/${fixedInvoice.id}/pdf`, "Wholesale invoice PDF downloads");
  await assertPdf(`/wholesale/returns/${returnResult.id}/pdf`, "Wholesale return voucher PDF downloads");
  await assertPdf(`/wholesale/ledger/pdf?traderId=${trader.id}`, "Trader statement PDF downloads");
  await assertPdf(
    `/wholesale/summary/pdf?startDate=2025-06-01&endDate=2025-06-30&traderId=${trader.id}&status=partially_settled`,
    "Filtered wholesale summary PDF downloads",
  );
  await assertPdf(`/dashboard/statement-pdf?${reportRange}`, "Main financial statement PDF includes wholesale data");
  await assertXlsxContains(
    `/dashboard/statement-xlsx?${reportRange}`,
    fixedInvoice.invoiceNumber,
    "Main financial statement XLSX lists wholesale invoices",
  );
  await assertPdf(`/dashboard/statement-pdf?${returnRange}`, "Return-period financial statement PDF downloads");
  await assertXlsxContains(
    `/dashboard/statement-xlsx?${returnRange}`,
    `Return ${returnResult.returnNumber}`,
    "Return-period financial statement XLSX lists the dated wholesale return",
  );
  await assertPdf(
    `/wholesale/summary/pdf?startDate=2025-07-01&endDate=2025-07-31&traderId=${trader.id}`,
    "Return-period wholesale summary PDF downloads",
  );

  // ── FIFO batch verification ────────────────────────────────────────────────
  console.log("\n─── Test 7: FIFO batch consumption tracking ───");
  const [batchState] = await db.select().from(stockPurchasesTable).where(eq(stockPurchasesTable.id, stockPurchaseId));
  assert(batchState != null, "Stock purchase batch still exists");
  // Net fixture usage: fixed 50g + unfixed 100g + fully returned 30g
  // + mixed settlement 20g with 5g returned = 165g.
  const expectedRemaining = 200 - 50 - 100 - 30 + 30 - 20 + 5;
  assertClose(Number(batchState!.remainingWeightGrams), expectedRemaining, `Batch remaining = ${expectedRemaining}g`, 0.001);

  // Verify wholesale consumptions
  const allConsumptions = await db.select().from(wholesaleInventoryConsumptionsTable)
    .where(sql`wholesale_invoice_id = ANY(${`{${toClean.invoiceIds.join(",")}}`}::int[])`);
  assert(allConsumptions.length > 0, "Wholesale inventory consumptions recorded");

  console.log("\n─── All tests complete ───");
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let suiteSucceeded = false;
  try {
    await login();
    await ensureRegistryProvisioned();
    const recovery = await recoverAbandonedWholesaleRuns();
    if (recovery.claimedRunIds.length > 0) {
      console.log(
        `  ✓ Recovered ${recovery.deleted} abandoned registered fixture(s) from ` +
        `${recovery.claimedRunIds.length} prior run(s)${recovery.kept > 0 ? ` (${recovery.kept} kept)` : ""}`,
      );
    }
    await testInterruptionRecoveryIsolation();
    suiteRunId = await startSuiteRun("wholesale-regression", adminUserId);
    await run();
    suiteSucceeded = failCount === 0;
  } catch (err) {
    console.error("\nFATAL TEST ERROR:", err);
    failCount++;
  } finally {
    if (suiteRunId) {
      try {
        await cleanup();
      } catch (cleanErr) {
        console.error("Cleanup error:", cleanErr);
      }
      const finalized = await finalizeSuiteRun(suiteRunId, suiteSucceeded);
      if (!finalized.cleaned) {
        console.warn(
          `Retaining suite run registry for later recovery ` +
          `(${finalized.remainingFixtures} registered fixture(s) still present).`,
        );
      }
    }
    await pool.end();

    console.log(`\n=== Results: ${passCount} passed, ${failCount} failed ===`);
    if (failCount > 0) {
      process.exitCode = 1;
    }
  }
}

main();
