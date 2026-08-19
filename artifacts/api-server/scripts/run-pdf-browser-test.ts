#!/usr/bin/env tsx
/**
 * Runs the destructive browser PDF regression with a short-lived admin.
 *
 * The generated mobile/PIN exist only in this process and its Playwright child.
 * The account is removed after the browser fixtures have been cleaned up.
 */

import bcrypt from "bcryptjs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool, usersTable } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(moduleDir, "../../..");
const TEST_USERNAME_PREFIX = "__pdf_e2e_ephemeral__";
const TEST_FULL_NAME = "PDF Regression Admin (Ephemeral)";

async function runBrowserTest(mobile: string, pin: string): Promise<void> {
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
  // A prior SIGKILL cannot run finally. The reserved username + exact full name
  // make startup cleanup durable without ever matching a normal shop account.
  await db.delete(usersTable).where(and(
    like(usersTable.username, `${TEST_USERNAME_PREFIX}%`),
    eq(usersTable.fullName, TEST_FULL_NAME),
    eq(usersTable.role, "admin"),
  ));

  const runId = randomBytes(16).toString("hex");
  const pin = randomBytes(32).toString("base64url");
  const mobile = `${TEST_USERNAME_PREFIX}${runId}`;
  const [testAdmin] = await db.insert(usersTable).values({
    username: `${TEST_USERNAME_PREFIX}${runId}`,
    mobile,
    passwordHash: await bcrypt.hash(pin, 10),
    fullName: TEST_FULL_NAME,
    role: "admin",
    isActive: true,
  }).returning({ id: usersTable.id });

  if (!testAdmin) throw new Error("Could not create the short-lived PDF test admin");

  try {
    await runBrowserTest(mobile, pin);
  } finally {
    await db.delete(usersTable).where(eq(usersTable.id, testAdmin.id));
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error("\nPDF browser regression failed:", error);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});