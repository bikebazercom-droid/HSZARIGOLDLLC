import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pricesTable } from "@workspace/db";
import {
  GetPricesResponse,
  UpdatePricesBody,
  UpdatePricesResponse,
} from "@workspace/api-zod";
import { broadcast } from "../lib/socket.js";
import { getOrCreatePrices } from "../lib/pricesStore.js";
import { requireAdmin } from "../middlewares/auth.js";

const router: IRouter = Router();

function serializePrices(row: typeof pricesTable.$inferSelect) {
  return {
    id: row.id,
    goldPricePerGram: Number(row.goldPricePerGram),
    silverPricePerGram: Number(row.silverPricePerGram),
    goldJewelryRate: Number(row.goldJewelryRate),
    goldBullionRate: Number(row.goldBullionRate),
    ttBarRate: Number(row.ttBarRate),
    ttBar24kRate: Number(row.ttBar24kRate),
    kgBarRate: Number(row.kgBarRate),
    gold22kRate: Number(row.gold22kRate),
    gold21kRate: Number(row.gold21kRate),
    gold18kRate: Number(row.gold18kRate),
    gold9999Rate: Number(row.gold9999Rate),
    goldKg9999Rate: Number(row.goldKg9999Rate),
    customDescriptions: JSON.parse(row.customDescriptions) as Array<{ name: string; rate: number }>,
    updatedAt: row.updatedAt.toISOString(),
    manualInvoiceMode: row.manualInvoiceMode,
  };
}

router.get("/prices", async (_req, res): Promise<void> => {
  const prices = await getOrCreatePrices();
  res.json(GetPricesResponse.parse(serializePrices(prices)));
});

router.put("/prices", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdatePricesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const current = await getOrCreatePrices();
  const data = parsed.data;
  const patch: Partial<typeof pricesTable.$inferInsert> = { updatedAt: new Date() };

  if (data.goldPricePerGram !== undefined) patch.goldPricePerGram = String(data.goldPricePerGram);
  if (data.silverPricePerGram !== undefined) patch.silverPricePerGram = String(data.silverPricePerGram);
  if (data.goldJewelryRate !== undefined) patch.goldJewelryRate = String(data.goldJewelryRate);
  if (data.goldBullionRate !== undefined) patch.goldBullionRate = String(data.goldBullionRate);
  if (data.ttBarRate !== undefined) patch.ttBarRate = String(data.ttBarRate);
  if (data.ttBar24kRate !== undefined) patch.ttBar24kRate = String(data.ttBar24kRate);
  if (data.kgBarRate !== undefined) patch.kgBarRate = String(data.kgBarRate);
  if (data.gold22kRate !== undefined) patch.gold22kRate = String(data.gold22kRate);
  if (data.gold21kRate !== undefined) patch.gold21kRate = String(data.gold21kRate);
  if (data.gold18kRate !== undefined) patch.gold18kRate = String(data.gold18kRate);
  if (data.gold9999Rate !== undefined) patch.gold9999Rate = String(data.gold9999Rate);
  if (data.goldKg9999Rate !== undefined) patch.goldKg9999Rate = String(data.goldKg9999Rate);
  if (data.customDescriptions !== undefined) patch.customDescriptions = JSON.stringify(data.customDescriptions);
  if (data.manualInvoiceMode !== undefined) patch.manualInvoiceMode = data.manualInvoiceMode;

  const [updated] = await db
    .update(pricesTable)
    .set(patch)
    .where(eq(pricesTable.id, current.id))
    .returning();

  res.json(UpdatePricesResponse.parse(serializePrices(updated)));
  broadcast("PRICE_MUTATION");
});

export default router;