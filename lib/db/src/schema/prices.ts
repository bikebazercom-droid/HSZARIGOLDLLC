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
  ttBar24kRate: numeric("tt_bar_24k_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  kgBarRate: numeric("kg_bar_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  // First-class core asset rates for the three jewelry karats — manually
  // editable and independently saved, exactly like ttBarRate/kgBarRate above.
  // Auto-populated from the live spot rate on Connect, just like the others.
  gold22kRate: numeric("gold_22k_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  gold21kRate: numeric("gold_21k_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  gold18kRate: numeric("gold_18k_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  // GOLD 9999 (1GM / 1KG) — same per-gram rate for both weight variants.
  // Manual-editable/live-syncable parity with the other core assets above:
  // auto-populated from goldBullionRate * 0.9999 on Connect.
  gold9999Rate: numeric("gold_9999_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  // GOLD KG (0.9999) — per-gram rate for invoice/admin; TV board shows 1KG total.
  goldKg9999Rate: numeric("gold_kg_9999_rate", { precision: 12, scale: 4 }).notNull().default("320.00"),
  // ── International spot pricing engine ─────────────────────────────────────
  // spreadPremiumAed: fixed AED buffer added on top of the raw international
  // spot conversion (Base_24K_AED) to arrive at the shop's working baseline
  // (Final_24K = Base_24K_AED + spreadPremiumAed). Admin-configurable.
  spreadPremiumAed: numeric("spread_premium_aed", { precision: 12, scale: 4 }).notNull().default("0"),
  // laborCostPercent: percentage markup applied ONLY to jewelry rows (22K,
  // 21K, 18K) on top of their purity-adjusted Final_24K value. Admin-configurable.
  laborCostPercent: numeric("labor_cost_percent", { precision: 8, scale: 4 }).notNull().default("0"),
  customDescriptions: text("custom_descriptions").notNull().default("[]"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  liveModeConnected: boolean("live_mode_connected").notNull().default(false),
  manualInvoiceMode: boolean("manual_invoice_mode").notNull().default(false),
  liveApiKey: text("live_api_key"),
  // "free" = livepriceofgold.com socket feed (Bid/Ask estimated via fixed spread).
  // "goldapi" = paid GoldAPI.io REST feed (real Bid/Ask/High/Low), requires liveApiKey.
  liveApiProvider: text("live_api_provider").notNull().default("free"),
  liveGoldRate24k: numeric("live_gold_rate_24k", { precision: 12, scale: 4 }),
  liveGoldRate22k: numeric("live_gold_rate_22k", { precision: 12, scale: 4 }),
  liveSilverRate: numeric("live_silver_rate", { precision: 12, scale: 4 }),
  // Raw market metrics (AED per troy ounce) for the showroom TV board's BID/ASK/Low/High
  // tiles. Only populated when the provider (GoldAPI.io) supplies them; null otherwise
  // (e.g. MetalpriceAPI.com or manual/disconnected mode) — never a first-class editable asset.
  liveGoldBid: numeric("live_gold_bid", { precision: 12, scale: 4 }),
  liveGoldAsk: numeric("live_gold_ask", { precision: 12, scale: 4 }),
  liveGoldHigh: numeric("live_gold_high", { precision: 12, scale: 4 }),
  liveGoldLow: numeric("live_gold_low", { precision: 12, scale: 4 }),
  liveLastSyncedAt: timestamp("live_last_synced_at", { withTimezone: true }),
  preLiveGoldJewelryRate: numeric("pre_live_gold_jewelry_rate", { precision: 12, scale: 4 }),
  preLiveGoldBullionRate: numeric("pre_live_gold_bullion_rate", { precision: 12, scale: 4 }),
  preLiveTtBarRate: numeric("pre_live_tt_bar_rate", { precision: 12, scale: 4 }),
  preLiveTtBar24kRate: numeric("pre_live_tt_bar_24k_rate", { precision: 12, scale: 4 }),
  preLiveKgBarRate: numeric("pre_live_kg_bar_rate", { precision: 12, scale: 4 }),
  preLiveSilverPricePerGram: numeric("pre_live_silver_price_per_gram", { precision: 12, scale: 4 }),
  preLiveGold22kRate: numeric("pre_live_gold_22k_rate", { precision: 12, scale: 4 }),
  preLiveGold21kRate: numeric("pre_live_gold_21k_rate", { precision: 12, scale: 4 }),
  preLiveGold18kRate: numeric("pre_live_gold_18k_rate", { precision: 12, scale: 4 }),
  preLiveGold9999Rate: numeric("pre_live_gold_9999_rate", { precision: 12, scale: 4 }),
  // ── Live rate manual offsets ───────────────────────────────────────────────
  // AED amount added to the computed live price for each item type.
  // Positive = premium, negative = discount. Applied after all spread/purity/labor.
  gold9999Offset:    numeric("gold_9999_offset",    { precision: 12, scale: 4 }).notNull().default("0"),
  jewellery22kOffset: numeric("jewellery_22k_offset", { precision: 12, scale: 4 }).notNull().default("0"),

  // TV board row visibility — admin can hide individual rows from the showroom TV
  tvShowTtBar995: boolean("tv_show_tt_bar_995").notNull().default(true),
  tvShowTtBar999: boolean("tv_show_tt_bar_999").notNull().default(true),
  tvShowGold9999: boolean("tv_show_gold_9999").notNull().default(true),
  tvShowKgBar995: boolean("tv_show_kg_bar_995").notNull().default(true),
  tvShowGold22k:  boolean("tv_show_gold_22k").notNull().default(true),
  tvShowGold21k:  boolean("tv_show_gold_21k").notNull().default(true),
  tvShowGold18k:  boolean("tv_show_gold_18k").notNull().default(true),
  tvShowGoldKg9999: boolean("tv_show_gold_kg_9999").notNull().default(true),
});

export const insertPricesSchema = createInsertSchema(pricesTable).omit({ id: true, updatedAt: true });
export type InsertPrices = z.infer<typeof insertPricesSchema>;
export type Prices = typeof pricesTable.$inferSelect;
