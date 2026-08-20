import React, { useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListWholesaleTraders, getListWholesaleTradersQueryKey,
  useCreateWholesaleTrader, useCreateWholesaleInvoice,
  WholesaleInvoiceItemInputCategory, WholesaleInvoiceInputPricingType,
  getListWholesaleInvoicesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InvoiceModeSelector } from "@/components/invoice-mode-selector";
import { stockCategoryLabel, STOCK_CATEGORIES } from "../products/stock";

function fmt(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

interface WholesaleLineItem {
  id: string;
  description: string;
  category: WholesaleInvoiceItemInputCategory;
  quantity: number;
  grossGrams: number;
  purityMultiplier: number;
  makingAed: number;
  rateAedPerGram: number | null; // Only for fixed pricing
}

export default function NewWholesaleInvoice() {
  const [_, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invoiceIdempotencyKey = useRef(crypto.randomUUID());

  const createTrader = useCreateWholesaleTrader();
  const createInvoice = useCreateWholesaleInvoice();

  const { data: traders, isLoading: tradersLoading } = useListWholesaleTraders({}, { query: { queryKey: getListWholesaleTradersQueryKey({}) } });

  // Invoice State
  const [traderId, setTraderId] = useState<number | null>(null);
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [pricingType, setPricingType] = useState<WholesaleInvoiceInputPricingType>("unfixed");
  const [notes, setNotes] = useState<string>("");

  // New Trader State (if not selecting existing)
  const [isCreatingTrader, setIsCreatingTrader] = useState(false);
  const [traderName, setTraderName] = useState("");
  const [traderPhone, setTraderPhone] = useState("");
  const [traderEmail, setTraderEmail] = useState("");
  const [traderAddress, setTraderAddress] = useState("");
  const [traderTrn, setTraderTrn] = useState("");

  const [items, setItems] = useState<WholesaleLineItem[]>([{
    id: crypto.randomUUID(),
    description: "",
    category: "gold_9999",
    quantity: 1,
    grossGrams: 0,
    purityMultiplier: 1.0,
    makingAed: 0,
    rateAedPerGram: null,
  }]);

  const updateItem = (index: number, field: keyof WholesaleLineItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const addItem = () => setItems([...items, {
    id: crypto.randomUUID(),
    description: "",
    category: "gold_9999",
    quantity: 1,
    grossGrams: 0,
    purityMultiplier: 1.0,
    makingAed: 0,
    rateAedPerGram: null,
  }]);

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter(i => i.id !== id));
    }
  };

  // Totals
  const totalGross = items.reduce((acc, i) => acc + (i.grossGrams || 0), 0);
  const totalPure = items.reduce((acc, i) => acc + ((i.grossGrams || 0) * (i.purityMultiplier || 0)), 0);
  const totalMaking = items.reduce((acc, i) => acc + (i.makingAed || 0), 0);
  const totalAed = items.reduce((acc, i) => acc + (i.makingAed || 0) + (pricingType === "fixed" ? (((i.grossGrams || 0) * (i.purityMultiplier || 0)) * (i.rateAedPerGram || 0)) : 0), 0);

  const handleSubmit = async () => {
    if (items.some(i => !i.description.trim())) {
      toast({ title: "Validation Error", description: "All items must have a description.", variant: "destructive" });
      return;
    }
    if (items.some(i => i.grossGrams <= 0)) {
      toast({ title: "Validation Error", description: "All items must have a positive gross weight.", variant: "destructive" });
      return;
    }
    if (pricingType === "fixed" && items.some(i => i.rateAedPerGram === null || i.rateAedPerGram <= 0)) {
      toast({ title: "Validation Error", description: "Fixed invoices require a metal rate for all items.", variant: "destructive" });
      return;
    }
    if (!isCreatingTrader && !traderId) {
      toast({ title: "Validation Error", description: "Select a trader or create a new one.", variant: "destructive" });
      return;
    }
    if (isCreatingTrader && !traderName.trim()) {
      toast({ title: "Validation Error", description: "New trader requires a name.", variant: "destructive" });
      return;
    }

    const doSubmit = (resolvedTraderId: number) => {
      createInvoice.mutate({
        data: {
          traderId: resolvedTraderId,
          invoiceDate,
          pricingType,
          notes: notes || undefined,
          idempotencyKey: invoiceIdempotencyKey.current,
          items: items.map(item => ({
            description: item.description,
            category: item.category,
            quantity: item.quantity,
            grossGrams: item.grossGrams,
            purityMultiplier: item.purityMultiplier,
            makingAed: item.makingAed,
            rateAedPerGram: pricingType === "fixed" && item.rateAedPerGram ? item.rateAedPerGram : undefined,
          }))
        }
      }, {
        onSuccess: (invoice) => {
          invoiceIdempotencyKey.current = crypto.randomUUID();
          toast({ title: "Invoice Created", description: `Wholesale invoice ${invoice.invoiceNumber} saved.` });
          queryClient.invalidateQueries({
            predicate: (query) => JSON.stringify(query.queryKey).includes("/api/wholesale"),
          });
          setLocation(`/wholesale/${invoice.id}`);
        },
        onError: (err: any) => {
          toast({ title: "Failed to create invoice", description: err.message || "Unknown error", variant: "destructive" });
        }
      });
    };

    if (isCreatingTrader) {
      createTrader.mutate({
        data: {
          name: traderName,
          phone: traderPhone || undefined,
          email: traderEmail || undefined,
          address: traderAddress || undefined,
          trn: traderTrn || undefined,
        }
      }, {
        onSuccess: (trader) => {
          queryClient.invalidateQueries({ queryKey: getListWholesaleTradersQueryKey() });
          setTraderId(trader.id);
          setIsCreatingTrader(false);
          doSubmit(trader.id);
        },
        onError: (err: any) => {
          toast({ title: "Failed to create trader", description: err.message || "Unknown error", variant: "destructive" });
        }
      });
    } else if (traderId) {
      doSubmit(traderId);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-primary mb-2 sm:mb-4">New Wholesale Invoice</h1>
          <InvoiceModeSelector mode="wholesale" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex justify-between items-center">
                <CardTitle>Invoice Items</CardTitle>
                <div className="flex bg-muted rounded-md p-1">
                  <button
                    onClick={() => setPricingType("unfixed")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded ${pricingType === "unfixed" ? "bg-background shadow-sm text-amber-600" : "text-muted-foreground"}`}
                  >Unfixed (Weight Only)</button>
                  <button
                    onClick={() => setPricingType("fixed")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded ${pricingType === "fixed" ? "bg-background shadow-sm text-primary" : "text-muted-foreground"}`}
                  >Fixed (Rate Applied)</button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/50">
                      <th className="py-2.5 px-3 text-left text-xs font-semibold w-10">#</th>
                      <th className="py-2.5 px-3 text-left text-xs font-semibold min-w-[200px]">Description & Category</th>
                      <th className="py-2.5 px-3 text-right text-xs font-semibold w-24">Gross (g)</th>
                      <th className="py-2.5 px-3 text-right text-xs font-semibold w-24">Purity</th>
                      <th className="py-2.5 px-3 text-right text-xs font-semibold w-24">Pure (g)</th>
                      <th className="py-2.5 px-3 text-right text-xs font-semibold w-24">Making (AED)</th>
                      {pricingType === "fixed" && (
                        <th className="py-2.5 px-3 text-right text-xs font-semibold w-28 border-l border-border/50 bg-primary/5">Rate (AED)</th>
                      )}
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => {
                      const pure = (item.grossGrams || 0) * (item.purityMultiplier || 0);
                      return (
                        <tr key={item.id} className="border-b border-border/50">
                          <td className="py-3 px-3 text-muted-foreground text-center">{index + 1}</td>
                          <td className="py-3 px-3 space-y-2">
                            <Input
                              placeholder="Item description..."
                              value={item.description}
                              onChange={e => updateItem(index, "description", e.target.value)}
                              className="h-8 text-sm"
                            />
                            <Select value={item.category} onValueChange={val => updateItem(index, "category", val)}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STOCK_CATEGORIES.map(c => (
                                  <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-3 px-3">
                            <Input
                              type="number" min="0" step="0.001"
                              className="h-8 text-right px-2"
                              value={item.grossGrams || ""}
                              onChange={e => updateItem(index, "grossGrams", parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="py-3 px-3">
                            <Input
                              type="number" min="0" max="1" step="0.0001"
                              className="h-8 text-right px-2"
                              value={item.purityMultiplier || ""}
                              onChange={e => updateItem(index, "purityMultiplier", parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="py-3 px-3 text-right font-medium text-emerald-600 bg-emerald-50/50">
                            {fmt(pure)}
                          </td>
                          <td className="py-3 px-3">
                            <Input
                              type="number" min="0" step="0.5"
                              className="h-8 text-right px-2"
                              value={item.makingAed || ""}
                              onChange={e => updateItem(index, "makingAed", parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          {pricingType === "fixed" && (
                            <td className="py-3 px-3 border-l border-border/50 bg-primary/5">
                              <Input
                                type="number" min="0" step="0.5"
                                className="h-8 text-right px-2 font-mono border-primary/30"
                                value={item.rateAedPerGram || ""}
                                onChange={e => updateItem(index, "rateAedPerGram", parseFloat(e.target.value) || 0)}
                                placeholder="Rate/g"
                              />
                            </td>
                          )}
                          <td className="py-3 px-3">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeItem(item.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addItem} className="mt-4 border-dashed w-full py-6">
                <Plus className="w-4 h-4 mr-2" /> Add Item
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle>Wholesale Trader</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              {!isCreatingTrader ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Select Existing Trader</Label>
                    <Select value={traderId?.toString() ?? ""} onValueChange={v => setTraderId(parseInt(v))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select Trader" />
                      </SelectTrigger>
                      <SelectContent>
                        {traders?.map(t => (
                          <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button variant="link" size="sm" onClick={() => setIsCreatingTrader(true)} className="p-0 h-auto text-primary">
                    <Plus className="w-3 h-3 mr-1" /> Or create new trader
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 p-3 bg-muted/20 border border-border/50 rounded-md">
                  <div className="flex justify-between items-center">
                    <Label className="font-semibold text-primary">New Trader Profile</Label>
                    <Button variant="ghost" size="sm" onClick={() => setIsCreatingTrader(false)} className="h-6 text-[10px]">Cancel</Button>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Company Name <span className="text-destructive">*</span></Label>
                    <Input value={traderName} onChange={e => setTraderName(e.target.value)} className="h-8" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Phone</Label>
                      <Input value={traderPhone} onChange={e => setTraderPhone(e.target.value)} className="h-8" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">TRN</Label>
                      <Input value={traderTrn} onChange={e => setTraderTrn(e.target.value)} className="h-8" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email</Label>
                    <Input type="email" value={traderEmail} onChange={e => setTraderEmail(e.target.value)} className="h-8" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Address</Label>
                    <Textarea
                      value={traderAddress}
                      onChange={e => setTraderAddress(e.target.value)}
                      className="min-h-16 resize-y text-sm"
                      placeholder="Company address"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
              <CardTitle>Summary & Finalize</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <Label>Invoice Date</Label>
                <Input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="h-16 resize-none" placeholder="Delivery notes..." />
              </div>
              
              <div className="p-3 bg-sidebar rounded-md text-sidebar-foreground space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-sidebar-foreground/70">Gross Wt</span>
                  <span>{fmt(totalGross)} g</span>
                </div>
                <div className="flex justify-between font-bold text-emerald-400">
                  <span>Pure Wt</span>
                  <span>{fmt(totalPure)} g</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-sidebar-border">
                  <span className="text-sidebar-foreground/70">Making Total</span>
                  <span>{fmt(totalMaking)} AED</span>
                </div>
                {pricingType === "fixed" && (
                  <div className="flex justify-between font-bold text-lg pt-1 text-white">
                    <span>Final Invoice AED</span>
                    <span>{fmt(totalAed)}</span>
                  </div>
                )}
              </div>

              <Button
                className="w-full" size="lg"
                onClick={handleSubmit} disabled={createInvoice.isPending || createTrader.isPending}
              >
                {createInvoice.isPending ? "Saving..." : <><Save className="w-4 h-4 mr-2" /> Save {pricingType === "fixed" ? "Fixed Invoice" : "Unfixed Invoice"}</>}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
