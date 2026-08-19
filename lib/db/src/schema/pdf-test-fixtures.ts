import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Durable ownership records for the destructive PDF browser regression. These
// rows are intentionally separate from shop data so recovery never has to infer
// test ownership from a customer, supplier, or invoice-number prefix.
export const pdfTestRunsTable = pgTable("pdf_test_runs", {
  id: serial("id").primaryKey(),
  runId: text("run_id").notNull().unique(),
  ownerUserId: integer("owner_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pdfTestFixturesTable = pgTable(
  "pdf_test_fixtures",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull().references(() => pdfTestRunsTable.runId, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pdf_test_fixtures_run_entity_idx").on(table.runId, table.entityType, table.entityId),
  ],
);