import { Router, type IRouter } from "express";
import { db, pricesTable } from "@workspace/db";
import {
  UpdatePricesBody,
  GetPricesResponse,
  UpdatePricesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/prices", async (_req, res): Promise<void> => {
  let [prices] = await db.select().from(pricesTable).limit(1);

  if (!prices) {
    [prices] = await db
      .insert(pricesTable)
      .values({ goldPricePerGram: "320.00", silverPricePerGram: "4.50" })
      .returning();
  }

  res.json(GetPricesResponse.parse({
    ...prices,
    goldPricePerGram: Number(prices.goldPricePerGram),
    silverPricePerGram: Number(prices.silverPricePerGram),
    updatedAt: prices.updatedAt.toISOString(),
  }));
});

router.put("/prices", async (req, res): Promise<void> => {
  const parsed = UpdatePricesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  let [existing] = await db.select().from(pricesTable).limit(1);

  if (!existing) {
    [existing] = await db
      .insert(pricesTable)
      .values({
        goldPricePerGram: String(parsed.data.goldPricePerGram),
        silverPricePerGram: String(parsed.data.silverPricePerGram),
      })
      .returning();
  } else {
    [existing] = await db
      .update(pricesTable)
      .set({
        goldPricePerGram: String(parsed.data.goldPricePerGram),
        silverPricePerGram: String(parsed.data.silverPricePerGram),
        updatedAt: new Date(),
      })
      .returning();
  }

  res.json(UpdatePricesResponse.parse({
    ...existing,
    goldPricePerGram: Number(existing.goldPricePerGram),
    silverPricePerGram: Number(existing.silverPricePerGram),
    updatedAt: existing.updatedAt.toISOString(),
  }));
});

export default router;
