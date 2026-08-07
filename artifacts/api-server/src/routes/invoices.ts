import { Router, type IRouter } from "express";
import { eq, ilike, gte, lte, and, desc, sql } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, stockMovementsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { broadcast } from "../lib/socket.js";
import { applyStockDelta } from "./stock";
import { consumeFifo, reverseInvoiceConsumption } from "../services/inventoryEngine";
import {
  ListInvoicesQueryParams,
  CreateInvoiceBody,
  GetInvoiceParams,
  DeleteInvoiceParams,
  ListInvoicesResponse,
  CreateInvoiceResponse,
  GetInvoiceResponse,
  GetMonthlySalesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Map an invoice line item to its inventory stock category. "995" is its own
// stock bucket even though the pricing engine treats it as a tt_bar; jewelry
// karats all draw from the single gold_jewelry_22k stock pool. Unknown/custom
// items are not stock-tracked (returns null → no deduction).
function itemStockCategory(description: string, category: string | null | undefined): string | null {
  if (description.trim() === "995") return "995";
  switch (category) {
    case "gold": return "gold";
    case "tt_bar": return "tt_bar";
    case "kg_bar": return "kg_bar";
    case "silver": return "silver";
    case "gold_jewelry": return "gold_jewelry_22k";
    default: return null;
  }
}

function parseInvoice(inv: typeof invoicesTable.$inferSelect) {
  return {
    ...inv,
    subtotal: Number(inv.subtotal),
    discount: Number(inv.discount),
    total: Number(inv.total),
    metalRate: inv.metalRate != null ? Number(inv.metalRate) : null,
    vatRate: inv.vatRate != null ? Number(inv.vatRate) : null,
    vatAmount: inv.vatAmount != null ? Number(inv.vatAmount) : null,
    totalBeforeVat: inv.totalBeforeVat != null ? Number(inv.totalBeforeVat) : null,
    totalIncludingVat: inv.totalIncludingVat != null ? Number(inv.totalIncludingVat) : null,
    roundOffDiscount: inv.roundOffDiscount != null ? Number(inv.roundOffDiscount) : null,
    createdAt: inv.createdAt.toISOString(),
    items: [],
  };
}

function parseItem(item: typeof invoiceItemsTable.$inferSelect) {
  return {
    ...item,
    quantity: Number(item.quantity),
    weight: item.weight != null ? Number(item.weight) : null,
    grossWeight: item.grossWeight != null ? Number(item.grossWeight) : null,
    purity: item.purity ?? null,
    purityMultiplier: item.purityMultiplier != null ? Number(item.purityMultiplier) : null,
    pureWeight: item.pureWeight != null ? Number(item.pureWeight) : null,
    makingRate: item.makingRate != null ? Number(item.makingRate) : null,
    makingAmt: item.makingAmt != null ? Number(item.makingAmt) : null,
    unitPrice: Number(item.unitPrice),
    totalPrice: Number(item.totalPrice),
  };
}

// Item-level sales report powering the invoices page summary cards and the
// PDF Sales Statement. Summary is computed from matching items (distinct
// invoice count, sum of gross weight and item totals).
router.get("/invoices/sales-report", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const search = q.search?.trim() || undefined;
  const category = q.category?.trim() || undefined;
  const startDate = q.startDate?.trim() || undefined;
  const endDate = q.endDate?.trim() || undefined;

  const conds = [sql`TRUE`];
  if (search) {
    const like = `%${search}%`;
    conds.push(sql`(i.customer_name ILIKE ${like} OR i.invoice_number ILIKE ${like} OR i.customer_mobile ILIKE ${like})`);
  }
  if (startDate) {
    const d = new Date(startDate);
    if (!Number.isNaN(d.getTime())) conds.push(sql`i.created_at >= ${d.toISOString()}::timestamptz`);
  }
  if (endDate) {
    const d = new Date(endDate);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + 1);
      conds.push(sql`i.created_at < ${d.toISOString()}::timestamptz`);
    }
  }
  if (category) {
    conds.push(sql`(CASE WHEN TRIM(ii.description) = '995' THEN '995'
                         WHEN ii.category = 'gold_jewelry' THEN 'gold_jewelry_22k'
                         ELSE ii.category END) = ${category}`);
  }
  const where = sql.join(conds, sql` AND `);

  const result = await db.execute<{
    invoice_id: number;
    invoice_number: string;
    created_at: Date;
    customer_name: string | null;
    bucket: string | null;
    description: string;
    gross_weight: string | null;
    unit_price: string;
    total_price: string;
  }>(sql`
    SELECT i.id AS invoice_id, i.invoice_number, i.created_at, i.customer_name,
           (CASE WHEN TRIM(ii.description) = '995' THEN '995'
                 WHEN ii.category = 'gold_jewelry' THEN 'gold_jewelry_22k'
                 ELSE ii.category END) AS bucket,
           ii.description, ii.gross_weight, ii.unit_price,
           -- Revenue basis: the invoice's final billed total (after VAT and
           -- round-off discount), allocated across line items proportionally
           -- to their pre-VAT line totals. Rows then sum exactly to billed
           -- revenue, and category filters get their fair share.
           COALESCE(ii.total_price::numeric * (i.total::numeric / NULLIF(inv_sum.items_total, 0)), ii.total_price::numeric) AS total_price
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN LATERAL (
      SELECT SUM(x.total_price::numeric) AS items_total
      FROM invoice_items x WHERE x.invoice_id = i.id
    ) inv_sum ON TRUE
    WHERE ${where}
    ORDER BY i.created_at DESC, i.id DESC, ii.id ASC
  `);

  const rows = (result.rows || []).map((r) => ({
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number,
    date: new Date(r.created_at).toISOString(),
    customerName: r.customer_name,
    // Custom items have no stock bucket — surface the exact user-entered
    // description as the category so reports never show a generic "Custom".
    category: r.bucket ?? r.description.trim(),
    description: r.description,
    weightGrams: r.gross_weight != null ? Number(r.gross_weight) : 0,
    ratePerGram: Number(r.unit_price),
    totalAed: Number(r.total_price),
  }));

  const summary = {
    totalGrams: rows.reduce((s, r) => s + r.weightGrams, 0),
    totalAed: rows.reduce((s, r) => s + r.totalAed, 0),
    invoiceCount: new Set(rows.map((r) => r.invoiceId)).size,
  };

  res.json({ summary, rows });
});

router.get("/invoices/monthly-sales", async (_req, res): Promise<void> => {
  const rows = await db.execute<{
    month: string;
    total: string;
    cash: string;
    card: string;
    bank_transfer: string;
  }>(sql`
    SELECT
      TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
      SUM(total::numeric) AS total,
      SUM(CASE WHEN payment_method = 'cash' THEN total::numeric ELSE 0 END) AS cash,
      SUM(CASE WHEN payment_method = 'card' THEN total::numeric ELSE 0 END) AS card,
      SUM(CASE WHEN payment_method = 'bank_transfer' THEN total::numeric ELSE 0 END) AS bank_transfer
    FROM invoices
    GROUP BY TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM')
    ORDER BY month DESC
    LIMIT 12
  `);

  const formatted = (rows.rows || []).map((r) => ({
    month: r.month,
    total: Number(r.total),
    cash: Number(r.cash),
    card: Number(r.card),
    bankTransfer: Number(r.bank_transfer),
  })).reverse();

  res.json(GetMonthlySalesResponse.parse(formatted));
});

router.get("/invoices", async (req, res): Promise<void> => {
  const query = ListInvoicesQueryParams.safeParse(req.query);
  const search = query.success ? query.data.search : undefined;
  const paymentMethod = query.success ? query.data.paymentMethod : undefined;
  const startDate = query.success ? query.data.startDate : undefined;
  const endDate = query.success ? query.data.endDate : undefined;
  const category = query.success ? (query.data as { category?: string }).category : undefined;

  const conditions = [];
  if (search) {
    conditions.push(
      sql`(${ilike(invoicesTable.customerName, `%${search}%`)} OR ${ilike(invoicesTable.invoiceNumber, `%${search}%`)} OR ${ilike(invoicesTable.customerMobile, `%${search}%`)})`,
    );
  }
  if (category) {
    // Same bucket rule as itemStockCategory: "995" descriptions are their own
    // bucket; all jewelry karats share gold_jewelry_22k.
    conditions.push(sql`EXISTS (
      SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = ${invoicesTable.id}
      AND (CASE WHEN TRIM(ii.description) = '995' THEN '995'
                WHEN ii.category = 'gold_jewelry' THEN 'gold_jewelry_22k'
                ELSE ii.category END) = ${category}
    )`);
  }
  if (paymentMethod) {
    conditions.push(eq(invoicesTable.paymentMethod, paymentMethod));
  }
  if (startDate) {
    conditions.push(gte(invoicesTable.createdAt, new Date(startDate)));
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);
    conditions.push(lte(invoicesTable.createdAt, end));
  }

  const rows = conditions.length > 0
    ? await db.select().from(invoicesTable).where(and(...conditions)).orderBy(desc(invoicesTable.createdAt))
    : await db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt));

  const invoicesWithItems = await Promise.all(
    rows.map(async (inv) => {
      const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, inv.id));
      return { ...parseInvoice(inv), items: items.map(parseItem) };
    })
  );

  res.json(ListInvoicesResponse.parse(invoicesWithItems));
});

router.post("/invoices", async (req, res): Promise<void> => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { items, createdAt, ...invoiceData } = parsed.data;

  let invoiceCreatedAt: Date | undefined;
  if (createdAt) {
    const parsedDate = new Date(createdAt);
    if (Number.isNaN(parsedDate.getTime())) {
      res.status(400).json({ error: "Invalid createdAt date" });
      return;
    }
    invoiceCreatedAt = parsedDate;
  }

  // Generate invoice number based on max existing number (not count, to handle deletions)
  const [maxRow] = await db.execute<{ max_num: string | null }>(
    sql`SELECT MAX(CAST(SUBSTRING(invoice_number FROM 5) AS INTEGER)) AS max_num FROM invoices WHERE invoice_number ~ '^INV-[0-9]+$'`
  ).then((r) => r.rows);
  const nextNum = (maxRow?.max_num != null ? parseInt(maxRow.max_num, 10) : 0) + 1;
  const invoiceNumber = `INV-${String(nextNum).padStart(5, "0")}`;

  // Invoice row, items, stock deltas, and FIFO batch consumption are all
  // committed in ONE transaction: an invoice can never exist without its
  // stock movements and exact-COGS consumption rows (and vice versa).
  const stockWarnings: string[] = [];
  const { invoice, savedItems, hadDeductions } = await db.transaction(async (tx) => {
  const [invoice] = await tx
    .insert(invoicesTable)
    .values({
      ...invoiceData,
      invoiceNumber,
      subtotal: String(invoiceData.subtotal ?? 0),
      discount: String(invoiceData.discount ?? 0),
      total: String(invoiceData.total),
      metalRate: invoiceData.metalRate != null ? String(invoiceData.metalRate) : null,
      vatRate: String(invoiceData.vatRate ?? 5),
      vatAmount: String(invoiceData.vatAmount ?? 0),
      totalBeforeVat: String(invoiceData.totalBeforeVat ?? 0),
      totalIncludingVat: String(invoiceData.totalIncludingVat ?? 0),
      roundOffDiscount: String(invoiceData.roundOffDiscount ?? 0),
      isPending: invoiceData.isPending ?? false,
      createdByUserId: req.session.userId ?? null,
      createdByUserName: req.session.fullName ?? null,
      ...(invoiceCreatedAt ? { createdAt: invoiceCreatedAt } : {}),
    })
    .returning();

  let savedItems: (typeof invoiceItemsTable.$inferSelect)[] = [];
  if (items && items.length > 0) {
    savedItems = await tx
      .insert(invoiceItemsTable)
      .values(
        items.map((item) => ({
          invoiceId: invoice.id,
          productId: item.productId ?? null,
          description: item.description,
          category: item.category ?? null,
          quantity: String(item.quantity),
          weight: item.weight != null ? String(item.weight) : null,
          grossWeight: item.grossWeight != null ? String(item.grossWeight) : null,
          purity: item.purity ?? null,
          purityMultiplier: item.purityMultiplier != null ? String(item.purityMultiplier) : null,
          pureWeight: item.pureWeight != null ? String(item.pureWeight) : null,
          makingRate: item.makingRate != null ? String(item.makingRate) : null,
          makingAmt: item.makingAmt != null ? String(item.makingAmt) : null,
          unitPrice: String(item.unitPrice),
          totalPrice: String(item.totalPrice),
        }))
      )
      .returning();
  }

  // ── Auto-deduction engine ────────────────────────────────────────────────
  // Subtract each sold item's gross weight from the live category stock and
  // log the movement. Sales are never blocked: if stock is insufficient the
  // invoice is still created and a warning is returned instead (stock can go
  // negative until purchases are recorded).
  const deductions = new Map<string, number>();
  const itemConsumptions: { itemId: number; category: string; grams: number }[] = [];
  for (const item of savedItems) {
    const cat = itemStockCategory(item.description, item.category);
    const grams = item.grossWeight != null ? Number(item.grossWeight) : 0;
    if (!cat || !(grams > 0)) continue;
    deductions.set(cat, (deductions.get(cat) ?? 0) + grams);
    itemConsumptions.push({ itemId: item.id, category: cat, grams });
  }
  for (const [cat, grams] of deductions) {
    // applyStockDelta returns the post-deduction balance from the same
    // atomic upsert, so the oversell warning can't race a separate read.
    const newBalance = await applyStockDelta(
      tx as unknown as typeof db, cat, -grams, "sale", "invoice", invoice.id, invoice.invoiceNumber,
    );
    if (newBalance < 0) {
      const available = newBalance + grams;
      stockWarnings.push(
        `Insufficient stock for ${cat}: sold ${grams.toFixed(3)}g but only ${Math.max(available, 0).toFixed(3)}g available`,
      );
    }
  }
  // FIFO multi-batch consumption: split each sold item across the oldest
  // open purchase lots and record the exact per-slice COGS.
  for (const ic of itemConsumptions) {
    const { shortfallGrams } = await consumeFifo(tx as unknown as typeof db, {
      invoiceId: invoice.id, invoiceItemId: ic.itemId, category: ic.category, grams: ic.grams,
    });
    if (shortfallGrams > 0) {
      stockWarnings.push(
        `FIFO batches exhausted for ${ic.category}: ${shortfallGrams.toFixed(3)}g costed at average purchase rate`,
      );
    }
  }

  return { invoice, savedItems, hadDeductions: deductions.size > 0 };
  });

  res.status(201).json(CreateInvoiceResponse.parse({
    ...parseInvoice(invoice),
    items: savedItems.map(parseItem),
    ...(stockWarnings.length > 0 ? { stockWarnings } : {}),
  }));
  broadcast("INVOICE_MUTATION");
  if (hadDeductions) broadcast("STOCK_MUTATION");
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetInvoiceParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, params.data.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoice.id));

  res.json(GetInvoiceResponse.parse({ ...parseInvoice(invoice), items: items.map(parseItem) }));
});

router.delete("/invoices/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteInvoiceParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Delete the invoice and reverse its stock deductions in ONE transaction.
  // DELETE ... RETURNING guarantees only the request that actually removed the
  // row applies the reversal (no double-reversal on concurrent deletes). Net
  // effect per category = sum of this invoice's sale/sale_reversal movements;
  // reversing the net keeps the ledger correct even on repeated operations.
  const invoiceId = params.data.id;
  const deletedInvoice = await db.transaction(async (tx) => {
    // Lock the invoice row first (instead of deleting immediately): the FIFO
    // reversal must read inventory_consumptions BEFORE the invoice delete
    // cascades them away, and the lock keeps concurrent deletes serialized so
    // the reversal still runs exactly once.
    const [locked] = await tx.execute<{ id: number }>(
      sql`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`,
    ).then((r) => r.rows);
    if (!locked) return null;
    // Restore FIFO batch balances and drop this invoice's COGS ledger rows.
    await reverseInvoiceConsumption(tx as unknown as typeof db, invoiceId);
    const [row] = await tx.delete(invoicesTable).where(eq(invoicesTable.id, invoiceId)).returning();
    if (!row) return null;
    const movements = await tx
      .select()
      .from(stockMovementsTable)
      .where(and(eq(stockMovementsTable.refType, "invoice"), eq(stockMovementsTable.refId, invoiceId)));
    const netByCategory = new Map<string, number>();
    for (const m of movements) {
      netByCategory.set(m.category, (netByCategory.get(m.category) ?? 0) + Number(m.weightGrams));
    }
    for (const [cat, net] of netByCategory) {
      if (net === 0) continue;
      await applyStockDelta(
        tx as unknown as typeof db, cat, -net, "sale_reversal", "invoice", invoiceId,
        `Deleted ${row.invoiceNumber}`,
      );
    }
    return row;
  });
  if (!deletedInvoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  broadcast("INVOICE_MUTATION");
  broadcast("STOCK_MUTATION");
  res.sendStatus(204);
});

export default router;
