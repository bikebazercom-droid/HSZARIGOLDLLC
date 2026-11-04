import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { once } from "node:events";
import { getTableColumns, getTableName, isTable } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, pool, usersTable } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { applyStartupTablesMigration } from "../src/lib/startupTablesMigration.js";
import { applyPricesSingletonMigration } from "../src/lib/pricesSingletonMigration.js";
import { migrateCategoryNamesInTransaction } from "../src/lib/categoryMigration.js";

async function main() {
  assert.equal(process.env.RUN_PRODUCTION_RUNTIME_TEST, "true", "Explicit test opt-in required");
  assert.notEqual(process.env.NODE_ENV, "production", "Never run against a production environment");
  assert.equal(pool.totalCount, 0, "Test must own all connections");
  const namespace = `runtime_test_${randomUUID().replaceAll("-", "")}`;
  // Scope every connection, including HTTP handlers, to an owned empty schema.
  // No public fallback: an omitted table must fail rather than read shop data.
  pool.options.options = `-c search_path=${namespace}`;
  let server: ReturnType<(typeof import("../src/app.js"))["default"]["listen"]> | undefined;
  try {
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, namespace);
    await db.transaction(async (tx) => {
      const execute = async (query: Parameters<typeof tx.execute>[0]) => { await tx.execute(query); };
      await applyStartupTablesMigration(execute);
      await applyStartupTablesMigration(execute);
      await applyPricesSingletonMigration(execute);
      await migrateCategoryNamesInTransaction(tx);
    });
    // Protect against omissions anywhere in the canonical application schema.
    for (const table of Object.values(schema) as unknown[]) {
      if (!isTable(table)) continue;
      const name = getTableName(table);
      const result = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
        [namespace, name],
      );
      const actual = new Set(result.rows.map((row) => row.column_name));
      for (const column of Object.values(getTableColumns(table))) {
        assert.ok(actual.has(column.name), `Bootstrap must create ${name}.${column.name}`);
      }
    }
    const mobile = `01${String(randomInt(100000000, 999999999))}`;
    const pin = String(randomInt(1000, 10000));
    await db.insert(usersTable).values({
      username: "runtime-test-admin", mobile, passwordHash: await bcrypt.hash(pin, 4),
      fullName: "Runtime Test", role: "admin",
    });
    const { default: app } = await import("../src/app.js");
    const { markStartupReady } = await import("../src/lib/startupState.js");
    markStartupReady();
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api`;
    let cookie = "";
    async function request(path: string, method = "GET", body?: unknown, headers?: Record<string, string>) {
      return fetch(`${base}${path}`, {
        method, headers: { "content-type": "application/json", cookie, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    const login = await request("/auth/login", "POST", { mobile, pin, role: "admin" });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    for (const path of ["/dashboard/kpis", "/dashboard/summary-cards", "/wholesale/dashboard"]) {
      const response = await request(path);
      assert.equal(response.status, 200, `${path} works on an empty schema`);
      const result = await response.json() as Record<string, unknown>;
      assert.ok(result && typeof result === "object");
      for (const value of Object.values(result)) {
        if (typeof value === "number") assert.ok(Number.isFinite(value));
      }
      assert.equal(path === "/dashboard/summary-cards" ? result.totalRevenueAed : result.invoiceCount, 0);
      if (path !== "/wholesale/dashboard") assert.equal(result.totalVatAed, 0);
    }
    console.log("PASS: complete schema parity, repeated bootstrap, empty dashboard JSON");
    const billResponse = await request("/purchase-bills", "POST", {
      billNo: "RUNTIME-BILL", billDate: "2026-11-04", supplierName: "Runtime Supplier",
      purchaseType: "fixed", paymentStatus: "paid", items: [{
        category: "gold_9999", grossWeightGrams: 10, purityPercent: 100,
        rateAedPerG: 320, makingChargeAed: 0, lineTotalAed: 3200,
      }],
    });
    assert.equal(billResponse.status, 201, await billResponse.clone().text());
    const bill = await billResponse.json() as { id: number };
    const invoiceInput = {
      customerName: "Runtime Customer", paymentMethod: "cash",
      subtotal: 400, discount: 10, total: 409.5, isPending: false,
      vatAmount: 19.5, vatRate: 5, totalBeforeVat: 390, totalIncludingVat: 409.5,
      items: [{ description: "GOLD 9999", category: "gold_9999", quantity: 1,
        grossWeight: 1, unitPrice: 400, totalPrice: 400 }],
    };
    const invoiceResponses = await Promise.all([
      request("/invoices", "POST", { ...invoiceInput, createdAt: "2026-11-03T12:00:00.000Z" }),
      request("/invoices", "POST", { ...invoiceInput, isPending: true, createdAt: "2026-11-04T12:00:00.000Z" }),
    ]);
    const invoices: Array<{ id: number; invoiceNumber: string }> = [];
    for (const response of invoiceResponses) {
      assert.equal(response.status, 201, await response.clone().text());
      invoices.push(await response.json() as { id: number; invoiceNumber: string });
    }
    assert.notEqual(invoices[0].invoiceNumber, invoices[1].invoiceNumber);
    for (const path of ["/dashboard/kpis", "/dashboard/summary-cards"]) {
      const metrics = await (await request(path)).json() as Record<string, number>;
      assert.equal(metrics.totalRevenueAed, 819);
      assert.equal(metrics.totalVatAed, 39, "VAT includes pending invoices, matching revenue scope");
      assert.equal(metrics.netProfitAed, 140, "819 gross − 39 VAT − 640 FIFO COGS");
    }
    const filtered = await (await request("/dashboard/kpis?startDate=2026-11-03&endDate=2026-11-03")).json() as Record<string, number>;
    assert.equal(filtered.totalRevenueAed, 409.5);
    assert.equal(filtered.totalVatAed, 19.5);
    assert.equal(filtered.netProfitAed, 70);
    const empty = await (await request("/dashboard/kpis?startDate=2020-01-01&endDate=2020-01-01")).json() as Record<string, number>;
    assert.equal(empty.totalVatAed, 0);
    assert.equal(empty.netProfitAed, 0);
    // Simulate an older schema only inside this owned test namespace.
    // Never infer missing historical VAT from today's tax rate.
    await pool.query("ALTER TABLE invoices ALTER COLUMN vat_amount DROP NOT NULL");
    await pool.query("UPDATE invoices SET vat_amount = NULL WHERE id=$1", [invoices[0].id]);
    const legacy = await (await request("/dashboard/kpis")).json() as Record<string, number>;
    assert.equal(legacy.totalVatAed, 19.5);
    assert.equal(legacy.netProfitAed, 159.5);
    await pool.query("UPDATE invoices SET vat_amount = 19.5 WHERE id=$1", [invoices[0].id]);
    await pool.query("ALTER TABLE invoices ALTER COLUMN vat_amount SET NOT NULL");
    console.log("PASS: VAT separated from profit, discounted invoices, pending invoices, date filters, empty metrics, legacy NULL VAT");
    assert.equal(Number((await pool.query("SELECT weight_grams FROM stock_levels WHERE category='gold_9999'")).rows[0].weight_grams), 8);
    assert.equal((await request(`/purchase-bills/${bill.id}`, "DELETE", undefined, { "x-allow-paid-delete": "true" })).status, 409);
    assert.equal(Number((await pool.query("SELECT count(*) FROM purchase_bills")).rows[0].count), 1);
    for (const invoice of invoices) {
      assert.equal((await request(`/invoices/${invoice.id}`, "DELETE", undefined, { "x-allow-invoice-delete": "true" })).status, 204);
    }
    assert.equal(Number((await pool.query("SELECT weight_grams FROM stock_levels WHERE category='gold_9999'")).rows[0].weight_grams), 10);
    assert.equal((await request(`/purchase-bills/${bill.id}`, "DELETE", undefined, { "x-allow-paid-delete": "true" })).status, 204);
    assert.equal(Number((await pool.query("SELECT weight_grams FROM stock_levels WHERE category='gold_9999'")).rows[0].weight_grams), 0);
    for (const table of ["invoices", "invoice_items", "purchase_bills", "purchase_bill_items", "stock_purchases", "inventory_consumptions"]) {
      assert.equal(Number((await pool.query(`SELECT count(*) FROM "${table}"`)).rows[0].count), 0, `${table} cleans up transactionally`);
    }
    assert.equal(Number((await pool.query("SELECT count(*) FROM audit_log WHERE action='delete'")).rows[0].count), 3);
    console.log("PASS: concurrent invoice creation, FIFO stock deduction, consumed-bill guard, invoice/bill deletion, stock reversal, cascade and audit");
    const malformed = await fetch(`${base}/invoices`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{" });
    assert.equal(malformed.status, 400);
    assert.ok((await malformed.json() as { error?: string }).error);
    console.log("PASS: API errors are valid JSON");
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    await pool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    await pool.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
