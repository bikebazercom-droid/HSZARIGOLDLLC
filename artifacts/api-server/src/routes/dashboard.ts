import { Router, type IRouter } from "express";
import { eq, gte, desc, sql } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, customersTable, productsTable, pricesTable } from "@workspace/db";
import { GetDashboardResponse, GetCategorySummaryQueryParams, GetCategorySummaryResponse } from "@workspace/api-zod";
import PDFDocument from "pdfkit";

const router: IRouter = Router();

const CATEGORY_ORDER = ["gold_jewelry", "gold", "tt_bar", "kg_bar", "silver", "custom"] as const;
const CATEGORY_SUMMARY_LABEL: Record<string, string> = {
  gold_jewelry: "22K Gold Jewelry",
  gold: "24K GOLD",
  tt_bar: "TT. BAR",
  kg_bar: "KG. BAR",
  silver: "Silver",
  custom: "Custom",
};

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
      sql`TRUE`,
      ...(start ? [sql`i.created_at >= ${start.toISOString()}::timestamptz`] : []),
      ...(endExclusive ? [sql`i.created_at < ${endExclusive.toISOString()}::timestamptz`] : []),
    ],
    sql` AND `,
  );
  // stock_purchases.purchase_date is a yyyy-MM-dd text column
  const purchaseWhere = sql.join(
    [
      sql`TRUE`,
      ...(q.startDate?.trim() ? [sql`purchase_date >= ${q.startDate.trim()}`] : []),
      ...(q.endDate?.trim() ? [sql`purchase_date <= ${q.endDate.trim()}`] : []),
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

  const [invAgg, itemAgg, purchaseAgg, cogsAgg] = await Promise.all([
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
    db.execute<{ cogs: string }>(sql`
      WITH avg_cost AS (
        SELECT category,
               CASE WHEN SUM(weight_grams::numeric) > 0
                    THEN SUM(total_price_aed::numeric) / SUM(weight_grams::numeric)
                    ELSE 0 END AS cost_per_gram
        FROM stock_purchases
        GROUP BY category
      )
      SELECT COALESCE(SUM(COALESCE(ii.gross_weight::numeric, 0) * COALESCE(ac.cost_per_gram, 0)), 0)::text AS cogs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      LEFT JOIN avg_cost ac ON ac.category = ${bucketExpr}
      WHERE ${invWhere}
    `).then((r) => r.rows[0]),
  ]);

  const stockInGrams = Number(purchaseAgg.purchased_grams);
  const stockOutGrams = Number(itemAgg.sold_grams);
  const invoiceCount = Number(invAgg.invoice_count);
  const totalRevenueAed = Number(invAgg.total_revenue);

  res.json({
    stockInGrams,
    stockOutGrams,
    netStockGrams: stockInGrams - stockOutGrams,
    totalRevenueAed,
    cashReceivedAed: Number(invAgg.cash_received),
    outstandingDueAed: Number(invAgg.outstanding_due),
    makingChargesAed: Number(itemAgg.making_charges),
    invoiceCount,
    avgInvoiceAed: invoiceCount > 0 ? totalRevenueAed / invoiceCount : 0,
    purchaseCostAed: Number(purchaseAgg.purchase_cost),
    cogsAed: Number(cogsAgg.cogs),
    netProfitAed: totalRevenueAed - Number(cogsAgg.cogs),
  });
});

// Live per-category stock matrix: Stock IN, Sold, Net Remaining, and value at
// the current per-category rate. Not date-filtered — this is the live ledger.
const STOCK_MATRIX_CATEGORIES = ["gold", "tt_bar", "kg_bar", "995", "gold_jewelry_22k", "silver"] as const;
const STOCK_MATRIX_LABEL: Record<string, string> = {
  gold: "GOLD",
  tt_bar: "TT Bar",
  kg_bar: "KG Bar",
  "995": "995",
  gold_jewelry_22k: "Gold Jewelry 22K",
  silver: "Silver",
};

router.get("/dashboard/stock-matrix", async (_req, res): Promise<void> => {
  const [movements, prices] = await Promise.all([
    db.execute<{ category: string; in_grams: string; out_grams: string }>(sql`
      SELECT category,
             COALESCE(SUM(CASE WHEN type IN ('purchase', 'purchase_reversal') THEN weight_grams::numeric ELSE 0 END), 0)::text AS in_grams,
             COALESCE(SUM(CASE WHEN type IN ('sale', 'sale_reversal') THEN weight_grams::numeric ELSE 0 END), 0)::text AS out_grams
      FROM stock_movements
      GROUP BY category
    `).then((r) => r.rows),
    db.select().from(pricesTable).limit(1).then((r) => r[0]),
  ]);

  // Current AED/g rate per bucket. "995" is its own stock bucket but is priced
  // as a TT bar (see inventory ledger conventions).
  const rateFor: Record<string, number> = {
    gold: prices ? Number(prices.gold9999Rate) : 0,
    tt_bar: prices ? Number(prices.ttBarRate) : 0,
    kg_bar: prices ? Number(prices.kgBarRate) : 0,
    "995": prices ? Number(prices.ttBarRate) : 0,
    gold_jewelry_22k: prices ? Number(prices.gold22kRate) : 0,
    silver: prices ? Number(prices.silverPricePerGram) : 0,
  };

  const rows = STOCK_MATRIX_CATEGORIES.map((category) => {
    const m = movements.find((r) => r.category === category);
    // purchase deltas are positive, purchase_reversals negative; sale deltas
    // are negative, sale_reversals positive — so IN sums directly and OUT is
    // the negated sale-side sum.
    const stockInGrams = m ? Number(m.in_grams) : 0;
    const soldGrams = m ? -Number(m.out_grams) : 0;
    const netGrams = stockInGrams - soldGrams;
    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    return {
      category,
      label: STOCK_MATRIX_LABEL[category],
      stockInGrams: round3(stockInGrams),
      soldGrams: round3(soldGrams),
      netGrams: round3(netGrams),
      valueAed: Math.round(netGrams * (rateFor[category] ?? 0) * 100) / 100,
    };
  });

  const totals = {
    stockInGrams: Math.round(rows.reduce((s, r) => s + r.stockInGrams, 0) * 1000) / 1000,
    soldGrams: Math.round(rows.reduce((s, r) => s + r.soldGrams, 0) * 1000) / 1000,
    netGrams: Math.round(rows.reduce((s, r) => s + r.netGrams, 0) * 1000) / 1000,
    valueAed: Math.round(rows.reduce((s, r) => s + r.valueAed, 0) * 100) / 100,
  };

  res.json({ rows, totals });
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
    db.select().from(invoicesTable).where(gte(invoicesTable.createdAt, startOfToday)),
    db.select().from(invoicesTable).where(gte(invoicesTable.createdAt, startOfMonth)),
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
      GROUP BY ii.category
    `).then(r => r.rows as CatRow[]),
    db.$count(customersTable),
    db.$count(productsTable),
    db.$count(invoicesTable),
    db.select().from(invoicesTable).where(eq(invoicesTable.isPending, true)),
    db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)).limit(5),
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
  const todayGold = getCatStats(todayCatRows, "gold");
  const todayKgBar = getCatStats(todayCatRows, "kg_bar");
  const todayTtBar = getCatStats(todayCatRows, "tt_bar");
  const todaySilver = getCatStats(todayCatRows, "silver");
  const todayTotalGoldGrams = todayGoldJewelry.grams + todayGold.grams + todayKgBar.grams + todayTtBar.grams;

  const monthlyGoldJewelry = getCatStats(monthlyCatRows, "gold_jewelry");
  const monthlyGold = getCatStats(monthlyCatRows, "gold");
  const monthlyKgBar = getCatStats(monthlyCatRows, "kg_bar");
  const monthlyTtBar = getCatStats(monthlyCatRows, "tt_bar");
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
      // Pure Gold (GOLD)
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
      // TT Bar
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

  const catRows = await db.execute<CatRow>(sql`
    SELECT
      COALESCE(ii.category, 'custom') AS category,
      COUNT(DISTINCT ii.invoice_id)::text AS invoice_count,
      COALESCE(SUM(ii.total_price::numeric), 0)::text AS total_amount,
      COALESCE(SUM(COALESCE(ii.pure_weight::numeric, ii.gross_weight::numeric, 0)), 0)::text AS total_weight,
      COALESCE(SUM(ii.gross_weight::numeric), 0)::text AS total_gross_weight
    FROM invoice_items ii
    JOIN invoices i ON ii.invoice_id = i.id
    WHERE i.created_at >= ${start} AND i.created_at < ${end}
    GROUP BY COALESCE(ii.category, 'custom')
  `).then(r => r.rows as CatRow[]);

  // Payment method breakdown for the same date range.
  // Credit/Due sales are any invoice marked isPending, regardless of the recorded payment method.
  // Remaining (settled) invoices are split into Cash vs Card (bank_transfer is grouped with Card as electronic settlement).
  const rangeInvoices = await db
    .select({ total: invoicesTable.total, paymentMethod: invoicesTable.paymentMethod, isPending: invoicesTable.isPending })
    .from(invoicesTable)
    .where(sql`${invoicesTable.createdAt} >= ${start} AND ${invoicesTable.createdAt} < ${end}`);

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
  const paymentBreakdown = {
    totalCash: Math.round(totalCash * 100) / 100,
    totalCard: Math.round(totalCard * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    grandTotal: Math.round((totalCash + totalCard + totalCredit) * 100) / 100,
  };

  // Anything with a category not in our known set is folded into "Custom"
  const knownCategories = new Set(CATEGORY_ORDER);
  const normalizedRows = catRows.map(r => ({
    ...r,
    category: knownCategories.has(r.category as (typeof CATEGORY_ORDER)[number]) ? r.category : "custom",
  }));

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
    .where(gte(invoicesTable.createdAt, startDate))
    .orderBy(desc(invoicesTable.createdAt));

  const rows = await Promise.all(
    allInvoices.map(async (inv) => {
      const items = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, inv.id));
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
  gold: "Gold",
  kg_bar: "KG Bar",
  tt_bar: "TT Bar",
  silver: "Silver",
  all: "All",
};

// CSV download: /api/dashboard/download?category=gold_jewelry|gold|kg_bar|tt_bar|silver|all&period=today|monthly
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

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  const NAVY = "#1e3a5f";
  const GOLD = "#c8a43a";
  const LIGHT = "#f5f3ee";

  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor(GOLD).fontSize(22).font("Helvetica-Bold").text("Hazari Gold L.L.C", 40, 22);
  doc.fillColor("#aac4e8").fontSize(10).font("Helvetica").text("Management Portal — Sales Report", 40, 50);
  doc.fillColor("white").fontSize(9).text(`Generated: ${now.toLocaleString("en-AE")}`, 40, 66);

  doc.rect(40, 100, doc.page.width - 80, 36).fill(LIGHT);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(`${catLabel}  ·  ${periodLabel}`, 52, 112);

  const grandTotal = rows.reduce((s, { inv }) => s + Number(inv.total), 0);
  const totalGrams = rows.reduce((s, { items }) =>
    s + items.reduce((si, it) => si + (it.weight ? Number(it.weight) : 0), 0), 0);

  doc.moveDown(3.2);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(
    `Invoices: ${rows.length}   |   Total Weight: ${totalGrams.toFixed(2)} g   |   Grand Total: AED ${grandTotal.toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
    { align: "right" }
  );
  doc.moveDown(0.5);

  const cols = { no: 40, date: 110, customer: 195, method: 300, category: 360, weight: 435, total: 480 };
  const colWidths = { no: 65, date: 80, customer: 100, method: 55, category: 70, weight: 42, total: 65 };
  const tableTop = doc.y;

  doc.rect(40, tableTop, doc.page.width - 80, 18).fill(NAVY);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(8);
  doc.text("Invoice #", cols.no, tableTop + 5, { width: colWidths.no });
  doc.text("Date", cols.date, tableTop + 5, { width: colWidths.date });
  doc.text("Customer", cols.customer, tableTop + 5, { width: colWidths.customer });
  doc.text("Method", cols.method, tableTop + 5, { width: colWidths.method });
  doc.text("Category", cols.category, tableTop + 5, { width: colWidths.category });
  doc.text("Wt.(g)", cols.weight, tableTop + 5, { width: colWidths.weight, align: "right" });
  doc.text("Total AED", cols.total, tableTop + 5, { width: colWidths.total, align: "right" });

  let y = tableTop + 18;
  let rowIndex = 0;

  for (const { inv, items } of rows) {
    const rowH = 16;
    if (y + rowH > doc.page.height - 60) { doc.addPage(); y = 40; }
    const bg = rowIndex % 2 === 0 ? "white" : LIGHT;
    doc.rect(40, y, doc.page.width - 80, rowH).fill(bg);

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
      40, y + 10, { align: "center", width: doc.page.width - 80 }
    );
  }

  doc.rect(40, y + 8, doc.page.width - 80, 1).fill(GOLD);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9)
    .text(
      `Total Weight: ${totalGrams.toFixed(2)} g   |   Grand Total: AED ${grandTotal.toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
      40, y + 14, { align: "right", width: doc.page.width - 80 }
    );

  doc.end();
});

// Raw PDF download (outside the OpenAPI spec, like other download routes):
// /api/dashboard/statement-pdf?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&category=<bucket|all>
// A4 statement with itemized purchases, itemized sales, remaining stock and profit.
router.get("/dashboard/statement-pdf", async (req, res): Promise<void> => {
  const q = req.query as Record<string, string | undefined>;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const rawStart = q.startDate?.trim() || null;
  const rawEnd = q.endDate?.trim() || null;
  if ((rawStart && !DATE_RE.test(rawStart)) || (rawEnd && !DATE_RE.test(rawEnd))) {
    res.status(400).json({ error: "startDate/endDate must be YYYY-MM-DD" });
    return;
  }
  const startDate = rawStart;
  const endDate = rawEnd;
  const rawCategory = q.category?.trim() || null;
  const VALID_CATEGORIES = new Set(["gold", "tt_bar", "kg_bar", "995", "gold_jewelry_22k", "silver"]);
  if (rawCategory && rawCategory !== "all" && !VALID_CATEGORIES.has(rawCategory)) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  const category = rawCategory && rawCategory !== "all" ? rawCategory : null;

  const bucketExpr = sql`(CASE WHEN TRIM(ii.description) = '995' THEN '995'
        WHEN ii.category = 'gold_jewelry' THEN 'gold_jewelry_22k'
        ELSE ii.category END)`;

  const purchaseWhere = sql.join(
    [
      sql`TRUE`,
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
      sql`TRUE`,
      ...(startDate ? [sql`i.created_at >= ${new Date(`${startDate}T00:00:00`).toISOString()}::timestamptz`] : []),
      ...(endExclusive ? [sql`i.created_at < ${endExclusive}::timestamptz`] : []),
      ...(category ? [sql`${bucketExpr} = ${category}`] : []),
    ],
    sql` AND `,
  );

  const [purchases, sales, levels] = await Promise.all([
    db.execute<{ purchase_date: string; supplier_name: string; category: string; weight_grams: string; total_price_aed: string }>(sql`
      SELECT purchase_date, supplier_name, category, weight_grams::text, total_price_aed::text
      FROM stock_purchases
      WHERE ${purchaseWhere}
      ORDER BY purchase_date, id
    `).then((r) => r.rows),
    // Revenue basis matches the KPI and sales report: each item's amount is its
    // proportional share of the invoice's FINAL billed total (VAT/discount/
    // round-off included), so statement totals reconcile with the dashboard.
    db.execute<{ created_at: string; invoice_number: string; customer_name: string | null; description: string; bucket: string | null; grams: string; amount: string }>(sql`
      SELECT i.created_at::text, i.invoice_number, i.customer_name, ii.description,
             ${bucketExpr} AS bucket,
             COALESCE(ii.gross_weight::numeric, 0)::text AS grams,
             (CASE WHEN s.sum_items > 0
                   THEN ii.total_price::numeric * i.total::numeric / s.sum_items
                   ELSE ii.total_price::numeric END)::text AS amount
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      JOIN LATERAL (
        SELECT COALESCE(SUM(total_price::numeric), 0) AS sum_items
        FROM invoice_items WHERE invoice_id = i.id
      ) s ON TRUE
      WHERE ${salesWhere}
      ORDER BY i.created_at, i.id
    `).then((r) => r.rows),
    db.execute<{ category: string; weight_grams: string }>(sql`
      SELECT category, weight_grams::text FROM stock_levels ORDER BY category
    `).then((r) => r.rows),
  ]);

  const totalPurchaseAed = purchases.reduce((s, p) => s + Number(p.total_price_aed), 0);
  const totalPurchaseG = purchases.reduce((s, p) => s + Number(p.weight_grams), 0);
  const totalSalesAed = sales.reduce((s, r) => s + Number(r.amount), 0);
  const totalSalesG = sales.reduce((s, r) => s + Number(r.grams), 0);
  // Profit basis matches the KPI: revenue minus weighted-average purchase cost
  // of the sold grams, computed per category across all purchases.
  const avgCost = new Map<string, number>();
  const allPurch = await db.execute<{ category: string; g: string; aed: string }>(sql`
    SELECT category, SUM(weight_grams::numeric)::text AS g, SUM(total_price_aed::numeric)::text AS aed
    FROM stock_purchases GROUP BY category
  `).then((r) => r.rows);
  for (const p of allPurch) {
    const g = Number(p.g);
    avgCost.set(p.category, g > 0 ? Number(p.aed) / g : 0);
  }
  const cogs = sales.reduce((s, r) => s + Number(r.grams) * (avgCost.get(r.bucket ?? "") ?? 0), 0);
  const profit = totalSalesAed - cogs;

  const catLabel: Record<string, string> = {
    gold: "GOLD", tt_bar: "TT Bar", kg_bar: "KG Bar", "995": "995",
    gold_jewelry_22k: "Gold Jewelry 22K", silver: "Silver",
  };
  const displayCat = (r: { bucket: string | null; description: string }) =>
    r.bucket && catLabel[r.bucket] ? catLabel[r.bucket] : r.description.trim();

  const now = new Date();
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="hazari-gold-statement.pdf"`);
  doc.pipe(res);

  const NAVY = "#1e3a5f";
  const GOLD = "#c8a43a";
  const LIGHT = "#f5f3ee";
  const W = doc.page.width - 80;

  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor(GOLD).fontSize(22).font("Helvetica-Bold").text("Hazari Gold L.L.C", 40, 22);
  doc.fillColor("#aac4e8").fontSize(10).font("Helvetica").text("Stock & Profit Statement", 40, 50);
  doc.fillColor("white").fontSize(9).text(`Generated: ${now.toLocaleString("en-AE")}`, 40, 66);

  const criteria = [
    startDate || endDate ? `Period: ${startDate ?? "…"} to ${endDate ?? "…"}` : "Period: All time",
    `Category: ${category ? (catLabel[category] ?? category) : "All"}`,
  ].join("   ·   ");
  doc.rect(40, 100, W, 30).fill(LIGHT);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(criteria, 52, 110);

  // Summary boxes
  const boxes = [
    ["Purchases (AED)", totalPurchaseAed],
    ["Sales (AED)", totalSalesAed],
    ["Est. COGS (AED)", cogs],
    ["Net Profit (AED)", profit],
  ] as const;
  let bx = 40;
  const bw = (W - 3 * 8) / 4;
  for (const [label, val] of boxes) {
    doc.rect(bx, 140, bw, 40).fill(label.startsWith("Net Profit") ? "#e7f5ec" : LIGHT);
    doc.fillColor("#666").font("Helvetica").fontSize(7.5).text(label, bx + 8, 147, { width: bw - 16 });
    doc.fillColor(label.startsWith("Net Profit") ? "#1c7a3d" : NAVY).font("Helvetica-Bold").fontSize(11)
      .text(val.toLocaleString("en-AE", { minimumFractionDigits: 2 }), bx + 8, 159, { width: bw - 16 });
    bx += bw + 8;
  }

  let y = 195;
  const ensureSpace = (h: number) => {
    if (y + h > doc.page.height - 60) { doc.addPage(); y = 40; }
  };
  const sectionHeader = (title: string) => {
    ensureSpace(40);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text(title, 40, y);
    y += 18;
  };
  const tableHeader = (cells: [string, number, boolean?][]) => {
    ensureSpace(24);
    doc.rect(40, y, W, 16).fill(NAVY);
    let x = 44;
    doc.fillColor("white").font("Helvetica-Bold").fontSize(7.5);
    for (const [label, width, right] of cells) {
      doc.text(label, x, y + 4.5, { width, align: right ? "right" : "left" });
      x += width;
    }
    y += 16;
  };
  let rowIdx = 0;
  const tableRow = (cells: [string, number, boolean?][], bold = false) => {
    ensureSpace(15);
    doc.rect(40, y, W, 14).fill(rowIdx++ % 2 === 0 ? "white" : LIGHT);
    let x = 44;
    doc.fillColor("#1a1a1a").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
    for (const [text, width, right] of cells) {
      doc.text(text, x, y + 3.5, { width: width - 6, align: right ? "right" : "left" });
      x += width;
    }
    y += 14;
  };

  // Purchases section
  sectionHeader("Itemized Purchases");
  if (purchases.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(9).text("No purchases in this period.", 40, y); y += 20;
  } else {
    tableHeader([["Date", 80], ["Supplier", 150], ["Category", 120], ["Weight (g)", 80, true], ["Cost AED", 85, true]]);
    for (const p of purchases) {
      tableRow([
        [p.purchase_date, 80],
        [p.supplier_name, 150],
        [catLabel[p.category] ?? p.category, 120],
        [Number(p.weight_grams).toLocaleString("en-AE", { minimumFractionDigits: 3 }), 80, true],
        [Number(p.total_price_aed).toLocaleString("en-AE", { minimumFractionDigits: 2 }), 85, true],
      ]);
    }
    tableRow([["TOTAL", 350], [totalPurchaseG.toLocaleString("en-AE", { minimumFractionDigits: 3 }), 80, true], [totalPurchaseAed.toLocaleString("en-AE", { minimumFractionDigits: 2 }), 85, true]], true);
    y += 12;
  }

  // Sales section
  sectionHeader("Itemized Sales");
  if (sales.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(9).text("No sales in this period.", 40, y); y += 20;
  } else {
    tableHeader([["Date", 60], ["Invoice #", 75], ["Customer", 110], ["Item", 120], ["Weight (g)", 70, true], ["Total AED", 80, true]]);
    for (const s of sales) {
      tableRow([
        [new Date(s.created_at).toLocaleDateString("en-AE"), 60],
        [s.invoice_number, 75],
        [(s.customer_name ?? "Walk-in").substring(0, 20), 110],
        [displayCat(s).substring(0, 24), 120],
        [Number(s.grams).toLocaleString("en-AE", { minimumFractionDigits: 3 }), 70, true],
        [Number(s.amount).toLocaleString("en-AE", { minimumFractionDigits: 2 }), 80, true],
      ]);
    }
    tableRow([["TOTAL", 365], [totalSalesG.toLocaleString("en-AE", { minimumFractionDigits: 3 }), 70, true], [totalSalesAed.toLocaleString("en-AE", { minimumFractionDigits: 2 }), 80, true]], true);
    y += 12;
  }

  // Remaining stock (live, all-time)
  sectionHeader("Remaining Stock (Live)");
  const levelRows = category ? levels.filter((l) => l.category === category) : levels;
  if (levelRows.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(9).text("No stock records.", 40, y); y += 20;
  } else {
    tableHeader([["Category", 200], ["Net Remaining (g)", 150, true], ["KG", 165, true]]);
    for (const l of levelRows) {
      const g = Number(l.weight_grams);
      tableRow([
        [catLabel[l.category] ?? l.category, 200],
        [g.toLocaleString("en-AE", { minimumFractionDigits: 3 }), 150, true],
        [(g / 1000).toFixed(3), 165, true],
      ]);
    }
  }

  ensureSpace(60);
  doc.rect(40, y + 8, W, 1).fill(GOLD);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10)
    .text(`Net Profit: AED ${profit.toLocaleString("en-AE", { minimumFractionDigits: 2 })}`, 40, y + 16, { align: "right", width: W });
  doc.fillColor("#666").font("Helvetica").fontSize(7)
    .text("Profit = Sales revenue − estimated cost of sold items (weighted-average purchase cost per gram per category).", 40, y + 32, { width: W });

  doc.end();
});

export default router;
