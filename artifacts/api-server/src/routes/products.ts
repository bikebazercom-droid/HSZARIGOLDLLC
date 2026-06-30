import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, productsTable } from "@workspace/db";
import {
  ListProductsQueryParams,
  CreateProductBody,
  UpdateProductParams,
  UpdateProductBody,
  DeleteProductParams,
  ListProductsResponse,
  CreateProductResponse,
  UpdateProductResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  const category = query.success ? query.data.category : undefined;

  let rows;
  if (category) {
    rows = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.category, category))
      .orderBy(productsTable.category, productsTable.name);
  } else {
    rows = await db.select().from(productsTable).orderBy(productsTable.category, productsTable.name);
  }

  const parsed = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    pricePerUnit: r.pricePerUnit != null ? Number(r.pricePerUnit) : null,
    stock: r.stock != null ? Number(r.stock) : null,
  }));

  res.json(ListProductsResponse.parse(parsed));
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { pricePerUnit, stock, ...rest } = parsed.data;
  const [product] = await db.insert(productsTable).values({
    ...rest,
    pricePerUnit: pricePerUnit != null ? String(pricePerUnit) : null,
    stock: stock != null ? String(stock) : null,
  }).returning();

  res.status(201).json(CreateProductResponse.parse({
    ...product,
    createdAt: product.createdAt.toISOString(),
    pricePerUnit: product.pricePerUnit != null ? Number(product.pricePerUnit) : null,
    stock: product.stock != null ? Number(product.stock) : null,
  }));
});

router.put("/products/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateProductParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { pricePerUnit: ppu, stock: stk, ...restUpdate } = parsed.data;
  const [product] = await db
    .update(productsTable)
    .set({
      ...restUpdate,
      pricePerUnit: ppu != null ? String(ppu) : null,
      stock: stk != null ? String(stk) : null,
    })
    .where(eq(productsTable.id, params.data.id))
    .returning();

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.json(UpdateProductResponse.parse({
    ...product,
    createdAt: product.createdAt.toISOString(),
    pricePerUnit: product.pricePerUnit != null ? Number(product.pricePerUnit) : null,
    stock: product.stock != null ? Number(product.stock) : null,
  }));
});

router.delete("/products/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteProductParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.delete(productsTable).where(eq(productsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
