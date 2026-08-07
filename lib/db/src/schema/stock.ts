import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

export const insertStockPurchaseSchema = createInsertSchema(stockPurchasesTable).omit({ id: true, createdAt: true });
export type InsertStockPurchase = z.infer<typeof insertStockPurchaseSchema>;
export type StockPurchase = typeof stockPurchasesTable.$inferSelect;
export type StockLevel = typeof stockLevelsTable.$inferSelect;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
export type InventoryConsumption = typeof inventoryConsumptionsTable.$inferSelect;
