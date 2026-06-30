import { Router, type IRouter } from "express";
import { db, pricesTable } from "@workspace/db";
import { GetPricesResponse, UpdatePricesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function parsePrices(p: typeof pricesTable.$inferSelect) {
  let customDescriptions: string[] = [];
  try { customDescriptions = JSON.parse(p.customDescriptions || "[]"); } catch {}
  return {
    ...p,
    goldPricePerGram: Number(p.goldPricePerGram),
    silverPricePerGram: Number(p.silverPricePerGram),
    goldJewelryRate: Number(p.goldJewelryRate),
    goldBullionRate: Number(p.goldBullionRate),
    ttBarRate: Number(p.ttBarRate),
    kgBarRate: Number(p.kgBarRate),
    customDescriptions,
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function getOrCreate() {
  let [row] = await db.select().from(pricesTable).limit(1);
  if (!row) {
    [row] = await db.insert(pricesTable).values({}).returning();
  }
  return row;
}

router.get("/prices", async (_req, res): Promise<void> => {
  const prices = await getOrCreate();
  res.json(GetPricesResponse.parse(parsePrices(prices)));
});

router.put("/prices", async (req, res): Promise<void> => {
  const body = req.body as {
    goldPricePerGram?: number;
    silverPricePerGram?: number;
    goldJewelryRate?: number;
    goldBullionRate?: number;
    ttBarRate?: number;
    kgBarRate?: number;
    customDescriptions?: string[];
  };

  await getOrCreate();

  const updates: Record<string, string | Date> = { updatedAt: new Date() };
  if (body.goldPricePerGram != null) updates.goldPricePerGram = String(body.goldPricePerGram);
  if (body.silverPricePerGram != null) updates.silverPricePerGram = String(body.silverPricePerGram);
  if (body.goldJewelryRate != null) updates.goldJewelryRate = String(body.goldJewelryRate);
  if (body.goldBullionRate != null) updates.goldBullionRate = String(body.goldBullionRate);
  if (body.ttBarRate != null) updates.ttBarRate = String(body.ttBarRate);
  if (body.kgBarRate != null) updates.kgBarRate = String(body.kgBarRate);
  if (body.customDescriptions != null) updates.customDescriptions = JSON.stringify(body.customDescriptions);

  const [updated] = await db
    .update(pricesTable)
    .set(updates)
    .returning();

  res.json(UpdatePricesResponse.parse(parsePrices(updated)));
});

export default router;
