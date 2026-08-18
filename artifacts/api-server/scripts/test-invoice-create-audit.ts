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
  const body = (await res.json()) as { entries: AuditEntry[] } | AuditEntry[];
  const all = Array.isArray(body) ? body : body.entries;
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

/**
 * Test C: Static source-code assertion — audit insert is inside the transaction.
 *
 * If a future refactor moves `tx.insert(auditLogTable)` outside the transaction
 * (changing it to `db.insert(auditLogTable)`), a server crash between COMMIT and
 * the insert would leave an invoice with no creation audit record. This test
 * catches that mistake at the source level without needing a running server.
 *
 * Strategy:
 *   1. Read invoices.ts.
 *   2. Locate the POST /invoices handler (`router.post("/invoices"`) and the
 *      `db.transaction(async (tx) =>` call within it.
 *   3. Extract the transaction body (from the opening `{` to its matching `}`).
 *   4. Assert `tx.insert(auditLogTable)` appears inside that body.
 *   5. Assert `db.insert(auditLogTable)` does NOT appear inside that body.
 */
async function testC_AuditInsertIsInsideTransaction(): Promise<void> {
  console.log("\nTest C: Static assertion — audit insert uses tx.insert (inside transaction)");

  // Resolve the source file relative to this script's location.
  // __dirname is not available in ESM, so derive it from import.meta.url when
  // available, otherwise fall back to process.cwd()-relative path.
  let srcPath: string;
  try {
    const { fileURLToPath } = await import("url");
    const { dirname, resolve } = await import("path");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname  = dirname(__filename);
    srcPath = resolve(__dirname, "../src/routes/invoices.ts");
  } catch {
    const { resolve } = await import("path");
    srcPath = resolve(process.cwd(), "src/routes/invoices.ts");
  }

  const { readFileSync } = await import("fs");
  let src: string;
  try {
    src = readFileSync(srcPath, "utf8");
  } catch (err) {
    assert(false, `Could not read invoices.ts at ${srcPath}: ${err}`);
    return;
  }

  // ── Step 1: find the POST /invoices handler ───────────────────────────────
  const postHandlerMarker = 'router.post("/invoices"';
  const postHandlerIdx = src.indexOf(postHandlerMarker);
  assert(
    postHandlerIdx !== -1,
    `Found router.post("/invoices" in invoices.ts`,
  );
  if (postHandlerIdx === -1) return;

  const postHandlerSrc = src.slice(postHandlerIdx);

  // ── Step 2: find the db.transaction( call ────────────────────────────────
  const txMarker = "db.transaction(async (tx) =>";
  const txIdx = postHandlerSrc.indexOf(txMarker);
  assert(
    txIdx !== -1,
    `Found db.transaction(async (tx) => inside the POST handler`,
  );
  if (txIdx === -1) return;

  // The transaction callback body starts at the `{` that immediately follows
  // the arrow. Walk forward to find that opening brace.
  let braceStart = postHandlerSrc.indexOf("{", txIdx + txMarker.length);
  assert(braceStart !== -1, `Found opening brace of transaction body`);
  if (braceStart === -1) return;

  // ── Step 3: extract the balanced transaction body ─────────────────────────
  let depth = 0;
  let braceEnd = -1;
  for (let i = braceStart; i < postHandlerSrc.length; i++) {
    if (postHandlerSrc[i] === "{") depth++;
    else if (postHandlerSrc[i] === "}") {
      depth--;
      if (depth === 0) { braceEnd = i; break; }
    }
  }
  assert(braceEnd !== -1, `Transaction body has balanced braces`);
  if (braceEnd === -1) return;

  const txBody = postHandlerSrc.slice(braceStart, braceEnd + 1);

  // ── Step 4 & 5: check for tx.insert / absence of db.insert ───────────────
  const hasTxInsert = txBody.includes("tx.insert(auditLogTable)");
  const hasDbInsert = txBody.includes("db.insert(auditLogTable)");

  assert(
    hasTxInsert,
    `tx.insert(auditLogTable) is present inside the db.transaction body`,
  );
  assert(
    !hasDbInsert,
    `db.insert(auditLogTable) is NOT present inside the db.transaction body (would bypass crash safety)`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n━━━ Invoice create audit-trail tests ━━━`);
  console.log(`API base: ${BASE}`);

  await login();

  await testA_NormalInvoiceCreationWritesAuditEntry();
  await testB_BackdatedInvoiceCreationWritesAuditEntry();
  await testC_AuditInsertIsInsideTransaction();

  console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});
