import { createServer } from "http";
import { pool } from "@workspace/db";
import app, { initializeAppDependencies } from "./app.js";
import { logger } from "./lib/logger.js";
import { seedAdminUser } from "./lib/seed.js";
import { initSocketIO } from "./lib/socket.js";
import { startAuditLogCleanup } from "./services/auditLogCleanup.js";
import { migrateCategoryNames } from "./lib/categoryMigration.js";
import { migratePricesSingleton } from "./lib/pricesSingletonMigration.js";
import { initializePriceItems } from "./routes/price-items.js";
import {
  markStartupReady,
  setStartupStep,
} from "./lib/startupState.js";

const STARTUP_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const bindHost = "0.0.0.0";
const httpServer = createServer(app);
initSocketIO(httpServer);

httpServer.on("error", (err) => {
  logger.error({ err }, "HTTP server error");
  process.exitCode = 1;
});

async function runStartupStep(
  step: string,
  initialize: () => Promise<unknown>,
): Promise<void> {
  setStartupStep(step);
  logger.info({ step }, "Startup initialization started");
  try {
    await initialize();
    logger.info({ step }, "Startup initialization completed");
  } catch (error) {
    logger.error({ step, err: error }, "Startup initialization failed");
    console.error(
      `[startup] ${step} failed:`,
      error instanceof Error ? error.stack ?? error.message : error,
    );
    throw error;
  }
}

async function initializeDatabaseWithRetry(): Promise<void> {
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      await runStartupStep("database_connection", async () => {
        await pool.query("SELECT 1");
      });
      await runStartupStep("postgres_session_store", initializeAppDependencies);
      await runStartupStep("prices_singleton_migration", migratePricesSingleton);
      await runStartupStep("category_migration", migrateCategoryNames);
      await runStartupStep("admin_seed", seedAdminUser);
      await runStartupStep("price_items_seed", initializePriceItems);
      await runStartupStep("audit_log_cleanup", async () => {
        startAuditLogCleanup();
      });

      markStartupReady();
      logger.info("Database initialization completed; API is ready");
      return;
    } catch (error) {
      const retryDelayMs =
        STARTUP_RETRY_DELAYS_MS[
          Math.min(attempt - 1, STARTUP_RETRY_DELAYS_MS.length - 1)
        ];

      logger.warn(
        { attempt, retryDelayMs, err: error },
        "Database initialization failed; HTTP server remains available and initialization will retry",
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

httpServer.listen(port, bindHost, () => {
  logger.info({ host: bindHost, port }, "HTTP server listening");
  void initializeDatabaseWithRetry().catch((error) => {
    logger.fatal(
      { err: error },
      "Unexpected database initialization loop failure; HTTP listener remains active",
    );
    console.error(
      "[startup] initialization retry loop failed:",
      error instanceof Error ? error.stack ?? error.message : error,
    );
  });
});
