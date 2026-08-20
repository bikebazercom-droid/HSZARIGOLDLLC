/**
 * Wholesale B2B service — all complex transactional logic lives here.
 * Route handlers validate inputs, call these functions, and respond.
 */

import { sql, eq, and, gte, lte, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  wholesaleInvoicesTable,
  wholesaleInvoiceItemsTable,
  wholesaleInventoryConsumptionsTable,
  wholesaleSettlementsTable,
  wholesaleSettlementAllocationsTable,
  wholesaleReturnsTable,
  wholesaleReturnLinesTable,
  traderLedgerEntriesTable,
  wholesaleTradersTable,
  auditLogTable,
  pdfTestFixturesTable,
  stockMovementsTable,
  stockPurchasesTable,
} from "@workspace/db";
import { acquireStockMutationLock, registeredStockOwnershipSql } from "./inventoryEngine.js";
import { applyStockDelta } from "../routes/stock.js";
import { registerPdfTestFixture } from "../routes/pdf-test-fixtures.js";

type Tx = typeof db;

async function assertWholesaleFixtureMutationOwnership(
  tx: Tx,
  fixtureRunId: string | null | undefined,
  entityType: "wholesale_invoice" | "wholesale_trader",
  entityId: number,
): Promise<void> {
  const registrations = await tx.select({ runId: pdfTestFixturesTable.runId })
    .from(pdfTestFixturesTable)
    .where(and(
      eq(pdfTestFixturesTable.entityType, entityType),
      eq(pdfTestFixturesTable.entityId, entityId),
    ));
  if (registrations.length === 0) {
    if (fixtureRunId) {
      throw Object.assign(
        new Error("Wholesale test fixture parent is not owned by this run"),
        { statusCode: 403 },
      );
    }
    return;
  }
  if (!fixtureRunId || !registrations.some((row) => row.runId === fixtureRunId)) {
    throw Object.assign(
      new Error("Wholesale test fixture belongs to another run"),
      { statusCode: 409 },
    );
  }
}

// ── Number sequencing ────────────────────────────────────────────────────────

export async function nextWholesaleInvoiceNumber(tx: Tx): Promise<string> {
  const [row] = await tx.execute<{ max_num: string | null }>(
    sql`SELECT MAX(CAST(SUBSTRING(invoice_number FROM 5) AS INTEGER)) AS max_num
        FROM wholesale_invoices WHERE invoice_number ~ '^WSI-[0-9]+$'`,
  ).then((r) => r.rows);
  const next = (row?.max_num != null ? parseInt(row.max_num, 10) : 0) + 1;
  return `WSI-${String(next).padStart(5, "0")}`;
}

export async function nextWholesaleReturnNumber(tx: Tx): Promise<string> {
  const [row] = await tx.execute<{ max_num: string | null }>(
    sql`SELECT MAX(CAST(SUBSTRING(return_number FROM 5) AS INTEGER)) AS max_num
        FROM wholesale_returns WHERE return_number ~ '^WSR-[0-9]+$'`,
  ).then((r) => r.rows);
  const next = (row?.max_num != null ? parseInt(row.max_num, 10) : 0) + 1;
  return `WSR-${String(next).padStart(5, "0")}`;
}

// ── Invoice status recomputation ─────────────────────────────────────────────

function computeInvoiceStatus(openPureGrams: number, totalPureGrams: number): "open" | "partially_settled" | "settled" {
  if (openPureGrams <= 0) return "settled";
  if (openPureGrams < totalPureGrams) return "partially_settled";
  return "open";
}

function requireDecimalScale(
  value: number,
  scale: number,
  field: string,
  options: { allowZero?: boolean; maximum?: number } = {},
): number {
  const factor = 10 ** scale;
  const rounded = Math.round(value * factor) / factor;
  if (!Number.isFinite(value) || Math.abs(value - rounded) > 1e-9) {
    throw Object.assign(
      new Error(`${field} must have at most ${scale} decimal places`),
      { statusCode: 400 },
    );
  }
  if (options.allowZero ? rounded < 0 : rounded <= 0) {
    throw Object.assign(
      new Error(`${field} must be ${options.allowZero ? "zero or greater" : "positive"}`),
      { statusCode: 400 },
    );
  }
  if (options.maximum != null && rounded > options.maximum) {
    throw Object.assign(
      new Error(`${field} must be at most ${options.maximum}`),
      { statusCode: 400 },
    );
  }
  return rounded;
}

// ── FIFO consumption for wholesale items ─────────────────────────────────────
// Re-uses the stock_purchases FIFO table but records into wholesale_inventory_consumptions.

export async function consumeFifoForWholesale(
  tx: Tx,
  args: {
    wholesaleInvoiceId: number;
    wholesaleItemId: number;
    category: string;
    grams: number;
    fixtureRunId?: string | null;
  },
): Promise<{ cogsAed: number; shortfallGrams: number }> {
  const { wholesaleInvoiceId, wholesaleItemId, category, grams, fixtureRunId } = args;
  if (!(grams > 0)) return { cogsAed: 0, shortfallGrams: 0 };

  await acquireStockMutationLock(tx);

  const batches = await tx.execute<{ id: number; remaining: string; rate: string }>(sql`
    SELECT id, remaining_weight_grams::text AS remaining, price_per_gram::text AS rate
    FROM stock_purchases
    WHERE category = ${category} AND remaining_weight_grams::numeric > 0
      ${registeredStockOwnershipSql(fixtureRunId)}
    ORDER BY purchase_date ASC, created_at ASC, id ASC
    FOR UPDATE
  `).then((r) => r.rows);

  let remainingToDeduct = grams;
  let cogsAed = 0;

  for (const batch of batches) {
    if (remainingToDeduct <= 0) break;
    const batchRemaining = Number(batch.remaining);
    const consumed = Math.min(batchRemaining, remainingToDeduct);
    const cost = Math.round(consumed * Number(batch.rate) * 100) / 100;

    await tx.execute(sql`
      UPDATE stock_purchases
      SET remaining_weight_grams = remaining_weight_grams::numeric - ${String(consumed)}::numeric
      WHERE id = ${batch.id}
    `);
    await tx.insert(wholesaleInventoryConsumptionsTable).values({
      wholesaleInvoiceId,
      wholesaleItemId,
      purchaseId: batch.id,
      isShortfall: false,
      category,
      consumedGrams: String(consumed),
      costAed: String(cost),
      returnedGrams: "0",
    });

    cogsAed += cost;
    remainingToDeduct = Math.round((remainingToDeduct - consumed) * 10000) / 10000;
  }

  let shortfallGrams = 0;
  if (remainingToDeduct > 0) {
    shortfallGrams = remainingToDeduct;
    const [avg] = await tx.execute<{ rate: string }>(sql`
      SELECT CASE WHEN COALESCE(SUM(weight_grams::numeric), 0) > 0
                  THEN SUM(total_price_aed::numeric) / SUM(weight_grams::numeric)
                  ELSE 0 END::text AS rate
      FROM stock_purchases
      WHERE category = ${category}
        ${registeredStockOwnershipSql(fixtureRunId)}
    `).then((r) => r.rows);
    const cost = Math.round(shortfallGrams * Number(avg?.rate ?? 0) * 100) / 100;
    await tx.insert(wholesaleInventoryConsumptionsTable).values({
      wholesaleInvoiceId,
      wholesaleItemId,
      purchaseId: null,
      isShortfall: true,
      category,
      consumedGrams: String(shortfallGrams),
      costAed: String(cost),
      returnedGrams: "0",
    });
    cogsAed += cost;
  }

  return { cogsAed: Math.round(cogsAed * 100) / 100, shortfallGrams };
}

// ── Create wholesale invoice ──────────────────────────────────────────────────

export interface CreateInvoiceArgs {
  traderId: number;
  traderSnapshot: {
    name: string;
    contactPerson?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    trn?: string | null;
  };
  invoiceDate: string;
  pricingType: "fixed" | "unfixed";
  paymentMode?: "cash" | "card" | "bank_transfer" | null;
  notes?: string | null;
  createdByUserId?: number | null;
  createdByUserName?: string | null;
  idempotencyKey?: string | null;
  fixtureRunId?: string | null;
  items: Array<{
    description: string;
    category: string;
    quantity: number;
    grossGrams: number;
    purityMultiplier: number;
    makingAed: number;
    rateAedPerGram?: number | null;
  }>;
}

export async function createWholesaleInvoice(args: CreateInvoiceArgs) {
  const { pricingType, idempotencyKey } = args;

  // Idempotency check: if the key already exists, return the existing result
  if (idempotencyKey) {
    const existing = await db.select()
      .from(traderLedgerEntriesTable)
      .where(eq(traderLedgerEntriesTable.idempotencyKey, `inv_create_${idempotencyKey}`))
      .limit(1);
    if (existing.length > 0 && existing[0].wholesaleInvoiceId) {
      await assertWholesaleFixtureMutationOwnership(
        db,
        args.fixtureRunId,
        "wholesale_invoice",
        existing[0].wholesaleInvoiceId,
      );
      const inv = await loadWholesaleInvoice(existing[0].wholesaleInvoiceId);
      if (inv) return { invoice: inv, idempotent: true };
    }
  }

  const result = await db.transaction(async (tx) => {
    // All wholesale stock/FIFO mutations use one lock order: advisory lock
    // first, then stock_levels and stock_purchases rows. Returns follow the
    // same order, preventing create-vs-return deadlocks.
    await acquireStockMutationLock(tx as unknown as Tx);
    await assertWholesaleFixtureMutationOwnership(
      tx as unknown as Tx,
      args.fixtureRunId,
      "wholesale_trader",
      args.traderId,
    );

    // Lock wholesale_invoices table for number sequencing
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wholesale_invoice_number'))`);

    const invoiceNumber = await nextWholesaleInvoiceNumber(tx as unknown as Tx);

    // Compute item-level values
    const computedItems = args.items.map((it, index) => {
      const grossGrams = requireDecimalScale(it.grossGrams, 4, `items[${index}].grossGrams`);
      const purityMultiplier = requireDecimalScale(
        it.purityMultiplier,
        4,
        `items[${index}].purityMultiplier`,
        { maximum: 1 },
      );
      const quantity = requireDecimalScale(it.quantity, 4, `items[${index}].quantity`);
      const makingAed = requireDecimalScale(
        it.makingAed,
        2,
        `items[${index}].makingAed`,
        { allowZero: true },
      );
      const rateAedPerGram = it.rateAedPerGram == null
        ? null
        : requireDecimalScale(it.rateAedPerGram, 4, `items[${index}].rateAedPerGram`);
      if (pricingType === "fixed" && rateAedPerGram == null) {
        throw Object.assign(
          new Error(`items[${index}].rateAedPerGram is required for fixed invoices`),
          { statusCode: 400 },
        );
      }
      const pureGrams = Math.round(grossGrams * purityMultiplier * 10000) / 10000;
      const aed = pricingType === "fixed" && rateAedPerGram != null
        ? Math.round(pureGrams * rateAedPerGram * 100) / 100 + makingAed
        : makingAed;
      return {
        ...it,
        quantity,
        grossGrams,
        purityMultiplier,
        makingAed,
        rateAedPerGram,
        pureGrams,
        totalAed: aed,
      };
    });

    const totalGrossGrams = computedItems.reduce((s, i) => s + i.grossGrams, 0);
    const totalPureGrams = computedItems.reduce((s, i) => s + i.pureGrams, 0);
    const totalMakingAed = computedItems.reduce((s, i) => s + i.makingAed, 0);
    const totalAed = computedItems.reduce((s, i) => s + i.totalAed, 0);

    // For fixed invoices all pure grams are fixed immediately → openPureGrams=0
    const openPureGrams = pricingType === "fixed" ? 0 : totalPureGrams;
    // Fixed sales post their full value immediately. Unfixed deliveries still
    // post their making charge immediately; only the metal value remains open.
    const settledAed = totalAed;
    const status = pricingType === "fixed" ? "settled" : "open";

    const [invoice] = await tx.insert(wholesaleInvoicesTable).values({
      invoiceNumber,
      invoiceDate: args.invoiceDate,
      traderId: args.traderId,
      traderName: args.traderSnapshot.name,
      traderContactPerson: args.traderSnapshot.contactPerson ?? null,
      traderPhone: args.traderSnapshot.phone ?? null,
      traderEmail: args.traderSnapshot.email ?? null,
      traderAddress: args.traderSnapshot.address ?? null,
      traderTrn: args.traderSnapshot.trn ?? null,
      pricingType,
      paymentMode: args.paymentMode ?? null,
      notes: args.notes ?? null,
      createdByUserId: args.createdByUserId ?? null,
      createdByUserName: args.createdByUserName ?? null,
      status,
      totalGrossGrams: String(Math.round(totalGrossGrams * 10000) / 10000),
      totalPureGrams: String(Math.round(totalPureGrams * 10000) / 10000),
      totalMakingAed: String(Math.round(totalMakingAed * 100) / 100),
      totalAed: String(Math.round(totalAed * 100) / 100),
      openPureGrams: String(Math.round(openPureGrams * 10000) / 10000),
      settledAed: String(Math.round(settledAed * 100) / 100),
    }).returning();

    // Insert items
    const savedItems = [];
    for (const it of computedItems) {
      const [item] = await tx.insert(wholesaleInvoiceItemsTable).values({
        invoiceId: invoice.id,
        description: it.description,
        category: it.category,
        quantity: String(it.quantity),
        grossGrams: String(it.grossGrams),
        purityMultiplier: String(it.purityMultiplier),
        pureGrams: String(it.pureGrams),
        rateAedPerGram: (pricingType === "fixed" && it.rateAedPerGram) ? String(it.rateAedPerGram) : null,
        makingAed: String(it.makingAed),
        totalAed: String(it.totalAed),
        fixedPureGrams: pricingType === "fixed" ? String(it.pureGrams) : "0",
        returnedGrossGrams: "0",
        returnedPureGrams: "0",
        returnedMakingAed: "0",
      }).returning();
      savedItems.push(item);
    }

    // Stock deductions (FIFO) — same as retail, never blocked
    for (const item of savedItems) {
      await applyStockDelta(
        tx as unknown as Tx,
        item.category,
        -Number(item.grossGrams),
        "sale",
        "wholesale_invoice",
        invoice.id,
        `Wholesale ${invoice.invoiceNumber}`,
      );
      await consumeFifoForWholesale(tx as unknown as Tx, {
        wholesaleInvoiceId: invoice.id,
        wholesaleItemId: item.id,
        category: item.category,
        grams: Number(item.grossGrams),
        fixtureRunId: args.fixtureRunId,
      });
    }

    // Ledger entries
    if (pricingType === "fixed") {
      // Fixed: one AED debit per item, immediate settlement
      for (const item of savedItems) {
        await tx.insert(traderLedgerEntriesTable).values({
          traderId: args.traderId,
          eventType: "fixed_sale",
          eventDate: args.invoiceDate,
          aedDelta: item.totalAed, // positive = trader owes shop
          pureGoldGramsDelta: "0",
          wholesaleInvoiceId: invoice.id,
          wholesaleItemId: item.id,
          note: `Fixed delivery: ${item.description}`,
          createdByUserId: args.createdByUserId ?? null,
          createdByUserName: args.createdByUserName ?? null,
          idempotencyKey: idempotencyKey ? `inv_create_${idempotencyKey}_item_${item.id}` : null,
        });
      }
    } else {
      // Unfixed: the trader owes both the delivered pure grams and the making
      // charge immediately. The metal value is posted later by rate fixes.
      for (const item of savedItems) {
        await tx.insert(traderLedgerEntriesTable).values({
          traderId: args.traderId,
          eventType: "delivery",
          eventDate: args.invoiceDate,
          aedDelta: item.makingAed,
          pureGoldGramsDelta: item.pureGrams, // positive = trader owes grams
          wholesaleInvoiceId: invoice.id,
          wholesaleItemId: item.id,
          note: `Unfixed delivery: ${item.description}`,
          createdByUserId: args.createdByUserId ?? null,
          createdByUserName: args.createdByUserName ?? null,
          idempotencyKey: idempotencyKey ? `inv_create_${idempotencyKey}_item_${item.id}` : null,
        });
      }
    }

    // Idempotency marker entry (for both fixed and unfixed)
    if (idempotencyKey) {
      await tx.insert(traderLedgerEntriesTable).values({
        traderId: args.traderId,
        eventType: pricingType === "fixed" ? "fixed_sale" : "delivery",
        eventDate: args.invoiceDate,
        aedDelta: "0",
        pureGoldGramsDelta: "0",
        wholesaleInvoiceId: invoice.id,
        note: "Invoice creation idempotency marker",
        createdByUserId: args.createdByUserId ?? null,
        createdByUserName: args.createdByUserName ?? null,
        idempotencyKey: `inv_create_${idempotencyKey}`,
      });
    }

    // Audit log
    await tx.insert(auditLogTable).values({
      actorId: args.createdByUserId ?? null,
      entityType: "wholesale_invoice",
      entityId: invoice.id,
      action: "create",
      billNo: invoice.invoiceNumber,
      details: JSON.stringify({
        invoiceNumber: invoice.invoiceNumber,
        traderId: args.traderId,
        traderName: args.traderSnapshot.name,
        pricingType,
        paymentMode: args.paymentMode ?? null,
        totalAed: invoice.totalAed,
        totalGrossGrams: invoice.totalGrossGrams,
        itemCount: savedItems.length,
      }),
    });
    await registerPdfTestFixture(
      tx as unknown as typeof db,
      args.fixtureRunId ?? null,
      "wholesale_invoice",
      invoice.id,
    );

    return { invoice, items: savedItems };
  });

  return { invoice: await loadWholesaleInvoice(result.invoice.id), idempotent: false };
}

// ── Load invoice with items ──────────────────────────────────────────────────

export async function loadWholesaleInvoice(id: number) {
  const [invoice] = await db.select().from(wholesaleInvoicesTable).where(eq(wholesaleInvoicesTable.id, id));
  if (!invoice) return null;
  const items = await db.select().from(wholesaleInvoiceItemsTable)
    .where(eq(wholesaleInvoiceItemsTable.invoiceId, id))
    .orderBy(wholesaleInvoiceItemsTable.id);
  return { invoice, items };
}

// ── Partial rate fix ─────────────────────────────────────────────────────────

export interface RateFixArgs {
  invoiceId: number;
  pureWeightGrams: number;
  rateAedPerGram: number;
  date: string;
  note?: string | null;
  actorId?: number | null;
  actorName?: string | null;
  idempotencyKey?: string | null;
  fixtureRunId?: string | null;
}

export async function applyRateFix(args: RateFixArgs) {
  const { invoiceId, date, note, actorId, actorName, idempotencyKey } = args;
  const pureWeightGrams = requireDecimalScale(args.pureWeightGrams, 4, "pureWeightGrams");
  const rateAedPerGram = requireDecimalScale(args.rateAedPerGram, 4, "rateAedPerGram");

  // Idempotency check
  if (idempotencyKey) {
    const ikey = `ratefix_${idempotencyKey}`;
    const existing = await db.select()
      .from(traderLedgerEntriesTable)
      .where(eq(traderLedgerEntriesTable.idempotencyKey, ikey))
      .limit(1);
    if (existing.length > 0) {
      await assertWholesaleFixtureMutationOwnership(
        db,
        args.fixtureRunId,
        "wholesale_invoice",
        invoiceId,
      );
      const inv = await loadWholesaleInvoice(invoiceId);
      if (inv) return { result: inv, idempotent: true };
    }
  }

  const result = await db.transaction(async (tx) => {
    // Global lock
    await acquireStockMutationLock(tx as unknown as Tx);
    // Lock the invoice row
    const [lockedInvoice] = await tx.select().from(wholesaleInvoicesTable)
      .where(eq(wholesaleInvoicesTable.id, invoiceId))
      .for("update");
    if (!lockedInvoice) throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
    await assertWholesaleFixtureMutationOwnership(
      tx as unknown as Tx,
      args.fixtureRunId,
      "wholesale_invoice",
      invoiceId,
    );
    if (lockedInvoice.pricingType !== "unfixed") {
      throw Object.assign(new Error("Rate fix only applies to unfixed invoices"), { statusCode: 400 });
    }

    const currentOpenPure = Number(lockedInvoice.openPureGrams);
    if (pureWeightGrams > currentOpenPure + 0.0001) {
      throw Object.assign(
        new Error(`Cannot fix ${pureWeightGrams.toFixed(4)}g: only ${currentOpenPure.toFixed(4)}g open`),
        { statusCode: 409 },
      );
    }

    // Allocate grams across items by id order (smallest open first, then by id)
    const items = await tx.select().from(wholesaleInvoiceItemsTable)
      .where(eq(wholesaleInvoiceItemsTable.invoiceId, invoiceId))
      .for("update")
      .orderBy(wholesaleInvoiceItemsTable.id);

    let remaining = pureWeightGrams;
    const updates: Array<{ id: number; addFixed: number; addAed?: number }> = [];
    for (const item of items) {
      if (remaining <= 0) break;
      const itemOpen = Number(item.pureGrams) - Number(item.fixedPureGrams) - Number(item.returnedPureGrams);
      if (itemOpen <= 0.0001) continue;
      const allocate = Math.min(itemOpen, remaining);
      updates.push({ id: item.id, addFixed: allocate });
      remaining = Math.round((remaining - allocate) * 10000) / 10000;
    }

    // Compute one authoritative AED amount, then allocate cents across items so
    // item totals always sum exactly to the invoice and ledger totals.
    const aedAmount = Math.round(pureWeightGrams * rateAedPerGram * 100) / 100;
    let allocatedAed = 0;
    updates.forEach((upd, index) => {
      const addAed = index === updates.length - 1
        ? Math.round((aedAmount - allocatedAed) * 100) / 100
        : Math.round(upd.addFixed * rateAedPerGram * 100) / 100;
      upd.addAed = addAed;
      allocatedAed = Math.round((allocatedAed + addAed) * 100) / 100;
    });

    // Apply item counter and valued-total updates.
    for (const upd of updates) {
      await tx.execute(sql`
        UPDATE wholesale_invoice_items
        SET fixed_pure_grams = fixed_pure_grams::numeric + ${String(upd.addFixed)}::numeric,
            total_aed = total_aed::numeric + ${String(upd.addAed ?? 0)}::numeric
        WHERE id = ${upd.id}
      `);
    }

    // New invoice open grams and AED totals.
    const newOpenPure = Math.max(0, Math.round((currentOpenPure - pureWeightGrams) * 10000) / 10000);
    const newSettledAed = Math.round((Number(lockedInvoice.settledAed) + aedAmount) * 100) / 100;
    const newTotalAed = Math.round((Number(lockedInvoice.totalAed) + aedAmount) * 100) / 100;
    const newStatus = computeInvoiceStatus(newOpenPure, Number(lockedInvoice.totalPureGrams));

    await tx.update(wholesaleInvoicesTable)
      .set({
        openPureGrams: String(newOpenPure),
        settledAed: String(newSettledAed),
        totalAed: String(newTotalAed),
        status: newStatus,
      })
      .where(eq(wholesaleInvoicesTable.id, invoiceId));

    // Immutable settlement record
    const [settlement] = await tx.insert(wholesaleSettlementsTable).values({
      invoiceId,
      settlementDate: date,
      pureWeightGrams: String(pureWeightGrams),
      rateAedPerGram: String(rateAedPerGram),
      aedAmount: String(aedAmount),
      note: note ?? null,
      createdByUserId: actorId ?? null,
      createdByUserName: actorName ?? null,
    }).returning();
    await tx.insert(wholesaleSettlementAllocationsTable).values(
      updates.map((upd) => ({
        settlementId: settlement.id,
        invoiceItemId: upd.id,
        pureWeightGrams: String(upd.addFixed),
        rateAedPerGram: String(rateAedPerGram),
        aedAmount: String(upd.addAed ?? 0),
      })),
    );

    // Ledger entry: negative pure delta (grams fixed), positive AED delta (AED now owed)
    const ikey = idempotencyKey ? `ratefix_${idempotencyKey}` : null;
    await tx.insert(traderLedgerEntriesTable).values({
      traderId: lockedInvoice.traderId!,
      eventType: "rate_fix",
      eventDate: date,
      aedDelta: String(aedAmount),      // positive: trader now owes AED
      pureGoldGramsDelta: String(-pureWeightGrams), // negative: gram obligation reduced
      wholesaleInvoiceId: invoiceId,
      wholesaleSettlementId: settlement.id,
      note: note ?? `Rate fix @ AED ${rateAedPerGram}/g for ${pureWeightGrams}g pure`,
      createdByUserId: actorId ?? null,
      createdByUserName: actorName ?? null,
      idempotencyKey: ikey,
    });

    // Audit log
    await tx.insert(auditLogTable).values({
      actorId: actorId ?? null,
      entityType: "wholesale_invoice",
      entityId: invoiceId,
      action: "rate_fix",
      billNo: lockedInvoice.invoiceNumber,
      details: JSON.stringify({
        invoiceNumber: lockedInvoice.invoiceNumber,
        pureWeightGrams,
        rateAedPerGram,
        aedAmount,
        date,
        newStatus,
        settlementId: settlement.id,
      }),
    });

    return invoiceId;
  });

  const inv = await loadWholesaleInvoice(result);
  return { result: inv, idempotent: false };
}

// ── Physical return ──────────────────────────────────────────────────────────

export interface ReturnLine {
  invoiceItemId: number;
  grossWeightGrams: number;
}

export interface ReturnArgs {
  invoiceId: number;
  lines: ReturnLine[];
  date: string;
  note?: string | null;
  actorId?: number | null;
  actorName?: string | null;
  idempotencyKey?: string | null;
  fixtureRunId?: string | null;
}

export async function applyPhysicalReturn(args: ReturnArgs) {
  const { invoiceId, date, note, actorId, actorName, idempotencyKey } = args;
  const lines = args.lines.map((line, index) => ({
    ...line,
    grossWeightGrams: requireDecimalScale(
      line.grossWeightGrams,
      4,
      `lines[${index}].grossWeightGrams`,
    ),
  }));

  if (lines.length === 0) {
    throw Object.assign(new Error("At least one return line is required"), { statusCode: 400 });
  }
  const seenItemIds = new Set<number>();
  for (const line of lines) {
    if (seenItemIds.has(line.invoiceItemId)) {
      throw Object.assign(
        new Error(`Duplicate return line for invoice item ${line.invoiceItemId}`),
        { statusCode: 400 },
      );
    }
    seenItemIds.add(line.invoiceItemId);
    if (!Number.isFinite(line.grossWeightGrams) || line.grossWeightGrams <= 0) {
      throw Object.assign(
        new Error(`Item ${line.invoiceItemId}: return weight must be positive`),
        { statusCode: 400 },
      );
    }
  }

  // Idempotency check
  if (idempotencyKey) {
    const ikey = `return_${idempotencyKey}`;
    const existing = await db.select()
      .from(traderLedgerEntriesTable)
      .where(eq(traderLedgerEntriesTable.idempotencyKey, ikey))
      .limit(1);
    if (existing.length > 0 && existing[0].wholesaleReturnId) {
      await assertWholesaleFixtureMutationOwnership(
        db,
        args.fixtureRunId,
        "wholesale_invoice",
        invoiceId,
      );
      const ret = await loadWholesaleReturn(existing[0].wholesaleReturnId);
      if (ret) return { result: ret, idempotent: true };
    }
  }

  const result = await db.transaction(async (tx) => {
    await acquireStockMutationLock(tx as unknown as Tx);

    // Lock return number sequence
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wholesale_return_number'))`);

    // Load and lock the invoice
    const [lockedInvoice] = await tx.select().from(wholesaleInvoicesTable)
      .where(eq(wholesaleInvoicesTable.id, invoiceId))
      .for("update");
    if (!lockedInvoice) throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
    await assertWholesaleFixtureMutationOwnership(
      tx as unknown as Tx,
      args.fixtureRunId,
      "wholesale_invoice",
      invoiceId,
    );

    // Load and lock the items
    const itemIds = lines.map((l) => l.invoiceItemId);
    const items = await tx.select().from(wholesaleInvoiceItemsTable)
      .where(inArray(wholesaleInvoiceItemsTable.id, itemIds))
      .for("update");

    const itemMap = new Map(items.map((it) => [it.id, it]));

    // Validate return quantities. Returns consume any still-open pure-metal
    // obligation first, then reverse already-fixed metal AED for the remainder.
    const lineComputations: Array<{
      line: ReturnLine;
      item: typeof wholesaleInvoiceItemsTable.$inferSelect;
      grossToReturn: number;
      pureToReturn: number;
      openPureToReturn: number;
      fixedPureToReturn: number;
      makingToReturn: number;
      metalAedToReturn: number;
      totalAedToReturn: number;
    }> = [];

    for (const line of lines) {
      const item = itemMap.get(line.invoiceItemId);
      if (!item) throw Object.assign(new Error(`Invoice item ${line.invoiceItemId} not found`), { statusCode: 400 });
      if (item.invoiceId !== invoiceId) throw Object.assign(new Error(`Item ${line.invoiceItemId} does not belong to invoice ${invoiceId}`), { statusCode: 400 });

      const originalGross = Number(item.grossGrams);
      const purityMult = Number(item.purityMultiplier);
      const alreadyReturnedGross = Number(item.returnedGrossGrams);
      const maxReturnableGross = Math.max(0, originalGross - alreadyReturnedGross);

      if (line.grossWeightGrams > maxReturnableGross + 0.0001) {
        throw Object.assign(
          new Error(`Item ${line.invoiceItemId}: cannot return ${line.grossWeightGrams.toFixed(4)}g gross (max returnable: ${maxReturnableGross.toFixed(4)}g)`),
          { statusCode: 409 },
        );
      }

      const pureToReturn = Math.round(line.grossWeightGrams * purityMult * 10000) / 10000;
      const currentPure = Math.max(
        0,
        Math.round((Number(item.pureGrams) - Number(item.returnedPureGrams)) * 10000) / 10000,
      );
      const fixedPure = Number(item.fixedPureGrams);
      const openPure = Math.max(0, Math.round((currentPure - fixedPure) * 10000) / 10000);
      const openPureToReturn = Math.min(openPure, pureToReturn);
      const fixedPureToReturn = Math.max(
        0,
        Math.round((pureToReturn - openPureToReturn) * 10000) / 10000,
      );
      if (fixedPureToReturn > fixedPure + 0.0001) {
        throw Object.assign(
          new Error(`Item ${line.invoiceItemId}: return exceeds the unreturned delivered weight`),
          { statusCode: 409 },
        );
      }
      // Reverse making cumulatively so multiple partial returns can never lose
      // or create a cent. The final eligible return reverses the exact residual.
      const originalMaking = Number(item.makingAed);
      const previouslyReturnedMaking = Number(item.returnedMakingAed);
      const cumulativeReturnedGross = alreadyReturnedGross + line.grossWeightGrams;
      const cumulativeMaking = originalGross > 0
        ? Math.min(originalMaking, Math.round((originalMaking * cumulativeReturnedGross / originalGross) * 100) / 100)
        : 0;
      const makingToReturn = Math.max(
        0,
        Math.round((cumulativeMaking - previouslyReturnedMaking) * 100) / 100,
      );
      lineComputations.push({
        line,
        item,
        grossToReturn: line.grossWeightGrams,
        pureToReturn,
        openPureToReturn,
        fixedPureToReturn,
        makingToReturn,
        metalAedToReturn: 0,
        totalAedToReturn: 0,
      });
    }

    for (const lc of lineComputations) {
      lc.metalAedToReturn = await reverseFixedMetalAedForReturn(
        tx as unknown as Tx,
        lc.item,
        lockedInvoice.pricingType,
        lc.fixedPureToReturn,
      );
      lc.totalAedToReturn = Math.round(
        (lc.makingToReturn + lc.metalAedToReturn) * 100,
      ) / 100;
    }

    const totalReturnedGross = lineComputations.reduce((s, l) => s + l.grossToReturn, 0);
    const totalReturnedPure = lineComputations.reduce((s, l) => s + l.pureToReturn, 0);
    const totalReturnedOpenPure = Math.round(
      lineComputations.reduce((s, l) => s + l.openPureToReturn, 0) * 10000,
    ) / 10000;
    const totalReturnedFixedPure = Math.round(
      lineComputations.reduce((s, l) => s + l.fixedPureToReturn, 0) * 10000,
    ) / 10000;
    const totalReturnedMaking = Math.round(
      lineComputations.reduce((s, l) => s + l.makingToReturn, 0) * 100,
    ) / 100;
    const totalReturnedMetalAed = Math.round(
      lineComputations.reduce((s, l) => s + l.metalAedToReturn, 0) * 100,
    ) / 100;
    const totalReturnedAed = Math.round(
      lineComputations.reduce((s, l) => s + l.totalAedToReturn, 0) * 100,
    ) / 100;

    // Generate return number
    const returnNumber = await nextWholesaleReturnNumber(tx as unknown as Tx);

    // Create return header
    const [wholesaleReturn] = await tx.insert(wholesaleReturnsTable).values({
      returnNumber,
      invoiceId,
      returnDate: date,
      note: note ?? null,
      totalReturnedGrossGrams: String(Math.round(totalReturnedGross * 10000) / 10000),
      totalReturnedPureGrams: String(Math.round(totalReturnedPure * 10000) / 10000),
      totalReturnedFixedPureGrams: String(totalReturnedFixedPure),
      totalReturnedMakingAed: String(totalReturnedMaking),
      totalReturnedMetalAed: String(totalReturnedMetalAed),
      totalReturnedAed: String(totalReturnedAed),
      totalReturnedCogsAed: "0",
      createdByUserId: actorId ?? null,
      createdByUserName: actorName ?? null,
    }).returning();

    // Create return lines and update item counters
    const savedLines = [];
    for (const lc of lineComputations) {
      const returnedCogsAed = await restoreFifoSlicesForReturn(
        tx as unknown as Tx,
        lc.item.id,
        lc.grossToReturn,
        invoiceId,
      );

      const [retLine] = await tx.insert(wholesaleReturnLinesTable).values({
        returnId: wholesaleReturn.id,
        invoiceItemId: lc.item.id,
        grossWeightGrams: String(lc.grossToReturn),
        pureWeightGrams: String(lc.pureToReturn),
        returnedFixedPureGrams: String(lc.fixedPureToReturn),
        returnedMakingAed: String(lc.makingToReturn),
        returnedMetalAed: String(lc.metalAedToReturn),
        returnedAed: String(lc.totalAedToReturn),
        returnedCogsAed: String(returnedCogsAed),
      }).returning();
      savedLines.push(retLine);

      // Update item counters
      await tx.execute(sql`
        UPDATE wholesale_invoice_items
        SET returned_gross_grams = returned_gross_grams::numeric + ${String(lc.grossToReturn)}::numeric,
            returned_pure_grams = returned_pure_grams::numeric + ${String(lc.pureToReturn)}::numeric,
            returned_fixed_pure_grams = returned_fixed_pure_grams::numeric + ${String(lc.fixedPureToReturn)}::numeric,
            returned_making_aed = returned_making_aed::numeric + ${String(lc.makingToReturn)}::numeric,
            returned_metal_aed = returned_metal_aed::numeric + ${String(lc.metalAedToReturn)}::numeric,
            fixed_pure_grams = GREATEST(0, fixed_pure_grams::numeric - ${String(lc.fixedPureToReturn)}::numeric),
            total_aed = GREATEST(0, total_aed::numeric - ${String(lc.totalAedToReturn)}::numeric)
        WHERE id = ${lc.item.id}
      `);

      // Stock delta: positive = goods back in store
      await applyStockDelta(
        tx as unknown as Tx,
        lc.item.category,
        lc.grossToReturn,
        "sale_reversal",
        "wholesale_return",
        wholesaleReturn.id,
        `Return ${returnNumber} item ${lc.item.id}`,
      );
    }
    const totalReturnedCogsAed = Math.round(
      savedLines.reduce((sum, line) => sum + Number(line.returnedCogsAed), 0) * 100,
    ) / 100;
    await tx.update(wholesaleReturnsTable)
      .set({ totalReturnedCogsAed: String(totalReturnedCogsAed) })
      .where(eq(wholesaleReturnsTable.id, wholesaleReturn.id));

    // Open returned metal reverses pure grams. Fixed returned metal reverses
    // AED and must not drive the trader's pure-metal balance below zero.
    const newOpenPure = Math.round((Number(lockedInvoice.openPureGrams) - totalReturnedOpenPure) * 10000) / 10000;
    const newTotalPure = Math.round((Number(lockedInvoice.totalPureGrams) - totalReturnedPure) * 10000) / 10000;
    const newTotalGross = Math.round((Number(lockedInvoice.totalGrossGrams) - totalReturnedGross) * 10000) / 10000;
    const newTotalMaking = Math.max(
      0,
      Math.round((Number(lockedInvoice.totalMakingAed) - totalReturnedMaking) * 100) / 100,
    );
    const newTotalAed = Math.max(
      0,
      Math.round((Number(lockedInvoice.totalAed) - totalReturnedAed) * 100) / 100,
    );
    const newSettledAed = Math.max(
      0,
      Math.round((Number(lockedInvoice.settledAed) - totalReturnedAed) * 100) / 100,
    );
    const newStatus = computeInvoiceStatus(Math.max(0, newOpenPure), Math.max(0, newTotalPure));

    await tx.update(wholesaleInvoicesTable)
      .set({
        openPureGrams: String(Math.max(0, newOpenPure)),
        totalPureGrams: String(Math.max(0, newTotalPure)),
        totalGrossGrams: String(Math.max(0, newTotalGross)),
        totalMakingAed: String(newTotalMaking),
        totalAed: String(newTotalAed),
        settledAed: String(newSettledAed),
        status: newStatus,
      })
      .where(eq(wholesaleInvoicesTable.id, invoiceId));

    // Reverse unfixed metal as pure grams and fixed metal plus making as AED.
    const ikey = idempotencyKey ? `return_${idempotencyKey}` : null;
    await tx.insert(traderLedgerEntriesTable).values({
      traderId: lockedInvoice.traderId!,
      eventType: "physical_return",
      eventDate: date,
      aedDelta: String(-totalReturnedAed),
      pureGoldGramsDelta: String(-totalReturnedOpenPure),
      wholesaleInvoiceId: invoiceId,
      wholesaleReturnId: wholesaleReturn.id,
      note: note ?? `Physical return ${returnNumber}: ${totalReturnedGross.toFixed(4)}g gross`,
      createdByUserId: actorId ?? null,
      createdByUserName: actorName ?? null,
      idempotencyKey: ikey,
    });

    // Audit log
    await tx.insert(auditLogTable).values({
      actorId: actorId ?? null,
      entityType: "wholesale_return",
      entityId: wholesaleReturn.id,
      action: "physical_return",
      billNo: returnNumber,
      details: JSON.stringify({
        returnNumber,
        invoiceNumber: lockedInvoice.invoiceNumber,
        traderId: lockedInvoice.traderId,
        totalReturnedGrossGrams: totalReturnedGross,
        totalReturnedPureGrams: totalReturnedPure,
        totalReturnedOpenPureGrams: totalReturnedOpenPure,
        totalReturnedFixedPureGrams: totalReturnedFixedPure,
        totalReturnedMakingAed: totalReturnedMaking,
        totalReturnedMetalAed,
        totalReturnedAed,
        totalReturnedCogsAed,
        lineCount: lineComputations.length,
        newStatus,
      }),
    });
    await registerPdfTestFixture(
      tx as unknown as typeof db,
      args.fixtureRunId ?? null,
      "wholesale_return",
      wholesaleReturn.id,
    );

    return { wholesaleReturn, lines: savedLines };
  });

  const ret = await loadWholesaleReturn(result.wholesaleReturn.id);
  return { result: ret, idempotent: false };
}

async function reverseFixedMetalAedForReturn(
  tx: Tx,
  item: typeof wholesaleInvoiceItemsTable.$inferSelect,
  pricingType: string,
  fixedPureGramsToReturn: number,
): Promise<number> {
  if (fixedPureGramsToReturn <= 0.0001) return 0;

  if (pricingType === "fixed") {
    const currentFixedPure = Number(item.fixedPureGrams);
    const previouslyReturnedFixedPure = Number(item.returnedFixedPureGrams);
    const previouslyReturnedMetalAed = Number(item.returnedMetalAed);
    const originalFixedPure = currentFixedPure + previouslyReturnedFixedPure;
    const originalMetalAed = Math.max(
      0,
      Math.round(
        (
          Number(item.totalAed)
          - Number(item.makingAed)
          + Number(item.returnedMakingAed)
          + previouslyReturnedMetalAed
        ) * 100,
      ) / 100,
    );
    const cumulativeReturnedFixedPure = previouslyReturnedFixedPure + fixedPureGramsToReturn;
    const cumulativeReturnedMetalAed = originalFixedPure > 0
      ? Math.min(
          originalMetalAed,
          Math.round(
            originalMetalAed * cumulativeReturnedFixedPure / originalFixedPure * 100,
          ) / 100,
        )
      : 0;
    return Math.max(
      0,
      Math.round((cumulativeReturnedMetalAed - previouslyReturnedMetalAed) * 100) / 100,
    );
  }

  // For an originally-unfixed invoice, consume the most recently fixed
  // allocations first. Each allocation carries cumulative return counters so
  // multiple partial returns reverse exactly its rounded AED amount.
  const allocations = await tx.execute<{
    id: number;
    pure_weight_grams: string;
    aed_amount: string;
    returned_pure_weight_grams: string;
    returned_aed_amount: string;
  }>(sql`
    SELECT wsa.id,
           wsa.pure_weight_grams::text,
           wsa.aed_amount::text,
           wsa.returned_pure_weight_grams::text,
           wsa.returned_aed_amount::text
    FROM wholesale_settlement_allocations wsa
    JOIN wholesale_settlements ws ON ws.id = wsa.settlement_id
    WHERE wsa.invoice_item_id = ${item.id}
      AND ws.invoice_id = ${item.invoiceId}
    ORDER BY wsa.id DESC
    FOR UPDATE OF wsa
  `).then((r) => r.rows);

  let remainingPure = fixedPureGramsToReturn;
  let returnedMetalAed = 0;
  for (const allocation of allocations) {
    if (remainingPure <= 0.0001) break;
    const allocatedPure = Number(allocation.pure_weight_grams);
    const priorReturnedPure = Number(allocation.returned_pure_weight_grams);
    const availablePure = Math.max(0, allocatedPure - priorReturnedPure);
    if (availablePure <= 0.0001) continue;

    const pureForAllocation = Math.min(availablePure, remainingPure);
    const priorReturnedAed = Number(allocation.returned_aed_amount);
    const cumulativeReturnedPure = priorReturnedPure + pureForAllocation;
    const allocationAed = Number(allocation.aed_amount);
    const cumulativeReturnedAed = allocatedPure > 0
      ? Math.min(
          allocationAed,
          Math.round(allocationAed * cumulativeReturnedPure / allocatedPure * 100) / 100,
        )
      : 0;
    const aedForAllocation = Math.max(
      0,
      Math.round((cumulativeReturnedAed - priorReturnedAed) * 100) / 100,
    );

    await tx.execute(sql`
      UPDATE wholesale_settlement_allocations
      SET returned_pure_weight_grams = returned_pure_weight_grams::numeric + ${String(pureForAllocation)}::numeric,
          returned_aed_amount = returned_aed_amount::numeric + ${String(aedForAllocation)}::numeric
      WHERE id = ${allocation.id}
    `);

    returnedMetalAed = Math.round((returnedMetalAed + aedForAllocation) * 100) / 100;
    remainingPure = Math.round((remainingPure - pureForAllocation) * 10000) / 10000;
  }

  if (remainingPure > 0.0001) {
    throw Object.assign(
      new Error(`Item ${item.id}: fixed-rate allocation history is incomplete`),
      { statusCode: 409 },
    );
  }
  return returnedMetalAed;
}

async function restoreFifoSlicesForReturn(
  tx: Tx,
  itemId: number,
  grossGramsToRestore: number,
  invoiceId: number,
): Promise<number> {
  // Get consumptions for this item ordered by id (oldest first), restore from oldest
  const consumptions = await tx.execute<{
    id: number;
    purchase_id: string | null;
    is_shortfall: boolean;
    consumed_grams: string;
    returned_grams: string;
    cost_aed: string;
    returned_cogs_aed: string;
  }>(sql`
    SELECT id, purchase_id, is_shortfall, consumed_grams::text, returned_grams::text,
           cost_aed::text, returned_cogs_aed::text
    FROM wholesale_inventory_consumptions
    WHERE wholesale_item_id = ${itemId} AND wholesale_invoice_id = ${invoiceId}
    ORDER BY id ASC
    FOR UPDATE
  `).then((r) => r.rows);

  let toRestore = grossGramsToRestore;
  let restoredCogsAed = 0;
  for (const c of consumptions) {
    if (toRestore <= 0) break;
    const consumed = Number(c.consumed_grams);
    const alreadyReturned = Number(c.returned_grams);
    const available = consumed - alreadyReturned;
    if (available <= 0.0001) continue;
    const restore = Math.min(available, toRestore);
    const priorReturnedCogs = Number(c.returned_cogs_aed);
    const cumulativeReturnedCogs = consumed > 0
      ? Math.min(
          Number(c.cost_aed),
          Math.round(
            Number(c.cost_aed) * (alreadyReturned + restore) / consumed * 100,
          ) / 100,
        )
      : 0;
    const cogsForSlice = Math.max(
      0,
      Math.round((cumulativeReturnedCogs - priorReturnedCogs) * 100) / 100,
    );

    // Restore to the exact source batch when it still exists.
    if (c.purchase_id) {
      const purchaseId = parseInt(c.purchase_id, 10);
      const restoredRows = await tx.execute<{ id: number }>(sql`
        UPDATE stock_purchases
        SET remaining_weight_grams = remaining_weight_grams::numeric + ${String(restore)}::numeric
        WHERE id = ${purchaseId}
          AND remaining_weight_grams::numeric + ${String(restore)}::numeric
              <= weight_grams::numeric + 0.0001
        RETURNING id
      `).then((r) => r.rows);
      if (restoredRows.length === 0) {
        throw Object.assign(
          new Error(`Cannot restore ${restore.toFixed(4)}g to FIFO batch ${purchaseId}: source batch is missing or inconsistent`),
          { statusCode: 409 },
        );
      }
    } else if (!c.is_shortfall) {
      throw Object.assign(
        new Error(`Cannot restore ${restore.toFixed(4)}g: the original FIFO source batch is missing`),
        { statusCode: 409 },
      );
    }

    // Update consumption returned counter
    await tx.execute(sql`
      UPDATE wholesale_inventory_consumptions
      SET returned_grams = returned_grams::numeric + ${String(restore)}::numeric,
          returned_cogs_aed = returned_cogs_aed::numeric + ${String(cogsForSlice)}::numeric
      WHERE id = ${c.id}
    `);

    restoredCogsAed = Math.round((restoredCogsAed + cogsForSlice) * 100) / 100;
    toRestore = Math.round((toRestore - restore) * 10000) / 10000;
  }

  if (toRestore > 0.0001) {
    throw Object.assign(
      new Error(`Cannot restore ${toRestore.toFixed(4)}g: wholesale FIFO consumption history is incomplete`),
      { statusCode: 409 },
    );
  }
  return restoredCogsAed;
}

// ── Delete wholesale invoice ──────────────────────────────────────────────────

export interface DeleteWholesaleInvoiceArgs {
  invoiceId: number;
  actorId?: number | null;
  actorName?: string | null;
}

// Helper: throw a 409 conflict that rolls back the transaction.
function conflict409(msg: string): never {
  throw Object.assign(new Error(msg), { statusCode: 409 });
}

export async function deleteWholesaleInvoice(args: DeleteWholesaleInvoiceArgs): Promise<{
  deleted: boolean;
  notFound: boolean;
}> {
  const { invoiceId, actorId, actorName } = args;

  return db.transaction(async (tx) => {
    // ── Step 1: Advisory stock-mutation lock (must be first) ─────────────────
    await acquireStockMutationLock(tx as unknown as Tx);

    // ── Step 2: SELECT invoice FOR UPDATE ────────────────────────────────────
    const [lockedInvoice] = await tx.select()
      .from(wholesaleInvoicesTable)
      .where(eq(wholesaleInvoicesTable.id, invoiceId))
      .for("update");
    if (!lockedInvoice) {
      return { deleted: false, notFound: true };
    }

    // ── Step 3: Lock items FOR UPDATE ────────────────────────────────────────
    const items = await tx.select()
      .from(wholesaleInvoiceItemsTable)
      .where(eq(wholesaleInvoiceItemsTable.invoiceId, invoiceId))
      .for("update")
      .orderBy(wholesaleInvoiceItemsTable.id);
    const itemIds = items.map((it) => it.id);

    // ── Step 4: Lock consumption rows FOR UPDATE ─────────────────────────────
    // Use raw SQL for FOR UPDATE on a WHERE that filters by invoice id;
    // Drizzle's .for("update") works on table-level, not per-row filtered.
    const consumptions = await tx.execute<{
      id: number;
      wholesale_item_id: number;
      purchase_id: string | null;
      is_shortfall: boolean;
      consumed_grams: string;
      returned_grams: string;
      cost_aed: string;
      category: string;
    }>(sql`
      SELECT id, wholesale_item_id, purchase_id, is_shortfall,
             consumed_grams::text, returned_grams::text, cost_aed::text, category
      FROM wholesale_inventory_consumptions
      WHERE wholesale_invoice_id = ${invoiceId}
      ORDER BY id
      FOR UPDATE
    `).then((r) => r.rows);

    // ── Step 5: Lock returns FOR UPDATE before reading their ids ─────────────
    // Prevents a concurrent return from being inserted and missed by the delete.
    const returns = await tx.select({ id: wholesaleReturnsTable.id })
      .from(wholesaleReturnsTable)
      .where(eq(wholesaleReturnsTable.invoiceId, invoiceId))
      .for("update")
      .orderBy(wholesaleReturnsTable.id);
    const returnIds = returns.map((r) => r.id);

    // ── Step 6: Lock settlements FOR UPDATE before reading their ids ─────────
    const settlements = await tx.select({ id: wholesaleSettlementsTable.id })
      .from(wholesaleSettlementsTable)
      .where(eq(wholesaleSettlementsTable.invoiceId, invoiceId))
      .for("update")
      .orderBy(wholesaleSettlementsTable.id);
    const settlementIds = settlements.map((s) => s.id);

    // ── Step 7: Lock source stock_purchase batches FOR UPDATE ─────────────────
    // Lock in ascending id order to match every other path that locks batches
    // (FIFO consume, return restore) and prevent deadlock.
    const purchaseIds = [...new Set(
      consumptions
        .filter((c) => c.purchase_id != null && !c.is_shortfall)
        .map((c) => parseInt(c.purchase_id!, 10))
        .filter((id) => !Number.isNaN(id)),
    )].sort((a, b) => a - b);

    // Fetch current batch state (already locked above by FOR UPDATE)
    const batchMap = new Map<number, { weightGrams: number; remainingWeightGrams: number }>();
    if (purchaseIds.length) {
      const batches = await tx.select({
        id: stockPurchasesTable.id,
        weightGrams: stockPurchasesTable.weightGrams,
        remainingWeightGrams: stockPurchasesTable.remainingWeightGrams,
      })
        .from(stockPurchasesTable)
        .where(inArray(stockPurchasesTable.id, purchaseIds))
        .for("update")
        .orderBy(stockPurchasesTable.id);
      for (const b of batches) {
        batchMap.set(b.id, {
          weightGrams: Number(b.weightGrams),
          remainingWeightGrams: Number(b.remainingWeightGrams),
        });
      }
    }

    // ── Step 8: PREFLIGHT validation — all checks before any writes ───────────

    // (a) Per-consumption row: values must be finite and non-negative;
    //     returnedGrams ≤ consumedGrams; non-shortfall null-source rows are 409.
    for (const c of consumptions) {
      const consumed = Number(c.consumed_grams);
      const returned = Number(c.returned_grams);
      if (!Number.isFinite(consumed) || consumed < 0) {
        conflict409(
          `Consumption row ${c.id} on invoice ${invoiceId}: consumed_grams (${c.consumed_grams}) is invalid`,
        );
      }
      if (!Number.isFinite(returned) || returned < 0) {
        conflict409(
          `Consumption row ${c.id} on invoice ${invoiceId}: returned_grams (${c.returned_grams}) is invalid`,
        );
      }
      if (returned > consumed + 0.0001) {
        conflict409(
          `Consumption row ${c.id} on invoice ${invoiceId}: returned_grams (${returned}) exceeds consumed_grams (${consumed})`,
        );
      }
      const net = consumed - returned;
      if (net > 0.0001) {
        if (c.purchase_id == null && !c.is_shortfall) {
          conflict409(
            `Consumption row ${c.id} on invoice ${invoiceId}: non-shortfall row has null purchase_id with ${net.toFixed(4)}g unreturned`,
          );
        }
        if (c.purchase_id != null) {
          const purchaseId = parseInt(c.purchase_id, 10);
          if (!batchMap.has(purchaseId)) {
            conflict409(
              `Consumption row ${c.id} on invoice ${invoiceId}: source batch ${purchaseId} no longer exists`,
            );
          }
        }
      }
    }

    // (b) Per-item: sum of consumed minus returned must equal
    //     item.grossGrams minus item.returnedGrossGrams (within 0.001g tolerance).
    //     This detects corrupted or truncated FIFO history.
    for (const item of items) {
      const itemConsumptions = consumptions.filter(
        (c) => c.wholesale_item_id === item.id,
      );
      const totalConsumed = itemConsumptions.reduce(
        (s, c) => s + Number(c.consumed_grams), 0,
      );
      const totalReturned = itemConsumptions.reduce(
        (s, c) => s + Number(c.returned_grams), 0,
      );
      const netFromConsumptions = totalConsumed - totalReturned;
      const expectedNet = Number(item.grossGrams) - Number(item.returnedGrossGrams);
      if (Math.abs(netFromConsumptions - expectedNet) > 0.001) {
        conflict409(
          `Item ${item.id} on invoice ${invoiceId}: FIFO consumption history is inconsistent — ` +
          `net consumed=${netFromConsumptions.toFixed(4)}g but item net=${expectedNet.toFixed(4)}g ` +
          `(grossGrams=${item.grossGrams}, returnedGrossGrams=${item.returnedGrossGrams})`,
        );
      }
    }

    // (c) Aggregate net restore per purchase batch must not exceed original weight.
    //     Sum up all net-consume slices per purchase id and compare with
    //     weight_grams minus remaining_weight_grams (the already-consumed headroom).
    const netRestoreByPurchase = new Map<number, number>();
    for (const c of consumptions) {
      if (c.purchase_id == null || c.is_shortfall) continue;
      const purchaseId = parseInt(c.purchase_id, 10);
      const net = Number(c.consumed_grams) - Number(c.returned_grams);
      if (net <= 0) continue;
      netRestoreByPurchase.set(purchaseId, (netRestoreByPurchase.get(purchaseId) ?? 0) + net);
    }
    for (const [purchaseId, netRestore] of netRestoreByPurchase) {
      const batch = batchMap.get(purchaseId)!;
      const headroom = batch.weightGrams - batch.remainingWeightGrams;
      if (netRestore > headroom + 0.001) {
        conflict409(
          `Cannot restore ${netRestore.toFixed(4)}g to batch ${purchaseId}: ` +
          `only ${headroom.toFixed(4)}g of headroom available ` +
          `(weight=${batch.weightGrams}, remaining=${batch.remainingWeightGrams})`,
        );
      }
    }

    // (d) Stock-movement net per category must exactly equal the negative of
    //     the unreturned gross quantity derived from item records.
    //     Mismatch means movements were corrupted or the invoice was partially
    //     reverse-deleted by another path.
    const invoiceMovements = await tx.select({
      category: stockMovementsTable.category,
      weightGrams: stockMovementsTable.weightGrams,
    })
      .from(stockMovementsTable)
      .where(and(
        eq(stockMovementsTable.refType, "wholesale_invoice"),
        eq(stockMovementsTable.refId, invoiceId),
      ));
    const returnMovements = returnIds.length
      ? await tx.select({
          category: stockMovementsTable.category,
          weightGrams: stockMovementsTable.weightGrams,
        })
          .from(stockMovementsTable)
          .where(and(
            eq(stockMovementsTable.refType, "wholesale_return"),
            inArray(stockMovementsTable.refId, returnIds),
          ))
      : [];

    // Net movement by category from stock_movements (negative = out, positive = in from returns)
    const movementNetByCategory = new Map<string, number>();
    for (const m of [...invoiceMovements, ...returnMovements]) {
      movementNetByCategory.set(
        m.category,
        (movementNetByCategory.get(m.category) ?? 0) + Number(m.weightGrams),
      );
    }

    // Expected net by category from item records: negative of (grossGrams - returnedGrossGrams)
    // i.e. what should be in stock_levels delta when we reverse the net delivery.
    const expectedNetByCategory = new Map<string, number>();
    for (const item of items) {
      const cat = item.category;
      const net = Number(item.grossGrams) - Number(item.returnedGrossGrams);
      expectedNetByCategory.set(cat, (expectedNetByCategory.get(cat) ?? 0) + net);
    }

    // Validate: for each category the movement net must equal -expectedNet
    const allCategories = new Set([
      ...movementNetByCategory.keys(),
      ...expectedNetByCategory.keys(),
    ]);
    for (const category of allCategories) {
      const movementNet = movementNetByCategory.get(category) ?? 0;
      const expectedNet = expectedNetByCategory.get(category) ?? 0;
      // movement net = -(delivery) + (returns), expected = -(grossGrams - returnedGrossGrams)
      // Both should equal -expectedNet when all books are consistent
      if (Math.abs(movementNet - (-expectedNet)) > 0.001) {
        conflict409(
          `Stock movement history for category '${category}' on invoice ${invoiceId} is inconsistent: ` +
          `movement net=${movementNet.toFixed(4)}g but item-derived net=${(-expectedNet).toFixed(4)}g`,
        );
      }
    }

    // ── Step 9: Exact guarded FIFO restoration (after all preflight passes) ──
    // Restore net (consumedGrams - returnedGrams) to each source batch.
    // We already validated headroom in preflight so this is guaranteed safe.
    // Use exact arithmetic — no LEAST/GREATEST silent capping.
    for (const [purchaseId, netRestore] of netRestoreByPurchase) {
      if (netRestore <= 0.0001) continue;
      await tx.execute(sql`
        UPDATE stock_purchases
        SET remaining_weight_grams = remaining_weight_grams::numeric + ${String(netRestore)}::numeric
        WHERE id = ${purchaseId}
      `);
    }

    // ── Step 10: Reverse net stock-level movements ───────────────────────────
    // movementNetByCategory holds the signed sum of movements; reversing it
    // (negating) restores the stock level. Delivery movements are negative so
    // -movementNet is positive (goods back in). Return movements were positive
    // so -movementNet is negative (removes the already-restored return credit).
    for (const [category, movementNet] of movementNetByCategory) {
      if (Math.abs(movementNet) < 0.0001) continue;
      await applyStockDelta(
        tx as unknown as Tx,
        category,
        -movementNet,
        "sale_reversal",
        "wholesale_invoice",
        invoiceId,
        `Deleted wholesale invoice ${lockedInvoice.invoiceNumber}`,
      );
    }

    // ── Step 11: Delete all trader ledger entries (explicit — schema SET NULL) ─
    // Delete by every FK that references invoice/item/settlement/return so no
    // orphan ledger rows remain after the invoice is dropped.
    await tx.delete(traderLedgerEntriesTable).where(
      eq(traderLedgerEntriesTable.wholesaleInvoiceId, invoiceId),
    );
    if (returnIds.length) {
      await tx.delete(traderLedgerEntriesTable).where(
        inArray(traderLedgerEntriesTable.wholesaleReturnId, returnIds),
      );
    }
    if (settlementIds.length) {
      await tx.delete(traderLedgerEntriesTable).where(
        inArray(traderLedgerEntriesTable.wholesaleSettlementId, settlementIds),
      );
    }
    if (itemIds.length) {
      await tx.delete(traderLedgerEntriesTable).where(
        inArray(traderLedgerEntriesTable.wholesaleItemId, itemIds),
      );
    }

    // ── Step 12: Unregister PDF test fixtures ────────────────────────────────
    const { unregisterPdfTestFixture } = await import("../routes/pdf-test-fixtures.js");
    await unregisterPdfTestFixture(tx as unknown as typeof db, "wholesale_invoice", invoiceId);
    for (const returnId of returnIds) {
      await unregisterPdfTestFixture(tx as unknown as typeof db, "wholesale_return", returnId);
    }

    // ── Step 13: Delete parent invoice (children cascade) ───────────────────
    // wholesale_invoice_items, wholesale_inventory_consumptions,
    // wholesale_settlements, wholesale_settlement_allocations,
    // wholesale_returns, wholesale_return_lines all cascade.
    await tx.delete(wholesaleInvoicesTable).where(eq(wholesaleInvoicesTable.id, invoiceId));

    // ── Step 14: Immutable audit log entry ───────────────────────────────────
    await tx.insert(auditLogTable).values({
      actorId: actorId ?? null,
      entityType: "wholesale_invoice",
      entityId: invoiceId,
      action: "delete",
      billNo: lockedInvoice.invoiceNumber,
      details: JSON.stringify({
        invoiceNumber: lockedInvoice.invoiceNumber,
        invoiceDate: lockedInvoice.invoiceDate,
        traderId: lockedInvoice.traderId,
        traderName: lockedInvoice.traderName,
        pricingType: lockedInvoice.pricingType,
        status: lockedInvoice.status,
        totalGrossGrams: lockedInvoice.totalGrossGrams,
        totalPureGrams: lockedInvoice.totalPureGrams,
        totalAed: lockedInvoice.totalAed,
        openPureGrams: lockedInvoice.openPureGrams,
        deletedByUserId: actorId ?? null,
        deletedByUserName: actorName ?? null,
      }),
    });

    return { deleted: true, notFound: false };
  });
}

// ── Load return with lines ───────────────────────────────────────────────────

export async function loadWholesaleReturn(id: number) {
  const [ret] = await db.select().from(wholesaleReturnsTable).where(eq(wholesaleReturnsTable.id, id));
  if (!ret) return null;
  const lines = await db.select().from(wholesaleReturnLinesTable)
    .where(eq(wholesaleReturnLinesTable.returnId, id))
    .orderBy(wholesaleReturnLinesTable.id);
  return { ret, lines };
}
