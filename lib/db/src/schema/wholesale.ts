import {
  pgTable,
  text,
  serial,
  timestamp,
  numeric,
  integer,
  boolean,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { stockPurchasesTable } from "./stock";

// ── Wholesale Traders ────────────────────────────────────────────────────────

export const wholesaleTradersTable = pgTable(
  "wholesale_traders",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    contactPerson: text("contact_person"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    trn: text("trn"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("wholesale_traders_name_idx").on(table.name),
  ],
);

export type WholesaleTrader = typeof wholesaleTradersTable.$inferSelect;
export const insertWholesaleTraderSchema = createInsertSchema(wholesaleTradersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWholesaleTrader = z.infer<typeof insertWholesaleTraderSchema>;

// ── Wholesale Invoices ───────────────────────────────────────────────────────

export const wholesaleInvoicesTable = pgTable(
  "wholesale_invoices",
  {
    id: serial("id").primaryKey(),
    invoiceNumber: text("invoice_number").notNull().unique(), // WSI-00001
    invoiceDate: text("invoice_date").notNull(), // yyyy-MM-dd
    // Trader snapshot (frozen at creation)
    traderId: integer("trader_id").references(() => wholesaleTradersTable.id, { onDelete: "set null" }),
    traderName: text("trader_name").notNull(),
    traderContactPerson: text("trader_contact_person"),
    traderPhone: text("trader_phone"),
    traderEmail: text("trader_email"),
    traderAddress: text("trader_address"),
    traderTrn: text("trader_trn"),
    // Invoice terms
    pricingType: text("pricing_type").notNull(), // fixed | unfixed | cash
    paymentMode: text("payment_mode"), // cash | card | bank_transfer
    notes: text("notes"),
    // Creator snapshot
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdByUserName: text("created_by_user_name"),
    // Status
    status: text("status").notNull().default("open"), // open | partially_settled | settled
    // Totals (denormalised for quick reads)
    totalGrossGrams: numeric("total_gross_grams", { precision: 14, scale: 4 }).notNull().default("0"),
    totalPureGrams: numeric("total_pure_grams", { precision: 14, scale: 4 }).notNull().default("0"),
    totalMakingAed: numeric("total_making_aed", { precision: 14, scale: 2 }).notNull().default("0"),
    totalAed: numeric("total_aed", { precision: 14, scale: 2 }).notNull().default("0"),
    // For unfixed invoices: grams of pure gold yet to be rate-fixed
    openPureGrams: numeric("open_pure_grams", { precision: 14, scale: 4 }).notNull().default("0"),
    // AED value posted to the immutable trader ledger so far.
    settledAed: numeric("settled_aed", { precision: 14, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("wholesale_invoices_trader_id_idx").on(table.traderId),
    index("wholesale_invoices_status_idx").on(table.status),
    index("wholesale_invoices_date_idx").on(table.invoiceDate),
  ],
);

export type WholesaleInvoice = typeof wholesaleInvoicesTable.$inferSelect;

// ── Wholesale Invoice Items ──────────────────────────────────────────────────

export const wholesaleInvoiceItemsTable = pgTable("wholesale_invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => wholesaleInvoicesTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  category: text("category").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull().default("1"),
  grossGrams: numeric("gross_grams", { precision: 14, scale: 4 }).notNull(),
  purityMultiplier: numeric("purity_multiplier", { precision: 6, scale: 4 }).notNull(),
  pureGrams: numeric("pure_grams", { precision: 14, scale: 4 }).notNull(),
  // null for unfixed items; positive AED/gram for fixed and cash-payment items
  rateAedPerGram: numeric("rate_aed_per_gram", { precision: 14, scale: 4 }),
  makingAed: numeric("making_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAed: numeric("total_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  // Server-owned counters (updated by rate-fix and return operations)
  fixedPureGrams: numeric("fixed_pure_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  returnedGrossGrams: numeric("returned_gross_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  returnedPureGrams: numeric("returned_pure_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  returnedFixedPureGrams: numeric("returned_fixed_pure_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  returnedMakingAed: numeric("returned_making_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  returnedMetalAed: numeric("returned_metal_aed", { precision: 14, scale: 2 }).notNull().default("0"),
});

export type WholesaleInvoiceItem = typeof wholesaleInvoiceItemsTable.$inferSelect;

// ── Wholesale Inventory Consumptions ────────────────────────────────────────
// One row per (wholesale invoice item × purchase batch) FIFO slice.
// returnedGrams tracks how many of those consumed grams have been physically returned.
// isShortfall distinguishes a deliberate oversell slice from a real purchase
// batch whose FK later became null; returns reconcile shortfalls but reject a
// missing real source batch.

export const wholesaleInventoryConsumptionsTable = pgTable(
  "wholesale_inventory_consumptions",
  {
    id: serial("id").primaryKey(),
    wholesaleInvoiceId: integer("wholesale_invoice_id").notNull().references(() => wholesaleInvoicesTable.id, { onDelete: "cascade" }),
    wholesaleItemId: integer("wholesale_item_id").notNull().references(() => wholesaleInvoiceItemsTable.id, { onDelete: "cascade" }),
    purchaseId: integer("purchase_id").references(() => stockPurchasesTable.id, { onDelete: "set null" }),
    isShortfall: boolean("is_shortfall").notNull().default(false),
    category: text("category").notNull(),
    consumedGrams: numeric("consumed_grams", { precision: 14, scale: 4 }).notNull(),
    costAed: numeric("cost_aed", { precision: 14, scale: 2 }).notNull(),
    returnedGrams: numeric("returned_grams", { precision: 14, scale: 4 }).notNull().default("0"),
    returnedCogsAed: numeric("returned_cogs_aed", { precision: 14, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ws_inv_consumptions_invoice_idx").on(table.wholesaleInvoiceId),
    index("ws_inv_consumptions_item_idx").on(table.wholesaleItemId),
  ],
);

export type WholesaleInventoryConsumption = typeof wholesaleInventoryConsumptionsTable.$inferSelect;

// ── Wholesale Settlements (rate-fix events) ──────────────────────────────────
// Immutable. Each partial or full rate-fix creates one row.

export const wholesaleSettlementsTable = pgTable("wholesale_settlements", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => wholesaleInvoicesTable.id, { onDelete: "cascade" }),
  settlementDate: text("settlement_date").notNull(), // yyyy-MM-dd
  pureWeightGrams: numeric("pure_weight_grams", { precision: 14, scale: 4 }).notNull(),
  rateAedPerGram: numeric("rate_aed_per_gram", { precision: 14, scale: 4 }).notNull(),
  aedAmount: numeric("aed_amount", { precision: 14, scale: 2 }).notNull(),
  note: text("note"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByUserName: text("created_by_user_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WholesaleSettlement = typeof wholesaleSettlementsTable.$inferSelect;

// Per-item allocations make each rate-fix event reportable by date and category.
export const wholesaleSettlementAllocationsTable = pgTable(
  "wholesale_settlement_allocations",
  {
    id: serial("id").primaryKey(),
    settlementId: integer("settlement_id").notNull().references(() => wholesaleSettlementsTable.id, { onDelete: "cascade" }),
    invoiceItemId: integer("invoice_item_id").notNull().references(() => wholesaleInvoiceItemsTable.id, { onDelete: "cascade" }),
    pureWeightGrams: numeric("pure_weight_grams", { precision: 14, scale: 4 }).notNull(),
    rateAedPerGram: numeric("rate_aed_per_gram", { precision: 14, scale: 4 }).notNull(),
    aedAmount: numeric("aed_amount", { precision: 14, scale: 2 }).notNull(),
    returnedPureWeightGrams: numeric("returned_pure_weight_grams", { precision: 14, scale: 4 }).notNull().default("0"),
    returnedAedAmount: numeric("returned_aed_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  },
  (table) => [
    index("ws_settlement_allocations_settlement_idx").on(table.settlementId),
    index("ws_settlement_allocations_item_idx").on(table.invoiceItemId),
  ],
);

export type WholesaleSettlementAllocation = typeof wholesaleSettlementAllocationsTable.$inferSelect;

// ── Wholesale Returns ────────────────────────────────────────────────────────

export const wholesaleReturnsTable = pgTable("wholesale_returns", {
  id: serial("id").primaryKey(),
  returnNumber: text("return_number").notNull().unique(), // WSR-00001
  invoiceId: integer("invoice_id").notNull().references(() => wholesaleInvoicesTable.id, { onDelete: "cascade" }),
  returnDate: text("return_date").notNull(), // yyyy-MM-dd
  note: text("note"),
  totalReturnedGrossGrams: numeric("total_returned_gross_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  totalReturnedPureGrams: numeric("total_returned_pure_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  totalReturnedFixedPureGrams: numeric("total_returned_fixed_pure_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  totalReturnedMakingAed: numeric("total_returned_making_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  totalReturnedMetalAed: numeric("total_returned_metal_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  totalReturnedAed: numeric("total_returned_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  totalReturnedCogsAed: numeric("total_returned_cogs_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdByUserName: text("created_by_user_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WholesaleReturn = typeof wholesaleReturnsTable.$inferSelect;

export const wholesaleReturnLinesTable = pgTable("wholesale_return_lines", {
  id: serial("id").primaryKey(),
  returnId: integer("return_id").notNull().references(() => wholesaleReturnsTable.id, { onDelete: "cascade" }),
  invoiceItemId: integer("invoice_item_id").notNull().references(() => wholesaleInvoiceItemsTable.id, { onDelete: "cascade" }),
  grossWeightGrams: numeric("gross_weight_grams", { precision: 14, scale: 4 }).notNull(),
  pureWeightGrams: numeric("pure_weight_grams", { precision: 14, scale: 4 }).notNull(),
  returnedFixedPureGrams: numeric("returned_fixed_pure_grams", { precision: 14, scale: 4 }).notNull().default("0"),
  returnedMakingAed: numeric("returned_making_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  returnedMetalAed: numeric("returned_metal_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  returnedAed: numeric("returned_aed", { precision: 14, scale: 2 }).notNull().default("0"),
  returnedCogsAed: numeric("returned_cogs_aed", { precision: 14, scale: 2 }).notNull().default("0"),
});

export type WholesaleReturnLine = typeof wholesaleReturnLinesTable.$inferSelect;

// ── Trader Ledger Entries ────────────────────────────────────────────────────
// Immutable double-entry ledger. Positive = trader owes the shop.
// aedDelta > 0: shop delivered goods/fixed rate, or refunded cash
// aedDelta < 0: cash payment or physical return
// pureGoldGramsDelta > 0: shop delivered pure grams (trader owes grams)
// pureGoldGramsDelta < 0: grams fixed or returned (trader's gram obligation decreases)

export const traderLedgerEntriesTable = pgTable(
  "trader_ledger_entries",
  {
    id: serial("id").primaryKey(),
    traderId: integer("trader_id").notNull().references(() => wholesaleTradersTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // delivery | fixed_sale | cash_payment | cash_refund | rate_fix | physical_return
    eventDate: text("event_date").notNull().default(sql`CURRENT_DATE::text`), // yyyy-MM-dd business date
    aedDelta: numeric("aed_delta", { precision: 14, scale: 2 }).notNull().default("0"),
    pureGoldGramsDelta: numeric("pure_gold_grams_delta", { precision: 14, scale: 4 }).notNull().default("0"),
    // References
    wholesaleInvoiceId: integer("wholesale_invoice_id").references(() => wholesaleInvoicesTable.id, { onDelete: "set null" }),
    wholesaleItemId: integer("wholesale_item_id").references(() => wholesaleInvoiceItemsTable.id, { onDelete: "set null" }),
    wholesaleSettlementId: integer("wholesale_settlement_id").references(() => wholesaleSettlementsTable.id, { onDelete: "set null" }),
    wholesaleReturnId: integer("wholesale_return_id").references(() => wholesaleReturnsTable.id, { onDelete: "set null" }),
    note: text("note"),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdByUserName: text("created_by_user_name"),
    idempotencyKey: text("idempotency_key").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trader_ledger_trader_idx").on(table.traderId),
    index("trader_ledger_invoice_idx").on(table.wholesaleInvoiceId),
    index("trader_ledger_created_brin_idx").using("brin", table.createdAt),
    unique("trader_ledger_idempotency_key_uniq").on(table.idempotencyKey),
  ],
);

export type TraderLedgerEntry = typeof traderLedgerEntriesTable.$inferSelect;
