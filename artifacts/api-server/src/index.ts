import { createServer } from "http";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { seedAdminUser } from "./lib/seed.js";
import { initSocketIO } from "./lib/socket.js";
import { startAuditLogCleanup } from "./services/auditLogCleanup.js";
import { migrateCategoryNames } from "./lib/categoryMigration.js";
import { migratePricesSingleton } from "./lib/pricesSingletonMigration.js";
const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);
initSocketIO(httpServer);

httpServer.on("error", (err) => {
  logger.error({ err }, "HTTP server error");
  process.exit(1);
});

async function startServer(): Promise<void> {
  await migratePricesSingleton();
  await migrateCategoryNames();
  await seedAdminUser();
  startAuditLogCleanup();
  httpServer.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

startServer().catch((err) => {
  logger.fatal({ err }, "Server startup failed");
  process.exit(1);
});
