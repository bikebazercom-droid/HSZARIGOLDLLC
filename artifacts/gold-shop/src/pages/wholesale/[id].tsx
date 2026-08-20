import React, { useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { format } from "date-fns";
import {
  useGetWholesaleInvoice, getGetWholesaleInvoiceQueryKey,
  useFixWholesaleRate, useReturnWholesaleGoods
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, FileDown, History, Anchor, Scale, AlertCircle, Phone } from "lucide-react";
import { stockCategoryLabel } from "../products/stock";

function fmtG(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function WholesaleInvoiceDetail() {
  const { id } = useParams();
  const invoiceId = parseInt(id || "0");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fixIdempotencyKey = useRef(crypto.randomUUID());
  const returnIdempotencyKey = useRef(crypto.randomUUID());

  const { data: invoice, isLoading } = useGetWholesaleInvoice(invoiceId, {
    query: { queryKey: getGetWholesaleInvoiceQueryKey(invoiceId) }
  });

  const fixRate = useFixWholesaleRate();
  const returnGoods = useReturnWholesaleGoods();

  const [fixOpen, setFixOpen] = useState(false);
  const [fixDate, setFixDate] = useState(new Date().toISOString().slice(0, 10));
  const [fixPureGrams, setFixPureGrams] = useState("");
  const [fixRateAed, setFixRateAed] = useState("");
  const [fixNote, setFixNote] = useState("");

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [returnNote, setReturnNote] = useState("");
  const [returnLines, setReturnLines] = useState<Record<number, string>>({}); // itemId -> grossGrams
  const [lastReturn, setLastReturn] = useState<{ id: number; returnNumber: string } | null>(null);

  const invalidateWholesaleQueries = () => {
    queryClient.invalidateQueries({
      predicate: (query) => JSON.stringify(query.queryKey).includes("/api/wholesale"),
    });
  };

  const handleFixRate = () => {
    const pureW = parseFloat(fixPureGrams) || 0;
    const rateW = parseFloat(fixRateAed) || 0;

    if (pureW <= 0 || pureW > (invoice?.openPureGrams ?? 0)) {
      toast({ title: "Invalid Weight", description: "Weight must be greater than 0 and less than or equal to open weight.", variant: "destructive" });
      return;
    }
    if (rateW <= 0) {
      toast({ title: "Invalid Rate", description: "Rate must be positive.", variant: "destructive" });
      return;
    }

    fixRate.mutate({
      id: invoiceId,
      data: {
        pureWeightGrams: pureW,
        rateAedPerGram: rateW,
        date: fixDate,
        note: fixNote || undefined,
        idempotencyKey: fixIdempotencyKey.current
      }
    }, {
      onSuccess: () => {
        fixIdempotencyKey.current = crypto.randomUUID();
        toast({ title: "Rate Fixed", description: `${fmtG(pureW)}g fixed at AED ${rateW}/g.` });
        invalidateWholesaleQueries();
        setFixOpen(false);
        setFixPureGrams("");
        setFixRateAed("");
        setFixNote("");
      },
      onError: (err: any) => {
        toast({ title: "Rate Fix Failed", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleReturnGoods = () => {
    const lines = Object.entries(returnLines)
      .map(([itemIdStr, wtStr]) => ({
        invoiceItemId: parseInt(itemIdStr),
        grossWeightGrams: parseFloat(wtStr) || 0
      }))
      .filter(l => l.grossWeightGrams > 0);

    if (lines.length === 0) {
      toast({ title: "No Return Data", description: "Enter at least one return weight.", variant: "destructive" });
      return;
    }
    const overReturn = lines.find((line) => {
      const item = invoice?.items.find((candidate) => candidate.id === line.invoiceItemId);
      return !item || line.grossWeightGrams > item.grossGrams - item.returnedGrossGrams + 0.0001;
    });
    if (overReturn) {
      toast({ title: "Invalid Return", description: "A return weight exceeds the unreturned delivered quantity.", variant: "destructive" });
      return;
    }

    returnGoods.mutate({
      id: invoiceId,
      data: {
        date: returnDate,
        lines,
        note: returnNote || undefined,
        idempotencyKey: returnIdempotencyKey.current
      }
    }, {
      onSuccess: (record) => {
        returnIdempotencyKey.current = crypto.randomUUID();
        setLastReturn({ id: record.id, returnNumber: record.returnNumber });
        toast({ title: "Goods Returned", description: `${record.returnNumber} recorded successfully.` });
        invalidateWholesaleQueries();
        setReturnOpen(false);
        setReturnLines({});
        setReturnNote("");
      },
      onError: (err: any) => {
        toast({ title: "Return Failed", description: err.message, variant: "destructive" });
      }
    });
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading invoice...</div>;
  if (!invoice) return <div className="p-8 text-center text-destructive">Invoice not found.</div>;
  const hasReturnableGoods = invoice.items.some((item) => item.grossGrams - item.returnedGrossGrams > 0.0001);

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <Link href="/wholesale">
            <Button variant="link" className="px-0 text-muted-foreground h-auto mb-2"><ArrowLeft className="w-4 h-4 mr-1"/> Back to Wholesale</Button>
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary">Invoice #{invoice.invoiceNumber}</h1>
            <Badge variant={invoice.pricingType === "fixed" ? "default" : "outline"} className="uppercase tracking-wider">
              {invoice.pricingType}
            </Badge>
            {invoice.status === "open" && <Badge variant="outline" className="uppercase tracking-wider text-amber-600 border-amber-600">Open</Badge>}
            {invoice.status === "partially_settled" && <Badge className="uppercase tracking-wider bg-blue-100 text-blue-700">Partial</Badge>}
            {invoice.status === "settled" && <Badge className="uppercase tracking-wider bg-emerald-100 text-emerald-700">Settled</Badge>}
          </div>
        </div>
        <div className="flex gap-2 self-start sm:self-auto pb-1">
          {lastReturn && (
            <Button variant="outline" onClick={() => window.open(`/api/wholesale/returns/${lastReturn.id}/pdf`, "_blank")}>
              <FileDown className="w-4 h-4 mr-2" /> {lastReturn.returnNumber}
            </Button>
          )}
          <Button variant="outline" onClick={() => window.open(`/api/wholesale/invoices/${invoiceId}/pdf`, "_blank")}>
            <FileDown className="w-4 h-4 mr-2" /> PDF Invoice
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle>Delivery Items</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/10 text-muted-foreground border-b border-border/50">
                    <tr>
                      <th className="py-2.5 px-4 text-left font-semibold">Description</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Gross (g)</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Purity</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Pure (g)</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Making</th>
                      <th className="py-2.5 px-4 text-right font-semibold">Total AED</th>
                      <th className="py-2.5 px-4 text-center font-semibold">Settled / Returned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {invoice.items.map((it) => (
                      <tr key={it.id} className="hover:bg-muted/5">
                        <td className="py-3 px-4">
                          <div className="font-medium">{it.description}</div>
                          <div className="text-[10px] text-muted-foreground">{stockCategoryLabel(it.category)}</div>
                        </td>
                        <td className="py-3 px-4 text-right">{fmtG(it.grossGrams)}</td>
                        <td className="py-3 px-4 text-right">{it.purityMultiplier}</td>
                        <td className="py-3 px-4 text-right font-medium text-emerald-600">{fmtG(it.pureGrams)}</td>
                        <td className="py-3 px-4 text-right">{fmtAED(it.makingAed)}</td>
                        <td className="py-3 px-4 text-right">{fmtAED(it.totalAed)}</td>
                        <td className="py-3 px-4 text-center">
                          {invoice.pricingType === "unfixed" && (
                            <div className="text-[10px] text-muted-foreground">
                              {it.fixedPureGrams > 0 && <div>Fixed: {fmtG(it.fixedPureGrams)}g</div>}
                              {it.returnedGrossGrams > 0 && <div>Ret: {fmtG(it.returnedGrossGrams)}g gross</div>}
                            </div>
                          )}
                          {invoice.pricingType === "fixed" && (
                            <div className="text-[10px] text-emerald-600">Fixed Rate</div>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/20 font-bold">
                      <td className="py-3 px-4 text-right" colSpan={2}>Total Gross: {fmtG(invoice.totalGrossGrams)}g</td>
                      <td className="py-3 px-4 text-right" colSpan={2}>Total Pure: {fmtG(invoice.totalPureGrams)}g</td>
                      <td className="py-3 px-4 text-right">AED {fmtAED(invoice.totalMakingAed)}</td>
                      <td className="py-3 px-4 text-right">AED {fmtAED(invoice.totalAed)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle>Wholesale Trader</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-2">
              <div className="font-bold text-lg">{invoice.traderName}</div>
              {invoice.traderPhone && <div className="text-sm flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {invoice.traderPhone}</div>}
              {invoice.traderTrn && <div className="text-sm text-muted-foreground">TRN: {invoice.traderTrn}</div>}
              {invoice.traderId && (
                <Link href={`/wholesale/traders/${invoice.traderId}`}>
                  <Button variant="outline" size="sm" className="w-full mt-2"><History className="w-4 h-4 mr-2"/> View Trader Statement</Button>
                </Link>
              )}
            </CardContent>
          </Card>

          {invoice.pricingType === "unfixed" && (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="pb-3 border-b border-border/50 bg-primary/5">
                <CardTitle className="text-primary flex items-center gap-2"><Scale className="w-4 h-4" /> Open Liability</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="text-center p-4 bg-muted/20 rounded border border-border/50">
                  <div className="text-sm text-muted-foreground mb-1">Unfixed Pure Gold</div>
                  <div className={`text-3xl font-bold font-mono ${invoice.openPureGrams > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {fmtG(invoice.openPureGrams)} g
                  </div>
                </div>

                {isAdmin && invoice.openPureGrams > 0 && (
                  <div className="flex flex-col gap-2">
                    <Dialog open={fixOpen} onOpenChange={setFixOpen}>
                      <DialogTrigger asChild>
                        <Button className="w-full"><Anchor className="w-4 h-4 mr-2" /> Fix Rate (Settle)</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Fix Gold Rate</DialogTitle>
                          <DialogDescription>Convert open pure grams into fixed AED debt.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                          <div className="flex items-center justify-between text-sm bg-amber-50 dark:bg-amber-950/30 p-2 rounded text-amber-700 dark:text-amber-400">
                            <span>Open Pure Weight:</span>
                            <span className="font-bold">{fmtG(invoice.openPureGrams)} g</span>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>Date</Label>
                              <Input type="date" value={fixDate} onChange={e => setFixDate(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                              <Label>Pure Grams to Fix</Label>
                              <Input type="number" step="0.001" value={fixPureGrams} onChange={e => setFixPureGrams(e.target.value)} placeholder="0.000" />
                              <div className="text-[10px] text-right">
                                <button type="button" className="text-primary hover:underline" onClick={() => setFixPureGrams(invoice.openPureGrams.toString())}>Max</button>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <Label>Metal Rate (AED/g)</Label>
                            <Input type="number" step="0.01" value={fixRateAed} onChange={e => setFixRateAed(e.target.value)} placeholder="0.00" className="font-mono text-lg h-10 border-primary/50" />
                          </div>
                          <div className="space-y-2">
                            <Label>Note (Optional)</Label>
                            <Input value={fixNote} onChange={e => setFixNote(e.target.value)} />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button onClick={handleFixRate}>Confirm Rate Fix</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                  </div>
                )}
                {!isAdmin && invoice.openPureGrams > 0 && (
                  <div className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Rate fix requires admin access
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {isAdmin && hasReturnableGoods && (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="pb-3 border-b border-border/50 bg-primary/5">
                <CardTitle className="text-primary flex items-center gap-2"><History className="w-4 h-4" /> Physical Return</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" className="w-full"><History className="w-4 h-4 mr-2" /> Return Delivered Goods</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-xl">
                    <DialogHeader>
                      <DialogTitle>Physical Gold Return</DialogTitle>
                      <DialogDescription>
                        Return any unreturned goods. Open metal is removed from the pure balance; fixed metal and making are reversed from AED.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label>Return Date</Label>
                        <Input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} className="w-40" />
                      </div>
                      <div className="border rounded overflow-x-auto">
                        <table className="w-full min-w-[520px] text-sm">
                          <thead className="bg-muted/30">
                            <tr>
                              <th className="py-2 px-3 text-left font-medium">Item</th>
                              <th className="py-2 px-3 text-right font-medium">Delivered</th>
                              <th className="py-2 px-3 text-right font-medium">Already Returned</th>
                              <th className="py-2 px-3 text-right font-medium">Return Wt (g)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {invoice.items.map(it => {
                              const balance = Math.max(0, it.grossGrams - it.returnedGrossGrams);
                              return (
                                <tr key={it.id} className="border-t">
                                  <td className="py-2 px-3">{it.description}</td>
                                  <td className="py-2 px-3 text-right text-muted-foreground">{fmtG(it.grossGrams)}g</td>
                                  <td className="py-2 px-3 text-right text-muted-foreground">{fmtG(it.returnedGrossGrams)}g</td>
                                  <td className="py-2 px-3">
                                    <Input
                                      type="number"
                                      min="0"
                                      max={balance}
                                      step="0.0001"
                                      className="h-7 text-right w-24 ml-auto"
                                      placeholder="0.0000"
                                      disabled={balance <= 0.0001}
                                      value={returnLines[it.id] ?? ""}
                                      onChange={e => setReturnLines({...returnLines, [it.id]: e.target.value})}
                                    />
                                    {balance > 0.0001 && (
                                      <div className="text-[10px] text-right mt-1">
                                        <button type="button" className="text-primary hover:underline" onClick={() => setReturnLines({...returnLines, [it.id]: balance.toString()})}>Max {fmtG(balance)}</button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="space-y-2">
                        <Label>Note</Label>
                        <Input value={returnNote} onChange={e => setReturnNote(e.target.value)} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={handleReturnGoods}>Confirm Return</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
