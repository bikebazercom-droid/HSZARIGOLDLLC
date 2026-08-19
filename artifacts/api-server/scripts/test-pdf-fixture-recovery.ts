#!/usr/bin/env tsx
/**
 * Regression for interrupted-run recovery of the PDF fixture registry.
 *
 * Forces the cleanup-failure path (a run whose fixtures were never removed)
 * and confirms:
 *  1. finalizeRun retains the registry + deactivates the admin instead of
 *     deleting metadata that a later run needs.
 *  2. A subsequent run's age-gated recovery abandons the stale run, deletes
 *     its admin strictly by recorded owner ID, and keeps the exact fixture IDs.
 *  3. Fresh active runs are never touched by recovery.
 *  4. finalizeRun removes everything once cleanup verifiably succeeded.
 */

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pdfTestFixturesTable, pdfTestRunsTable, pool, usersTable } from "@workspace/db";
import {
  STALE_RUN_AGE_MS,
  TEST_FULL_NAME,
  TEST_USERNAME_PREFIX,
  ensureRegistryProvisioned,
  finalizeRun,
  recoverStaleRuns,
} from "./pdf-run-registry";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

/**
 * Creates the ephemeral admin and its owning run row in ONE transaction, so
 * there is no crash window in which the admin exists without a registry
 * record. A kill at any later point leaves a stale run whose owner ID the
 * ordinary age-gated recovery deletes.
 */
async function createTestAdminWithRun(runId: string): Promise<number> {
  const suffix = randomBytes(16).toString("hex");
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 10);
  return db.transaction(async (tx) => {
    const [admin] = await tx.insert(usersTable).values({
      username: `${TEST_USERNAME_PREFIX}${suffix}`,
      mobile: `${TEST_USERNAME_PREFIX}${suffix}`,
      passwordHash,
      fullName: TEST_FULL_NAME,
      role: "admin",
      isActive: true,
    }).returning({ id: usersTable.id });
    assert(admin, "could not create test admin");
    await tx.insert(pdfTestRunsTable).values({ runId, ownerUserId: admin.id });
    return admin.id;
  });
}

async function main(): Promise<void> {
  await ensureRegistryProvisioned();

  const interruptedRunId = randomBytes(16).toString("hex");
  const freshRunId = randomBytes(16).toString("hex");
  const interruptedAdminId = await createTestAdminWithRun(interruptedRunId);
  const freshAdminId = await createTestAdminWithRun(freshRunId);
  const fixtureEntityIds = [901_000_001, 901_000_002];

  try {
    await db.insert(pdfTestFixturesTable).values([
      { runId: interruptedRunId, entityType: "invoice", entityId: fixtureEntityIds[0]! },
      { runId: interruptedRunId, entityType: "stock_purchase", entityId: fixtureEntityIds[1]! },
    ]);

    // 1. Failed run must retain its registry and deactivate (not delete) the admin.
    const failedFinalize = await finalizeRun(interruptedAdminId, false);
    assert(!failedFinalize.cleaned, "failed run must not be cleaned");
    assert(failedFinalize.remainingFixtures === 2, "failed run must report retained fixtures");
    const [retainedRun] = await db.select({ status: pdfTestRunsTable.status })
      .from(pdfTestRunsTable).where(eq(pdfTestRunsTable.runId, interruptedRunId));
    assert(retainedRun, "run row must survive a failed finalize");
    const [deactivated] = await db.select({ isActive: usersTable.isActive })
      .from(usersTable).where(eq(usersTable.id, interruptedAdminId));
    assert(deactivated && !deactivated.isActive, "admin must be deactivated, not deleted");

    // 2. A later run's recovery abandons the stale run (backdated past the age
    //    gate), deletes the admin by owner ID, and keeps the fixtures.
    const backdated = new Date(Date.now() - STALE_RUN_AGE_MS - 60_000);
    await db.update(pdfTestRunsTable)
      .set({ createdAt: backdated })
      .where(eq(pdfTestRunsTable.runId, interruptedRunId));
    const recovery = await recoverStaleRuns(new Date());
    assert(recovery.abandonedRunIds.includes(interruptedRunId), "stale run must be abandoned");
    assert(recovery.deletedAdminIds.includes(interruptedAdminId), "stale admin must be deleted by owner ID");
    assert(!recovery.reclaimedRunIds.includes(interruptedRunId), "run with fixtures must not be reclaimed");
    const retainedFixtures = await db.select({ entityId: pdfTestFixturesTable.entityId })
      .from(pdfTestFixturesTable).where(eq(pdfTestFixturesTable.runId, interruptedRunId));
    assert(
      retainedFixtures.length === 2 &&
      fixtureEntityIds.every((id) => retainedFixtures.some((row) => row.entityId === id)),
      "exact fixture IDs must remain recoverable after recovery",
    );
    const [abandonedRun] = await db.select({ status: pdfTestRunsTable.status })
      .from(pdfTestRunsTable).where(eq(pdfTestRunsTable.runId, interruptedRunId));
    assert(abandonedRun?.status === "abandoned", "retained run must be marked abandoned");

    // 3. The fresh active run (created moments ago) must survive both the
    //    recovery pass above and another ordinary pass.
    assert(!recovery.abandonedRunIds.includes(freshRunId), "fresh run must not be abandoned");
    const ordinary = await recoverStaleRuns(new Date());
    assert(!ordinary.abandonedRunIds.includes(freshRunId), "fresh run must survive repeat recovery passes");
    const [freshRun] = await db.select({ status: pdfTestRunsTable.status })
      .from(pdfTestRunsTable).where(eq(pdfTestRunsTable.runId, freshRunId));
    assert(freshRun?.status === "active", "fresh run must stay active");

    // 4. After cleanup verifiably succeeds (fixtures removed, as the browser
    //    suite does via exact-ID DELETEs), finalize removes run rows + admin.
    await db.delete(pdfTestFixturesTable).where(eq(pdfTestFixturesTable.runId, interruptedRunId));
    const cleanFinalize = await finalizeRun(freshAdminId, true);
    assert(cleanFinalize.cleaned, "successful verified run must be cleaned");
    const [freshAdmin] = await db.select({ id: usersTable.id })
      .from(usersTable).where(eq(usersTable.id, freshAdminId));
    assert(!freshAdmin, "admin of a clean run must be deleted");

    console.log("PDF fixture interruption-recovery regression passed.");
  } finally {
    // Remove everything this regression created, by exact IDs only.
    await db.delete(pdfTestFixturesTable)
      .where(inArray(pdfTestFixturesTable.runId, [interruptedRunId, freshRunId]));
    await db.delete(pdfTestRunsTable)
      .where(inArray(pdfTestRunsTable.runId, [interruptedRunId, freshRunId]));
    await db.delete(usersTable).where(and(
      inArray(usersTable.id, [interruptedAdminId, freshAdminId]),
      eq(usersTable.fullName, TEST_FULL_NAME),
    ));
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("\nPDF fixture recovery regression failed:", error);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
