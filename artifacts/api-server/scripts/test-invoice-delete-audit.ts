#!/usr/bin/env tsx
/**
 * Integration test: audit trail is always written when an invoice is deleted
 *
 * Covers two scenarios required by Task #44:
 *
 *   1. DELETE a PENDING invoice → exactly one audit_log row with
 *      entityType "invoice", action "delete", entityId matching the invoice.
 *
 *   2. DELETE a PAID (non-pending) invoice using the unlock header → exactly
 *      one audit_log row with the same shape.
 *
 * Both paths share the same DELETE handler but differ in the isPending guard
 * check. The test ensures the audit insert inside the transaction fires for
 * both code-paths.
 *
 * ── How to run ────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/api-server run test:invoice-delete-audit
 *
 *   The API server must be running. Set API_BASE_URL if the default
 *   (Replit dev-domain or http://localhost:$PORT/api) doesn't match your
 *   environment.
 *
 * The script logs in as the seeded admin, creates short-lived test invoices,
 * deletes them, and verifies audit entries. Label prefix TEST-DELETE-AUDIT-*
 * marks any fixture that survives a failure for manual cleanup.
 */

import { db, pool } from "@workspace/db";
import {
  ensureRegistryProvisioned,
  finalizeSuiteRun,
  recoverAbandonedSuiteRuns,
  startSuiteRun,
  unregisterSuiteFixture,
  type SuiteEntityType,
} from "./suite-run-registry";

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
): Promise<{ id: number; invoiceNumber: string }> {
  // Retry once on transient 5xx errors (e.g. concurrent-test DB stress or
  // momentary connection blip) before failing the whole suite.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await apiReq("/invoices", {
      method: "POST",
      headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
      body: JSON.stringify({
        customerName: `TEST-DELETE-AUDIT-${label}`,
        paymentMethod: "cash",
        subtotal: 100,
        discount: 0,
        total: 100,
        vatRate: 5,
        vatAmount: 0,
        totalBeforeVat: 100,
        totalIncludingVat: 100,
        roundOffDiscount: 0,
        isPending,
        items: [],
      }),
    });
    if (res.ok) {
      const created = (await res.json()) as { id: number; invoiceNumber: string };
      return created;
    }
    const body = await res.text();
    if (res.status >= 500 && attempt < 2) {
      console.log(`  ⚠ createTestInvoice(${label}) got ${res.status} on attempt ${attempt}, retrying in 500ms…`);
      await new Promise<void>((r) => setTimeout(r, 500));
      continue;
    }
    throw new Error(`createTestInvoice(${label}) failed (${res.status}): ${body}`);
  }
  throw new Error(`createTestInvoice(${label}) exhausted retries`);
}

async function deleteInvoice(
  id: number,
  { withHeader = false }: { withHeader?: boolean } = {},
): Promise<{ status: number }> {
  const headers: Record<string, string> = {};
  if (withHeader) headers["X-Allow-Invoice-Delete"] = "true";
  const res = await apiReq(`/invoices/${id}`, { method: "DELETE", headers });
  // Drain body to avoid keep-alive stall
  try { await res.text(); } catch { /* ignore */ }
  return { status: res.status };
}

interface AuditEntry {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  billNo: string | null;
  actorId: number | null;
  createdAt: string;
}

/** Fetch the full audit log and return DELETE entries for the given invoiceId. */
async function deleteAuditEntriesForInvoice(invoiceId: number): Promise<AuditEntry[]> {
  const res = await apiReq("/purchase-bills/audit-log");
  if (!res.ok) throw new Error(`audit-log fetch failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { entries: AuditEntry[] } | AuditEntry[];
  const all = Array.isArray(body) ? body : body.entries;
  return all.filter(
    (e) => e.entityType === "invoice" && e.entityId === invoiceId && e.action === "delete",
  );
}

// ── Assertions ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else       { console.error(`  ✗ FAIL: ${msg}`); failed++; }
}

// ── Test cases ────────────────────────────────────────────────────────────────

/**
 * Test A: Delete a PENDING invoice (no unlock header required).
 * The audit log must contain exactly one row:
 *   entityType = "invoice", action = "delete", entityId = invoice.id
 */
async function testA_PendingInvoiceDeleteWritesAuditEntry(): Promise<void> {
  console.log("\nTest A: Deleting a PENDING invoice writes an audit log entry");

  const inv = await createTestInvoice(true, "PENDING");
  console.log(`  Created ${inv.invoiceNumber} (isPending=true, id=${inv.id})`);

  // Confirm no pre-existing delete entries for this brand-new invoice.
  // (A "create" audit entry is expected to already exist; we only care that no
  //  spurious "delete" entry exists before the actual deletion.)
  const before = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    before.length === 0,
    `No delete audit entries before delete (got ${before.length})`,
  );

  const { status } = await deleteInvoice(inv.id);
  assert(status === 204, `DELETE returned 204 (got ${status})`);

  // The invoice must be gone.
  const check = await apiReq(`/invoices/${inv.id}`);
  assert(check.status === 404, `Invoice is gone after delete (got ${check.status})`);

  const after = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    after.length === 1,
    `Exactly one delete audit entry written (got ${after.length})`,
  );

  if (after.length >= 1) {
    const entry = after[0]!;
    assert(entry.entityType === "invoice", `entityType is "invoice" (got "${entry.entityType}")`);
    assert(entry.action === "delete", `action is "delete" (got "${entry.action}")`);
    assert(entry.entityId === inv.id, `entityId matches invoice id ${inv.id} (got ${entry.entityId})`);
    assert(
      entry.billNo === inv.invoiceNumber,
      `billNo matches invoice number ${inv.invoiceNumber} (got "${entry.billNo}")`,
    );
  }
}

/**
 * Test B: Delete a PAID (non-pending) invoice with the explicit unlock header.
 * Same audit guarantees must hold for this code path.
 */
async function testB_PaidInvoiceDeleteWritesAuditEntry(): Promise<void> {
  console.log("\nTest B: Deleting a PAID invoice (with unlock header) writes an audit log entry");

  const inv = await createTestInvoice(false, "PAID");
  console.log(`  Created ${inv.invoiceNumber} (isPending=false, id=${inv.id})`);

  // Confirm no pre-existing delete entries for this brand-new invoice.
  const before = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    before.length === 0,
    `No delete audit entries before delete (got ${before.length})`,
  );

  // Without the unlock header this should be blocked (guard intact).
  const guardCheck = await deleteInvoice(inv.id, { withHeader: false });
  assert(
    guardCheck.status === 409,
    `DELETE without header returns 409 (guard active) (got ${guardCheck.status})`,
  );

  // No delete audit entry must be written for a blocked (409) attempt.
  const afterBlock = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    afterBlock.length === 0,
    `No delete audit entries after a blocked (409) attempt (got ${afterBlock.length})`,
  );

  // Now delete for real with the unlock header.
  const { status } = await deleteInvoice(inv.id, { withHeader: true });
  assert(status === 204, `DELETE with header returned 204 (got ${status})`);

  // The invoice must be gone.
  const check = await apiReq(`/invoices/${inv.id}`);
  assert(check.status === 404, `Invoice is gone after delete (got ${check.status})`);

  const after = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    after.length === 1,
    `Exactly one delete audit entry written (got ${after.length})`,
  );

  if (after.length >= 1) {
    const entry = after[0]!;
    assert(entry.entityType === "invoice", `entityType is "invoice" (got "${entry.entityType}")`);
    assert(entry.action === "delete", `action is "delete" (got "${entry.action}")`);
    assert(entry.entityId === inv.id, `entityId matches invoice id ${inv.id} (got ${entry.entityId})`);
    assert(
      entry.billNo === inv.invoiceNumber,
      `billNo matches invoice number ${inv.invoiceNumber} (got "${entry.billNo}")`,
    );
  }
}

/**
 * Test C: Attempt to DELETE a non-existent invoice (id never existed).
 *
 * The transaction locks the invoice row first; when the lock returns no row
 * (locked === null) the transaction immediately returns null — the audit insert
 * is never reached. This test verifies the reverse atomicity guarantee: a
 * failed deletion must leave zero audit_log rows for the entity.
 *
 * Approach:
 *  1. Create a real invoice so we know its id (n).
 *  2. Delete that invoice for real (200 → 204) so the id is gone from the DB.
 *  3. Immediately attempt to DELETE the same id again.
 *  4. The second attempt must return 404 (invoice does not exist at lock time).
 *  5. The audit log must contain exactly ONE delete entry (from step 2), not two.
 *     i.e. the failed second attempt must NOT have written an orphan audit row.
 */
async function testC_FailedDeletionLeavesNoOrphanAuditEntry(): Promise<void> {
  console.log(
    "\nTest C: A failed deletion (invoice absent at lock time) leaves no orphan audit entry",
  );

  // Create and then delete a real invoice to obtain a valid-then-gone id.
  const inv = await createTestInvoice(true, "ATOMICITY");
  console.log(`  Created ${inv.invoiceNumber} (isPending=true, id=${inv.id})`);

  // First deletion — must succeed and write exactly one audit entry.
  const { status: firstStatus } = await deleteInvoice(inv.id);
  assert(firstStatus === 204, `First DELETE returned 204 (got ${firstStatus})`);

  const afterFirst = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    afterFirst.length === 1,
    `Exactly one audit entry after the first (successful) delete (got ${afterFirst.length})`,
  );

  // Second deletion of the same id — the transaction's SELECT … FOR UPDATE will
  // find no row (locked === null) and return without reaching the audit insert.
  const { status: secondStatus } = await deleteInvoice(inv.id);
  assert(
    secondStatus === 404,
    `Second DELETE of a gone invoice returns 404 (got ${secondStatus})`,
  );

  // Audit count must still be exactly one — the failed attempt must not have
  // written an additional (orphan) row.
  const afterSecond = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    afterSecond.length === 1,
    `Still exactly one audit entry after the failed second delete (got ${afterSecond.length}) — no orphan row written`,
  );
}

/**
 * Test D: Two concurrent DELETE requests for the same PENDING invoice.
 *
 * The DELETE handler acquires a SELECT … FOR UPDATE lock inside the
 * transaction, which serializes concurrent deletes at the DB level:
 *  - The first transaction to acquire the lock deletes the row, writes one
 *    audit entry, and commits → must return 204.
 *  - The second transaction acquires the lock after the first commits, finds
 *    no row (locked === null), and returns null → must return 404.
 *
 * Invariants checked:
 *  1. The pair of status codes is {204, 404} (one each, in any order).
 *  2. The audit log for that invoice ID has exactly ONE "delete" entry
 *     afterward — the concurrent loser must not write an orphan row.
 */
async function testD_ConcurrentDeletesProduceExactlyOneAuditEntry(): Promise<void> {
  console.log(
    "\nTest D: Two concurrent DELETEs race for the same invoice — only one audit entry is written",
  );

  const inv = await createTestInvoice(true, "CONCURRENT");
  console.log(`  Created ${inv.invoiceNumber} (isPending=true, id=${inv.id})`);

  // Confirm no pre-existing delete entries.
  const before = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    before.length === 0,
    `No delete audit entries before the race (got ${before.length})`,
  );

  // Fire both requests at the same time.
  const [r1, r2] = await Promise.all([
    deleteInvoice(inv.id),
    deleteInvoice(inv.id),
  ]);

  const statuses = [r1.status, r2.status].sort();
  assert(
    statuses[0] === 204 && statuses[1] === 404,
    `One 204 and one 404 (got ${r1.status} and ${r2.status})`,
  );

  // Allow a brief moment for both DB transactions to fully commit before
  // reading the audit log (prevents a rare read-before-commit false failure).
  await new Promise<void>((resolve) => setTimeout(resolve, 200));

  const after = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    after.length === 1,
    `Exactly one delete audit entry written after the race (got ${after.length}) — concurrent loser must not produce an orphan row`,
  );

  if (after.length >= 1) {
    const entry = after[0]!;
    assert(entry.entityType === "invoice", `entityType is "invoice" (got "${entry.entityType}")`);
    assert(entry.action === "delete", `action is "delete" (got "${entry.action}")`);
    assert(entry.entityId === inv.id, `entityId matches invoice id ${inv.id} (got ${entry.entityId})`);
    assert(
      entry.billNo === inv.invoiceNumber,
      `billNo matches invoice number ${inv.invoiceNumber} (got "${entry.billNo}")`,
    );
  }
}

/**
 * Test D2: Two concurrent DELETE requests for the same PAID (non-pending) invoice,
 * both carrying the X-Allow-Invoice-Delete unlock header.
 *
 * This is the financially sensitive path: both requests pass the pre-check guard
 * (allowDelete = true) and enter the db.transaction concurrently.  The SELECT …
 * FOR UPDATE lock inside the transaction serialises them exactly as for pending
 * invoices (Test D), so:
 *  - The first request to acquire the lock deletes the row, writes one audit
 *    entry, and commits → must return 204.
 *  - The second request acquires the lock after the first commits, finds no row
 *    (locked === null), and returns null → must return 404.
 *
 * Invariants checked:
 *  1. The pair of status codes is {204, 404} (one each, in any order).
 *  2. The audit log for that invoice ID has exactly ONE "delete" entry afterward
 *     — the concurrent loser must not write an orphan row.
 */
async function testD2_ConcurrentPaidDeletesProduceExactlyOneAuditEntry(): Promise<void> {
  console.log(
    "\nTest D2: Two concurrent DELETEs (with unlock header) race for the same PAID invoice — only one audit entry is written",
  );

  // Create a paid (non-pending) invoice so both requests need the header.
  const inv = await createTestInvoice(false, "CONCURRENT-PAID");
  console.log(`  Created ${inv.invoiceNumber} (isPending=false, id=${inv.id})`);

  // Confirm no pre-existing delete entries.
  const before = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    before.length === 0,
    `No delete audit entries before the race (got ${before.length})`,
  );

  // Both requests carry the unlock header — they both pass the pre-check guard
  // and race into the transaction where the FOR UPDATE lock serialises them.
  const [r1, r2] = await Promise.all([
    deleteInvoice(inv.id, { withHeader: true }),
    deleteInvoice(inv.id, { withHeader: true }),
  ]);

  const statuses = [r1.status, r2.status].sort();
  assert(
    statuses[0] === 204 && statuses[1] === 404,
    `One 204 and one 404 (got ${r1.status} and ${r2.status})`,
  );

  // Allow a brief moment for both DB transactions to fully commit before
  // reading the audit log (prevents a rare read-before-commit false failure).
  await new Promise<void>((resolve) => setTimeout(resolve, 200));

  const after = await deleteAuditEntriesForInvoice(inv.id);
  assert(
    after.length === 1,
    `Exactly one delete audit entry written after the race (got ${after.length}) — concurrent loser must not produce an orphan row`,
  );

  if (after.length >= 1) {
    const entry = after[0]!;
    assert(entry.entityType === "invoice", `entityType is "invoice" (got "${entry.entityType}")`);
    assert(entry.action === "delete", `action is "delete" (got "${entry.action}")`);
    assert(entry.entityId === inv.id, `entityId matches invoice id ${inv.id} (got ${entry.entityId})`);
    assert(
      entry.billNo === inv.invoiceNumber,
      `billNo matches invoice number ${inv.invoiceNumber} (got "${entry.billNo}")`,
    );
  }
}

/**
 * Test F: Static source-code verification — FOR UPDATE row lock precedes audit insert.
 *
 * Motivation: concurrent DELETE requests for the same invoice race to acquire
 * the SELECT … FOR UPDATE lock inside db.transaction().  The lock serializes
 * them at the DB level so that only the winner deletes the row and writes an
 * audit entry; the loser finds no row after acquiring the lock and returns null
 * without ever reaching the audit insert.
 *
 * Without the lock two transactions could both read the invoice as "present",
 * both delete it (one gets the row, the other gets nothing from RETURNING), and
 * then both attempt to write audit entries — potentially producing duplicate or
 * orphan rows depending on timing.
 *
 * This test reads the actual source file and asserts:
 *   1. A FOR UPDATE clause appears inside the transaction body.
 *   2. tx.insert(auditLogTable) appears inside the transaction body.
 *   3. The FOR UPDATE lock appears BEFORE the audit insert (ordering guarantee).
 *
 * Mutation guard: removing or moving the FOR UPDATE lock causes assertion 1 or
 * 3 to fail, giving CI a clear signal before the regression ships.
 */
async function testF_RowLockPrecedesAuditInsertInDeleteTransaction(): Promise<void> {
  console.log(
    "\nTest F: Source-code verification — FOR UPDATE row lock precedes audit insert in DELETE transaction",
  );
  console.log("  (Mutation guard: removing the FOR UPDATE lock would fail assertion 1;");
  console.log("   moving it after the audit insert would fail assertion 3.)");

  const { readFile } = await import("node:fs/promises");
  const { resolve }  = await import("node:path");

  const routeFile = resolve(process.cwd(), "src/routes/invoices.ts");
  let source: string;
  try {
    source = await readFile(routeFile, "utf-8");
  } catch (err) {
    assert(false, `Could not read invoices.ts route file (${routeFile}): ${err}`);
    return;
  }

  // ── Locate the DELETE /invoices/:id handler ───────────────────────────────

  const deleteHandlerStart = source.indexOf('router.delete("/invoices/:id"');
  assert(
    deleteHandlerStart !== -1,
    'DELETE /invoices/:id handler exists in invoices.ts',
  );
  if (deleteHandlerStart === -1) return;

  // ── Locate the db.transaction call within the handler ────────────────────

  const txCallStart = source.indexOf("db.transaction(async (tx) =>", deleteHandlerStart);
  assert(
    txCallStart !== -1,
    'DELETE handler wraps its work in db.transaction(async (tx) => ...)',
  );
  if (txCallStart === -1) return;

  // ── Extract the transaction callback body by tracking brace depth ─────────

  const openBrace = source.indexOf("{", txCallStart);
  assert(openBrace !== -1, 'Transaction block has an opening brace');
  if (openBrace === -1) return;

  let depth = 0;
  let closeBrace = -1;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { closeBrace = i; break; }
    }
  }
  assert(closeBrace !== -1, 'Transaction block has a matching closing brace');
  if (closeBrace === -1) return;

  const transactionBody = source.slice(openBrace, closeBrace + 1);

  // ── Core assertions ───────────────────────────────────────────────────────

  // 1. A FOR UPDATE clause must appear inside the transaction body.
  //    Mutation guard: removing the lock causes this assertion to fail.
  const forUpdateIdx = transactionBody.search(/FOR\s+UPDATE/);
  assert(
    forUpdateIdx !== -1,
    'Transaction body contains a FOR UPDATE row-level lock — serializes concurrent deletes',
  );
  if (forUpdateIdx === -1) return;

  // 2. The audit insert must also appear inside the transaction body.
  //    (Complements Test E; needed here to check ordering in step 3.)
  const auditInsertIdx = transactionBody.indexOf("tx.insert(auditLogTable)");
  assert(
    auditInsertIdx !== -1,
    'Transaction body contains tx.insert(auditLogTable)',
  );
  if (auditInsertIdx === -1) return;

  // 3. The FOR UPDATE lock must appear BEFORE the audit insert.
  //    Mutation guard: moving the lock after the audit insert causes this to fail,
  //    meaning a crashbetween the insert and the lock acquisition would leave an
  //    orphan audit row with no corresponding deletion.
  assert(
    forUpdateIdx < auditInsertIdx,
    `FOR UPDATE lock (offset ${forUpdateIdx}) precedes tx.insert(auditLogTable) (offset ${auditInsertIdx}) — lock acquired before audit write`,
  );
}

/**
 * Test E: Static source-code verification — audit insert is inside the DB transaction.
 *
 * Motivation: the existing runtime tests (A–D) all run against a live server and
 * confirm the audit entry is written *after* a successful delete.  What they
 * cannot catch is the case where someone refactors the handler and moves the
 * audit insert OUTSIDE the db.transaction(...) callback.  If that happens:
 *
 *   • During normal operation, the audit entry still appears (the db.insert runs
 *     a moment after the transaction commits) — the runtime tests still pass.
 *   • On a server restart or crash between the COMMIT and the db.insert, the
 *     transaction is committed (invoice gone) but the audit write never executes
 *     → the deletion is silently untracked.
 *
 * This test reads the actual source file, extracts the transaction callback body,
 * and asserts:
 *   1. tx.insert(auditLogTable) appears inside the transaction body.
 *   2. db.insert(auditLogTable) does NOT appear inside the transaction body
 *      (that would use the outer connection handle, bypassing tx isolation).
 *   3. db.insert(auditLogTable) does NOT appear in the DELETE handler after the
 *      transaction block (outside = lost on crash/restart).
 *
 * If any of these fail the test suite exits with code 1, giving CI a clear
 * signal before the regression ships.
 */
async function testE_AuditInsertIsInsideDeleteTransaction(): Promise<void> {
  console.log("\nTest E: Source-code verification — audit insert is inside the DB transaction");
  console.log("  (Catches the server-restart data-loss scenario: if the audit insert were");
  console.log("   outside the transaction, a crash between COMMIT and the insert would");
  console.log("   leave the invoice deleted but unrecorded in the audit log.)");

  // The test script is run from artifacts/api-server/ by pnpm --filter.
  // The route lives at src/routes/invoices.ts relative to that working directory.
  const { readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");

  const routeFile = resolve(process.cwd(), "src/routes/invoices.ts");
  let source: string;
  try {
    source = await readFile(routeFile, "utf-8");
  } catch (err) {
    assert(false, `Could not read invoices.ts route file (${routeFile}): ${err}`);
    return;
  }

  // ── Locate the DELETE /invoices/:id handler ───────────────────────────────

  const deleteHandlerStart = source.indexOf('router.delete("/invoices/:id"');
  assert(
    deleteHandlerStart !== -1,
    'DELETE /invoices/:id handler exists in invoices.ts',
  );
  if (deleteHandlerStart === -1) return;

  // ── Locate the db.transaction call within the handler ────────────────────

  const txCallStart = source.indexOf("db.transaction(async (tx) =>", deleteHandlerStart);
  assert(
    txCallStart !== -1,
    'DELETE handler wraps its work in db.transaction(async (tx) => ...)',
  );
  if (txCallStart === -1) return;

  // ── Extract the transaction callback body by tracking brace depth ─────────

  const openBrace = source.indexOf("{", txCallStart);
  assert(openBrace !== -1, 'Transaction block has an opening brace');
  if (openBrace === -1) return;

  let depth = 0;
  let closeBrace = -1;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { closeBrace = i; break; }
    }
  }
  assert(closeBrace !== -1, 'Transaction block has a matching closing brace');
  if (closeBrace === -1) return;

  const transactionBody = source.slice(openBrace, closeBrace + 1);
  const afterTransaction  = source.slice(closeBrace + 1);

  // ── Core assertions ───────────────────────────────────────────────────────

  // 1. The audit insert must use `tx.insert` inside the transaction body.
  assert(
    transactionBody.includes("tx.insert(auditLogTable)"),
    'audit insert uses tx.insert(auditLogTable) inside the transaction body — atomicity guaranteed',
  );

  // 2. No `db.insert(auditLogTable)` inside the transaction body.
  //    That would use the outer connection handle, bypassing tx isolation and
  //    committing the audit row independently of the surrounding transaction.
  assert(
    !transactionBody.includes("db.insert(auditLogTable)"),
    'No db.insert(auditLogTable) inside the transaction body (would bypass tx isolation)',
  );

  // 3. No `db.insert(auditLogTable)` in the DELETE handler AFTER the transaction.
  //    Anything after the transaction block runs outside the implicit BEGIN/COMMIT,
  //    so a server crash between the tx commit and this db.insert would lose the
  //    audit entry permanently.
  const nextHandlerIdx = afterTransaction.search(
    /router\.(get|post|put|patch|delete|use)\s*\(/,
  );
  const handlerTail = nextHandlerIdx === -1
    ? afterTransaction
    : afterTransaction.slice(0, nextHandlerIdx);

  assert(
    !handlerTail.includes("db.insert(auditLogTable)"),
    'No db.insert(auditLogTable) after the transaction block in the DELETE handler — crash-safe',
  );
}

/**
 * Test G: DELETE an invoice when source stock batches are absent (purchase_id = NULL).
 *
 * Background: reverseInvoiceConsumption (inventoryEngine.ts) restores FIFO batch
 * balances by querying inventory_consumptions WHERE purchase_id IS NOT NULL. When
 * the source batches have been deleted the FK `ON DELETE SET NULL` fires, leaving
 * consumption rows with purchase_id = NULL. The reversal UPDATE subquery then
 * returns no rows — a silent no-op — and the DELETE handler must still succeed.
 *
 * The handler must:
 *   (a) return 204  — no error from the reversal no-op,
 *   (b) write exactly one audit "delete" entry,
 *   (c) leave the batch's remaining_weight_grams UNCHANGED at the post-sale
 *       value — the FIFO reversal correctly skipped null-purchase_id rows,
 *       meaning the batch shows the deducted balance and is NOT double-restored,
 *   (d) restore stock_levels.weight_grams via the sale_reversal stock movement
 *       (driven by stock_movements, which is independent of inventory_consumptions),
 *   (e) remove all consumption rows for the invoice (including null-purchase_id
 *       rows) so no orphan ledger entries remain.
 *
 * Isolation strategy:
 *   • A dedicated stock batch (200g gold, purchaseDate "2000-01-01") is created
 *     via the API so FIFO always picks it first (ORDER BY purchase_date ASC).
 *   • After invoice creation, purchase_id on the consumption rows is set to NULL
 *     via SQL — exactly what ON DELETE SET NULL does when a batch is removed —
 *     without touching the batch itself or its remaining_weight_grams.
 *   • A try/finally block cleans up the fixture batch unconditionally, preserving
 *     the original error if any intermediate step throws.
 */
async function testG_DeleteWithAbsentBatchesSucceedsAndWritesAuditEntry(): Promise<void> {
  console.log(
    "\nTest G: DELETE invoice with null-purchase_id consumptions (absent source batches) — " +
    "FIFO reversal is a silent no-op, 204 returned, audit written, batch not double-restored",
  );

  const { sql } = await import("drizzle-orm");

  // ── 1. Create a dedicated fixture batch ───────────────────────────────────
  // purchaseDate "2000-01-01" ensures FIFO always picks this lot before any
  // real batches in the DB (ordered purchase_date ASC).
  const purchaseRes = await apiReq("/stock/purchases", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
    body: JSON.stringify({
      category: "gold",
      supplierName: "TEST-G-FIXTURE",
      purchaseDate: "2000-01-01",
      weightGrams: 200,
      totalPriceAed: 10000,
    }),
  });
  if (!purchaseRes.ok) {
    throw new Error(`Test G: create stock purchase failed (${purchaseRes.status}): ${await purchaseRes.text()}`);
  }
  const purchase = (await purchaseRes.json()) as { id: number };
  console.log(`  Created fixture batch id=${purchase.id} (200g gold, 2000-01-01)`);

  // Capture gold level right after purchase (before invoice) for the
  // surface-level restoration check later.
  const levelsAfterPurchaseRes = await apiReq("/stock/levels");
  if (!levelsAfterPurchaseRes.ok) {
    throw new Error(`stock/levels fetch failed: ${levelsAfterPurchaseRes.status}`);
  }
  const goldAfterPurchase =
    ((await levelsAfterPurchaseRes.json()) as { category: string; weightGrams: number }[])
      .find((l) => l.category === "gold")?.weightGrams ?? 0;
  console.log(`  Gold level after purchase, before invoice: ${goldAfterPurchase}g`);

  // Track invoice id so finally block can attempt emergency cleanup if needed.
  let invId = 0;

  try {
    // ── 2. Create a pending invoice with a 10g gold item ──────────────────
    const createRes = await apiReq("/invoices", {
      method: "POST",
      headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
      body: JSON.stringify({
        customerName: "TEST-DELETE-AUDIT-NULL-PURCHASE",
        paymentMethod: "cash",
        subtotal: 500,
        discount: 0,
        total: 500,
        vatRate: 5,
        vatAmount: 0,
        totalBeforeVat: 500,
        totalIncludingVat: 500,
        roundOffDiscount: 0,
        isPending: true,
        items: [
          {
            description: "Test gold item",
            category: "gold",
            quantity: 1,
            grossWeight: 10,
            weight: 10,
            unitPrice: 50,
            totalPrice: 500,
          },
        ],
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Test G: create invoice failed (${createRes.status}): ${await createRes.text()}`);
    }
    const inv = (await createRes.json()) as { id: number; invoiceNumber: string };
    invId = inv.id;
    console.log(`  Created ${inv.invoiceNumber} (id=${inv.id}) with a 10g gold item`);

    // ── 3. Assert FIFO wrote at least one consumption row pointing to our batch
    const consumptionCheck = await db.execute<{ total: string; linked: string }>(sql`
      SELECT COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE purchase_id = ${purchase.id})::text AS linked
      FROM inventory_consumptions WHERE invoice_id = ${inv.id}
    `);
    const totalConsumptions = Number(consumptionCheck.rows[0]?.total ?? 0);
    const linkedConsumptions = Number(consumptionCheck.rows[0]?.linked ?? 0);
    assert(
      totalConsumptions >= 1,
      `FIFO created at least one consumption row at invoice creation (got ${totalConsumptions})`,
    );
    assert(
      linkedConsumptions >= 1,
      `At least one consumption row references the fixture batch (purchase_id=${purchase.id}) (got ${linkedConsumptions})`,
    );
    console.log(
      `  Consumption rows: total=${totalConsumptions}, linked to fixture batch=${linkedConsumptions}`,
    );

    // ── 4. Record batch remaining_weight_grams after the FIFO sale ────────
    const batchAfterSaleRes = await db.execute<{ remaining: string }>(
      sql`SELECT remaining_weight_grams::text AS remaining FROM stock_purchases WHERE id = ${purchase.id}`,
    );
    const remainingAfterSale = Number(batchAfterSaleRes.rows[0]?.remaining ?? 0);
    console.log(`  Batch remaining after sale: ${remainingAfterSale}g (original: 200g)`);
    assert(
      remainingAfterSale < 200,
      `Batch remaining reduced by FIFO consumption (expected <200g, got ${remainingAfterSale}g)`,
    );

    // ── 5. Simulate absent source batch: set purchase_id = NULL ───────────
    // This mirrors exactly what the FK `ON DELETE SET NULL` clause on
    // inventory_consumptions.purchase_id does when a stock_purchases row is
    // deleted. Doing it via SQL keeps the batch intact (remaining stays at
    // remainingAfterSale), so the assertion in step 8 is unambiguous.
    const nullifyRes = await db.execute<{ count: string }>(sql`
      WITH upd AS (
        UPDATE inventory_consumptions
        SET purchase_id = NULL
        WHERE invoice_id = ${inv.id} AND purchase_id = ${purchase.id}
        RETURNING id
      ) SELECT COUNT(*)::text AS count FROM upd
    `);
    const nullifiedCount = Number(nullifyRes.rows[0]?.count ?? 0);
    assert(
      nullifiedCount >= 1,
      `At least one consumption row had purchase_id set to NULL (simulating absent batch) — got ${nullifiedCount}`,
    );
    console.log(`  Set purchase_id = NULL on ${nullifiedCount} row(s) — absent-batch simulation`);

    // Verify consumption rows still exist (with null purchase_id) so the
    // reversal encounters them but correctly skips them (WHERE IS NOT NULL).
    const afterNullifyRes = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM inventory_consumptions WHERE invoice_id = ${inv.id}`,
    );
    const consumptionsPresent = Number(afterNullifyRes.rows[0]?.count ?? 0);
    assert(
      consumptionsPresent >= 1,
      `Consumption rows still present before delete (purchase_id now NULL) — got ${consumptionsPresent}`,
    );

    // ── 6. No delete audit entries yet ────────────────────────────────────
    const before = await deleteAuditEntriesForInvoice(inv.id);
    assert(before.length === 0, `No delete audit entries before HTTP DELETE (got ${before.length})`);

    // ── 7. HTTP DELETE ────────────────────────────────────────────────────
    const { status } = await deleteInvoice(inv.id);
    assert(
      status === 204,
      `DELETE returned 204 even though all consumption purchase_ids were NULL (got ${status})`,
    );
    invId = 0; // Invoice is gone — no cleanup needed.

    // ── (b) Exactly one audit entry ───────────────────────────────────────
    const after = await deleteAuditEntriesForInvoice(inv.id);
    assert(
      after.length === 1,
      `Exactly one delete audit entry written despite null-purchase_id consumptions (got ${after.length})`,
    );
    if (after.length >= 1) {
      const e = after[0]!;
      assert(e.entityType === "invoice", `entityType is "invoice" (got "${e.entityType}")`);
      assert(e.action === "delete", `action is "delete" (got "${e.action}")`);
      assert(e.entityId === inv.id, `entityId matches invoice id ${inv.id} (got ${e.entityId})`);
      assert(e.billNo === inv.invoiceNumber, `billNo matches ${inv.invoiceNumber} (got "${e.billNo}")`);
    }

    // ── (c) FIFO batch balance NOT double-restored ────────────────────────
    // reverseInvoiceConsumption skipped the null-purchase_id rows so the
    // batch must still show remainingAfterSale (≤190g), NOT 200g.
    const batchAfterDeleteRes = await db.execute<{ remaining: string }>(
      sql`SELECT remaining_weight_grams::text AS remaining FROM stock_purchases WHERE id = ${purchase.id}`,
    );
    const remainingAfterDelete = Number(batchAfterDeleteRes.rows[0]?.remaining ?? 0);
    console.log(
      `  Batch remaining: after sale=${remainingAfterSale}g, after delete=${remainingAfterDelete}g ` +
      `(must be unchanged — FIFO reversal was a no-op)`,
    );
    assert(
      Math.abs(remainingAfterDelete - remainingAfterSale) < 0.001,
      `Batch remaining_weight_grams unchanged after delete — FIFO reversal was a no-op for null-purchase_id rows: ` +
      `expected ${remainingAfterSale}g, got ${remainingAfterDelete}g`,
    );

    // ── (d) Surface stock_levels restored by sale_reversal ────────────────
    // The DELETE handler reads stock_movements (not inventory_consumptions) to
    // apply the sale_reversal, so stock_levels is restored even when all
    // consumption rows had null purchase_id.
    const levelsAfterDeleteRes = await apiReq("/stock/levels");
    if (!levelsAfterDeleteRes.ok) throw new Error(`stock/levels fetch after delete failed`);
    const goldAfterDelete =
      ((await levelsAfterDeleteRes.json()) as { category: string; weightGrams: number }[])
        .find((l) => l.category === "gold")?.weightGrams ?? 0;
    console.log(
      `  Surface gold: before invoice=${goldAfterPurchase}g, after delete=${goldAfterDelete}g`,
    );
    assert(
      Math.abs(goldAfterDelete - goldAfterPurchase) < 0.001,
      `Surface gold restored to pre-invoice level ${goldAfterPurchase}g — sale_reversal ran exactly once: got ${goldAfterDelete}g`,
    );

    // Cross-check via stock_movements: a sale_reversal entry must exist and
    // its absolute weight must match the original sale (column name is "type").
    const [saleMov, reversalMov] = await Promise.all([
      db.execute<{ weight_grams: string }>(sql`
        SELECT weight_grams::text FROM stock_movements
        WHERE category = 'gold' AND ref_type = 'invoice' AND ref_id = ${inv.id} AND type = 'sale'
        ORDER BY id DESC LIMIT 1
      `),
      db.execute<{ weight_grams: string }>(sql`
        SELECT weight_grams::text FROM stock_movements
        WHERE category = 'gold' AND ref_type = 'invoice' AND ref_id = ${inv.id} AND type = 'sale_reversal'
        ORDER BY id DESC LIMIT 1
      `),
    ]);
    const saleGrams = Math.abs(Number(saleMov.rows[0]?.weight_grams ?? 0));
    const reversalGrams = Number(reversalMov.rows[0]?.weight_grams ?? 0);
    console.log(`  stock_movements: sale=${saleGrams}g, sale_reversal=${reversalGrams}g`);
    assert(
      reversalGrams > 0,
      `A sale_reversal stock_movement was recorded (got ${reversalGrams}g)`,
    );
    assert(
      Math.abs(reversalGrams - saleGrams) < 0.001,
      `sale_reversal restores exactly the same grams as the original sale (${saleGrams}g) — got ${reversalGrams}g`,
    );

    // ── (e) Consumption rows cleaned up ───────────────────────────────────
    // The DELETE handler's reverseInvoiceConsumption always issues
    // DELETE FROM inventory_consumptions WHERE invoice_id = ?
    // which removes ALL rows for the invoice, including null-purchase_id ones.
    const orphanCheck = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM inventory_consumptions WHERE invoice_id = ${inv.id}`,
    );
    const orphanCount = Number(orphanCheck.rows[0]?.count ?? 0);
    assert(
      orphanCount === 0,
      `All consumption rows (including null-purchase_id ones) removed after delete — got ${orphanCount}`,
    );
  } finally {
    // ── Unconditional fixture cleanup ─────────────────────────────────────
    // If the invoice was not deleted (invId > 0), attempt best-effort cleanup.
    // Always restore the batch and remove it via API, which applies the
    // purchase_reversal to stock_levels and leaves the DB in its pre-test state.
    try {
      if (invId > 0) {
        // Invoice was not deleted (test failed before or after the HTTP DELETE).
        // Clean up consumption rows then delete the invoice directly via DB.
        await db.execute(sql`DELETE FROM inventory_consumptions WHERE invoice_id = ${invId}`);
        await db.execute(sql`DELETE FROM invoices WHERE id = ${invId}`);
        // Direct-DB delete bypasses the server-side registry unregister, so remove
        // the registry row here to keep the run's fixture set accurate.
        await unregisterSuiteFixture(suiteRunId, "invoice", invId);
        console.log(`  Cleanup: removed orphan invoice id=${invId} from DB`);
      }
      // Restore remaining_weight_grams so the API guard (remaining < weight → 409)
      // does not block the batch deletion.
      await db.execute(
        sql`UPDATE stock_purchases SET remaining_weight_grams = weight_grams WHERE id = ${purchase.id}`,
      );
      const cleanupRes = await apiReq(`/stock/purchases/${purchase.id}`, { method: "DELETE" });
      if (cleanupRes.status === 204) {
        console.log(`  Cleanup: fixture batch id=${purchase.id} removed, stock_levels restored`);
      } else {
        console.log(`  Cleanup warning: batch delete returned ${cleanupRes.status}`);
      }
    } catch (cleanupErr) {
      console.error(`  Cleanup error (non-fatal):`, cleanupErr);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n━━━ Invoice delete audit-trail tests ━━━`);
  console.log(`API base: ${BASE}`);

  await login();

  await ensureRegistryProvisioned();
  const recovery = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  if (recovery.claimedRunIds.length > 0) console.log(`  ✓ Recovered ${recovery.deleted} abandoned registered fixture(s) from ${recovery.claimedRunIds.length} prior run(s)${recovery.kept > 0 ? ` (${recovery.kept} kept)` : ""}`);
  suiteRunId = await startSuiteRun("invoice-delete-audit", adminUserId);

  let suiteSucceeded = false;
  try {
    await testA_PendingInvoiceDeleteWritesAuditEntry();
    await testB_PaidInvoiceDeleteWritesAuditEntry();
    await testC_FailedDeletionLeavesNoOrphanAuditEntry();
    await testD_ConcurrentDeletesProduceExactlyOneAuditEntry();
    await testD2_ConcurrentPaidDeletesProduceExactlyOneAuditEntry();
    await testF_RowLockPrecedesAuditInsertInDeleteTransaction();
    await testE_AuditInsertIsInsideDeleteTransaction();
    await testG_DeleteWithAbsentBatchesSucceedsAndWritesAuditEntry();

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
