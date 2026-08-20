import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger.js";

type CategoryMigrationTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function mergeStockLevel(
  tx: CategoryMigrationTransaction,
  legacyCategory: "gold" | "tt_bar",
  replacementCategory: "gold_9999" | "ten_tola_bar",
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO stock_levels (category, weight_grams, updated_at)
    SELECT
      ${replacementCategory},
      SUM(weight_grams::numeric),
      NOW()
    FROM stock_levels
    WHERE category IN (${legacyCategory}, ${replacementCategory})
    HAVING COUNT(*) FILTER (WHERE category = ${legacyCategory}) > 0
    ON CONFLICT (category) DO UPDATE
    SET weight_grams = EXCLUDED.weight_grams,
        updated_at = EXCLUDED.updated_at
  `);
  await tx.execute(sql`DELETE FROM stock_levels WHERE category = ${legacyCategory}`);
}

/**
 * Idempotent data migration for the 2026 inventory category rename.
 *
 * This runs before the API starts listening so no request can observe a mix of
 * legacy and replacement buckets. The stock-level rows are merged rather than
 * blindly updated because the category column is unique and a replacement row
 * may already exist after a partial rollout.
 */
export async function migrateCategoryNamesInTransaction(
  tx: CategoryMigrationTransaction,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('category_name_migration_2026'))`);

  await mergeStockLevel(tx, "gold", "gold_9999");
  await mergeStockLevel(tx, "tt_bar", "ten_tola_bar");

  await tx.execute(sql`
      UPDATE stock_purchases
      SET category = CASE category
        WHEN 'gold' THEN 'gold_9999'
        WHEN 'tt_bar' THEN 'ten_tola_bar'
        ELSE category
      END
      WHERE category IN ('gold', 'tt_bar')
    `);
  await tx.execute(sql`
      UPDATE purchase_bill_items
      SET category = CASE category
        WHEN 'gold' THEN 'gold_9999'
        WHEN 'tt_bar' THEN 'ten_tola_bar'
        ELSE category
      END
      WHERE category IN ('gold', 'tt_bar')
    `);
  await tx.execute(sql`
      UPDATE inventory_consumptions
      SET category = CASE category
        WHEN 'gold' THEN 'gold_9999'
        WHEN 'tt_bar' THEN 'ten_tola_bar'
        ELSE category
      END
      WHERE category IN ('gold', 'tt_bar')
    `);
  await tx.execute(sql`
      UPDATE stock_movements
      SET category = CASE category
        WHEN 'gold' THEN 'gold_9999'
        WHEN 'tt_bar' THEN 'ten_tola_bar'
        ELSE category
      END
      WHERE category IN ('gold', 'tt_bar')
    `);
  await tx.execute(sql`
      UPDATE invoice_items
      SET category = CASE category
        WHEN 'gold' THEN 'gold_9999'
        WHEN 'tt_bar' THEN 'ten_tola_bar'
        ELSE category
      END
      WHERE category IN ('gold', 'tt_bar')
    `);
  await tx.execute(sql`
      UPDATE invoice_items
      SET description = CASE
        WHEN category = 'gold_9999' AND UPPER(TRIM(description)) = 'GOLD'
          THEN 'GOLD 9999'
        WHEN category = 'gold_9999'
          AND description ~* '^GOLD[[:space:]]*[(]0[.]9999[)]$'
          THEN 'GOLD 9999 (0.9999)'
        WHEN category = 'ten_tola_bar'
          AND description ~* '^TT[.]?[[:space:]]*BAR'
          THEN regexp_replace(description, '^TT[.]?[[:space:]]*BAR', 'TEN TOLA BAR', 'i')
        ELSE description
      END
      WHERE (category = 'gold_9999' AND (
               UPPER(TRIM(description)) = 'GOLD'
               OR description ~* '^GOLD[[:space:]]*[(]0[.]9999[)]$'
             ))
         OR (category = 'ten_tola_bar' AND description ~* '^TT[.]?[[:space:]]*BAR')
    `);
  await tx.execute(sql`
      UPDATE products
      SET category = CASE category
        WHEN 'gold' THEN 'gold_9999'
        WHEN 'tt_bar' THEN 'ten_tola_bar'
        ELSE category
      END
      WHERE category IN ('gold', 'tt_bar')
    `);
  await tx.execute(sql`
    WITH renamed AS (
      SELECT id, CASE
          WHEN is_core
            AND formula_type = 'spot_bar'
            AND weight_grams::numeric BETWEEN 116 AND 117
            AND purity_factor::numeric < 0.9999
            THEN 'TEN TOLA BAR 995'
          WHEN is_core
            AND formula_type = 'spot_bar'
            AND weight_grams::numeric BETWEEN 116 AND 117
            AND purity_factor::numeric >= 0.9999
            THEN 'TEN TOLA BAR 9999'
          WHEN is_core
            AND formula_type = 'spot_bar'
            AND weight_grams::numeric BETWEEN 999 AND 1001
            AND purity_factor::numeric >= 0.9999
            THEN 'GOLD KG 9999'
          WHEN is_core
            AND formula_type = 'spot_per_gram'
            AND weight_grams IS NULL
            AND purity_factor::numeric >= 0.9999
            THEN 'GOLD 9999'
          WHEN UPPER(TRIM(name)) = 'GOLD' THEN 'GOLD 9999'
          WHEN name ~* '^TT[.]?[[:space:]]+BAR' THEN
            regexp_replace(name, '^TT[.]?[[:space:]]+BAR', 'TEN TOLA BAR', 'i')
          ELSE name
        END AS desired_name
      FROM price_items
      WHERE (is_core AND (
              (formula_type = 'spot_bar' AND weight_grams::numeric BETWEEN 116 AND 117)
              OR (formula_type = 'spot_bar' AND weight_grams::numeric BETWEEN 999 AND 1001 AND purity_factor::numeric >= 0.9999)
              OR (formula_type = 'spot_per_gram' AND weight_grams IS NULL AND purity_factor::numeric >= 0.9999)
            ))
         OR UPPER(TRIM(name)) = 'GOLD'
         OR name ~* '^TT[.]?[[:space:]]+BAR'
    )
    UPDATE price_items AS item
    SET name = renamed.desired_name,
        updated_at = NOW()
    FROM renamed
    WHERE item.id = renamed.id
      AND item.name IS DISTINCT FROM renamed.desired_name
  `);
}

/**
 * Idempotent data migration for the 2026 inventory category rename.
 *
 * This runs before the API starts listening so no request can observe a mix of
 * legacy and replacement buckets. The stock-level rows are merged rather than
 * blindly updated because the category column is unique and a replacement row
 * may already exist after a partial rollout.
 */
export async function migrateCategoryNames(): Promise<void> {
  await db.transaction(async (tx) => {
    await migrateCategoryNamesInTransaction(tx);
  });

  logger.info("Inventory category names are canonical");
}