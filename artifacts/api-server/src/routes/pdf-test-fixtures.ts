import { Router, type IRouter, type Request } from "express";
import { and, eq, ne, notLike } from "drizzle-orm";
import {
  db,
  pdfTestFixturesTable,
  pdfTestRunsTable,
  usersTable,
  wholesaleInvoicesTable,
  wholesaleTradersTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

class RecoveryConflictError extends Error {
  constructor() {
    super("PDF test run is not abandoned");
  }
}
const TEST_USERNAME_PREFIX = "__pdf_e2e_ephemeral__";
export const PDF_TEST_RUN_HEADER = "x-pdf-e2e-run-id";

// Suite runs belong to the destructive HTTP test suites (audit guards etc.).
// They are namespaced with a "suite:" prefix so they can never collide with
// the 32-hex browser-run IDs, and they are owned by the logged-in admin.
const SUITE_RUN_ID_PATTERN = /^suite:[a-z0-9-]+:[a-f0-9]{32}$/;

export type TestFixtureEntityType =
  | "invoice"
  | "stock_purchase"
  | "purchase_bill"
  | "user"
  | "wholesale_trader"
  | "wholesale_invoice"
  | "wholesale_return";

function runIdFromRequest(req: Request): string | null {
  const value = req.headers[PDF_TEST_RUN_HEADER];
  if (typeof value !== "string") return null;
  return /^[a-f0-9]{32}$/.test(value) || SUITE_RUN_ID_PATTERN.test(value) ? value : null;
}

async function isEphemeralPdfAdmin(userId: number | undefined): Promise<boolean> {
  if (!userId) return false;
  const [user] = await db.select({
    username: usersTable.username,
    role: usersTable.role,
    isActive: usersTable.isActive,
  }).from(usersTable).where(eq(usersTable.id, userId));
  return Boolean(user?.isActive && user.role === "admin" && user.username.startsWith(TEST_USERNAME_PREFIX));
}

export async function authorizePdfTestRun(req: Request): Promise<{
  requested: boolean;
  runId: string | null;
}> {
  const requested = req.headers[PDF_TEST_RUN_HEADER] != null;
  const runId = runIdFromRequest(req);
  if (!requested || !runId) return { requested, runId: null };
  const [run] = await db.select({ runId: pdfTestRunsTable.runId })
    .from(pdfTestRunsTable)
    .where(and(
      eq(pdfTestRunsTable.runId, runId),
      eq(pdfTestRunsTable.ownerUserId, req.session.userId!),
      eq(pdfTestRunsTable.status, "active"),
    ));
  if (!run) return { requested, runId: null };
  // Suite runs are owned by the (seeded) admin that started them; requireAdmin
  // already gates the route and ownership is enforced by the query above.
  // Browser PDF runs additionally require the ephemeral test admin.
  if (SUITE_RUN_ID_PATTERN.test(runId)) return { requested, runId };
  return {
    requested,
    runId: (await isEphemeralPdfAdmin(req.session.userId)) ? runId : null,
  };
}

export async function registerPdfTestFixture(
  tx: typeof db,
  runId: string | null,
  entityType: TestFixtureEntityType,
  entityId: number,
): Promise<void> {
  if (!runId) return;
  await tx.insert(pdfTestFixturesTable).values({ runId, entityType, entityId })
    .onConflictDoNothing();
}

/**
 * Removes registry rows for a record that is being deleted, inside the same
 * transaction. The registry must only ever list records that still exist so
 * end-of-run verification can distinguish cleaned runs from interrupted ones.
 */
export async function unregisterPdfTestFixture(
  tx: typeof db,
  entityType: TestFixtureEntityType,
  entityId: number,
): Promise<void> {
  await tx.delete(pdfTestFixturesTable).where(and(
    eq(pdfTestFixturesTable.entityType, entityType),
    eq(pdfTestFixturesTable.entityId, entityId),
  ));
}

router.get("/test-fixtures/pdf/abandoned", requireAdmin, async (req, res): Promise<void> => {
  const currentRunId = runIdFromRequest(req);
  if (!currentRunId || !(await isEphemeralPdfAdmin(req.session.userId))) {
    res.sendStatus(403);
    return;
  }
  const [currentRun] = await db.select({ runId: pdfTestRunsTable.runId })
    .from(pdfTestRunsTable)
    .where(and(
      eq(pdfTestRunsTable.runId, currentRunId),
      eq(pdfTestRunsTable.ownerUserId, req.session.userId!),
      eq(pdfTestRunsTable.status, "active"),
    ));
  if (!currentRun) {
    res.sendStatus(403);
    return;
  }

  // Suite runs (runId prefixed "suite:") belong to the HTTP test suites and
  // are recovered by their own runner-side path — never by the browser flow.
  const [fixtures, runs] = await Promise.all([
    db.select({
      runId: pdfTestFixturesTable.runId,
      entityType: pdfTestFixturesTable.entityType,
      entityId: pdfTestFixturesTable.entityId,
    }).from(pdfTestFixturesTable)
      .innerJoin(pdfTestRunsTable, eq(pdfTestFixturesTable.runId, pdfTestRunsTable.runId))
      .where(and(
        ne(pdfTestFixturesTable.runId, currentRunId),
        eq(pdfTestRunsTable.status, "abandoned"),
        notLike(pdfTestRunsTable.runId, "suite:%"),
      )),
    db.select({ runId: pdfTestRunsTable.runId }).from(pdfTestRunsTable)
      .where(and(
        ne(pdfTestRunsTable.runId, currentRunId),
        eq(pdfTestRunsTable.status, "abandoned"),
        notLike(pdfTestRunsTable.runId, "suite:%"),
      )),
  ]);
  res.json({ fixtures, runIds: runs.map((run) => run.runId) });
});

router.post("/test-fixtures/pdf/complete", requireAdmin, async (req, res): Promise<void> => {
  const runId = runIdFromRequest(req);
  if (!runId || !(await isEphemeralPdfAdmin(req.session.userId))) {
    res.sendStatus(403);
    return;
  }
  // Keep the row (status "completed") so a crashed runner's ephemeral admin
  // stays findable by the ownerUserId recorded here.
  await db.update(pdfTestRunsTable)
    .set({ status: "completed" })
    .where(and(
      eq(pdfTestRunsTable.runId, runId),
      eq(pdfTestRunsTable.ownerUserId, req.session.userId!),
      eq(pdfTestRunsTable.status, "active"),
    ));
  res.sendStatus(204);
});

router.post("/test-fixtures/pdf/abandon", requireAdmin, async (req, res): Promise<void> => {
  const runId = runIdFromRequest(req);
  if (!runId || !(await isEphemeralPdfAdmin(req.session.userId))) {
    res.sendStatus(403);
    return;
  }
  const [abandoned] = await db.update(pdfTestRunsTable)
    .set({ status: "abandoned" })
    .where(and(
      eq(pdfTestRunsTable.runId, runId),
      eq(pdfTestRunsTable.ownerUserId, req.session.userId!),
      eq(pdfTestRunsTable.status, "active"),
    ))
    .returning({ runId: pdfTestRunsTable.runId });
  if (!abandoned) {
    res.sendStatus(404);
    return;
  }
  res.sendStatus(204);
});

router.delete("/test-fixtures/pdf/wholesale-traders/:id", requireAdmin, async (req, res): Promise<void> => {
  const currentRunId = runIdFromRequest(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const traderId = Number.parseInt(rawId, 10);
  const requestedOwnerRunId = typeof req.query.runId === "string" ? req.query.runId : currentRunId;
  if (
    !currentRunId
    || !requestedOwnerRunId
    || !/^[a-f0-9]{32}$/.test(requestedOwnerRunId)
    || !Number.isSafeInteger(traderId)
    || traderId <= 0
    || !(await isEphemeralPdfAdmin(req.session.userId))
  ) {
    res.sendStatus(403);
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    const [currentRun] = await tx.select({
      runId: pdfTestRunsTable.runId,
      ownerUserId: pdfTestRunsTable.ownerUserId,
      status: pdfTestRunsTable.status,
    })
      .from(pdfTestRunsTable)
      .where(eq(pdfTestRunsTable.runId, currentRunId))
      .for("update");
    if (
      !currentRun
      || currentRun.ownerUserId !== req.session.userId
      || currentRun.status !== "active"
    ) {
      return "forbidden" as const;
    }

    const ownerRun = requestedOwnerRunId === currentRunId
      ? currentRun
      : (await tx.select({
          runId: pdfTestRunsTable.runId,
          status: pdfTestRunsTable.status,
        })
          .from(pdfTestRunsTable)
          .where(eq(pdfTestRunsTable.runId, requestedOwnerRunId))
          .for("update"))[0];
    if (
      !ownerRun
      || (requestedOwnerRunId === currentRunId
        ? ownerRun.status !== "active"
        : ownerRun.status !== "abandoned")
    ) {
      return "forbidden" as const;
    }

    const [registered] = await tx.select({ id: pdfTestFixturesTable.id })
      .from(pdfTestFixturesTable)
      .where(and(
        eq(pdfTestFixturesTable.runId, requestedOwnerRunId),
        eq(pdfTestFixturesTable.entityType, "wholesale_trader"),
        eq(pdfTestFixturesTable.entityId, traderId),
      ))
      .for("update");
    if (!registered) return "not_found" as const;

    const [linkedInvoice] = await tx.select({ id: wholesaleInvoicesTable.id })
      .from(wholesaleInvoicesTable)
      .where(eq(wholesaleInvoicesTable.traderId, traderId))
      .limit(1);
    if (linkedInvoice) return "conflict" as const;

    await tx.delete(wholesaleTradersTable).where(eq(wholesaleTradersTable.id, traderId));
    await tx.delete(pdfTestFixturesTable).where(and(
      eq(pdfTestFixturesTable.runId, requestedOwnerRunId),
      eq(pdfTestFixturesTable.entityType, "wholesale_trader"),
      eq(pdfTestFixturesTable.entityId, traderId),
    ));
    return "deleted" as const;
  });

  if (outcome === "forbidden") {
    res.sendStatus(403);
    return;
  }
  if (outcome === "not_found") {
    res.sendStatus(404);
    return;
  }
  if (outcome === "conflict") {
    res.status(409).json({ error: "Delete registered wholesale invoices before their trader fixture" });
    return;
  }
  res.sendStatus(204);
});

router.post("/test-fixtures/pdf/recovery-complete", requireAdmin, async (req, res): Promise<void> => {
  const currentRunId = runIdFromRequest(req);
  const runIds: string[] = Array.isArray(req.body?.runIds)
    ? req.body.runIds.filter((value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{32}$/.test(value))
    : [];
  if (!currentRunId || runIds.length === 0 || !(await isEphemeralPdfAdmin(req.session.userId))) {
    res.status(400).json({ error: "A registered PDF test run and recovery run IDs are required" });
    return;
  }
  const [currentRun] = await db.select({ runId: pdfTestRunsTable.runId })
    .from(pdfTestRunsTable)
    .where(and(
      eq(pdfTestRunsTable.runId, currentRunId),
      eq(pdfTestRunsTable.ownerUserId, req.session.userId!),
      eq(pdfTestRunsTable.status, "active"),
    ));
  if (!currentRun || runIds.includes(currentRunId)) {
    res.sendStatus(403);
    return;
  }
  try {
    await db.transaction(async (tx) => {
      for (const staleRunId of new Set(runIds)) {
        // Lock the run row and refuse to touch anything not explicitly
        // abandoned — an active concurrent run's registry must never be erased.
        const [run] = await tx.select({ status: pdfTestRunsTable.status })
          .from(pdfTestRunsTable)
          .where(eq(pdfTestRunsTable.runId, staleRunId))
          .for("update");
        if (run && run.status !== "abandoned") {
          throw new RecoveryConflictError();
        }
        await tx.delete(pdfTestFixturesTable).where(eq(pdfTestFixturesTable.runId, staleRunId));
        await tx.delete(pdfTestRunsTable).where(and(
          eq(pdfTestRunsTable.runId, staleRunId),
          eq(pdfTestRunsTable.status, "abandoned"),
        ));
      }
    });
  } catch (error) {
    if (error instanceof RecoveryConflictError) {
      res.status(409).json({ error: "Refusing to recover a PDF test run that is not marked abandoned" });
      return;
    }
    throw error;
  }
  res.sendStatus(204);
});

export default router;