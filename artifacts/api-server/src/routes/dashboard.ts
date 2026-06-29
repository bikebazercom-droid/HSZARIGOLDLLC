import { Router, type IRouter } from "express";
import { eq, gte, lte, and, desc, sql } from "drizzle-orm";
import { db, invoicesTable, invoiceItemsTable, customersTable, productsTable, pricesTable } from "@workspace/db";
import { GetDashboardResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [prices] = await db.select().from(pricesTable).limit(1);
  const goldPricePerGram = prices ? Number(prices.goldPricePerGram) : 320;
  const silverPricePerGram = prices ? Number(prices.silverPricePerGram) : 4.5;

  // Today's invoices
  const todayInvoices = await db
    .select()
    .from(invoicesTable)
    .where(gte(invoicesTable.createdAt, startOfToday));

  const todayTotalSale = todayInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);

  // Monthly invoices
  const monthlyInvoices = await db
    .select()
    .from(invoicesTable)
    .where(gte(invoicesTable.createdAt, startOfMonth));

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

  const totalCustomers = await db.$count(customersTable);
  const totalProducts = await db.$count(productsTable);
  const totalInvoices = await db.$count(invoicesTable);

  const pendingInvoices = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.isPending, true));
  const pendingPaymentsCount = pendingInvoices.length;

  // Recent 5 invoices
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
      recentInvoices,
    })
  );
});

export default router;
