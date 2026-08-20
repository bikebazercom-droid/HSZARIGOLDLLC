#!/usr/bin/env tsx
/**
 * Rollback-isolated integration test for the canonical inventory-category
 * migration. It seeds legacy and canonical rows in one transaction, exercises
 * the real migration twice, then intentionally rolls the transaction back.
 */

import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  inventoryConsumptionsTable,
  invoiceItemsTable,
  invoicesTable,
  priceItemsTable,
  productsTable,
  purchaseBillItemsTable,
  purchaseBillsTable,
  stockLevelsTable,
  stockMovementsTable,
  stockPurchasesTable,
} from "@workspace/db";
import { migrateCategoryNamesInTransaction } from "../src/lib/categoryMigration.js";

const ROLLBACK = new Error("intentional category-migration test rollback");
let passed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
  passed++;
}

function equal(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) < 0.0001, `${message} (expected ${expected}, got ${actual})`);
}

async function run(): Promise<void> {
  console.log("\n━━━ Category migration integration test ━━━");

  try {
    await db.transaction(async (tx) => {
      const suffix = `${process.pid}-${Date.now().toString(36)}`;
      const canonicalLevels = await tx
        .select({ category: stockLevelsTable.category, weight: stockLevelsTable.weightGrams })
        .from(stockLevelsTable)
        .where(inArray(stockLevelsTable.category, ["gold_9999", "ten_tola_bar"]));
      const baseline = new Map(canonicalLevels.map((row) => [row.category, Number(row.weight)]));

      const legacyLevels = await tx
        .select({ category: stockLevelsTable.category })
        .from(stockLevelsTable)
        .where(inArray(stockLevelsTable.category, ["gold", "tt_bar"]));
      assert(legacyLevels.length === 0, "test starts with no legacy stock-level buckets");

      const purchases = await tx
        .insert(stockPurchasesTable)
        .values([
          {
            category: "gold",
            supplierName: `MIGRATION-${suffix}`,
            purchaseDate: "0001-01-01",
            weightGrams: "2.5000",
            totalPriceAed: "250.00",
            pricePerGram: "100.0000",
            remainingWeightGrams: "2.5000",
          },
          {
            category: "tt_bar",
            supplierName: `MIGRATION-${suffix}`,
            purchaseDate: "0001-01-01",
            weightGrams: "3.5000",
            totalPriceAed: "350.00",
            pricePerGram: "100.0000",
            remainingWeightGrams: "3.5000",
          },
        ])
        .returning({ id: stockPurchasesTable.id });

      const [bill] = await tx
        .insert(purchaseBillsTable)
        .values({
          billNo: `MIGRATION-BILL-${suffix}`,
          billDate: "0001-01-01",
          supplierName: `MIGRATION-${suffix}`,
          purchaseType: "fixed",
          paymentStatus: "paid",
          totalGrossGrams: "6.0000",
          totalPureGrams: "6.0000",
          totalAed: "600.00",
        })
        .returning({ id: purchaseBillsTable.id });
      if (!bill) throw new Error("failed to create migration-test bill");

      const billItems = await tx
        .insert(purchaseBillItemsTable)
        .values([
          {
            billId: bill.id,
            stockPurchaseId: purchases[0]?.id,
            category: "gold",
            grossWeightGrams: "2.5000",
            purityPercent: "100.000",
            pureWeightGrams: "2.5000",
            rateAedPerG: "100.0000",
            lineTotalAed: "250.00",
          },
          {
            billId: bill.id,
            stockPurchaseId: purchases[1]?.id,
            category: "tt_bar",
            grossWeightGrams: "3.5000",
            purityPercent: "100.000",
            pureWeightGrams: "3.5000",
            rateAedPerG: "100.0000",
            lineTotalAed: "350.00",
          },
        ])
        .returning({ id: purchaseBillItemsTable.id, stockPurchaseId: purchaseBillItemsTable.stockPurchaseId });

      const [invoice] = await tx
        .insert(invoicesTable)
        .values({ invoiceNumber: `MIGRATION-INV-${suffix}` })
        .returning({ id: invoicesTable.id });
      if (!invoice) throw new Error("failed to create migration-test invoice");

      const invoiceItems = await tx
        .insert(invoiceItemsTable)
        .values([
          { invoiceId: invoice.id, description: "GOLD", category: "gold" },
          { invoiceId: invoice.id, description: "TT Bar", category: "tt_bar" },
        ])
        .returning({ id: invoiceItemsTable.id });

      const consumptions = await tx
        .insert(inventoryConsumptionsTable)
        .values([
          {
            invoiceId: invoice.id,
            invoiceItemId: invoiceItems[0]?.id,
            purchaseId: purchases[0]?.id,
            category: "gold",
            weightGrams: "1.0000",
            costAed: "100.00",
          },
          {
            invoiceId: invoice.id,
            invoiceItemId: invoiceItems[1]?.id,
            purchaseId: purchases[1]?.id,
            category: "tt_bar",
            weightGrams: "1.0000",
            costAed: "100.00",
          },
        ])
        .returning({ id: inventoryConsumptionsTable.id });

      const movements = await tx
        .insert(stockMovementsTable)
        .values([
          { category: "gold", type: "purchase", weightGrams: "2.5000" },
          { category: "tt_bar", type: "purchase", weightGrams: "3.5000" },
        ])
        .returning({ id: stockMovementsTable.id });

      const products = await tx
        .insert(productsTable)
        .values([
          { name: `Migration Gold ${suffix}`, category: "gold" },
          { name: `Migration Bar ${suffix}`, category: "tt_bar" },
        ])
        .returning({ id: productsTable.id });

      const priceItems = await tx
        .insert(priceItemsTable)
        .values([
          { name: "GOLD", formulaType: "manual", manualRateAed: "1.0000", tvVisible: false },
          { name: "TT BAR 995", formulaType: "manual", manualRateAed: "1.0000", tvVisible: false },
        ])
        .returning({ id: priceItemsTable.id });

      await tx.insert(stockLevelsTable).values([
        { category: "gold", weightGrams: "2.5000" },
        { category: "tt_bar", weightGrams: "3.5000" },
      ]);

      await migrateCategoryNamesInTransaction(tx);

      const purchaseRows = await tx
        .select({ category: stockPurchasesTable.category })
        .from(stockPurchasesTable)
        .where(inArray(stockPurchasesTable.id, purchases.map((row) => row.id)));
      const billItemRows = await tx
        .select({
          category: purchaseBillItemsTable.category,
          stockPurchaseId: purchaseBillItemsTable.stockPurchaseId,
        })
        .from(purchaseBillItemsTable)
        .where(inArray(purchaseBillItemsTable.id, billItems.map((row) => row.id)));
      const consumptionRows = await tx
        .select({
          category: inventoryConsumptionsTable.category,
          invoiceItemId: inventoryConsumptionsTable.invoiceItemId,
          purchaseId: inventoryConsumptionsTable.purchaseId,
        })
        .from(inventoryConsumptionsTable)
        .where(inArray(inventoryConsumptionsTable.id, consumptions.map((row) => row.id)));
      const movementRows = await tx
        .select({ category: stockMovementsTable.category })
        .from(stockMovementsTable)
        .where(inArray(stockMovementsTable.id, movements.map((row) => row.id)));
      const invoiceItemRows = await tx
        .select({ category: invoiceItemsTable.category, description: invoiceItemsTable.description })
        .from(invoiceItemsTable)
        .where(inArray(invoiceItemsTable.id, invoiceItems.map((row) => row.id)));
      const productRows = await tx
        .select({ category: productsTable.category })
        .from(productsTable)
        .where(inArray(productsTable.id, products.map((row) => row.id)));
      const renamedPrices = await tx
        .select({ name: priceItemsTable.name })
        .from(priceItemsTable)
        .where(inArray(priceItemsTable.id, priceItems.map((row) => row.id)));
      const levelsAfterFirstRun = await tx
        .select({ category: stockLevelsTable.category, weight: stockLevelsTable.weightGrams })
        .from(stockLevelsTable)
        .where(inArray(stockLevelsTable.category, ["gold", "tt_bar", "gold_9999", "ten_tola_bar"]));

      const expectedCategories = ["gold_9999", "ten_tola_bar"];
      for (const [label, rows] of [
        ["stock purchases", purchaseRows],
        ["purchase-bill items", billItemRows],
        ["FIFO consumptions", consumptionRows],
        ["stock movements", movementRows],
        ["invoice items", invoiceItemRows],
        ["products", productRows],
      ] as const) {
        const categories = rows.map((row) => row.category).sort();
        assert(
          JSON.stringify(categories) === JSON.stringify(expectedCategories),
          `${label} use only canonical category IDs`,
        );
      }

      const firstLevelMap = new Map(levelsAfterFirstRun.map((row) => [row.category, Number(row.weight)]));
      assert(!firstLevelMap.has("gold") && !firstLevelMap.has("tt_bar"), "legacy stock-level buckets are removed");
      equal(firstLevelMap.get("gold_9999") ?? NaN, (baseline.get("gold_9999") ?? 0) + 2.5, "gold stock buckets merge without loss");
      equal(firstLevelMap.get("ten_tola_bar") ?? NaN, (baseline.get("ten_tola_bar") ?? 0) + 3.5, "ten-tola stock buckets merge without loss");

      assert(
        invoiceItemRows.some((row) => row.description === "GOLD 9999")
          && invoiceItemRows.some((row) => row.description === "TEN TOLA BAR"),
        "legacy invoice descriptions are renamed",
      );
      assert(
        renamedPrices.some((row) => row.name === "GOLD 9999")
          && renamedPrices.some((row) => row.name === "TEN TOLA BAR 995"),
        "legacy visible price-item names are renamed",
      );
      assert(
        billItemRows.map((row) => row.stockPurchaseId).sort().join(",")
          === purchases.map((row) => row.id).sort().join(","),
        "purchase-bill item links survive the migration",
      );
      assert(
        consumptionRows.map((row) => row.invoiceItemId).sort().join(",")
          === invoiceItems.map((row) => row.id).sort().join(",")
          && consumptionRows.map((row) => row.purchaseId).sort().join(",")
            === purchases.map((row) => row.id).sort().join(","),
        "FIFO consumption links survive the migration",
      );

      const firstState = JSON.stringify({
        levels: levelsAfterFirstRun.sort((a, b) => a.category.localeCompare(b.category)),
        purchaseRows,
        billItemRows,
        consumptionRows,
        movementRows,
        invoiceItemRows,
        productRows,
        renamedPrices,
      });
      await migrateCategoryNamesInTransaction(tx);

      const levelsAfterSecondRun = await tx
        .select({ category: stockLevelsTable.category, weight: stockLevelsTable.weightGrams })
        .from(stockLevelsTable)
        .where(inArray(stockLevelsTable.category, ["gold", "tt_bar", "gold_9999", "ten_tola_bar"]));
      const secondState = JSON.stringify({
        levels: levelsAfterSecondRun.sort((a, b) => a.category.localeCompare(b.category)),
        purchaseRows: await tx.select({ category: stockPurchasesTable.category }).from(stockPurchasesTable).where(inArray(stockPurchasesTable.id, purchases.map((row) => row.id))),
        billItemRows: await tx.select({ category: purchaseBillItemsTable.category, stockPurchaseId: purchaseBillItemsTable.stockPurchaseId }).from(purchaseBillItemsTable).where(inArray(purchaseBillItemsTable.id, billItems.map((row) => row.id))),
        consumptionRows: await tx.select({ category: inventoryConsumptionsTable.category, invoiceItemId: inventoryConsumptionsTable.invoiceItemId, purchaseId: inventoryConsumptionsTable.purchaseId }).from(inventoryConsumptionsTable).where(inArray(inventoryConsumptionsTable.id, consumptions.map((row) => row.id))),
        movementRows: await tx.select({ category: stockMovementsTable.category }).from(stockMovementsTable).where(inArray(stockMovementsTable.id, movements.map((row) => row.id))),
        invoiceItemRows: await tx.select({ category: invoiceItemsTable.category, description: invoiceItemsTable.description }).from(invoiceItemsTable).where(inArray(invoiceItemsTable.id, invoiceItems.map((row) => row.id))),
        productRows: await tx.select({ category: productsTable.category }).from(productsTable).where(inArray(productsTable.id, products.map((row) => row.id))),
        renamedPrices: await tx.select({ name: priceItemsTable.name }).from(priceItemsTable).where(inArray(priceItemsTable.id, priceItems.map((row) => row.id))),
      });
      assert(secondState === firstState, "a second migration run leaves all tested data unchanged");

      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  console.log(`\n━━━ Results: ${passed} passed, 0 failed (fixtures rolled back) ━━━\n`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });