import React from "react";
import { Link } from "wouter";
import {
  useGetDashboard, getGetDashboardQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Plus } from "lucide-react";

function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Dashboard() {
  const { data, isLoading } = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey() } });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8" />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    );
  }

  if (!data) return <div>Failed to load dashboard</div>;

  const todayDate = format(new Date(), "MMMM d, yyyy");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-primary">Dashboard</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">{todayDate}</p>
        </div>
        <Link href="/invoices/new" className="self-start sm:self-auto">
          <Button size="sm" className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-1.5" /> New Invoice</Button>
        </Link>
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-3">
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
