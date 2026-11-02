import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { applyPricesSingletonMigration } from "../src/lib/pricesSingletonMigration.js";

const assertSingletonSchema = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  expectedRows: number,
): Promise<void> => {
  const rows = await tx.execute<{ id: number; singleton_key: number }>(
    sql`SELECT id, singleton_key FROM prices`,
  );
  assert.equal(rows.rows.length, expectedRows, "migration preserves expected prices rows");
  if (expectedRows > 0) {
    assert.equal(rows.rows[0]?.singleton_key, 1, "singleton key is normalized to 1");
  }

  const column = await tx.execute<{ attnotnull: boolean; default_value: string | null }>(sql`
    SELECT attribute.attnotnull,
           pg_get_expr(default_value.adbin, default_value.adrelid) AS default_value
    FROM pg_attribute attribute
    LEFT JOIN pg_attrdef default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'prices'::regclass
      AND attribute.attname = 'singleton_key'
  `);
  assert.equal(column.rows[0]?.attnotnull, true, "singleton key is NOT NULL");
  assert.equal(column.rows[0]?.default_value, "1", "singleton key defaults to 1");

  const index = await tx.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'prices'
        AND indexname = 'prices_singleton_key_unique'
    ) AS exists
  `);
  assert.equal(index.rows[0]?.exists, true, "unique singleton index is present");

  const constraint = await tx.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'prices_singleton_key_check'
        AND conrelid = 'prices'::regclass
    ) AS exists
  `);
  assert.equal(constraint.rows[0]?.exists, true, "singleton check constraint is present");
};

const runFixture = async (legacyNullableColumn: boolean): Promise<void> => {
  const schemaName = `prices_migration_test_${randomUUID().replaceAll("-", "")}`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`);
    await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}, public`);

    if (legacyNullableColumn) {
      await tx.execute(sql`
        CREATE TABLE prices (
          id integer PRIMARY KEY,
          singleton_key integer,
          updated_at timestamptz
        )
      `);
      await tx.execute(sql`
        INSERT INTO prices (id, singleton_key, updated_at)
        VALUES
          (1, NULL, '2026-01-01T00:00:00Z'),
          (2, 7, '2026-02-01T00:00:00Z'),
          (3, 1, '2025-12-01T00:00:00Z')
      `);
    }

    const execute = async (query: Parameters<typeof tx.execute>[0]): Promise<void> => {
      await tx.execute(query);
    };

    await applyPricesSingletonMigration(execute);
    await applyPricesSingletonMigration(execute);
    await assertSingletonSchema(tx, legacyNullableColumn ? 1 : 0);

    if (legacyNullableColumn) {
      const keeper = await tx.execute<{ id: number }>(sql`SELECT id FROM prices`);
      assert.equal(keeper.rows[0]?.id, 2, "newest legacy price row is retained");
    }

    await tx.execute(sql`DROP SCHEMA ${sql.identifier(schemaName)} CASCADE`);
  });
};

const main = async (): Promise<void> => {
  if (process.env.RUN_PRICES_SINGLETON_MIGRATION_TEST !== "true") {
    throw new Error(
      "Set RUN_PRICES_SINGLETON_MIGRATION_TEST=true to run the isolated database migration test.",
    );
  }

  await runFixture(false);
  console.log("Missing-table migration fixture passed.");
  await runFixture(true);
  console.log("Nullable legacy-column migration fixture passed.");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
