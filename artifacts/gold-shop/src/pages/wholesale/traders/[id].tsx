import React, { useState } from "react";
import { Link, useParams } from "wouter";
import { format } from "date-fns";
import {
  useGetWholesaleTrader, getGetWholesaleTraderQueryKey,
  useGetTraderStatement, getGetTraderStatementQueryKey
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileDown, Scale, Banknote } from "lucide-react";

function fmtG(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function WholesaleTraderStatement() {
  const { id } = useParams();
  const traderId = parseInt(id || "0");
  
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: trader, isLoading: traderLoading } = useGetWholesaleTrader(traderId, {
    query: { queryKey: getGetWholesaleTraderQueryKey(traderId) }
  });

  const statementParams = {
    traderId,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };
  
  const { data: statement, isLoading: statementLoading } = useGetTraderStatement(statementParams, {
    query: { queryKey: getGetTraderStatementQueryKey(statementParams) }
  });

  const handleDownloadPdf = () => {
    const params = new URLSearchParams();
    params.set("traderId", traderId.toString());
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    window.open(`/api/wholesale/ledger/pdf?${params.toString()}`, "_blank");
  };

  if (traderLoading) return <div className="p-8 text-center text-muted-foreground">Loading trader...</div>;
  if (!trader) return <div className="p-8 text-center text-destructive">Trader not found.</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <Link href="/wholesale">
            <Button variant="link" className="px-0 text-muted-foreground h-auto mb-2"><ArrowLeft className="w-4 h-4 mr-1"/> Back to Wholesale</Button>
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">{trader.name}</h1>
            {!trader.isActive && <Badge variant="destructive">Inactive</Badge>}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 self-start sm:self-auto pb-1">
          <div className="flex items-center gap-2">
            <Input type="date" className="h-9 w-36" value={startDate} onChange={e => setStartDate(e.target.value)} />
            <span className="text-muted-foreground text-sm">to</span>
            <Input type="date" className="h-9 w-36" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <Button variant="outline" onClick={handleDownloadPdf}>
            <FileDown className="w-4 h-4 mr-2" /> PDF Statement
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-amber-200 dark:border-amber-900 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-700 dark:text-amber-500 flex items-center gap-2">
              <Scale className="w-4 h-4" /> Open Pure Gold Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              {fmtG(statement?.balancePureGrams)} g
            </div>
            <p className="text-xs text-muted-foreground mt-1">Pending rate fix from trader</p>
          </CardContent>
        </Card>
        
        <Card className="border-blue-200 dark:border-blue-900 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-700 dark:text-blue-500 flex items-center gap-2">
              <Banknote className="w-4 h-4" /> Financial Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">
              AED {fmtAED(statement?.balanceAed)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {(statement?.balanceAed ?? 0) > 0 ? "Owed to shop" : (statement?.balanceAed ?? 0) < 0 ? "Advance from trader" : "Settled"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
          <CardTitle className="text-lg">Ledger Transactions</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-36 text-xs font-semibold uppercase tracking-wider">Date</TableHead>
                <TableHead className="w-24 text-xs font-semibold uppercase tracking-wider">Type</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wider">Reference / Note</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">Pure Gold (g)</TableHead>
                <TableHead className="text-right text-xs font-semibold uppercase tracking-wider">AED</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statementLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading statement...</TableCell>
                </TableRow>
              ) : statement?.entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No transactions found.</TableCell>
                </TableRow>
              ) : (
                statement?.entries.map((entry) => (
                  <TableRow key={entry.id} className="hover:bg-muted/10">
                    <TableCell className="font-medium text-xs whitespace-nowrap text-muted-foreground">
                      {format(new Date(`${entry.eventDate}T00:00:00`), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                        {entry.eventType.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {entry.wholesaleInvoiceId ? (
                        <Link href={`/wholesale/${entry.wholesaleInvoiceId}`} className="text-primary hover:underline font-mono">
                          INV-{entry.wholesaleInvoiceId}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                      {entry.note && <div className="text-[11px] text-muted-foreground mt-0.5">{entry.note}</div>}
                      {entry.wholesaleReturnId && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 mt-1 text-[11px]"
                          onClick={() => window.open(`/api/wholesale/returns/${entry.wholesaleReturnId}/pdf`, "_blank")}
                        >
                          Open return voucher
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.pureGoldGramsDelta !== 0 ? (
                        <span className={`font-mono text-sm ${entry.pureGoldGramsDelta > 0 ? "text-amber-600 font-semibold" : "text-emerald-600"}`}>
                          {entry.pureGoldGramsDelta > 0 ? "+" : ""}{fmtG(entry.pureGoldGramsDelta)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.aedDelta !== 0 ? (
                        <span className={`font-mono text-sm ${entry.aedDelta > 0 ? "text-blue-600 font-semibold" : "text-emerald-600"}`}>
                          {entry.aedDelta > 0 ? "+" : ""}{fmtAED(entry.aedDelta)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
