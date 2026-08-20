#!/usr/bin/env tsx
/**
 * Integration test: invoice deletion guard edge cases
 *
 * Covers the four scenarios required by Task #33:
 *
 *   1. DELETE without X-Allow-Invoice-Delete on a PAID invoice → 409
 *      (guard blocks deletion; invoice still exists afterwards)
 *
 *   2. DELETE without X-Allow-Invoice-Delete on a PENDING invoice → 204
 *      (isPending=true bypasses the header requirement)
 *
 *   2b. DELETE WITH X-Allow-Invoice-Delete on a PAID invoice → 204
 *       (explicit unlock header overrides the guard)
 *
 *   3. Concurrent deletes on a PAID invoice with stock items → exactly one
 *      204 + one 404; the FIFO stock lot is restored exactly once (i.e. the
 *      remaining_weight_grams returns to the pre-invoice value, not doubled).
 *
 * NOTE: There is no PATCH/PUT route that allows toggling isPending on an
 * existing invoice — the field is immutable after creation. The guard
 * therefore always reads isPending from the live DB row at delete time, which
 * is the same as the creation-time value. Tests 1 & 2 exercise the two
 * possible values directly without a server-side transition path.
 *
 * ── How to run ────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/api-server run test:invoice-delete-guard
 *
 *   The API server must be running. Set API_BASE_URL if the default
 *   (Replit dev-domain or http://localhost:$PORT/api) doesn't match your
 *   environment.
 *
 * The script logs in as the seeded admin (mobile 0000000000 / PIN 1234),
 * creates short-lived test invoices and a single stock lot, then cleans up
 * after itself. Any resources that survive a test failure are labelled
 * TEST-DELETE-GUARD-* so they can be removed manually.
 */

import { pool } from "@workspace/db";
import {
  ensureRegistryProvisioned,
  finalizeSuiteRun,
  recoverAbandonedSuiteRuns,
  startSuiteRun,
  type SuiteEntityType,
} from "./suite-run-registry";

// ── Config ───────────────────────────────────────────────────────────────────

const devDomain = process.env["REPLIT_DEV_DOMAIN"];
const port      = process.env["PORT"] ?? "3000";
const BASE       = process.env["API_BASE_URL"]
  ?? (devDomain
    ? `https://${devDomain}/api`
    : `http://localhost:${port}/api`);

// Credentials default to the seeded admin (see src/lib/seed.ts).
// Override via environment variables if your deployment uses different values.
const ADMIN_MOBILE = process.env["TEST_ADMIN_MOBILE"] ?? "01855580555";
const ADMIN_PIN    = process.env["TEST_ADMIN_PIN"]    ?? "1234";
const ADMIN_ROLE   = "admin";

// Stock lot used for FIFO reversal test (10 g at 200 AED/g = 2 000 AED)
const TEST_CATEGORY    = "gold_9999";
const TEST_LOT_GRAMS   = 10;
const TEST_LOT_AED     = 2000;
const TEST_ITEM_GRAMS  = 5; // Invoice will sell half the lot

// ── HTTP helper ───────────────────────────────────────────────────────────────

let _cookie = "";
let suiteRunId = "";
let adminUserId = 0;

async function apiReq(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (_cookie) headers["Cookie"] = _cookie;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function login(): Promise<void> {
  const res = await apiReq("/auth/login", {
    method: "POST",
    body: JSON.stringify({ mobile: ADMIN_MOBILE, pin: ADMIN_PIN, role: ADMIN_ROLE }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) _cookie = setCookie.split(";")[0]!;
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

// ── Fixture helpers ───────────────────────────────────────────────────────────

async function createTestInvoice(
  isPending: boolean,
  label: string,
  items: {
    description: string;
    category: string;
    grossWeight: number;
    unitPrice: number;
    totalPrice: number;
    quantity: number;
  }[] = [],
): Promise<{ id: number; invoiceNumber: string }> {
  const itemsTotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const total = Math.max(itemsTotal, 100);
  const res = await apiReq("/invoices", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
    body: JSON.stringify({
      customerName: `TEST-DELETE-GUARD-${label}`,
      paymentMethod: "cash",
      subtotal: total,
      discount: 0,
      total,
      vatRate: 5,
      vatAmount: 0,
      totalBeforeVat: total,
      totalIncludingVat: total,
      roundOffDiscount: 0,
      isPending,
      items,
    }),
  });
  if (!res.ok) throw new Error(`createTestInvoice(${label}) failed (${res.status}): ${await res.text()}`);
  const created = (await res.json()) as { id: number; invoiceNumber: string };
  return created;
}

async function createStockLot(): Promise<{ id: number; weightGrams: number }> {
  const res = await apiReq("/stock/purchases", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
    body: JSON.stringify({
      category: TEST_CATEGORY,
      supplierName: "TEST-DELETE-GUARD-SUPPLIER",
      purchaseDate: new Date().toISOString().split("T")[0],
      weightGrams: TEST_LOT_GRAMS,
      totalPriceAed: TEST_LOT_AED,
    }),
  });
  if (!res.ok) throw new Error(`createStockLot failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { id: number; weightGrams: number };
  return data;
}

async function deleteStockLot(id: number): Promise<void> {
  // Best-effort cleanup; ignore errors (lot may already be deleted or have residual remaining)
  await apiReq(`/stock/purchases/${id}`, { method: "DELETE" }).catch(() => {});
}

/** Returns the current total stock balance for a category (from /stock/levels). */
async function getStockLevel(category: string): Promise<number | null> {
  const res = await apiReq("/stock/levels");
  if (!res.ok) return null;
  const list = (await res.json()) as { category: string; weightGrams: number }[];
  return list.find((l) => l.category === category)?.weightGrams ?? 0;
}

async function deleteInvoice(
  id: number,
  { withHeader = false }: { withHeader?: boolean } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (withHeader) headers["X-Allow-Invoice-Delete"] = "true";
  const res = await apiReq(`/invoices/${id}`, { method: "DELETE", headers });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* 204 has no body */ }
  return { status: res.status, body };
}

// ── Assertions ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else       { console.error(`  ✗ FAIL: ${msg}`); failed++; }
}

// ── Test cases ────────────────────────────────────────────────────────────────

async function test1_PaidInvoiceBlockedWithoutHeader(): Promise<void> {
  console.log("\nTest 1: Paid invoice DELETE without unlock header → 409");
  const inv = await createTestInvoice(false, "PAID-NO-HEADER");
  console.log(`  Created ${inv.invoiceNumber} (isPending=false)`);

  const { status, body } = await deleteInvoice(inv.id);
  assert(status === 409, `Expected 409, got ${status}`);
  const errMsg = (body as Record<string, string>)?.error ?? "";
  assert(
    errMsg.toLowerCase().includes("paid"),
    `Error message should mention 'paid' — got: ${JSON.stringify(body)}`,
  );

  // Invoice must still exist (guard blocked the delete)
  const check = await apiReq(`/invoices/${inv.id}`);
  assert(check.status === 200, `Invoice must still exist after blocked delete (got ${check.status})`);

  // Cleanup
  await deleteInvoice(inv.id, { withHeader: true });
}

async function test2_PendingInvoiceSucceedsWithoutHeader(): Promise<void> {
  console.log("\nTest 2: Pending invoice DELETE without unlock header → 204");
  const inv = await createTestInvoice(true, "PENDING-NO-HEADER");
  console.log(`  Created ${inv.invoiceNumber} (isPending=true)`);

  const { status } = await deleteInvoice(inv.id);
  assert(status === 204, `Expected 204, got ${status}`);

  const check = await apiReq(`/invoices/${inv.id}`);
  assert(check.status === 404, `Invoice must be gone after delete (got ${check.status})`);
}

async function test2b_PaidInvoiceSucceedsWithHeader(): Promise<void> {
  console.log("\nTest 2b: Paid invoice DELETE WITH unlock header → 204");
  const inv = await createTestInvoice(false, "PAID-WITH-HEADER");
  console.log(`  Created ${inv.invoiceNumber} (isPending=false)`);

  const { status } = await deleteInvoice(inv.id, { withHeader: true });
  assert(status === 204, `Expected 204, got ${status}`);

  const check = await apiReq(`/invoices/${inv.id}`);
  assert(check.status === 404, `Invoice must be gone after delete (got ${check.status})`);
}

async function test3_IsPendingToggleCannotBypassGuard(): Promise<void> {
  console.log("\nTest 3: Attempting to flip isPending on a PAID invoice cannot bypass the deletion guard");

  // Create a real paid invoice to use as the fixture.
  const inv = await createTestInvoice(false, "TOGGLE-ATTEMPT");
  console.log(`  Created ${inv.invoiceNumber} (isPending=false)`);

  // Attempt to flip isPending via every method that could plausibly update it.
  // Using a real invoice ID distinguishes "route not found (405)" from "record not found (404)".
  const patchRes  = await apiReq(`/invoices/${inv.id}`, { method: "PATCH", body: JSON.stringify({ isPending: true }) });
  const putRes    = await apiReq(`/invoices/${inv.id}`, { method: "PUT",   body: JSON.stringify({ isPending: true }) });
  console.log(`  PATCH /invoices/${inv.id} → ${patchRes.status}`);
  console.log(`  PUT   /invoices/${inv.id} → ${putRes.status}`);

  // Verify that neither route flipped isPending to true by checking the invoice state.
  const getRes = await apiReq(`/invoices/${inv.id}`);
  assert(getRes.status === 200, `Invoice must still be readable (got ${getRes.status})`);
  const inv2 = (await getRes.json()) as { isPending: boolean | null };
  assert(
    inv2.isPending === false,
    `isPending must still be false after toggle attempts (got ${inv2.isPending})`,
  );

  // The critical assertion: DELETE without the unlock header must still return 409
  // regardless of what the toggle attempts returned. If any update route had
  // successfully flipped isPending to true, this would return 204 instead.
  const { status: deleteStatus } = await deleteInvoice(inv.id, { withHeader: false });
  assert(
    deleteStatus === 409,
    `DELETE without header must still return 409 after toggle attempts (got ${deleteStatus})`,
  );

  // Cleanup
  await deleteInvoice(inv.id, { withHeader: true });
}

async function test4_ConcurrentDeletesFireOneFifoReversal(): Promise<void> {
  console.log("\nTest 4: Concurrent paid invoice deletes with stock items → one 204 + one 404; FIFO lot restored once");

  // 1. Record baseline stock level so we can detect double-reversal (which
  //    would push the balance above baseline+lot by an extra TEST_ITEM_GRAMS).
  const levelBaseline = await getStockLevel(TEST_CATEGORY) ?? 0;
  console.log(`  Stock level baseline: ${levelBaseline}g ${TEST_CATEGORY}`);

  // 2. Seed a stock lot so the invoice has real FIFO consumption to reverse.
  const lot = await createStockLot();
  console.log(`  Created stock lot id=${lot.id} (${TEST_LOT_GRAMS}g @ ${TEST_LOT_AED} AED total)`);

  // Confirm the stock level rose by the lot weight.
  const levelAfterLot = await getStockLevel(TEST_CATEGORY) ?? 0;
  assert(
    Math.abs(levelAfterLot - (levelBaseline + TEST_LOT_GRAMS)) < 0.001,
    `Stock level after lot creation: expected ${levelBaseline + TEST_LOT_GRAMS}g, got ${levelAfterLot}g`,
  );

  // 3. Create a paid invoice consuming half the lot.
  const inv = await createTestInvoice(false, "CONCURRENT", [
    {
      description: "Test Gold",
      category: TEST_CATEGORY,
      grossWeight: TEST_ITEM_GRAMS,
      quantity: 1,
      unitPrice: TEST_LOT_AED / TEST_LOT_GRAMS,
      totalPrice: TEST_ITEM_GRAMS * (TEST_LOT_AED / TEST_LOT_GRAMS),
    },
  ]);
  console.log(`  Created ${inv.invoiceNumber} (isPending=false, item=${TEST_ITEM_GRAMS}g ${TEST_CATEGORY})`);

  // Stock level must have dropped by the sold weight.
  const levelAfterInvoice = await getStockLevel(TEST_CATEGORY) ?? 0;
  assert(
    Math.abs(levelAfterInvoice - (levelBaseline + TEST_LOT_GRAMS - TEST_ITEM_GRAMS)) < 0.001,
    `Stock level after invoice: expected ${levelBaseline + TEST_LOT_GRAMS - TEST_ITEM_GRAMS}g, got ${levelAfterInvoice}g`,
  );

  // 4. Confirm FIFO consumption exists via the profit endpoint.
  const profitRes = await apiReq(`/invoices/${inv.id}/profit`);
  assert(profitRes.status === 200, `Profit endpoint should return 200 (got ${profitRes.status})`);
  const profit = (await profitRes.json()) as { items: { tracked: boolean; lots: { weightGrams: number }[] }[] };
  const trackedItem = profit.items.find((it) => it.tracked);
  assert(trackedItem != null, "Invoice item should have FIFO consumption recorded");
  const totalConsumedGrams = (trackedItem?.lots ?? []).reduce((s, l) => s + l.weightGrams, 0);
  assert(
    Math.abs(totalConsumedGrams - TEST_ITEM_GRAMS) < 0.001,
    `FIFO consumption should be ${TEST_ITEM_GRAMS}g, got ${totalConsumedGrams}g`,
  );

  // 5. Fire both concurrent deletes simultaneously.
  const [r1, r2] = await Promise.all([
    deleteInvoice(inv.id, { withHeader: true }),
    deleteInvoice(inv.id, { withHeader: true }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert(
    statuses[0] === 204 && statuses[1] === 404,
    `Expected one 204 and one 404 — got ${r1.status} and ${r2.status}`,
  );

  // 6. Invoice must be gone.
  const check = await apiReq(`/invoices/${inv.id}`);
  assert(check.status === 404, `Invoice must be gone after concurrent deletes (got ${check.status})`);

  // 7. Critical: stock balance must be back to baseline+lot (reversal fired exactly once).
  //    A double reversal would push the level to baseline+lot+item, exceeding the lot weight.
  const levelAfterDelete = await getStockLevel(TEST_CATEGORY) ?? 0;
  const expectedLevel = levelBaseline + TEST_LOT_GRAMS; // sold grams restored once
  const overshootLevel = levelBaseline + TEST_LOT_GRAMS + TEST_ITEM_GRAMS; // what a double-reversal gives
  assert(
    Math.abs(levelAfterDelete - expectedLevel) < 0.001,
    `Stock level after delete: expected ${expectedLevel}g (restored once), got ${levelAfterDelete}g` +
    (Math.abs(levelAfterDelete - overshootLevel) < 0.001 ? " [DOUBLE REVERSAL DETECTED]" : ""),
  );

  // Cleanup: delete the now-unconsumed stock lot (returns 204 when unconsumed).
  await deleteStockLot(lot.id);

  // Verify stock level returned to baseline after lot cleanup.
  const levelAfterCleanup = await getStockLevel(TEST_CATEGORY) ?? 0;
  assert(
    Math.abs(levelAfterCleanup - levelBaseline) < 0.001,
    `Stock level after cleanup: expected baseline ${levelBaseline}g, got ${levelAfterCleanup}g`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n━━━ Invoice delete-guard edge-case tests ━━━`);
  console.log(`API base: ${BASE}`);

  await login();

  await ensureRegistryProvisioned();
  const recovery = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  if (recovery.claimedRunIds.length > 0) console.log(`  ✓ Recovered ${recovery.deleted} abandoned registered fixture(s) from ${recovery.claimedRunIds.length} prior run(s)${recovery.kept > 0 ? ` (${recovery.kept} kept)` : ""}`);
  suiteRunId = await startSuiteRun("invoice-delete-guard", adminUserId);

  let suiteSucceeded = false;
  try {
    await test1_PaidInvoiceBlockedWithoutHeader();
    await test2_PendingInvoiceSucceedsWithoutHeader();
    await test2b_PaidInvoiceSucceedsWithHeader();
    await test3_IsPendingToggleCannotBypassGuard();
    await test4_ConcurrentDeletesFireOneFifoReversal();

    console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
    if (failed === 0) suiteSucceeded = true;
  } finally {
    const finalized = await finalizeSuiteRun(suiteRunId, suiteSucceeded);
    if (!finalized.cleaned) console.warn(`Retaining suite run registry for later recovery (${finalized.remainingFixtures} registered fixture(s) still present).`);
    await pool.end().catch(() => {});
  }
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("\nUnhandled error:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
