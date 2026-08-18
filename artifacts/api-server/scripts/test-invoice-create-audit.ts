#!/usr/bin/env tsx
/**
 * Integration test: audit trail is always written when an invoice is created
 *
 * Covers two scenarios required by Task #46:
 *
 *   A. POST a normal (non-backdated) invoice → exactly one audit_log row with
 *      entityType "invoice", action "create", and details fields:
 *        invoiceNumber, total, paymentMethod, backdated: false
 *        (no suppliedCreatedAt key or a null value).
 *
 *   B. POST a backdated invoice (createdAt supplied) → exactly one audit_log
 *      row with the same shape plus:
 *        backdated: true, suppliedCreatedAt: <ISO string matching the supplied date>
 *
 * Both paths run through the same POST /invoices handler, but the audit insert
 * branches on whether invoiceCreatedAt was supplied.
 *
 * ── How to run ────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/api-server run test:invoice-create-audit
 *
 *   The API server must be running. Set API_BASE_URL if the default
 *   (Replit dev-domain or http://localhost:$PORT/api) doesn't match your
 *   environment.
 *
 * The script logs in as the seeded admin, creates short-lived test invoices,
 * and cleans them up after each test. The label prefix TEST-CREATE-AUDIT-*
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

interface CreatedInvoice {
  id: number;
  invoiceNumber: string;
}

async function createTestInvoice(
  label: string,
  opts: { createdAt?: string } = {},
): Promise<CreatedInvoice> {
  const body: Record<string, unknown> = {
    customerName: `TEST-CREATE-AUDIT-${label}`,
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
    items: [],
  };
  if (opts.createdAt !== undefined) {
    body["createdAt"] = opts.createdAt;
  }
  const res = await apiReq("/invoices", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createTestInvoice(${label}) failed (${res.status}): ${await res.text()}`);
  return res.json() as Promise<CreatedInvoice>;
}

/** Best-effort cleanup — deletes an invoice so it doesn't litter the DB. */
async function deleteInvoice(id: number): Promise<void> {
  await apiReq(`/invoices/${id}`, {
    method: "DELETE",
    headers: { "X-Allow-Invoice-Delete": "true" },
  }).catch(() => {/* ignore */});
}

interface AuditEntry {
  id: number;
  actorId: number | null;
  entityType: string;
  entityId: number;
  action: string;
  billNo: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

/** Fetch the full audit log and return CREATE entries for the given invoiceId. */
async function createAuditEntriesForInvoice(invoiceId: number): Promise<AuditEntry[]> {
  const res = await apiReq("/purchase-bills/audit-log");
  if (!res.ok) throw new Error(`audit-log fetch failed (${res.status}): ${await res.text()}`);
  const all = (await res.json()) as AuditEntry[];
  return all.filter(
    (e) => e.entityType === "invoice" && e.entityId === invoiceId && e.action === "create",
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
 * Test A: Create a normal (non-backdated) invoice.
 * The audit log must contain exactly one row:
 *   entityType = "invoice", action = "create", entityId = invoice.id
 * with details: invoiceNumber, total, paymentMethod, backdated = false.
 * suppliedCreatedAt must be absent or null.
 */
async function testA_NormalInvoiceCreationWritesAuditEntry(): Promise<void> {
  console.log("\nTest A: Creating a normal invoice writes an audit log entry");

  const inv = await createTestInvoice("NORMAL");
  console.log(`  Created ${inv.invoiceNumber} (id=${inv.id})`);

  const entries = await createAuditEntriesForInvoice(inv.id);

  assert(
    entries.length === 1,
    `Exactly one create audit entry written (got ${entries.length})`,
  );

  if (entries.length >= 1) {
    const entry = entries[0]!;
    assert(
      entry.entityType === "invoice",
      `entityType is "invoice" (got "${entry.entityType}")`,
    );
    assert(
      entry.action === "create",
      `action is "create" (got "${entry.action}")`,
    );
    assert(
      entry.entityId === inv.id,
      `entityId matches invoice id ${inv.id} (got ${entry.entityId})`,
    );
    assert(
      entry.billNo === inv.invoiceNumber,
      `billNo matches invoice number ${inv.invoiceNumber} (got "${entry.billNo}")`,
    );

    const d = entry.details;
    assert(
      d["invoiceNumber"] === inv.invoiceNumber,
      `details.invoiceNumber matches (got "${d["invoiceNumber"]}")`,
    );
    assert(
      Number(d["total"]) === 500,
      `details.total is 500 (got ${d["total"]})`,
    );
    assert(
      d["paymentMethod"] === "cash",
      `details.paymentMethod is "cash" (got "${d["paymentMethod"]}")`,
    );
    assert(
      d["backdated"] === false,
      `details.backdated is false (got ${JSON.stringify(d["backdated"])})`,
    );
    // suppliedCreatedAt should be absent (normal invoice has no custom date)
    assert(
      d["suppliedCreatedAt"] == null,
      `details.suppliedCreatedAt is absent/null for a normal invoice (got ${JSON.stringify(d["suppliedCreatedAt"])})`,
    );
  }

  await deleteInvoice(inv.id);
}

/**
 * Test B: Create a backdated invoice (createdAt supplied).
 * The audit log must contain exactly one row with:
 *   entityType = "invoice", action = "create", entityId = invoice.id
 * with details: backdated = true, suppliedCreatedAt = <ISO string>.
 */
async function testB_BackdatedInvoiceCreationWritesAuditEntry(): Promise<void> {
  console.log("\nTest B: Creating a backdated invoice writes an audit log entry with backdated flag");

  // Supply a date in the past
  const backdateISO = "2025-03-15T10:00:00.000Z";
  const inv = await createTestInvoice("BACKDATED", { createdAt: backdateISO });
  console.log(`  Created ${inv.invoiceNumber} (id=${inv.id}, createdAt=${backdateISO})`);

  const entries = await createAuditEntriesForInvoice(inv.id);

  assert(
    entries.length === 1,
    `Exactly one create audit entry written (got ${entries.length})`,
  );

  if (entries.length >= 1) {
    const entry = entries[0]!;
    assert(
      entry.entityType === "invoice",
      `entityType is "invoice" (got "${entry.entityType}")`,
    );
    assert(
      entry.action === "create",
      `action is "create" (got "${entry.action}")`,
    );
    assert(
      entry.entityId === inv.id,
      `entityId matches invoice id ${inv.id} (got ${entry.entityId})`,
    );
    assert(
      entry.billNo === inv.invoiceNumber,
      `billNo matches invoice number ${inv.invoiceNumber} (got "${entry.billNo}")`,
    );

    const d = entry.details;
    assert(
      d["invoiceNumber"] === inv.invoiceNumber,
      `details.invoiceNumber matches (got "${d["invoiceNumber"]}")`,
    );
    assert(
      Number(d["total"]) === 500,
      `details.total is 500 (got ${d["total"]})`,
    );
    assert(
      d["paymentMethod"] === "cash",
      `details.paymentMethod is "cash" (got "${d["paymentMethod"]}")`,
    );
    assert(
      d["backdated"] === true,
      `details.backdated is true (got ${JSON.stringify(d["backdated"])})`,
    );
    assert(
      typeof d["suppliedCreatedAt"] === "string" && d["suppliedCreatedAt"] !== null,
      `details.suppliedCreatedAt is a non-null string (got ${JSON.stringify(d["suppliedCreatedAt"])})`,
    );
    // The stored suppliedCreatedAt should round-trip to the same point in time
    if (typeof d["suppliedCreatedAt"] === "string") {
      const storedMs = new Date(d["suppliedCreatedAt"]).getTime();
      const suppliedMs = new Date(backdateISO).getTime();
      assert(
        Math.abs(storedMs - suppliedMs) < 1000,
        `details.suppliedCreatedAt matches supplied date (got "${d["suppliedCreatedAt"]}", expected "${backdateISO}")`,
      );
    }
  }

  await deleteInvoice(inv.id);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n━━━ Invoice create audit-trail tests ━━━`);
  console.log(`API base: ${BASE}`);

  await login();

  await testA_NormalInvoiceCreationWritesAuditEntry();
  await testB_BackdatedInvoiceCreationWritesAuditEntry();

  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});
