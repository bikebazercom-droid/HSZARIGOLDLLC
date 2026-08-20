#!/usr/bin/env tsx

import { pool } from "@workspace/db";

const MATCH_SQL = `
  position('test_wholesale_shortfall_' in lower(category)) > 0
  OR position('ws_shortfall_del_' in lower(category)) > 0
`;

interface BlockerRow {
  nonzero_levels: string;
  unbalanced_movements: string;
  stock_purchases: string;
  purchase_bill_items: string;
  invoice_items: string;
  inventory_consumptions: string;
  wholesale_invoice_items: string;
  wholesale_inventory_consumptions: string;
}

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const categoryResult = await client.query<{ category: string }>(`
      SELECT DISTINCT category
      FROM (
        SELECT category FROM stock_levels
        UNION ALL SELECT category FROM stock_movements
        UNION ALL SELECT category FROM stock_purchases
        UNION ALL SELECT category FROM purchase_bill_items
        UNION ALL SELECT category FROM invoice_items
        UNION ALL SELECT category FROM inventory_consumptions
        UNION ALL SELECT category FROM wholesale_invoice_items
        UNION ALL SELECT category FROM wholesale_inventory_consumptions
        UNION ALL SELECT category FROM products
      ) categories
      WHERE ${MATCH_SQL}
      ORDER BY category
    `);
    const categories = categoryResult.rows.map((row) => row.category);

    if (categories.length === 0) {
      await client.query("COMMIT");
      console.log("No matching automated-test stock categories remain.");
      return;
    }

    await client.query(
      "SELECT id FROM stock_levels WHERE category = ANY($1::text[]) FOR UPDATE",
      [categories],
    );
    await client.query(
      "SELECT id FROM stock_movements WHERE category = ANY($1::text[]) FOR UPDATE",
      [categories],
    );

    const blockerResult = await client.query<BlockerRow>(`
      SELECT
        (SELECT count(*) FROM stock_levels
         WHERE category = ANY($1::text[]) AND abs(weight_grams::numeric) > 0.0001)::text AS nonzero_levels,
        (SELECT count(*) FROM (
           SELECT category
           FROM stock_movements
           WHERE category = ANY($1::text[])
           GROUP BY category
           HAVING abs(sum(weight_grams::numeric)) > 0.0001
         ) unbalanced)::text AS unbalanced_movements,
        (SELECT count(*) FROM stock_purchases
         WHERE category = ANY($1::text[]))::text AS stock_purchases,
        (SELECT count(*) FROM purchase_bill_items
         WHERE category = ANY($1::text[]))::text AS purchase_bill_items,
        (SELECT count(*) FROM invoice_items
         WHERE category = ANY($1::text[]))::text AS invoice_items,
        (SELECT count(*) FROM inventory_consumptions
         WHERE category = ANY($1::text[]))::text AS inventory_consumptions,
        (SELECT count(*) FROM wholesale_invoice_items
         WHERE category = ANY($1::text[]))::text AS wholesale_invoice_items,
        (SELECT count(*) FROM wholesale_inventory_consumptions
         WHERE category = ANY($1::text[]))::text AS wholesale_inventory_consumptions
    `, [categories]);
    const blockers = blockerResult.rows[0]!;
    const unsafe = Object.entries(blockers).filter(([, count]) => Number(count) > 0);
    if (unsafe.length > 0) {
      throw new Error(
        `Refusing to purge categories with live or unbalanced records: ${
          unsafe.map(([name, count]) => `${name}=${count}`).join(", ")
        }`,
      );
    }

    const products = await client.query(
      "DELETE FROM products WHERE category = ANY($1::text[])",
      [categories],
    );
    const auditLogs = await client.query(`
      DELETE FROM audit_log
      WHERE position('test_wholesale_shortfall_' in lower(details)) > 0
         OR position('ws_shortfall_del_' in lower(details)) > 0
    `);
    const movements = await client.query(
      "DELETE FROM stock_movements WHERE category = ANY($1::text[])",
      [categories],
    );
    const levels = await client.query(
      "DELETE FROM stock_levels WHERE category = ANY($1::text[])",
      [categories],
    );

    await client.query("COMMIT");
    console.log(JSON.stringify({
      categories,
      deleted: {
        products: products.rowCount ?? 0,
        auditLogs: auditLogs.rowCount ?? 0,
        stockMovements: movements.rowCount ?? 0,
        stockLevels: levels.rowCount ?? 0,
      },
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });