/**
 * Durable run registry for the destructive HTTP test suites (audit-guard
 * scripts, invoice-delete-audit, bill audit suites).
 *
 * These suites create real invoices / purchase bills / stock batches / users
 * in the shared dev database over the HTTP API. In-process cleanup cannot run
 * after a hard kill, so — like the browser PDF regression — every created
 * record is registered here by exact ID. A later run recovers only abandoned,
 * registered records; there is never any prefix-wide deletion, so legitimate
 * shop data and concurrent runs can never be matched.
 *
 * Storage reuses the same pdf_test_runs / pdf_test_fixtures tables. Suite run
 * IDs are namespaced with a "suite:" prefix so they can never collide with the
 * 32-hex browser-run IDs, and they carry no owner user (the suites log in as
 * the seeded admin, which must never be deleted).
 */

import { randomBytes } from "node:crypto";
import { and, eq, inArray, like, lt, notLike, or, sql } from "drizzle-orm";

function sqlNow() {
  return sql`now()`;
}
import { db, pdfTestFixturesTable, pdfTestRunsTable } from "@workspace/db";
import { STALE_RUN_AGE_MS, ensureRegistryProvisioned } from "./pdf-run-registry";

export { ensureRegistryProvisioned };

export const SUITE_RUN_PREFIX = "suite:";

/** Entity types the destructive HTTP suites create. */
export type SuiteEntityType =
  | "invoice"
  | "stock_purchase"
  | "purchase_bill"
  | "user"
  | "wholesale_trader"
  | "wholesale_invoice"
  | "wholesale_return";

/** Deletion order matters: invoices first (frees consumed FIFO batches). */
const RECOVERY_ORDER: SuiteEntityType[] = [
  "invoice",
  "wholesale_invoice",
  "wholesale_return",
  "stock_purchase",
  "purchase_bill",
  "wholesale_trader",
  "user",
];

/**
 * Per-entity deleter supplied by the calling script (it owns the HTTP session).
 * Must return:
 *  - "deleted": the record was removed
 *  - "missing": the record no longer exists (already cleaned)
 *  - "kept":    the record could not be removed (e.g. 409); keep it registered
 */
export type SuiteFixtureDeleter = (
  entityType: SuiteEntityType,
  entityId: number,
  runId: string,
) => Promise<"deleted" | "missing" | "kept">;

/**
 * Starts a new registered suite run. Call after recovery, before fixtures.
 * `ownerUserId` is the logged-in admin's user ID: the API only registers
 * fixtures server-side (atomically with creation) for runs owned by the
 * requesting session, so ownership must be recorded here.
 */
export async function startSuiteRun(suiteName: string, ownerUserId: number): Promise<string> {
  const runId = `${SUITE_RUN_PREFIX}${suiteName}:${randomBytes(16).toString("hex")}`;
  await db.insert(pdfTestRunsTable).values({ runId, ownerUserId });
  return runId;
}

/** Registers a created record by exact ID, idempotently. */
export async function registerSuiteFixture(
  runId: string,
  entityType: SuiteEntityType,
  entityId: number,
): Promise<void> {
  await db.insert(pdfTestFixturesTable)
    .values({ runId, entityType, entityId })
    .onConflictDoNothing();
}

/**
 * Removes the registry row after the script deleted the record itself.
 * (The API already unregisters "invoice"/"stock_purchase" rows server-side on
 * delete; calling this too is harmless and covers "purchase_bill"/"user".)
 */
export async function unregisterSuiteFixture(
  runId: string,
  entityType: SuiteEntityType,
  entityId: number,
): Promise<void> {
  await db.delete(pdfTestFixturesTable).where(and(
    eq(pdfTestFixturesTable.runId, runId),
    eq(pdfTestFixturesTable.entityType, entityType),
    eq(pdfTestFixturesTable.entityId, entityId),
  ));
}

export interface SuiteRecoveryResult {
  claimedRunIds: string[];
  deleted: number;
  kept: number;
  reclaimedRunIds: string[];
}

export type SuiteRecoveryScope = "standard" | "wholesale";

/**
 * Recovers abandoned suite runs. Only registered records are ever touched,
 * strictly by the exact IDs stored in the registry.
 *
 * A run is recoverable when it is already "abandoned" (a previous run's
 * finalize marked it after a failure) or when it is still "active" but older
 * than the stale-age gate. Liveness is established by SERIALIZATION, not age
 * alone: every suite package script runs under the shared exclusive flock
 * (/tmp/gold-shop-suite-registry.lock), so while recovery executes no other
 * suite process can be alive — any "active" suite run it sees belongs to a
 * killed process. The age gate is defense in depth for a script launched
 * directly without the lock wrapper. Claiming happens via a status transition
 * to "recovering", so even two unserialized recoveries can never process the
 * same run twice.
 */
export async function recoverAbandonedSuiteRuns(
  deleteFixture: SuiteFixtureDeleter,
  now: Date = new Date(),
  scope: SuiteRecoveryScope = "standard",
): Promise<SuiteRecoveryResult> {
  const cutoff = new Date(now.getTime() - STALE_RUN_AGE_MS);
  const namespaceCondition = scope === "wholesale"
    ? like(pdfTestRunsTable.runId, `${SUITE_RUN_PREFIX}wholesale-regression%`)
    : and(
        like(pdfTestRunsTable.runId, `${SUITE_RUN_PREFIX}%`),
        notLike(pdfTestRunsTable.runId, `${SUITE_RUN_PREFIX}wholesale-regression%`),
      );
  // Claiming stamps createdAt as the lease time: a process killed mid-recovery
  // leaves its runs in "recovering", and they become reclaimable once the
  // lease is older than the stale gate — so their exact fixture IDs are never
  // stranded, while a concurrent fresh claim can never be stolen.
  const claimed = await db.update(pdfTestRunsTable)
    .set({ status: "recovering", createdAt: sqlNow() })
    .where(and(
      namespaceCondition,
      or(
        eq(pdfTestRunsTable.status, "abandoned"),
        and(
          inArray(pdfTestRunsTable.status, ["active", "recovering"]),
          lt(pdfTestRunsTable.createdAt, cutoff),
        ),
      ),
    ))
    .returning({ runId: pdfTestRunsTable.runId });
  const claimedRunIds = claimed.map((row) => row.runId);
  if (claimedRunIds.length === 0) {
    return { claimedRunIds: [], deleted: 0, kept: 0, reclaimedRunIds: [] };
  }

  const fixtures = await db.select({
    runId: pdfTestFixturesTable.runId,
    entityType: pdfTestFixturesTable.entityType,
    entityId: pdfTestFixturesTable.entityId,
  })
    .from(pdfTestFixturesTable)
    .where(inArray(pdfTestFixturesTable.runId, claimedRunIds));

  let deleted = 0;
  let kept = 0;
  for (const type of RECOVERY_ORDER) {
    for (const fixture of fixtures) {
      if (fixture.entityType !== type) continue;
      const outcome = await deleteFixture(type, fixture.entityId, fixture.runId);
      if (outcome === "kept") {
        kept += 1;
        continue;
      }
      deleted += outcome === "deleted" ? 1 : 0;
      await db.delete(pdfTestFixturesTable).where(and(
        eq(pdfTestFixturesTable.runId, fixture.runId),
        eq(pdfTestFixturesTable.entityType, fixture.entityType),
        eq(pdfTestFixturesTable.entityId, fixture.entityId),
      ));
    }
  }

  // Reclaim runs whose registries are now empty; keep the rest ("abandoned")
  // so their exact IDs stay recoverable next time.
  const remaining = await db.selectDistinct({ runId: pdfTestFixturesTable.runId })
    .from(pdfTestFixturesTable)
    .where(inArray(pdfTestFixturesTable.runId, claimedRunIds));
  const stillOwned = new Set(remaining.map((row) => row.runId));
  const reclaimedRunIds = claimedRunIds.filter((runId) => !stillOwned.has(runId));
  if (reclaimedRunIds.length > 0) {
    await db.delete(pdfTestRunsTable).where(inArray(pdfTestRunsTable.runId, reclaimedRunIds));
  }
  const keptRunIds = claimedRunIds.filter((runId) => stillOwned.has(runId));
  if (keptRunIds.length > 0) {
    await db.update(pdfTestRunsTable)
      .set({ status: "abandoned" })
      .where(inArray(pdfTestRunsTable.runId, keptRunIds));
  }
  return { claimedRunIds, deleted, kept, reclaimedRunIds };
}

/**
 * End-of-run finalization. Deletes the run row only when the suite passed AND
 * no registered fixture remains (verified cleanup). Otherwise the run is
 * marked "abandoned" so a later run recovers the exact retained IDs.
 */
export async function finalizeSuiteRun(runId: string, suiteSucceeded: boolean): Promise<{
  cleaned: boolean;
  remainingFixtures: number;
}> {
  const remaining = await db.select({ id: pdfTestFixturesTable.id })
    .from(pdfTestFixturesTable)
    .where(eq(pdfTestFixturesTable.runId, runId));
  if (!suiteSucceeded || remaining.length > 0) {
    await db.update(pdfTestRunsTable)
      .set({ status: "abandoned" })
      .where(eq(pdfTestRunsTable.runId, runId));
    return { cleaned: false, remainingFixtures: remaining.length };
  }
  await db.delete(pdfTestRunsTable).where(eq(pdfTestRunsTable.runId, runId));
  return { cleaned: true, remainingFixtures: 0 };
}
