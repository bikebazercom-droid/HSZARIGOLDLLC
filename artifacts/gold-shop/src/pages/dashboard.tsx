import React from "react";
import { Link } from "wouter";
import { useGetDashboard, getGetDashboardQueryKey, useGetMonthlySales, getGetMonthlySalesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { Plus, Download, FileText } from "lucide-react";

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadCSV(category: string, period: "today" | "monthly") {
  triggerDownload(`/api/dashboard/download?category=${category}&period=${period}`);
}

function downloadPDF(category: string, period: "today" | "monthly") {
  triggerDownload(`/api/dashboard/download-pdf?category=${category}&period=${period}`);
}

interface StatBoxProps {
  title: string;
  count: number;
  amount: number;
  color?: string;
  category: string;
  period: "today" | "monthly";
}

function StatBox({ title, count, amount, color = "#1e3a5f", category, period }: StatBoxProps) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: color }} />
      <CardHeader className="pb-1 pt-3 pl-5 pr-3 flex flex-row items-start justify-between space-y-0">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground leading-tight pt-0.5">
          {title}
        </CardTitle>
        <div className="flex gap-0.5 flex-shrink-0 -mt-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={`Download CSV`}
            onClick={() => downloadCSV(category, period)}
          >
            <Download className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title={`Download PDF`}
            onClick={() => downloadPDF(category, period)}
          >
            <FileText className="w-3 h-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pl-5 pb-4 pt-1">
        <div className="text-xl font-bold" style={{ color }}>
          AED {amount.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {count} {count === 1 ? "invoice" : "invoices"}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data, isLoading } = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });
  const { data: monthlySales, isLoading: isMonthlySalesLoading } = useGetMonthlySales({ query: { queryKey: getGetMonthlySalesQueryKey() } });

  if (isLoading || isMonthlySalesLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (!data) return <div>Failed to load dashboard</div>;

  const todayDate = format(new Date(), "MMMM d, yyyy");
  const monthName = format(new Date(), "MMMM yyyy");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-primary">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{todayDate}</p>
        </div>
        <Link href="/invoices/new">
          <Button size="sm"><Plus className="w-4 h-4 mr-1.5" /> New Invoice</Button>
        </Link>
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="bg-primary text-primary-foreground border-primary col-span-2 md:col-span-1">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium opacity-80">Today's Total</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-bold">AED {data.todayTotalSale?.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Monthly Total</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold">AED {data.monthlySale?.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Pending</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold text-destructive">{data.pendingPaymentsCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Gold/g</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold">AED {data.goldPricePerGram}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Silver/g</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold">AED {data.silverPricePerGram}</div>
          </CardContent>
        </Card>
      </div>

      {/* TODAY category breakdown */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-foreground">Today's Sales Breakdown</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadCSV("all", "today")}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadPDF("all", "today")}>
              <FileText className="w-3.5 h-3.5 mr-1.5" /> PDF
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatBox
            title="Gold Jewelry"
            count={data.todayGoldJewelryCount}
            amount={data.todayGoldJewelryAmount}
            color="#c8a43a"
            category="gold_jewelry"
            period="today"
          />
          <StatBox
            title="Total Gold Sales"
            count={data.todayGoldJewelryCount + data.todayKgBarCount + data.todayTtBarCount}
            amount={data.todayGoldJewelryAmount + data.todayKgBarAmount + data.todayTtBarAmount}
            color="#1e3a5f"
            category="all"
            period="today"
          />
          <StatBox
            title="KG Bar"
            count={data.todayKgBarCount}
            amount={data.todayKgBarAmount}
            color="#7c5f20"
            category="kg_bar"
            period="today"
          />
          <StatBox
            title="TT Bar"
            count={data.todayTtBarCount}
            amount={data.todayTtBarAmount}
            color="#2d6a4f"
            category="tt_bar"
            period="today"
          />
        </div>
      </div>

      {/* MONTHLY category breakdown */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-foreground">Monthly Sales Breakdown — {monthName}</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadCSV("all", "monthly")}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadPDF("all", "monthly")}>
              <FileText className="w-3.5 h-3.5 mr-1.5" /> PDF
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatBox
            title="Gold Jewelry"
            count={data.monthlyGoldJewelryCount}
            amount={data.monthlyGoldJewelryAmount}
            color="#c8a43a"
            category="gold_jewelry"
            period="monthly"
          />
          <StatBox
            title="Total Gold Sales"
            count={data.monthlyGoldJewelryCount + data.monthlyKgBarCount + data.monthlyTtBarCount}
            amount={data.monthlyGoldJewelryAmount + data.monthlyKgBarAmount + data.monthlyTtBarAmount}
            color="#1e3a5f"
            category="all"
            period="monthly"
          />
          <StatBox
            title="KG Bar"
            count={data.monthlyKgBarCount}
            amount={data.monthlyKgBarAmount}
            color="#7c5f20"
            category="kg_bar"
            period="monthly"
          />
          <StatBox
            title="TT Bar"
            count={data.monthlyTtBarCount}
            amount={data.monthlyTtBarAmount}
            color="#2d6a4f"
            category="tt_bar"
            period="monthly"
          />
        </div>
      </div>

      {/* Charts + recent invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Revenue Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {monthlySales && monthlySales.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySales} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}`} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
                  />
                  <Legend iconType="circle" />
                  <Bar dataKey="cash" name="Cash" stackId="a" fill="hsl(var(--chart-1))" radius={[0, 0, 4, 4]} />
                  <Bar dataKey="card" name="Card" stackId="a" fill="hsl(var(--chart-2))" />
                  <Bar dataKey="bankTransfer" name="Bank Transfer" stackId="a" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No sales data yet</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Recent Invoices</CardTitle>
            <Link href="/invoices">
              <Button variant="outline" size="sm">View All</Button>
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {data.recentInvoices && data.recentInvoices.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Invoice #</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right pr-4">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentInvoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium pl-4">
                          <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">{inv.invoiceNumber}</Link>
                        </TableCell>
                        <TableCell className="max-w-[100px] truncate">{inv.customerName || "Walk-in"}</TableCell>
                        <TableCell>
                          <Badge variant={inv.paymentMethod === "cash" ? "default" : inv.paymentMethod === "card" ? "secondary" : "outline"} className="text-[10px]">
                            {inv.paymentMethod.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-bold pr-4">
                          AED {Number(inv.total).toLocaleString("en-AE", { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground text-sm">No recent invoices</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Customers</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-semibold">{data.totalCustomers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Products</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-semibold">{data.totalProducts}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total Invoices</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-semibold">{data.totalInvoices}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Cash Collection</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-xl font-semibold">AED {data.cashCollection?.toLocaleString("en-AE", { minimumFractionDigits: 2 })}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
