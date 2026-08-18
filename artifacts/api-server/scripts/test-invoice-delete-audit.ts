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

async function createTestInvoice(
  isPending: boolean,
  label: string,
): Promise<{ id: number; invoiceNumber: string }> {
  const res = await apiReq("/invoices", {
    method: "POST",
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
  if (!res.ok) throw new Error(`createTestInvoice(${label}) failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<{ id: number; invoiceNumber: string }>;
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
  const all = (await res.json()) as AuditEntry[];
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n━━━ Invoice delete audit-trail tests ━━━`);
  console.log(`API base: ${BASE}`);

  await login();

  await testA_PendingInvoiceDeleteWritesAuditEntry();
  await testB_PaidInvoiceDeleteWritesAuditEntry();
  await testC_FailedDeletionLeavesNoOrphanAuditEntry();

  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});
