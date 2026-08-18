/**
 * Audit-log retention cleanup service.
 *
 * Deletes audit_log rows older than AUDIT_LOG_RETENTION_MONTHS (default 24).
 * Runs once at startup (after a short grace delay) and then on a daily interval
 * so the table never grows unbounded in long-running shops.
 *
 * The cutoff is intentionally generous — two years covers any realistic
 * accountability window while keeping the table at a manageable size.
 *
 * Each cleanup run that actually removes rows records a "retention_prune" entry
 * in the audit log itself so admins can see when automated pruning occurred.
 */

import { lt } from "drizzle-orm";
import { db, auditLogTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

// Configurable via environment variable; defaults to 24 months (2 years).
const RETENTION_MONTHS = (() => {
  const raw = process.env.AUDIT_LOG_RETENTION_MONTHS;
  if (!raw) return 24;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logger.warn({ raw }, "AUDIT_LOG_RETENTION_MONTHS is invalid; falling back to 24");
    return 24;
  }
  return parsed;
})();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function runCleanup(): Promise<void> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);

  try {
    const deleted = await db
      .delete(auditLogTable)
      .where(lt(auditLogTable.createdAt, cutoff))
      .returning({ id: auditLogTable.id });

    if (deleted.length > 0) {
      logger.info(
        { count: deleted.length, retentionMonths: RETENTION_MONTHS, cutoff: cutoff.toISOString() },
        "audit_log cleanup: removed old entries",
      );

      // Record the prune in the audit log so admins can see when automated
      // cleanup occurred. Actor is null (system action, no human involved).
      try {
        await db.insert(auditLogTable).values({
          actorId: null,
          entityType: "audit_log",
          entityId: 0,
          action: "retention_prune",
          billNo: null,
          details: JSON.stringify({
            deletedCount: deleted.length,
            retentionMonths: RETENTION_MONTHS,
            cutoff: cutoff.toISOString(),
            triggeredBy: "automatic_daily_cleanup",
          }),
        });
      } catch (auditErr) {
        // Writing the prune record is best-effort — the actual cleanup succeeded,
        // so only log and continue.
        logger.warn({ auditErr }, "audit_log cleanup: could not write prune audit entry");
      }
    } else {
      logger.debug(
        { retentionMonths: RETENTION_MONTHS, cutoff: cutoff.toISOString() },
        "audit_log cleanup: nothing to remove",
      );
    }
  } catch (err) {
    // Log and swallow — a failed cleanup is non-fatal; the next daily run will
    // retry and the table just grows slightly larger in the interim.
    logger.error({ err, retentionMonths: RETENTION_MONTHS }, "audit_log cleanup: error during deletion");
  }
}

/**
 * Start the background audit-log retention job.
 * Runs once after an initial grace period, then every 24 hours.
 */
export function startAuditLogCleanup(): void {
  // Initial run: wait 30 seconds so the server finishes startup before touching
  // the DB.  Using unref() so this timer does not prevent the process from
  // exiting cleanly during tests / restarts.
  const initialTimer = setTimeout(() => {
    void runCleanup();
  }, 30_000);
  if (initialTimer.unref) initialTimer.unref();

  // Subsequent runs every 24 hours.
  const interval = setInterval(() => {
    void runCleanup();
  }, ONE_DAY_MS);
  if (interval.unref) interval.unref();

  logger.info(
    { retentionMonths: RETENTION_MONTHS },
    "audit_log cleanup: scheduled (startup + daily)",
  );
}
