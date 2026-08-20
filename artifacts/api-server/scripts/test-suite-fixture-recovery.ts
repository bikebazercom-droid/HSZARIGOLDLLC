#!/usr/bin/env tsx
/**
 * Regression: crash-recovery guarantees of the suite run registry.
 *
 * Verifies, against the running API + dev database:
 *
 *   1. Atomic registration — a fixture created over HTTP with the suite run
 *      header is registered in the SAME transaction as its creation, so there
 *      is no window where a kill can leave an unregistered record.
 *   2. Interrupted-run recovery — an "active" run older than the stale gate
 *      (simulated crash) is claimed and its exact registered records deleted;
 *      the emptied run row is reclaimed.
 *   3. Live-run isolation — a fresh active run and its fixtures are never
 *      touched by recovery.
 *   4. Claim exclusivity — two concurrent recoveries never process the same
 *      run twice (status-transition claim).
 *   5. Undeletable fixtures stay registered and their run stays abandoned.
 *
 * Run via: pnpm --filter @workspace/api-server run test:suite-fixture-recovery
 * (the package script serializes all destructive suites on the shared flock).
 */

import { and, eq, like, sql } from "drizzle-orm";
import { db, pdfTestFixturesTable, pdfTestRunsTable, pool, stockPurchasesTable } from "@workspace/db";
import {
  SUITE_RUN_PREFIX,
  type SuiteEntityType,
  ensureRegistryProvisioned,
  finalizeSuiteRun,
  recoverAbandonedSuiteRuns,
  startSuiteRun,
} from "./suite-run-registry";
import { recoverStaleRuns } from "./pdf-run-registry";

const devDomain = process.env["REPLIT_DEV_DOMAIN"];
const port = process.env["PORT"] ?? "3000";
const BASE = process.env["API_BASE_URL"]
  ?? (devDomain ? `https://${devDomain}/api` : `http://localhost:${port}/api`);
const ADMIN_MOBILE = process.env["TEST_ADMIN_MOBILE"] ?? "01855580555";
const ADMIN_PIN = process.env["TEST_ADMIN_PIN"] ?? "1234";

let _cookie = "";
let adminUserId = 0;
let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

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
    body: JSON.stringify({ mobile: ADMIN_MOBILE, pin: ADMIN_PIN, role: "admin" }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) _cookie = setCookie.split(";")[0]!;
  const body = await res.json() as { id: number };
  adminUserId = body.id;
  console.log("  ✓ Logged in as admin");
}

async function createInvoice(runId: string, label: string): Promise<number> {
  const res = await apiReq("/invoices", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": runId },
    body: JSON.stringify({
      customerName: `TEST-SUITE-RECOVERY-${label}`,
      paymentMethod: "cash",
      subtotal: 100, discount: 0, total: 100,
      vatRate: 5, vatAmount: 0, totalBeforeVat: 100,
      totalIncludingVat: 100, roundOffDiscount: 0,
      isPending: true, items: [],
    }),
  });
  if (!res.ok) throw new Error(`createInvoice(${label}) failed (${res.status}): ${await res.text()}`);
  const body = await res.json() as { id: number };
  return body.id;
}

async function createStockPurchase(runId: string): Promise<number> {
  const res = await apiReq("/stock/purchases", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": runId },
    body: JSON.stringify({
      category: "gold_9999",
      supplierName: "TEST-SUITE-RECOVERY-SUPPLIER",
      purchaseDate: "0001-01-05",
      weightGrams: 5,
      totalPriceAed: 1000,
    }),
  });
  if (!res.ok) throw new Error(`createStockPurchase failed (${res.status}): ${await res.text()}`);
  const body = await res.json() as { id: number };
  return body.id;
}

async function deleteRegisteredFixture(entityType: SuiteEntityType, entityId: number): Promise<"deleted" | "missing" | "kept"> {
  const target =
    entityType === "invoice" ? { path: `/invoices/${entityId}`, headers: { "X-Allow-Invoice-Delete": "true" } } :
    entityType === "stock_purchase" ? { path: `/stock/purchases/${entityId}`, headers: {} } :
    null;
  if (!target) return "kept";
  try {
    const res = await apiReq(target.path, { method: "DELETE", headers: target.headers });
    if (res.ok) return "deleted";
    if (res.status === 404) return "missing";
    return "kept";
  } catch {
    return "kept";
  }
}

async function fixtureRows(runId: string): Promise<{ entityType: string; entityId: number }[]> {
  return db.select({ entityType: pdfTestFixturesTable.entityType, entityId: pdfTestFixturesTable.entityId })
    .from(pdfTestFixturesTable)
    .where(eq(pdfTestFixturesTable.runId, runId));
}

async function runRow(runId: string): Promise<{ status: string } | undefined> {
  const [row] = await db.select({ status: pdfTestRunsTable.status })
    .from(pdfTestRunsTable)
    .where(eq(pdfTestRunsTable.runId, runId));
  return row;
}

async function backdateRun(runId: string): Promise<void> {
  await db.update(pdfTestRunsTable)
    .set({ createdAt: sql`now() - interval '10 minutes'` })
    .where(eq(pdfTestRunsTable.runId, runId));
}

async function invoiceExists(id: number): Promise<boolean> {
  const res = await apiReq(`/invoices/${id}`);
  return res.ok;
}

async function stockPurchaseExists(id: number): Promise<boolean> {
  const [row] = await db.select({ id: stockPurchasesTable.id })
    .from(stockPurchasesTable)
    .where(eq(stockPurchasesTable.id, id));
  return row != null;
}

async function main(): Promise<void> {
  console.log("━━━ Suite fixture recovery tests ━━━");
  console.log(`API base: ${BASE}`);
  await login();
  await ensureRegistryProvisioned();
  // Start from a clean slate so pre-existing abandoned runs don't skew counts.
  await recoverAbandonedSuiteRuns(deleteRegisteredFixture);

  console.log("\nTest 1: Fixture creation and registration are atomic (server-side)");
  // Mixed fixtures mirror the category-statement suite: invoices + stock batches.
  const crashRunId = await startSuiteRun("suite-fixture-recovery-crash", adminUserId);
  const crashInvoiceId = await createInvoice(crashRunId, "CRASH");
  const crashPurchaseId = await createStockPurchase(crashRunId);
  {
    const rows = await fixtureRows(crashRunId);
    check("invoice registered in the same request that created it",
      rows.some((row) => row.entityType === "invoice" && row.entityId === crashInvoiceId),
      JSON.stringify(rows));
    check("stock purchase registered in the same request that created it",
      rows.some((row) => row.entityType === "stock_purchase" && row.entityId === crashPurchaseId),
      JSON.stringify(rows));
  }

  console.log("\nTest 2: A killed run (active, stale) is recovered by exact registered ID");
  // Simulate the crash: no finalize, no client cleanup; the process just dies.
  await backdateRun(crashRunId);
  const freshRunId = await startSuiteRun("suite-fixture-recovery-live", adminUserId);
  const liveInvoiceId = await createInvoice(freshRunId, "LIVE");
  const recovery = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  check("crashed run was claimed", recovery.claimedRunIds.includes(crashRunId), JSON.stringify(recovery));
  check("exactly the two registered records were deleted", recovery.deleted === 2, `deleted=${recovery.deleted}`);
  check("crashed invoice no longer exists", !(await invoiceExists(crashInvoiceId)));
  check("crashed stock purchase no longer exists", !(await stockPurchaseExists(crashPurchaseId)));
  check("emptied crashed run row reclaimed", (await runRow(crashRunId)) === undefined);

  console.log("\nTest 3: A live (fresh, active) run is never touched by recovery");
  check("live run was not claimed", !recovery.claimedRunIds.includes(freshRunId));
  check("live run still active", (await runRow(freshRunId))?.status === "active");
  check("live invoice untouched", await invoiceExists(liveInvoiceId));
  check("live fixture still registered", (await fixtureRows(freshRunId)).length === 1);

  console.log("\nTest 4: Two concurrent recoveries never claim the same run twice");
  const contendedRunId = await startSuiteRun("suite-fixture-recovery-contend", adminUserId);
  const contendedInvoiceId = await createInvoice(contendedRunId, "CONTEND");
  await backdateRun(contendedRunId);
  let deleteAttempts = 0;
  const countingDeleter = async (entityType: SuiteEntityType, entityId: number) => {
    if (entityType === "invoice" && entityId === contendedInvoiceId) deleteAttempts += 1;
    return deleteRegisteredFixture(entityType, entityId);
  };
  const [r1, r2] = await Promise.all([
    recoverAbandonedSuiteRuns(countingDeleter),
    recoverAbandonedSuiteRuns(countingDeleter),
  ]);
  const claimants = [r1, r2].filter((r) => r.claimedRunIds.includes(contendedRunId));
  check("exactly one recovery claimed the contended run", claimants.length === 1,
    JSON.stringify({ r1: r1.claimedRunIds, r2: r2.claimedRunIds }));
  check("the registered fixture was delete-attempted exactly once", deleteAttempts === 1, `attempts=${deleteAttempts}`);
  check("contended invoice removed", !(await invoiceExists(contendedInvoiceId)));

  console.log("\nTest 5: An undeletable fixture stays registered; its run stays abandoned");
  const stuckRunId = await startSuiteRun("suite-fixture-recovery-stuck", adminUserId);
  const stuckInvoiceId = await createInvoice(stuckRunId, "STUCK");
  await backdateRun(stuckRunId);
  const keepEverything = async () => "kept" as const;
  const stuckRecovery = await recoverAbandonedSuiteRuns(keepEverything);
  check("stuck run was claimed", stuckRecovery.claimedRunIds.includes(stuckRunId));
  check("nothing deleted when deleter keeps records", stuckRecovery.deleted === 0);
  check("fixture still registered for a later attempt", (await fixtureRows(stuckRunId)).length === 1);
  check("stuck run kept as abandoned", (await runRow(stuckRunId))?.status === "abandoned");
  // Real cleanup: recover it for real this time.
  const cleanupRecovery = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  check("second recovery removed the retained record", cleanupRecovery.deleted === 1 && !(await invoiceExists(stuckInvoiceId)));

  console.log("\nTest 6: A recovery process killed mid-claim leaves a reclaimable run");
  const deadClaimRunId = await startSuiteRun("suite-fixture-recovery-deadclaim", adminUserId);
  const deadClaimInvoiceId = await createInvoice(deadClaimRunId, "DEADCLAIM");
  // Simulate: a previous recovery claimed the run ("recovering") and was then
  // killed; the lease timestamp (createdAt) has since aged past the gate.
  await db.update(pdfTestRunsTable)
    .set({ status: "recovering", createdAt: sql`now() - interval '10 minutes'` })
    .where(eq(pdfTestRunsTable.runId, deadClaimRunId));
  // A FRESH claim must not be stealable: give the live run a recovering state
  // with a current lease and assert it is left alone.
  const freshClaimRunId = await startSuiteRun("suite-fixture-recovery-freshclaim", adminUserId);
  const freshClaimInvoiceId = await createInvoice(freshClaimRunId, "FRESHCLAIM");
  await db.update(pdfTestRunsTable)
    .set({ status: "recovering" })
    .where(eq(pdfTestRunsTable.runId, freshClaimRunId));
  const deadClaimRecovery = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  check("expired recovering claim was reclaimed", deadClaimRecovery.claimedRunIds.includes(deadClaimRunId),
    JSON.stringify(deadClaimRecovery.claimedRunIds));
  check("its registered invoice was removed", !(await invoiceExists(deadClaimInvoiceId)));
  check("emptied dead-claim run row reclaimed", (await runRow(deadClaimRunId)) === undefined);
  check("fresh recovering claim was NOT stolen", !deadClaimRecovery.claimedRunIds.includes(freshClaimRunId));
  check("fresh claim's invoice untouched", await invoiceExists(freshClaimInvoiceId));
  // Clean up the fresh-claim simulation: age its lease and recover it for real.
  await db.update(pdfTestRunsTable)
    .set({ createdAt: sql`now() - interval '10 minutes'` })
    .where(eq(pdfTestRunsTable.runId, freshClaimRunId));
  const freshCleanup = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  check("aged claim later recovered cleanly", freshCleanup.claimedRunIds.includes(freshClaimRunId)
    && !(await invoiceExists(freshClaimInvoiceId)));

  console.log("\nTest 7: Browser-PDF stale recovery never mutates suite runs");
  const pdfIsolatedRunId = await startSuiteRun("suite-fixture-recovery-pdfiso", adminUserId);
  const pdfIsolatedInvoiceId = await createInvoice(pdfIsolatedRunId, "PDFISO");
  await backdateRun(pdfIsolatedRunId); // stale by age, but alive as far as PDF recovery must assume
  await recoverStaleRuns();
  check("stale suite run left active by PDF recovery", (await runRow(pdfIsolatedRunId))?.status === "active");
  check("suite fixture untouched by PDF recovery", (await fixtureRows(pdfIsolatedRunId)).length === 1);
  check("suite invoice untouched by PDF recovery", await invoiceExists(pdfIsolatedInvoiceId));
  // Clean it up via the suite path (it is stale, so suite recovery claims it).
  const pdfIsoCleanup = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  check("suite recovery still reclaims it afterwards",
    pdfIsoCleanup.claimedRunIds.includes(pdfIsolatedRunId) && !(await invoiceExists(pdfIsolatedInvoiceId)));

  // Cleanup the live run properly (verified finalize).
  await deleteRegisteredFixture("invoice", liveInvoiceId);
  const finalized = await finalizeSuiteRun(freshRunId, true);
  check("live run finalized after verified cleanup", finalized.cleaned);

  const leftovers = await db.select({ runId: pdfTestRunsTable.runId })
    .from(pdfTestRunsTable)
    .where(and(like(pdfTestRunsTable.runId, `${SUITE_RUN_PREFIX}suite-fixture-recovery-%`)));
  check("no registry rows left behind by this test", leftovers.length === 0, JSON.stringify(leftovers));

  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("\nSuite fixture recovery test failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
