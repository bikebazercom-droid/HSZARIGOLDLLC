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
import { Plus, Download, FileText, Scale, Receipt } from "lucide-react";

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

function fmtGrams(g: number | undefined | null): string {
  if (g == null || g === 0) return "0.00 g";
  return `${g.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} g`;
}

function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface CategoryCardProps {
  title: string;
  icon: string;
  grams: number | null | undefined;
  count: number;
  amount: number;
  color: string;
  accentBg: string;
  category: string;
  period: "today" | "monthly";
}

function CategoryCard({ title, icon, grams, count, amount, color, accentBg, category, period }: CategoryCardProps) {
  return (
    <Card className="relative overflow-hidden border-0 shadow-md" style={{ borderTop: `3px solid ${color}` }}>
      <CardContent className="p-0">
        {/* Header strip */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2" style={{ backgroundColor: accentBg }}>
          <div className="flex items-center gap-2">
            <span className="text-lg">{icon}</span>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{title}</span>
          </div>
          <div className="flex gap-0.5">
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/40" title="Download CSV" onClick={() => downloadCSV(category, period)}>
              <Download className="w-3 h-3" style={{ color }} />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-white/40" title="Download PDF" onClick={() => downloadPDF(category, period)}>
              <FileText className="w-3 h-3" style={{ color }} />
            </Button>
          </div>
        </div>

        {/* Main stats */}
        <div className="px-4 pt-3 pb-1 flex gap-3">
          {/* Grams — primary stat */}
          <div className="flex-1 text-center rounded-lg py-2" style={{ backgroundColor: accentBg }}>
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Scale className="w-3 h-3" style={{ color }} />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Grams Sold</span>
            </div>
            <div className="text-lg font-extrabold leading-tight" style={{ color }}>
              {fmtGrams(grams)}
            </div>
          </div>

          {/* Invoices — secondary stat */}
          <div className="flex-1 text-center rounded-lg py-2 bg-muted/40">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Receipt className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Invoices</span>
            </div>
            <div className="text-lg font-extrabold text-foreground leading-tight">{count}</div>
          </div>
        </div>

        {/* AED total */}
        <div className="px-4 pb-3 pt-1 text-center">
          <span className="text-xs text-muted-foreground font-medium">Total Sales: </span>
          <span className="text-sm font-bold" style={{ color }}>AED {fmtAED(amount)}</span>
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8" />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36" />)}
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

  const categories = [
    {
      title: "Gold Jewelry",
      icon: "💍",
      color: "#c8a43a",
      accentBg: "#fdf8ec",
      category: "gold_jewelry",
      today: {
        grams: data.todayGoldJewelryGrams,
        count: data.todayGoldJewelryCount,
        amount: data.todayGoldJewelryAmount,
      },
      monthly: {
        grams: data.monthlyGoldJewelryGrams,
        count: data.monthlyGoldJewelryCount,
        amount: data.monthlyGoldJewelryAmount,
      },
    },
    {
      title: "Gold",
      icon: "🪙",
      color: "#d97706",
      accentBg: "#fffbeb",
      category: "gold",
      today: {
        grams: data.todayGoldGrams,
        count: data.todayGoldCount,
        amount: data.todayGoldAmount,
      },
      monthly: {
        grams: data.monthlyGoldGrams,
        count: data.monthlyGoldCount,
        amount: data.monthlyGoldAmount,
      },
    },
    {
      title: "Gold (All)",
      icon: "🥇",
      color: "#b5850a",
      accentBg: "#fef9e7",
      category: "all",
      today: {
        grams: data.todayTotalGoldGrams,
        count: data.todayGoldJewelryCount + data.todayGoldCount + data.todayKgBarCount + data.todayTtBarCount,
        amount: data.todayGoldJewelryAmount + data.todayGoldAmount + data.todayKgBarAmount + data.todayTtBarAmount,
      },
      monthly: {
        grams: data.monthlyTotalGoldGrams,
        count: data.monthlyGoldJewelryCount + data.monthlyGoldCount + data.monthlyKgBarCount + data.monthlyTtBarCount,
        amount: data.monthlyGoldJewelryAmount + data.monthlyGoldAmount + data.monthlyKgBarAmount + data.monthlyTtBarAmount,
      },
    },
    {
      title: "TT Bar",
      icon: "🟡",
      color: "#2d6a4f",
      accentBg: "#edf7f2",
      category: "tt_bar",
      today: {
        grams: data.todayTtBarGrams,
        count: data.todayTtBarCount,
        amount: data.todayTtBarAmount,
      },
      monthly: {
        grams: data.monthlyTtBarGrams,
        count: data.monthlyTtBarCount,
        amount: data.monthlyTtBarAmount,
      },
    },
    {
      title: "KG Bar",
      icon: "📦",
      color: "#7c5f20",
      accentBg: "#fdf4e3",
      category: "kg_bar",
      today: {
        grams: data.todayKgBarGrams,
        count: data.todayKgBarCount,
        amount: data.todayKgBarAmount,
      },
      monthly: {
        grams: data.monthlyKgBarGrams,
        count: data.monthlyKgBarCount,
        amount: data.monthlyKgBarAmount,
      },
    },
    {
      title: "Silver",
      icon: "🥈",
      color: "#4b5563",
      accentBg: "#f3f4f6",
      category: "silver",
      today: {
        grams: data.todaySilverGrams,
        count: data.todaySilverCount,
        amount: data.todaySilverAmount,
      },
      monthly: {
        grams: data.monthlySilverGrams,
        count: data.monthlySilverCount,
        amount: data.monthlySilverAmount,
      },
    },
  ];

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
            <div className="text-xl font-bold">AED {fmtAED(data.todayTotalSale)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Monthly Total</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-lg font-bold">AED {fmtAED(data.monthlySale)}</div>
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
          <div>
            <h2 className="text-base font-semibold text-foreground">Today's Sales — by Category</h2>
            <p className="text-xs text-muted-foreground">Grams sold & invoices generated today</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadCSV("all", "today")}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadPDF("all", "today")}>
              <FileText className="w-3.5 h-3.5 mr-1.5" /> PDF
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {categories.map((cat) => (
            <CategoryCard
              key={cat.category + "-today"}
              title={cat.title}
              icon={cat.icon}
              grams={cat.today.grams}
              count={cat.today.count}
              amount={cat.today.amount}
              color={cat.color}
              accentBg={cat.accentBg}
              category={cat.category}
              period="today"
            />
          ))}
        </div>
      </div>

      {/* MONTHLY category breakdown */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Monthly Sales — {monthName}</h2>
            <p className="text-xs text-muted-foreground">Grams sold & invoices generated this month</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadCSV("all", "monthly")}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadPDF("all", "monthly")}>
              <FileText className="w-3.5 h-3.5 mr-1.5" /> PDF
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {categories.map((cat) => (
            <CategoryCard
              key={cat.category + "-monthly"}
              title={cat.title}
              icon={cat.icon}
              grams={cat.monthly.grams}
              count={cat.monthly.count}
              amount={cat.monthly.amount}
              color={cat.color}
              accentBg={cat.accentBg}
              category={cat.category}
              period="monthly"
            />
          ))}
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
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
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
            <div className="text-xl font-semibold">AED {fmtAED(data.cashCollection)}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
