import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import { db, stockPurchasesTable, stockLevelsTable, stockMovementsTable } from "@workspace/db";
import { broadcast } from "../lib/socket.js";
import {
  CreateStockPurchaseBody,
  CreateStockPurchaseResponse,
  ListStockPurchasesQueryParams,
  ListStockPurchasesResponse,
  ListStockLevelsResponse,
  ListStockSuppliersResponse,
  ListStockMovementsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

export const STOCK_CATEGORIES = ["gold", "tt_bar", "kg_bar", "995", "gold_jewelry_22k", "silver"] as const;

// Adjust the live aggregated stock level for a category by a signed delta and
// write a movement-log row. tx can be a transaction or the root db.
// Returns the NEW balance (grams) after the delta, taken atomically from the
// same upsert (RETURNING), so callers can derive oversell warnings without a
// separate racy SELECT.
export async function applyStockDelta(
  tx: typeof db,
  category: string,
  deltaGrams: number,
  type: "purchase" | "sale" | "purchase_reversal" | "sale_reversal",
  refType: string,
  refId: number,
  note?: string,
): Promise<number> {
  const [level] = await tx
    .insert(stockLevelsTable)
    .values({ category, weightGrams: String(deltaGrams) })
    .onConflictDoUpdate({
      target: stockLevelsTable.category,
      set: {
        weightGrams: sql`${stockLevelsTable.weightGrams} + ${String(deltaGrams)}`,
        updatedAt: new Date(),
      },
    })
    .returning();
  await tx.insert(stockMovementsTable).values({
    category,
    type,
    weightGrams: String(deltaGrams),
    refType,
    refId,
    note: note ?? null,
  });
  return Number(level.weightGrams);
}

function parsePurchase(row: typeof stockPurchasesTable.$inferSelect) {
  return {
    ...row,
    weightGrams: Number(row.weightGrams),
    totalPriceAed: Number(row.totalPriceAed),
    pricePerGram: Number(row.pricePerGram),
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/stock/levels", async (_req, res): Promise<void> => {
  const rows = await db.select().from(stockLevelsTable).orderBy(stockLevelsTable.category);
  res.json(ListStockLevelsResponse.parse(rows.map((r) => ({
    category: r.category,
    weightGrams: Number(r.weightGrams),
    updatedAt: r.updatedAt.toISOString(),
  }))));
});

router.get("/stock/purchases", async (req, res): Promise<void> => {
  const query = ListStockPurchasesQueryParams.safeParse(req.query);
  const { supplier, category, startDate, endDate } = query.success ? query.data : {} as Record<string, string | undefined>;

  const conditions = [];
  if (supplier) conditions.push(ilike(stockPurchasesTable.supplierName, `%${supplier}%`));
  if (category) conditions.push(eq(stockPurchasesTable.category, category));
  if (startDate) conditions.push(gte(stockPurchasesTable.purchaseDate, startDate));
  if (endDate) conditions.push(lte(stockPurchasesTable.purchaseDate, endDate));

  const rows = await db
    .select()
    .from(stockPurchasesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(stockPurchasesTable.purchaseDate), desc(stockPurchasesTable.id));

  res.json(ListStockPurchasesResponse.parse(rows.map(parsePurchase)));
});

router.post("/stock/purchases", async (req, res): Promise<void> => {
  const parsed = CreateStockPurchaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { category, supplierName, purchaseDate, weightGrams, totalPriceAed } = parsed.data;
  const pricePerGram = weightGrams > 0 ? totalPriceAed / weightGrams : 0;

  const purchase = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(stockPurchasesTable)
      .values({
        category,
        supplierName: supplierName.trim(),
        purchaseDate,
        weightGrams: String(weightGrams),
        totalPriceAed: String(totalPriceAed),
        pricePerGram: String(Math.round(pricePerGram * 10000) / 10000),
        // New batch starts fully available for FIFO consumption
        remainingWeightGrams: String(weightGrams),
      })
      .returning();
    await applyStockDelta(tx as unknown as typeof db, category, weightGrams, "purchase", "stock_purchase", row.id);
    return row;
  });

  res.status(201).json(CreateStockPurchaseResponse.parse(parsePurchase(purchase)));
  broadcast("STOCK_MUTATION");
});

router.delete("/stock/purchases/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  // DELETE ... RETURNING inside one transaction: the reversal is applied only
  // when this request actually removed the row, so concurrent deletes of the
  // same purchase cannot double-reverse the stock.
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx.delete(stockPurchasesTable).where(eq(stockPurchasesTable.id, id)).returning();
    if (!row) return null;
    await applyStockDelta(
      tx as unknown as typeof db,
      row.category,
      -Number(row.weightGrams),
      "purchase_reversal",
      "stock_purchase",
      id,
      `Deleted purchase from ${row.supplierName}`,
    );
    return row;
  });
  if (!deleted) {
    res.status(404).json({ error: "Purchase not found" });
    return;
  }
  res.status(204).end();
  broadcast("STOCK_MUTATION");
});

router.get("/stock/suppliers", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ supplierName: stockPurchasesTable.supplierName })
    .from(stockPurchasesTable)
    .orderBy(stockPurchasesTable.supplierName);
  res.json(ListStockSuppliersResponse.parse(rows.map((r) => r.supplierName)));
});

router.get("/stock/movements", async (req, res): Promise<void> => {
  const category = typeof req.query.category === "string" && req.query.category ? req.query.category : undefined;
  const rows = await db
    .select()
    .from(stockMovementsTable)
    .where(category ? eq(stockMovementsTable.category, category) : undefined)
    .orderBy(desc(stockMovementsTable.id))
    .limit(500);
  res.json(ListStockMovementsResponse.parse(rows.map((r) => ({
    ...r,
    weightGrams: Number(r.weightGrams),
    createdAt: r.createdAt.toISOString(),
  }))));
});

export default router;
