import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
