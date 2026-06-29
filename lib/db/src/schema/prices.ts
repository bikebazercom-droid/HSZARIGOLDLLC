import { pgTable, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricesTable = pgTable("prices", {
  id: serial("id").primaryKey(),
  goldPricePerGram: numeric("gold_price_per_gram", { precision: 12, scale: 4 }).notNull().default("320.00"),
  silverPricePerGram: numeric("silver_price_per_gram", { precision: 12, scale: 4 }).notNull().default("4.50"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPricesSchema = createInsertSchema(pricesTable).omit({ id: true, updatedAt: true });
export type InsertPrices = z.infer<typeof insertPricesSchema>;
export type Prices = typeof pricesTable.$inferSelect;
