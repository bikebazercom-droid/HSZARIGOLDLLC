#!/usr/bin/env tsx
/**
 * Integration test: purchase-bill deletion guard cannot be bypassed by a staff user
 *
 * Covers the two scenarios required by Task #45:
 *
 *   1. Staff user sends DELETE /api/purchase-bills/:id → 403 Forbidden
 *      (requireAdmin middleware blocks the request before the handler runs)
 *
 *   2. Admin user sends DELETE /api/purchase-bills/:id on a real bill → 204
 *      (guard admits the right role; the bill is actually removed)
 *
 *   2b. Admin user sends DELETE /api/purchase-bills/:id on a missing id → 404
 *       (confirms the guard passes and the handler runs; absence gives 404, not 403)
 *
 *   3. Staff can read prices for invoice creation but cannot update them;
 *      an admin can submit the same no-op-safe rate update.
 *
 * ── How to run ────────────────────────────────────────────────────────────
 *   pnpm --filter @workspace/api-server run test:bill-delete-role-guard
 *
 *   The API server must be running. Set API_BASE_URL if the default
 *   (Replit dev-domain or http://localhost:$PORT/api) doesn't match your
 *   environment.
 *
 * The script logs in as the seeded admin to create a temporary staff user,
 * then exercises both role paths. Any bill fixture that survives a failure is
 * labelled TEST-ROLE-GUARD-* and can be removed manually.
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

// Temporary staff user created for this test run (unique mobile avoids collisions).
const STAFF_MOBILE = `TEST${Date.now()}`.slice(0, 11);
const STAFF_PIN    = "9999";

// ── HTTP helper ───────────────────────────────────────────────────────────────

/** Per-session cookie; swapped between admin and staff sessions. */
let _cookie = "";
/** The logged-in admin's user id; captured on admin login for run ownership. */
let adminUserId = 0;

async function apiReq(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (_cookie) headers["Cookie"] = _cookie;
  return fetch(`${BASE}${path}`, { ...init, headers });
}

async function loginAs(mobile: string, pin: string, role: "admin" | "staff"): Promise<void> {
  _cookie = ""; // clear any prior session
  const res = await apiReq("/auth/login", {
    method: "POST",
    body: JSON.stringify({ mobile, pin, role }),
  });
  if (!res.ok) throw new Error(`Login as ${role} failed (${res.status}): ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) _cookie = setCookie.split(";")[0]!;
  const user = (await res.json()) as { id: number };
  if (role === "admin") adminUserId = user.id;
  console.log(`  ✓ Logged in as ${role} (mobile: ${mobile})`);
}

// ── Suite run registry ──────────────────────────────────────────────────────

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

/** Create a minimal purchase bill as admin. Returns the new bill id. */
async function createTestBill(): Promise<{ id: number; billNo: string }> {
  const billNo = `TEST-ROLE-GUARD-${Date.now()}`;
  const res = await apiReq("/purchase-bills", {
    method: "POST",
    headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
    body: JSON.stringify({
      billNo,
      billDate: new Date().toISOString().split("T")[0],
      supplierName: "TEST-ROLE-GUARD-SUPPLIER",
      purchaseType: "fixed",
      paymentStatus: "unpaid",
      notes: "Created by test-bill-delete-role-guard",
      items: [
        {
          category: "gold_9999",
          grossWeightGrams: 10,
          purityPercent: 99.9,
          rateAedPerG: 200,
          makingChargeAed: 0,
          lineTotalAed: 2000,   // grossWeight(10) × rate(200) + making(0)
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`createTestBill failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { id: number; billNo: string };
  return { id: data.id, billNo: data.billNo };
}

/** Best-effort cleanup of a bill (ignores errors). */
async function cleanupBill(id: number): Promise<void> {
  // The API DELETE unregisters the fixture server-side in the same transaction.
  await apiReq(`/purchase-bills/${id}`, { method: "DELETE" }).catch(() => null);
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
 * Test 1: A staff session must receive 403 on DELETE /purchase-bills/:id.
 *
 * Uses a real bill id so Express actually hits the route (not a 404 from
 * the router before middleware). The 403 must come from requireAdmin, not
 * from the handler returning "not found".
 */
async function test1_StaffIsBlocked(): Promise<void> {
  console.log("\nTest 1: Staff DELETE /purchase-bills/:id → 403");

  // Create a real bill as admin so the route id is valid.
  await loginAs(ADMIN_MOBILE, ADMIN_PIN, "admin");
  const bill = await createTestBill();
  console.log(`  Created bill id=${bill.id} (${bill.billNo})`);

  // Switch to staff session and attempt deletion.
  await loginAs(STAFF_MOBILE, STAFF_PIN, "staff");
  const res = await apiReq(`/purchase-bills/${bill.id}`, { method: "DELETE" });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* ignore */ }

  assert(res.status === 403, `Expected 403 from staff, got ${res.status}`);
  const errMsg = ((body as Record<string, string> | null)?.error ?? "").toLowerCase();
  assert(
    errMsg.includes("forbidden") || errMsg.includes("admin"),
    `Error message should mention 'forbidden' or 'admin' — got: ${JSON.stringify(body)}`,
  );

  // The bill must still exist (the staff request was blocked before the handler ran).
  await loginAs(ADMIN_MOBILE, ADMIN_PIN, "admin");
  const checkRes = await apiReq(`/purchase-bills/${bill.id}`);
  assert(checkRes.status === 200, `Bill must still exist after blocked staff delete (got ${checkRes.status})`);

  // Cleanup
  await cleanupBill(bill.id);
}

/**
 * Test 2: An admin session must be admitted by requireAdmin (not rejected with 403).
 * Deleting a real bill returns 204; the bill is gone.
 */
async function test2_AdminCanDelete(): Promise<void> {
  console.log("\nTest 2: Admin DELETE /purchase-bills/:id → 204 (bill deleted)");

  await loginAs(ADMIN_MOBILE, ADMIN_PIN, "admin");
  const bill = await createTestBill();
  console.log(`  Created bill id=${bill.id} (${bill.billNo})`);

  const res = await apiReq(`/purchase-bills/${bill.id}`, { method: "DELETE" });
  assert(res.status === 204, `Expected 204 from admin delete, got ${res.status}`);

  // Bill must be gone.
  const check = await apiReq(`/purchase-bills/${bill.id}`);
  assert(check.status === 404, `Bill must be gone after admin delete (got ${check.status})`);
}

/**
 * Test 2b: An admin hitting a non-existent bill id gets 404 — not 403.
 * This confirms requireAdmin passes the request through to the handler,
 * which then applies its own "not found" logic.
 */
async function test2b_AdminMissingBillIs404(): Promise<void> {
  console.log("\nTest 2b: Admin DELETE /purchase-bills/999999999 (non-existent) → 404, not 403");

  await loginAs(ADMIN_MOBILE, ADMIN_PIN, "admin");
  const res = await apiReq("/purchase-bills/999999999", { method: "DELETE" });
  assert(
    res.status === 404,
    `Expected 404 for missing bill as admin, got ${res.status} (403 would mean the role guard wrongly blocked admin)`,
  );
}

/**
 * Test 3: Staff need GET /prices for invoice creation, but financial
 * configuration changes through PUT /prices are admin-only.
 */
async function test3_PricesUpdateIsAdminOnly(): Promise<void> {
  console.log("\nTest 3: Staff GET /prices → 200, staff PUT → 403, admin PUT → 200");

  await loginAs(STAFF_MOBILE, STAFF_PIN, "staff");
  const staffGet = await apiReq("/prices");
  assert(staffGet.status === 200, `Staff must be able to read prices for invoices (got ${staffGet.status})`);
  const current = (await staffGet.json()) as { gold9999Rate: number };

  const staffPut = await apiReq("/prices", {
    method: "PUT",
    body: JSON.stringify({ gold9999Rate: current.gold9999Rate }),
  });
  assert(staffPut.status === 403, `Staff price update must be rejected with 403 (got ${staffPut.status})`);

  await loginAs(ADMIN_MOBILE, ADMIN_PIN, "admin");
  const adminPut = await apiReq("/prices", {
    method: "PUT",
    body: JSON.stringify({ gold9999Rate: current.gold9999Rate }),
  });
  assert(adminPut.status === 200, `Admin price update must be accepted (got ${adminPut.status})`);
  const updated = (await adminPut.json()) as { gold9999Rate: number };
  assert(
    updated.gold9999Rate === current.gold9999Rate,
    `Admin no-op update must preserve GOLD 9999 rate (${current.gold9999Rate})`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n━━━ Purchase-bill deletion role-guard tests ━━━`);
  console.log(`API base: ${BASE}`);

  // Create a temporary staff user for this test run using the admin session.
  await loginAs(ADMIN_MOBILE, ADMIN_PIN, "admin");

  await ensureRegistryProvisioned();
  const recovery = await recoverAbandonedSuiteRuns(deleteRegisteredFixture);
  if (recovery.claimedRunIds.length > 0) console.log(`  ✓ Recovered ${recovery.deleted} abandoned registered fixture(s) from ${recovery.claimedRunIds.length} prior run(s)${recovery.kept > 0 ? ` (${recovery.kept} kept)` : ""}`);
  suiteRunId = await startSuiteRun("bill-delete-role-guard", adminUserId);

  let suiteSucceeded = false;
  try {
    const createStaffRes = await apiReq("/admin/users", {
      method: "POST",
      headers: { "X-Pdf-E2e-Run-Id": suiteRunId },
      body: JSON.stringify({
        fullName: "TEST-ROLE-GUARD-STAFF",
        mobile: STAFF_MOBILE,
        pin: STAFF_PIN,
        role: "staff",
      }),
    });
    if (!createStaffRes.ok) {
      throw new Error(`Failed to create staff user (${createStaffRes.status}): ${await createStaffRes.text()}`);
    }
    const staffUser = (await createStaffRes.json()) as { id: number };
    console.log(`  ✓ Created temporary staff user id=${staffUser.id} (mobile: ${STAFF_MOBILE})`);

    try {
      await test1_StaffIsBlocked();
      await test2_AdminCanDelete();
      await test2b_AdminMissingBillIs404();
      await test3_PricesUpdateIsAdminOnly();
    } finally {
      // Remove the temporary staff user.
      await loginAs(ADMIN_MOBILE, ADMIN_PIN, "admin");
      const delRes = await apiReq(`/admin/users/${staffUser.id}`, { method: "DELETE" });
      if (delRes.ok || delRes.status === 404) {
        // The user is gone; the API DELETE unregisters its registry row server-side.
        console.log(`\n  ✓ Removed temporary staff user id=${staffUser.id}`);
      } else {
        // Non-fatal: warn but don't fail the test suite over cleanup.
        // Try deactivating as a fallback. The user still exists, so it stays
        // registered and a later run's recovery will remove it.
        await apiReq(`/admin/users/${staffUser.id}`, {
          method: "PUT",
          body: JSON.stringify({ isActive: false }),
        }).catch(() => {});
        console.warn(`\n  ⚠ Could not delete staff user id=${staffUser.id} — deactivated instead`);
      }
    }

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
