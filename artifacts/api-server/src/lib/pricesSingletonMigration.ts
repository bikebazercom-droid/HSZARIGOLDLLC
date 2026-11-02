import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger.js";

export type MigrationSqlExecutor = (query: SQL) => Promise<void>;

export async function applyPricesSingletonMigration(
  execute: MigrationSqlExecutor,
): Promise<void> {
  await execute(sql`SELECT pg_advisory_xact_lock(hashtext('prices_singleton_migration_2026'))`);
  await execute(sql`
    CREATE TABLE IF NOT EXISTS prices (
      id serial PRIMARY KEY,
      singleton_key integer,
      gold_price_per_gram numeric(12, 4) NOT NULL DEFAULT 320.00,
      silver_price_per_gram numeric(12, 4) NOT NULL DEFAULT 4.50,
      gold_jewelry_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      gold_bullion_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      tt_bar_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      tt_bar_24k_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      kg_bar_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      gold_22k_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      gold_21k_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      gold_18k_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      gold_9999_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      gold_kg_9999_rate numeric(12, 4) NOT NULL DEFAULT 320.00,
      custom_descriptions text NOT NULL DEFAULT '[]',
      updated_at timestamptz NOT NULL DEFAULT now(),
      manual_invoice_mode boolean NOT NULL DEFAULT false
    )
  `);
  await execute(sql`
    ALTER TABLE prices
    ADD COLUMN IF NOT EXISTS singleton_key integer
  `);
  await execute(sql`
    WITH keeper AS (
      SELECT id
      FROM prices
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT 1
    )
    DELETE FROM prices
    WHERE id <> (SELECT id FROM keeper)
  `);
  await execute(sql`
    UPDATE prices
    SET singleton_key = 1
    WHERE singleton_key IS DISTINCT FROM 1
  `);
  await execute(sql`ALTER TABLE prices ALTER COLUMN singleton_key SET DEFAULT 1`);
  await execute(sql`ALTER TABLE prices ALTER COLUMN singleton_key SET NOT NULL`);
  await execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS prices_singleton_key_unique
    ON prices (singleton_key)
  `);
  await execute(sql`
    DO $migration$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'prices_singleton_key_check'
          AND conrelid = 'prices'::regclass
      ) THEN
        ALTER TABLE prices
        ADD CONSTRAINT prices_singleton_key_check CHECK (singleton_key = 1);
      END IF;
    END
    $migration$
  `);
}

export async function migratePricesSingleton(): Promise<void> {
  await db.transaction(async (tx) => {
    await applyPricesSingletonMigration(async (query) => {
      await tx.execute(query);
    });
  });

  logger.info("Prices singleton constraint is canonical");
}