import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { migrateCategoryNamesInTransaction } from "../src/lib/categoryMigration.js";
import { applyPricesSingletonMigration } from "../src/lib/pricesSingletonMigration.js";
import { applyStartupTablesMigration } from "../src/lib/startupTablesMigration.js";

const main = async (): Promise<void> => {
  if (process.env.RUN_STARTUP_TABLES_MIGRATION_TEST !== "true") {
    throw new Error(
      "Set RUN_STARTUP_TABLES_MIGRATION_TEST=true to run the isolated database migration test.",
    );
  }

  const schemaName = `startup_schema_test_${randomUUID().replaceAll("-", "")}`;

  await db.transaction(async (tx) => {
    await tx.execute(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`);
    await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(schemaName)}, public`);

    const execute = async (query: Parameters<typeof tx.execute>[0]): Promise<void> => {
      await tx.execute(query);
    };

    await applyStartupTablesMigration(execute);
    await applyStartupTablesMigration(execute);
    await applyPricesSingletonMigration(execute);
    await migrateCategoryNamesInTransaction(tx);

    const requiredTables = [
      "customers",
      "users",
      "products",
      "invoices",
      "invoice_items",
      "stock_purchases",
      "purchase_bills",
      "purchase_bill_items",
      "inventory_consumptions",
      "stock_levels",
      "stock_movements",
      "price_items",
      "prices",
      "audit_log",
      "company_settings",
    ];

    for (const tableName of requiredTables) {
      const result = await tx.execute<{ table_name: string | null }>(
        sql`SELECT to_regclass(${tableName})::text AS table_name`,
      );
      assert.ok(result.rows[0]?.table_name, `${tableName} exists after bootstrap`);
    }

    const stockColumns = await tx.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'stock_levels'
      ORDER BY ordinal_position
    `);
    assert.deepEqual(
      stockColumns.rows.map((row) => row.column_name),
      ["id", "category", "weight_grams", "updated_at"],
      "stock_levels has the expected schema",
    );

    await tx.execute(sql`DROP SCHEMA ${sql.identifier(schemaName)} CASCADE`);
  });

  console.log("Empty-schema bootstrap and category migration passed.");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
