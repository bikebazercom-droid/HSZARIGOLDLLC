import { Router, type IRouter } from "express";
import { db, priceItemsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { broadcast } from "../lib/socket.js";
import { logger } from "../lib/logger.js";
import type { InsertPriceItem } from "@workspace/db";

const TROY = 31.1034768;

// ── Default core items (seeded when the table is empty) ───────────────────────
const CORE_DEFAULTS: InsertPriceItem[] = [
  {
    name: "TEN TOLA BAR 995",
    displayOrder: 1,
    formulaType: "spot_bar",
    weightGrams: "116.64",        // Dubai convention: 1 Tola = 11.664g → 10 Tola = 116.64g
    weightLabel: "TTB",
    purityFactor: "0.9950000",
    premiumOffsetAed: "0",
    tvVisible: true,
    isCore: true,
  },
  {
    name: "TEN TOLA BAR 9999",
    displayOrder: 2,
    formulaType: "spot_bar",
    weightGrams: "116.64",        // Dubai convention: 1 Tola = 11.664g → 10 Tola = 116.64g
    weightLabel: "TTB",
    purityFactor: "1.0000000",    // spot rate IS the 9999 rate — no separate deduction
    premiumOffsetAed: "0",
    tvVisible: true,
    isCore: true,
  },
  {
    name: "GOLD 9999",
    displayOrder: 3,
    formulaType: "spot_per_gram",
    weightGrams: null,
    weightLabel: "1GM",
    purityFactor: "1.0000000",    // spot rate IS the 9999 rate — no separate deduction
    premiumOffsetAed: "0",
    tvVisible: true,
    isCore: true,
  },
  {
    name: "KG BAR 995",
    displayOrder: 4,
    formulaType: "spot_bar",
    weightGrams: "1000",
    weightLabel: "1KG",
    // UAE gold market convention: 995 kilo bars are priced at 23/24 of the
    // 9999 rate — NOT at 99.5% purity.  This matches Dubai showroom pricing
    // convention and aligns with the reference app (livepriceofgold.com).
    purityFactor: String(23 / 24),   // 0.95833…
    premiumOffsetAed: "0",
    tvVisible: true,
    isCore: true,
  },
  {
    name: "KG BAR 9999",
    displayOrder: 5,
    formulaType: "spot_bar",
    weightGrams: "1000",
    weightLabel: "1KG",
    purityFactor: "1.0000000",    // spot rate IS the 9999 rate — no separate deduction
    premiumOffsetAed: "0",
    tvVisible: true,
    isCore: true,
  },
  {
    name: "JEWELLERY 22K",
    displayOrder: 6,
    formulaType: "spot_per_gram",
    weightGrams: null,
    weightLabel: "1GM",
    purityFactor: "0.9166700",    // 22/24 = 0.91666… per scientific standard (Dubai retail)
    premiumOffsetAed: "0",
    tvVisible: true,
    isCore: true,
  },
  {
    name: "JEWELLERY 21K",
    displayOrder: 7,
    formulaType: "spot_per_gram",
    weightGrams: null,
    weightLabel: "1GM",
    purityFactor: "0.8750000",
    premiumOffsetAed: "0",
    tvVisible: true,
    isCore: true,
  },
  {
    name: "JEWELLERY 18K",
    displayOrder: 8,
    formulaType: "spot_per_gram",
    weightGrams: null,
    weightLabel: "1GM",
    purityFactor: "0.7500000",
    premiumOffsetAed: "0",
    tvVisible: true,
    isCore: true,
  },
];

async function seedIfEmpty(): Promise<void> {
  try {
    const existing = await db.select({ id: priceItemsTable.id }).from(priceItemsTable).limit(1);
    if (existing.length === 0) {
      await db.insert(priceItemsTable).values(CORE_DEFAULTS);
      logger.info("[price-items] Seeded default core items");
    }
  } catch (err) {
    logger.warn({ err }, "[price-items] Seed failed");
  }
}

// ── One-time migration: correct JEWELLERY 22K purity from legacy 0.9180 → 0.91667 ─
// The old seed used a Dubai-convention approximation (0.9180).
// The scientifically correct value is 22/24 = 0.91666… (≈ 0.9166700).
// This migration runs on every startup but is effectively a no-op once corrected.
async function migratePurityFactors(): Promise<void> {
  try {
    const [row] = await db
      .select({ id: priceItemsTable.id, purityFactor: priceItemsTable.purityFactor })
      .from(priceItemsTable)
      .where(eq(priceItemsTable.name, "JEWELLERY 22K"))
      .limit(1);
    if (row && Math.abs(Number(row.purityFactor) - 0.9180) < 0.0001) {
      await db
        .update(priceItemsTable)
        .set({ purityFactor: "0.9166700", updatedAt: new Date() })
        .where(eq(priceItemsTable.id, row.id));
      logger.info("[price-items] Migrated JEWELLERY 22K purity 0.9180 → 0.91667 (22/24)");
    }
  } catch (err) {
    logger.warn({ err }, "[price-items] Purity migration failed");
  }
}

seedIfEmpty().then(() => migratePurityFactors());

// ── Serialisation helper ──────────────────────────────────────────────────────
function toJson(row: typeof priceItemsTable.$inferSelect) {
  return {
    id:               row.id,
    name:             row.name,
    displayOrder:     row.displayOrder,
    formulaType:      row.formulaType,
    weightGrams:      row.weightGrams != null ? Number(row.weightGrams) : null,
    weightLabel:      row.weightLabel,
    purityFactor:     Number(row.purityFactor),
    premiumOffsetAed: Number(row.premiumOffsetAed),
    manualRateAed:    row.manualRateAed != null ? Number(row.manualRateAed) : null,
    tvVisible:        row.tvVisible,
    isCore:           row.isCore,
    createdAt:        row.createdAt.toISOString(),
    updatedAt:        row.updatedAt.toISOString(),
  };
}

// ── Public router (no auth) ───────────────────────────────────────────────────
export const publicPriceItemsRouter: IRouter = Router();

publicPriceItemsRouter.get("/prices/items/public", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(priceItemsTable)
    .orderBy(asc(priceItemsTable.displayOrder), asc(priceItemsTable.id));
  res.json(rows.map(toJson));
});

// ── Admin router (mounted after requireAuth) ──────────────────────────────────
const router: IRouter = Router();

router.get("/prices/items", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(priceItemsTable)
    .orderBy(asc(priceItemsTable.displayOrder), asc(priceItemsTable.id));
  res.json(rows.map(toJson));
});

router.post("/prices/items", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const [row] = await db
    .insert(priceItemsTable)
    .values({
      name:             String(body.name ?? ""),
      displayOrder:     Number(body.displayOrder ?? 99),
      formulaType:      String(body.formulaType ?? "spot_per_gram"),
      weightGrams:      body.weightGrams != null ? String(body.weightGrams) : null,
      weightLabel:      String(body.weightLabel ?? "1GM"),
      purityFactor:     String(body.purityFactor ?? "1.0"),
      premiumOffsetAed: String(body.premiumOffsetAed ?? "0"),
      manualRateAed:    body.manualRateAed != null ? String(body.manualRateAed) : null,
      tvVisible:        typeof body.tvVisible === "boolean" ? body.tvVisible : true,
      isCore:           false,
    })
    .returning();
  broadcast("PRICE_MUTATION");
  res.status(201).json(toJson(row));
});

router.put("/prices/items/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const body = req.body as Record<string, unknown>;

  const [existing] = await db.select().from(priceItemsTable).where(eq(priceItemsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Price item not found" });
    return;
  }

  const updates: Partial<InsertPriceItem> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (body.name       != null) updates.name        = String(body.name);
  if (body.displayOrder != null) updates.displayOrder = Number(body.displayOrder);
  if (body.formulaType  != null) updates.formulaType  = String(body.formulaType);
  if ("weightGrams" in body) updates.weightGrams   = body.weightGrams != null ? String(body.weightGrams) : null;
  if (body.weightLabel  != null) updates.weightLabel  = String(body.weightLabel);
  if (body.purityFactor != null) updates.purityFactor = String(body.purityFactor);
  if (body.premiumOffsetAed != null) updates.premiumOffsetAed = String(body.premiumOffsetAed);
  if ("manualRateAed" in body) updates.manualRateAed = body.manualRateAed != null ? String(body.manualRateAed) : null;
  if (typeof body.tvVisible === "boolean") updates.tvVisible = body.tvVisible;

  const [updated] = await db
    .update(priceItemsTable)
    .set(updates)
    .where(eq(priceItemsTable.id, id))
    .returning();

  broadcast("PRICE_MUTATION");
  res.json(toJson(updated));
});

router.delete("/prices/items/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);

  const [existing] = await db.select().from(priceItemsTable).where(eq(priceItemsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Price item not found" });
    return;
  }
  await db.delete(priceItemsTable).where(eq(priceItemsTable.id, id));
  broadcast("PRICE_MUTATION");
  res.status(204).send();
});

export default router;
