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

async function startServer(): Promise<void> {
  await runStartupStep("database_connection", async () => {
    await pool.query("SELECT 1");
  });
  await runStartupStep("postgres_session_store", initializeAppDependencies);
  await runStartupStep("prices_singleton_migration", migratePricesSingleton);
  await runStartupStep("category_migration", migrateCategoryNames);
  await runStartupStep("admin_seed", seedAdminUser);
  await runStartupStep("price_items_seed", initializePriceItems);
  startAuditLogCleanup();
  httpServer.listen(port, bindHost, () => {
    logger.info({ host: bindHost, port }, "Server listening");
  });
}

startServer().catch((err) => {
  logger.fatal({ err }, "Server startup failed; see the preceding startup step for the database or migration error");
  process.exitCode = 1;
});
