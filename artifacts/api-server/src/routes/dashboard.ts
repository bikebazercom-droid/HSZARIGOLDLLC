import { Router, type IRouter } from "express";
import { eq, gte, desc, sql } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, customersTable, productsTable, pricesTable } from "@workspace/db";
import { GetDashboardResponse, GetCategorySummaryQueryParams, GetCategorySummaryResponse } from "@workspace/api-zod";
import PDFDocument from "pdfkit";
import { requireAdmin } from "../middlewares/auth";
import ExcelJS from "exceljs";

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
    // Exact FIFO COGS: sum the inventory engine's per-batch consumption costs
    // for invoices in the range.
    db.execute<{ cogs: string }>(sql`
      SELECT COALESCE(SUM(c.cost_aed::numeric), 0)::text AS cogs
      FROM inventory_consumptions c
      JOIN invoices i ON i.id = c.invoice_id
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

// All-time live totals for the two dashboard hero cards. Not date-filtered:
// Card 1 shows remaining stock (purchased − sold) and its value at purchase
// cost (total purchase spend − COGS of everything sold so far); Card 2 shows
// cumulative invoiced revenue and net profit (revenue − COGS; making charges
// are already inside invoice totals, so they are not added again).
router.get("/dashboard/summary-cards", async (_req, res): Promise<void> => {
  // Silver is tracked in its own dedicated card; everything else (gold,
  // tt_bar, kg_bar, 995, gold_jewelry_22k, custom) rolls up into the main box.
  // Cost values come straight from the FIFO batch ledger: remaining stock is
  // valued at each surviving lot's own purchase rate, and COGS is the exact
  // sum of consumed batch slices — no averaging.
  const [purchaseAgg, salesAgg, cogsAgg] = await Promise.all([
    db.execute<{ main_grams: string; main_cost: string; silver_grams: string; silver_cost: string }>(sql`
      SELECT COALESCE(SUM(CASE WHEN category <> 'silver' THEN weight_grams::numeric ELSE 0 END), 0)::text AS main_grams,
             COALESCE(SUM(CASE WHEN category <> 'silver' THEN remaining_weight_grams::numeric * price_per_gram::numeric ELSE 0 END), 0)::text AS main_cost,
             COALESCE(SUM(CASE WHEN category = 'silver' THEN weight_grams::numeric ELSE 0 END), 0)::text AS silver_grams,
             COALESCE(SUM(CASE WHEN category = 'silver' THEN remaining_weight_grams::numeric * price_per_gram::numeric ELSE 0 END), 0)::text AS silver_cost
      FROM stock_purchases
    `).then((r) => r.rows[0]),
    db.execute<{ total_revenue: string; main_sold: string; silver_sold: string }>(sql`
      SELECT COALESCE(SUM(i.total::numeric), 0)::text AS total_revenue,
             COALESCE((SELECT SUM(CASE WHEN ii.category <> 'silver' THEN COALESCE(ii.gross_weight::numeric, 0) ELSE 0 END) FROM invoice_items ii), 0)::text AS main_sold,
             COALESCE((SELECT SUM(CASE WHEN ii.category = 'silver' THEN COALESCE(ii.gross_weight::numeric, 0) ELSE 0 END) FROM invoice_items ii), 0)::text AS silver_sold
      FROM invoices i
    `).then((r) => r.rows[0]),
    db.execute<{ main_cogs: string; silver_cogs: string }>(sql`
      SELECT COALESCE(SUM(CASE WHEN category <> 'silver' THEN cost_aed::numeric ELSE 0 END), 0)::text AS main_cogs,
             COALESCE(SUM(CASE WHEN category = 'silver' THEN cost_aed::numeric ELSE 0 END), 0)::text AS silver_cogs
      FROM inventory_consumptions
    `).then((r) => r.rows[0]),
  ]);

  const mainCogs = Number(cogsAgg.main_cogs);
  const silverCogs = Number(cogsAgg.silver_cogs);
  const revenue = Number(salesAgg.total_revenue);
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  res.json({
    availableStockGrams: round3(Number(purchaseAgg.main_grams) - Number(salesAgg.main_sold)),
    availableStockCostAed: round2(Number(purchaseAgg.main_cost)),
    silverStockGrams: round3(Number(purchaseAgg.silver_grams) - Number(salesAgg.silver_sold)),
    silverStockCostAed: round2(Number(purchaseAgg.silver_cost)),
    totalRevenueAed: round2(revenue),
    soldCostAed: round2(mainCogs + silverCogs),
    netProfitAed: round2(revenue - mainCogs - silverCogs),
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

// ---------------------------------------------------------------------------
// Statement export engine (PDF with Excel-sheet styling + true .xlsx export).
// Raw download routes, intentionally outside the OpenAPI spec.
// ---------------------------------------------------------------------------

const STMT_CAT_LABEL: Record<string, string> = {
  gold: "GOLD", tt_bar: "TT Bar", kg_bar: "KG Bar", "995": "995",
  gold_jewelry_22k: "Gold Jewelry 22K", silver: "Silver",
};

interface StatementLedgerRow {
  sl: number;
  date: string;          // display date
  invoiceRef: string;    // sales: invoice number; purchases: ""
  type: "Purchase" | "Sale";
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

async function loadStatementData(startDate: string | null, endDate: string | null, category: string | null) {
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
    db.execute<{ created_at: string; invoice_number: string; customer_name: string | null; description: string; bucket: string | null; grams: string; amount: string; exact_cogs: string | null; batch_refs: string | null }>(sql`
      SELECT i.created_at::text, i.invoice_number, i.customer_name, ii.description,
             ${bucketExpr} AS bucket,
             COALESCE(ii.gross_weight::numeric, 0)::text AS grams,
             (CASE WHEN s.sum_items > 0
                   THEN ii.total_price::numeric * i.total::numeric / s.sum_items
                   ELSE ii.total_price::numeric END)::text AS amount,
             c.exact_cogs::text AS exact_cogs,
             c.batch_refs
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      JOIN LATERAL (
        SELECT COALESCE(SUM(total_price::numeric), 0) AS sum_items
        FROM invoice_items WHERE invoice_id = i.id
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
    db.execute<{ category: string; weight_grams: string }>(sql`
      SELECT category, weight_grams::text FROM stock_levels ORDER BY category
    `).then((r) => r.rows),
  ]);

  const totalPurchaseAed = purchases.reduce((s, p) => s + Number(p.total_price_aed), 0);
  const totalSalesAed = sales.reduce((s, r) => s + Number(r.amount), 0);
  // Profit basis: exact FIFO batch COGS recorded by the inventory engine at
  // sale time. Items with no consumption rows (custom/non-stock items) fall
  // back to the category weighted-average cost, matching prior behavior.
  const avgCost = new Map<string, number>();
  const allPurch = await db.execute<{ category: string; g: string; aed: string }>(sql`
    SELECT category, SUM(weight_grams::numeric)::text AS g, SUM(total_price_aed::numeric)::text AS aed
    FROM stock_purchases GROUP BY category
  `).then((r) => r.rows);
  for (const p of allPurch) {
    const g = Number(p.g);
    avgCost.set(p.category, g > 0 ? Number(p.aed) / g : 0);
  }
  const itemCogs = (r: { exact_cogs: string | null; grams: string; bucket: string | null }) =>
    r.exact_cogs != null ? Number(r.exact_cogs) : Number(r.grams) * (avgCost.get(r.bucket ?? "") ?? 0);
  const cogs = sales.reduce((s, r) => s + itemCogs(r), 0);
  const profit = totalSalesAed - cogs;

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
      type: "Sale",
      party: s.customer_name ?? "Walk-in",
      category: s.bucket && STMT_CAT_LABEL[s.bucket] ? STMT_CAT_LABEL[s.bucket] : "Custom",
      itemName: s.description.trim(),
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
    soldGrams: ledger.reduce((s, r) => s + (r.type === "Sale" ? r.grams : 0), 0),
    revenueAed: totalSalesAed,
    cogsAed: cogs,
    profitAed: profit,
  };

  return { purchases, sales, levels, ledger, liveBatches, totals, totalPurchaseAed, totalSalesAed, cogs, profit };
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
  const { ledger, liveBatches, totals, totalPurchaseAed, totalSalesAed, cogs, profit } =
    await loadStatementData(startDate, endDate, category);
  const catLabel = STMT_CAT_LABEL;

  const now = new Date();
  const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="hazari-gold-statement.pdf"`);
  doc.pipe(res);

  const NAVY = "#1e3a5f";
  const HEADER_BG = "#1e293b"; // excel header row
  const GRID = "#d1d5db";      // excel gridlines
  const ZEBRA = "#f8fafc";     // alternating rows
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
    ["Total Purchases (AED)", totalPurchaseAed],
    ["Sales Revenue (AED)", totalSalesAed],
    ["Purchase Cost of Sold - COGS (AED)", cogs],
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
    if (y + opts.h + 1 > doc.page.height - 60) {
      doc.addPage();
      y = 40;
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
    if (y + 18 + 17 > doc.page.height - 60) { doc.addPage(); y = 40; }
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

  // ===== SECTION 1: PURCHASES =====
  const purchaseRows = ledger.filter((r) => r.type === "Purchase");
  const totalPurchGrams = purchaseRows.reduce((s, r) => s + r.grams, 0);
  sectionHeader("1. Purchases (Stock In History)");
  if (purchaseRows.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(9).text("No purchases in this period.", 40, y); y += 20;
  } else {
    gridHeader([
      ["SL", 26], ["Date", 70], ["Supplier", 140], ["Category", 140],
      ["Weight (g)", 90, true], ["Purchase Rate (AED/g)", 96, true], ["Total Purchase Cost (AED)", 200, true],
    ]);
    purchaseRows.forEach((r, i) => {
      gridRow([
        [String(i + 1), 26],
        [r.date, 70],
        [r.party.substring(0, 30), 140],
        [r.category.substring(0, 30), 140],
        [num3(r.grams), 90, true],
        [num2(r.ratePerG), 96, true],
        [num2(r.totalAed), 200, true],
      ]);
    });
    gridRow([
      ["TOTAL PURCHASED WEIGHT & TOTAL SPENT", 236],
      [`${num3(totalPurchGrams)} g  (${(totalPurchGrams / 1000).toFixed(3)} kg)`, 326, true],
      [`AED ${num2(purchaseRows.reduce((s, r) => s + r.totalAed, 0))}`, 200, true],
    ], { bold: true, bg: "#e2e8f0" });
    y += 12;
  }

  // ===== SECTION 2: SALES & PROFIT =====
  const saleRows = ledger.filter((r) => r.type === "Sale");
  sectionHeader("2. Sales & Profit Realization");
  if (saleRows.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(9).text("No sales in this period.", 40, y); y += 20;
  } else {
    gridHeader([
      ["SL", 24], ["Date", 62], ["Invoice", 66], ["Customer", 80],
      ["Item Category", 130], ["Sold Weight (g)", 58, true],
      ["COGS (AED)", 72, true], ["Sale Value Received (AED)", 72, true],
      ["Realized Profit/Loss (AED)", 78, true], ["Consumed Batch Ref", 120],
    ]);
    saleRows.forEach((r, i) => {
      const itemCat = r.itemName === r.category ? r.itemName : `${r.itemName} (${r.category})`;
      gridRow([
        [String(i + 1), 24],
        [r.date, 62],
        [r.invoiceRef || "-", 66],
        [r.party.substring(0, 18), 80],
        [itemCat.substring(0, 30), 130],
        [num3(r.grams), 58, true],
        [r.costAed != null ? num2(r.costAed) : "-", 72, true],
        [num2(r.totalAed), 72, true],
        [r.profitAed != null ? `${r.profitAed >= 0 ? "+" : ""}${num2(r.profitAed)}` : "-", 78, true],
        [(r.batchRefs ?? "-").substring(0, 30), 120],
      ]);
    });
    const salesSummary: [string, string, string][] = [
      ["Total Sold Weight:", `${num3(totals.soldGrams)} g  (${(totals.soldGrams / 1000).toFixed(3)} kg)`, "#e2e8f0"],
      ["Purchase Cost of Sold (COGS):", `AED ${num2(totals.cogsAed)}`, "#fdf6e3"],
      ["Total Sales Revenue:", `AED ${num2(totals.revenueAed)}`, "#e2e8f0"],
      ["Net Realized Profit:", `AED ${num2(totals.profitAed)}`, totals.profitAed >= 0 ? "#e7f5ec" : "#fdecec"],
    ];
    salesSummary.forEach(([label, val, bg], gi) => {
      gridRow([
        [gi === 0 ? "TOTAL SALES" : "", 176],
        [label, 350, true],
        [val, 236, true],
      ], { bold: true, bg });
    });
    y += 12;
  }

  // ===== SECTION 3: REMAINING STOCK — LIVE (per batch) =====
  sectionHeader("3. Remaining Stock - Live Inventory Balance");
  if (liveBatches.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(9).text("No unsold stock batches.", 40, y); y += 20;
  } else {
    gridHeader([
      ["SL", 26], ["Category", 130], ["Batch ID", 70], ["Purchase Date", 76],
      ["Purchased Wt (g)", 90, true], ["Consumed Wt (g)", 84, true],
      ["Remaining Wt (g)", 90, true], ["Rate (AED/g)", 76, true], ["Active Cost Value (AED)", 120, true],
    ]);
    liveBatches.forEach((b, i) => {
      gridRow([
        [String(i + 1), 26],
        [(catLabel[b.category] ?? b.category).substring(0, 26), 130],
        [`#BATCH-${b.id}`, 70],
        [b.purchaseDate, 76],
        [num3(b.purchasedGrams), 90, true],
        [num3(b.soldGrams), 84, true],
        [num3(b.remainingGrams), 90, true],
        [num2(b.ratePerG), 76, true],
        [num2(b.costValueAed), 120, true],
      ]);
    });
    const remG = liveBatches.reduce((s, b) => s + b.remainingGrams, 0);
    const remAed = liveBatches.reduce((s, b) => s + b.costValueAed, 0);
    gridRow([
      ["TOTAL AVAILABLE STOCK WEIGHT & TOTAL VALUATION", 246],
      [`${num3(remG)} g  (${(remG / 1000).toFixed(3)} kg)`, 396, true],
      [`AED ${num2(remAed)}`, 120, true],
    ], { bold: true, bg: "#eef2f7" });
  }

  ensureSpace(60);
  doc.rect(40, y + 8, W, 1).fill(GOLD);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10)
    .text(`Net Profit: AED ${num2(profit)}`, 40, y + 16, { align: "right", width: W });
  doc.fillColor("#666").font("Helvetica").fontSize(7)
    .text("Profit = Sales revenue minus exact FIFO cost of sold items (consumed purchase batches, oldest first).", 40, y + 32, { width: W });

  doc.end();
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
  const { levels, ledger, liveBatches, totals, totalPurchaseAed, totalSalesAed, cogs, profit } =
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
  const saleRows = ledger.filter((r) => r.type === "Sale");
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

  // ===== SECTION 3: REMAINING STOCK - LIVE =====
  sectionTitle("SECTION 3: REMAINING STOCK - LIVE (Unsold Batches)");
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

  // Summary sheet
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 28 }, { width: 20 }];
  const sumRows: [string, number][] = [
    ["Total Purchases (AED)", totalPurchaseAed],
    ["Total Revenue Received (AED)", totalSalesAed],
    ["Total Purchase Cost of Sold Goods - COGS (AED)", cogs],
    ["Total Net Profit Earned (AED)", profit],
  ];
  for (const [label, val] of sumRows) {
    const row = sum.addRow([label, val]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).numFmt = "#,##0.00";
    row.eachCell((cell) => { cell.border = allBorders; });
  }
  sum.addRow([]);
  const lvlHeader = sum.addRow(["Remaining Stock (Live)", "Grams"]);
  lvlHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.border = allBorders;
  });
  const levelRows = category ? levels.filter((l) => l.category === category) : levels;
  for (const l of levelRows) {
    const row = sum.addRow([STMT_CAT_LABEL[l.category] ?? l.category, Number(l.weight_grams)]);
    row.getCell(2).numFmt = "#,##0.000";
    row.eachCell((cell) => { cell.border = allBorders; });
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="hazari-gold-statement.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

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

  const purchWhere = sql.join([
    sql`TRUE`,
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
    sql`TRUE`,
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
          ${party ? sql`AND supplier_name ILIKE ${party}` : sql``}
      `).then((r) => r.rows[0]),
      db.execute<{ aed: string; g: string }>(sql`
        SELECT COALESCE(SUM(i.total::numeric), 0)::text AS aed,
               COALESCE(SUM(s.g), 0)::text AS g
        FROM invoices i
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(COALESCE(gross_weight::numeric, 0)), 0) AS g
          FROM invoice_items WHERE invoice_id = i.id
        ) s ON TRUE
        WHERE i.created_at < ${new Date(`${startDate}T00:00:00`).toISOString()}::timestamptz
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
        FROM invoice_items WHERE invoice_id = i.id
      ) s ON TRUE
      WHERE ${salesWhere} ORDER BY i.created_at, i.id
    `).then((r) => r.rows),
  ]);

  interface LedgerEntry {
    date: string; ref: string; title: string; narrative: string | null;
    cashDebit: number; cashCredit: number; metalDebit: number; metalCredit: number;
  }
  const entries: LedgerEntry[] = [
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

  const now = new Date();
  const doc = new PDFDocument({ margin: 40, size: "A4", layout: "landscape" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="hazari-gold-account-ledger.pdf"`);
  doc.pipe(res);

  const NAVY = "#1e3a5f";
  const HEADER_BG = "#1e293b";
  const GRID = "#d1d5db";
  const ZEBRA = "#f8fafc";
  const GOLD = "#c8a43a";
  const LIGHT = "#f5f3ee";
  const W = doc.page.width - 80;
  const num2 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num3 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const bal2 = (n: number) => `${num2(Math.abs(n))} ${n >= 0 ? "CR" : "DR"}`;
  const bal3 = (n: number) => `${num3(Math.abs(n))} ${n >= 0 ? "CR" : "DR"}`;

  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor(GOLD).fontSize(20).font("Helvetica-Bold").text("Hazari Gold L.L.C", 40, 20);
  doc.fillColor("#aac4e8").fontSize(11).font("Helvetica-Bold").text("GOLD & SILVER ACCOUNT LEDGER STATEMENT", 40, 46);
  doc.fillColor("white").fontSize(9).font("Helvetica").text(`Generated: ${now.toLocaleString("en-AE")}`, 40, 64);

  const criteria = [
    `Account / Party: ${party ?? "All Parties"}`,
    startDate || endDate ? `Period: ${startDate ?? "…"} to ${endDate ?? "…"}` : "Period: All time",
  ].join("   ·   ");
  doc.rect(40, 100, W, 28).fill(LIGHT);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(criteria, 52, 109);

  let y = 145;
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
    if (y + totalH + 1 > doc.page.height - 50) {
      doc.addPage();
      y = 40;
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
    if (y + 40 > doc.page.height - 50) { doc.addPage(); y = 40; }
    doc.rect(40, y, W, 1).fill(GOLD);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10)
      .text(`Net Final Cash Balance: AED ${bal2(cashBal)}     ·     Net Final Gold Balance: ${bal3(metalBal)} grams`, 40, y + 8, { width: W, align: "right" });
    doc.fillColor("#666").font("Helvetica").fontSize(7)
      .text("Posting rule: Stock purchase = Cash Debit + Metal Credit. Sale = Cash Credit + Metal Debit. Balances run cumulatively; CR = credit surplus, DR = debit surplus.", 40, y + 24, { width: W });
  }

  doc.end();
});

export default router;
