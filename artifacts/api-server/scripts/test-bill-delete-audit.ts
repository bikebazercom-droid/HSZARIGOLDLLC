#!/usr/bin/env tsx
/**
 * Audit-trail tests for DELETE /purchase-bills/:id
 *
 * Covers two complementary layers:
 *
 * ── Runtime integration tests (Tests A–D) ────────────────────────────────────
 *
 *   A. Deleting an unpaid bill writes exactly one audit log entry with the
 *      correct shape: entityType="purchase_bill", action="delete".
 *
 *   B. A blocked deletion (bill not found at lock time — 404) must NOT write
 *      any audit entry.  Reverse-atomicity guarantee: no orphan rows.
 *
 *   C. Two concurrent DELETE requests for the SAME bill serialise via the
 *      SELECT … FOR UPDATE row lock.  The winner gets 204 + one audit entry;
 *      the loser gets 404 and must not write an additional (orphan) row.
 *      After the race: exactly one audit entry for the bill, not zero, not two.
 *
 *   D. Two concurrent DELETE requests for DISTINCT bills proceed independently.
 *      Both must return 204 and each must have exactly one audit entry
 *      in the log.  This is the direct proof that concurrent deletes of
 *      different bills cannot silently drop either audit entry.
 *
 * ── Static source-code check (Test E) ────────────────────────────────────────
 *
 *   E. The audit insert uses tx.insert(auditLogTable) inside the DELETE
 *      handler's db.transaction() callback — not db.insert() outside it.
 *      If someone ever moves the insert outside the transaction, a server
 *      restart between the COMMIT and the stray db.insert would leave the
 *      bill deleted with no trace in the audit log.  The static check catches
 *      this before a runtime test could even be run.
 *
 *      A mutation guard proves the assertions are load-bearing: a synthetically
 *      broken source (tx.insert replaced by db.insert outside the transaction)
 *      correctly fails all checks.
 *
 * ── How to run ────────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/api-server run test:bill-delete-audit
 *
 *   The API server must be running (Tests A–D hit the live API).
 *   Set API_BASE_URL if the default Replit dev-domain doesn't match your env.
 *
 * Test fixtures are labelled TEST-BILL-DELETE-AUDIT-* and cleaned up after
 * each test.  Any fixture that survives a failure can be removed manually.
 */

import { pool } from "@workspace/db";
import { ensureRegistryProvisioned, finalizeSuiteRun, recoverAbandonedSuiteRuns, startSuiteRun, type SuiteEntityType } from "./suite-run-registry";

// ── Config ───────────────────────────────────────────────────────────────────

const devDomain = process.env["REPLIT_DEV_DOMAIN"];
const port      = process.env["PORT"] ?? "3000";
const BASE       = process.env["API_BASE_URL"]
  ?? (devDomain
    ? `https://${devDomain}/api`
    : `http://localhost:${port}/api`);

const ADMIN_MOBILE = process.env["TEST_ADMIN_MOBILE"] ?? "01855580555";
const ADMIN_PIN    = process.env["TEST_ADMIN_PIN"]    ?? "1234";
const ADMIN_ROLE   = "admin";

// ── HTTP helper ───────────────────────────────────────────────────────────────

let _cookie = "";

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
  const body = (await res.json()) as { id: number };
  adminUserId = body.id;
  console.log("  ✓ Logged in as admin");
}

// ── Suite run registry ──────────────────────────────────────────────────────

/** The logged-in admin's user id; required to start an owned suite run. */
let adminUserId = 0;

/** Set once in main() after recovery; used by fixture helpers to register IDs. */
let suiteRunId = "";

/** Deletes a single registered fixture via the script's own HTTP session. */
async function deleteRegisteredFixture(entityType: SuiteEntityType, entityId: number): Promise<"deleted" | "missing" | "kept"> {
  if (entityType.startsWith("wholesale_")) return "kept";
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

/** Create a minimal unpaid purchase bill with one line item. */
async function createTestBill(label: string): Promise<{ id: number; billNo: string }> {
  // Use a label + timestamp to ensure the billNo is unique across concurrent
  // test runs in the same DB.
  const billNo = `TEST-BILL-AUDIT-${label}-${Date.now()}`;
  const res = await apiReq("/purchase-bills", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
    body: JSON.stringify({
      billNo,
      billDate: new Date().toISOString().split("T")[0],
      supplierName: "TEST-BILL-DELETE-AUDIT-SUPPLIER",
      purchaseType: "fixed",
      paymentStatus: "unpaid",
      notes: "Created by test-bill-delete-audit",
      items: [
        {
          category: "gold_9999",
          grossWeightGrams: 10,
          purityPercent: 99.9,
          rateAedPerG: 200,
          makingChargeAed: 0,
          lineTotalAed: 2000, // 10g × 200 AED/g
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`createTestBill(${label}) failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { id: number; billNo: string };
  return { id: data.id, billNo: data.billNo };
}

/** Best-effort cleanup (ignores errors — bill may already be deleted). */
async function cleanupBill(id: number): Promise<void> {
  await apiReq(`/purchase-bills/${id}`, { method: "DELETE" }).catch(() => null);
}

// ── Audit log helpers ─────────────────────────────────────────────────────────

interface AuditEntry {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  billNo: string | null;
  actorId: number | null;
  createdAt: string;
}

/** Return all "delete" audit entries for a specific purchase_bill entityId. */
async function deleteAuditEntriesForBill(billId: number): Promise<AuditEntry[]> {
  const res = await apiReq("/purchase-bills/audit-log");
  if (!res.ok) throw new Error(`audit-log fetch failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { entries: AuditEntry[] } | AuditEntry[];
  const all = Array.isArray(body) ? body : body.entries;
  return all.filter(
    (e) => e.entityType === "purchase_bill" && e.entityId === billId && e.action === "delete",
  );
}

// ── Assertions ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else       { console.error(`  ✗ FAIL: ${msg}`); failed++; }
}

/** Inverse assert — used where we expect a condition to be false. */
function assertNot(cond: boolean, msg: string): void {
  assert(!cond, msg);
}

// ── Test A: single successful delete writes exactly one audit entry ───────────

async function testA_SingleDeleteWritesAuditEntry(): Promise<void> {
  console.log("\nTest A: Deleting a purchase bill writes exactly one audit log entry");

  const bill = await createTestBill("A");
  console.log(`  Created bill id=${bill.id} (${bill.billNo})`);

  // No delete entries must exist for a brand-new bill.
  const before = await deleteAuditEntriesForBill(bill.id);
  assert(before.length === 0, `No delete audit entries before delete (got ${before.length})`);

  const res = await apiReq(`/purchase-bills/${bill.id}`, { method: "DELETE" });
  try { await res.text(); } catch { /* drain body */ }
  assert(res.status === 204, `DELETE returned 204 (got ${res.status})`);

  // Bill must be gone.
  const checkRes = await apiReq(`/purchase-bills/${bill.id}`);
  assert(checkRes.status === 404, `Bill is gone after delete (got ${checkRes.status})`);

  const after = await deleteAuditEntriesForBill(bill.id);
  assert(after.length === 1, `Exactly one delete audit entry written (got ${after.length})`);

  if (after.length >= 1) {
    const entry = after[0]!;
    assert(entry.entityType === "purchase_bill", `entityType is "purchase_bill" (got "${entry.entityType}")`);
    assert(entry.action === "delete", `action is "delete" (got "${entry.action}")`);
    assert(entry.entityId === bill.id, `entityId matches bill id ${bill.id} (got ${entry.entityId})`);
    assert(entry.billNo === bill.billNo, `billNo matches "${bill.billNo}" (got "${entry.billNo}")`);
  }
}

// ── Test B: failed deletion (bill absent) leaves no orphan audit entry ────────

/**
 * Create a bill, delete it successfully (gets one audit entry), then try to
 * delete the now-gone bill again.  The second attempt must return 404 and must
 * NOT produce a second audit entry — the transaction's SELECT … FOR UPDATE
 * returns no row and exits before the audit insert.
 */
async function testB_FailedDeletionLeavesNoOrphanAuditEntry(): Promise<void> {
  console.log("\nTest B: A failed deletion (bill not found) leaves no orphan audit entry");

  const bill = await createTestBill("B");
  console.log(`  Created bill id=${bill.id} (${bill.billNo})`);

  // First deletion — must succeed and write exactly one audit entry.
  const firstRes = await apiReq(`/purchase-bills/${bill.id}`, { method: "DELETE" });
  try { await firstRes.text(); } catch { /* drain */ }
  assert(firstRes.status === 204, `First DELETE returned 204 (got ${firstRes.status})`);

  const afterFirst = await deleteAuditEntriesForBill(bill.id);
  assert(afterFirst.length === 1, `Exactly one audit entry after the first (successful) delete (got ${afterFirst.length})`);

  // Second deletion of the same now-gone id — the row lock returns null.
  const secondRes = await apiReq(`/purchase-bills/${bill.id}`, { method: "DELETE" });
  try { await secondRes.text(); } catch { /* drain */ }
  assert(secondRes.status === 404, `Second DELETE of a gone bill returns 404 (got ${secondRes.status})`);

  // Audit count must still be exactly one.
  const afterSecond = await deleteAuditEntriesForBill(bill.id);
  assert(
    afterSecond.length === 1,
    `Still exactly one audit entry after the failed second delete (got ${afterSecond.length}) — no orphan row written`,
  );
}

// ── Test C: concurrent deletes of the SAME bill → one audit entry, not two ───

/**
 * Fire two concurrent DELETE requests for the same bill.  The SELECT … FOR UPDATE
 * row lock inside the transaction serialises the two at the DB level:
 *  - The first to acquire the lock commits: bill gone, one audit entry.
 *  - The second acquires the lock after the commit, finds no row, exits early.
 *
 * Invariants:
 *  1. Status codes are {204, 404} — one each, order undefined.
 *  2. Exactly ONE delete audit entry exists for the bill ID afterwards.
 */
async function testC_ConcurrentDeletesSameBillProduceExactlyOneAuditEntry(): Promise<void> {
  console.log("\nTest C: Two concurrent DELETEs race for the same bill — exactly one audit entry is written");

  const bill = await createTestBill("C");
  console.log(`  Created bill id=${bill.id} (${bill.billNo})`);

  const before = await deleteAuditEntriesForBill(bill.id);
  assert(before.length === 0, `No delete audit entries before the race (got ${before.length})`);

  // Fire both DELETE requests at the same time.
  const [r1, r2] = await Promise.all([
    apiReq(`/purchase-bills/${bill.id}`, { method: "DELETE" }).then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
    apiReq(`/purchase-bills/${bill.id}`, { method: "DELETE" }).then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
  ]);

  const statuses = [r1, r2].sort();
  assert(
    statuses[0] === 204 && statuses[1] === 404,
    `One 204 and one 404 — got ${r1} and ${r2}`,
  );

  // Brief pause to let both DB transactions fully commit before reading the log.
  await new Promise<void>((resolve) => setTimeout(resolve, 200));

  const after = await deleteAuditEntriesForBill(bill.id);
  assert(
    after.length === 1,
    `Exactly one delete audit entry written after the race (got ${after.length}) — concurrent loser must not produce an orphan row`,
  );
}

// ── Test D: concurrent deletes of DISTINCT bills → both audit entries land ────

/**
 * This is the core test for the concurrent-delete scenario described in the
 * task: two admins delete different purchase bills at the same moment.
 *
 * Each request runs in its own DB transaction.  Because the bills are on
 * different primary-key rows there is no row-lock contention between them —
 * both transactions proceed in parallel, each atomically deleting its bill and
 * writing its audit entry.
 *
 * The only way an audit entry could be lost is if the audit insert is outside
 * the transaction (Test E rules that out statically).  This runtime test
 * confirms the end-to-end behaviour: after the concurrent race, the audit log
 * contains exactly one "delete" entry for bill A AND one for bill B.
 */
async function testD_ConcurrentDeletesDistinctBillsBothAuditEntriesLand(): Promise<void> {
  console.log("\nTest D: Two concurrent DELETEs of DISTINCT bills — both audit entries must be present");

  const billA = await createTestBill("D-A");
  const billB = await createTestBill("D-B");
  console.log(`  Created bill A id=${billA.id} (${billA.billNo})`);
  console.log(`  Created bill B id=${billB.id} (${billB.billNo})`);

  // Confirm no pre-existing delete entries for either brand-new bill.
  const beforeA = await deleteAuditEntriesForBill(billA.id);
  const beforeB = await deleteAuditEntriesForBill(billB.id);
  assert(beforeA.length === 0, `No delete audit entries for bill A before the race (got ${beforeA.length})`);
  assert(beforeB.length === 0, `No delete audit entries for bill B before the race (got ${beforeB.length})`);

  // Fire both DELETEs concurrently.
  const [statusA, statusB] = await Promise.all([
    apiReq(`/purchase-bills/${billA.id}`, { method: "DELETE" }).then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
    apiReq(`/purchase-bills/${billB.id}`, { method: "DELETE" }).then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
  ]);

  // Both distinct bills must be successfully deleted.
  assert(statusA === 204, `DELETE of bill A returned 204 (got ${statusA})`);
  assert(statusB === 204, `DELETE of bill B returned 204 (got ${statusB})`);

  // Both bills must be gone.
  const checkA = await apiReq(`/purchase-bills/${billA.id}`);
  const checkB = await apiReq(`/purchase-bills/${billB.id}`);
  assert(checkA.status === 404, `Bill A is gone after concurrent delete (got ${checkA.status})`);
  assert(checkB.status === 404, `Bill B is gone after concurrent delete (got ${checkB.status})`);

  // Brief pause to let both DB transactions fully commit before reading the log.
  await new Promise<void>((resolve) => setTimeout(resolve, 200));

  // The critical assertions: the audit log must contain exactly one entry for
  // each bill.  A missing entry means the concurrent delete silently swallowed
  // one audit row — the bug this test exists to catch.
  const afterA = await deleteAuditEntriesForBill(billA.id);
  const afterB = await deleteAuditEntriesForBill(billB.id);

  assert(
    afterA.length === 1,
    `Exactly one delete audit entry for bill A after the concurrent race (got ${afterA.length}) — concurrent delete must not silently drop the audit entry`,
  );
  assert(
    afterB.length === 1,
    `Exactly one delete audit entry for bill B after the concurrent race (got ${afterB.length}) — concurrent delete must not silently drop the audit entry`,
  );

  // Shape checks for both entries.
  if (afterA.length >= 1) {
    const entryA = afterA[0]!;
    assert(entryA.entityType === "purchase_bill", `Bill A entry: entityType is "purchase_bill" (got "${entryA.entityType}")`);
    assert(entryA.action === "delete", `Bill A entry: action is "delete" (got "${entryA.action}")`);
    assert(entryA.entityId === billA.id, `Bill A entry: entityId matches ${billA.id} (got ${entryA.entityId})`);
  }
  if (afterB.length >= 1) {
    const entryB = afterB[0]!;
    assert(entryB.entityType === "purchase_bill", `Bill B entry: entityType is "purchase_bill" (got "${entryB.entityType}")`);
    assert(entryB.action === "delete", `Bill B entry: action is "delete" (got "${entryB.action}")`);
    assert(entryB.entityId === billB.id, `Bill B entry: entityId matches ${billB.id} (got ${entryB.entityId})`);
  }

  console.log("  (Both audit entries landed — concurrent deletes of distinct bills cannot silently drop either entry)");
}

// ── Test E: static source-code check — audit insert is inside the transaction ─

/**
 * Read the actual source file and verify the DELETE handler's audit insert is
 * inside db.transaction(), not after it.
 *
 * Motivation: Tests A–D confirm the correct runtime behaviour, but they cannot
 * detect a refactor that moves the audit insert outside the transaction.  If
 * that happened, a server restart between the COMMIT and the rogue db.insert
 * would leave the bill deleted with no audit trace — a silent data-loss bug
 * that only manifests under crash conditions, not in normal test runs.
 *
 * Assertions:
 *   1. DELETE /purchase-bills/:id handler exists in purchase-bills.ts.
 *   2. Its body does not extend into the PATCH handler (correct bounding).
 *   3. A db.transaction(async (tx) => ...) block exists inside the handler.
 *   4. tx.insert(auditLogTable) appears inside the transaction body.
 *   5. db.insert(auditLogTable) does NOT appear inside the transaction body.
 *   6. db.insert(auditLogTable) does NOT appear in the handler after the
 *      transaction — nothing dangerous outside the atomic unit.
 *   7. action: "delete" is present in the transaction body.
 *
 * Mutation guard: synthesises a broken handler (tx.insert moved to db.insert
 * after the transaction) and asserts the same checks FAIL — proves the
 * assertions are load-bearing.
 */

function extractHandler(source: string, handlerMarker: string): string | null {
  const start = source.indexOf(handlerMarker);
  if (start === -1) return null;
  const tail = source.slice(start);
  const nextHandler = tail.slice(handlerMarker.length).search(
    /router\.(get|post|put|patch|delete|use)\s*\(/,
  );
  return nextHandler === -1
    ? tail
    : tail.slice(0, handlerMarker.length + nextHandler);
}

function extractTransactionBody(scope: string): string | null {
  const txStart = scope.indexOf("db.transaction(async (tx) =>");
  if (txStart === -1) return null;
  const openBrace = scope.indexOf("{", txStart);
  if (openBrace === -1) return null;
  let depth = 0;
  for (let i = openBrace; i < scope.length; i++) {
    const ch = scope[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return scope.slice(openBrace, i + 1); }
  }
  return null;
}

function afterTransactionIn(handlerSource: string, transactionBody: string): string {
  const idx = handlerSource.indexOf(transactionBody);
  if (idx === -1) return "";
  return handlerSource.slice(idx + transactionBody.length);
}

async function testE_StaticAuditInsertIsInsideTransaction(source: string): Promise<void> {
  console.log("\nTest E: Source-code verification — audit insert is inside the DB transaction (crash-safety)");

  // ── Bound the DELETE handler ──────────────────────────────────────────────
  const deleteHandler = extractHandler(source, 'router.delete("/purchase-bills/:id"');
  assert(deleteHandler !== null, 'DELETE /purchase-bills/:id handler found in purchase-bills.ts');
  if (deleteHandler === null) return;

  assert(
    !deleteHandler.includes('router.patch("/purchase-bills/:id/payment-status"'),
    'Bounded DELETE handler body does not extend into the PATCH handler',
  );

  // ── Extract the transaction block ─────────────────────────────────────────
  const transactionBody = extractTransactionBody(deleteHandler);
  assert(transactionBody !== null, 'DELETE handler wraps its work in db.transaction(async (tx) => ...)');
  if (transactionBody === null) return;

  // ── Core atomicity assertions ─────────────────────────────────────────────
  assert(
    transactionBody.includes("tx.insert(auditLogTable)"),
    'audit insert uses tx.insert(auditLogTable) inside the transaction body — atomicity guaranteed',
  );
  assert(
    !transactionBody.includes("db.insert(auditLogTable)"),
    'No db.insert(auditLogTable) inside the transaction body (would bypass tx isolation)',
  );
  assert(
    transactionBody.includes('action: "delete"'),
    'Transaction body contains action: "delete" — audit records the correct action',
  );

  // ── Nothing dangerous after the transaction ───────────────────────────────
  const tail = afterTransactionIn(deleteHandler, transactionBody);
  assert(
    !tail.includes("db.insert(auditLogTable)"),
    'No db.insert(auditLogTable) after the transaction block — crash-safe',
  );

  // ── Mutation guard: broken source must fail the above checks ──────────────
  console.log("  (Running mutation guard — verifying assertions are load-bearing)");

  const txInsertIdx = transactionBody.indexOf("await tx.insert(auditLogTable)");
  if (txInsertIdx === -1) {
    assert(false, "Mutation guard: could not locate tx.insert(auditLogTable) in transaction body");
    return;
  }
  const txInsertEnd = transactionBody.indexOf(");", txInsertIdx);
  if (txInsertEnd === -1) {
    assert(false, "Mutation guard: could not find end of tx.insert statement");
    return;
  }

  const mutatedTxBody = transactionBody.slice(0, txInsertIdx) +
    "/* audit insert removed */" +
    transactionBody.slice(txInsertEnd + 2);
  const mutatedHandler = deleteHandler.replace(transactionBody, mutatedTxBody) +
    '\n  await db.insert(auditLogTable).values({ action: "delete" });\n';

  const mutatedTxExtracted = extractTransactionBody(mutatedHandler);
  const hasTxInside = mutatedTxExtracted?.includes("tx.insert(auditLogTable)") ?? false;
  const hasDbInside = mutatedTxExtracted?.includes("db.insert(auditLogTable)") ?? false;
  const mutatedTail = mutatedTxExtracted ? afterTransactionIn(mutatedHandler, mutatedTxExtracted) : mutatedHandler;
  const hasDbAfter = mutatedTail.includes("db.insert(auditLogTable)");

  assertNot(hasTxInside, "Mutation guard: tx.insert correctly absent from broken transaction body");
  assertNot(!hasDbInside && !hasDbAfter, "Mutation guard: db.insert correctly detected in broken source");
  assert(hasDbAfter, "Mutation guard: db.insert correctly detected after transaction in broken source");

  console.log("  (Mutation guard complete — static checks are load-bearing)");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n━━━ Purchase-bill delete audit tests ━━━");
  console.log(`API base: ${BASE}`);
  console.log("  Tests A–D: runtime integration (require live server)");
  console.log("  Test E:    static source-code verification (no server needed)");

  await login();

  await ensureRegistryProvisioned();
  const recovery = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  if (recovery.claimedRunIds.length > 0) console.log(`  ✓ Recovered ${recovery.deleted} abandoned registered fixture(s) from ${recovery.claimedRunIds.length} prior run(s)${recovery.kept > 0 ? ` (${recovery.kept} kept)` : ""}`);
  suiteRunId = await startSuiteRun("bill-delete-audit", adminUserId);

  let suiteSucceeded = false;
  try {
    await testA_SingleDeleteWritesAuditEntry();
    await testB_FailedDeletionLeavesNoOrphanAuditEntry();
    await testC_ConcurrentDeletesSameBillProduceExactlyOneAuditEntry();
    await testD_ConcurrentDeletesDistinctBillsBothAuditEntriesLand();

    // Static check — load the source file from the working directory.
    const { readFile } = await import("node:fs/promises");
    const { resolve }  = await import("node:path");
    const routeFile = resolve(process.cwd(), "src/routes/purchase-bills.ts");
    let source: string;
    try {
      source = await readFile(routeFile, "utf-8");
    } catch (err) {
      assert(false, `Could not read purchase-bills.ts (${routeFile}): ${err}`);
      console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
      process.exitCode = 1;
      return;
    }
    await testE_StaticAuditInsertIsInsideTransaction(source);

    console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
    if (failed > 0) process.exitCode = 1;
    else suiteSucceeded = true;
  } finally {
    const finalized = await finalizeSuiteRun(suiteRunId, suiteSucceeded);
    if (!finalized.cleaned) console.warn(`Retaining suite run registry for later recovery (${finalized.remainingFixtures} registered fixture(s) still present).`);
    await pool.end().catch(() => {});
  }
}

main().catch(async (err) => {
  console.error("\nUnhandled error:", err);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
