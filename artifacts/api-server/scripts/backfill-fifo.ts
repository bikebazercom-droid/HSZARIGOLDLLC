// One-time backfill: initialize FIFO batch balances and replay all existing
// sales chronologically through the inventory engine so historic invoices get
// exact batch-split COGS rows. Idempotent: resets state first.
// Run: pnpm --filter @workspace/api-server exec tsx scripts/backfill-fifo.ts
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { consumeFifo } from "../src/services/inventoryEngine";

function itemStockCategory(description: string, category: string | null): string | null {
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

async function main() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM inventory_consumptions`);
    await tx.execute(sql`UPDATE stock_purchases SET remaining_weight_grams = weight_grams`);

    const items = await tx.execute<{
      id: number; invoice_id: number; description: string; category: string | null; gross: string | null;
    }>(sql`
      SELECT ii.id, ii.invoice_id, ii.description, ii.category, ii.gross_weight::text AS gross
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      ORDER BY i.created_at ASC, ii.invoice_id ASC, ii.id ASC
    `).then((r) => r.rows);

    let processed = 0;
    for (const it of items) {
      const cat = itemStockCategory(it.description, it.category);
      const grams = it.gross != null ? Number(it.gross) : 0;
      if (!cat || !(grams > 0)) continue;
      await consumeFifo(tx as unknown as typeof db, {
        invoiceId: it.invoice_id, invoiceItemId: it.id, category: cat, grams,
      });
      processed++;
    }
    console.log(`Replayed ${processed} sold items through the FIFO engine.`);
  });

  const [check] = await db.execute<{ batches: string; consumed: string; cogs: string }>(sql`
    SELECT (SELECT COUNT(*) FROM stock_purchases WHERE remaining_weight_grams::numeric < weight_grams::numeric)::text AS batches,
           (SELECT COALESCE(SUM(weight_grams::numeric), 0) FROM inventory_consumptions)::text AS consumed,
           (SELECT COALESCE(SUM(cost_aed::numeric), 0) FROM inventory_consumptions)::text AS cogs
  `).then((r) => r.rows);
  console.log(`Batches touched: ${check.batches}, grams consumed: ${check.consumed}, total exact COGS: ${check.cogs}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
