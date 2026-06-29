import { pgTable, text, serial, timestamp, numeric, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name"),
  customerMobile: text("customer_mobile"),
  customerEmail: text("customer_email"),
  customerPassportNumber: text("customer_passport_number"),
  customerEmiratesId: text("customer_emirates_id"),
  customerNationality: text("customer_nationality"),
  customerCountry: text("customer_country"),
  paymentMethod: text("payment_method").notNull().default("cash"), // cash, card, bank_transfer
  metalRate: numeric("metal_rate", { precision: 12, scale: 4 }),
  placeOfSupply: text("place_of_supply"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  isPending: boolean("is_pending").notNull().default(false),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("5"),
  vatAmount: numeric("vat_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalBeforeVat: numeric("total_before_vat", { precision: 12, scale: 2 }).notNull().default("0"),
  totalIncludingVat: numeric("total_including_vat", { precision: 12, scale: 2 }).notNull().default("0"),
  roundOffDiscount: numeric("round_off_discount", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id"),
  description: text("description").notNull(),
  category: text("category"),
  quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull().default("1"),
  weight: numeric("weight", { precision: 12, scale: 4 }),
  grossWeight: numeric("gross_weight", { precision: 12, scale: 4 }),
  purity: text("purity"),
  pureWeight: numeric("pure_weight", { precision: 12, scale: 4 }),
  makingRate: numeric("making_rate", { precision: 12, scale: 4 }),
  makingAmt: numeric("making_amt", { precision: 12, scale: 2 }),
  unitPrice: numeric("unit_price", { precision: 12, scale: 4 }).notNull().default("0"),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull().default("0"),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;

export const insertInvoiceItemSchema = createInsertSchema(invoiceItemsTable).omit({ id: true });
export type InsertInvoiceItem = z.infer<typeof insertInvoiceItemSchema>;
export type InvoiceItem = typeof invoiceItemsTable.$inferSelect;
