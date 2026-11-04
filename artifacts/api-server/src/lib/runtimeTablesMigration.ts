import { sql } from "drizzle-orm";
import type { StartupTablesSqlExecutor } from "./startupTablesMigration.js";

// These are runtime dependencies even when no tests or wholesale sales exist:
// retail FIFO/deletion reads the fixture registry, and dashboard SQL joins wholesale.
export async function applyRuntimeTablesMigration(execute: StartupTablesSqlExecutor): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS pdf_test_runs (
      id serial PRIMARY KEY, run_id text NOT NULL UNIQUE,
      owner_user_id integer REFERENCES users(id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS pdf_test_fixtures (
      id serial PRIMARY KEY, run_id text NOT NULL REFERENCES pdf_test_runs(run_id) ON DELETE CASCADE,
      entity_type text NOT NULL, entity_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS pdf_test_fixtures_run_entity_idx
      ON pdf_test_fixtures(run_id, entity_type, entity_id)`,
    `CREATE TABLE IF NOT EXISTS wholesale_traders (
      id serial PRIMARY KEY, name text NOT NULL, contact_person text, phone text, email text,
      address text, trn text, is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS wholesale_invoices (
      id serial PRIMARY KEY, invoice_number text NOT NULL UNIQUE, invoice_date text NOT NULL,
      trader_id integer REFERENCES wholesale_traders(id) ON DELETE SET NULL,
      trader_name text NOT NULL, trader_contact_person text, trader_phone text, trader_email text,
      trader_address text, trader_trn text, pricing_type text NOT NULL, payment_mode text, notes text,
      created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL, created_by_user_name text,
      status text NOT NULL DEFAULT 'open',
      total_gross_grams numeric(14,4) NOT NULL DEFAULT 0, total_pure_grams numeric(14,4) NOT NULL DEFAULT 0,
      total_making_aed numeric(14,2) NOT NULL DEFAULT 0, total_aed numeric(14,2) NOT NULL DEFAULT 0,
      open_pure_grams numeric(14,4) NOT NULL DEFAULT 0, settled_aed numeric(14,2) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS wholesale_invoice_items (
      id serial PRIMARY KEY, invoice_id integer NOT NULL REFERENCES wholesale_invoices(id) ON DELETE CASCADE,
      description text NOT NULL, category text NOT NULL, quantity numeric(12,4) NOT NULL DEFAULT 1,
      gross_grams numeric(14,4) NOT NULL, purity_multiplier numeric(6,4) NOT NULL,
      pure_grams numeric(14,4) NOT NULL, rate_aed_per_gram numeric(14,4),
      making_aed numeric(14,2) NOT NULL DEFAULT 0, total_aed numeric(14,2) NOT NULL DEFAULT 0,
      fixed_pure_grams numeric(14,4) NOT NULL DEFAULT 0,
      returned_gross_grams numeric(14,4) NOT NULL DEFAULT 0,
      returned_pure_grams numeric(14,4) NOT NULL DEFAULT 0,
      returned_fixed_pure_grams numeric(14,4) NOT NULL DEFAULT 0,
      returned_making_aed numeric(14,2) NOT NULL DEFAULT 0,
      returned_metal_aed numeric(14,2) NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS wholesale_inventory_consumptions (
      id serial PRIMARY KEY,
      wholesale_invoice_id integer NOT NULL REFERENCES wholesale_invoices(id) ON DELETE CASCADE,
      wholesale_item_id integer NOT NULL REFERENCES wholesale_invoice_items(id) ON DELETE CASCADE,
      purchase_id integer REFERENCES stock_purchases(id) ON DELETE SET NULL,
      is_shortfall boolean NOT NULL DEFAULT false, category text NOT NULL,
      consumed_grams numeric(14,4) NOT NULL, cost_aed numeric(14,2) NOT NULL,
      returned_grams numeric(14,4) NOT NULL DEFAULT 0, returned_cogs_aed numeric(14,2) NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS wholesale_settlements (
      id serial PRIMARY KEY, invoice_id integer NOT NULL REFERENCES wholesale_invoices(id) ON DELETE CASCADE,
      settlement_date text NOT NULL, pure_weight_grams numeric(14,4) NOT NULL,
      rate_aed_per_gram numeric(14,4) NOT NULL, aed_amount numeric(14,2) NOT NULL, note text,
      created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL, created_by_user_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS wholesale_settlement_allocations (
      id serial PRIMARY KEY, settlement_id integer NOT NULL REFERENCES wholesale_settlements(id) ON DELETE CASCADE,
      invoice_item_id integer NOT NULL REFERENCES wholesale_invoice_items(id) ON DELETE CASCADE,
      pure_weight_grams numeric(14,4) NOT NULL, rate_aed_per_gram numeric(14,4) NOT NULL,
      aed_amount numeric(14,2) NOT NULL, returned_pure_weight_grams numeric(14,4) NOT NULL DEFAULT 0,
      returned_aed_amount numeric(14,2) NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS wholesale_returns (
      id serial PRIMARY KEY, return_number text NOT NULL UNIQUE,
      invoice_id integer NOT NULL REFERENCES wholesale_invoices(id) ON DELETE CASCADE,
      return_date text NOT NULL, note text,
      total_returned_gross_grams numeric(14,4) NOT NULL DEFAULT 0,
      total_returned_pure_grams numeric(14,4) NOT NULL DEFAULT 0,
      total_returned_fixed_pure_grams numeric(14,4) NOT NULL DEFAULT 0,
      total_returned_making_aed numeric(14,2) NOT NULL DEFAULT 0,
      total_returned_metal_aed numeric(14,2) NOT NULL DEFAULT 0,
      total_returned_aed numeric(14,2) NOT NULL DEFAULT 0,
      total_returned_cogs_aed numeric(14,2) NOT NULL DEFAULT 0,
      created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL, created_by_user_name text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS wholesale_return_lines (
      id serial PRIMARY KEY, return_id integer NOT NULL REFERENCES wholesale_returns(id) ON DELETE CASCADE,
      invoice_item_id integer NOT NULL REFERENCES wholesale_invoice_items(id) ON DELETE CASCADE,
      gross_weight_grams numeric(14,4) NOT NULL, pure_weight_grams numeric(14,4) NOT NULL,
      returned_fixed_pure_grams numeric(14,4) NOT NULL DEFAULT 0,
      returned_making_aed numeric(14,2) NOT NULL DEFAULT 0,
      returned_metal_aed numeric(14,2) NOT NULL DEFAULT 0,
      returned_aed numeric(14,2) NOT NULL DEFAULT 0,
      returned_cogs_aed numeric(14,2) NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS trader_ledger_entries (
      id serial PRIMARY KEY, trader_id integer NOT NULL REFERENCES wholesale_traders(id) ON DELETE CASCADE,
      event_type text NOT NULL, event_date text NOT NULL DEFAULT CURRENT_DATE::text,
      aed_delta numeric(14,2) NOT NULL DEFAULT 0, pure_gold_grams_delta numeric(14,4) NOT NULL DEFAULT 0,
      wholesale_invoice_id integer REFERENCES wholesale_invoices(id) ON DELETE SET NULL,
      wholesale_item_id integer REFERENCES wholesale_invoice_items(id) ON DELETE SET NULL,
      wholesale_settlement_id integer REFERENCES wholesale_settlements(id) ON DELETE SET NULL,
      wholesale_return_id integer REFERENCES wholesale_returns(id) ON DELETE SET NULL, note text,
      created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL, created_by_user_name text,
      idempotency_key text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT trader_ledger_idempotency_key_uniq UNIQUE(idempotency_key)
    )`,
    `CREATE INDEX IF NOT EXISTS audit_log_created_at_brin_idx ON audit_log USING brin(created_at)`,
    `CREATE INDEX IF NOT EXISTS wholesale_traders_name_idx ON wholesale_traders(name)`,
    `CREATE INDEX IF NOT EXISTS wholesale_invoices_trader_id_idx ON wholesale_invoices(trader_id)`,
    `CREATE INDEX IF NOT EXISTS wholesale_invoices_status_idx ON wholesale_invoices(status)`,
    `CREATE INDEX IF NOT EXISTS wholesale_invoices_date_idx ON wholesale_invoices(invoice_date)`,
    `CREATE INDEX IF NOT EXISTS ws_inv_consumptions_invoice_idx ON wholesale_inventory_consumptions(wholesale_invoice_id)`,
    `CREATE INDEX IF NOT EXISTS ws_inv_consumptions_item_idx ON wholesale_inventory_consumptions(wholesale_item_id)`,
    `CREATE INDEX IF NOT EXISTS ws_settlement_allocations_settlement_idx ON wholesale_settlement_allocations(settlement_id)`,
    `CREATE INDEX IF NOT EXISTS ws_settlement_allocations_item_idx ON wholesale_settlement_allocations(invoice_item_id)`,
    `CREATE INDEX IF NOT EXISTS trader_ledger_trader_idx ON trader_ledger_entries(trader_id)`,
    `CREATE INDEX IF NOT EXISTS trader_ledger_invoice_idx ON trader_ledger_entries(wholesale_invoice_id)`,
    `CREATE INDEX IF NOT EXISTS trader_ledger_created_brin_idx ON trader_ledger_entries USING brin(created_at)`,
  ];
  for (const statement of statements) await execute(sql.raw(statement));
}
