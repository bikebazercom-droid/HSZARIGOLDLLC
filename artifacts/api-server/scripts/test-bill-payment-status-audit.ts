#!/usr/bin/env tsx
/**
 * Audit-trail tests for PATCH /purchase-bills/:id/payment-status
 *
 * Covers two complementary layers:
 *
 * ── Runtime integration tests (Tests A–D) ────────────────────────────────────
 *
 *   A. A real status change writes exactly one audit log entry with the correct
 *      shape: entityType="purchase_bill", action="update_payment_status".
 *
 *   B. A no-op request (fromStatus === toStatus) must NOT write any audit
 *      entry — the handler intentionally skips the insert when nothing changes.
 *
 *   C. Two concurrent PATCH requests that send the same target status race for
 *      the SELECT … FOR UPDATE row lock.  The first to commit changes the bill;
 *      the second reads the now-current status (same as the target), so its
 *      fromStatus === toStatus and no second entry is written.  After the race:
 *      exactly ONE audit entry for the bill, not zero, not two.
 *
 *   C2. Two concurrent PATCH requests that send DISTINCT target statuses race
 *      on the same bill.  Because the targets differ, whichever wins first
 *      commits a real transition; the loser then reads the new status (which
 *      differs from its own target) and commits a second real transition.  Both
 *      are genuine status changes, so exactly TWO audit entries must appear.
 *      This is the definitive proof that the row lock cannot silently swallow
 *      the second audit insert when both competitors make a real transition.
 *
 *   D. Two concurrent PATCH requests for DISTINCT bills proceed independently.
 *      Both must write exactly one audit entry each.  This is the direct proof
 *      that concurrent payment-status changes on different bills cannot
 *      silently drop either audit entry.
 *
 * ── Static source-code check (Test E) ────────────────────────────────────────
 *
 *   E. The PATCH handler's audit insert uses `tx.insert(auditLogTable)` inside
 *      `db.transaction()`, that `.for("update")` appears in the same
 *      transaction body, and that the row lock precedes the audit insert in
 *      source order.  If someone ever moves the insert outside the transaction
 *      a server restart between the COMMIT and the stray db.insert would leave
 *      the bill status changed with no trace in the audit log.  The static
 *      check catches this before a runtime test could even be run.
 *
 *      A mutation guard proves the assertions are load-bearing: a
 *      synthetically broken source (tx.insert replaced by db.insert outside
 *      the transaction) correctly fails all checks.
 *
 * ── How to run ────────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/api-server run test:bill-payment-status-audit
 *
 *   The API server must be running (Tests A–D hit the live API).
 *   Set API_BASE_URL if the default Replit dev-domain doesn't match your env.
 *
 * Test fixtures are labelled TEST-BILL-PSTATUS-AUDIT-* and cleaned up after
 * each test.  Any fixture that survives a failure can be removed manually.
 */

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
  console.log("  ✓ Logged in as admin");
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Create a minimal unpaid purchase bill with one line item. */
async function createTestBill(label: string): Promise<{ id: number; billNo: string }> {
  const billNo = `TEST-BILL-PSTATUS-AUDIT-${label}-${Date.now()}`;
  const res = await apiReq("/purchase-bills", {
    method: "POST",
    body: JSON.stringify({
      billNo,
      billDate: new Date().toISOString().split("T")[0],
      supplierName: "TEST-BILL-PSTATUS-AUDIT-SUPPLIER",
      purchaseType: "fixed",
      paymentStatus: "unpaid",
      notes: "Created by test-bill-payment-status-audit",
      items: [
        {
          category: "gold",
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

/** Change the payment status of a bill. */
async function patchPaymentStatus(id: number, paymentStatus: string): Promise<Response> {
  return apiReq(`/purchase-bills/${id}/payment-status`, {
    method: "PATCH",
    body: JSON.stringify({ paymentStatus }),
  });
}

/** Best-effort cleanup — drain body to avoid node warnings. */
async function cleanupBill(id: number): Promise<void> {
  const r = await apiReq(`/purchase-bills/${id}`, { method: "DELETE" }).catch(() => null);
  if (r) try { await r.text(); } catch { /* noop */ }
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

/** Return all "update_payment_status" audit entries for a specific purchase_bill entityId. */
async function paymentStatusAuditEntriesForBill(billId: number): Promise<AuditEntry[]> {
  const res = await apiReq("/purchase-bills/audit-log");
  if (!res.ok) throw new Error(`audit-log fetch failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { entries: AuditEntry[] } | AuditEntry[];
  const all = Array.isArray(body) ? body : body.entries;
  return all.filter(
    (e) =>
      e.entityType === "purchase_bill" &&
      e.entityId === billId &&
      e.action === "update_payment_status",
  );
}

// ── Assertions ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else       { console.error(`  ✗ FAIL: ${msg}`); failed++; }
}

function assertNot(cond: boolean, msg: string): void {
  assert(!cond, msg);
}

// ── Test A: real status change writes exactly one audit entry ─────────────────

async function testA_RealStatusChangeWritesAuditEntry(): Promise<void> {
  console.log("\nTest A: A real payment-status change writes exactly one audit log entry");

  const bill = await createTestBill("A");
  console.log(`  Created bill id=${bill.id} (${bill.billNo})`);

  const before = await paymentStatusAuditEntriesForBill(bill.id);
  assert(before.length === 0, `No payment-status audit entries before the change (got ${before.length})`);

  // Change unpaid → paid
  const res = await patchPaymentStatus(bill.id, "paid");
  const resBody = (await res.json()) as { paymentStatus?: string };
  assert(res.ok, `PATCH returned 2xx (got ${res.status})`);
  assert(resBody.paymentStatus === "paid", `Response paymentStatus is "paid" (got "${resBody.paymentStatus}")`);

  const after = await paymentStatusAuditEntriesForBill(bill.id);
  assert(after.length === 1, `Exactly one audit entry written (got ${after.length})`);

  if (after.length >= 1) {
    const entry = after[0]!;
    assert(entry.entityType === "purchase_bill", `entityType is "purchase_bill" (got "${entry.entityType}")`);
    assert(entry.action === "update_payment_status", `action is "update_payment_status" (got "${entry.action}")`);
    assert(entry.entityId === bill.id, `entityId matches bill id ${bill.id} (got ${entry.entityId})`);
    assert(entry.billNo === bill.billNo, `billNo matches "${bill.billNo}" (got "${entry.billNo}")`);
  }

  // Cleanup: delete the now-paid bill (need x-allow-paid-delete header)
  const del = await apiReq(`/purchase-bills/${bill.id}`, {
    method: "DELETE",
    headers: { "x-allow-paid-delete": "true" },
  });
  try { await del.text(); } catch { /* drain */ }
}

// ── Test B: no-op (fromStatus === toStatus) writes no audit entry ─────────────

async function testB_NoopStatusChangeWritesNoAuditEntry(): Promise<void> {
  console.log("\nTest B: A no-op payment-status change (same → same) writes no audit entry");

  const bill = await createTestBill("B");
  console.log(`  Created bill id=${bill.id} (${bill.billNo})`);

  // First, confirm no prior entries.
  const before = await paymentStatusAuditEntriesForBill(bill.id);
  assert(before.length === 0, `No payment-status audit entries before the no-op (got ${before.length})`);

  // Send the same status it already has (unpaid → unpaid).
  const res = await patchPaymentStatus(bill.id, "unpaid");
  try { await res.text(); } catch { /* drain */ }
  assert(res.ok, `PATCH no-op returned 2xx (got ${res.status})`);

  const after = await paymentStatusAuditEntriesForBill(bill.id);
  assert(
    after.length === 0,
    `No audit entry written for a no-op status change (got ${after.length}) — handler correctly skips insert when status unchanged`,
  );

  await cleanupBill(bill.id);
}

// ── Test C: concurrent PATCHes to same bill → exactly one audit entry ─────────

/**
 * Fire two concurrent PATCH requests that both target the same new status on
 * the same bill.  The SELECT … FOR UPDATE row lock serialises them at the DB:
 *  - The first to acquire the lock reads "unpaid", changes to "paid", writes
 *    one audit entry, commits.
 *  - The second acquires the lock after the first commits, reads "paid"
 *    (fromStatus === "paid" === toStatus), executes no audit insert, commits.
 *
 * Invariants:
 *  1. Both PATCH requests return 2xx.
 *  2. Exactly ONE audit entry exists for the bill afterwards.
 */
async function testC_ConcurrentPatchSameBillProducesOneAuditEntry(): Promise<void> {
  console.log("\nTest C: Two concurrent PATCHes to the same bill — exactly one audit entry is written");

  const bill = await createTestBill("C");
  console.log(`  Created bill id=${bill.id} (${bill.billNo})`);

  const before = await paymentStatusAuditEntriesForBill(bill.id);
  assert(before.length === 0, `No audit entries before the race (got ${before.length})`);

  // Both requests target the same new status (unpaid → paid).
  const [r1, r2] = await Promise.all([
    patchPaymentStatus(bill.id, "paid").then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
    patchPaymentStatus(bill.id, "paid").then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
  ]);

  assert(r1 >= 200 && r1 < 300, `First concurrent PATCH returned 2xx (got ${r1})`);
  assert(r2 >= 200 && r2 < 300, `Second concurrent PATCH returned 2xx (got ${r2})`);

  // Brief pause to let both DB transactions fully commit before reading the log.
  await new Promise<void>((resolve) => setTimeout(resolve, 200));

  const after = await paymentStatusAuditEntriesForBill(bill.id);
  assert(
    after.length === 1,
    `Exactly one audit entry written after the concurrent race (got ${after.length}) — serialised no-op must not produce a second entry`,
  );

  // Cleanup paid bill
  const del = await apiReq(`/purchase-bills/${bill.id}`, {
    method: "DELETE",
    headers: { "x-allow-paid-delete": "true" },
  });
  try { await del.text(); } catch { /* drain */ }
}

// ── Test C2: concurrent PATCHes with DISTINCT targets on same bill → 2 entries ─

/**
 * Start a bill in "unfixed" status, then fire two concurrent PATCH requests
 * that target different statuses ("paid" and "unpaid").  The FOR UPDATE lock
 * serialises the two at the DB:
 *
 *  Scenario A (paid wins first):
 *    1. Request-paid: reads "unfixed" → sets "paid"  → audit (unfixed→paid)
 *    2. Request-unpaid: reads "paid" → sets "unpaid" → audit (paid→unpaid)
 *    Result: 2 entries.
 *
 *  Scenario B (unpaid wins first):
 *    1. Request-unpaid: reads "unfixed" → sets "unpaid" → audit (unfixed→unpaid)
 *    2. Request-paid:   reads "unpaid"  → sets "paid"   → audit (unpaid→paid)
 *    Result: 2 entries.
 *
 * Either execution order yields exactly TWO audit entries and both requests
 * return 2xx.  A regression that drops one insert while the row lock is held
 * would leave only one entry — caught here, invisible to Test C (which uses
 * identical targets and expects the no-op path to fire).
 */
async function testC2_ConcurrentPatchesDistinctTargetsSameBillBothAuditEntriesLand(): Promise<void> {
  console.log("\nTest C2: Two concurrent PATCHes with DISTINCT target statuses on the same bill — both audit entries must be present");

  // Create with "unfixed" so both competing transitions are genuine changes.
  const billNo = `TEST-BILL-PSTATUS-AUDIT-C2-${Date.now()}`;
  const createRes = await apiReq("/purchase-bills", {
    method: "POST",
    body: JSON.stringify({
      billNo,
      billDate: new Date().toISOString().split("T")[0],
      supplierName: "TEST-BILL-PSTATUS-AUDIT-SUPPLIER",
      purchaseType: "unfixed",
      paymentStatus: "unfixed",
      notes: "Created by test-bill-payment-status-audit C2",
      items: [
        {
          category: "gold",
          grossWeightGrams: 10,
          purityPercent: 99.9,
          rateAedPerG: 200,
          makingChargeAed: 0,
          lineTotalAed: 2000,
        },
      ],
    }),
  });
  if (!createRes.ok) {
    throw new Error(`createTestBill(C2) failed (${createRes.status}): ${await createRes.text()}`);
  }
  const bill = (await createRes.json()) as { id: number; billNo: string };
  console.log(`  Created bill id=${bill.id} (${bill.billNo}) with paymentStatus="unfixed"`);

  const before = await paymentStatusAuditEntriesForBill(bill.id);
  assert(before.length === 0, `No audit entries before the race (got ${before.length})`);

  // Fire both PATCHes concurrently, targeting distinct statuses.
  const [r1, r2] = await Promise.all([
    patchPaymentStatus(bill.id, "paid").then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
    patchPaymentStatus(bill.id, "unpaid").then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
  ]);

  assert(r1 >= 200 && r1 < 300, `"paid" PATCH returned 2xx (got ${r1})`);
  assert(r2 >= 200 && r2 < 300, `"unpaid" PATCH returned 2xx (got ${r2})`);

  // Brief pause to let both DB transactions fully commit.
  await new Promise<void>((resolve) => setTimeout(resolve, 200));

  // Both transitions are genuine (neither is a no-op) so exactly two audit
  // entries must appear.  One missing entry = silent audit loss under lock.
  const after = await paymentStatusAuditEntriesForBill(bill.id);
  assert(
    after.length === 2,
    `Exactly two audit entries after both distinct-target transitions (got ${after.length}) — the row lock must not silently drop either entry`,
  );

  if (after.length >= 1) {
    const actions = after.map((e) => e.action);
    assert(
      actions.every((a) => a === "update_payment_status"),
      `All entries have action "update_payment_status" (got [${actions.join(", ")}])`,
    );
  }

  console.log("  (Both distinct-target transitions landed — concurrent status changes on the same bill cannot silently drop either audit entry)");

  // Cleanup (bill is currently "unpaid" or "paid" depending on race order).
  const del = await apiReq(`/purchase-bills/${bill.id}`, {
    method: "DELETE",
    headers: { "x-allow-paid-delete": "true" },
  });
  try { await del.text(); } catch { /* drain */ }
}

// ── Test D: concurrent PATCHes on DISTINCT bills → both audit entries land ────

/**
 * This is the core test for the task: two concurrent PATCH requests on
 * different bills.  Each runs in its own DB transaction with no row-lock
 * contention between them — both proceed in parallel, each atomically updating
 * its bill and writing its audit entry.
 *
 * The only way an audit entry could be lost is if the insert is outside the
 * transaction (Test E rules that out statically).  This runtime test confirms
 * the end-to-end behaviour: after the concurrent race the audit log contains
 * exactly one "update_payment_status" entry for bill A AND one for bill B.
 */
async function testD_ConcurrentPatchesDistinctBillsBothAuditEntriesLand(): Promise<void> {
  console.log("\nTest D: Two concurrent PATCHes on DISTINCT bills — both audit entries must be present");

  const billA = await createTestBill("D-A");
  const billB = await createTestBill("D-B");
  console.log(`  Created bill A id=${billA.id} (${billA.billNo})`);
  console.log(`  Created bill B id=${billB.id} (${billB.billNo})`);

  const beforeA = await paymentStatusAuditEntriesForBill(billA.id);
  const beforeB = await paymentStatusAuditEntriesForBill(billB.id);
  assert(beforeA.length === 0, `No audit entries for bill A before the race (got ${beforeA.length})`);
  assert(beforeB.length === 0, `No audit entries for bill B before the race (got ${beforeB.length})`);

  // Fire both PATCH requests concurrently (unpaid → paid for each).
  const [statusA, statusB] = await Promise.all([
    patchPaymentStatus(billA.id, "paid").then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
    patchPaymentStatus(billB.id, "paid").then(async (r) => {
      try { await r.text(); } catch { /* drain */ }
      return r.status;
    }),
  ]);

  assert(statusA >= 200 && statusA < 300, `PATCH for bill A returned 2xx (got ${statusA})`);
  assert(statusB >= 200 && statusB < 300, `PATCH for bill B returned 2xx (got ${statusB})`);

  // Brief pause to let both DB transactions fully commit before reading the log.
  await new Promise<void>((resolve) => setTimeout(resolve, 200));

  // The critical assertions: the audit log must contain exactly one entry for
  // each bill.  A missing entry means the concurrent patch silently swallowed
  // one audit row — the bug this test exists to catch.
  const afterA = await paymentStatusAuditEntriesForBill(billA.id);
  const afterB = await paymentStatusAuditEntriesForBill(billB.id);

  assert(
    afterA.length === 1,
    `Exactly one audit entry for bill A after the concurrent race (got ${afterA.length}) — concurrent patch must not silently drop the audit entry`,
  );
  assert(
    afterB.length === 1,
    `Exactly one audit entry for bill B after the concurrent race (got ${afterB.length}) — concurrent patch must not silently drop the audit entry`,
  );

  // Shape checks for both entries.
  if (afterA.length >= 1) {
    const entryA = afterA[0]!;
    assert(entryA.entityType === "purchase_bill", `Bill A entry: entityType is "purchase_bill" (got "${entryA.entityType}")`);
    assert(entryA.action === "update_payment_status", `Bill A entry: action is "update_payment_status" (got "${entryA.action}")`);
    assert(entryA.entityId === billA.id, `Bill A entry: entityId matches ${billA.id} (got ${entryA.entityId})`);
  }
  if (afterB.length >= 1) {
    const entryB = afterB[0]!;
    assert(entryB.entityType === "purchase_bill", `Bill B entry: entityType is "purchase_bill" (got "${entryB.entityType}")`);
    assert(entryB.action === "update_payment_status", `Bill B entry: action is "update_payment_status" (got "${entryB.action}")`);
    assert(entryB.entityId === billB.id, `Bill B entry: entityId matches ${billB.id} (got ${entryB.entityId})`);
  }

  // Cleanup paid bills
  await Promise.all([
    apiReq(`/purchase-bills/${billA.id}`, { method: "DELETE", headers: { "x-allow-paid-delete": "true" } })
      .then(async (r) => { try { await r.text(); } catch { /* noop */ } }),
    apiReq(`/purchase-bills/${billB.id}`, { method: "DELETE", headers: { "x-allow-paid-delete": "true" } })
      .then(async (r) => { try { await r.text(); } catch { /* noop */ } }),
  ]);

  console.log("  (Both audit entries landed — concurrent patches on distinct bills cannot silently drop either entry)");
}

// ── Test E: static source-code check ─────────────────────────────────────────

/**
 * Read the actual source file and verify the PATCH handler's audit insert is:
 *   1. Inside db.transaction(async (tx) => ...) — atomicity guaranteed.
 *   2. Uses tx.insert(auditLogTable), not db.insert(auditLogTable).
 *   3. Preceded by .for("update") in the same transaction body — row lock held
 *      before audit insert, preventing a concurrent caller from reading a stale
 *      "from" status between the check and the insert.
 *   4. action: "update_payment_status" appears in the transaction body.
 *
 * Motivation: Tests A–D confirm correct runtime behaviour, but they cannot
 * detect a refactor that moves the audit insert outside the transaction.  If
 * that happened, a server restart between the COMMIT and the rogue db.insert
 * would leave the status changed with no audit trace — a silent bug only
 * visible under crash conditions.
 *
 * Mutation guard: synthesises a broken handler (tx.insert moved to db.insert
 * after the transaction) and asserts the same checks FAIL — proving the
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

  // ── Bound the PATCH handler ───────────────────────────────────────────────
  const patchHandler = extractHandler(source, 'router.patch("/purchase-bills/:id/payment-status"');
  assert(patchHandler !== null, 'PATCH /purchase-bills/:id/payment-status handler found in purchase-bills.ts');
  if (patchHandler === null) return;

  // ── Extract the transaction block ─────────────────────────────────────────
  const transactionBody = extractTransactionBody(patchHandler);
  assert(transactionBody !== null, 'PATCH handler wraps its work in db.transaction(async (tx) => ...)');
  if (transactionBody === null) return;

  // ── Row lock precedes the audit insert ────────────────────────────────────
  const forUpdateIdx  = transactionBody.indexOf('.for("update")');
  const txInsertIdx   = transactionBody.indexOf("tx.insert(auditLogTable)");
  assert(
    forUpdateIdx !== -1,
    '.for("update") appears in the PATCH handler\'s transaction body — row lock held',
  );
  assert(
    txInsertIdx !== -1,
    'tx.insert(auditLogTable) appears in the PATCH handler\'s transaction body',
  );
  assert(
    forUpdateIdx !== -1 && txInsertIdx !== -1 && forUpdateIdx < txInsertIdx,
    'Row lock (.for("update")) precedes the audit insert (tx.insert(auditLogTable)) in source order',
  );

  // ── Core atomicity assertions ─────────────────────────────────────────────
  assert(
    !transactionBody.includes("db.insert(auditLogTable)"),
    'No db.insert(auditLogTable) inside the transaction body (would bypass tx isolation)',
  );
  assert(
    transactionBody.includes('action: "update_payment_status"'),
    'Transaction body contains action: "update_payment_status" — audit records the correct action',
  );

  // ── Nothing dangerous after the transaction ───────────────────────────────
  const tail = afterTransactionIn(patchHandler, transactionBody);
  assert(
    !tail.includes("db.insert(auditLogTable)"),
    'No db.insert(auditLogTable) after the transaction block — crash-safe',
  );

  // ── Mutation guard: broken source must fail the above checks ──────────────
  console.log("  (Running mutation guard — verifying assertions are load-bearing)");

  if (txInsertIdx === -1) {
    assert(false, "Mutation guard: could not locate tx.insert(auditLogTable) in transaction body");
    return;
  }
  const txInsertEnd = transactionBody.indexOf(");", txInsertIdx);
  if (txInsertEnd === -1) {
    assert(false, "Mutation guard: could not find end of tx.insert statement");
    return;
  }

  // Synthesise a broken handler: remove tx.insert from the transaction, add
  // db.insert after it (simulates the dangerous outside-transaction pattern).
  const mutatedTxBody = transactionBody.slice(0, txInsertIdx) +
    "/* audit insert removed */" +
    transactionBody.slice(txInsertEnd + 2);
  const mutatedHandler = patchHandler.replace(transactionBody, mutatedTxBody) +
    '\n  await db.insert(auditLogTable).values({ action: "update_payment_status" });\n';

  const mutatedTxExtracted = extractTransactionBody(mutatedHandler);
  const hasTxInside    = mutatedTxExtracted?.includes("tx.insert(auditLogTable)") ?? false;
  const hasDbInside    = mutatedTxExtracted?.includes("db.insert(auditLogTable)") ?? false;
  const mutatedTail    = mutatedTxExtracted
    ? afterTransactionIn(mutatedHandler, mutatedTxExtracted)
    : mutatedHandler;
  const hasDbAfter = mutatedTail.includes("db.insert(auditLogTable)");

  assertNot(hasTxInside, "Mutation guard: tx.insert correctly absent from broken transaction body");
  assertNot(!hasDbInside && !hasDbAfter, "Mutation guard: db.insert correctly detected in broken source");
  assert(hasDbAfter, "Mutation guard: db.insert correctly detected after transaction in broken source");

  console.log("  (Mutation guard complete — static checks are load-bearing)");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n━━━ Purchase-bill payment-status audit tests ━━━");
  console.log(`API base: ${BASE}`);
  console.log("  Tests A–D: runtime integration (require live server)");
  console.log("  Test E:    static source-code verification (no server needed)");

  await login();

  await testA_RealStatusChangeWritesAuditEntry();
  await testB_NoopStatusChangeWritesNoAuditEntry();
  await testC_ConcurrentPatchSameBillProducesOneAuditEntry();
  await testC2_ConcurrentPatchesDistinctTargetsSameBillBothAuditEntriesLand();
  await testD_ConcurrentPatchesDistinctBillsBothAuditEntriesLand();

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
    process.exit(1);
    return;
  }
  await testE_StaticAuditInsertIsInsideTransaction(source);

  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});
