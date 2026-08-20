import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricesTable = pgTable("prices", {
  id: serial("id").primaryKey(),
  singletonKey: integer("singleton_key").notNull().default(1),
  goldPricePerGram: numeric("gold_price_per_gram", { precision: 12, scale: 4 }).notNull().default("320.00"),
  silverPricePerGram: numeric("silver_price_per_gram", { precision: 12, scale: 4 }).notNull().default("4.50"),
  goldJewelryRate: numeric("gold_jewelry_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  goldBullionRate: numeric("gold_bullion_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  ttBarRate: numeric("tt_bar_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  ttBar24kRate: numeric("tt_bar_24k_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  kgBarRate: numeric("kg_bar_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  gold22kRate: numeric("gold_22k_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  gold21kRate: numeric("gold_21k_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  gold18kRate: numeric("gold_18k_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  gold9999Rate: numeric("gold_9999_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  goldKg9999Rate: numeric("gold_kg_9999_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  customDescriptions: text("custom_descriptions").notNull().default("[]"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  manualInvoiceMode: boolean("manual_invoice_mode").notNull().default(false),
}, (table) => [
  uniqueIndex("prices_singleton_key_unique").on(table.singletonKey),
  check("prices_singleton_key_check", sql`${table.singletonKey} = 1`),
]);

export const insertPricesSchema = createInsertSchema(pricesTable).omit({ id: true, updatedAt: true });
export type InsertPrices = z.infer<typeof insertPricesSchema>;
export type Prices = typeof pricesTable.$inferSelect;
