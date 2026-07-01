import { Router, type IRouter } from "express";
import { eq, gte, and, desc, inArray } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, customersTable, productsTable, pricesTable } from "@workspace/db";
import { GetDashboardResponse } from "@workspace/api-zod";

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

router.get("/dashboard", async (_req, res): Promise<void> => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [prices] = await db.select().from(pricesTable).limit(1);
  const goldPricePerGram = prices ? Number(prices.goldPricePerGram) : 320;
  const silverPricePerGram = prices ? Number(prices.silverPricePerGram) : 4.5;

  // Fetch all category invoice ID sets in parallel with main invoice queries
  const [
    todayInvoices,
    monthlyInvoices,
    goldJewelryIds,
    kgBarIds,
    ttBarIds,
  ] = await Promise.all([
    db.select().from(invoicesTable).where(gte(invoicesTable.createdAt, startOfToday)),
    db.select().from(invoicesTable).where(gte(invoicesTable.createdAt, startOfMonth)),
    getInvoiceIdsByCategory("gold_jewelry"),
    getInvoiceIdsByCategory("kg_bar"),
    getInvoiceIdsByCategory("tt_bar"),
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

  // Category stats — monthly
  const monthlyGoldJewelry = categoryStats(monthlyInvoices, goldJewelryIds);
  const monthlyKgBar = categoryStats(monthlyInvoices, kgBarIds);
  const monthlyTtBar = categoryStats(monthlyInvoices, ttBarIds);

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
      monthlyGoldJewelryCount: monthlyGoldJewelry.count,
      monthlyGoldJewelryAmount: monthlyGoldJewelry.amount,
      monthlyKgBarCount: monthlyKgBar.count,
      monthlyKgBarAmount: monthlyKgBar.amount,
      monthlyTtBarCount: monthlyTtBar.count,
      monthlyTtBarAmount: monthlyTtBar.amount,
      recentInvoices,
    })
  );
});

// CSV download endpoint: /api/dashboard/download?category=gold_jewelry|kg_bar|tt_bar|all&period=today|monthly
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
        const cat = categoryLabel[item.category] ?? item.category;
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

export default router;
