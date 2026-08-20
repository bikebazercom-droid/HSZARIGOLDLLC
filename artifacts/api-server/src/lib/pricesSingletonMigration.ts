import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger.js";

export async function migratePricesSingleton(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('prices_singleton_migration_2026'))`);
    await tx.execute(sql`
      ALTER TABLE prices
      ADD COLUMN IF NOT EXISTS singleton_key integer NOT NULL DEFAULT 1
    `);
    await tx.execute(sql`
      WITH keeper AS (
        SELECT id
        FROM prices
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      )
      DELETE FROM prices
      WHERE id <> (SELECT id FROM keeper)
    `);
    await tx.execute(sql`UPDATE prices SET singleton_key = 1 WHERE singleton_key IS DISTINCT FROM 1`);
    await tx.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS prices_singleton_key_unique
      ON prices (singleton_key)
    `);
    await tx.execute(sql`
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
  });

  logger.info("Prices singleton constraint is canonical");
}