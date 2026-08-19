import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { db, purchaseBillsTable, purchaseBillItemsTable, stockPurchasesTable, auditLogTable } from "@workspace/db";
import { broadcast } from "../lib/socket.js";
import { createBrandedPdf, PDF_BRAND } from "../lib/pdfBranding.js";
import { requireAdmin } from "../middlewares/auth.js";
import { applyStockDelta } from "./stock.js";
import { authorizePdfTestRun, registerPdfTestFixture, unregisterPdfTestFixture } from "./pdf-test-fixtures.js";
import { acquireStockMutationLock } from "../services/inventoryEngine.js";
import {
  CreatePurchaseBillBody,
  CreatePurchaseBillResponse,
  GetPurchaseBillResponse,
  GetSupplierLiabilityResponse,
  ListPurchaseBillsQueryParams,
  ListPurchaseBillsResponse,
  UpdatePurchaseBillPaymentStatusBody,
  UpdatePurchaseBillPaymentStatusParams,
  UpdatePurchaseBillPaymentStatusResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const CAT_LABEL: Record<string, string> = {
  gold: "GOLD", tt_bar: "TT Bar", kg_bar: "KG Bar", "995": "995",
  gold_jewelry_22k: "Gold Jewelry 22K", silver: "Silver",
};

function parseItem(row: typeof purchaseBillItemsTable.$inferSelect) {
  return {
    id: row.id,
    stockPurchaseId: row.stockPurchaseId,
    category: row.category,
    grossWeightGrams: Number(row.grossWeightGrams),
    purityPercent: Number(row.purityPercent),
    pureWeightGrams: Number(row.pureWeightGrams),
    rateAedPerG: Number(row.rateAedPerG),
    makingChargeAed: Number(row.makingChargeAed),
    lineTotalAed: Number(row.lineTotalAed),
  };
}

function parseBill(
  row: typeof purchaseBillsTable.$inferSelect,
  items: (typeof purchaseBillItemsTable.$inferSelect)[],
) {
  return {
    id: row.id,
    billNo: row.billNo,
    billDate: row.billDate,
    supplierName: row.supplierName,
    purchaseType: row.purchaseType,
    paymentStatus: row.paymentStatus,
    totalGrossGrams: Number(row.totalGrossGrams),
    totalPureGrams: Number(row.totalPureGrams),
    totalAed: Number(row.totalAed),
    notes: row.notes,
    items: items.map(parseItem),
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadBill(id: number) {
  const [bill] = await db.select().from(purchaseBillsTable).where(eq(purchaseBillsTable.id, id));
  if (!bill) return null;
  const items = await db.select().from(purchaseBillItemsTable)
    .where(eq(purchaseBillItemsTable.billId, id)).orderBy(purchaseBillItemsTable.id);
  return { bill, items };
}

// Must be before /:id to avoid Express treating "supplier-liability" as a param.
router.get("/purchase-bills/supplier-liability", requireAdmin, async (_req, res): Promise<void> => {
  const outstandingBills = await db
    .select()
    .from(purchaseBillsTable)
    .where(
      sql`${purchaseBillsTable.paymentStatus} IN ('unpaid', 'unfixed')`
    )
    .orderBy(purchaseBillsTable.supplierName, purchaseBillsTable.billDate);

  // Group by supplier
  const bySupplier = new Map<string, {
    unpaidCount: number;
    unpaidTotalAed: number;
    unfixedCount: number;
    unfixedPureGrams: number;
    billIds: number[];
  }>();

  for (const bill of outstandingBills) {
    const key = bill.supplierName;
    if (!bySupplier.has(key)) {
      bySupplier.set(key, { unpaidCount: 0, unpaidTotalAed: 0, unfixedCount: 0, unfixedPureGrams: 0, billIds: [] });
    }
    const entry = bySupplier.get(key)!;
    entry.billIds.push(bill.id);
    if (bill.paymentStatus === "unpaid") {
      entry.unpaidCount += 1;
      entry.unpaidTotalAed += Number(bill.totalAed);
    } else if (bill.paymentStatus === "unfixed") {
      entry.unfixedCount += 1;
      entry.unfixedPureGrams += Number(bill.totalPureGrams);
    }
  }

  const rows = Array.from(bySupplier.entries()).map(([supplierName, data]) => ({
    supplierName,
    ...data,
  }));

  const totalUnpaidAed = rows.reduce((s, r) => s + r.unpaidTotalAed, 0);
  const totalUnfixedPureGrams = rows.reduce((s, r) => s + r.unfixedPureGrams, 0);

  res.json(GetSupplierLiabilityResponse.parse({ rows, totalUnpaidAed, totalUnfixedPureGrams }));
});

// Raw PDF route (outside the OpenAPI spec): printable supplier liability statement.
router.get("/purchase-bills/supplier-liability/pdf", requireAdmin, async (_req, res): Promise<void> => {
  const outstandingBills = await db
    .select()
    .from(purchaseBillsTable)
    .where(sql`${purchaseBillsTable.paymentStatus} IN ('unpaid', 'unfixed')`)
    .orderBy(purchaseBillsTable.supplierName, purchaseBillsTable.billDate);

  const bySupplier = new Map<string, {
    unpaidCount: number;
    unpaidTotalAed: number;
    unfixedCount: number;
    unfixedPureGrams: number;
  }>();

  for (const bill of outstandingBills) {
    if (!bySupplier.has(bill.supplierName)) {
      bySupplier.set(bill.supplierName, { unpaidCount: 0, unpaidTotalAed: 0, unfixedCount: 0, unfixedPureGrams: 0 });
    }
    const entry = bySupplier.get(bill.supplierName)!;
    if (bill.paymentStatus === "unpaid") {
      entry.unpaidCount += 1;
      entry.unpaidTotalAed += Number(bill.totalAed);
    } else if (bill.paymentStatus === "unfixed") {
      entry.unfixedCount += 1;
      entry.unfixedPureGrams += Number(bill.totalPureGrams);
    }
  }

  const rows = Array.from(bySupplier.entries()).map(([supplierName, data]) => ({ supplierName, ...data }));
  const totalUnpaidAed = rows.reduce((s, r) => s + r.unpaidTotalAed, 0);
  const totalUnfixedPureGrams = rows.reduce((s, r) => s + r.unfixedPureGrams, 0);

  const NAVY = PDF_BRAND.navy;
  const GOLD = PDF_BRAND.gold;
  const GRID = "#d1d5db";
  const LIGHT = "#f5f3ee";

  const generatedAt = new Date();
  const pdf = createBrandedPdf({
    title: "Supplier Liability Statement",
    generatedAt,
  });
  const { doc } = pdf;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="supplier-liability-${generatedAt.toISOString().slice(0, 10)}.pdf"`,
  );
  doc.pipe(res);

  const W = pdf.width;
  const num2 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num3 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  // ── Grand total summary box ──
  const summaryY = pdf.contentTop;
  doc.rect(40, summaryY, W, 52).fillAndStroke(LIGHT, GRID);
  doc.fillColor("#666").font("Helvetica").fontSize(9).text("Outstanding Summary", 52, summaryY + 8);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(11)
    .text(`Total Unpaid (Cash):  AED ${num2(totalUnpaidAed)}`, 52, summaryY + 22, { lineBreak: false });
  doc.fillColor("#b45309").font("Helvetica-Bold").fontSize(11)
    .text(`Total Unfixed (Metal):  ${num3(totalUnfixedPureGrams)} g`, 52, summaryY + 36, { lineBreak: false });

  // ── Per-supplier table ──
  let y = summaryY + 66;

  // Column definitions: [label, width, right-align?]
  const cols: [string, number, boolean?][] = [
    ["Supplier", 175],
    ["Unpaid Bills", 65, true],
    ["Unpaid (AED)", 90, true],
    ["Unfixed Bills", 65, true],
    ["Unfixed (Pure g)", 120, true],
  ];

  const drawRow = (
    cells: [string, number, boolean?][],
    bg: string,
    color: string,
    bold: boolean,
    h = 18,
  ) => {
    if (y + h > pdf.contentBottom) {
      y = pdf.addPage();
      if (cells !== cols) {
        drawRow(cols, "#1e293b", "white", true);
      }
    }
    let x = 40;
    doc.lineWidth(0.5);
    for (const [text, width, right] of cells) {
      doc.rect(x, y, width, h).fillAndStroke(bg, GRID);
      doc.fillColor(color).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      doc.text(text, x + 5, y + (h - 9) / 2, {
        width: width - 10,
        align: right ? "right" : "left",
        lineBreak: false,
      });
      x += width;
    }
    y += h;
  };

  // Header row
  drawRow(cols, "#1e293b", "white", true);

  if (rows.length === 0) {
    y = pdf.ensureSpace(y, 24);
    doc.rect(40, y, W, 24).fillAndStroke("white", GRID);
    doc.fillColor("#888").font("Helvetica-Oblique").fontSize(9)
      .text("No outstanding liabilities.", 52, y + 7, { lineBreak: false });
    y += 24;
  } else {
    rows.forEach((row, i) => {
      drawRow([
        [row.supplierName, 175],
        [row.unpaidCount > 0 ? String(row.unpaidCount) : "—", 65, true],
        [row.unpaidCount > 0 ? `AED ${num2(row.unpaidTotalAed)}` : "—", 90, true],
        [row.unfixedCount > 0 ? String(row.unfixedCount) : "—", 65, true],
        [row.unfixedCount > 0 ? `${num3(row.unfixedPureGrams)} g` : "—", 120, true],
      ], i % 2 === 0 ? "white" : "#f8fafc", "#1a1a1a", false);
    });

    // Totals row
    drawRow([
      ["TOTAL", 175],
      [String(rows.reduce((s, r) => s + r.unpaidCount, 0)), 65, true],
      [`AED ${num2(totalUnpaidAed)}`, 90, true],
      [String(rows.reduce((s, r) => s + r.unfixedCount, 0)), 65, true],
      [`${num3(totalUnfixedPureGrams)} g`, 120, true],
    ], "#eee6cf", NAVY, true, 20);
  }

  // ── Footer note ──
  y += 14;
  y = pdf.ensureSpace(y, 38);
  doc.rect(40, y, W, 38).fillAndStroke("#fdf9ee", GOLD);
  doc.fillColor("#666").font("Helvetica").fontSize(8.5)
    .text(
      "This statement reflects all purchase bills currently marked as Unpaid / Liability or Unfixed Balance. " +
      "Settle individual bills via the Purchase Bills screen to remove them from this report.",
      52, y + 8,
      { width: W - 24 },
    );
  y += 38;

  pdf.finish(y);
});

// Configurable capacity-warning threshold: emit a warning flag when the table
// has more than this many rows so admins can prune before inserts start failing.
const AUDIT_LOG_WARN_THRESHOLD = (() => {
  const raw = process.env.AUDIT_LOG_WARN_THRESHOLD;
  if (!raw) return 10_000;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return 10_000;
  return parsed;
})();

// Keep in sync with the cleanup service default.
const AUDIT_LOG_RETENTION_MONTHS = (() => {
  const raw = process.env.AUDIT_LOG_RETENTION_MONTHS;
  if (!raw) return 24;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return 24;
  return parsed;
})();

// Audit log: recent destructive actions on purchase bills (most recent first).
// Returns the 200 most-recent entries plus capacity metadata so the UI can
// warn admins before the table grows large enough to cause silent failures.
router.get("/purchase-bills/audit-log", requireAdmin, async (_req, res): Promise<void> => {
  // Run the count and the row fetch in parallel.
  const [[{ totalCount }], entries] = await Promise.all([
    db.select({ totalCount: count() }).from(auditLogTable),
    db
      .select()
      .from(auditLogTable)
      .orderBy(desc(auditLogTable.createdAt))
      .limit(200),
  ]);

  const capacityWarning = totalCount >= AUDIT_LOG_WARN_THRESHOLD;

  res.json({
    totalCount,
    warnThreshold: AUDIT_LOG_WARN_THRESHOLD,
    capacityWarning,
    retentionMonths: AUDIT_LOG_RETENTION_MONTHS,
    entries: entries.map((e) => ({
      id: e.id,
      actorId: e.actorId,
      entityType: e.entityType,
      entityId: e.entityId,
      action: e.action,
      billNo: e.billNo,
      details: (() => { try { return JSON.parse(e.details); } catch { return {}; } })(),
      createdAt: e.createdAt.toISOString(),
    })),
  });
});

// Permanently delete selected audit-log entries in one request. Like the
// single-entry route, this is intentionally traceless: an administrator has
// explicitly chosen to remove these records forever.
router.delete("/purchase-bills/audit-log/bulk", requireAdmin, async (req, res): Promise<void> => {
  // Keep the same CSRF protection as the single-entry permanent deletion.
  const origin = req.headers.origin;
  if (origin) {
    const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || req.headers.host;
    let originHost: string | null = null;
    try { originHost = new URL(origin).host; } catch { /* malformed origin */ }
    if (!originHost || originHost !== host) {
      res.status(403).json({ error: "Cross-origin request rejected" });
      return;
    }
  }

  const rawIds = req.body?.ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > 200) {
    res.status(400).json({ error: "Provide between 1 and 200 audit entry ids" });
    return;
  }
  const ids = [...new Set(rawIds)];
  if (!ids.every((id) => Number.isInteger(id) && id > 0)) {
    res.status(400).json({ error: "Audit entry ids must be positive integers" });
    return;
  }

  const deleted = await db.delete(auditLogTable)
    .where(inArray(auditLogTable.id, ids))
    .returning({ id: auditLogTable.id });
  res.json({ deletedCount: deleted.length });
});

// Permanently delete a single audit-log entry. This is an explicit admin
// action: the row is removed outright and — by design — no trace of the
// deletion is recorded anywhere (no audit entry about the audit deletion).
router.delete("/purchase-bills/audit-log/:id", requireAdmin, async (req, res): Promise<void> => {
  // CSRF hardening: this deletion is irrecoverable and intentionally traceless,
  // so require that any browser-sent Origin matches the request host. Non-browser
  // clients (curl) send no Origin and are already gated by the admin session.
  const origin = req.headers.origin;
  if (origin) {
    const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || req.headers.host;
    let originHost: string | null = null;
    try { originHost = new URL(origin).host; } catch { /* malformed origin */ }
    if (!originHost || originHost !== host) {
      res.status(403).json({ error: "Cross-origin request rejected" });
      return;
    }
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid audit entry id" });
    return;
  }
  const deleted = await db.delete(auditLogTable).where(eq(auditLogTable.id, id)).returning({ id: auditLogTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Audit entry not found" });
    return;
  }
  res.status(204).end();
});

router.get("/purchase-bills", requireAdmin, async (req, res): Promise<void> => {
  const query = ListPurchaseBillsQueryParams.safeParse(req.query);
  const { supplier, startDate, endDate } = query.success ? query.data : {} as Record<string, string | undefined>;
  const conditions = [];
  if (supplier) conditions.push(ilike(purchaseBillsTable.supplierName, `%${supplier}%`));
  if (startDate) conditions.push(gte(purchaseBillsTable.billDate, startDate));
  if (endDate) conditions.push(lte(purchaseBillsTable.billDate, endDate));

  const bills = await db.select().from(purchaseBillsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(purchaseBillsTable.billDate), desc(purchaseBillsTable.id));
  const items = bills.length
    ? await db.select().from(purchaseBillItemsTable)
        .where(inArray(purchaseBillItemsTable.billId, bills.map((b) => b.id)))
        .orderBy(purchaseBillItemsTable.id)
    : [];
  res.json(ListPurchaseBillsResponse.parse(
    bills.map((b) => parseBill(b, items.filter((i) => i.billId === b.id))),
  ));
});

router.get("/purchase-bills/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const loaded = await loadBill(id);
  if (!loaded) { res.status(404).json({ error: "Bill not found" }); return; }
  res.json(GetPurchaseBillResponse.parse(parseBill(loaded.bill, loaded.items)));
});

router.post("/purchase-bills", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreatePurchaseBillBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  // The server is authoritative for money math: line total = gross x rate +
  // making. The client-sent value is only accepted as a cross-check (rounding
  // tolerance); a bigger mismatch is rejected as a tampered/buggy payload.
  const withPure: ((typeof input.items)[number] & {
    makingChargeAed: number;
    lineTotalAed: number;
    pureWeightGrams: number;
  })[] = [];
  for (let i = 0; i < input.items.length; i++) {
    const it = input.items[i];
    const making = it.makingChargeAed ?? 0;
    const computedTotal = Math.round((it.grossWeightGrams * it.rateAedPerG + making) * 100) / 100;
    if (Math.abs(computedTotal - it.lineTotalAed) > 0.05) {
      res.status(400).json({ error: `Line ${i + 1}: lineTotalAed ${it.lineTotalAed} does not match gross x rate + making = ${computedTotal}` });
      return;
    }
    withPure.push({
      ...it,
      makingChargeAed: making,
      lineTotalAed: computedTotal,
      pureWeightGrams: it.grossWeightGrams * (it.purityPercent / 100),
    });
  }
  const totalGross = withPure.reduce((s, it) => s + it.grossWeightGrams, 0);
  const totalPure = withPure.reduce((s, it) => s + it.pureWeightGrams, 0);
  const totalAed = withPure.reduce((s, it) => s + it.lineTotalAed, 0);

  // If a registered test run requested ownership, record the created bill in
  // the durable test registry atomically with its creation, so a crash right
  // after the commit can never leave an unregistered (unrecoverable) record.
  const testRun = await authorizePdfTestRun(req);
  if (testRun.requested && !testRun.runId) {
    // Never silently create an unregistered record for a caller that asked
    // for fixture ownership — that would defeat crash recovery.
    res.status(403).json({ error: "Test fixture ownership was rejected" });
    return;
  }
  const created = await db.transaction(async (tx) => {
    const [bill] = await tx.insert(purchaseBillsTable).values({
      billNo: input.billNo.trim(),
      billDate: input.billDate,
      supplierName: input.supplierName.trim(),
      purchaseType: input.purchaseType,
      paymentStatus: input.paymentStatus,
      totalGrossGrams: String(totalGross),
      totalPureGrams: String(totalPure),
      totalAed: String(totalAed),
      notes: input.notes?.trim() || null,
    }).returning();

    const itemRows = [];
    for (const it of withPure) {
      // Each bill line becomes its own FIFO stock batch so inventory,
      // dual-ledger, and statement outputs keep working unchanged.
      const [sp] = await tx.insert(stockPurchasesTable).values({
        category: it.category,
        supplierName: input.supplierName.trim(),
        purchaseDate: input.billDate,
        weightGrams: String(it.grossWeightGrams),
        totalPriceAed: String(it.lineTotalAed),
        pricePerGram: String(it.grossWeightGrams > 0 ? Math.round((it.lineTotalAed / it.grossWeightGrams) * 10000) / 10000 : 0),
        remainingWeightGrams: String(it.grossWeightGrams),
        narrative: `Bill ${input.billNo.trim()} · ${it.purityPercent}% purity (${input.purchaseType})`,
      }).returning();
      await applyStockDelta(tx as unknown as typeof db, it.category, it.grossWeightGrams, "purchase", "purchase_bill", bill.id);
      const [row] = await tx.insert(purchaseBillItemsTable).values({
        billId: bill.id,
        stockPurchaseId: sp.id,
        category: it.category,
        grossWeightGrams: String(it.grossWeightGrams),
        purityPercent: String(it.purityPercent),
        pureWeightGrams: String(Math.round(it.pureWeightGrams * 10000) / 10000),
        rateAedPerG: String(it.rateAedPerG),
        makingChargeAed: String(it.makingChargeAed),
        lineTotalAed: String(it.lineTotalAed),
      }).returning();
      itemRows.push(row);
    }
    await registerPdfTestFixture(tx as unknown as typeof db, testRun.runId, "purchase_bill", bill.id);
    return { bill, itemRows };
  });

  res.status(201).json(CreatePurchaseBillResponse.parse(parseBill(created.bill, created.itemRows)));
  broadcast("STOCK_MUTATION");
});

router.delete("/purchase-bills/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const allowPaidDelete = req.headers["x-allow-paid-delete"] === "true";

  let consumedConflict = false;
  let paidGuardRejected = false;
  let rejectedBillNo = "";
  const deleted = await db.transaction(async (tx) => {
    // Lock the bill row first to prevent a concurrent payment-status update from
    // racing between our status check and the actual delete.
    const [lockedBill] = await tx.select()
      .from(purchaseBillsTable)
      .where(eq(purchaseBillsTable.id, id))
      .for("update");
    if (!lockedBill) return null;

    // Hard guard (enforced inside the transaction with the row lock held):
    // paid bills cannot be deleted unless the caller explicitly opts in.
    if (lockedBill.paymentStatus === "paid" && !allowPaidDelete) {
      paidGuardRejected = true;
      rejectedBillNo = lockedBill.billNo;
      return null;
    }

    const items = await tx.select().from(purchaseBillItemsTable).where(eq(purchaseBillItemsTable.billId, id));
    const batchIds = items.map((it) => it.stockPurchaseId).filter((v): v is number => v != null);
    // Lock the linked batches so a concurrent sale cannot consume them while
    // we decide; reject deletion if any batch is already (partially) sold —
    // reversing a consumed batch would corrupt live stock and FIFO history.
    if (batchIds.length) {
      // Same lock protocol as settlement/FIFO: take the global stock-mutation
      // advisory lock before batch row locks to prevent deadlock with sales.
      await acquireStockMutationLock(tx as unknown as typeof db);
      const batches = await tx.select().from(stockPurchasesTable)
        .where(inArray(stockPurchasesTable.id, batchIds)).for("update");
      if (batches.some((b) => Number(b.remainingWeightGrams) < Number(b.weightGrams))) {
        consumedConflict = true;
        return null;
      }
    }
    const [bill] = await tx.delete(purchaseBillsTable).where(eq(purchaseBillsTable.id, id)).returning();
    if (bill) {
      // The test registry must only list records that still exist.
      await unregisterPdfTestFixture(tx as unknown as typeof db, "purchase_bill", id);
    }
    if (!bill) return null;
    // Reverse each linked stock batch (same semantics as deleting a purchase).
    for (const it of items) {
      if (it.stockPurchaseId == null) continue;
      const [sp] = await tx.delete(stockPurchasesTable)
        .where(eq(stockPurchasesTable.id, it.stockPurchaseId)).returning();
      if (sp) {
        await applyStockDelta(
          tx as unknown as typeof db, sp.category, -Number(sp.weightGrams),
          "purchase_reversal", "purchase_bill", id,
          `Deleted bill ${bill.billNo} (${bill.supplierName})`,
        );
      }
    }
    // Write an immutable audit log entry so the deletion is traceable after the fact.
    await tx.insert(auditLogTable).values({
      actorId: req.session?.userId ?? null,
      entityType: "purchase_bill",
      entityId: id,
      action: "delete",
      billNo: bill.billNo,
      details: JSON.stringify({
        billNo: bill.billNo,
        billDate: bill.billDate,
        supplierName: bill.supplierName,
        purchaseType: bill.purchaseType,
        paymentStatus: bill.paymentStatus,
        totalGrossGrams: bill.totalGrossGrams,
        totalPureGrams: bill.totalPureGrams,
        totalAed: bill.totalAed,
        notes: bill.notes,
        itemCount: items.length,
      }),
    });
    return bill;
  });
  if (paidGuardRejected) {
    res.status(403).json({
      error: `Bill ${rejectedBillNo} is marked Paid in Cash. Paid bills are protected from deletion. Unlock deletion in the UI before attempting this action.`,
    });
    return;
  }
  if (consumedConflict) {
    res.status(409).json({ error: "This bill's stock has already been partially or fully sold. Delete the related invoices first, or keep the bill for record integrity." });
    return;
  }
  if (!deleted) { res.status(404).json({ error: "Bill not found" }); return; }
  res.status(204).end();
  broadcast("STOCK_MUTATION");
});

router.patch("/purchase-bills/:id/payment-status", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdatePurchaseBillPaymentStatusParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const { id } = params.data;
  const body = UpdatePurchaseBillPaymentStatusBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const toStatus = body.data.paymentStatus;
  // Normalize the fixing rate to the DB's numeric scale (4dp) so the stored
  // rate exactly reproduces the stored totals, and bound it to sane magnitude.
  const rawFixingRate = body.data.fixingRateAedPerG;
  if (rawFixingRate != null && (!Number.isFinite(rawFixingRate) || rawFixingRate <= 0 || rawFixingRate > 1_000_000)) {
    res.status(400).json({ error: "fixingRateAedPerG must be a positive number up to 1,000,000" });
    return;
  }
  const fixingRate = rawFixingRate != null ? Math.round(rawFixingRate * 10000) / 10000 : undefined;

  // Run the read, update, and audit insert atomically so:
  //   • concurrent requests cannot both read the same old status and produce a
  //     spurious or duplicate audit event
  //   • if the audit insert fails the status update is rolled back, preventing
  //     an untracked change (mirrors the deletion path's transaction pattern)
  let notFound = false;
  let updated;
  try {
    updated = await db.transaction(async (tx) => {
    // Lock the row first so the "from" snapshot is stable for the whole transaction.
    const [locked] = await tx
      .select()
      .from(purchaseBillsTable)
      .where(eq(purchaseBillsTable.id, id))
      .for("update");
    if (!locked) { notFound = true; return null; }

    const fromStatus = locked.paymentStatus;

    // Fixing-rate settlement: when settling an unfixed bill, an optional fixing
    // rate reprices every line as pure weight x rate. Bill totals, item rows,
    // and the linked FIFO stock batches are all updated in this transaction so
    // COGS and the dual-ledger cash debit stay consistent.
    let newTotalAed: number | null = null;
    // Financial invariant: an unfixed bill cannot be marked paid without a
    // fixing rate — the settled amount would otherwise silently stay 0.
    if (fromStatus === "unfixed" && toStatus === "paid" && fixingRate == null) {
      throw Object.assign(new Error("A fixing rate is required to settle an unfixed bill to Paid"), { statusCode: 400 });
    }
    if (fixingRate != null) {
      if (fromStatus !== "unfixed") {
        throw Object.assign(new Error("Fixing rate can only be applied to a bill that is currently Unfixed"), { statusCode: 409 });
      }
      if (toStatus !== "paid") {
        throw Object.assign(new Error("Fixing rate requires the new status to be Paid"), { statusCode: 400 });
      }
      const items = await tx.select().from(purchaseBillItemsTable)
        .where(eq(purchaseBillItemsTable.billId, id))
        .orderBy(purchaseBillItemsTable.id)
        .for("update");
      // Lock the linked stock batches so a concurrent sale cannot consume them
      // while we reprice. Already-consumed batches are allowed: their past FIFO
      // consumption rows are retroactively repriced below so COGS/profit follow
      // the fixing rate instead of the provisional zero cost.
      const batchIds = items.map((it) => it.stockPurchaseId).filter((v): v is number => v != null);
      if (batchIds.length > 0) {
        // Serialize with FIFO consumption/reversal via the global stock
        // mutation advisory lock before taking batch row locks — the two
        // paths lock batch rows in different orders and would otherwise
        // be able to deadlock.
        await acquireStockMutationLock(tx as unknown as typeof db);
        await tx.select().from(stockPurchasesTable)
          .where(inArray(stockPurchasesTable.id, batchIds))
          .for("update");
      }
      let sum = 0;
      for (const item of items) {
        const pure = Number(item.pureWeightGrams);
        const gross = Number(item.grossWeightGrams);
        const lineTotal = Math.round(pure * fixingRate * 100) / 100;
        sum += lineTotal;
        await tx.update(purchaseBillItemsTable)
          .set({ rateAedPerG: String(fixingRate), lineTotalAed: String(lineTotal) })
          .where(eq(purchaseBillItemsTable.id, item.id));
        if (item.stockPurchaseId != null) {
          await tx.update(stockPurchasesTable)
            .set({
              totalPriceAed: String(lineTotal),
              pricePerGram: String(gross > 0 ? Math.round((lineTotal / gross) * 10000) / 10000 : 0),
            })
            .where(eq(stockPurchasesTable.id, item.stockPurchaseId));
        }
      }
      // Retroactive COGS adjustment: any FIFO consumption slice that already
      // pulled from these batches was costed at the provisional (zero) rate.
      // Reprice those ledger rows from the batch's new price_per_gram so the
      // dashboard's "Purchase Cost of Sold Items", per-invoice profit, and
      // statement PDFs (all derived from inventory_consumptions.cost_aed)
      // reflect the fixing rate without deleting invoices.
      if (batchIds.length > 0) {
        await tx.execute(sql`
          UPDATE inventory_consumptions c
          SET cost_aed = ROUND(c.weight_grams::numeric * sp.price_per_gram::numeric, 2)
          FROM stock_purchases sp
          WHERE c.purchase_id = sp.id AND c.purchase_id IN (${sql.join(batchIds.map((b) => sql`${b}`), sql`, `)})
        `);
      }
      newTotalAed = Math.round(sum * 100) / 100;
    }

    const [upd] = await tx
      .update(purchaseBillsTable)
      .set({
        paymentStatus: toStatus,
        ...(newTotalAed != null ? { totalAed: String(newTotalAed) } : {}),
      })
      .where(eq(purchaseBillsTable.id, id))
      .returning();
    if (!upd) { notFound = true; return null; }

    // Only write an audit entry when the status actually changes; no-op requests
    // (from === to) from direct API callers are not logged.
    if (fromStatus !== toStatus) {
      await tx.insert(auditLogTable).values({
        actorId: req.session?.userId ?? null,
        entityType: "purchase_bill",
        entityId: id,
        action: "update_payment_status",
        billNo: upd.billNo,
        details: JSON.stringify({
          from: fromStatus,
          to: toStatus,
          billNo: upd.billNo,
          supplierName: upd.supplierName,
          ...(fixingRate != null ? { fixingRateAedPerG: fixingRate, settledTotalAed: newTotalAed } : {}),
        }),
      });
    }

    return upd;
    });
  } catch (err: any) {
    if (typeof err?.statusCode === "number") {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    throw err;
  }

  if (notFound || !updated) { res.status(404).json({ error: "Bill not found" }); return; }

  const items = await db.select().from(purchaseBillItemsTable)
    .where(eq(purchaseBillItemsTable.billId, id)).orderBy(purchaseBillItemsTable.id);
  res.json(UpdatePurchaseBillPaymentStatusResponse.parse(parseBill(updated, items)));
});

// Raw PDF route (outside the OpenAPI spec, like other document downloads):
// formal "Purchase Receipt / Bill Confirmation" for record-keeping.
router.get("/purchase-bills/:id/pdf", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const loaded = await loadBill(id);
  if (!loaded) { res.status(404).json({ error: "Bill not found" }); return; }
  const { bill, items } = loaded;

  const NAVY = PDF_BRAND.navy;
  const GOLD = PDF_BRAND.gold;
  const GRID = "#d1d5db";
  const LIGHT = "#f5f3ee";
  const pdf = createBrandedPdf({
    title: "Purchase Receipt / Bill Confirmation",
  });
  const { doc } = pdf;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="purchase-bill-${bill.billNo.replace(/[^A-Za-z0-9-_]/g, "_")}.pdf"`);
  doc.pipe(res);

  const W = pdf.width; // 515 for A4 portrait
  const num2 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num3 = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  // Bill meta box
  const meta: [string, string][] = [
    ["Bill No / Ref:", bill.billNo],
    ["Bill Date:", bill.billDate],
    ["Supplier:", bill.supplierName],
    ["Purchase Type:", bill.purchaseType === "fixed" ? "Fixed Purchase" : "Unfixed Purchase"],
    ["Payment Status:", bill.paymentStatus === "paid" ? "Paid in Cash" : bill.paymentStatus === "unpaid" ? "Unpaid / Liability" : "Unfixed Balance"],
  ];
  doc.rect(40, pdf.contentTop, W, 20 + meta.length * 16).fillAndStroke(LIGHT, GRID);
  let my = pdf.contentTop + 10;
  for (const [k, v] of meta) {
    doc.fillColor("#666").font("Helvetica").fontSize(9).text(k, 52, my, { lineBreak: false });
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(v, 160, my);
    my += 16;
  }

  // Items table — widths sum to 515.
  let y = pdf.contentTop + 20 + meta.length * 16 + 18;
  const header: [string, number, boolean?][] = [
    ["Category", 95], ["Gross Wt (g)", 70, true], ["Purity %", 55, true],
    ["Pure Wt (g)", 70, true], ["Rate (AED/g)", 70, true],
    ["Making (AED)", 70, true], ["Line Total (AED)", 85, true],
  ];
  const drawRow = (cells: [string, number, boolean?][], bg: string, color: string, bold: boolean, h = 18) => {
    if (y + h > pdf.contentBottom) {
      y = pdf.addPage();
      if (cells !== header) {
        drawRow(header, "#1e293b", "white", true);
      }
    }
    let x = 40;
    doc.lineWidth(0.5);
    for (const [text, width, right] of cells) {
      doc.rect(x, y, width, h).fillAndStroke(bg, GRID);
      doc.fillColor(color).font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      doc.text(text, x + 5, y + (h - 9) / 2, { width: width - 10, align: right ? "right" : "left", lineBreak: false });
      x += width;
    }
    y += h;
  };
  drawRow(header, "#1e293b", "white", true);
  items.forEach((raw, i) => {
    const it = parseItem(raw);
    drawRow([
      [CAT_LABEL[it.category] ?? it.category, 95],
      [num3(it.grossWeightGrams), 70, true],
      [num2(it.purityPercent), 55, true],
      [num3(it.pureWeightGrams), 70, true],
      [num2(it.rateAedPerG), 70, true],
      [num2(it.makingChargeAed), 70, true],
      [num2(it.lineTotalAed), 85, true],
    ], i % 2 === 0 ? "white" : "#f8fafc", "#1a1a1a", false);
  });
  drawRow([
    ["TOTAL", 95],
    [num3(Number(bill.totalGrossGrams)), 70, true],
    ["", 55],
    [num3(Number(bill.totalPureGrams)), 70, true],
    ["", 70],
    ["", 70],
    [`AED ${num2(Number(bill.totalAed))}`, 85, true],
  ], "#eee6cf", NAVY, true, 20);

  y += 14;
  y = pdf.ensureSpace(y, 58);
  doc.rect(40, y, W, 44).fillAndStroke("#fdf9ee", GOLD);
  doc.fillColor("#666").font("Helvetica").fontSize(8.5)
    .text("Ledger posting: Metal Credit (+ weight) to supplier & master ledger; Cash Debit (+ cost) to supplier account.", 52, y + 8, { width: W - 24 });
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10)
    .text(`Total Metal Credit: ${num3(Number(bill.totalGrossGrams))} g     ·     Total Cash Debit: AED ${num2(Number(bill.totalAed))}`, 52, y + 24, { width: W - 24 });
  y += 58;
  if (bill.notes) {
    doc.fillColor("#444").font("Helvetica-Oblique").fontSize(8.5);
    let remaining = `Notes: ${bill.notes}`.trim();
    const lineHeight = doc.currentLineHeight(true);

    while (remaining.length > 0) {
      if (y + lineHeight > pdf.contentBottom) {
        y = pdf.addPage();
      }

      const availableHeight = pdf.contentBottom - y;
      const fullHeight = doc.heightOfString(remaining, { width: W });
      if (fullHeight <= availableHeight) {
        doc.text(remaining, 40, y, { width: W });
        y += fullHeight + 8;
        break;
      }

      // Find the largest prefix that fits on this page. Prefer a whitespace
      // boundary, while still making progress for unusually long unbroken text.
      let low = 1;
      let high = remaining.length;
      let best = 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = remaining.slice(0, middle);
        const candidateHeight = doc.heightOfString(candidate, { width: W });
        if (candidateHeight <= availableHeight) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      const whitespaceBoundary = remaining.lastIndexOf(" ", best);
      if (whitespaceBoundary > 0) {
        best = whitespaceBoundary;
      }
      const chunk = remaining.slice(0, best).trimEnd();
      const chunkHeight = doc.heightOfString(chunk, { width: W });
      doc.text(chunk, 40, y, { width: W });
      y += chunkHeight;
      remaining = remaining.slice(best).trimStart();

      if (remaining.length > 0) {
        y = pdf.addPage();
      }
    }
  }

  pdf.finish(y);
});

export default router;
