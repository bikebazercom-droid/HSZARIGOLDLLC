import { Router, type IRouter } from "express";
import { and, eq, gte, desc, sql, type SQL } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, customersTable, productsTable, pricesTable } from "@workspace/db";
import { GetDashboardResponse, GetCategorySummaryQueryParams, GetCategorySummaryResponse } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";
import { createBrandedPdf, PDF_BRAND } from "../lib/pdfBranding";
import ExcelJS from "exceljs";
import { isDashboardInventoryCategory, STOCK_CATEGORY_LABEL } from "../lib/stockCategories.js";

const router: IRouter = Router();

const CATEGORY_ORDER = ["gold_jewelry_22k", "gold_9999", "ten_tola_bar", "kg_bar", "995", "silver", "custom"] as const;
const CATEGORY_SUMMARY_LABEL: Record<string, string> = {
  gold_jewelry_22k: "22K Gold Jewelry",
  gold_9999: "GOLD 9999",
  ten_tola_bar: "TEN TOLA BAR",
  kg_bar: "KG. BAR",
  "995": "995",
  silver: "Silver",
  custom: "Custom",
};

function dashboardCategoryIsVisibleSql(category: SQL): SQL {
  return sql`(
    position('test_' in lower(trim(coalesce(${category}::text, '')))) <> 1
    AND position('ws_shortfall_' in lower(trim(coalesce(${category}::text, '')))) <> 1
  )`;
}

function dashboardRetailInvoiceIsVisibleSql(invoiceId: SQL): SQL {
  return sql`NOT EXISTS (
    SELECT 1
    FROM invoice_items dashboard_hidden_ii
    WHERE dashboard_hidden_ii.invoice_id = ${invoiceId}
      AND NOT (${dashboardCategoryIsVisibleSql(sql`dashboard_hidden_ii.category`)})
  )`;
}

function dashboardWholesaleInvoiceIsVisibleSql(invoiceId: SQL): SQL {
  return sql`NOT EXISTS (
    SELECT 1
    FROM wholesale_invoice_items dashboard_hidden_wii
    WHERE dashboard_hidden_wii.invoice_id = ${invoiceId}
      AND NOT (${dashboardCategoryIsVisibleSql(sql`dashboard_hidden_wii.category`)})
  )`;
}

interface CatRow extends Record<string, unknown> {
  category: string;
  invoice_count: string;
  total_amount: string;
  total_weight: string;
  total_gross_weight?: string;
}

function getCatStats(rows: CatRow[], category: string) {
  const row = rows.find(r => r.category === category);
  return {
    count: row ? parseInt(row.invoice_count, 10) : 0,
    amount: row ? parseFloat(row.total_amount) : 0,
    grams: row ? parseFloat(row.total_weight) : 0,
  };
}

// Aggregated KPI metrics for the dashboard 8-card grid. Optional
// startDate/endDate (yyyy-MM-dd) filter every metric to that range.
router.get("/dashboard/kpis", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  let start: Date | null = null;
  let endExclusive: Date | null = null;
  if (q.startDate?.trim()) {
    const d = new Date(`${q.startDate.trim()}T00:00:00`);
    if (!Number.isNaN(d.getTime())) start = d;
  }
  if (q.endDate?.trim()) {
    const d = new Date(`${q.endDate.trim()}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + 1);
      endExclusive = d;
    }
  }

  const invWhere = sql.join(
    [
      dashboardRetailInvoiceIsVisibleSql(sql`i.id`),
      ...(start ? [sql`i.created_at >= ${start.toISOString()}::timestamptz`] : []),
      ...(endExclusive ? [sql`i.created_at < ${endExclusive.toISOString()}::timestamptz`] : []),
    ],
    sql` AND `,
  );
  // stock_purchases.purchase_date is a yyyy-MM-dd text column
  const purchaseWhere = sql.join(
    [
      dashboardCategoryIsVisibleSql(sql`category`),
      ...(q.startDate?.trim() ? [sql`purchase_date >= ${q.startDate.trim()}`] : []),
      ...(q.endDate?.trim() ? [sql`purchase_date <= ${q.endDate.trim()}`] : []),
    ],
    sql` AND `,
  );
  const wholesaleInvoiceWhere = sql.join(
    [
      dashboardWholesaleInvoiceIsVisibleSql(sql`wi.id`),
      ...(q.startDate?.trim() ? [sql`wi.invoice_date >= ${q.startDate.trim()}`] : []),
      ...(q.endDate?.trim() ? [sql`wi.invoice_date <= ${q.endDate.trim()}`] : []),
    ],
    sql` AND `,
  );
  const wholesaleLedgerWhere = sql.join(
    [
      sql`(
        tle.wholesale_invoice_id IS NULL
        OR ${dashboardWholesaleInvoiceIsVisibleSql(sql`tle.wholesale_invoice_id`)}
      )`,
      ...(q.startDate?.trim() ? [sql`tle.event_date >= ${q.startDate.trim()}`] : []),
      ...(q.endDate?.trim() ? [sql`tle.event_date <= ${q.endDate.trim()}`] : []),
    ],
    sql` AND `,
  );
  const wholesaleReturnWhere = sql.join(
    [
      dashboardWholesaleInvoiceIsVisibleSql(sql`wr.invoice_id`),
      ...(q.startDate?.trim() ? [sql`wr.return_date >= ${q.startDate.trim()}`] : []),
      ...(q.endDate?.trim() ? [sql`wr.return_date <= ${q.endDate.trim()}`] : []),
    ],
    sql` AND `,
  );

  // COGS: weighted-average all-time purchase cost per gram per category,
  // multiplied by sold grams per stock bucket in the range. Same bucket rule
  // as elsewhere: trimmed description '995' is its own bucket; jewelry karats
  // share gold_jewelry_22k.
  const bucketExpr = sql`(CASE WHEN TRIM(ii.description) = '995' THEN '995'
        WHEN ii.category = 'gold_jewelry' THEN 'gold_jewelry_22k'
        ELSE ii.category END)`;

  const [invAgg, itemAgg, purchaseAgg, cogsAgg, wholesaleAgg, wholesaleCogsAgg] = await Promise.all([
    db.execute<{ invoice_count: string; total_revenue: string; cash_received: string; outstanding_due: string }>(sql`
      SELECT COUNT(*)::text AS invoice_count,
             COALESCE(SUM(i.total::numeric), 0)::text AS total_revenue,
             COALESCE(SUM(CASE WHEN NOT i.is_pending THEN i.total::numeric ELSE 0 END), 0)::text AS cash_received,
             COALESCE(SUM(CASE WHEN i.is_pending THEN i.total::numeric ELSE 0 END), 0)::text AS outstanding_due
      FROM invoices i
      WHERE ${invWhere}
    `).then((r) => r.rows[0]),
    db.execute<{ sold_grams: string; making_charges: string }>(sql`
      SELECT COALESCE(SUM(COALESCE(ii.gross_weight::numeric, 0)), 0)::text AS sold_grams,
             COALESCE(SUM(COALESCE(ii.making_amt::numeric, 0)), 0)::text AS making_charges
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE ${invWhere}
    `).then((r) => r.rows[0]),
    db.execute<{ purchased_grams: string; purchase_cost: string }>(sql`
      SELECT COALESCE(SUM(weight_grams::numeric), 0)::text AS purchased_grams,
             COALESCE(SUM(total_price_aed::numeric), 0)::text AS purchase_cost
      FROM stock_purchases
      WHERE ${purchaseWhere}
    `).then((r) => r.rows[0]),
    // Exact FIFO COGS: sum the inventory engine's per-batch consumption costs
    // for invoices in the range.
    db.execute<{ cogs: string }>(sql`
      SELECT COALESCE(SUM(c.cost_aed::numeric), 0)::text AS cogs
      FROM inventory_consumptions c
      JOIN invoices i ON i.id = c.invoice_id
      WHERE ${invWhere}
    `).then((r) => r.rows[0]),
    db.execute<{
      invoice_count: string;
      total_revenue: string;
      cash_received: string;
      outstanding_due: string;
      sold_grams: string;
      making_charges: string;
    }>(sql`
      SELECT
        (SELECT COUNT(*) FROM wholesale_invoices wi WHERE ${wholesaleInvoiceWhere})::text AS invoice_count,
        (SELECT COALESCE(SUM(
           CASE WHEN tle.event_type IN ('fixed_sale', 'delivery', 'rate_fix', 'physical_return')
                THEN tle.aed_delta::numeric ELSE 0 END
         ), 0)
         FROM trader_ledger_entries tle WHERE ${wholesaleLedgerWhere})::text AS total_revenue,
        (SELECT COALESCE(SUM(
           CASE WHEN tle.event_type IN ('cash_payment', 'cash_refund')
                THEN -tle.aed_delta::numeric ELSE 0 END
         ), 0)
         FROM trader_ledger_entries tle WHERE ${wholesaleLedgerWhere})::text AS cash_received,
        (SELECT COALESCE(SUM(tle.aed_delta::numeric), 0)
         FROM trader_ledger_entries tle WHERE ${wholesaleLedgerWhere})::text AS outstanding_due,
        (
          COALESCE((
            SELECT SUM(wii.gross_grams::numeric)
            FROM wholesale_invoice_items wii
            JOIN wholesale_invoices wi ON wi.id = wii.invoice_id
            WHERE ${wholesaleInvoiceWhere}
          ), 0)
          - COALESCE((
            SELECT SUM(wr.total_returned_gross_grams::numeric)
            FROM wholesale_returns wr
            WHERE ${wholesaleReturnWhere}
          ), 0)
        )::text AS sold_grams,
        (
          COALESCE((
            SELECT SUM(wii.making_aed::numeric)
            FROM wholesale_invoice_items wii
            JOIN wholesale_invoices wi ON wi.id = wii.invoice_id
            WHERE ${wholesaleInvoiceWhere}
          ), 0)
          - COALESCE((
            SELECT SUM(wr.total_returned_making_aed::numeric)
            FROM wholesale_returns wr
            WHERE ${wholesaleReturnWhere}
          ), 0)
        )::text AS making_charges
    `).then((r) => r.rows[0]),
    db.execute<{ cogs: string }>(sql`
      SELECT (
        COALESCE((
          SELECT SUM(wic.cost_aed::numeric)
          FROM wholesale_inventory_consumptions wic
          JOIN wholesale_invoices wi ON wi.id = wic.wholesale_invoice_id
          WHERE ${wholesaleInvoiceWhere}
        ), 0)
        - COALESCE((
          SELECT SUM(wr.total_returned_cogs_aed::numeric)
          FROM wholesale_returns wr
          WHERE ${wholesaleReturnWhere}
        ), 0)
      )::text AS cogs
    `).then((r) => r.rows[0]),
  ]);

  const stockInGrams = Number(purchaseAgg.purchased_grams);
  const stockOutGrams = Number(itemAgg.sold_grams) + Number(wholesaleAgg.sold_grams);
  const invoiceCount = Number(invAgg.invoice_count) + Number(wholesaleAgg.invoice_count);
  const totalRevenueAed = Number(invAgg.total_revenue) + Number(wholesaleAgg.total_revenue);
  const totalCogsAed = Number(cogsAgg.cogs) + Number(wholesaleCogsAgg.cogs);

  res.json({
    stockInGrams,
    stockOutGrams,
    netStockGrams: stockInGrams - stockOutGrams,
    totalRevenueAed,
    cashReceivedAed: Number(invAgg.cash_received) + Number(wholesaleAgg.cash_received),
    outstandingDueAed: Number(invAgg.outstanding_due) + Number(wholesaleAgg.outstanding_due),
    makingChargesAed: Number(itemAgg.making_charges) + Number(wholesaleAgg.making_charges),
    invoiceCount,
    avgInvoiceAed: invoiceCount > 0 ? totalRevenueAed / invoiceCount : 0,
    purchaseCostAed: Number(purchaseAgg.purchase_cost),
    cogsAed: totalCogsAed,
    netProfitAed: totalRevenueAed - totalCogsAed,
  });
});

// All-time live totals for the dashboard profit/stock summary. Not date-filtered:
// Card 1 shows remaining stock (purchased − sold) and its value at purchase
// cost (total purchase spend − COGS of everything sold so far); Card 2 shows
// cumulative invoiced revenue and net profit (revenue − COGS; making charges
// are already inside invoice totals, so they are not added again).
router.get("/dashboard/summary-cards", async (_req, res): Promise<void> => {
  // Silver is tracked in its own dedicated card; everything else (gold,
  // ten_tola_bar, kg_bar, 995, gold_jewelry_22k, custom) rolls up into the main box.
  // Cost values come straight from the FIFO batch ledger: remaining stock is
  // valued at each surviving lot's own purchase rate, and COGS is the exact
  // sum of consumed batch slices — no averaging.
  const [purchaseAgg, salesAgg, cogsAgg, purchasesByCategory, salesByCategory, liveLevels] = await Promise.all([
    db.execute<{ main_cost: string; silver_cost: string; purchase_debit: string }>(sql`
      SELECT COALESCE(SUM(CASE WHEN category <> 'silver' THEN remaining_weight_grams::numeric * price_per_gram::numeric ELSE 0 END), 0)::text AS main_cost,
             COALESCE(SUM(CASE WHEN category = 'silver' THEN remaining_weight_grams::numeric * price_per_gram::numeric ELSE 0 END), 0)::text AS silver_cost,
             COALESCE(SUM(total_price_aed::numeric), 0)::text AS purchase_debit
      FROM stock_purchases
      WHERE ${dashboardCategoryIsVisibleSql(sql`category`)}
    `).then((r) => r.rows[0]),
    db.execute<{ total_revenue: string }>(sql`
      SELECT (
        COALESCE((
          SELECT SUM(i.total::numeric)
          FROM invoices i
          WHERE ${dashboardRetailInvoiceIsVisibleSql(sql`i.id`)}
        ), 0)
        + COALESCE((
          SELECT SUM(wi.total_aed::numeric)
          FROM wholesale_invoices wi
          WHERE ${dashboardWholesaleInvoiceIsVisibleSql(sql`wi.id`)}
        ), 0)
      )::text AS total_revenue
    `).then((r) => r.rows[0]),
    db.execute<{ main_cogs: string; silver_cogs: string }>(sql`
      SELECT COALESCE(SUM(CASE WHEN category <> 'silver' THEN net_cost ELSE 0 END), 0)::text AS main_cogs,
             COALESCE(SUM(CASE WHEN category = 'silver' THEN net_cost ELSE 0 END), 0)::text AS silver_cogs
      FROM (
        SELECT ic.category, ic.cost_aed::numeric AS net_cost
        FROM inventory_consumptions ic
        JOIN invoices i ON i.id = ic.invoice_id
        WHERE ${dashboardCategoryIsVisibleSql(sql`ic.category`)}
          AND ${dashboardRetailInvoiceIsVisibleSql(sql`i.id`)}
        UNION ALL
        SELECT wic.category,
               CASE WHEN wic.consumed_grams::numeric > 0
                    THEN wic.cost_aed::numeric
                         * GREATEST(wic.consumed_grams::numeric - wic.returned_grams::numeric, 0)
                         / wic.consumed_grams::numeric
                    ELSE 0 END AS net_cost
        FROM wholesale_inventory_consumptions wic
        JOIN wholesale_invoices wi ON wi.id = wic.wholesale_invoice_id
        WHERE ${dashboardCategoryIsVisibleSql(sql`wic.category`)}
          AND ${dashboardWholesaleInvoiceIsVisibleSql(sql`wi.id`)}
      ) costs
    `).then((r) => r.rows[0]),
    db.execute<{ category: string; purchased_grams: string }>(sql`
      SELECT category, COALESCE(SUM(weight_grams::numeric), 0)::text AS purchased_grams
      FROM stock_purchases
      WHERE ${dashboardCategoryIsVisibleSql(sql`category`)}
      GROUP BY category
    `).then((r) => r.rows),
    db.execute<{ category: string; sold_grams: string }>(sql`
      SELECT category, COALESCE(SUM(sold_grams), 0)::text AS sold_grams
      FROM (
        SELECT CASE WHEN TRIM(ii.description) = '995' THEN '995'
                    WHEN ii.category = 'gold_jewelry' THEN 'gold_jewelry_22k'
                    ELSE ii.category END AS category,
               COALESCE(ii.gross_weight::numeric, 0) AS sold_grams
        FROM invoice_items ii
        WHERE ii.category IS NOT NULL
          AND ${dashboardRetailInvoiceIsVisibleSql(sql`ii.invoice_id`)}
          AND ${dashboardCategoryIsVisibleSql(sql`ii.category`)}
        UNION ALL
        SELECT wii.category,
               GREATEST(wii.gross_grams::numeric - wii.returned_gross_grams::numeric, 0) AS sold_grams
        FROM wholesale_invoice_items wii
        WHERE ${dashboardWholesaleInvoiceIsVisibleSql(sql`wii.invoice_id`)}
          AND ${dashboardCategoryIsVisibleSql(sql`wii.category`)}
      ) sales
      GROUP BY category
    `).then((r) => r.rows),
    db.execute<{ category: string; remaining_grams: string }>(sql`
      SELECT category, weight_grams::text AS remaining_grams
      FROM stock_levels
      WHERE ${dashboardCategoryIsVisibleSql(sql`category`)}
      ORDER BY category
    `).then((r) => r.rows),
  ]);

  const mainCogs = Number(cogsAgg.main_cogs);
  const silverCogs = Number(cogsAgg.silver_cogs);
  const revenue = Number(salesAgg.total_revenue);
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const purchasedMap = new Map(purchasesByCategory.map((row) => [row.category, Number(row.purchased_grams)]));
  const soldMap = new Map(salesByCategory.map((row) => [row.category, Number(row.sold_grams)]));
  const remainingMap = new Map(liveLevels.map((row) => [row.category, Number(row.remaining_grams)]));
  const categoryOrder = Object.keys(STOCK_CATEGORY_LABEL);
  const categorySet = new Set([
    ...categoryOrder,
    ...purchasedMap.keys(),
    ...soldMap.keys(),
    ...remainingMap.keys(),
  ]);
  const categoryBreakdown = [...categorySet]
    .filter(isDashboardInventoryCategory)
    .sort((a, b) => {
      const ai = categoryOrder.indexOf(a);
      const bi = categoryOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map((category) => ({
      category,
      label: STOCK_CATEGORY_LABEL[category] ?? category,
      purchasedGrams: round3(purchasedMap.get(category) ?? 0),
      soldGrams: round3(soldMap.get(category) ?? 0),
      remainingGrams: round3(remainingMap.get(category) ?? 0),
    }));
  const totalPhysicalRemainingGrams = round3(categoryBreakdown.reduce((sum, row) => sum + row.remainingGrams, 0));

  res.json({
    availableStockGrams: round3(categoryBreakdown.filter((row) => row.category !== "silver").reduce((sum, row) => sum + row.remainingGrams, 0)),
    availableStockCostAed: round2(Number(purchaseAgg.main_cost)),
    silverStockGrams: round3(remainingMap.get("silver") ?? 0),
    silverStockCostAed: round2(Number(purchaseAgg.silver_cost)),
    totalRevenueAed: round2(revenue),
    soldCostAed: round2(mainCogs + silverCogs),
    netProfitAed: round2(revenue - mainCogs - silverCogs),
    totalPhysicalRemainingGrams,
    totalPurchaseDebitAed: round2(Number(purchaseAgg.purchase_debit)),
    totalSalesCreditAed: round2(revenue),
    categoryBreakdown,
  });
});

router.get("/dashboard", async (_req, res): Promise<void> => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    prices,
    todayInvoices,
    monthlyInvoices,
    todayCatRows,
    monthlyCatRows,
    totalCustomers,
    totalProducts,
    totalInvoices,
    pendingInvoices,
    recentRows,
  ] = await Promise.all([
    db.select().from(pricesTable).limit(1).then(r => r[0]),
    db.select().from(invoicesTable).where(and(
      gte(invoicesTable.createdAt, startOfToday),
      dashboardRetailInvoiceIsVisibleSql(sql`${invoicesTable.id}`),
    )),
    db.select().from(invoicesTable).where(and(
      gte(invoicesTable.createdAt, startOfMonth),
      dashboardRetailInvoiceIsVisibleSql(sql`${invoicesTable.id}`),
    )),
    // Item-level aggregation: amount = sum(item.total_price), grams = sum(item.weight) per category
    db.execute<CatRow>(sql`
      SELECT
        ii.category,
        COUNT(DISTINCT ii.invoice_id)::text AS invoice_count,
        COALESCE(SUM(ii.total_price::numeric), 0)::text AS total_amount,
        COALESCE(SUM(CASE WHEN ii.weight IS NOT NULL THEN ii.weight::numeric ELSE 0 END), 0)::text AS total_weight
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE i.created_at >= ${startOfToday}
        AND ii.category IS NOT NULL
        AND ${dashboardRetailInvoiceIsVisibleSql(sql`i.id`)}
        AND ${dashboardCategoryIsVisibleSql(sql`ii.category`)}
      GROUP BY ii.category
    `).then(r => r.rows as CatRow[]),
    db.execute<CatRow>(sql`
      SELECT
        ii.category,
        COUNT(DISTINCT ii.invoice_id)::text AS invoice_count,
        COALESCE(SUM(ii.total_price::numeric), 0)::text AS total_amount,
        COALESCE(SUM(CASE WHEN ii.weight IS NOT NULL THEN ii.weight::numeric ELSE 0 END), 0)::text AS total_weight
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE i.created_at >= ${startOfMonth}
        AND ii.category IS NOT NULL
        AND ${dashboardRetailInvoiceIsVisibleSql(sql`i.id`)}
        AND ${dashboardCategoryIsVisibleSql(sql`ii.category`)}
      GROUP BY ii.category
    `).then(r => r.rows as CatRow[]),
    db.$count(customersTable),
    db.$count(productsTable, dashboardCategoryIsVisibleSql(sql`${productsTable.category}`)),
    db.$count(invoicesTable, dashboardRetailInvoiceIsVisibleSql(sql`${invoicesTable.id}`)),
    db.select().from(invoicesTable).where(and(
      eq(invoicesTable.isPending, true),
      dashboardRetailInvoiceIsVisibleSql(sql`${invoicesTable.id}`),
    )),
    db.select().from(invoicesTable)
      .where(dashboardRetailInvoiceIsVisibleSql(sql`${invoicesTable.id}`))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(5),
  ]);

  const goldPricePerGram = prices ? Number(prices.goldPricePerGram) : 320;
  const silverPricePerGram = prices ? Number(prices.silverPricePerGram) : 4.5;

  const todayTotalSale = todayInvoices.reduce((s, inv) => s + Number(inv.total), 0);
  const monthlySale = monthlyInvoices.reduce((s, inv) => s + Number(inv.total), 0);
  const cashCollection = monthlyInvoices.filter(i => i.paymentMethod === "cash").reduce((s, i) => s + Number(i.total), 0);
  const cardCollection = monthlyInvoices.filter(i => i.paymentMethod === "card").reduce((s, i) => s + Number(i.total), 0);
  const bankTransferCollection = monthlyInvoices.filter(i => i.paymentMethod === "bank_transfer").reduce((s, i) => s + Number(i.total), 0);

  // Per-category stats from item-level aggregation
  const todayGoldJewelry = getCatStats(todayCatRows, "gold_jewelry");
  const todayGold = getCatStats(todayCatRows, "gold_9999");
  const todayKgBar = getCatStats(todayCatRows, "kg_bar");
  const todayTtBar = getCatStats(todayCatRows, "ten_tola_bar");
  const todaySilver = getCatStats(todayCatRows, "silver");
  const todayTotalGoldGrams = todayGoldJewelry.grams + todayGold.grams + todayKgBar.grams + todayTtBar.grams;

  const monthlyGoldJewelry = getCatStats(monthlyCatRows, "gold_jewelry");
  const monthlyGold = getCatStats(monthlyCatRows, "gold_9999");
  const monthlyKgBar = getCatStats(monthlyCatRows, "kg_bar");
  const monthlyTtBar = getCatStats(monthlyCatRows, "ten_tola_bar");
  const monthlySilver = getCatStats(monthlyCatRows, "silver");
  const monthlyTotalGoldGrams = monthlyGoldJewelry.grams + monthlyGold.grams + monthlyKgBar.grams + monthlyTtBar.grams;

  const recentInvoices = await Promise.all(
    recentRows.map(async (inv) => {
      const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, inv.id));
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
        items: items.map((item) => ({
          ...item,
          quantity: Number(item.quantity),
          weight: item.weight != null ? Number(item.weight) : null,
          grossWeight: item.grossWeight != null ? Number(item.grossWeight) : null,
          purityMultiplier: item.purityMultiplier != null ? Number(item.purityMultiplier) : null,
          pureWeight: item.pureWeight != null ? Number(item.pureWeight) : null,
          makingRate: item.makingRate != null ? Number(item.makingRate) : null,
          makingAmt: item.makingAmt != null ? Number(item.makingAmt) : null,
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
        })),
      };
    })
  );

  res.json(
    GetDashboardResponse.parse({
      todayTotalSale,
      monthlySale,
      cashCollection,
      cardCollection,
      bankTransferCollection,
      totalCustomers,
      totalProducts,
      totalInvoices,
      pendingPaymentsCount: pendingInvoices.length,
      goldPricePerGram,
      silverPricePerGram,
      // Gold Jewelry
      todayGoldJewelryCount: todayGoldJewelry.count,
      todayGoldJewelryAmount: todayGoldJewelry.amount,
      todayGoldJewelryGrams: todayGoldJewelry.grams,
      monthlyGoldJewelryCount: monthlyGoldJewelry.count,
      monthlyGoldJewelryAmount: monthlyGoldJewelry.amount,
      monthlyGoldJewelryGrams: monthlyGoldJewelry.grams,
      // Pure Gold (GOLD 9999)
      todayGoldCount: todayGold.count,
      todayGoldAmount: todayGold.amount,
      todayGoldGrams: todayGold.grams,
      monthlyGoldCount: monthlyGold.count,
      monthlyGoldAmount: monthlyGold.amount,
      monthlyGoldGrams: monthlyGold.grams,
      // KG Bar
      todayKgBarCount: todayKgBar.count,
      todayKgBarAmount: todayKgBar.amount,
      todayKgBarGrams: todayKgBar.grams,
      monthlyKgBarCount: monthlyKgBar.count,
      monthlyKgBarAmount: monthlyKgBar.amount,
      monthlyKgBarGrams: monthlyKgBar.grams,
      // TEN TOLA BAR
      todayTtBarCount: todayTtBar.count,
      todayTtBarAmount: todayTtBar.amount,
      todayTtBarGrams: todayTtBar.grams,
      monthlyTtBarCount: monthlyTtBar.count,
      monthlyTtBarAmount: monthlyTtBar.amount,
      monthlyTtBarGrams: monthlyTtBar.grams,
      // Silver
      todaySilverCount: todaySilver.count,
      todaySilverAmount: todaySilver.amount,
      todaySilverGrams: todaySilver.grams,
      monthlySilverCount: monthlySilver.count,
      monthlySilverAmount: monthlySilver.amount,
      monthlySilverGrams: monthlySilver.grams,
      // Combined totals
      todayTotalGoldGrams,
      monthlyTotalGoldGrams,
      recentInvoices,
    })
  );
});

// Category-wise sales summary for a given date range (inclusive)
// GET /api/dashboard/category-summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get("/dashboard/category-summary", async (req, res): Promise<void> => {
  const parsedQuery = GetCategorySummaryQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }
  const { startDate, endDate } = parsedQuery.data;

  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setDate(end.getDate() + 1); // inclusive of the end date's full day

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    res.status(400).json({ error: "Invalid startDate or endDate" });
    return;
  }

  const [retailCatRows, wholesaleCatRows] = await Promise.all([
    db.execute<CatRow>(sql`
      SELECT
        COALESCE(ii.category, 'custom') AS category,
        COUNT(DISTINCT ii.invoice_id)::text AS invoice_count,
        COALESCE(SUM(ii.total_price::numeric), 0)::text AS total_amount,
        COALESCE(SUM(COALESCE(ii.pure_weight::numeric, ii.gross_weight::numeric, 0)), 0)::text AS total_weight,
        COALESCE(SUM(ii.gross_weight::numeric), 0)::text AS total_gross_weight
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE i.created_at >= ${start} AND i.created_at < ${end}
        AND ${dashboardRetailInvoiceIsVisibleSql(sql`i.id`)}
        AND ${dashboardCategoryIsVisibleSql(sql`ii.category`)}
      GROUP BY COALESCE(ii.category, 'custom')
    `).then(r => r.rows as CatRow[]),
    db.execute<CatRow>(sql`
      SELECT
        COALESCE(category, 'custom') AS category,
        COUNT(DISTINCT invoice_id)::text AS invoice_count,
        COALESCE(SUM(amount), 0)::text AS total_amount,
        COALESCE(SUM(pure_grams), 0)::text AS total_weight,
        COALESCE(SUM(gross_grams), 0)::text AS total_gross_weight
      FROM (
        SELECT wii.category,
               wi.id AS invoice_id,
               CASE WHEN wi.pricing_type IN ('fixed', 'cash')
                    THEN wii.total_aed::numeric
                         + wii.returned_making_aed::numeric
                         + wii.returned_metal_aed::numeric
                    ELSE wii.making_aed::numeric END AS amount,
               wii.pure_grams::numeric AS pure_grams,
               wii.gross_grams::numeric AS gross_grams
        FROM wholesale_invoice_items wii
        JOIN wholesale_invoices wi ON wi.id = wii.invoice_id
        WHERE wi.invoice_date >= ${startDate} AND wi.invoice_date <= ${endDate}
          AND ${dashboardWholesaleInvoiceIsVisibleSql(sql`wi.id`)}
          AND ${dashboardCategoryIsVisibleSql(sql`wii.category`)}

        UNION ALL

        SELECT wii.category,
               ws.invoice_id,
               wsa.aed_amount::numeric AS amount,
               0::numeric AS pure_grams,
               0::numeric AS gross_grams
        FROM wholesale_settlement_allocations wsa
        JOIN wholesale_settlements ws ON ws.id = wsa.settlement_id
        JOIN wholesale_invoice_items wii ON wii.id = wsa.invoice_item_id
        WHERE ws.settlement_date >= ${startDate} AND ws.settlement_date <= ${endDate}
          AND ${dashboardWholesaleInvoiceIsVisibleSql(sql`ws.invoice_id`)}
          AND ${dashboardCategoryIsVisibleSql(sql`wii.category`)}

        UNION ALL

        SELECT wii.category,
               wr.invoice_id,
               -wrl.returned_aed::numeric AS amount,
               -wrl.pure_weight_grams::numeric AS pure_grams,
               -wrl.gross_weight_grams::numeric AS gross_grams
        FROM wholesale_return_lines wrl
        JOIN wholesale_returns wr ON wr.id = wrl.return_id
        JOIN wholesale_invoice_items wii ON wii.id = wrl.invoice_item_id
        WHERE wr.return_date >= ${startDate} AND wr.return_date <= ${endDate}
          AND ${dashboardWholesaleInvoiceIsVisibleSql(sql`wr.invoice_id`)}
          AND ${dashboardCategoryIsVisibleSql(sql`wii.category`)}
      ) wholesale_events
      GROUP BY COALESCE(category, 'custom')
    `).then(r => r.rows as CatRow[]),
  ]);
  const catRows = [...retailCatRows, ...wholesaleCatRows]
    .filter((row) => isDashboardInventoryCategory(row.category));

  // Payment method breakdown for the same date range.
  // Credit/Due sales are any invoice marked isPending, regardless of the recorded payment method.
  // Remaining (settled) invoices are split into Cash vs Card (bank_transfer is grouped with Card as electronic settlement).
  const [rangeInvoices, wholesaleCredit] = await Promise.all([
    db
      .select({ total: invoicesTable.total, paymentMethod: invoicesTable.paymentMethod, isPending: invoicesTable.isPending })
      .from(invoicesTable)
      .where(sql`
        ${invoicesTable.createdAt} >= ${start}
        AND ${invoicesTable.createdAt} < ${end}
        AND ${dashboardRetailInvoiceIsVisibleSql(sql`${invoicesTable.id}`)}
      `),
    db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(aed_delta::numeric), 0)::text AS total
      FROM trader_ledger_entries
      WHERE event_date >= ${startDate} AND event_date <= ${endDate}
        AND (
          wholesale_invoice_id IS NULL
          OR ${dashboardWholesaleInvoiceIsVisibleSql(sql`wholesale_invoice_id`)}
        )
    `).then((r) => r.rows[0]),
  ]);

  let totalCash = 0;
  let totalCard = 0;
  let totalCredit = 0;
  for (const inv of rangeInvoices) {
    const amount = Number(inv.total);
    if (inv.isPending) {
      totalCredit += amount;
    } else if (inv.paymentMethod === "cash") {
      totalCash += amount;
    } else {
      totalCard += amount;
    }
  }
  // Wholesale AED values are trader receivables until an explicit payment
  // module exists, so they belong in the Credit / Due bucket.
  totalCredit += Number(wholesaleCredit.total);
  const paymentBreakdown = {
    totalCash: Math.round(totalCash * 100) / 100,
    totalCard: Math.round(totalCard * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    grandTotal: Math.round((totalCash + totalCard + totalCredit) * 100) / 100,
  };

  // Anything with a category not in our known set is folded into "Custom"
  const knownCategories = new Set(CATEGORY_ORDER);
  const normalizedRows = catRows.map(r => {
    const canonicalCategory = r.category === "gold_jewelry" ? "gold_jewelry_22k" : r.category;
    return {
      ...r,
      category: knownCategories.has(canonicalCategory as (typeof CATEGORY_ORDER)[number])
        ? canonicalCategory
        : "custom",
    };
  });

  const rows = CATEGORY_ORDER.map((category) => {
    const matching = normalizedRows.filter(r => r.category === category);
    let amount = 0;
    let grams = 0;
    let grossGrams = 0;
    for (const r of matching) {
      amount += parseFloat(r.total_amount);
      grams += parseFloat(r.total_weight);
      grossGrams += parseFloat(r.total_gross_weight ?? "0");
    }
    const invoiceCount = matching.reduce((s, r) => s + parseInt(r.invoice_count, 10), 0);
    return {
      category,
      label: CATEGORY_SUMMARY_LABEL[category],
      grossGrams: Math.round(grossGrams * 1000) / 1000,
      grams: Math.round(grams * 1000) / 1000,
      amount: Math.round(amount * 100) / 100,
      invoiceCount,
    };
  });

  const grandTotalGrossGrams = Math.round(rows.reduce((s, r) => s + r.grossGrams, 0) * 1000) / 1000;
  const grandTotalGrams = Math.round(rows.reduce((s, r) => s + r.grams, 0) * 1000) / 1000;
  const grandTotalAmount = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;

  res.json(
    GetCategorySummaryResponse.parse({
      startDate,
      endDate,
      rows,
      grandTotalGrossGrams,
      grandTotalGrams,
      grandTotalAmount,
      paymentBreakdown,
    })
  );
});

// Shared helper for download endpoints
async function getInvoicesForDownload(category: string, period: string) {
  const now = new Date();
  const startDate = period === "today"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getFullYear(), now.getMonth(), 1);

  const allInvoices = await db
    .select()
    .from(invoicesTable)
    .where(and(
      gte(invoicesTable.createdAt, startDate),
      dashboardRetailInvoiceIsVisibleSql(sql`${invoicesTable.id}`),
    ))
    .orderBy(desc(invoicesTable.createdAt));

  const rows = await Promise.all(
    allInvoices.map(async (inv) => {
      const items = await db.select().from(invoiceItemsTable).where(and(
        eq(invoiceItemsTable.invoiceId, inv.id),
        dashboardCategoryIsVisibleSql(sql`${invoiceItemsTable.category}`),
      ));
      return { inv, items };
    })
  );

  // Filter by category at item level — keep invoices that have at least one matching item
  if (category !== "all") {
    return rows.filter(({ items }) => items.some(i => i.category === category));
  }
  return rows;
}

const categoryLabel: Record<string, string> = {
  gold_jewelry: "Gold Jewelry",
  gold_9999: "GOLD 9999",
  kg_bar: "KG Bar",
  ten_tola_bar: "TEN TOLA BAR",
  silver: "Silver",
  all: "All",
};

// CSV download: /api/dashboard/download?category=gold_jewelry|gold_9999|kg_bar|ten_tola_bar|silver|all&period=today|monthly
router.get("/dashboard/download", async (req, res): Promise<void> => {
  const category = (req.query.category as string) || "all";
  const period = (req.query.period as string) || "today";
  const rows = await getInvoicesForDownload(category, period);

  const lines: string[] = [
    "Invoice No,Date,Customer,Payment Method,Category,Description,Gross Wt.(g),Total Price,Invoice Total",
  ];

  for (const { inv, items } of rows) {
    const date = new Date(inv.createdAt).toLocaleDateString("en-AE");
    const customer = inv.customerName ?? "Walk-in";
    const method = inv.paymentMethod.replace("_", " ");
    const total = Number(inv.total).toFixed(2);

    const matchingItems = category !== "all" ? items.filter(i => i.category === category) : items;

    if (matchingItems.length === 0) {
      lines.push(`"${inv.invoiceNumber}","${date}","${customer}","${method}","","","","","${total}"`);
    } else {
      for (const item of matchingItems) {
        const cat = categoryLabel[item.category ?? ""] ?? item.category ?? "";
        const desc = (item.description ?? "").replace(/"/g, '""');
        lines.push(
          `"${inv.invoiceNumber}","${date}","${customer}","${method}","${cat}","${desc}","${item.weight ?? ""}","${Number(item.totalPrice).toFixed(2)}","${total}"`
        );
      }
    }
  }

  const periodLabel = period === "today" ? "Today" : "Monthly";
  const catLabel = categoryLabel[category] ?? category;
  const filename = `hazari-gold-${catLabel.toLowerCase().replace(/ /g, "-")}-${periodLabel.toLowerCase()}.csv`;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(lines.join("\n"));
});

// PDF download: /api/dashboard/download-pdf?category=...&period=today|monthly
router.get("/dashboard/download-pdf", async (req, res): Promise<void> => {
  const category = (req.query.category as string) || "all";
  const period = (req.query.period as string) || "today";
  const rows = await getInvoicesForDownload(category, period);
  const now = new Date();

  const periodLabel = period === "today"
    ? `Today — ${now.toLocaleDateString("en-AE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`
    : `Monthly — ${now.toLocaleDateString("en-AE", { year: "numeric", month: "long" })}`;

  const catLabel = categoryLabel[category] ?? category;
  const filename = `hazari-gold-${catLabel.toLowerCase().replace(/ /g, "-")}-${period}.pdf`;

  const pdf = createBrandedPdf({
    title: "Management Portal — Sales Report",
    generatedAt: now,
  });
  const { doc } = pdf;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  const NAVY = PDF_BRAND.navy;
  const GOLD = PDF_BRAND.gold;
  const LIGHT = "#f5f3ee";
  const W = pdf.width;

  let y = pdf.contentTop;
  doc.rect(40, y, W, 36).fill(LIGHT);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(`${catLabel}  ·  ${periodLabel}`, 52, y + 12);
  y += 50;

  const grandTotal = rows.reduce((s, { inv }) => s + Number(inv.total), 0);
  const totalGrams = rows.reduce((s, { items }) =>
    s + items.reduce((si, it) => si + (it.weight ? Number(it.weight) : 0), 0), 0);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(
    `Invoices: ${rows.length}   |   Total Weight: ${totalGrams.toFixed(2)} g   |   Grand Total: AED ${grandTotal.toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
    40,
    y,
    { width: W, align: "right" },
  );
  y += 20;

  const cols = { no: 40, date: 110, customer: 195, method: 300, category: 360, weight: 435, total: 480 };
  const colWidths = { no: 65, date: 80, customer: 100, method: 55, category: 70, weight: 42, total: 65 };
  const drawTableHeader = () => {
    doc.rect(40, y, W, 18).fill(NAVY);
    doc.fillColor("white").font("Helvetica-Bold").fontSize(8);
    doc.text("Invoice #", cols.no, y + 5, { width: colWidths.no });
    doc.text("Date", cols.date, y + 5, { width: colWidths.date });
    doc.text("Customer", cols.customer, y + 5, { width: colWidths.customer });
    doc.text("Method", cols.method, y + 5, { width: colWidths.method });
    doc.text("Category", cols.category, y + 5, { width: colWidths.category });
    doc.text("Wt.(g)", cols.weight, y + 5, { width: colWidths.weight, align: "right" });
    doc.text("Total AED", cols.total, y + 5, { width: colWidths.total, align: "right" });
    y += 18;
  };
  drawTableHeader();
  let rowIndex = 0;

  for (const { inv, items } of rows) {
    const rowH = 16;
    if (y + rowH > pdf.contentBottom) {
      y = pdf.addPage();
      drawTableHeader();
    }
    const bg = rowIndex % 2 === 0 ? "white" : LIGHT;
    doc.rect(40, y, W, rowH).fill(bg);

    const date = new Date(inv.createdAt).toLocaleDateString("en-AE");
    const customer = (inv.customerName ?? "Walk-in").substring(0, 16);
    const method = inv.paymentMethod.replace("_", " ");
    const cats = [...new Set(items.map(i => categoryLabel[i.category ?? ""] ?? i.category))].join(", ") || "—";
    const invGrams = items.reduce((s, i) => s + (i.weight ? Number(i.weight) : 0), 0);
    const total = Number(inv.total).toLocaleString("en-AE", { minimumFractionDigits: 2 });

    doc.fillColor("#1a1a1a").font("Helvetica").fontSize(7.5);
    doc.text(inv.invoiceNumber, cols.no, y + 4, { width: colWidths.no });
    doc.text(date, cols.date, y + 4, { width: colWidths.date });
    doc.text(customer, cols.customer, y + 4, { width: colWidths.customer });
    doc.text(method, cols.method, y + 4, { width: colWidths.method });
    doc.text(cats.substring(0, 16), cols.category, y + 4, { width: colWidths.category });
    doc.text(invGrams > 0 ? invGrams.toFixed(2) : "—", cols.weight, y + 4, { width: colWidths.weight, align: "right" });
    doc.fillColor(NAVY).font("Helvetica-Bold");
    doc.text(total, cols.total, y + 4, { width: colWidths.total, align: "right" });

    y += rowH;
    rowIndex++;
  }

  if (rows.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(10).text(
      "No invoices found for this period.",
      40, y + 10, { align: "center", width: W },
    );
    y += 28;
  }

  y = pdf.ensureSpace(y, 42);
  doc.rect(40, y + 8, W, 1).fill(GOLD);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9)
    .text(
      `Total Weight: ${totalGrams.toFixed(2)} g   |   Grand Total: AED ${grandTotal.toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
      40, y + 14, { align: "right", width: W },
    );

  pdf.finish(y + 34);
});

// ---------------------------------------------------------------------------
// Statement export engine (PDF with Excel-sheet styling + true .xlsx export).
// Raw download routes, intentionally outside the OpenAPI spec.
// ---------------------------------------------------------------------------

const STMT_CAT_LABEL = STOCK_CATEGORY_LABEL;

interface StatementLedgerRow {
  sl: number;
  date: string;          // display date
  invoiceRef: string;    // sales: invoice number; purchases: ""
  type: "Purchase" | "Sale" | "Wholesale Sale" | "Wholesale Fix" | "Wholesale Return";
  party: string;
  category: string;      // bucket label
  itemName: string;      // exact custom item name (sales) / category (purchases)
  grams: number;
  kg: number;
  ratePerG: number;
  totalAed: number;
  costAed: number | null;   // sales only: exact FIFO purchase cost of this line
  profitAed: number | null; // sales only
  batchRefs: string | null; // sales only: consumed FIFO lots, e.g. "#19 (50g)"
}

interface StatementSaleSource {
  created_at: string;
  invoice_number: string;
  customer_name: string | null;
  description: string;
  bucket: string | null;
  grams: string;
  amount: string;
  exact_cogs: string | null;
  batch_refs: string | null;
  source: "retail" | "wholesale";
  event_kind: "retail_sale" | "wholesale_delivery" | "wholesale_fix" | "wholesale_return";
}

interface StatementCategoryBreakdownRow {
  category: string;
  label: string;
  purchasedGrams: number;
  soldGrams: number;
  remainingGrams: number;
}

function parseStatementQuery(req: { query: unknown }): { startDate: string | null; endDate: string | null; category: string | null } | { error: string } {
  const q = req.query as Record<string, string | undefined>;
  const rawStart = q.startDate?.trim() || null;
  const rawEnd = q.endDate?.trim() || null;
  // Strict calendar validation: YYYY-MM-DD shape AND a real calendar date
  // (rejects e.g. 2026-02-31, which round-trips to a different date).
  const isValidDate = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  if ((rawStart && !isValidDate(rawStart)) || (rawEnd && !isValidDate(rawEnd))) {
    return { error: "startDate/endDate must be a valid YYYY-MM-DD date" };
  }
  if (rawStart && rawEnd && rawStart > rawEnd) {
    return { error: "startDate must not be after endDate" };
  }
  const rawCategory = q.category?.trim() || null;
  if (rawCategory && rawCategory !== "all" && !(rawCategory in STMT_CAT_LABEL)) {
    return { error: "Invalid category" };
  }
  return { startDate: rawStart, endDate: rawEnd, category: rawCategory && rawCategory !== "all" ? rawCategory : null };
}

export async function loadStatementData(startDate: string | null, endDate: string | null, category: string | null) {
  const bucketExpr = sql`(CASE WHEN TRIM(ii.description) = '995' THEN '995'
        WHEN ii.category = 'gold_jewelry' THEN 'gold_jewelry_22k'
        ELSE ii.category END)`;

  const purchaseWhere = sql.join(
    [
      dashboardCategoryIsVisibleSql(sql`category`),
      ...(startDate ? [sql`purchase_date >= ${startDate}`] : []),
      ...(endDate ? [sql`purchase_date <= ${endDate}`] : []),
      ...(category ? [sql`category = ${category}`] : []),
    ],
    sql` AND `,
  );
  let endExclusive: string | null = null;
  if (endDate) {
    const d = new Date(`${endDate}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + 1);
      endExclusive = d.toISOString();
    }
  }
  const salesWhere = sql.join(
    [
      dashboardRetailInvoiceIsVisibleSql(sql`i.id`),
      dashboardCategoryIsVisibleSql(bucketExpr),
      ...(startDate ? [sql`i.created_at >= ${new Date(`${startDate}T00:00:00`).toISOString()}::timestamptz`] : []),
      ...(endExclusive ? [sql`i.created_at < ${endExclusive}::timestamptz`] : []),
      ...(category ? [sql`${bucketExpr} = ${category}`] : []),
    ],
    sql` AND `,
  );
  const wholesaleDeliveryWhere = sql.join(
    [
      dashboardWholesaleInvoiceIsVisibleSql(sql`wi.id`),
      dashboardCategoryIsVisibleSql(sql`wii.category`),
      ...(startDate ? [sql`wi.invoice_date >= ${startDate}`] : []),
      ...(endDate ? [sql`wi.invoice_date <= ${endDate}`] : []),
      ...(category ? [sql`wii.category = ${category}`] : []),
    ],
    sql` AND `,
  );
  const wholesaleFixWhere = sql.join(
    [
      dashboardWholesaleInvoiceIsVisibleSql(sql`wi.id`),
      dashboardCategoryIsVisibleSql(sql`wii.category`),
      ...(startDate ? [sql`ws.settlement_date >= ${startDate}`] : []),
      ...(endDate ? [sql`ws.settlement_date <= ${endDate}`] : []),
      ...(category ? [sql`wii.category = ${category}`] : []),
    ],
    sql` AND `,
  );
  const wholesaleReturnWhere = sql.join(
    [
      dashboardWholesaleInvoiceIsVisibleSql(sql`wi.id`),
      dashboardCategoryIsVisibleSql(sql`wii.category`),
      ...(startDate ? [sql`wr.return_date >= ${startDate}`] : []),
      ...(endDate ? [sql`wr.return_date <= ${endDate}`] : []),
      ...(category ? [sql`wii.category = ${category}`] : []),
    ],
    sql` AND `,
  );

  const [purchaseRows, retailSales, wholesaleSales, levelRows] = await Promise.all([
    db.execute<{ id: number; purchase_date: string; supplier_name: string; category: string; weight_grams: string; total_price_aed: string }>(sql`
      SELECT id, purchase_date, supplier_name, category, weight_grams::text, total_price_aed::text
      FROM stock_purchases
      WHERE ${purchaseWhere}
      ORDER BY purchase_date, id
    `).then((r) => r.rows),
    // Revenue basis matches the KPI and sales report: each item's amount is its
    // proportional share of the invoice's FINAL billed total (VAT/discount/
    // round-off included), so statement totals reconcile with the dashboard.
    db.execute<Omit<StatementSaleSource, "source">>(sql`
      SELECT i.created_at::text, i.invoice_number, i.customer_name, ii.description,
             ${bucketExpr} AS bucket,
             COALESCE(ii.gross_weight::numeric, 0)::text AS grams,
             (CASE WHEN s.sum_items > 0
                   THEN ii.total_price::numeric * i.total::numeric / s.sum_items
                   ELSE ii.total_price::numeric END)::text AS amount,
             c.exact_cogs::text AS exact_cogs,
             c.batch_refs,
             'retail_sale'::text AS event_kind
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      JOIN LATERAL (
        SELECT COALESCE(SUM(denominator_ii.total_price::numeric), 0) AS sum_items
        FROM invoice_items denominator_ii
        WHERE denominator_ii.invoice_id = i.id
          AND ${dashboardCategoryIsVisibleSql(sql`denominator_ii.category`)}
      ) s ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(cost_aed::numeric) AS exact_cogs,
               STRING_AGG(
                 CASE WHEN ic.purchase_id IS NOT NULL
                      THEN '#' || ic.purchase_id || ' (' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM ic.weight_grams::text)) || 'g)'
                      ELSE 'avg (' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM ic.weight_grams::text)) || 'g)'
                 END, ', ' ORDER BY ic.id) AS batch_refs
        FROM inventory_consumptions ic
        WHERE ic.invoice_item_id = ii.id
      ) c ON TRUE
      WHERE ${salesWhere}
      ORDER BY i.created_at, i.id
    `).then((r) => r.rows),
    db.execute<Omit<StatementSaleSource, "source">>(sql`
      SELECT *
      FROM (
        SELECT (wi.invoice_date || 'T00:00:00.000Z')::text AS created_at,
               wi.invoice_number,
               wi.trader_name AS customer_name,
               wii.description,
               wii.category AS bucket,
               wii.gross_grams::numeric::text AS grams,
               (CASE WHEN wi.pricing_type IN ('fixed', 'cash')
                     THEN wii.total_aed::numeric
                          + wii.returned_making_aed::numeric
                          + wii.returned_metal_aed::numeric
                     ELSE wii.making_aed::numeric END)::text AS amount,
               c.exact_cogs::text AS exact_cogs,
               c.batch_refs,
               'wholesale_delivery'::text AS event_kind
        FROM wholesale_invoice_items wii
        JOIN wholesale_invoices wi ON wi.id = wii.invoice_id
        LEFT JOIN LATERAL (
          SELECT SUM(wic.cost_aed::numeric) AS exact_cogs,
                 STRING_AGG(
                   CASE WHEN wic.purchase_id IS NOT NULL
                        THEN '#' || wic.purchase_id || ' (' ||
                             TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM wic.consumed_grams::text)) || 'g)'
                        ELSE 'shortfall (' ||
                             TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM wic.consumed_grams::text)) || 'g)'
                   END, ', ' ORDER BY wic.id
                 ) AS batch_refs
          FROM wholesale_inventory_consumptions wic
          WHERE wic.wholesale_item_id = wii.id
        ) c ON TRUE
        WHERE ${wholesaleDeliveryWhere}

        UNION ALL

        SELECT (ws.settlement_date || 'T00:00:00.000Z')::text AS created_at,
               wi.invoice_number,
               wi.trader_name AS customer_name,
               ('Rate fix: ' || wii.description)::text AS description,
               wii.category AS bucket,
               0::numeric::text AS grams,
               wsa.aed_amount::numeric::text AS amount,
               0::numeric::text AS exact_cogs,
               NULL::text AS batch_refs,
               'wholesale_fix'::text AS event_kind
        FROM wholesale_settlement_allocations wsa
        JOIN wholesale_settlements ws ON ws.id = wsa.settlement_id
        JOIN wholesale_invoice_items wii ON wii.id = wsa.invoice_item_id
        JOIN wholesale_invoices wi ON wi.id = ws.invoice_id
        WHERE ${wholesaleFixWhere}

        UNION ALL

        SELECT (wr.return_date || 'T00:00:00.000Z')::text AS created_at,
               wi.invoice_number,
               wi.trader_name AS customer_name,
               ('Return ' || wr.return_number || ': ' || wii.description)::text AS description,
               wii.category AS bucket,
               (-wrl.gross_weight_grams::numeric)::text AS grams,
               (-wrl.returned_aed::numeric)::text AS amount,
               (-wrl.returned_cogs_aed::numeric)::text AS exact_cogs,
               NULL::text AS batch_refs,
               'wholesale_return'::text AS event_kind
        FROM wholesale_return_lines wrl
        JOIN wholesale_returns wr ON wr.id = wrl.return_id
        JOIN wholesale_invoice_items wii ON wii.id = wrl.invoice_item_id
        JOIN wholesale_invoices wi ON wi.id = wr.invoice_id
        WHERE ${wholesaleReturnWhere}
      ) wholesale_events
      ORDER BY created_at, invoice_number, description
    `).then((r) => r.rows),
    db.execute<{ category: string; weight_grams: string }>(sql`
      SELECT category, weight_grams::text
      FROM stock_levels
      WHERE ${dashboardCategoryIsVisibleSql(sql`category`)}
      ORDER BY category
    `).then((r) => r.rows),
  ]);
  const purchases = purchaseRows.filter((row) => isDashboardInventoryCategory(row.category));
  const levels = levelRows.filter((row) => isDashboardInventoryCategory(row.category));
  const sales: StatementSaleSource[] = [
    ...retailSales.map((row) => ({ ...row, source: "retail" as const })),
    ...wholesaleSales.map((row) => ({ ...row, source: "wholesale" as const })),
  ].filter((row) => isDashboardInventoryCategory(row.bucket ?? "custom"));

  const totalPurchaseAed = purchases.reduce((s, p) => s + Number(p.total_price_aed), 0);
  const totalSalesAed = sales.reduce((s, r) => s + Number(r.amount), 0);
  // Profit basis: exact FIFO batch COGS recorded by the inventory engine at
  // sale time. Items with no consumption rows (custom/non-stock items) fall
  // back to the category weighted-average cost, matching prior behavior.
  const avgCost = new Map<string, number>();
  const allPurch = await db.execute<{ category: string; g: string; aed: string }>(sql`
    SELECT category, SUM(weight_grams::numeric)::text AS g, SUM(total_price_aed::numeric)::text AS aed
    FROM stock_purchases
    WHERE ${dashboardCategoryIsVisibleSql(sql`category`)}
    GROUP BY category
  `).then((r) => r.rows);
  for (const p of allPurch) {
    const g = Number(p.g);
    avgCost.set(p.category, g > 0 ? Number(p.aed) / g : 0);
  }
  const itemCogs = (r: { exact_cogs: string | null; grams: string; bucket: string | null }) =>
    r.exact_cogs != null ? Number(r.exact_cogs) : Number(r.grams) * (avgCost.get(r.bucket ?? "") ?? 0);
  const cogs = sales.reduce((s, r) => s + itemCogs(r), 0);
  const profit = totalSalesAed - cogs;

  // Category-wise metal ledger. Purchased/sold columns honor the active
  // statement period; remaining is the current physical vault balance, matching
  // the existing statement's live-stock semantics.
  const purchasedByCategory = new Map<string, number>();
  for (const row of purchases) {
    purchasedByCategory.set(
      row.category,
      (purchasedByCategory.get(row.category) ?? 0) + Number(row.weight_grams),
    );
  }
  const soldByCategory = new Map<string, number>();
  for (const row of sales) {
    const bucket = row.bucket ?? "custom";
    soldByCategory.set(bucket, (soldByCategory.get(bucket) ?? 0) + Number(row.grams));
  }
  const remainingByCategory = new Map(levels.map((row) => [row.category, Number(row.weight_grams)]));
  const standardCategoryOrder = Object.keys(STMT_CAT_LABEL);
  const categoryKeys = category
    ? [category]
    : [...new Set([
        ...standardCategoryOrder,
        ...purchasedByCategory.keys(),
        ...soldByCategory.keys(),
        ...remainingByCategory.keys(),
      ])].filter(isDashboardInventoryCategory).sort((a, b) => {
        const ai = standardCategoryOrder.indexOf(a);
        const bi = standardCategoryOrder.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
  const categoryBreakdown: StatementCategoryBreakdownRow[] = categoryKeys.map((key) => ({
    category: key,
    label: STMT_CAT_LABEL[key] ?? (key === "custom" ? "Custom" : key),
    purchasedGrams: purchasedByCategory.get(key) ?? 0,
    soldGrams: soldByCategory.get(key) ?? 0,
    remainingGrams: remainingByCategory.get(key) ?? 0,
  }));

  // Unified excel-style ledger: purchases + sales in one table, chronological.
  const ledger: StatementLedgerRow[] = [];
  for (const p of purchases) {
    const grams = Number(p.weight_grams);
    const total = Number(p.total_price_aed);
    ledger.push({
      sl: 0,
      date: p.purchase_date,
      invoiceRef: "",
      type: "Purchase",
      party: p.supplier_name,
      category: STMT_CAT_LABEL[p.category] ?? p.category,
      itemName: STMT_CAT_LABEL[p.category] ?? p.category,
      grams,
      kg: grams / 1000,
      ratePerG: grams > 0 ? total / grams : 0,
      totalAed: total,
      costAed: null,
      profitAed: null,
      batchRefs: null,
    });
  }
  for (const s of sales) {
    const grams = Number(s.grams);
    const total = Number(s.amount);
    ledger.push({
      sl: 0,
      date: s.created_at.slice(0, 10),
      invoiceRef: s.invoice_number,
      type: s.event_kind === "wholesale_fix"
        ? "Wholesale Fix"
        : s.event_kind === "wholesale_return"
          ? "Wholesale Return"
          : s.source === "wholesale"
            ? "Wholesale Sale"
            : "Sale",
      party: s.customer_name ?? "Walk-in",
      category: s.bucket && STMT_CAT_LABEL[s.bucket] ? STMT_CAT_LABEL[s.bucket] : "Custom",
      itemName: s.source === "wholesale"
        ? `[Wholesale] ${s.description.trim()}`
        : s.description.trim(),
      grams,
      kg: grams / 1000,
      ratePerG: grams > 0 ? total / grams : 0,
      totalAed: total,
      costAed: itemCogs(s),
      profitAed: total - itemCogs(s),
      batchRefs: s.batch_refs,
    });
  }
  // Purchases before sales on the same date.
  ledger.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === "Purchase" ? -1 : 1));
  ledger.forEach((r, i) => { r.sl = i + 1; });

  // Live per-batch remaining stock (all-time snapshot, category-filterable):
  // one row per purchase lot that still has weight left.
  const liveBatches = await db.execute<{
    id: number; category: string; purchase_date: string; supplier_name: string;
    weight_grams: string; remaining_weight_grams: string; total_price_aed: string;
  }>(sql`
    SELECT id, category, purchase_date, supplier_name, weight_grams::text,
           remaining_weight_grams::text, total_price_aed::text
    FROM stock_purchases
    WHERE remaining_weight_grams::numeric > 0
      AND ${dashboardCategoryIsVisibleSql(sql`category`)}
      ${category ? sql`AND category = ${category}` : sql``}
    ORDER BY category, purchase_date, id
  `).then((r) => r.rows.map((b) => {
    const purchased = Number(b.weight_grams);
    const remaining = Number(b.remaining_weight_grams);
    const ratePerG = purchased > 0 ? Number(b.total_price_aed) / purchased : 0;
    return {
      id: b.id,
      category: b.category,
      purchaseDate: b.purchase_date,
      supplier: b.supplier_name,
      purchasedGrams: purchased,
      soldGrams: purchased - remaining,
      remainingGrams: remaining,
      ratePerG,
      costValueAed: remaining * ratePerG,
    };
  }));

  const totals = {
    grams: ledger.reduce((s, r) => s + r.grams, 0),
    kg: ledger.reduce((s, r) => s + r.kg, 0),
    soldGrams: ledger.reduce((s, r) => s + (r.type === "Purchase" ? 0 : r.grams), 0),
    revenueAed: totalSalesAed,
    cogsAed: cogs,
    profitAed: profit,
  };

  return {
    purchases, sales, levels, ledger, liveBatches, totals, totalPurchaseAed,
    totalSalesAed, cogs, profit, categoryBreakdown,
  };
}

// /api/dashboard/statement-pdf?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&category=<bucket|all>
// A4 statement styled like an Excel worksheet (gridlines, zebra rows, summary row).
router.get("/dashboard/statement-pdf", requireAdmin, async (req, res): Promise<void> => {
  const parsed = parseStatementQuery(req);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { startDate, endDate, category } = parsed;
  const { purchases, ledger, totals, totalPurchaseAed, totalSalesAed, cogs, profit, categoryBreakdown } =
    await loadStatementData(startDate, endDate, category);
  const catLabel = STMT_CAT_LABEL;

  const now = new Date();
  const pdf = createBrandedPdf({
    title: "Stock & Profit Statement",
    layout: "landscape",
    generatedAt: now,
  });
  const { doc } = pdf;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="hazari-gold-statement.pdf"`);
  doc.pipe(res);

  const NAVY = PDF_BRAND.navy;
  const HEADER_BG = "#1e293b"; // excel header row
  const GRID = "#d1d5db";      // excel gridlines
  const ZEBRA = "#f8fafc";     // alternating rows
  const GOLD = PDF_BRAND.gold;
  const LIGHT = "#f5f3ee";
  const W = pdf.width;

  const criteria = [
    startDate || endDate ? `Period: ${startDate ?? "…"} to ${endDate ?? "…"}` : "Period: All time",
    `Category: ${category ? (catLabel[category] ?? category) : "All"}`,
  ].join("   ·   ");
  doc.rect(40, pdf.contentTop, W, 30).fill(LIGHT);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(criteria, 52, pdf.contentTop + 10);

  let y = pdf.contentTop + 45;
  const ensureSpace = (h: number) => {
    y = pdf.ensureSpace(y, h);
  };
  const sectionHeader = (title: string) => {
    ensureSpace(40);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(title, 40, y);
    y += 18;
  };

  // Excel-worksheet cell renderers: light gray gridlines on every cell,
  // dark navy header row, zebra striping.
  const num2 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num3 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  // When a page break happens mid-table, redraw the table's header row on the
  // new page so every page of the ledger stays readable.
  let activeTableHeader: [string, number, boolean?][] | null = null;
  const drawCells = (
    cells: [string, number, boolean?][],
    opts: { bg: string; color: string; bold: boolean; h: number },
  ) => {
    if (y + opts.h + 1 > pdf.contentBottom) {
      y = pdf.addPage();
      if (activeTableHeader && cells !== activeTableHeader) {
        drawCells(activeTableHeader, { bg: HEADER_BG, color: "white", bold: true, h: 18 });
      }
    }
    let x = 40;
    doc.lineWidth(0.5);
    for (const [text, width, right] of cells) {
      doc.rect(x, y, width, opts.h).fillAndStroke(opts.bg, GRID);
      doc.fillColor(opts.color).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
      doc.text(text, x + 4, y + (opts.h - 8) / 2, { width: width - 8, align: right ? "right" : "left", lineBreak: false });
      x += width;
    }
    y += opts.h;
  };
  const gridHeader = (cells: [string, number, boolean?][]) => {
    // Keep the header attached to at least one data row.
    if (y + 18 + 17 > pdf.contentBottom) y = pdf.addPage();
    activeTableHeader = cells;
    drawCells(cells, { bg: HEADER_BG, color: "white", bold: true, h: 18 });
  };
  let zebraIdx = 0;
  const gridRow = (cells: [string, number, boolean?][], opts?: { bold?: boolean; bg?: string }) =>
    drawCells(cells, {
      bg: opts?.bg ?? (zebraIdx++ % 2 === 0 ? "white" : ZEBRA),
      color: "#1a1a1a",
      bold: opts?.bold ?? false,
      h: 16,
    });

  // ===== SECTION 1: PURCHASES & PRODUCT LISTING =====
  // Column widths per table sum to exactly 762 (A4 landscape minus margins).
  const totalPurchGrams = purchases.reduce((sum, p) => sum + Number(p.weight_grams), 0);
  sectionHeader("1. Purchases & Product Listing");
  if (purchases.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(9).text("No purchases in this period.", 40, y); y += 20;
  } else {
    gridHeader([
      ["Date", 70], ["Ref / Batch", 80], ["Supplier", 150], ["Category", 140],
      ["Weight (g)", 100, true], ["Purchase Rate (AED/g)", 100, true], ["Cash Outflow (AED)", 122, true],
    ]);
    purchases.forEach((p) => {
      const grams = Number(p.weight_grams);
      const total = Number(p.total_price_aed);
      gridRow([
        [p.purchase_date, 70],
        [`#BATCH-${p.id}`, 80],
        [p.supplier_name.substring(0, 32), 150],
        [(catLabel[p.category] ?? p.category).substring(0, 30), 140],
        [num3(grams), 100, true],
        [num2(grams > 0 ? total / grams : 0), 100, true],
        [num2(total), 122, true],
      ]);
    });
    gridRow([
      ["TOTAL PURCHASED WEIGHT & TOTAL SPENT", 440],
      [`${num3(totalPurchGrams)} g  (${(totalPurchGrams / 1000).toFixed(3)} kg)`, 100, true],
      ["", 100],
      [`AED ${num2(totalPurchaseAed)}`, 122, true],
    ], { bold: true, bg: "#e2e8f0" });
    y += 14;
  }

  // ===== SECTION 2: SALES INVOICES =====
  const saleRows = ledger.filter((r) => r.type !== "Purchase");
  sectionHeader("2. Sales Invoices");
  if (saleRows.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(9).text("No sales in this period.", 40, y); y += 20;
  } else {
    gridHeader([
      ["Date", 70], ["Invoice Ref", 80], ["Customer", 150], ["Category", 140],
      ["Sold Weight (g)", 100, true], ["Selling Rate (AED/g)", 100, true], ["Cash Inflow (AED)", 122, true],
    ]);
    saleRows.forEach((r) => {
      const itemCat = r.itemName === r.category ? r.itemName : `${r.itemName} (${r.category})`;
      gridRow([
        [r.date, 70],
        [r.invoiceRef || "-", 80],
        [r.party.substring(0, 32), 150],
        [itemCat.substring(0, 30), 140],
        [num3(r.grams), 100, true],
        [num2(r.ratePerG), 100, true],
        [num2(r.totalAed), 122, true],
      ]);
    });
    gridRow([
      ["TOTAL SOLD WEIGHT & TOTAL SALES REVENUE", 440],
      [`${num3(totals.soldGrams)} g  (${(totals.soldGrams / 1000).toFixed(3)} kg)`, 100, true],
      ["", 100],
      [`AED ${num2(totalSalesAed)}`, 122, true],
    ], { bold: true, bg: "#e2e8f0" });
    y += 14;
  }

  // ===== SECTION 3: CATEGORY-WISE VAULT BREAKDOWN =====
  sectionHeader("3. Category-wise Vault Breakdown");
  gridHeader([
    ["Category Name", 220],
    ["Metal Purchased / In (Debit g)", 180, true],
    ["Metal Sold / Out (Credit g)", 180, true],
    ["Net Remaining Vault Balance (g)", 182, true],
  ]);
  categoryBreakdown.forEach((row) => {
    gridRow([
      [row.label, 220],
      [num3(row.purchasedGrams), 180, true],
      [num3(row.soldGrams), 180, true],
      [num3(row.remainingGrams), 182, true],
    ]);
  });
  const categoryPurchasedTotal = categoryBreakdown.reduce((sum, row) => sum + row.purchasedGrams, 0);
  const categorySoldTotal = categoryBreakdown.reduce((sum, row) => sum + row.soldGrams, 0);
  const liveMetalG = categoryBreakdown.reduce((sum, row) => sum + row.remainingGrams, 0);
  gridRow([
    ["TOTAL PHYSICAL METAL", 220],
    [num3(categoryPurchasedTotal), 180, true],
    [num3(categorySoldTotal), 180, true],
    [num3(liveMetalG), 182, true],
  ], { bold: true, bg: "#eee6cf" });
  activeTableHeader = null;
  y += 6;
  doc.fillColor("#666").font("Helvetica").fontSize(7)
    .text("Purchased and sold columns follow the selected period. Remaining vault balance is the current live physical stock.", 40, y, { width: W });
  y += 18;

  // ===== SECTION 4: PROFIT & REMAINING STOCK SUMMARY BOX =====
  const summaryLines: [string, string, boolean][] = [
    ["Total Sold Weight:", `${num3(totals.soldGrams)} g`, false],
    ["Total Cash Outflow - Purchases Debit:", `AED ${num2(totalPurchaseAed)}`, false],
    ["Total Cash Inflow - Sales Revenue Credit:", `AED ${num2(totalSalesAed)}`, false],
    ["Purchase Cost of Goods Sold (COGS):", `AED ${num2(cogs)}`, false],
    ["OVERALL NET REALIZED PROFIT:", `${profit >= 0 ? "+" : "-"}AED ${num2(Math.abs(profit))}`, true],
    ["TOTAL PHYSICAL METAL REMAINING:", `${num3(liveMetalG)} g  (${(liveMetalG / 1000).toFixed(3)} kg)`, true],
  ];
  const boxRowH = 22;
  const boxH = 34 + summaryLines.length * boxRowH + 10;
  ensureSpace(boxH + 28);
  doc.rect(40, y, W, boxH).fillAndStroke("#fdf9ee", GOLD);
  doc.rect(40, y, W, 26).fill(NAVY);
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(11).text("4. Financial Debit / Credit & Profit Summary", 52, y + 8);
  let ly = y + 34;
  summaryLines.forEach(([label, val, strong]) => {
    if (strong) {
      doc.rect(46, ly - 3, W - 12, boxRowH - 2).fill(label.startsWith("OVERALL NET") ? (profit >= 0 ? "#e7f5ec" : "#fdecec") : "#eef2f7");
    }
    doc.fillColor(strong ? NAVY : "#444").font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 11 : 10)
      .text(label, 56, ly, { width: W * 0.6, lineBreak: false });
    doc.fillColor(strong && label.startsWith("OVERALL NET") ? (profit >= 0 ? "#1c7a3d" : "#b3261e") : NAVY)
      .font("Helvetica-Bold").fontSize(strong ? 12 : 10)
      .text(val, 40, ly, { width: W - 56, align: "right" });
    ly += boxRowH;
  });
  y = y + boxH + 8;
  doc.fillColor("#666").font("Helvetica").fontSize(7)
    .text("Profit = Sales revenue minus exact FIFO cost of sold items (consumed purchase batches, oldest first). Remaining stock is the live balance.", 40, y, { width: W });
  y += 18;

  pdf.finish(y);
});

// /api/dashboard/statement-xlsx?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&category=<bucket|all>
// True .xlsx export of the same statement data (exceljs).
router.get("/dashboard/statement-xlsx", requireAdmin, async (req, res): Promise<void> => {
  const parsed = parseStatementQuery(req);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const { startDate, endDate, category } = parsed;
  const { ledger, liveBatches, totals, totalPurchaseAed, totalSalesAed, cogs, profit, categoryBreakdown } =
    await loadStatementData(startDate, endDate, category);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Hazari Gold L.L.C";
  const ws = wb.addWorksheet("Statement");

  const thin = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
  const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

  // Title / criteria
  ws.mergeCells("A1:K1");
  ws.getCell("A1").value = "Hazari Gold L.L.C — Stock & Profit Statement";
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1E3A5F" } };
  ws.mergeCells("A2:K2");
  ws.getCell("A2").value = [
    startDate || endDate ? `Period: ${startDate ?? "…"} to ${endDate ?? "…"}` : "Period: All time",
    `Category: ${category ? (STMT_CAT_LABEL[category] ?? category) : "All"}`,
    `Generated: ${new Date().toLocaleString("en-AE")}`,
  ].join("   ·   ");
  ws.getCell("A2").font = { size: 9, color: { argb: "FF64748B" } };

  ws.columns = [
    { width: 5 }, { width: 12 }, { width: 16 }, { width: 22 }, { width: 22 },
    { width: 26 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 18 },
    { width: 30 },
  ];

  const styleHeader = (row: ExcelJS.Row) => row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.border = allBorders;
    cell.alignment = { vertical: "middle" };
  });
  const styleTotal = (row: ExcelJS.Row, argb: string) => row.eachCell((cell) => {
    cell.border = allBorders;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  });
  const sectionTitle = (title: string) => {
    ws.addRow([]);
    const r = ws.addRow([title]);
    r.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1E3A5F" } };
    return r;
  };

  // ===== SECTION 1: PURCHASES =====
  sectionTitle("SECTION 1: PURCHASES");
  styleHeader(ws.addRow(["SL", "Date", "Supplier", "Category", "Weight (g)", "Rate (AED/g)", "Total Cost (AED)"]));
  const purchaseRows = ledger.filter((r) => r.type === "Purchase");
  for (const [i, r] of purchaseRows.entries()) {
    const row = ws.addRow([i + 1, r.date, r.party, r.category, r.grams, r.ratePerG, r.totalAed]);
    row.eachCell((cell, col) => {
      cell.border = allBorders;
      if (col === 5) cell.numFmt = "#,##0.000";
      if (col === 6 || col === 7) cell.numFmt = "#,##0.00";
    });
  }
  const p1 = ws.addRow(["", "", "", "TOTAL PURCHASES", purchaseRows.reduce((s, r) => s + r.grams, 0), "", purchaseRows.reduce((s, r) => s + r.totalAed, 0)]);
  styleTotal(p1, "FFE2E8F0");
  p1.getCell(5).numFmt = "#,##0.000";
  p1.getCell(7).numFmt = "#,##0.00";

  // ===== SECTION 2: SALES & PROFIT =====
  sectionTitle("SECTION 2: SALES & PROFIT");
  styleHeader(ws.addRow(["SL", "Date", "Invoice", "Customer", "Item Name", "Category", "Sold Wt (g)", "Purchase Cost (AED)", "Sale Value (AED)", "Profit / Loss (AED)", "Consumed Batch"]));
  const saleRows = ledger.filter((r) => r.type !== "Purchase");
  for (const [i, r] of saleRows.entries()) {
    const row = ws.addRow([
      i + 1, r.date, r.invoiceRef || "-", r.party, r.itemName, r.category, r.grams,
      r.costAed ?? "-", r.totalAed, r.profitAed ?? "-", r.batchRefs ?? "-",
    ]);
    row.eachCell((cell, col) => {
      cell.border = allBorders;
      if (col === 7) cell.numFmt = "#,##0.000";
      if (col >= 8 && col <= 10 && typeof cell.value === "number") cell.numFmt = "#,##0.00";
      if (col >= 7 && col <= 10 && typeof cell.value !== "number") cell.alignment = { horizontal: "right" };
    });
  }
  const salesTotals: [string, number, string, string][] = [
    ["Total Sold Weight (g)", totals.soldGrams, "#,##0.000", "FFE2E8F0"],
    ["Purchase Cost of Sold - COGS (AED)", totals.cogsAed, "#,##0.00", "FFFDF6E3"],
    ["Total Revenue Received (AED)", totals.revenueAed, "#,##0.00", "FFE2E8F0"],
    ["Total Net Profit Earned (AED)", totals.profitAed, "#,##0.00", "FFE7F5EC"],
  ];
  for (const [label, val, fmt, argb] of salesTotals) {
    const row = ws.addRow(["", "", "", "", "", "", "", "", "", label, val]);
    styleTotal(row, argb);
    row.getCell(11).numFmt = fmt;
  }

  // ===== SECTION 3: CATEGORY-WISE VAULT BREAKDOWN =====
  sectionTitle("SECTION 3: CATEGORY-WISE VAULT BREAKDOWN");
  styleHeader(ws.addRow([
    "Category Name",
    "Metal Purchased / In (Debit g)",
    "Metal Sold / Out (Credit g)",
    "Net Remaining Vault Balance (g)",
  ]));
  for (const breakdown of categoryBreakdown) {
    const row = ws.addRow([
      breakdown.label,
      breakdown.purchasedGrams,
      breakdown.soldGrams,
      breakdown.remainingGrams,
    ]);
    row.eachCell((cell, col) => {
      cell.border = allBorders;
      if (col >= 2 && col <= 4) cell.numFmt = "#,##0.000";
    });
  }
  const categoryPurchasedTotal = categoryBreakdown.reduce((sum, row) => sum + row.purchasedGrams, 0);
  const categorySoldTotal = categoryBreakdown.reduce((sum, row) => sum + row.soldGrams, 0);
  const categoryRemainingTotal = categoryBreakdown.reduce((sum, row) => sum + row.remainingGrams, 0);
  const categoryTotalRow = ws.addRow([
    "TOTAL PHYSICAL METAL",
    categoryPurchasedTotal,
    categorySoldTotal,
    categoryRemainingTotal,
  ]);
  styleTotal(categoryTotalRow, "FFEEE6CF");
  [2, 3, 4].forEach((col) => { categoryTotalRow.getCell(col).numFmt = "#,##0.000"; });
  const categoryNote = ws.addRow([
    "Purchased and sold columns follow the selected period. Remaining vault balance is the current live physical stock.",
  ]);
  categoryNote.getCell(1).font = { italic: true, size: 9, color: { argb: "FF64748B" } };

  // ===== SECTION 4: REMAINING STOCK - LIVE =====
  sectionTitle("SECTION 4: REMAINING STOCK - LIVE (Unsold Batches)");
  styleHeader(ws.addRow(["SL", "Category", "Batch ID", "Purchase Date", "Supplier", "Purchased Wt (g)", "Sold Wt (g)", "Remaining Wt (g)", "Rate (AED/g)", "Cost Value (AED)"]));
  for (const [i, b] of liveBatches.entries()) {
    const row = ws.addRow([
      i + 1, STMT_CAT_LABEL[b.category] ?? b.category, `#BATCH-${b.id}`, b.purchaseDate, b.supplier,
      b.purchasedGrams, b.soldGrams, b.remainingGrams, b.ratePerG, b.costValueAed,
    ]);
    row.eachCell((cell, col) => {
      cell.border = allBorders;
      if (col >= 6 && col <= 8) cell.numFmt = "#,##0.000";
      if (col === 9 || col === 10) cell.numFmt = "#,##0.00";
    });
  }
  const remG = liveBatches.reduce((s, b) => s + b.remainingGrams, 0);
  const remAed = liveBatches.reduce((s, b) => s + b.costValueAed, 0);
  const s3 = ws.addRow(["", "", "", "", "TOTAL LIVE REMAINING STOCK", "", "", remG, "", remAed]);
  styleTotal(s3, "FFEEF2F7");
  s3.getCell(8).numFmt = "#,##0.000";
  s3.getCell(10).numFmt = "#,##0.00";

  // Summary sheet: mirrors the PDF financial debit/credit summary and category
  // vault table so both statement formats reconcile from the same projection.
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 42 }, { width: 26 }, { width: 26 }, { width: 32 }];
  const financialHeader = sum.addRow(["Financial Debit / Credit & Profit Summary", "Amount"]);
  financialHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.border = allBorders;
  });
  const sumRows: [string, number, string][] = [
    ["Total Cash Outflow - Purchases Debit (AED)", totalPurchaseAed, "#,##0.00"],
    ["Total Cash Inflow - Sales Revenue Credit (AED)", totalSalesAed, "#,##0.00"],
    ["Purchase Cost of Goods Sold - COGS (AED)", cogs, "#,##0.00"],
    ["Overall Net Realized Profit (AED)", profit, "#,##0.00"],
    ["Total Physical Metal Remaining (g)", categoryRemainingTotal, "#,##0.000"],
  ];
  for (const [label, val, fmt] of sumRows) {
    const row = sum.addRow([label, val]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).numFmt = fmt;
    row.eachCell((cell) => { cell.border = allBorders; });
  }
  sum.addRow([]);
  const lvlHeader = sum.addRow([
    "Category Name",
    "Metal Purchased / In (Debit g)",
    "Metal Sold / Out (Credit g)",
    "Net Remaining Vault Balance (g)",
  ]);
  lvlHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.border = allBorders;
  });
  for (const breakdown of categoryBreakdown) {
    const row = sum.addRow([
      breakdown.label,
      breakdown.purchasedGrams,
      breakdown.soldGrams,
      breakdown.remainingGrams,
    ]);
    [2, 3, 4].forEach((col) => { row.getCell(col).numFmt = "#,##0.000"; });
    row.eachCell((cell) => { cell.border = allBorders; });
  }
  const summaryCategoryTotal = sum.addRow([
    "TOTAL PHYSICAL METAL",
    categoryPurchasedTotal,
    categorySoldTotal,
    categoryRemainingTotal,
  ]);
  styleTotal(summaryCategoryTotal, "FFEEE6CF");
  [2, 3, 4].forEach((col) => { summaryCategoryTotal.getCell(col).numFmt = "#,##0.000"; });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="hazari-gold-statement.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

interface DashboardAccountLedgerEntry {
  date: string;
  ref: string;
  title: string;
  narrative: string | null;
  cashDebit: number;
  cashCredit: number;
  metalDebit: number;
  metalCredit: number;
}

export async function loadDashboardAccountLedgerData(args: {
  party: string | null;
  startDate: string | null;
  endDate: string | null;
}): Promise<{
  openCash: number;
  openMetal: number;
  entries: DashboardAccountLedgerEntry[];
}> {
  const { party, startDate, endDate } = args;
  const purchWhere = sql.join([
    dashboardCategoryIsVisibleSql(sql`category`),
    ...(party ? [sql`supplier_name ILIKE ${party}`] : []),
    ...(startDate ? [sql`purchase_date >= ${startDate}`] : []),
    ...(endDate ? [sql`purchase_date <= ${endDate}`] : []),
  ], sql` AND `);
  let endExclusive: string | null = null;
  if (endDate) {
    const d = new Date(`${endDate}T00:00:00`);
    d.setDate(d.getDate() + 1);
    endExclusive = d.toISOString();
  }
  const salesWhere = sql.join([
    dashboardRetailInvoiceIsVisibleSql(sql`i.id`),
    ...(party ? [sql`i.customer_name ILIKE ${party}`] : []),
    ...(startDate ? [sql`i.created_at >= ${new Date(`${startDate}T00:00:00`).toISOString()}::timestamptz`] : []),
    ...(endExclusive ? [sql`i.created_at < ${endExclusive}::timestamptz`] : []),
  ], sql` AND `);

  // Opening balances: cumulative party-scoped postings strictly before startDate,
  // so a date-filtered statement starts from the account's true running balance.
  let openCash = 0;
  let openMetal = 0;
  if (startDate) {
    const [op, os] = await Promise.all([
      db.execute<{ aed: string; g: string }>(sql`
        SELECT COALESCE(SUM(total_price_aed::numeric), 0)::text AS aed,
               COALESCE(SUM(weight_grams::numeric), 0)::text AS g
        FROM stock_purchases
        WHERE purchase_date < ${startDate}
          AND ${dashboardCategoryIsVisibleSql(sql`category`)}
          ${party ? sql`AND supplier_name ILIKE ${party}` : sql``}
      `).then((r) => r.rows[0]),
      db.execute<{ aed: string; g: string }>(sql`
        SELECT COALESCE(SUM(i.total::numeric), 0)::text AS aed,
               COALESCE(SUM(s.g), 0)::text AS g
        FROM invoices i
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(COALESCE(gross_weight::numeric, 0)), 0) AS g
          FROM invoice_items opening_ii
          WHERE opening_ii.invoice_id = i.id
            AND ${dashboardCategoryIsVisibleSql(sql`opening_ii.category`)}
        ) s ON TRUE
        WHERE i.created_at < ${new Date(`${startDate}T00:00:00`).toISOString()}::timestamptz
          AND ${dashboardRetailInvoiceIsVisibleSql(sql`i.id`)}
          ${party ? sql`AND i.customer_name ILIKE ${party}` : sql``}
      `).then((r) => r.rows[0]),
    ]);
    openCash = Number(os.aed) - Number(op.aed);   // credits - debits
    openMetal = Number(op.g) - Number(os.g);      // metal credits - metal debits
  }

  const [purchases, invoices] = await Promise.all([
    db.execute<{ id: number; purchase_date: string; supplier_name: string; category: string; weight_grams: string; total_price_aed: string; narrative: string | null }>(sql`
      SELECT id, purchase_date, supplier_name, category, weight_grams::text, total_price_aed::text, narrative
      FROM stock_purchases WHERE ${purchWhere} ORDER BY purchase_date, id
    `).then((r) => r.rows),
    db.execute<{ id: number; created_at: string; invoice_number: string; customer_name: string | null; total: string; grams: string; items_desc: string | null }>(sql`
      SELECT i.id, i.created_at::text, i.invoice_number, i.customer_name, i.total::text,
             COALESCE(s.grams, '0') AS grams, s.items_desc
      FROM invoices i
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(gross_weight::numeric, 0))::text AS grams,
               STRING_AGG(DISTINCT TRIM(description), ', ') AS items_desc
        FROM invoice_items current_ii
        WHERE current_ii.invoice_id = i.id
          AND ${dashboardCategoryIsVisibleSql(sql`current_ii.category`)}
      ) s ON TRUE
      WHERE ${salesWhere} ORDER BY i.created_at, i.id
    `).then((r) => r.rows),
  ]);

  const entries: DashboardAccountLedgerEntry[] = [
    ...purchases.map((p) => ({
      date: p.purchase_date,
      ref: `#BATCH-${p.id}`,
      title: `Stock Purchase - ${STMT_CAT_LABEL[p.category] ?? p.category} (${p.supplier_name})`,
      narrative: p.narrative,
      cashDebit: Number(p.total_price_aed), cashCredit: 0,
      metalDebit: 0, metalCredit: Number(p.weight_grams),
    })),
    ...invoices.map((i) => ({
      date: i.created_at.slice(0, 10),
      ref: i.invoice_number,
      title: `Sale - ${i.customer_name ?? "Walk-in"}`,
      narrative: i.items_desc,
      cashDebit: 0, cashCredit: Number(i.total),
      metalDebit: Number(i.grams), metalCredit: 0,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.cashDebit > 0 ? -1 : 1));

  return { openCash, openMetal, entries };
}

// /api/dashboard/ledger-pdf?party=<name|all>&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// Dual-ledger account statement: every purchase posts Cash Debit + Metal Credit,
// every sale posts Cash Credit + Metal Debit, with running balances for both.
router.get("/dashboard/ledger-pdf", requireAdmin, async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const party = q.party?.trim() && q.party.trim().toLowerCase() !== "all" ? q.party.trim() : null;
  const startDate = q.startDate?.trim() || null;
  const endDate = q.endDate?.trim() || null;
  const isValidDate = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  if ((startDate && !isValidDate(startDate)) || (endDate && !isValidDate(endDate))) {
    res.status(400).json({ error: "startDate/endDate must be a valid YYYY-MM-DD date" });
    return;
  }

  const { openCash, openMetal, entries } = await loadDashboardAccountLedgerData({
    party,
    startDate,
    endDate,
  });

  const now = new Date();
  const pdf = createBrandedPdf({
    title: "Gold & Silver Account Ledger Statement",
    layout: "landscape",
    generatedAt: now,
  });
  const { doc } = pdf;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="hazari-gold-account-ledger.pdf"`);
  doc.pipe(res);

  const NAVY = PDF_BRAND.navy;
  const HEADER_BG = "#1e293b";
  const GRID = "#d1d5db";
  const ZEBRA = "#f8fafc";
  const GOLD = PDF_BRAND.gold;
  const LIGHT = "#f5f3ee";
  const W = pdf.width;
  const num2 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num3 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const bal2 = (n: number) => `${num2(Math.abs(n))} ${n >= 0 ? "CR" : "DR"}`;
  const bal3 = (n: number) => `${num3(Math.abs(n))} ${n >= 0 ? "CR" : "DR"}`;

  const criteria = [
    `Account / Party: ${party ?? "All Parties"}`,
    startDate || endDate ? `Period: ${startDate ?? "…"} to ${endDate ?? "…"}` : "Period: All time",
  ].join("   ·   ");
  doc.rect(40, pdf.contentTop, W, 28).fill(LIGHT);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(criteria, 52, pdf.contentTop + 9);

  let y = pdf.contentTop + 43;
  // Column layout (sums to 762): Date 54, Ref 60, Type&Narrative 180,
  // Cash Debit 76, Cash Credit 76, Cash Balance 94, Metal Debit 66,
  // Metal Credit 66, Metal Balance 90.
  const COLS: [string, number, boolean?][] = [
    ["Date", 54], ["Ref / Voucher", 60], ["Type & Narrative", 180],
    ["Cash Debit (AED)", 76, true], ["Cash Credit (AED)", 76, true], ["Cash Balance (AED)", 94, true],
    ["Metal Debit (g)", 66, true], ["Metal Credit (g)", 66, true], ["Metal Balance (g)", 90, true],
  ];
  const drawRow = (
    cells: [string, number, boolean?][],
    opts: { bg: string; color: string; bold: boolean; h: number; sub?: { text: string; colIdx: number } },
  ) => {
    const totalH = opts.h + (opts.sub ? 11 : 0);
    if (y + totalH + 1 > pdf.contentBottom) {
      y = pdf.addPage();
      drawRow(COLS, { bg: HEADER_BG, color: "white", bold: true, h: 20 });
    }
    let x = 40;
    doc.lineWidth(0.5);
    cells.forEach(([text, width, right], ci) => {
      doc.rect(x, y, width, totalH).fillAndStroke(opts.bg, GRID);
      doc.fillColor(opts.color).font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
      doc.text(text, x + 4, y + (opts.h - 8) / 2, { width: width - 8, align: right ? "right" : "left", lineBreak: false });
      if (opts.sub && ci === opts.sub.colIdx && opts.sub.text) {
        doc.fillColor("#6b7280").font("Helvetica-Oblique").fontSize(6.5);
        doc.text(opts.sub.text, x + 4, y + opts.h - 2, { width: width - 8, lineBreak: false });
      }
      x += width;
    });
    y += totalH;
  };

  drawRow(COLS, { bg: HEADER_BG, color: "white", bold: true, h: 20 });
  // With a startDate the opening-balance row is still meaningful even when the
  // period itself has no transactions, so only short-circuit without one.
  if (entries.length === 0 && !startDate) {
    doc.fillColor("#888").font("Helvetica").fontSize(9).text("No transactions found for this account/period.", 40, y + 8);
  } else {
    let cashBal = openCash;
    let metalBal = openMetal;
    let zebra = 0;
    if (startDate) {
      drawRow([
        [startDate, 54], ["-", 60], ["Opening Balance (brought forward)", 180],
        ["-", 76, true], ["-", 76, true], [bal2(openCash), 94, true],
        ["-", 66, true], ["-", 66, true], [bal3(openMetal), 90, true],
      ], { bg: "#eef2f7", color: "#1a1a1a", bold: true, h: 16 });
      zebra = 1;
    }
    entries.forEach((e, i) => {
      cashBal += e.cashCredit - e.cashDebit;
      metalBal += e.metalCredit - e.metalDebit;
      const narrative = (e.narrative ?? "").trim();
      drawRow([
        [e.date, 54],
        [e.ref, 60],
        [e.title.substring(0, 44), 180],
        [e.cashDebit > 0 ? num2(e.cashDebit) : "-", 76, true],
        [e.cashCredit > 0 ? num2(e.cashCredit) : "-", 76, true],
        [bal2(cashBal), 94, true],
        [e.metalDebit > 0 ? num3(e.metalDebit) : "-", 66, true],
        [e.metalCredit > 0 ? num3(e.metalCredit) : "-", 66, true],
        [bal3(metalBal), 90, true],
      ], {
        bg: (i + zebra) % 2 === 0 ? "white" : ZEBRA, color: "#1a1a1a", bold: false, h: 16,
        sub: narrative ? { text: narrative.substring(0, 44), colIdx: 2 } : undefined,
      });
    });
    const totCashD = entries.reduce((s, e) => s + e.cashDebit, 0);
    const totCashC = entries.reduce((s, e) => s + e.cashCredit, 0);
    const totMetalD = entries.reduce((s, e) => s + e.metalDebit, 0);
    const totMetalC = entries.reduce((s, e) => s + e.metalCredit, 0);
    drawRow([
      ["GRAND TOTAL", 114],
      ["Totals & Net Final Balance", 180],
      [num2(totCashD), 76, true],
      [num2(totCashC), 76, true],
      [bal2(cashBal), 94, true],
      [num3(totMetalD), 66, true],
      [num3(totMetalC), 66, true],
      [bal3(metalBal), 90, true],
    ], { bg: "#eee6cf", color: NAVY, bold: true, h: 18 });

    y += 10;
    y = pdf.ensureSpace(y, 40);
    doc.rect(40, y, W, 1).fill(GOLD);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10)
      .text(`Net Final Cash Balance: AED ${bal2(cashBal)}     ·     Net Final Gold Balance: ${bal3(metalBal)} grams`, 40, y + 8, { width: W, align: "right" });
    doc.fillColor("#666").font("Helvetica").fontSize(7)
      .text("Posting rule: Stock purchase = Cash Debit + Metal Credit. Sale = Cash Credit + Metal Debit. Balances run cumulatively; CR = credit surplus, DR = debit surplus.", 40, y + 24, { width: W });
    y += 40;
  }

  pdf.finish(y);
});

export default router;
