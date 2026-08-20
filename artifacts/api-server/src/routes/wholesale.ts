import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  wholesaleTradersTable,
  wholesaleInvoicesTable,
  wholesaleInvoiceItemsTable,
  wholesaleReturnsTable,
  wholesaleReturnLinesTable,
  traderLedgerEntriesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth.js";
import { broadcast } from "../lib/socket.js";
import { authorizePdfTestRun, registerPdfTestFixture } from "./pdf-test-fixtures.js";
import {
  ListWholesaleTradersResponse,
  GetWholesaleTraderResponse,
  CreateWholesaleTraderResponse,
  UpdateWholesaleTraderResponse,
  ListWholesaleInvoicesResponse,
  GetWholesaleInvoiceResponse,
  CreateWholesaleInvoiceResponse,
  FixWholesaleRateResponse,
  ReturnWholesaleGoodsResponse,
  GetWholesaleDashboardResponse,
  GetTraderStatementResponse,
  CreateWholesaleTraderBody,
  UpdateWholesaleTraderBody,
  CreateWholesaleInvoiceBody,
  FixWholesaleRateBody,
  ReturnWholesaleGoodsBody,
  ListWholesaleTradersQueryParams,
  ListWholesaleInvoicesQueryParams,
  GetWholesaleTraderParams,
  UpdateWholesaleTraderParams,
  GetWholesaleInvoiceParams,
  FixWholesaleRateParams,
  ReturnWholesaleGoodsParams,
  GetWholesaleDashboardQueryParams,
  GetTraderStatementQueryParams,
  DeleteWholesaleInvoiceParams,
} from "@workspace/api-zod";
import {
  createWholesaleInvoice,
  loadWholesaleInvoice,
  applyRateFix,
  applyPhysicalReturn,
  loadWholesaleReturn,
  deleteWholesaleInvoice,
} from "../services/wholesaleService.js";
import {
  createWholesaleInvoicePdf,
  createWholesaleReturnPdf,
  createTraderStatementPdf,
  createWholesaleSummaryPdf,
} from "../lib/wholesalePdf.js";

const router: IRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTrader(row: typeof wholesaleTradersTable.$inferSelect) {
  return {
    ...row,
    contactPerson: row.contactPerson ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    trn: row.trn ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parseInvoiceItem(row: typeof wholesaleInvoiceItemsTable.$inferSelect) {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    description: row.description,
    category: row.category,
    quantity: Number(row.quantity),
    grossGrams: Number(row.grossGrams),
    purityMultiplier: Number(row.purityMultiplier),
    pureGrams: Number(row.pureGrams),
    rateAedPerGram: row.rateAedPerGram != null ? Number(row.rateAedPerGram) : null,
    makingAed: Number(row.makingAed),
    totalAed: Number(row.totalAed),
    fixedPureGrams: Number(row.fixedPureGrams),
    returnedGrossGrams: Number(row.returnedGrossGrams),
    returnedPureGrams: Number(row.returnedPureGrams),
    returnedFixedPureGrams: Number(row.returnedFixedPureGrams),
    returnedMakingAed: Number(row.returnedMakingAed),
    returnedMetalAed: Number(row.returnedMetalAed),
  };
}

function parseInvoice(
  row: typeof wholesaleInvoicesTable.$inferSelect,
  items: (typeof wholesaleInvoiceItemsTable.$inferSelect)[],
) {
  return {
    id: row.id,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    traderId: row.traderId ?? null,
    traderName: row.traderName,
    traderContactPerson: row.traderContactPerson ?? null,
    traderPhone: row.traderPhone ?? null,
    traderEmail: row.traderEmail ?? null,
    traderAddress: row.traderAddress ?? null,
    traderTrn: row.traderTrn ?? null,
    pricingType: row.pricingType as "fixed" | "unfixed",
    paymentMode: row.paymentMode as "cash" | "card" | "bank_transfer" | null,
    notes: row.notes ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdByUserName: row.createdByUserName ?? null,
    status: row.status as "open" | "partially_settled" | "settled",
    totalGrossGrams: Number(row.totalGrossGrams),
    totalPureGrams: Number(row.totalPureGrams),
    totalMakingAed: Number(row.totalMakingAed),
    totalAed: Number(row.totalAed),
    openPureGrams: Number(row.openPureGrams),
    settledAed: Number(row.settledAed),
    createdAt: row.createdAt.toISOString(),
    items: items.map(parseInvoiceItem),
  };
}

function parseReturn(
  row: typeof wholesaleReturnsTable.$inferSelect,
  lines: (typeof wholesaleReturnLinesTable.$inferSelect)[],
) {
  return {
    id: row.id,
    returnNumber: row.returnNumber,
    invoiceId: row.invoiceId,
    returnDate: row.returnDate,
    note: row.note ?? null,
    totalReturnedGrossGrams: Number(row.totalReturnedGrossGrams),
    totalReturnedPureGrams: Number(row.totalReturnedPureGrams),
    totalReturnedFixedPureGrams: Number(row.totalReturnedFixedPureGrams),
    totalReturnedMakingAed: Number(row.totalReturnedMakingAed),
    totalReturnedMetalAed: Number(row.totalReturnedMetalAed),
    totalReturnedAed: Number(row.totalReturnedAed),
    createdByUserId: row.createdByUserId ?? null,
    createdByUserName: row.createdByUserName ?? null,
    createdAt: row.createdAt.toISOString(),
    lines: lines.map((l) => ({
      id: l.id,
      invoiceItemId: l.invoiceItemId,
      grossWeightGrams: Number(l.grossWeightGrams),
      pureWeightGrams: Number(l.pureWeightGrams),
      returnedFixedPureGrams: Number(l.returnedFixedPureGrams),
      returnedMakingAed: Number(l.returnedMakingAed),
      returnedMetalAed: Number(l.returnedMetalAed),
      returnedAed: Number(l.returnedAed),
    })),
  };
}

function parseLedgerEntry(row: typeof traderLedgerEntriesTable.$inferSelect) {
  return {
    id: row.id,
    traderId: row.traderId,
    eventType: row.eventType as "delivery" | "fixed_sale" | "rate_fix" | "physical_return",
    eventDate: row.eventDate,
    aedDelta: Number(row.aedDelta),
    pureGoldGramsDelta: Number(row.pureGoldGramsDelta),
    wholesaleInvoiceId: row.wholesaleInvoiceId ?? null,
    wholesaleItemId: row.wholesaleItemId ?? null,
    wholesaleSettlementId: row.wholesaleSettlementId ?? null,
    wholesaleReturnId: row.wholesaleReturnId ?? null,
    note: row.note ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdByUserName: row.createdByUserName ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Traders CRUD ─────────────────────────────────────────────────────────────

router.get("/wholesale/traders", async (req, res): Promise<void> => {
  const query = ListWholesaleTradersQueryParams.safeParse(req.query);
  const { search, isActive } = query.success ? query.data : {} as { search?: string; isActive?: boolean };
  const conditions = [];
  if (search) conditions.push(ilike(wholesaleTradersTable.name, `%${search}%`));
  if (isActive != null) conditions.push(eq(wholesaleTradersTable.isActive, isActive));

  const traders = await db.select().from(wholesaleTradersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(wholesaleTradersTable.name);

  res.json(ListWholesaleTradersResponse.parse(traders.map(parseTrader)));
});

router.get("/wholesale/traders/:id", async (req, res): Promise<void> => {
  const params = GetWholesaleTraderParams.safeParse({ id: parseInt(String(req.params.id), 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [trader] = await db.select().from(wholesaleTradersTable).where(eq(wholesaleTradersTable.id, params.data.id));
  if (!trader) { res.status(404).json({ error: "Trader not found" }); return; }
  res.json(GetWholesaleTraderResponse.parse(parseTrader(trader)));
});

router.post("/wholesale/traders", async (req, res): Promise<void> => {
  const parsed = CreateWholesaleTraderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const testRun = await authorizePdfTestRun(req);
  if (testRun.requested && !testRun.runId) {
    res.status(403).json({ error: "PDF test fixture ownership was rejected" });
    return;
  }
  const { name, contactPerson, phone, email, address, trn, isActive } = parsed.data;
  const trader = await db.transaction(async (tx) => {
    const [created] = await tx.insert(wholesaleTradersTable).values({
      name: name.trim(),
      contactPerson: contactPerson?.trim() || null,
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      address: address?.trim() || null,
      trn: trn?.trim() || null,
      isActive: isActive ?? true,
    }).returning();
    await registerPdfTestFixture(
      tx as unknown as typeof db,
      testRun.runId,
      "wholesale_trader",
      created.id,
    );
    return created;
  });
  res.status(201).json(CreateWholesaleTraderResponse.parse(parseTrader(trader)));
});

router.patch("/wholesale/traders/:id", async (req, res): Promise<void> => {
  const params = UpdateWholesaleTraderParams.safeParse({ id: parseInt(String(req.params.id), 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateWholesaleTraderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name != null) updates.name = parsed.data.name.trim();
  if (parsed.data.contactPerson != null) updates.contactPerson = parsed.data.contactPerson.trim() || null;
  if (parsed.data.phone != null) updates.phone = parsed.data.phone.trim() || null;
  if (parsed.data.email != null) updates.email = parsed.data.email.trim() || null;
  if (parsed.data.address != null) updates.address = parsed.data.address.trim() || null;
  if (parsed.data.trn != null) updates.trn = parsed.data.trn.trim() || null;
  if (parsed.data.isActive != null) updates.isActive = parsed.data.isActive;

  const [updated] = await db.update(wholesaleTradersTable)
    .set(updates)
    .where(eq(wholesaleTradersTable.id, params.data.id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Trader not found" }); return; }
  res.json(UpdateWholesaleTraderResponse.parse(parseTrader(updated)));
});

// ── Wholesale Invoices ───────────────────────────────────────────────────────

router.get("/wholesale/invoices", async (req, res): Promise<void> => {
  const query = ListWholesaleInvoicesQueryParams.safeParse(req.query);
  const { traderId, status, startDate, endDate } = query.success ? query.data : {} as {
    traderId?: number; status?: string; startDate?: string; endDate?: string;
  };
  const conditions = [];
  if (traderId != null) conditions.push(eq(wholesaleInvoicesTable.traderId, traderId));
  if (status) conditions.push(eq(wholesaleInvoicesTable.status, status));
  if (startDate) conditions.push(gte(wholesaleInvoicesTable.invoiceDate, startDate));
  if (endDate) conditions.push(lte(wholesaleInvoicesTable.invoiceDate, endDate));

  const invoices = await db.select().from(wholesaleInvoicesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(wholesaleInvoicesTable.invoiceDate), desc(wholesaleInvoicesTable.id));

  const items = invoices.length
    ? await db.select().from(wholesaleInvoiceItemsTable)
        .where(inArray(wholesaleInvoiceItemsTable.invoiceId, invoices.map((i) => i.id)))
        .orderBy(wholesaleInvoiceItemsTable.id)
    : [];

  res.json(ListWholesaleInvoicesResponse.parse(
    invoices.map((inv) => parseInvoice(inv, items.filter((it) => it.invoiceId === inv.id))),
  ));
});

router.get("/wholesale/invoices/:id", async (req, res): Promise<void> => {
  const params = GetWholesaleInvoiceParams.safeParse({ id: parseInt(String(req.params.id), 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const loaded = await loadWholesaleInvoice(params.data.id);
  if (!loaded) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json(GetWholesaleInvoiceResponse.parse(parseInvoice(loaded.invoice, loaded.items)));
});

// ── Delete Wholesale Invoice (admin only) ────────────────────────────────────

router.delete("/wholesale/invoices/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteWholesaleInvoiceParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const result = await deleteWholesaleInvoice({
      invoiceId: params.data.id,
      actorId: req.session?.userId ?? null,
      actorName: req.session?.fullName ?? null,
    });

    if (result.notFound) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    broadcast("STOCK_MUTATION");
    broadcast("WHOLESALE_MUTATION");
    res.sendStatus(204);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    if (typeof e?.statusCode === "number") {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw err;
  }
});

router.post("/wholesale/invoices", async (req, res): Promise<void> => {
  const parsed = CreateWholesaleInvoiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const input = parsed.data;
  const testRun = await authorizePdfTestRun(req);
  if (testRun.requested && !testRun.runId) {
    res.status(403).json({ error: "PDF test fixture ownership was rejected" });
    return;
  }

  // Validate trader
  const [trader] = await db.select().from(wholesaleTradersTable).where(eq(wholesaleTradersTable.id, input.traderId));
  if (!trader) { res.status(400).json({ error: "Trader not found" }); return; }

  // Validate: fixed requires rate per item, unfixed must not have rate
  if (input.pricingType === "fixed") {
    for (const [i, it] of input.items.entries()) {
      if (!it.rateAedPerGram || it.rateAedPerGram <= 0) {
        res.status(400).json({ error: `Fixed invoice: item ${i + 1} must have a positive rateAedPerGram` });
        return;
      }
    }
  }

  try {
    const { invoice: result } = await createWholesaleInvoice({
      traderId: input.traderId,
      traderSnapshot: {
        name: trader.name,
        contactPerson: trader.contactPerson,
        phone: trader.phone,
        email: trader.email,
        address: trader.address,
        trn: trader.trn,
      },
      invoiceDate: input.invoiceDate,
      pricingType: input.pricingType as "fixed" | "unfixed",
      paymentMode: input.paymentMode ?? null,
      notes: input.notes ?? null,
      createdByUserId: req.session?.userId ?? null,
      createdByUserName: req.session?.fullName ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      fixtureRunId: testRun.runId,
      items: input.items.map((it) => ({
        description: it.description,
        category: it.category,
        quantity: it.quantity,
        grossGrams: it.grossGrams,
        purityMultiplier: it.purityMultiplier,
        makingAed: it.makingAed,
        rateAedPerGram: it.rateAedPerGram ?? null,
      })),
    });

    if (!result) { res.status(500).json({ error: "Failed to create invoice" }); return; }
    res.status(201).json(CreateWholesaleInvoiceResponse.parse(parseInvoice(result.invoice, result.items)));
    broadcast("STOCK_MUTATION");
    broadcast("WHOLESALE_MUTATION");
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    if (typeof e?.statusCode === "number") {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw err;
  }
});

// ── Rate Fix (admin only) ─────────────────────────────────────────────────────

router.post("/wholesale/invoices/:id/fix-rate", requireAdmin, async (req, res): Promise<void> => {
  const params = FixWholesaleRateParams.safeParse({ id: parseInt(String(req.params.id), 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = FixWholesaleRateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const testRun = await authorizePdfTestRun(req);
  if (testRun.requested && !testRun.runId) {
    res.status(403).json({ error: "PDF test fixture ownership was rejected" });
    return;
  }

  try {
    const { result } = await applyRateFix({
      invoiceId: params.data.id,
      pureWeightGrams: parsed.data.pureWeightGrams,
      rateAedPerGram: parsed.data.rateAedPerGram,
      date: parsed.data.date,
      note: parsed.data.note ?? null,
      actorId: req.session?.userId ?? null,
      actorName: req.session?.fullName ?? null,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      fixtureRunId: testRun.runId,
    });
    if (!result) { res.status(404).json({ error: "Invoice not found" }); return; }
    res.json(FixWholesaleRateResponse.parse(parseInvoice(result.invoice, result.items)));
    broadcast("WHOLESALE_MUTATION");
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    if (typeof e?.statusCode === "number") {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw err;
  }
});

// ── Physical Return (admin only) ─────────────────────────────────────────────

router.post("/wholesale/invoices/:id/return", requireAdmin, async (req, res): Promise<void> => {
  const params = ReturnWholesaleGoodsParams.safeParse({ id: parseInt(String(req.params.id), 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = ReturnWholesaleGoodsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const testRun = await authorizePdfTestRun(req);
  if (testRun.requested && !testRun.runId) {
    res.status(403).json({ error: "PDF test fixture ownership was rejected" });
    return;
  }

  try {
    const { result } = await applyPhysicalReturn({
      invoiceId: params.data.id,
      lines: parsed.data.lines.map((l) => ({
        invoiceItemId: l.invoiceItemId,
        grossWeightGrams: l.grossWeightGrams,
      })),
      date: parsed.data.date,
      note: parsed.data.note ?? null,
      actorId: req.session?.userId ?? null,
      actorName: req.session?.fullName ?? null,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      fixtureRunId: testRun.runId,
    });
    if (!result) { res.status(404).json({ error: "Invoice not found" }); return; }
    res.json(ReturnWholesaleGoodsResponse.parse(parseReturn(result.ret, result.lines)));
    broadcast("STOCK_MUTATION");
    broadcast("WHOLESALE_MUTATION");
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message?: string };
    if (typeof e?.statusCode === "number") {
      res.status(e.statusCode).json({ error: e.message });
      return;
    }
    throw err;
  }
});

// ── Trader Statement ─────────────────────────────────────────────────────────

router.get("/wholesale/ledger", async (req, res): Promise<void> => {
  const query = GetTraderStatementQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { traderId, startDate, endDate } = query.data;

  const [trader] = await db.select().from(wholesaleTradersTable).where(eq(wholesaleTradersTable.id, traderId));
  if (!trader) { res.status(404).json({ error: "Trader not found" }); return; }

  const conditions = [eq(traderLedgerEntriesTable.traderId, traderId)];
  if (startDate) conditions.push(gte(traderLedgerEntriesTable.eventDate, startDate));
  if (endDate) conditions.push(lte(traderLedgerEntriesTable.eventDate, endDate));

  const entries = await db.select().from(traderLedgerEntriesTable)
    .where(and(...conditions))
    .orderBy(traderLedgerEntriesTable.eventDate, traderLedgerEntriesTable.id);

  // Compute running balances
  const balanceAed = entries.reduce((s, e) => s + Number(e.aedDelta), 0);
  const balancePureGrams = entries.reduce((s, e) => s + Number(e.pureGoldGramsDelta), 0);

  res.json(GetTraderStatementResponse.parse({
    trader: parseTrader(trader),
    entries: entries.map(parseLedgerEntry),
    balanceAed: Math.round(balanceAed * 100) / 100,
    balancePureGrams: Math.round(balancePureGrams * 10000) / 10000,
  }));
});

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get("/wholesale/dashboard", async (req, res): Promise<void> => {
  const query = GetWholesaleDashboardQueryParams.safeParse(req.query);
  const { startDate, endDate } = query.success ? query.data : {} as { startDate?: string; endDate?: string };

  const conditions = [];
  if (startDate) conditions.push(gte(wholesaleInvoicesTable.invoiceDate, startDate));
  if (endDate) conditions.push(lte(wholesaleInvoicesTable.invoiceDate, endDate));
  const ledgerConditions = [];
  if (startDate) ledgerConditions.push(sql`tle.event_date >= ${startDate}`);
  if (endDate) ledgerConditions.push(sql`tle.event_date <= ${endDate}`);
  const returnConditions = [];
  if (startDate) returnConditions.push(sql`return_date >= ${startDate}`);
  if (endDate) returnConditions.push(sql`return_date <= ${endDate}`);

  const [stats] = await db.execute<{
    invoice_count: string;
    fixed_count: string;
    unfixed_count: string;
    settled_count: string;
    total_fixed_aed: string;
    open_pure_grams: string;
    returned_gross_grams: string;
  }>(sql`
    SELECT
      COUNT(*)::text AS invoice_count,
      COUNT(*) FILTER (WHERE pricing_type = 'fixed')::text AS fixed_count,
      COUNT(*) FILTER (WHERE pricing_type = 'unfixed')::text AS unfixed_count,
      COUNT(*) FILTER (WHERE status = 'settled')::text AS settled_count,
      (SELECT COALESCE(SUM(aed_delta::numeric), 0)
       FROM trader_ledger_entries tle
       ${ledgerConditions.length ? sql`WHERE ${and(...ledgerConditions)}` : sql``}
      )::text AS total_fixed_aed,
      COALESCE(SUM(open_pure_grams::numeric), 0)::text AS open_pure_grams,
      (SELECT COALESCE(SUM(total_returned_gross_grams::numeric), 0)
       FROM wholesale_returns
       ${returnConditions.length ? sql`WHERE ${and(...returnConditions)}` : sql``}
      )::text AS returned_gross_grams
    FROM wholesale_invoices
    ${conditions.length ? sql`WHERE ${and(...conditions)}` : sql``}
  `).then((r) => r.rows);

  const traderCount = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM wholesale_traders WHERE is_active = true`,
  ).then((r) => Number(r.rows[0]?.cnt ?? "0"));

  res.json(GetWholesaleDashboardResponse.parse({
    invoiceCount: parseInt(stats?.invoice_count ?? "0", 10),
    fixedInvoiceCount: parseInt(stats?.fixed_count ?? "0", 10),
    unfixedInvoiceCount: parseInt(stats?.unfixed_count ?? "0", 10),
    settledInvoiceCount: parseInt(stats?.settled_count ?? "0", 10),
    totalFixedAed: Math.round(Number(stats?.total_fixed_aed ?? "0") * 100) / 100,
    openPureGrams: Math.round(Number(stats?.open_pure_grams ?? "0") * 10000) / 10000,
    returnedGrossGrams: Math.round(Number(stats?.returned_gross_grams ?? "0") * 10000) / 10000,
    traderCount,
  }));
});

// ── PDF routes (outside OpenAPI spec) ───────────────────────────────────────

router.get("/wholesale/invoices/:id/pdf", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const loaded = await loadWholesaleInvoice(id);
  if (!loaded) { res.status(404).json({ error: "Invoice not found" }); return; }
  const { invoice, items } = loaded;
  const doc = createWholesaleInvoicePdf({
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    traderName: invoice.traderName,
    traderPhone: invoice.traderPhone,
    traderEmail: invoice.traderEmail,
    traderAddress: invoice.traderAddress,
    traderTrn: invoice.traderTrn,
    pricingType: invoice.pricingType,
    status: invoice.status,
    totalGrossGrams: Number(invoice.totalGrossGrams),
    totalPureGrams: Number(invoice.totalPureGrams),
    totalMakingAed: Number(invoice.totalMakingAed),
    totalAed: Number(invoice.totalAed),
    notes: invoice.notes,
    items: items.map((it) => ({
      description: it.description,
      category: it.category,
      quantity: Number(it.quantity),
      grossGrams: Number(it.grossGrams),
      purityMultiplier: Number(it.purityMultiplier),
      pureGrams: Number(it.pureGrams),
      rateAedPerGram: it.rateAedPerGram != null ? Number(it.rateAedPerGram) : null,
      makingAed: Number(it.makingAed),
      totalAed: Number(it.totalAed),
    })),
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="wholesale-invoice-${invoice.invoiceNumber}.pdf"`);
  doc.pipe(res);
});

router.get("/wholesale/returns/:id/pdf", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const loaded = await loadWholesaleReturn(id);
  if (!loaded) { res.status(404).json({ error: "Return not found" }); return; }
  const { ret, lines } = loaded;

  // Load invoice to get trader name
  const invoiceLoaded = await loadWholesaleInvoice(ret.invoiceId);
  const traderName = invoiceLoaded?.invoice.traderName ?? "Unknown";

  // Load items for descriptions
  const itemIds = lines.map((l) => l.invoiceItemId);
  const itemsData = itemIds.length
    ? await (async () => {
        const { db: dbInstance } = await import("@workspace/db");
        return dbInstance.select().from(wholesaleInvoiceItemsTable).where(
          inArray(wholesaleInvoiceItemsTable.id, itemIds),
        );
      })()
    : [];
  const itemMap = new Map(itemsData.map((it) => [it.id, it]));

  const doc = createWholesaleReturnPdf({
    returnNumber: ret.returnNumber,
    invoiceNumber: invoiceLoaded?.invoice.invoiceNumber ?? String(ret.invoiceId),
    returnDate: ret.returnDate,
    traderName,
    note: ret.note,
    totalReturnedGrossGrams: Number(ret.totalReturnedGrossGrams),
    totalReturnedPureGrams: Number(ret.totalReturnedPureGrams),
    totalReturnedMakingAed: Number(ret.totalReturnedMakingAed),
    totalReturnedMetalAed: Number(ret.totalReturnedMetalAed),
    totalReturnedAed: Number(ret.totalReturnedAed),
    lines: lines.map((l) => {
      const item = itemMap.get(l.invoiceItemId);
      return {
        description: item?.description ?? `Item ${l.invoiceItemId}`,
        category: item?.category ?? "unknown",
        grossWeightGrams: Number(l.grossWeightGrams),
        pureWeightGrams: Number(l.pureWeightGrams),
        returnedMakingAed: Number(l.returnedMakingAed),
        returnedMetalAed: Number(l.returnedMetalAed),
        returnedAed: Number(l.returnedAed),
      };
    }),
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="wholesale-return-${ret.returnNumber}.pdf"`);
  doc.pipe(res);
});

router.get("/wholesale/ledger/pdf", async (req, res): Promise<void> => {
  const traderId = parseInt(String(req.query.traderId), 10);
  if (Number.isNaN(traderId)) { res.status(400).json({ error: "traderId required" }); return; }
  const [trader] = await db.select().from(wholesaleTradersTable).where(eq(wholesaleTradersTable.id, traderId));
  if (!trader) { res.status(404).json({ error: "Trader not found" }); return; }

  const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
  const conditions = [eq(traderLedgerEntriesTable.traderId, traderId)];
  if (startDate) conditions.push(gte(traderLedgerEntriesTable.eventDate, startDate));
  if (endDate) conditions.push(lte(traderLedgerEntriesTable.eventDate, endDate));

  const entries = await db.select().from(traderLedgerEntriesTable)
    .where(and(...conditions))
    .orderBy(traderLedgerEntriesTable.eventDate, traderLedgerEntriesTable.id);

  const balanceAed = entries.reduce((s, e) => s + Number(e.aedDelta), 0);
  const balancePureGrams = entries.reduce((s, e) => s + Number(e.pureGoldGramsDelta), 0);

  const doc = createTraderStatementPdf({
    traderName: trader.name,
    traderPhone: trader.phone,
    traderTrn: trader.trn,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    entries: entries.map((e) => ({
      id: e.id,
      eventDate: e.eventDate,
      eventType: e.eventType,
      aedDelta: Number(e.aedDelta),
      pureGoldGramsDelta: Number(e.pureGoldGramsDelta),
      note: e.note,
      wholesaleInvoiceId: e.wholesaleInvoiceId,
    })),
    balanceAed: Math.round(balanceAed * 100) / 100,
    balancePureGrams: Math.round(balancePureGrams * 10000) / 10000,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="trader-statement-${trader.name}.pdf"`);
  doc.pipe(res);
});

router.get("/wholesale/summary/pdf", async (req, res): Promise<void> => {
  const {
    startDate,
    endDate,
    traderId: traderIdRaw,
    status: statusRaw,
  } = req.query as {
    startDate?: string;
    endDate?: string;
    traderId?: string;
    status?: string;
  };
  const conditions = [];
  const ledgerConditions = [];
  const returnConditions = [];
  if (startDate) conditions.push(gte(wholesaleInvoicesTable.invoiceDate, startDate));
  if (endDate) conditions.push(lte(wholesaleInvoicesTable.invoiceDate, endDate));
  if (startDate) ledgerConditions.push(sql`tle.event_date >= ${startDate}`);
  if (endDate) ledgerConditions.push(sql`tle.event_date <= ${endDate}`);
  if (startDate) returnConditions.push(sql`wr.return_date >= ${startDate}`);
  if (endDate) returnConditions.push(sql`wr.return_date <= ${endDate}`);
  if (traderIdRaw) {
    const traderId = parseInt(traderIdRaw, 10);
    if (Number.isNaN(traderId)) {
      res.status(400).json({ error: "Invalid traderId" });
      return;
    }
    conditions.push(eq(wholesaleInvoicesTable.traderId, traderId));
    ledgerConditions.push(sql`lwi.trader_id = ${traderId}`);
    returnConditions.push(sql`rwi.trader_id = ${traderId}`);
  }
  if (statusRaw) {
    if (!["open", "partially_settled", "settled"].includes(statusRaw)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    conditions.push(eq(wholesaleInvoicesTable.status, statusRaw));
    ledgerConditions.push(sql`lwi.status = ${statusRaw}`);
    returnConditions.push(sql`rwi.status = ${statusRaw}`);
  }

  const [stats] = await db.execute<{
    invoice_count: string;
    fixed_count: string;
    unfixed_count: string;
    settled_count: string;
    total_fixed_aed: string;
    open_pure_grams: string;
    returned_gross_grams: string;
  }>(sql`
    SELECT
      COUNT(*)::text AS invoice_count,
      COUNT(*) FILTER (WHERE pricing_type = 'fixed')::text AS fixed_count,
      COUNT(*) FILTER (WHERE pricing_type = 'unfixed')::text AS unfixed_count,
      COUNT(*) FILTER (WHERE status = 'settled')::text AS settled_count,
      (SELECT COALESCE(SUM(tle.aed_delta::numeric), 0)
       FROM trader_ledger_entries tle
       JOIN wholesale_invoices lwi ON lwi.id = tle.wholesale_invoice_id
       ${ledgerConditions.length ? sql`WHERE ${and(...ledgerConditions)}` : sql``}
      )::text AS total_fixed_aed,
      COALESCE(SUM(open_pure_grams::numeric), 0)::text AS open_pure_grams,
      (SELECT COALESCE(SUM(wr.total_returned_gross_grams::numeric), 0)
       FROM wholesale_returns wr
       JOIN wholesale_invoices rwi ON rwi.id = wr.invoice_id
       ${returnConditions.length ? sql`WHERE ${and(...returnConditions)}` : sql``}
      )::text AS returned_gross_grams
    FROM wholesale_invoices
    ${conditions.length ? sql`WHERE ${and(...conditions)}` : sql``}
  `).then((r) => r.rows);

  const traderCount = await db.execute<{ cnt: string }>(
    sql`SELECT COUNT(*)::text AS cnt FROM wholesale_traders WHERE is_active = true`,
  ).then((r) => Number(r.rows[0]?.cnt ?? "0"));

  const doc = createWholesaleSummaryPdf({
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    invoiceCount: parseInt(stats?.invoice_count ?? "0", 10),
    fixedInvoiceCount: parseInt(stats?.fixed_count ?? "0", 10),
    unfixedInvoiceCount: parseInt(stats?.unfixed_count ?? "0", 10),
    settledInvoiceCount: parseInt(stats?.settled_count ?? "0", 10),
    totalFixedAed: Number(stats?.total_fixed_aed ?? "0"),
    openPureGrams: Number(stats?.open_pure_grams ?? "0"),
    returnedGrossGrams: Number(stats?.returned_gross_grams ?? "0"),
    traderCount,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="wholesale-summary.pdf"`);
  doc.pipe(res);
});

export default router;
