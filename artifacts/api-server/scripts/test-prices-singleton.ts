#!/usr/bin/env tsx

import { sql } from "drizzle-orm";
import { db, pool, pricesTable } from "@workspace/db";
import { getOrCreatePrices } from "../src/lib/pricesStore.js";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

async function run(): Promise<void> {
  console.log("\n━━━ Prices singleton concurrency test ━━━");

  const concurrent = await Promise.all(
    Array.from({ length: 25 }, () => getOrCreatePrices()),
  );
  const ids = new Set(concurrent.map((row) => row.id));
  assert(ids.size === 1, "25 concurrent initializers resolve to one price row");

  const rows = await db.select({
    id: pricesTable.id,
    singletonKey: pricesTable.singletonKey,
  }).from(pricesTable);
  assert(rows.length === 1, "prices table contains exactly one row");
  assert(rows[0]?.singletonKey === 1, "the price row uses singleton key 1");

  const indexResult = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'prices'
        AND indexname = 'prices_singleton_key_unique'
    ) AS exists
  `);
  assert(indexResult.rows[0]?.exists === true, "database unique index enforces singleton storage");

  const checkResult = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'prices_singleton_key_check'
        AND conrelid = 'prices'::regclass
    ) AS exists
  `);
  assert(checkResult.rows[0]?.exists === true, "database check constraint fixes the singleton key at 1");

  console.log("\n━━━ Results: 5 passed, 0 failed ━━━\n");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });