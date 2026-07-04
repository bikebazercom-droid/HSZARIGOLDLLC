import { Router, type IRouter } from "express";
import { eq, gte, desc, sql } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, customersTable, productsTable, pricesTable } from "@workspace/db";
import { GetDashboardResponse, GetSalesAnalyticsResponse } from "@workspace/api-zod";
import PDFDocument from "pdfkit";

const router: IRouter = Router();

interface CatRow extends Record<string, unknown> {
  category: string;
  invoice_count: string;
  total_amount: string;
  total_weight: string;
}

function getCatStats(rows: CatRow[], category: string) {
  const row = rows.find(r => r.category === category);
  return {
    count: row ? parseInt(row.invoice_count, 10) : 0,
    amount: row ? parseFloat(row.total_amount) : 0,
    grams: row ? parseFloat(row.total_weight) : 0,
  };
}

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

// Date-range filtered sales analytics: /api/dashboard/sales-analytics?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get("/dashboard/sales-analytics", async (req, res): Promise<void> => {
  const startDateParam = req.query.startDate as string;
  const endDateParam = req.query.endDate as string;

  if (!startDateParam || !endDateParam) {
    res.status(400).json({ error: "startDate and endDate are required" });
    return;
  }

  const startDate = new Date(startDateParam);
  const endDate = new Date(endDateParam);
  endDate.setDate(endDate.getDate() + 1); // include the full end day

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    res.status(400).json({ error: "Invalid startDate or endDate" });
    return;
  }

  const [rangeInvoices, rangeCatRows] = await Promise.all([
    db.select().from(invoicesTable).where(gte(invoicesTable.createdAt, startDate)),
    db.execute<CatRow>(sql`
      SELECT
        ii.category,
        COUNT(DISTINCT ii.invoice_id)::text AS invoice_count,
        COALESCE(SUM(ii.total_price::numeric), 0)::text AS total_amount,
        COALESCE(SUM(CASE WHEN ii.weight IS NOT NULL THEN ii.weight::numeric ELSE 0 END), 0)::text AS total_weight
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE i.created_at >= ${startDate}
        AND i.created_at < ${endDate}
        AND ii.category IS NOT NULL
      GROUP BY ii.category
    `).then(r => r.rows as CatRow[]),
  ]);

  const totalRevenue = rangeInvoices
    .filter(inv => inv.createdAt < endDate)
    .reduce((s, inv) => s + Number(inv.total), 0);

  const goldJewelry = getCatStats(rangeCatRows, "gold_jewelry");
  const ttBar = getCatStats(rangeCatRows, "tt_bar");
  const kgBar = getCatStats(rangeCatRows, "kg_bar");
  const totalGrams = goldJewelry.grams + ttBar.grams + kgBar.grams;

  res.json(
    GetSalesAnalyticsResponse.parse({
      startDate: startDateParam,
      endDate: endDateParam,
      totalRevenue,
      totalGrams,
      goldJewelryCount: goldJewelry.count,
      goldJewelryGrams: goldJewelry.grams,
      goldJewelryAmount: goldJewelry.amount,
      ttBarCount: ttBar.count,
      ttBarGrams: ttBar.grams,
      ttBarAmount: ttBar.amount,
      kgBarCount: kgBar.count,
      kgBarGrams: kgBar.grams,
      kgBarAmount: kgBar.amount,
    })
  );
});

// Shared helper for date-range + category filtered invoice lookups (Sales Analytics filter box)
async function getInvoicesForDateRangeAndCategory(category: string, startDate: Date, endDateExclusive: Date) {
  const mainCategories = ["gold_jewelry", "tt_bar", "kg_bar"];

  const allInvoices = await db
    .select()
    .from(invoicesTable)
    .where(gte(invoicesTable.createdAt, startDate))
    .orderBy(desc(invoicesTable.createdAt));

  const inRange = allInvoices.filter(inv => inv.createdAt < endDateExclusive);

  const rows = await Promise.all(
    inRange.map(async (inv) => {
      const allItems = await db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, inv.id));
      const matchingItems = category === "all"
        ? allItems.filter(i => mainCategories.includes(i.category ?? ""))
        : allItems.filter(i => i.category === category);
      return { inv, items: matchingItems };
    })
  );

  return rows.filter(({ items }) => items.length > 0);
}

// Sales Analytics PDF export: /api/dashboard/sales-analytics/pdf?category=all|gold_jewelry|tt_bar|kg_bar&startDate=&endDate=
router.get("/dashboard/sales-analytics/pdf", async (req, res): Promise<void> => {
  const category = (req.query.category as string) || "all";
  const startDateParam = req.query.startDate as string;
  const endDateParam = req.query.endDate as string;

  if (!startDateParam || !endDateParam) {
    res.status(400).json({ error: "startDate and endDate are required" });
    return;
  }

  const startDate = new Date(startDateParam);
  const endDateExclusive = new Date(endDateParam);
  endDateExclusive.setDate(endDateExclusive.getDate() + 1);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDateExclusive.getTime())) {
    res.status(400).json({ error: "Invalid startDate or endDate" });
    return;
  }

  const rows = await getInvoicesForDateRangeAndCategory(category, startDate, endDateExclusive);
  const now = new Date();

  const catLabel = categoryLabel[category] ?? category;
  const filename = `hazari-gold-sales-analytics-${catLabel.toLowerCase().replace(/ /g, "-")}-${startDateParam}-to-${endDateParam}.pdf`;

  const totalGrams = rows.reduce((s, { items }) =>
    s + items.reduce((si, it) => si + (it.weight ? Number(it.weight) : 0), 0), 0);
  const totalAmount = rows.reduce((s, { items }) =>
    s + items.reduce((si, it) => si + Number(it.totalPrice), 0), 0);

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  const NAVY = "#1e3a5f";
  const GOLD = "#c8a43a";
  const LIGHT = "#f5f3ee";

  // Company header
  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor(GOLD).fontSize(22).font("Helvetica-Bold").text("Hazari Gold L.L.C", 40, 22);
  doc.fillColor("#aac4e8").fontSize(10).font("Helvetica").text("Management Portal — Sales Analytics Report", 40, 50);
  doc.fillColor("white").fontSize(9).text(`Generated: ${now.toLocaleString("en-AE")}`, 40, 66);

  // Selected filter parameters
  doc.rect(40, 100, doc.page.width - 80, 36).fill(LIGHT);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11).text(
    `Item: ${catLabel}   |   From: ${startDateParam}   To: ${endDateParam}`,
    52, 112
  );

  // Summary
  doc.moveDown(3.2);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text(
    `Invoices: ${rows.length}   |   Total Grams Sold: ${totalGrams.toFixed(2)} g   |   Total Revenue Generated: AED ${totalAmount.toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
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
    const invAmount = items.reduce((s, i) => s + Number(i.totalPrice), 0);

    doc.fillColor("#1a1a1a").font("Helvetica").fontSize(7.5);
    doc.text(inv.invoiceNumber, cols.no, y + 4, { width: colWidths.no });
    doc.text(date, cols.date, y + 4, { width: colWidths.date });
    doc.text(customer, cols.customer, y + 4, { width: colWidths.customer });
    doc.text(method, cols.method, y + 4, { width: colWidths.method });
    doc.text(cats.substring(0, 16), cols.category, y + 4, { width: colWidths.category });
    doc.text(invGrams > 0 ? invGrams.toFixed(2) : "—", cols.weight, y + 4, { width: colWidths.weight, align: "right" });
    doc.fillColor(NAVY).font("Helvetica-Bold");
    doc.text(invAmount.toLocaleString("en-AE", { minimumFractionDigits: 2 }), cols.total, y + 4, { width: colWidths.total, align: "right" });

    y += rowH;
    rowIndex++;
  }

  if (rows.length === 0) {
    doc.fillColor("#888").font("Helvetica").fontSize(10).text(
      "No invoices found for this filter.",
      40, y + 10, { align: "center", width: doc.page.width - 80 }
    );
  }

  doc.rect(40, y + 8, doc.page.width - 80, 1).fill(GOLD);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9)
    .text(
      `Total Grams Sold: ${totalGrams.toFixed(2)} g   |   Total Revenue Generated: AED ${totalAmount.toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
      40, y + 14, { align: "right", width: doc.page.width - 80 }
    );

  doc.end();
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

export default router;
