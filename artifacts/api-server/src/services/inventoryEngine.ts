import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// ─── Deep FIFO multi-batch consumption engine ───────────────────────────────
// Each stock purchase is a batch (lot) with a remaining_weight_grams balance.
// A sale consumes batches oldest-first (purchase_date ASC), auto-splitting across
// as many lots as needed. Every consumed slice is written to
// inventory_consumptions with its exact cost (slice grams × that batch's
// price_per_gram), giving exact per-item COGS instead of a weighted average.
//
// Sales are never blocked (established rule): if the sold weight exceeds all
// available batches, the shortfall is costed at the category's all-time
// average purchase rate and recorded with purchase_id = NULL.

type Tx = typeof db;

// Global stock-mutation lock. Every transaction that acquires FOR UPDATE row
// locks on stock_purchases (FIFO consumption, consumption reversal, unfixed
// bill settlement repricing) takes this advisory lock FIRST. Because each of
// those paths locks batch rows in a different order (FIFO order per category,
// arbitrary IN-list order, etc.), row locks alone can deadlock; serializing
// on one advisory lock gives a deterministic protocol. It is transaction
// scoped (auto-released on commit/rollback) and reentrant within a session,
// so multiple consumeFifo calls in one transaction are safe.
export async function acquireStockMutationLock(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('stock_mutation'))`);
}

export interface FifoResult {
  cogsAed: number;
  shortfallGrams: number;
}

export async function consumeFifo(
  tx: Tx,
  args: { invoiceId: number; invoiceItemId: number | null; category: string; grams: number },
): Promise<FifoResult> {
  const { invoiceId, invoiceItemId, category, grams } = args;
  if (!(grams > 0)) return { cogsAed: 0, shortfallGrams: 0 };

  await acquireStockMutationLock(tx);

  // Lock the open batches of this category so concurrent invoices can't
  // consume the same grams twice.
  const batches = await tx.execute<{ id: number; remaining: string; rate: string }>(sql`
    SELECT id, remaining_weight_grams::text AS remaining, price_per_gram::text AS rate
    FROM stock_purchases
    WHERE category = ${category} AND remaining_weight_grams::numeric > 0
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
    await tx.execute(sql`
      INSERT INTO inventory_consumptions (invoice_id, invoice_item_id, purchase_id, category, weight_grams, cost_aed)
      VALUES (${invoiceId}, ${invoiceItemId}, ${batch.id}, ${category}, ${String(consumed)}, ${String(cost)})
    `);

    cogsAed += cost;
    remainingToDeduct = Math.round((remainingToDeduct - consumed) * 10000) / 10000;
  }

  let shortfallGrams = 0;
  if (remainingToDeduct > 0) {
    // Oversell: no batches left. Cost the shortfall at the category's
    // all-time average purchase rate so profit stays meaningful.
    shortfallGrams = remainingToDeduct;
    const [avg] = await tx.execute<{ rate: string }>(sql`
      SELECT CASE WHEN COALESCE(SUM(weight_grams::numeric), 0) > 0
                  THEN SUM(total_price_aed::numeric) / SUM(weight_grams::numeric)
                  ELSE 0 END::text AS rate
      FROM stock_purchases WHERE category = ${category}
    `).then((r) => r.rows);
    const cost = Math.round(shortfallGrams * Number(avg?.rate ?? 0) * 100) / 100;
    await tx.execute(sql`
      INSERT INTO inventory_consumptions (invoice_id, invoice_item_id, purchase_id, category, weight_grams, cost_aed)
      VALUES (${invoiceId}, ${invoiceItemId}, NULL, ${category}, ${String(shortfallGrams)}, ${String(cost)})
    `);
    cogsAed += cost;
  }

  return { cogsAed: Math.round(cogsAed * 100) / 100, shortfallGrams };
}

// Reverse every consumption of an invoice: restore grams to the surviving
// source batches (deleted batches are skipped — their consumption rows have
// purchase_id NULL via ON DELETE SET NULL) and remove the ledger rows.
export async function reverseInvoiceConsumption(tx: Tx, invoiceId: number): Promise<void> {
  await acquireStockMutationLock(tx);
  await tx.execute(sql`
    UPDATE stock_purchases sp
    SET remaining_weight_grams = LEAST(
      sp.weight_grams::numeric,
      sp.remaining_weight_grams::numeric + c.total
    )
    FROM (
      SELECT purchase_id, SUM(weight_grams::numeric) AS total
      FROM inventory_consumptions
      WHERE invoice_id = ${invoiceId} AND purchase_id IS NOT NULL
      GROUP BY purchase_id
    ) c
    WHERE sp.id = c.purchase_id
  `);
  await tx.execute(sql`DELETE FROM inventory_consumptions WHERE invoice_id = ${invoiceId}`);
}
