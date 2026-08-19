/**
 * Durable registry helpers for the destructive browser PDF regression.
 *
 * The registry (pdf_test_runs / pdf_test_fixtures) records exactly which shop
 * records a PDF test run created, so an interrupted run can later be recovered
 * by exact ID — never by prefix-wide deletion.
 */

import { sql, and, eq, inArray, isNotNull, lt, ne, notInArray, notLike } from "drizzle-orm";
import { db, pdfTestFixturesTable, pdfTestRunsTable, usersTable } from "@workspace/db";

export const TEST_USERNAME_PREFIX = "__pdf_e2e_ephemeral__";
export const TEST_FULL_NAME = "PDF Regression Admin (Ephemeral)";
export const STALE_RUN_AGE_MS = 5 * 60 * 1000;

/**
 * Idempotently provisions the registry tables. The project applies schema via
 * drizzle-kit push in development; this guard mirrors lib/db/src/schema/
 * pdf-test-fixtures.ts so the workflow also works on a database that has not
 * received a separate schema push yet.
 */
export async function ensureRegistryProvisioned(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pdf_test_runs (
      id serial PRIMARY KEY,
      run_id text NOT NULL UNIQUE,
      owner_user_id integer REFERENCES users(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pdf_test_fixtures (
      id serial PRIMARY KEY,
      run_id text NOT NULL REFERENCES pdf_test_runs(run_id) ON DELETE CASCADE,
      entity_type text NOT NULL,
      entity_id integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS pdf_test_fixtures_run_entity_idx
      ON pdf_test_fixtures (run_id, entity_type, entity_id)
  `);
}

export interface StaleRunRecovery {
  abandonedRunIds: string[];
  deletedAdminIds: number[];
  reclaimedRunIds: string[];
}

/**
 * Age-gated startup recovery. Marks registry rows old enough that they cannot
 * belong to a live process as abandoned (the package script's flock also
 * serializes runs), deletes their ephemeral admins strictly by the owner IDs
 * recorded in the registry, and reclaims abandoned runs that own no fixtures.
 * Runs that DO own fixtures are kept so recovery can remove those exact IDs.
 */
export async function recoverStaleRuns(now: Date = new Date()): Promise<StaleRunRecovery> {
  const cutoff = new Date(now.getTime() - STALE_RUN_AGE_MS);
  const staleRuns = await db.update(pdfTestRunsTable)
    .set({ status: "abandoned" })
    .where(and(
      ne(pdfTestRunsTable.status, "abandoned"),
      lt(pdfTestRunsTable.createdAt, cutoff),
      // Suite runs (runId prefixed "suite:") belong to the HTTP test suites'
      // own registry lifecycle; the browser-PDF recovery must never mutate
      // them — abandoning a live suite run would break its atomic fixture
      // registration and expose its exact IDs to the suite recovery path.
      notLike(pdfTestRunsTable.runId, "suite:%"),
    ))
    .returning({
      runId: pdfTestRunsTable.runId,
      ownerUserId: pdfTestRunsTable.ownerUserId,
    });

  // Never select stale admins by mutable username/full-name fields alone; the
  // recorded owner ID is the selector, the rest is defense in depth.
  const staleOwnerIds = [...new Set(
    staleRuns.map((run) => run.ownerUserId).filter((id): id is number => id != null),
  )];
  const deletedAdminIds: number[] = [];
  if (staleOwnerIds.length > 0) {
    const deleted = await db.delete(usersTable).where(and(
      inArray(usersTable.id, staleOwnerIds),
      eq(usersTable.role, "admin"),
      eq(usersTable.fullName, TEST_FULL_NAME),
    )).returning({ id: usersTable.id });
    deletedAdminIds.push(...deleted.map((row) => row.id));
  }

  const staleRunIds = staleRuns.map((run) => run.runId);
  const reclaimedRunIds: string[] = [];
  if (staleRunIds.length > 0) {
    const fixtureOwners = await db.selectDistinct({ runId: pdfTestFixturesTable.runId })
      .from(pdfTestFixturesTable)
      .where(inArray(pdfTestFixturesTable.runId, staleRunIds));
    const runIdsWithFixtures = fixtureOwners.map((row) => row.runId);
    const reclaimed = await db.delete(pdfTestRunsTable).where(and(
      inArray(pdfTestRunsTable.runId, staleRunIds),
      eq(pdfTestRunsTable.status, "abandoned"),
      runIdsWithFixtures.length > 0
        ? notInArray(pdfTestRunsTable.runId, runIdsWithFixtures)
        : isNotNull(pdfTestRunsTable.runId),
    )).returning({ runId: pdfTestRunsTable.runId });
    reclaimedRunIds.push(...reclaimed.map((row) => row.runId));
  }

  return { abandonedRunIds: staleRunIds, deletedAdminIds, reclaimedRunIds };
}

/**
 * End-of-run finalization. Deletes the run rows and the ephemeral admin ONLY
 * when the browser suite succeeded AND its registry holds no remaining
 * fixtures (verified cleanup). On any failure — or if any registered record
 * still exists — the registry and admin are retained (admin deactivated) so a
 * later run's age-gated recovery can remove the exact retained IDs.
 */
export async function finalizeRun(ownerUserId: number, testSucceeded: boolean): Promise<{
  cleaned: boolean;
  remainingFixtures: number;
}> {
  const remaining = await db.select({ id: pdfTestFixturesTable.id })
    .from(pdfTestFixturesTable)
    .innerJoin(pdfTestRunsTable, eq(pdfTestFixturesTable.runId, pdfTestRunsTable.runId))
    .where(eq(pdfTestRunsTable.ownerUserId, ownerUserId));

  if (!testSucceeded || remaining.length > 0) {
    // Keep run + fixture rows so the exact IDs stay recoverable, but make sure
    // the ephemeral credentials cannot be used for anything else.
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, ownerUserId));
    return { cleaned: false, remainingFixtures: remaining.length };
  }

  await db.delete(pdfTestRunsTable).where(eq(pdfTestRunsTable.ownerUserId, ownerUserId));
  await db.delete(usersTable).where(eq(usersTable.id, ownerUserId));
  return { cleaned: true, remainingFixtures: 0 };
}
