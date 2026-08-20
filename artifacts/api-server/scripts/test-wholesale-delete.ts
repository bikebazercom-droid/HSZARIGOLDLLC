#!/usr/bin/env tsx
/**
 * Wholesale Invoice Delete regression test (Task #91)
 *
 * Covers:
 *   1. Staff user gets 403 (requireAdmin)
 *   2. Invalid id gets 400
 *   3. Missing / already-deleted invoice gets 404
 *   4. Fixed invoice: delete reverses FIFO, stock, ledger, audit log → 204
 *   5. Unfixed invoice: delete reverses FIFO, stock, ledger, audit log → 204
 *   6. Rate-fix invoice: delete reverses FIFO, stock, ledger, settlements, audit → 204
 *   7. Partial-return invoice: delete restores only unreturned FIFO grams,
 *      not the already-returned fraction (no double restoration)
 *   8. Exact FIFO restoration: remaining_weight_grams matches before-state
 *   9. Ledger baseline reconciliation: trader ledger is zero after delete
 *  10. Corrupted FIFO history: delete returns 409, transaction rolls back,
 *      invoice/batch/stock/ledger are proven unchanged; fixture repaired and
 *      re-deleted successfully
 *  11. Repeated delete returns 404 (idempotent guard)
 *  12. Concurrent delete: exactly one succeeds, one 404; no double-restore
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run test:wholesale-delete
 *
 * The API server must be running.
 */

import { pool, db } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  pdfTestFixturesTable,
  wholesaleTradersTable,
  wholesaleInvoicesTable,
  wholesaleInvoiceItemsTable,
  wholesaleInventoryConsumptionsTable,
  wholesaleSettlementsTable,
  wholesaleReturnsTable,
  traderLedgerEntriesTable,
  stockLevelsTable,
  stockPurchasesTable,
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
import { acquireStockMutationLock } from "../src/services/inventoryEngine.js";
import {
  createWholesaleInvoice,
  applyPhysicalReturn,
  applyRateFix,
} from "../src/services/wholesaleService.js";

// ── Config ────────────────────────────────────────────────────────────────────

const devDomain = process.env["REPLIT_DEV_DOMAIN"];
const port = process.env["PORT"] ?? "3000";
const BASE = process.env["API_BASE_URL"]
  ?? (devDomain ? `https://${devDomain}/api` : `http://localhost:${port}/api`);

const ADMIN_MOBILE = process.env["TEST_ADMIN_MOBILE"] ?? "01855580555";
const ADMIN_PIN = process.env["TEST_ADMIN_PIN"] ?? "1234";
const STAFF_MOBILE = process.env["TEST_STAFF_MOBILE"] ?? String(Date.now()).slice(-11);
const STAFF_PIN = process.env["TEST_STAFF_PIN"] ?? "9999";
const CATEGORY = "gold_9999";

// ── State ─────────────────────────────────────────────────────────────────────

let _adminCookie = "";
let _staffCookie = "";
let adminUserId = 0;
let suiteRunId = "";
let passCount = 0;
let failCount = 0;

const toClean: {
  traderIds: number[];
  invoiceIds: number[];
  returnIds: number[];
  stockPurchaseIds: number[];
  userIds: number[];
} = { traderIds: [], invoiceIds: [], returnIds: [], stockPurchaseIds: [], userIds: [] };

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function apiReq(
  path: string,
  init: RequestInit = {},
  cookie = _adminCookie,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(suiteRunId ? { "X-Pdf-E2e-Run-Id": suiteRunId } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (cookie) headers["Cookie"] = cookie;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiReq(path, init);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
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

// ── Auth ──────────────────────────────────────────────────────────────────────

async function loginAdmin(): Promise<void> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: ADMIN_MOBILE, pin: ADMIN_PIN, role: "admin" }),
  });
  if (!res.ok) throw new Error(`Admin login failed (${res.status}): ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) _adminCookie = setCookie.split(";")[0]!;
  const user = await res.json() as { id: number };
  adminUserId = user.id;
  console.log("  ✓ Logged in as admin");
}

async function createAndLoginStaffFixture(): Promise<void> {
  const createRes = await apiReq("/admin/users", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
    body: JSON.stringify({
      fullName: "TEST-WHOLESALE-DELETE-STAFF",
      mobile: STAFF_MOBILE,
      pin: STAFF_PIN,
      role: "staff",
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Staff fixture creation failed (${createRes.status}): ${await createRes.text()}`);
  }
  const staff = await createRes.json() as { id: number };
  toClean.userIds.push(staff.id);

  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: STAFF_MOBILE, pin: STAFF_PIN, role: "staff" }),
  });
  if (!loginRes.ok) {
    throw new Error(`Staff login failed (${loginRes.status}): ${await loginRes.text()}`);
  }
  const setCookie = loginRes.headers.get("set-cookie");
  if (!setCookie) throw new Error("Staff login did not return a session cookie");
  _staffCookie = setCookie.split(";")[0]!;
  console.log(`  ✓ Created and logged in as temporary staff user ${staff.id}`);
}

// ── Setup helpers ─────────────────────────────────────────────────────────────

async function createStockPurchase(
  weightGrams: number,
  pricePerGram: number,
  category = CATEGORY,
): Promise<number> {
  const res = await apiJson<{ id: number }>("/stock/purchases", {
    method: "POST",
    body: JSON.stringify({
      category,
      supplierName: "TEST-DELETE-SUPPLIER",
      purchaseDate: "2025-01-01",
      weightGrams,
      totalPriceAed: weightGrams * pricePerGram,
      narrative: "Delete regression test batch",
    }),
  });
  toClean.stockPurchaseIds.push(res.id);
  return res.id;
}

// ── Cleanup helpers ───────────────────────────────────────────────────────────

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

      for (const c of consumptions) {
        const netConsumed = Number(c.consumedGrams) - Number(c.returnedGrams);
        if (c.purchaseId != null && netConsumed > 0.0001) {
          await tx.execute(sql`
            UPDATE stock_purchases
            SET remaining_weight_grams = remaining_weight_grams::numeric + ${String(netConsumed)}::numeric
            WHERE id = ${c.purchaseId}
              AND remaining_weight_grams::numeric + ${String(netConsumed)}::numeric <= weight_grams::numeric + 0.0001
          `);
        }
      }

      await tx.delete(traderLedgerEntriesTable)
        .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, invoiceId));

      const returns = await tx.select({ id: wholesaleReturnsTable.id })
        .from(wholesaleReturnsTable)
        .where(eq(wholesaleReturnsTable.invoiceId, invoiceId));
      const returnIds = returns.map((r) => r.id);
      if (returnIds.length) {
        await tx.delete(traderLedgerEntriesTable).where(
          inArray(traderLedgerEntriesTable.wholesaleReturnId, returnIds),
        );
      }

      const settlements = await tx.select({ id: wholesaleSettlementsTable.id })
        .from(wholesaleSettlementsTable)
        .where(eq(wholesaleSettlementsTable.invoiceId, invoiceId));
      const settlementIds = settlements.map((s) => s.id);
      if (settlementIds.length) {
        await tx.delete(traderLedgerEntriesTable).where(
          inArray(traderLedgerEntriesTable.wholesaleSettlementId, settlementIds),
        );
      }

      const stockMovementsQuery = await tx.execute<{
        category: string; weight_grams: string;
      }>(sql`
        SELECT category, weight_grams::text
        FROM stock_movements
        WHERE (ref_type = 'wholesale_invoice' AND ref_id = ${invoiceId})
          ${returnIds.length > 0
            ? sql`OR (ref_type = 'wholesale_return' AND ref_id = ANY(${sql.raw(`ARRAY[${returnIds.join(",")}]::int[]`)}))`
            : sql``}
      `).then((r) => r.rows);
      const netByCategory = new Map<string, number>();
      for (const m of stockMovementsQuery) {
        netByCategory.set(m.category, (netByCategory.get(m.category) ?? 0) + Number(m.weight_grams));
      }
      for (const [category, netMovement] of netByCategory) {
        if (Math.abs(netMovement) < 0.0001) continue;
        await tx.execute(sql`
          UPDATE stock_levels
          SET weight_grams = weight_grams::numeric - ${String(netMovement)}::numeric,
              updated_at = NOW()
          WHERE category = ${category}
        `);
      }

      await tx.delete(auditLogTable).where(and(
        eq(auditLogTable.entityType, "wholesale_invoice"),
        eq(auditLogTable.entityId, invoiceId),
      ));

      await tx.delete(pdfTestFixturesTable).where(and(
        eq(pdfTestFixturesTable.entityType, "wholesale_invoice"),
        eq(pdfTestFixturesTable.entityId, invoiceId),
      ));
      if (returnIds.length) {
        await tx.delete(pdfTestFixturesTable).where(and(
          eq(pdfTestFixturesTable.entityType, "wholesale_return"),
          inArray(pdfTestFixturesTable.entityId, returnIds),
        ));
      }

      await tx.delete(wholesaleInvoicesTable).where(eq(wholesaleInvoicesTable.id, invoiceId));
      return "deleted";
    });
  } catch (error) {
    console.warn(`    cleanup invoice ${invoiceId} failed: ${error}`);
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
    entityType === "stock_purchase"
      ? { path: `/stock/purchases/${entityId}`, headers: {} }
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
  for (const userId of toClean.userIds) {
    await cleanupRegisteredFixture("user", userId);
  }
}

async function recoverAbandoned() {
  return recoverAbandonedSuiteRuns(deleteRegisteredFixture, new Date(), "wholesale-delete");
}

// ── Main tests ────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log("=== Wholesale Invoice Delete Regression Test ===\n");

  // ── Setup: create trader + stock batch ──────────────────────────────────────
  console.log("\n─── Setup: trader + stock ───");
  const trader = await apiJson<{ id: number; name: string }>("/wholesale/traders", {
    method: "POST",
    body: JSON.stringify({ name: "TEST-DELETE-TRADER", phone: "+971509999999", isActive: true }),
  });
  toClean.traderIds.push(trader.id);

  const stockPurchaseId = await createStockPurchase(200, 400);

  const [initialBatch] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  const [initialLevel] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, CATEGORY));
  const initialRemaining = Number(initialBatch?.remainingWeightGrams ?? "0");
  const initialStock = Number(initialLevel?.weightGrams ?? "0");
  console.log(`  Initial batch remaining: ${initialRemaining}g, stock level: ${initialStock}g`);

  const initialLedger = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.traderId, trader.id));
  const ledgerBaseline = initialLedger.reduce((sum, e) => sum + Number(e.aedDelta), 0);
  const pureBaseline = initialLedger.reduce((sum, e) => sum + Number(e.pureGoldGramsDelta), 0);

  // ── Test 1: Staff 403 ──────────────────────────────────────────────────────
  console.log("\n─── Test 1: Staff user gets 403 ───");
  await createAndLoginStaffFixture();
  const staffRes = await apiReq("/wholesale/invoices/999999", { method: "DELETE" }, _staffCookie);
  assertEq(staffRes.status, 403, "Staff DELETE /wholesale/invoices/:id returns 403");

  // ── Test 2: Invalid id → 400 ───────────────────────────────────────────────
  console.log("\n─── Test 2: Invalid id gets 400 ───");
  const invalidIdRes = await apiReq("/wholesale/invoices/not-a-number", { method: "DELETE" });
  assertEq(invalidIdRes.status, 400, "DELETE with non-numeric id returns 400");

  // ── Test 3: Missing invoice → 404 ─────────────────────────────────────────
  console.log("\n─── Test 3: Missing invoice gets 404 ───");
  const missingRes = await apiReq("/wholesale/invoices/999999999", { method: "DELETE" });
  assertEq(missingRes.status, 404, "DELETE non-existent invoice returns 404");

  // ── Test 4: Fixed invoice delete ───────────────────────────────────────────
  console.log("\n─── Test 4: Fixed invoice delete ───");
  const fixedInvoice = await apiJson<{
    id: number; invoiceNumber: string; totalAed: number; status: string;
    items: Array<{ id: number; grossGrams: number }>;
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-01-15",
      pricingType: "fixed",
      idempotencyKey: `del-fixed-${Date.now()}`,
      items: [{
        description: "Fixed delete test",
        category: CATEGORY,
        quantity: 1,
        grossGrams: 30,
        purityMultiplier: 0.9999,
        makingAed: 300,
        rateAedPerGram: 420,
      }],
    }),
  });
  toClean.invoiceIds.push(fixedInvoice.id);

  const [batchAfterFixed] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  const remainingAfterFixed = Number(batchAfterFixed?.remainingWeightGrams ?? "0");
  assertClose(remainingAfterFixed, initialRemaining - 30, "Fixed invoice consumed 30g from FIFO batch", 0.001);

  const fixedLedgerBefore = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, fixedInvoice.id));
  assert(fixedLedgerBefore.length >= 1, "Fixed invoice has ledger entries before delete");

  // Delete it
  const deleteFixed = await apiReq(`/wholesale/invoices/${fixedInvoice.id}`, { method: "DELETE" });
  assertEq(deleteFixed.status, 204, "Fixed invoice DELETE returns 204");

  // Verify FIFO restoration
  const [batchAfterDelete] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  assertClose(
    Number(batchAfterDelete?.remainingWeightGrams ?? "0"),
    initialRemaining,
    "Fixed invoice delete restores FIFO batch grams",
    0.001,
  );

  // Verify stock level restored
  const [levelAfterFixed] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, CATEGORY));
  assertClose(Number(levelAfterFixed?.weightGrams ?? "0"), initialStock, "Fixed invoice delete restores stock level", 0.001);

  // Verify ledger entries deleted
  const fixedLedgerAfter = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, fixedInvoice.id));
  assertEq(fixedLedgerAfter.length, 0, "Fixed invoice delete removes all ledger entries");

  // Verify audit log entry
  const fixedAudit = await db.select().from(auditLogTable).where(and(
    eq(auditLogTable.entityType, "wholesale_invoice"),
    eq(auditLogTable.entityId, fixedInvoice.id),
    eq(auditLogTable.action, "delete"),
  ));
  assert(fixedAudit.length === 1, "Fixed invoice delete inserts audit log entry");
  assert(
    fixedAudit[0]?.details?.includes(fixedInvoice.invoiceNumber) ?? false,
    "Audit log contains invoice number",
  );

  // Verify invoice is gone
  const fixedCheck = await apiReq(`/wholesale/invoices/${fixedInvoice.id}`);
  assertEq(fixedCheck.status, 404, "Fixed invoice is gone after delete");
  // Remove from cleanup list (already deleted)
  toClean.invoiceIds.splice(toClean.invoiceIds.indexOf(fixedInvoice.id), 1);

  // ── Test 5: Unfixed invoice delete ────────────────────────────────────────
  console.log("\n─── Test 5: Unfixed invoice delete ───");
  const unfixedInvoice = await apiJson<{
    id: number; invoiceNumber: string; status: string;
    items: Array<{ id: number }>;
  }>("/wholesale/invoices", {
    method: "POST",
    body: JSON.stringify({
      traderId: trader.id,
      invoiceDate: "2025-02-01",
      pricingType: "unfixed",
      idempotencyKey: `del-unfixed-${Date.now()}`,
      items: [{
        description: "Unfixed delete test",
        category: CATEGORY,
        quantity: 1,
        grossGrams: 20,
        purityMultiplier: 0.9999,
        makingAed: 200,
      }],
    }),
  });
  toClean.invoiceIds.push(unfixedInvoice.id);

  const [batchAfterUnfixed] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  const remainingAfterUnfixed = Number(batchAfterUnfixed?.remainingWeightGrams ?? "0");
  assertClose(remainingAfterUnfixed, initialRemaining - 20, "Unfixed invoice consumed 20g", 0.001);

  const unfixedLedgerBefore = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, unfixedInvoice.id));
  assert(unfixedLedgerBefore.length >= 1, "Unfixed invoice has delivery ledger entries");

  const deleteUnfixed = await apiReq(`/wholesale/invoices/${unfixedInvoice.id}`, { method: "DELETE" });
  assertEq(deleteUnfixed.status, 204, "Unfixed invoice DELETE returns 204");

  const [batchAfterUnfixedDelete] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  assertClose(
    Number(batchAfterUnfixedDelete?.remainingWeightGrams ?? "0"),
    initialRemaining,
    "Unfixed invoice delete restores FIFO batch",
    0.001,
  );

  const unfixedLedgerAfter = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, unfixedInvoice.id));
  assertEq(unfixedLedgerAfter.length, 0, "Unfixed invoice delete removes delivery ledger entries");

  const unfixedAudit = await db.select().from(auditLogTable).where(and(
    eq(auditLogTable.entityType, "wholesale_invoice"),
    eq(auditLogTable.entityId, unfixedInvoice.id),
    eq(auditLogTable.action, "delete"),
  ));
  assert(unfixedAudit.length === 1, "Unfixed invoice delete inserts audit log entry");
  toClean.invoiceIds.splice(toClean.invoiceIds.indexOf(unfixedInvoice.id), 1);

  // ── Test 6: Rate-fix invoice delete ──────────────────────────────────────
  console.log("\n─── Test 6: Rate-fix invoice delete ───");
  const rateFix = await createWholesaleInvoice({
    traderId: trader.id,
    traderSnapshot: { name: trader.name },
    invoiceDate: "2025-03-01",
    pricingType: "unfixed",
    idempotencyKey: `del-ratefix-${Date.now()}`,
    fixtureRunId: suiteRunId,
    items: [{ description: "Rate fix delete", category: CATEGORY, quantity: 1, grossGrams: 40, purityMultiplier: 0.9999, makingAed: 400 }],
  });
  if (!rateFix.invoice) throw new Error("Rate fix invoice not created");
  const rateFixInvoiceId = rateFix.invoice.invoice.id;
  toClean.invoiceIds.push(rateFixInvoiceId);

  await applyRateFix({
    invoiceId: rateFixInvoiceId,
    pureWeightGrams: 20,
    rateAedPerGram: 430,
    date: "2025-03-05",
    fixtureRunId: suiteRunId,
    idempotencyKey: `del-ratefix-settle-${Date.now()}`,
  });

  const rateFixLedgerBefore = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, rateFixInvoiceId));
  const rateFixSettlementsBefore = await db.select().from(wholesaleSettlementsTable)
    .where(eq(wholesaleSettlementsTable.invoiceId, rateFixInvoiceId));
  assert(rateFixLedgerBefore.length >= 2, "Rate-fix invoice has delivery + rate-fix ledger entries");
  assert(rateFixSettlementsBefore.length >= 1, "Rate-fix invoice has settlement records");

  const deleteRateFix = await apiReq(`/wholesale/invoices/${rateFixInvoiceId}`, { method: "DELETE" });
  assertEq(deleteRateFix.status, 204, "Rate-fix invoice DELETE returns 204");

  const rateFixLedgerAfter = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, rateFixInvoiceId));
  assertEq(rateFixLedgerAfter.length, 0, "Rate-fix invoice delete removes all ledger entries including rate-fix");

  const [batchAfterRateFix] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  assertClose(
    Number(batchAfterRateFix?.remainingWeightGrams ?? "0"),
    initialRemaining,
    "Rate-fix invoice delete restores all 40g to FIFO batch",
    0.001,
  );

  const rateFixAudit = await db.select().from(auditLogTable).where(and(
    eq(auditLogTable.entityType, "wholesale_invoice"),
    eq(auditLogTable.entityId, rateFixInvoiceId),
    eq(auditLogTable.action, "delete"),
  ));
  assert(rateFixAudit.length === 1, "Rate-fix invoice delete has audit log");
  toClean.invoiceIds.splice(toClean.invoiceIds.indexOf(rateFixInvoiceId), 1);

  // ── Test 7: Partial-return invoice — only unreturned grams restored ────────
  console.log("\n─── Test 7: Partial-return invoice delete ───");
  const partialReturnInv = await createWholesaleInvoice({
    traderId: trader.id,
    traderSnapshot: { name: trader.name },
    invoiceDate: "2025-04-01",
    pricingType: "unfixed",
    idempotencyKey: `del-partret-${Date.now()}`,
    fixtureRunId: suiteRunId,
    items: [{ description: "Partial return delete", category: CATEGORY, quantity: 1, grossGrams: 50, purityMultiplier: 0.9999, makingAed: 500 }],
  });
  if (!partialReturnInv.invoice) throw new Error("Partial return invoice not created");
  const partialReturnInvoiceId = partialReturnInv.invoice.invoice.id;
  const partialReturnItemId = partialReturnInv.invoice.items[0]!.id;
  toClean.invoiceIds.push(partialReturnInvoiceId);

  const [batchBeforePartialReturn] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  const remainingBeforePartialReturn = Number(batchBeforePartialReturn?.remainingWeightGrams ?? "0");
  assertClose(remainingBeforePartialReturn, initialRemaining - 50, "Partial-return invoice consumed 50g", 0.001);

  // Physically return 15g (partial return)
  const partialReturn = await applyPhysicalReturn({
    invoiceId: partialReturnInvoiceId,
    date: "2025-04-05",
    fixtureRunId: suiteRunId,
    idempotencyKey: `del-partret-ret-${Date.now()}`,
    lines: [{ invoiceItemId: partialReturnItemId, grossWeightGrams: 15 }],
  });
  if (!partialReturn.result) throw new Error("Partial return not applied");
  toClean.returnIds.push(partialReturn.result.ret.id);

  const [batchAfterPartialReturn] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  const remainingAfterPartialReturn = Number(batchAfterPartialReturn?.remainingWeightGrams ?? "0");
  // After 50g delivery and 15g return: net = 35g consumed from batch
  assertClose(remainingAfterPartialReturn, initialRemaining - 35, "After partial return, batch has 35g net consumed", 0.001);

  // Now delete the invoice
  const deletePartialReturn = await apiReq(`/wholesale/invoices/${partialReturnInvoiceId}`, { method: "DELETE" });
  assertEq(deletePartialReturn.status, 204, "Partial-return invoice DELETE returns 204");

  // Batch should be restored to initial state (the 35g net consumed restored, not 50g)
  const [batchAfterPartialDelete] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  assertClose(
    Number(batchAfterPartialDelete?.remainingWeightGrams ?? "0"),
    initialRemaining,
    "Partial-return delete restores only unreturned 35g (not 50g double-restore)",
    0.001,
  );

  // Verify ledger is clean for this trader
  const partialRetLedgerAfter = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, partialReturnInvoiceId));
  assertEq(partialRetLedgerAfter.length, 0, "Partial-return delete removes delivery + return ledger entries");

  // Ledger baseline reconciliation
  const traderLedgerAfter = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.traderId, trader.id));
  const ledgerAedAfter = traderLedgerAfter.reduce((sum, e) => sum + Number(e.aedDelta), 0);
  const ledgerPureAfter = traderLedgerAfter.reduce((sum, e) => sum + Number(e.pureGoldGramsDelta), 0);
  assertClose(ledgerAedAfter, ledgerBaseline, "Trader AED ledger returns to baseline after all deletes", 0.01);
  assertClose(ledgerPureAfter, pureBaseline, "Trader pure-gram ledger returns to baseline after all deletes", 0.001);

  toClean.invoiceIds.splice(toClean.invoiceIds.indexOf(partialReturnInvoiceId), 1);
  toClean.returnIds.splice(toClean.returnIds.indexOf(partialReturn.result.ret.id), 1);

  // ── Test 8: Exact FIFO restoration ────────────────────────────────────────
  console.log("\n─── Test 8: Exact FIFO restoration ───");
  // Verify that after all deletes in this test, the FIFO batch is back to initial state
  const [finalBatch] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  assertClose(
    Number(finalBatch?.remainingWeightGrams ?? "0"),
    initialRemaining,
    "FIFO batch remaining matches pre-test state exactly",
    0.001,
  );
  const [finalLevel] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, CATEGORY));
  assertClose(Number(finalLevel?.weightGrams ?? "0"), initialStock, "Stock level matches pre-test state exactly", 0.001);

  // ── Test 9: Shortfall invoice delete ──────────────────────────────────────
  console.log("\n─── Test 9: Shortfall invoice delete (no source batch) ───");
  const shortfallCategory = `ws_shortfall_del_${Date.now()}`;
  const shortfallInv = await createWholesaleInvoice({
    traderId: trader.id,
    traderSnapshot: { name: trader.name },
    invoiceDate: "2025-05-01",
    pricingType: "unfixed",
    fixtureRunId: suiteRunId,
    idempotencyKey: `del-shortfall-${Date.now()}`,
    items: [{ description: "Shortfall delete", category: shortfallCategory, quantity: 1, grossGrams: 5, purityMultiplier: 1, makingAed: 0 }],
  });
  if (!shortfallInv.invoice) throw new Error("Shortfall invoice not created");
  const shortfallInvoiceId = shortfallInv.invoice.invoice.id;
  toClean.invoiceIds.push(shortfallInvoiceId);

  const [shortfallSlice] = await db.select().from(wholesaleInventoryConsumptionsTable)
    .where(eq(wholesaleInventoryConsumptionsTable.wholesaleInvoiceId, shortfallInvoiceId));
  assert(shortfallSlice?.isShortfall === true, "Shortfall invoice has is_shortfall=true consumption row");
  assert(shortfallSlice?.purchaseId == null, "Shortfall slice has null purchase_id");

  const deleteShortfall = await apiReq(`/wholesale/invoices/${shortfallInvoiceId}`, { method: "DELETE" });
  assertEq(deleteShortfall.status, 204, "Shortfall invoice DELETE returns 204 (no real batch to restore)");

  // Shortfall category should have ~0 stock (was negative, delete reverses negative delta)
  const [shortfallLevel] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, shortfallCategory));
  assertClose(Number(shortfallLevel?.weightGrams ?? "0"), 0, "Shortfall invoice delete restores stock level to zero", 0.001);

  toClean.invoiceIds.splice(toClean.invoiceIds.indexOf(shortfallInvoiceId), 1);

  // ── Test 10: Corrupted FIFO history → 409, no partial writes ─────────────
  console.log("\n─── Test 10: Corrupted FIFO history → 409, invariants unchanged ───");
  // Create a fresh invoice backed by a known batch, then directly corrupt its
  // consumption row so that the net-consume > item.grossGrams.  The delete must
  // return 409 and the transaction must roll back leaving invoice, batch, stock
  // level, and ledger exactly as they were before the delete attempt.

  const corruptInv = await createWholesaleInvoice({
    traderId: trader.id,
    traderSnapshot: { name: trader.name },
    invoiceDate: "2025-08-01",
    pricingType: "fixed",
    fixtureRunId: suiteRunId,
    idempotencyKey: `del-corrupt-${Date.now()}`,
    items: [{
      description: "Corrupt FIFO test",
      category: CATEGORY,
      quantity: 1,
      grossGrams: 10,
      purityMultiplier: 1,
      makingAed: 100,
      rateAedPerGram: 400,
    }],
  });
  if (!corruptInv.invoice) throw new Error("Corrupt test invoice not created");
  const corruptInvoiceId = corruptInv.invoice.invoice.id;
  toClean.invoiceIds.push(corruptInvoiceId);

  // Snapshot pre-attempt state
  const [batchBeforeCorrupt] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  const [levelBeforeCorrupt] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, CATEGORY));
  const ledgerBeforeCorrupt = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, corruptInvoiceId));
  const batchRemainingBeforeCorrupt = Number(batchBeforeCorrupt?.remainingWeightGrams ?? "0");
  const stockBeforeCorrupt = Number(levelBeforeCorrupt?.weightGrams ?? "0");

  // Locate the consumption row for this invoice
  const [consumptionRow] = await db.select({
    id: wholesaleInventoryConsumptionsTable.id,
    consumedGrams: wholesaleInventoryConsumptionsTable.consumedGrams,
  })
    .from(wholesaleInventoryConsumptionsTable)
    .where(eq(wholesaleInventoryConsumptionsTable.wholesaleInvoiceId, corruptInvoiceId));
  assert(consumptionRow != null, "Corrupt test: consumption row found");
  const originalConsumedGrams = consumptionRow?.consumedGrams ?? "10";

  // ── Corrupt the consumption row: inflate consumed_grams beyond batch headroom
  // This makes consumed_grams > grossGrams (10) which will fail the item-level
  // consistency check (net consumed ≠ expected net).
  const corruptedConsumedGrams = "9999.0000"; // far beyond the 10g item
  await db.execute(sql`
    UPDATE wholesale_inventory_consumptions
    SET consumed_grams = ${corruptedConsumedGrams}::numeric
    WHERE id = ${consumptionRow!.id}
  `);

  // Attempt delete — must return 409 because FIFO history is inconsistent
  const deleteCorrupt = await apiReq(`/wholesale/invoices/${corruptInvoiceId}`, { method: "DELETE" });
  assertEq(deleteCorrupt.status, 409, "Corrupted FIFO consumption → DELETE returns 409");
  const corruptBody = await deleteCorrupt.json() as { error?: string };
  assert(
    typeof corruptBody.error === "string" && corruptBody.error.length > 0,
    "409 response has error message",
    corruptBody.error,
  );

  // ── Prove rollback: invoice still exists ─────────────────────────────────
  const invoiceStillExists = await apiReq(`/wholesale/invoices/${corruptInvoiceId}`);
  assertEq(invoiceStillExists.status, 200, "Invoice still exists after 409 (transaction rolled back)");

  // ── Prove rollback: batch unchanged ──────────────────────────────────────
  const [batchAfterCorrupt] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  assertClose(
    Number(batchAfterCorrupt?.remainingWeightGrams ?? "0"),
    batchRemainingBeforeCorrupt,
    "Batch remaining_weight_grams unchanged after 409 rollback",
    0.001,
  );

  // ── Prove rollback: stock level unchanged ─────────────────────────────────
  const [levelAfterCorrupt] = await db.select().from(stockLevelsTable)
    .where(eq(stockLevelsTable.category, CATEGORY));
  assertClose(
    Number(levelAfterCorrupt?.weightGrams ?? "0"),
    stockBeforeCorrupt,
    "Stock level unchanged after 409 rollback",
    0.001,
  );

  // ── Prove rollback: ledger entries unchanged ──────────────────────────────
  const ledgerAfterCorrupt = await db.select().from(traderLedgerEntriesTable)
    .where(eq(traderLedgerEntriesTable.wholesaleInvoiceId, corruptInvoiceId));
  assertEq(
    ledgerAfterCorrupt.length,
    ledgerBeforeCorrupt.length,
    "Ledger entry count unchanged after 409 rollback",
  );

  // ── Repair the consumption row so cleanup can proceed ────────────────────
  await db.execute(sql`
    UPDATE wholesale_inventory_consumptions
    SET consumed_grams = ${originalConsumedGrams}::numeric
    WHERE id = ${consumptionRow!.id}
  `);

  // Verify repair worked
  const [repairedRow] = await db.select({
    consumedGrams: wholesaleInventoryConsumptionsTable.consumedGrams,
  })
    .from(wholesaleInventoryConsumptionsTable)
    .where(eq(wholesaleInventoryConsumptionsTable.id, consumptionRow!.id));
  assertClose(
    Number(repairedRow?.consumedGrams ?? "0"),
    Number(originalConsumedGrams),
    "Consumption row repaired to original value for cleanup",
    0.001,
  );

  // Now delete for real (cleaned fixture)
  const deleteCorruptFixed = await apiReq(`/wholesale/invoices/${corruptInvoiceId}`, { method: "DELETE" });
  assertEq(deleteCorruptFixed.status, 204, "Repaired invoice deletes successfully after fix");
  toClean.invoiceIds.splice(toClean.invoiceIds.indexOf(corruptInvoiceId), 1);

  // ── Test 11: Repeated delete → 404 ───────────────────────────────────────
  console.log("\n─── Test 11: Repeated delete returns 404 ───");
  // Create a throwaway invoice to delete twice; register with fixtureRunId so
  // cleanup can recover it if the test is abandoned mid-run.
  const throwawayInv = await createWholesaleInvoice({
    traderId: trader.id,
    traderSnapshot: { name: trader.name },
    invoiceDate: "2025-06-01",
    pricingType: "fixed",
    fixtureRunId: suiteRunId,
    idempotencyKey: `del-throwaway-${Date.now()}`,
    items: [{ description: "Throwaway", category: CATEGORY, quantity: 1, grossGrams: 5, purityMultiplier: 1, makingAed: 50, rateAedPerGram: 400 }],
  });
  if (!throwawayInv.invoice) throw new Error("Throwaway invoice not created");
  const throwawayId = throwawayInv.invoice.invoice.id;

  const del1 = await apiReq(`/wholesale/invoices/${throwawayId}`, { method: "DELETE" });
  assertEq(del1.status, 204, "First delete returns 204");
  const del2 = await apiReq(`/wholesale/invoices/${throwawayId}`, { method: "DELETE" });
  assertEq(del2.status, 404, "Second delete returns 404");

  // ── Test 12: Concurrent delete ────────────────────────────────────────────
  console.log("\n─── Test 12: Concurrent delete — exactly one succeeds ───");
  const concurrentInv = await createWholesaleInvoice({
    traderId: trader.id,
    traderSnapshot: { name: trader.name },
    invoiceDate: "2025-07-01",
    pricingType: "fixed",
    fixtureRunId: suiteRunId,
    idempotencyKey: `del-concurrent-${Date.now()}`,
    items: [{ description: "Concurrent delete", category: CATEGORY, quantity: 1, grossGrams: 5, purityMultiplier: 1, makingAed: 50, rateAedPerGram: 400 }],
  });
  if (!concurrentInv.invoice) throw new Error("Concurrent invoice not created");
  const concurrentId = concurrentInv.invoice.invoice.id;

  const [concRes1, concRes2] = await Promise.all([
    apiReq(`/wholesale/invoices/${concurrentId}`, { method: "DELETE" }),
    apiReq(`/wholesale/invoices/${concurrentId}`, { method: "DELETE" }),
  ]);
  const statuses = [concRes1.status, concRes2.status].sort();
  assertEq(statuses[0], 204, "Concurrent delete: one succeeds with 204");
  assertEq(statuses[1], 404, "Concurrent delete: one fails with 404");

  // Verify FIFO not double-restored
  const [batchAfterConcurrent] = await db.select().from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, stockPurchaseId));
  assertClose(
    Number(batchAfterConcurrent?.remainingWeightGrams ?? "0"),
    initialRemaining,
    "Concurrent delete does not double-restore FIFO batch",
    0.001,
  );

  console.log("\n─── All delete tests complete ───");
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let suiteSucceeded = false;
  try {
    await loginAdmin();
    await ensureRegistryProvisioned();
    const recovery = await recoverAbandoned();
    if (recovery.claimedRunIds.length > 0) {
      console.log(
        `  ✓ Recovered ${recovery.deleted} fixture(s) from ${recovery.claimedRunIds.length} abandoned run(s)`,
      );
    }
    suiteRunId = await startSuiteRun("wholesale-delete-regression", adminUserId);
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
          `Retaining suite run registry (${finalized.remainingFixtures} fixture(s) still present).`,
        );
      }
    }
    await pool.end();
    if (failCount > 0) {
      console.error(`\n✗ ${failCount} test(s) failed, ${passCount} passed`);
      process.exit(1);
    } else {
      console.log(`\n✓ All ${passCount} tests passed`);
    }
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
