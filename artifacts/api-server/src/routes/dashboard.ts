import { Router, type IRouter } from "express";
import { eq, gte, desc, sql } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, customersTable, productsTable, pricesTable } from "@workspace/db";
import { GetDashboardResponse } from "@workspace/api-zod";
import PDFDocument from "pdfkit";

const router: IRouter = Router();

// Helper: get invoice IDs that contain at least one item of a given category
async function getInvoiceIdsByCategory(category: string): Promise<number[]> {
  const rows = await db
    .selectDistinct({ invoiceId: invoiceItemsTable.invoiceId })
    .from(invoiceItemsTable)
    .where(eq(invoiceItemsTable.category, category));
  return rows.map(r => r.invoiceId);
}

// Helper: category stats for a list of invoices
function categoryStats(invoices: typeof invoicesTable.$inferSelect[], ids: number[]) {
  const filtered = invoices.filter(inv => ids.includes(inv.id));
  return {
    count: filtered.length,
    amount: filtered.reduce((sum, inv) => sum + Number(inv.total), 0),
  };
}

// Helper: sum grams from item rows for a given category
function sumGrams(
  rows: { category: string | null; total_weight: string | null }[],
  ...categories: string[]
): number {
  return rows
    .filter(r => r.category && categories.includes(r.category))
    .reduce((sum, r) => sum + (r.total_weight ? parseFloat(r.total_weight) : 0), 0);
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [prices] = await db.select().from(pricesTable).limit(1);
  const goldPricePerGram = prices ? Number(prices.goldPricePerGram) : 320;
  const silverPricePerGram = prices ? Number(prices.silverPricePerGram) : 4.5;

  // Fetch all in parallel
  const [
    todayInvoices,
    monthlyInvoices,
    goldJewelryIds,
    kgBarIds,
    ttBarIds,
    silverIds,
    todayGramRows,
    monthlyGramRows,
  ] = await Promise.all([
    db.select().from(invoicesTable).where(gte(invoicesTable.createdAt, startOfToday)),
    db.select().from(invoicesTable).where(gte(invoicesTable.createdAt, startOfMonth)),
    getInvoiceIdsByCategory("gold_jewelry"),
    getInvoiceIdsByCategory("kg_bar"),
    getInvoiceIdsByCategory("tt_bar"),
    getInvoiceIdsByCategory("silver"),
    // Gram totals per category — today
    db.execute<{ category: string | null; total_weight: string | null }>(
      sql`SELECT ii.category, SUM(ii.weight::numeric) AS total_weight
          FROM invoice_items ii
          JOIN invoices i ON ii.invoice_id = i.id
          WHERE i.created_at >= ${startOfToday}
            AND ii.weight IS NOT NULL
          GROUP BY ii.category`
    ).then(r => r.rows),
    // Gram totals per category — monthly
    db.execute<{ category: string | null; total_weight: string | null }>(
      sql`SELECT ii.category, SUM(ii.weight::numeric) AS total_weight
          FROM invoice_items ii
          JOIN invoices i ON ii.invoice_id = i.id
          WHERE i.created_at >= ${startOfMonth}
            AND ii.weight IS NOT NULL
          GROUP BY ii.category`
    ).then(r => r.rows),
  ]);

  const todayTotalSale = todayInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const monthlySale = monthlyInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const cashCollection = monthlyInvoices
    .filter((inv) => inv.paymentMethod === "cash")
    .reduce((sum, inv) => sum + Number(inv.total), 0);
  const cardCollection = monthlyInvoices
    .filter((inv) => inv.paymentMethod === "card")
    .reduce((sum, inv) => sum + Number(inv.total), 0);
  const bankTransferCollection = monthlyInvoices
    .filter((inv) => inv.paymentMethod === "bank_transfer")
    .reduce((sum, inv) => sum + Number(inv.total), 0);

  // Category stats — today
  const todayGoldJewelry = categoryStats(todayInvoices, goldJewelryIds);
  const todayKgBar = categoryStats(todayInvoices, kgBarIds);
  const todayTtBar = categoryStats(todayInvoices, ttBarIds);
  const todaySilver = categoryStats(todayInvoices, silverIds);

  // Category stats — monthly
  const monthlyGoldJewelry = categoryStats(monthlyInvoices, goldJewelryIds);
  const monthlyKgBar = categoryStats(monthlyInvoices, kgBarIds);
  const monthlyTtBar = categoryStats(monthlyInvoices, ttBarIds);
  const monthlySilver = categoryStats(monthlyInvoices, silverIds);

  // Gram totals — today
  const todayGoldJewelryGrams = sumGrams(todayGramRows, "gold_jewelry");
  const todayKgBarGrams = sumGrams(todayGramRows, "kg_bar");
  const todayTtBarGrams = sumGrams(todayGramRows, "tt_bar");
  const todaySilverGrams = sumGrams(todayGramRows, "silver");
  const todayTotalGoldGrams = todayGoldJewelryGrams + todayKgBarGrams + todayTtBarGrams;

  // Gram totals — monthly
  const monthlyGoldJewelryGrams = sumGrams(monthlyGramRows, "gold_jewelry");
  const monthlyKgBarGrams = sumGrams(monthlyGramRows, "kg_bar");
  const monthlyTtBarGrams = sumGrams(monthlyGramRows, "tt_bar");
  const monthlySilverGrams = sumGrams(monthlyGramRows, "silver");
  const monthlyTotalGoldGrams = monthlyGoldJewelryGrams + monthlyKgBarGrams + monthlyTtBarGrams;

  const [totalCustomers, totalProducts, totalInvoices] = await Promise.all([
    db.$count(customersTable),
    db.$count(productsTable),
    db.$count(invoicesTable),
  ]);

  const pendingInvoices = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.isPending, true));
  const pendingPaymentsCount = pendingInvoices.length;

  const recentRows = await db
    .select()
    .from(invoicesTable)
    .orderBy(desc(invoicesTable.createdAt))
    .limit(5);

  const recentInvoices = await Promise.all(
    recentRows.map(async (inv) => {
      const items = await db
        .select()
        .from(invoiceItemsTable)
        .where(eq(invoiceItemsTable.invoiceId, inv.id));
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
      pendingPaymentsCount,
      goldPricePerGram,
      silverPricePerGram,
      todayGoldJewelryCount: todayGoldJewelry.count,
      todayGoldJewelryAmount: todayGoldJewelry.amount,
      todayKgBarCount: todayKgBar.count,
      todayKgBarAmount: todayKgBar.amount,
      todayTtBarCount: todayTtBar.count,
      todayTtBarAmount: todayTtBar.amount,
      todaySilverCount: todaySilver.count,
      todaySilverAmount: todaySilver.amount,
      monthlyGoldJewelryCount: monthlyGoldJewelry.count,
      monthlyGoldJewelryAmount: monthlyGoldJewelry.amount,
      monthlyKgBarCount: monthlyKgBar.count,
      monthlyKgBarAmount: monthlyKgBar.amount,
      monthlyTtBarCount: monthlyTtBar.count,
      monthlyTtBarAmount: monthlyTtBar.amount,
      monthlySilverCount: monthlySilver.count,
      monthlySilverAmount: monthlySilver.amount,
      todayGoldJewelryGrams,
      todayTotalGoldGrams,
      todayKgBarGrams,
      todayTtBarGrams,
      todaySilverGrams,
      monthlyGoldJewelryGrams,
      monthlyTotalGoldGrams,
      monthlyKgBarGrams,
      monthlyTtBarGrams,
      monthlySilverGrams,
      recentInvoices,
    })
  );
});

// CSV download endpoint: /api/dashboard/download?category=gold_jewelry|kg_bar|tt_bar|silver|all&period=today|monthly
router.get("/dashboard/download", async (req, res): Promise<void> => {
  const category = (req.query.category as string) || "all";
  const period = (req.query.period as string) || "today";

  const now = new Date();
  const startDate = period === "today"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getFullYear(), now.getMonth(), 1);

  let invoices = await db
    .select()
    .from(invoicesTable)
    .where(gte(invoicesTable.createdAt, startDate))
    .orderBy(desc(invoicesTable.createdAt));

  if (category !== "all") {
    const catIds = await getInvoiceIdsByCategory(category);
    invoices = invoices.filter(inv => catIds.includes(inv.id));
  }

  const rows = await Promise.all(
    invoices.map(async (inv) => {
      const items = await db
        .select()
        .from(invoiceItemsTable)
        .where(eq(invoiceItemsTable.invoiceId, inv.id));
      return { inv, items };
    })
  );

  const categoryLabel: Record<string, string> = {
    gold_jewelry: "Gold Jewelry",
    kg_bar: "KG Bar",
    tt_bar: "TT Bar",
    silver: "Silver",
    all: "All",
  };

  const lines: string[] = [
    "Invoice No,Date,Customer,Payment Method,Category,Description,Qty,Weight(g),Unit Price,Total Price,Invoice Total",
  ];

  for (const { inv, items } of rows) {
    const date = new Date(inv.createdAt).toLocaleDateString("en-AE");
    const customer = inv.customerName ?? "Walk-in";
    const method = inv.paymentMethod.replace("_", " ");
    const total = Number(inv.total).toFixed(2);

    if (items.length === 0) {
      lines.push(`"${inv.invoiceNumber}","${date}","${customer}","${method}","","","","","","","${total}"`);
    } else {
      for (const item of items) {
        const cat = categoryLabel[item.category ?? ""] ?? item.category;
        const desc = (item.description ?? "").replace(/"/g, '""');
        lines.push(
          `"${inv.invoiceNumber}","${date}","${customer}","${method}","${cat}","${desc}","${Number(item.quantity)}","${item.weight ?? ""}","${Number(item.unitPrice).toFixed(2)}","${Number(item.totalPrice).toFixed(2)}","${total}"`
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

// PDF download: /api/dashboard/download-pdf?category=gold_jewelry|kg_bar|tt_bar|silver|all&period=today|monthly
router.get("/dashboard/download-pdf", async (req, res): Promise<void> => {
  const category = (req.query.category as string) || "all";
  const period = (req.query.period as string) || "today";

  const now = new Date();
  const startDate = period === "today"
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : new Date(now.getFullYear(), now.getMonth(), 1);

  let invoices = await db
    .select()
    .from(invoicesTable)
    .where(gte(invoicesTable.createdAt, startDate))
    .orderBy(desc(invoicesTable.createdAt));

  if (category !== "all") {
    const catIds = await getInvoiceIdsByCategory(category);
    invoices = invoices.filter(inv => catIds.includes(inv.id));
  }

  const rows = await Promise.all(
    invoices.map(async (inv) => {
      const items = await db
        .select()
        .from(invoiceItemsTable)
        .where(eq(invoiceItemsTable.invoiceId, inv.id));
      return { inv, items };
    })
  );

  const categoryLabel: Record<string, string> = {
    gold_jewelry: "Gold Jewelry",
    kg_bar: "KG Bar",
    tt_bar: "TT Bar",
    silver: "Silver",
    all: "All Categories",
  };

  const periodLabel = period === "today"
    ? `Today — ${now.toLocaleDateString("en-AE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`
    : `Monthly — ${now.toLocaleDateString("en-AE", { year: "numeric", month: "long" })}`;

  const catLabel = categoryLabel[category] ?? category;
  const filename = `hazari-gold-${(categoryLabel[category] ?? category).toLowerCase().replace(/ /g, "-")}-${period}.pdf`;

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

  const cols = { no: 40, date: 110, customer: 190, method: 300, category: 360, weight: 435, total: 480 };
  const colWidths = { no: 65, date: 75, customer: 105, method: 55, category: 70, weight: 42, total: 65 };
  const tableTop = doc.y;

  doc.rect(40, tableTop, doc.page.width - 80, 18).fill(NAVY);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(8);
  doc.text("Invoice #", cols.no, tableTop + 5, { width: colWidths.no });
  doc.text("Date", cols.date, tableTop + 5, { width: colWidths.date });
  doc.text("Customer", cols.customer, tableTop + 5, { width: colWidths.customer });
  doc.text("Method", cols.method, tableTop + 5, { width: colWidths.method });
  doc.text("Category", cols.category, tableTop + 5, { width: colWidths.category });
  doc.text("Weight(g)", cols.weight, tableTop + 5, { width: colWidths.weight, align: "right" });
  doc.text("Total (AED)", cols.total, tableTop + 5, { width: colWidths.total, align: "right" });

  let y = tableTop + 18;
  let rowIndex = 0;

  for (const { inv, items } of rows) {
    const rowH = 16;
    if (y + rowH > doc.page.height - 60) {
      doc.addPage();
      y = 40;
    }
    const bg = rowIndex % 2 === 0 ? "white" : LIGHT;
    doc.rect(40, y, doc.page.width - 80, rowH).fill(bg);

    const date = new Date(inv.createdAt).toLocaleDateString("en-AE");
    const customer = (inv.customerName ?? "Walk-in").substring(0, 18);
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
      40, y + 10,
      { align: "center", width: doc.page.width - 80 }
    );
  }

  doc.rect(40, y + 8, doc.page.width - 80, 1).fill(GOLD);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9)
    .text(
      `Total Weight: ${totalGrams.toFixed(2)} g   |   Grand Total: AED ${grandTotal.toLocaleString("en-AE", { minimumFractionDigits: 2 })}`,
      40, y + 14,
      { align: "right", width: doc.page.width - 80 }
    );

  doc.end();
});

export default router;
