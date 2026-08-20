import { pgTable, text, serial, timestamp, numeric, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoicesTable } from "./invoices";

// One row per supplier purchase transaction (Purchase / Stock Entry drawer).
// Categories: gold, tt_bar, kg_bar, 995, gold_jewelry_22k, silver
export const stockPurchasesTable = pgTable("stock_purchases", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  supplierName: text("supplier_name").notNull(),
  purchaseDate: text("purchase_date").notNull(), // yyyy-MM-dd
  weightGrams: numeric("weight_grams", { precision: 14, scale: 4 }).notNull(),
  totalPriceAed: numeric("total_price_aed", { precision: 14, scale: 2 }).notNull(),
  pricePerGram: numeric("price_per_gram", { precision: 14, scale: 4 }).notNull(),
  // FIFO batch tracking: grams of this purchase lot not yet consumed by sales.
  // Initialized to weightGrams on insert; decremented by the inventory engine.
  remainingWeightGrams: numeric("remaining_weight_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  // Optional free-text narrative shown in listings and ledger statements,
  // e.g. "100.000 gms 22K recd @ 470/g".
  narrative: text("narrative"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Purchase bills: a supplier bill groups multiple line items. Each line item
// materializes as its own stock_purchases batch (so FIFO, ledgers, and
// statements keep working unchanged); the bill is the supplier-facing document.
export const purchaseBillsTable = pgTable("purchase_bills", {
  id: serial("id").primaryKey(),
  billNo: text("bill_no").notNull(),
  billDate: text("bill_date").notNull(), // yyyy-MM-dd
  supplierName: text("supplier_name").notNull(),
  supplierPhone: text("supplier_phone"),
  supplierEmail: text("supplier_email"),
  supplierAddress: text("supplier_address"),
  purchaseType: text("purchase_type").notNull(), // fixed | unfixed
  paymentStatus: text("payment_status").notNull(), // paid | unpaid | unfixed
  totalGrossGrams: numeric("total_gross_grams", { precision: 14, scale: 4 }).notNull(),
  totalPureGrams: numeric("total_pure_grams", { precision: 14, scale: 4 }).notNull(),
  totalAed: numeric("total_aed", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseBillItemsTable = pgTable("purchase_bill_items", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").notNull().references(() => purchaseBillsTable.id, { onDelete: "cascade" }),
  // The stock batch this line created; set null if the batch is deleted directly.
  stockPurchaseId: integer("stock_purchase_id").references(() => stockPurchasesTable.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  grossWeightGrams: numeric("gross_weight_grams", { precision: 14, scale: 4 }).notNull(),
  purityPercent: numeric("purity_percent", { precision: 7, scale: 3 }).notNull(), // e.g. 91.6
  pureWeightGrams: numeric("pure_weight_grams", { precision: 14, scale: 4 }).notNull(),
  rateAedPerG: numeric("rate_aed_per_g", { precision: 14, scale: 4 }).notNull(),
  makingChargeAed: numeric("making_charge_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  lineTotalAed: numeric("line_total_aed", { precision: 14, scale: 2 }).notNull(),
});

// FIFO consumption ledger: one row per (invoice item × purchase batch) slice.
// purchaseId is null when the sale exceeded available batches (shortfall costed
// at the category's average purchase rate) or the source batch was deleted.
export const inventoryConsumptionsTable = pgTable("inventory_consumptions", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  invoiceItemId: integer("invoice_item_id"),
  purchaseId: integer("purchase_id").references(() => stockPurchasesTable.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  weightGrams: numeric("weight_grams", { precision: 14, scale: 4 }).notNull(),
  costAed: numeric("cost_aed", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Live aggregated stock weight per category (updated on purchase + invoice sale).
export const stockLevelsTable = pgTable("stock_levels", {
  id: serial("id").primaryKey(),
  category: text("category").notNull().unique(),
  weightGrams: numeric("weight_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Immutable inventory log: every stock change (purchase in, sale out, reversal).
export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  type: text("type").notNull(), // purchase | sale | purchase_reversal
  weightGrams: numeric("weight_grams", { precision: 14, scale: 4 }).notNull(), // signed delta (+ in / - out)
  refType: text("ref_type"), // stock_purchase | invoice
  refId: integer("ref_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Immutable audit log for destructive admin actions (bill deletions, etc.).
// Stores who did what and when; details JSON captures a snapshot of the entity.
// A BRIN index on created_at keeps time-range scans fast as the table grows;
// BRIN is ideal here because rows are inserted in roughly chronological order.
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actor_id"), // session userId; null if indeterminate
    entityType: text("entity_type").notNull(), // e.g. "purchase_bill"
    entityId: integer("entity_id").notNull(),
    action: text("action").notNull(), // e.g. "delete"
    billNo: text("bill_no"), // denormalised for quick display without joins
    details: text("details").notNull(), // JSON snapshot of the deleted entity
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // BRIN index: very small (a few pages) yet speeds up date-range queries and
    // the retention-cleanup DELETE that scans by created_at.
    index("audit_log_created_at_brin_idx").using("brin", table.createdAt),
  ],
);

export const insertStockPurchaseSchema = createInsertSchema(stockPurchasesTable).omit({ id: true, createdAt: true });
export type InsertStockPurchase = z.infer<typeof insertStockPurchaseSchema>;
export type StockPurchase = typeof stockPurchasesTable.$inferSelect;
export type StockLevel = typeof stockLevelsTable.$inferSelect;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
export type InventoryConsumption = typeof inventoryConsumptionsTable.$inferSelect;
export type AuditLogEntry = typeof auditLogTable.$inferSelect;
