import React, { useState } from "react";
import { Link } from "wouter";
import {
  useGetDashboard, getGetDashboardQueryKey,
  useGetMonthlySales, getGetMonthlySalesQueryKey,
  useGetSalesAnalytics, getGetSalesAnalyticsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { Plus, CalendarRange, Gem, CircleDollarSign, Boxes, Wallet, Scale } from "lucide-react";

function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtGrams(n: number | undefined | null): string {
  return `${(n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} g`;
}

function toDateInputValue(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

interface AnalyticsCardProps {
  title: string;
  icon: React.ReactNode;
  grams: number | undefined;
  amount: number | undefined;
  count: number | undefined;
  color: string;
  accentBg: string;
}

function AnalyticsCard({ title, icon, grams, amount, count, color, accentBg }: AnalyticsCardProps) {
  return (
    <Card className="relative overflow-hidden border-0 shadow-md" style={{ borderTop: `3px solid ${color}` }}>
      <CardContent className="p-0">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2" style={{ backgroundColor: accentBg }}>
          <span style={{ color }}>{icon}</span>
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{title}</span>
        </div>
        <div className="px-4 pt-3 pb-1 flex gap-3">
          <div className="flex-1 text-center rounded-lg py-2" style={{ backgroundColor: accentBg }}>
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Scale className="w-3 h-3" style={{ color }} />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Grams Sold</span>
            </div>
            <div className="text-lg font-extrabold leading-tight" style={{ color }}>{fmtGrams(grams)}</div>
          </div>
          <div className="flex-1 text-center rounded-lg py-2 bg-muted/40">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Boxes className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Invoices</span>
            </div>
            <div className="text-lg font-extrabold text-foreground leading-tight">{count ?? 0}</div>
          </div>
        </div>
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

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [fromDate, setFromDate] = useState(toDateInputValue(startOfMonth));
  const [toDate, setToDate] = useState(toDateInputValue(now));

  const analyticsParams = { startDate: fromDate, endDate: toDate };
  const { data: analytics, isLoading: isAnalyticsLoading, isError: isAnalyticsError } = useGetSalesAnalytics(analyticsParams, {
    query: { queryKey: getGetSalesAnalyticsQueryKey(analyticsParams) },
  });

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

      {/* Sales Analytics — date-range filtered */}
      <Card className="border-0 shadow-md">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarRange className="w-4 h-4 text-primary" />
              Sales Analytics
            </CardTitle>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="from-date" className="text-[11px] text-muted-foreground">From Date</Label>
                <Input
                  id="from-date"
                  type="date"
                  value={fromDate}
                  max={toDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-8 w-[150px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="to-date" className="text-[11px] text-muted-foreground">To Date</Label>
                <Input
                  id="to-date"
                  type="date"
                  value={toDate}
                  min={fromDate}
                  max={toDateInputValue(new Date())}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-8 w-[150px]"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAnalyticsLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36" />)}
            </div>
          ) : isAnalyticsError || !analytics ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Failed to load sales analytics for this range.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <AnalyticsCard
                  title="Gold Jewelry"
                  icon={<Gem className="w-4 h-4" />}
                  grams={analytics.goldJewelryGrams}
                  amount={analytics.goldJewelryAmount}
                  count={analytics.goldJewelryCount}
                  color="#c8a43a"
                  accentBg="#fdf8ec"
                />
                <AnalyticsCard
                  title="TT Bar"
                  icon={<CircleDollarSign className="w-4 h-4" />}
                  grams={analytics.ttBarGrams}
                  amount={analytics.ttBarAmount}
                  count={analytics.ttBarCount}
                  color="#2d6a4f"
                  accentBg="#edf7f2"
                />
                <AnalyticsCard
                  title="Kilo Bar / 9950"
                  icon={<Boxes className="w-4 h-4" />}
                  grams={analytics.kgBarGrams}
                  amount={analytics.kgBarAmount}
                  count={analytics.kgBarCount}
                  color="#7c5f20"
                  accentBg="#fdf4e3"
                />
                <Card className="relative overflow-hidden border-0 shadow-md bg-primary text-primary-foreground">
                  <CardContent className="p-0">
                    <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                      <Wallet className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-wider">Range Total</span>
                    </div>
                    <div className="px-4 pt-3 pb-1 flex gap-3">
                      <div className="flex-1 text-center rounded-lg py-2 bg-white/10">
                        <div className="flex items-center justify-center gap-1 mb-0.5">
                          <Scale className="w-3 h-3" />
                          <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">Grams Sold</span>
                        </div>
                        <div className="text-lg font-extrabold leading-tight">{fmtGrams(analytics.totalGrams)}</div>
                      </div>
                    </div>
                    <div className="px-4 pb-3 pt-1 text-center">
                      <span className="text-xs opacity-80 font-medium">Total Revenue: </span>
                      <span className="text-sm font-bold">AED {fmtAED(analytics.totalRevenue)}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Category</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Total Grams</TableHead>
                      <TableHead className="text-right pr-4">Total Revenue (AED)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="pl-4 font-medium">Gold Jewelry</TableCell>
                      <TableCell className="text-right">{analytics.goldJewelryCount}</TableCell>
                      <TableCell className="text-right">{fmtGrams(analytics.goldJewelryGrams)}</TableCell>
                      <TableCell className="text-right pr-4 font-semibold">{fmtAED(analytics.goldJewelryAmount)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-4 font-medium">TT Bar</TableCell>
                      <TableCell className="text-right">{analytics.ttBarCount}</TableCell>
                      <TableCell className="text-right">{fmtGrams(analytics.ttBarGrams)}</TableCell>
                      <TableCell className="text-right pr-4 font-semibold">{fmtAED(analytics.ttBarAmount)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-4 font-medium">Kilo Bar / 9950</TableCell>
                      <TableCell className="text-right">{analytics.kgBarCount}</TableCell>
                      <TableCell className="text-right">{fmtGrams(analytics.kgBarGrams)}</TableCell>
                      <TableCell className="text-right pr-4 font-semibold">{fmtAED(analytics.kgBarAmount)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/40">
                      <TableCell className="pl-4 font-bold">Total</TableCell>
                      <TableCell className="text-right font-bold">
                        {analytics.goldJewelryCount + analytics.ttBarCount + analytics.kgBarCount}
                      </TableCell>
                      <TableCell className="text-right font-bold">{fmtGrams(analytics.totalGrams)}</TableCell>
                      <TableCell className="text-right pr-4 font-bold">{fmtAED(analytics.totalRevenue)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
