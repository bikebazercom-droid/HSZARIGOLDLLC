#!/usr/bin/env tsx
/**
 * Runs the destructive browser PDF regression with a short-lived admin.
 *
 * The generated mobile/PIN exist only in this process and its Playwright child.
 * Registry rows and the admin are removed only after verified cleanup; on any
 * failure they are retained so a later run can recover exact fixture IDs.
 */

import bcrypt from "bcryptjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pdfTestRunsTable, pool, usersTable } from "@workspace/db";
import {
  TEST_FULL_NAME,
  TEST_USERNAME_PREFIX,
  ensureRegistryProvisioned,
  finalizeRun,
  recoverStaleRuns,
} from "./pdf-run-registry";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(moduleDir, "../../..");

async function runBrowserTest(mobile: string, pin: string, runId: string, recoveryProbeRunId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["--filter", "@workspace/gold-shop", "run", "test:pdf-downloads"],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          PDF_E2E_BASE_URL: "http://localhost:80",
          PDF_E2E_ALLOW_DEV_MUTATIONS: "1",
          TEST_ADMIN_MOBILE: mobile,
          TEST_ADMIN_PIN: pin,
          PDF_E2E_RUN_ID: runId,
          PDF_E2E_RECOVERY_PROBE_RUN_ID: recoveryProbeRunId,
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`PDF browser test exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
      }
    });
  });
}

async function main(): Promise<void> {
  await ensureRegistryProvisioned();

  // A prior SIGKILL cannot run finally, so recover interrupted runs here.
  // Only registry rows old enough that they cannot belong to a live process
  // (the package script's flock also serializes runs) are marked abandoned.
  await recoverStaleRuns();

  const accountRunId = randomBytes(16).toString("hex");
  const pin = randomBytes(32).toString("base64url");
  const mobile = `${TEST_USERNAME_PREFIX}${accountRunId}`;
  const runId = randomBytes(16).toString("hex");
  const recoveryProbeRunId = randomBytes(16).toString("hex");

  // Create the admin and both run rows atomically so a kill between the two
  // inserts can never leave an admin the registry does not know about.
  const testAdmin = await db.transaction(async (tx) => {
    const [created] = await tx.insert(usersTable).values({
      username: `${TEST_USERNAME_PREFIX}${accountRunId}`,
      mobile,
      passwordHash: await bcrypt.hash(pin, 10),
      fullName: TEST_FULL_NAME,
      role: "admin",
      isActive: true,
    }).returning({ id: usersTable.id });
    if (!created) throw new Error("Could not create the short-lived PDF test admin");
    await tx.insert(pdfTestRunsTable).values([
      { runId, ownerUserId: created.id },
      // The browser suite turns this into an intentionally abandoned fixture, then
      // proves recovery removes only its registered IDs before normal assertions.
      { runId: recoveryProbeRunId, ownerUserId: created.id },
    ]);
    return created;
  });

  let testSucceeded = false;
  try {
    await runBrowserTest(mobile, pin, runId, recoveryProbeRunId);
    testSucceeded = true;
  } finally {
    // Registry rows and the admin are removed only after the suite passed AND
    // its registry verifiably holds no remaining fixtures. On failure they are
    // retained (admin deactivated) so the next run's age-gated recovery can
    // remove the exact retained IDs instead of losing them.
    const finalized = await finalizeRun(testAdmin.id, testSucceeded);
    if (!finalized.cleaned) {
      console.warn(
        `Retaining PDF test registry for later recovery (test ${testSucceeded ? "passed" : "failed"}, ` +
        `${finalized.remainingFixtures} registered fixture(s) still present).`,
      );
    }
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("\nPDF browser regression failed:", error);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
