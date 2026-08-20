import {
  pgTable, serial, text, numeric, boolean, integer, timestamp,
} from "drizzle-orm/pg-core";

// ── Formula types ─────────────────────────────────────────────────────────────
// "spot_per_gram" : price = baseAedPerGram × purityFactor + premiumOffsetAed
//                  (per-gram items: GOLD 9999, JEWELLERY 22K/21K/18K)
// "spot_bar"      : price = baseAedPerGram × weightGrams × purityFactor + premiumOffsetAed
//                  (fixed-weight bars: TEN TOLA BAR, KG BAR)
// "manual"        : price = manualRateAed  (admin-set fixed price, no spot link)
// ─────────────────────────────────────────────────────────────────────────────
export const priceItemsTable = pgTable("price_items", {
  id:               serial("id").primaryKey(),
  name:             text("name").notNull(),
  displayOrder:     integer("display_order").notNull().default(0),

  formulaType:      text("formula_type").notNull().default("spot_per_gram"),

  // Grams for bar items (spot_bar); null for per-gram or manual items.
  weightGrams:      numeric("weight_grams", { precision: 14, scale: 6 }),
  // Label shown in the TV board WEIGHT column (e.g. "TTB", "1KG", "1GM").
  weightLabel:      text("weight_label").notNull().default("1GM"),

  // Multiplier applied to the raw spot base (e.g. 0.9999, 0.9200, 0.9950).
  purityFactor:     numeric("purity_factor", { precision: 10, scale: 7 }).notNull().default("1.0"),

  // Fixed AED amount added after spot computation (positive = premium, negative = discount).
  premiumOffsetAed: numeric("premium_offset_aed", { precision: 12, scale: 4 }).notNull().default("0"),

  // Only used when formulaType = "manual".
  manualRateAed:    numeric("manual_rate_aed", { precision: 12, scale: 4 }),

  tvVisible:        boolean("tv_visible").notNull().default(true),
  // Core items are system defaults that cannot be deleted via the API.
  isCore:           boolean("is_core").notNull().default(false),

  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PriceItem       = typeof priceItemsTable.$inferSelect;
export type InsertPriceItem = typeof priceItemsTable.$inferInsert;
