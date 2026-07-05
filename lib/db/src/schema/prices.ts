import { pgTable, serial, timestamp, numeric, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricesTable = pgTable("prices", {
  id: serial("id").primaryKey(),
  goldPricePerGram: numeric("gold_price_per_gram", { precision: 12, scale: 4 }).notNull().default("320.00"),
  silverPricePerGram: numeric("silver_price_per_gram", { precision: 12, scale: 4 }).notNull().default("4.50"),
  goldJewelryRate: numeric("gold_jewelry_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  goldBullionRate: numeric("gold_bullion_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  ttBarRate: numeric("tt_bar_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  kgBarRate: numeric("kg_bar_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  customDescriptions: text("custom_descriptions").notNull().default("[]"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  liveModeConnected: boolean("live_mode_connected").notNull().default(false),
  liveGoldRate24k: numeric("live_gold_rate_24k", { precision: 12, scale: 4 }),
  liveGoldRate22k: numeric("live_gold_rate_22k", { precision: 12, scale: 4 }),
  liveSilverRate: numeric("live_silver_rate", { precision: 12, scale: 4 }),
  liveLastSyncedAt: timestamp("live_last_synced_at", { withTimezone: true }),
  preLiveGoldJewelryRate: numeric("pre_live_gold_jewelry_rate", { precision: 12, scale: 4 }),
  preLiveGoldBullionRate: numeric("pre_live_gold_bullion_rate", { precision: 12, scale: 4 }),
  preLiveTtBarRate: numeric("pre_live_tt_bar_rate", { precision: 12, scale: 4 }),
  preLiveKgBarRate: numeric("pre_live_kg_bar_rate", { precision: 12, scale: 4 }),
  preLiveSilverPricePerGram: numeric("pre_live_silver_price_per_gram", { precision: 12, scale: 4 }),
});

export const insertPricesSchema = createInsertSchema(pricesTable).omit({ id: true, updatedAt: true });
export type InsertPrices = z.infer<typeof insertPricesSchema>;
export type Prices = typeof pricesTable.$inferSelect;
