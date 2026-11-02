import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger.js";

export type StartupTablesSqlExecutor = (query: SQL) => Promise<void>;

const STARTUP_TABLES = [
  sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY NOT NULL,
      name text NOT NULL,
      mobile text,
      email text,
      passport_number text,
      emirates_id text,
      nationality text,
      address text,
      country text,
      created_at timestamptz DEFAULT now() NOT NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY NOT NULL,
      username text NOT NULL,
      mobile text DEFAULT '' NOT NULL,
      password_hash text NOT NULL,
      full_name text NOT NULL,
      role text DEFAULT 'staff' NOT NULL,
      is_active boolean DEFAULT true NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT users_username_unique UNIQUE (username)
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS products (
      id serial PRIMARY KEY NOT NULL,
      name text NOT NULL,
      category text NOT NULL,
      unit text DEFAULT 'gram' NOT NULL,
      price_per_unit numeric(12, 4),
      stock numeric(12, 4),
      created_at timestamptz DEFAULT now() NOT NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS invoices (
      id serial PRIMARY KEY NOT NULL,
      invoice_number text NOT NULL,
      customer_id integer,
      customer_name text,
      customer_mobile text,
      customer_email text,
      customer_passport_number text,
      customer_emirates_id text,
      customer_nationality text,
      customer_country text,
      customer_address text,
      payment_method text DEFAULT 'cash' NOT NULL,
      metal_rate numeric(12, 4),
      place_of_supply text,
      subtotal numeric(12, 2) DEFAULT '0' NOT NULL,
      discount numeric(12, 2) DEFAULT '0' NOT NULL,
      total numeric(12, 2) DEFAULT '0' NOT NULL,
      notes text,
      is_pending boolean DEFAULT false NOT NULL,
      vat_rate numeric(5, 2) DEFAULT '5' NOT NULL,
      vat_amount numeric(12, 2) DEFAULT '0' NOT NULL,
      total_before_vat numeric(12, 2) DEFAULT '0' NOT NULL,
      total_including_vat numeric(12, 2) DEFAULT '0' NOT NULL,
      round_off_discount numeric(12, 2) DEFAULT '0' NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      created_by_user_id integer,
      created_by_user_name text,
      CONSTRAINT invoices_invoice_number_unique UNIQUE (invoice_number),
      CONSTRAINT invoices_customer_id_customers_id_fk
        FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE SET NULL,
      CONSTRAINT invoices_created_by_user_id_users_id_fk
        FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id serial PRIMARY KEY NOT NULL,
      invoice_id integer NOT NULL,
      product_id integer,
      description text NOT NULL,
      category text,
      quantity numeric(12, 4) DEFAULT '1' NOT NULL,
      weight numeric(12, 4),
      gross_weight numeric(12, 4),
      purity text,
      purity_multiplier numeric(6, 4),
      pure_weight numeric(12, 4),
      making_rate numeric(12, 4),
      making_amt numeric(12, 2),
      unit_price numeric(12, 4) DEFAULT '0' NOT NULL,
      total_price numeric(12, 2) DEFAULT '0' NOT NULL,
      CONSTRAINT invoice_items_invoice_id_invoices_id_fk
        FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS stock_purchases (
      id serial PRIMARY KEY NOT NULL,
      category text NOT NULL,
      supplier_name text NOT NULL,
      purchase_date text NOT NULL,
      weight_grams numeric(14, 4) NOT NULL,
      total_price_aed numeric(14, 2) NOT NULL,
      price_per_gram numeric(14, 4) NOT NULL,
      remaining_weight_grams numeric(14, 4) DEFAULT '0' NOT NULL,
      narrative text,
      created_at timestamptz DEFAULT now() NOT NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS purchase_bills (
      id serial PRIMARY KEY NOT NULL,
      bill_no text NOT NULL,
      bill_date text NOT NULL,
      supplier_name text NOT NULL,
      supplier_phone text,
      supplier_email text,
      supplier_address text,
      purchase_type text NOT NULL,
      payment_status text NOT NULL,
      total_gross_grams numeric(14, 4) NOT NULL,
      total_pure_grams numeric(14, 4) NOT NULL,
      total_aed numeric(14, 2) NOT NULL,
      notes text,
      created_at timestamptz DEFAULT now() NOT NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS purchase_bill_items (
      id serial PRIMARY KEY NOT NULL,
      bill_id integer NOT NULL,
      stock_purchase_id integer,
      category text NOT NULL,
      gross_weight_grams numeric(14, 4) NOT NULL,
      purity_percent numeric(7, 3) NOT NULL,
      pure_weight_grams numeric(14, 4) NOT NULL,
      rate_aed_per_g numeric(14, 4) NOT NULL,
      making_charge_aed numeric(14, 2) DEFAULT '0' NOT NULL,
      line_total_aed numeric(14, 2) NOT NULL,
      CONSTRAINT purchase_bill_items_bill_id_purchase_bills_id_fk
        FOREIGN KEY (bill_id) REFERENCES purchase_bills (id) ON DELETE CASCADE,
      CONSTRAINT purchase_bill_items_stock_purchase_id_stock_purchases_id_fk
        FOREIGN KEY (stock_purchase_id) REFERENCES stock_purchases (id) ON DELETE SET NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS inventory_consumptions (
      id serial PRIMARY KEY NOT NULL,
      invoice_id integer NOT NULL,
      invoice_item_id integer,
      purchase_id integer,
      category text NOT NULL,
      weight_grams numeric(14, 4) NOT NULL,
      cost_aed numeric(14, 2) NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT inventory_consumptions_invoice_id_invoices_id_fk
        FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE,
      CONSTRAINT inventory_consumptions_purchase_id_stock_purchases_id_fk
        FOREIGN KEY (purchase_id) REFERENCES stock_purchases (id) ON DELETE SET NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS stock_levels (
      id serial PRIMARY KEY NOT NULL,
      category text NOT NULL,
      weight_grams numeric(14, 4) DEFAULT '0' NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL,
      CONSTRAINT stock_levels_category_unique UNIQUE (category)
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id serial PRIMARY KEY NOT NULL,
      category text NOT NULL,
      type text NOT NULL,
      weight_grams numeric(14, 4) NOT NULL,
      ref_type text,
      ref_id integer,
      note text,
      created_at timestamptz DEFAULT now() NOT NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS price_items (
      id serial PRIMARY KEY NOT NULL,
      name text NOT NULL,
      display_order integer DEFAULT 0 NOT NULL,
      formula_type text DEFAULT 'spot_per_gram' NOT NULL,
      weight_grams numeric(14, 6),
      weight_label text DEFAULT '1GM' NOT NULL,
      purity_factor numeric(10, 7) DEFAULT '1.0' NOT NULL,
      premium_offset_aed numeric(12, 4) DEFAULT '0' NOT NULL,
      manual_rate_aed numeric(12, 4),
      tv_visible boolean DEFAULT true NOT NULL,
      is_core boolean DEFAULT false NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL,
      updated_at timestamptz DEFAULT now() NOT NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id serial PRIMARY KEY NOT NULL,
      actor_id integer,
      entity_type text NOT NULL,
      entity_id integer NOT NULL,
      action text NOT NULL,
      bill_no text,
      details text NOT NULL,
      created_at timestamptz DEFAULT now() NOT NULL
    )
  `,
  sql`
    CREATE TABLE IF NOT EXISTS company_settings (
      id serial PRIMARY KEY NOT NULL,
      company_name text DEFAULT 'HAZARI GOLD L.L.C' NOT NULL,
      tagline text,
      address text DEFAULT 'Matar Abdul Rahman Khalfan Al Muhairi Building, 1st Floor, Room# 101, Deira, Dubai, UAE' NOT NULL,
      phone text DEFAULT '+971 50 536 4193' NOT NULL,
      email text DEFAULT 'hazarigoldllc@gmail.com' NOT NULL,
      trn text DEFAULT '105301944200003' NOT NULL,
      location_url text,
      logo_type text DEFAULT 'monogram' NOT NULL,
      logo_initial text DEFAULT 'H' NOT NULL,
      logo_image_url text,
      stamp_signature_url text
    )
  `,
] as const;

export async function applyStartupTablesMigration(
  execute: StartupTablesSqlExecutor,
): Promise<void> {
  await execute(sql`SELECT pg_advisory_xact_lock(hashtext('startup_core_tables_2026'))`);
  for (const statement of STARTUP_TABLES) {
    await execute(statement);
  }
}

export async function ensureStartupTables(): Promise<void> {
  await db.transaction(async (tx) => {
    await applyStartupTablesMigration(async (query) => {
      await tx.execute(query);
    });
  });

  logger.info("Startup-required database tables are available");
}
