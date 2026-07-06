import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateInvoice,
  useCreateCustomer,
  InvoiceInputPaymentMethod,
  useListCustomers,
  getListCustomersQueryKey,
  useGetPrices,
  getGetPricesQueryKey,
  useListProducts,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface LineItem {
  id: string;
  description: string;
  category: string;
  grossWeight: number;
  descriptionIsCustom: boolean;
  purity: string;
  purityIsCustom: boolean;
  pureWeight: number;
  makingRate: number;
  makingAmt: number;
  totalPrice: number;
  rate: number;
}

// The Purity dropdown shows ONLY raw decimal numbers — no item names or text
// labels. Deduplicated from the requested set (0.995 appeared twice since both
// TT. BAR and KG BAR share the same 0.995 fineness): 0.995, 0.999, 0.9999,
// 0.916, 0.875, 0.750.
const PURITY_OPTIONS = ["0.995", "0.999", "0.9999", "0.916", "0.875", "0.750"];

// Purity is now always a plain decimal string (e.g. "0.995"), used LITERALLY
// exactly as entered/selected — never snapped to a different "standard" factor.
function parsePurity(purity: string): number {
  const decimal = parseFloat(purity);
  if (isNaN(decimal)) return 0;
  return decimal > 1 ? decimal / 1000 : decimal;
}

interface PricesData {
  goldPricePerGram: number;
  silverPricePerGram: number;
  goldJewelryRate: number;
  goldBullionRate: number;
  ttBarRate: number;
  ttBar24kRate: number;
  kgBarRate: number;
  liveModeConnected?: boolean;
}

// The core "live-priced" asset descriptions, kept in sync with the asset
// cards on the Live Prices page. Selecting one of these in an invoice row
// auto-fills that row's rate from whichever source (live API or manual
// fallback) is currently active for the underlying per-gram field.
const LIVE_ASSET_DESCRIPTIONS = [
  "TT. BAR (0.995)",
  "TT. BAR (0.999)",
  "KG BAR (0.995)",
  "GOLD (0.9999)",
  "Gold 22K (0.916)",
  "Gold 21K (0.875)",
  "Gold 18K (0.750)",
  "Silver (0.999)",
] as const;

// Gross Weight is always entered manually — no description ever auto-fills a
// default weight. The user must type the exact weight for every line item.

// The Purity column shows only raw decimal numbers now, so this maps each
// Stock Description to the matching raw decimal string (see PURITY_OPTIONS).
const DESC_TO_PURITY: Record<string, string> = {
  "TT. BAR (0.995)": "0.995",
  "TT. BAR (0.999)": "0.999",
  "KG BAR (0.995)": "0.995",
  "GOLD (0.9999)": "0.9999",
  "Gold 22K (0.916)": "0.916",
  "Gold 21K (0.875)": "0.875",
  "Gold 18K (0.750)": "0.750",
  "Silver (0.999)": "0.999",
  // Legacy descriptions kept for backward compatibility with existing invoices.
  "TT. BAR 995": "0.995",
  "TT. BAR 24K": "0.999",
  "Gold Jewelry 22k": "0.916",
  "Gold Jewelry 21k": "0.875",
  "Gold Jewelry 18k": "0.750",
  "GOLD 999.99": "0.9999",
  "KG BAR 995": "0.995",
  "Silver 999": "0.999",
  "Gold Jewelry": "0.916",
  "GOLD": "0.9999",
  "TT. BAR": "0.995",
  "KG BAR": "0.995",
  "Silver": "0.999",
  "22K Gold Jewelry": "0.916",
  "24K GOLD": "0.9999",
  "KG. BAR": "0.995",
  "Ten Tola Bar TTB": "0.995",
  "Jewellery 22K 1GM": "0.916",
  "Gold 9999 1GM": "0.9999",
  "Gold 9999 1KG": "0.9999",
  "Kilo Bar 995 1KG": "0.995",
};

function descToCategory(desc: string): string {
  if (desc === "Gold 22K (0.916)" || desc === "Gold 21K (0.875)" || desc === "Gold 18K (0.750)" || desc === "Gold Jewelry 22k" || desc === "Gold Jewelry 21k" || desc === "Gold Jewelry 18k" || desc === "Gold Jewelry" || desc === "22K Gold Jewelry" || desc === "Jewellery 22K 1GM") return "gold_jewelry";
  if (desc === "GOLD (0.9999)" || desc === "GOLD 999.99" || desc === "GOLD" || desc === "24K GOLD" || desc === "Gold 9999 1GM") return "gold";
  if (desc === "TT. BAR (0.995)" || desc === "TT. BAR (0.999)" || desc === "TT. BAR 995" || desc === "TT. BAR 24K" || desc === "TT. BAR" || desc === "Ten Tola Bar TTB") return "tt_bar";
  if (desc === "KG BAR (0.995)" || desc === "KG BAR 995" || desc === "KG BAR" || desc === "KG. BAR" || desc === "Gold 9999 1KG" || desc === "Kilo Bar 995 1KG") return "kg_bar";
  if (desc === "Silver (0.999)" || desc === "Silver 999" || desc === "Silver") return "silver";
  // Anything else (custom-typed description, saved custom price, or a Product) is Custom
  return "custom";
}

function getRateForDesc(description: string, prices: PricesData | undefined, fallback: number): number {
  if (!prices) return fallback;
  if (description === "Gold 22K (0.916)" || description === "Gold 21K (0.875)" || description === "Gold 18K (0.750)" || description === "Gold Jewelry 22k" || description === "Gold Jewelry 21k" || description === "Gold Jewelry 18k" || description === "Gold Jewelry" || description === "22K Gold Jewelry" || description === "Jewellery 22K 1GM") return prices.goldJewelryRate;
  if (description === "GOLD (0.9999)" || description === "GOLD 999.99" || description === "GOLD" || description === "24K GOLD" || description === "Gold 9999 1GM") return prices.goldBullionRate;
  if (description === "TT. BAR (0.995)" || description === "TT. BAR 995" || description === "TT. BAR" || description === "Ten Tola Bar TTB") return prices.ttBarRate;
  if (description === "TT. BAR (0.999)" || description === "TT. BAR 24K") return prices.ttBar24kRate;
  if (description === "KG BAR (0.995)" || description === "KG BAR 995" || description === "KG BAR" || description === "KG. BAR" || description === "Gold 9999 1KG" || description === "Kilo Bar 995 1KG") return prices.kgBarRate;
  if (description === "Silver (0.999)" || description === "Silver 999" || description === "Silver") return prices.silverPricePerGram;
  // Check custom descriptions
  const custom = (prices as any).customDescriptions as { name: string; rate: number }[] | undefined;
  const found = custom?.find(d => d.name === description);
  if (found) return found.rate;
  return prices.goldPricePerGram;
}

// Decimal-safe rounding. Plain `toFixed()` can misround values like 92.5 * 0.995
// (92.0375) because of binary floating-point representation (e.g. it can come out
// as 92.03749999999999 and round DOWN to 92.037 instead of 92.038). Routing the
// value through exponential notation before rounding avoids that class of bug.
function roundTo(num: number, decimals: number): number {
  const sign = num < 0 ? -1 : 1;
  const rounded = Number(`${Math.round(Number(`${Math.abs(num)}e${decimals}`))}e-${decimals}`);
  return sign * rounded;
}

function calcItem(item: LineItem, globalMetalRate: number): LineItem {
  // Pure Wt. = Gross Wt. × Purity, always computed by direct multiplication —
  // no per-category exceptions. Rounded to 3 decimal places, recalculated live
  // as either value changes (e.g. 92.50 × 0.999 = 92.408).
  const purityFactor = item.purity ? parsePurity(item.purity) : 0;
  const pureWeight = purityFactor > 0 && item.grossWeight > 0
    ? roundTo(item.grossWeight * purityFactor, 3)
    : item.pureWeight;
  // Gold Value = Pure Weight × live Metal Rate, priced per gram (never a mock/fallback constant)
  const goldValue = roundTo(pureWeight * globalMetalRate, 2);
  // Item Total = Gold Value + Making Amount
  const totalPrice = roundTo(goldValue + item.makingAmt, 2);
  return { ...item, pureWeight, totalPrice };
}

export default function NewInvoice() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createInvoice = useCreateInvoice();
  const createCustomer = useCreateCustomer();

  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });
  // staleTime: Infinity + refetchOnWindowFocus: false — once this invoice draft
  // loads the dashboard rate, editing Prices in another tab must NOT silently
  // change it. The rate only updates via the explicit "Re-sync" action below.
  const { data: prices } = useGetPrices({ query: { queryKey: getGetPricesQueryKey(), staleTime: Infinity, refetchOnWindowFocus: false } });
  const { data: products } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });

  const goldRate = prices?.goldPricePerGram ?? 320;

  const [customerId, setCustomerId] = useState<number | undefined>();
  const [customerName, setCustomerName] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPassportNumber, setCustomerPassportNumber] = useState("");
  const [customerEmiratesId, setCustomerEmiratesId] = useState("");
  const [idType, setIdType] = useState<"passport" | "emirates">("passport");
  const [idValue, setIdValue] = useState("");
  const [customerNationality, setCustomerNationality] = useState("");
  const [customerCountry, setCustomerCountry] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [invoiceDate, setInvoiceDate] = useState<string>(() => {
    const now = new Date();
    const tzOffsetMs = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);
  });
  const [paymentMethod, setPaymentMethod] = useState<InvoiceInputPaymentMethod>(InvoiceInputPaymentMethod.cash);
  const [isPending, setIsPending] = useState(false);
  const [notes, setNotes] = useState("");
  const [metalRateOverride, setMetalRateOverride] = useState<number | null>(null);
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [vatRate, setVatRate] = useState<number>(5);
  const [roundOffDiscount, setRoundOffDiscount] = useState<number>(0);

  const [items, setItems] = useState<LineItem[]>([]);

  // Frozen snapshot of the dashboard rate for this draft. Captured ONCE when
  // prices first load, then never auto-updates — even if someone edits the
  // Prices page in another tab while this draft is open. This is the "lock-in"
  // the billing screen relies on: only a manual override (typing, or selecting
  // an item's category) can change what an in-progress invoice uses.
  const [lockedDashboardRate, setLockedDashboardRate] = useState<number | null>(null);
  useEffect(() => {
    if (lockedDashboardRate === null && prices?.goldPricePerGram != null) {
      setLockedDashboardRate(prices.goldPricePerGram);
    }
  }, [prices, lockedDashboardRate]);

  // metalRate follows the LOCKED dashboard snapshot unless manually overridden.
  const metalRate = metalRateOverride ?? lockedDashboardRate ?? prices?.goldPricePerGram ?? 0;

  const handleCustomerSelect = (id: string) => {
    if (id === "walk-in") { setCustomerId(undefined); return; }
    const customer = customers?.find(c => c.id === parseInt(id));
    if (customer) {
      setCustomerId(customer.id);
      setCustomerName(customer.name || "");
      setCustomerMobile(customer.mobile || "");
      setCustomerEmail(customer.email || "");
      setCustomerPassportNumber(customer.passportNumber || "");
      setCustomerEmiratesId(customer.emiratesId || "");
      if (customer.emiratesId) {
        setIdType("emirates"); setIdValue(customer.emiratesId);
      } else {
        setIdType("passport"); setIdValue(customer.passportNumber || "");
      }
      setCustomerNationality((customer as any).nationality || "");
      setCustomerCountry((customer as any).country || "");
      setCustomerAddress((customer as any).address || "");
    }
  };

  const addItem = () => {
    setItems(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      description: "",
      category: "gold_jewelry",
      grossWeight: 0,
      descriptionIsCustom: false,
      purity: "",
      purityIsCustom: false,
      pureWeight: 0,
      makingRate: 0,
      makingAmt: 0,
      totalPrice: 0,
      rate: metalRate || goldRate,
    }]);
  };

  const updateItem = (index: number, field: keyof LineItem, value: string | number | boolean) => {
    // When the item's description/category is (re)selected from the dropdown, the
    // dashboard rate for that exact category (Gold Jewelry, TT. BAR, KG. BAR, etc.)
    // must instantly become the Payment & Summary "Metal Rate" — selecting an item
    // is itself an explicit user action, same as typing an override manually.
    let nextGlobalRate: number | null = null;
    if (field === "description" && value) {
      nextGlobalRate = getRateForDesc(value as string, prices as PricesData | undefined, metalRate || goldRate);
    }

    setItems(prev => {
      const next = [...prev];
      let updated = { ...next[index], [field]: value };
      // When description changes: auto-set category, purity, reset making fields
      if (field === "description") {
        const autoCategory = descToCategory(value as string);
        const autoPurity = DESC_TO_PURITY[value as string] ?? "";
        const suggestedRate = nextGlobalRate ?? (metalRate || goldRate);
        // Gross Weight is never auto-filled — it stays exactly as-is (blank/0
        // for a fresh line item) so every weight is entered manually.
        updated = {
          ...updated,
          rate: suggestedRate,
          category: autoCategory,
          purity: autoPurity,
          purityIsCustom: false,
          makingRate: 0,
          makingAmt: 0,
        };
      }
      // Auto-compute Making Amount = Gross Weight × Making Rate
      if (field === "makingRate") {
        updated.makingAmt = parseFloat((updated.grossWeight * (value as number)).toFixed(2));
      }
      if (field === "grossWeight" && updated.makingRate > 0) {
        updated.makingAmt = parseFloat(((value as number) * updated.makingRate).toFixed(2));
      }
      next[index] = calcItem(updated as LineItem, nextGlobalRate ?? metalRate);
      return next;
    });

    // Sync the Payment & Summary "Metal Rate" field to this item's category rate.
    // Uses the same override slot as manual typing, so the user can still edit it
    // afterward — the input isn't locked just because it was set via selection.
    if (nextGlobalRate !== null) {
      setMetalRateOverride(nextGlobalRate);
    }
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  // Recalculate all items when metal rate changes
  useEffect(() => {
    if (items.length > 0) {
      setItems(prev => prev.map(item => calcItem(item, metalRate)));
    }
  }, [metalRate]);

  // Totals following the formula:
  // Gold Value = Σ(Pure Weight × Metal Rate per gram)
  // Total Before VAT = Gold Value + Σ(Making Amount)
  const totalGrossWeight = items.reduce((s, i) => s + (i.grossWeight || 0), 0);
  const totalPureWeight = items.reduce((s, i) => s + (i.pureWeight || 0), 0);
  // Gold Value always ties to the live/override Metal Rate — never a mock constant.
  const totalGoldValue = roundTo(totalPureWeight * metalRate, 2);
  const totalMakingAmount = items.reduce((s, i) => s + (i.makingAmt || 0), 0);
  const subtotal = roundTo(totalGoldValue + totalMakingAmount, 2);
  const totalBeforeVat = Math.max(0, subtotal);
  const vatAmount = roundTo(totalBeforeVat * vatRate / 100, 2);
  const totalIncludingVat = roundTo(totalBeforeVat + vatAmount - roundOffDiscount, 2);

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const buildInvoiceCreatedAt = () => {
    const now = new Date();
    const [year, month, day] = invoiceDate.split("-").map(Number);
    if (!year || !month || !day) return undefined;
    return new Date(
      year,
      month - 1,
      day,
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds()
    ).toISOString();
  };

  const doCreateInvoice = (resolvedCustomerId?: number) => {
    createInvoice.mutate({
      data: {
        customerId: resolvedCustomerId ?? customerId,
        createdAt: buildInvoiceCreatedAt(),
        customerName,
        customerMobile,
        customerEmail,
        customerPassportNumber: idType === "passport" ? idValue : "",
        customerEmiratesId: idType === "emirates" ? idValue : "",
        customerNationality,
        customerCountry,
        customerAddress: customerAddress || undefined,
        paymentMethod,
        isPending,
        notes,
        metalRate: metalRate || goldRate,
        placeOfSupply,
        subtotal,
        discount: roundOffDiscount,
        total: totalIncludingVat,
        vatRate,
        vatAmount,
        totalBeforeVat,
        totalIncludingVat,
        roundOffDiscount,
        items: items.map(item => ({
          description: item.description || "-",
          category: item.category,
          quantity: 1,
          grossWeight: item.grossWeight || undefined,
          purity: item.purity || undefined,
          pureWeight: item.pureWeight || undefined,
          makingRate: item.makingRate || undefined,
          makingAmt: item.makingAmt || undefined,
          unitPrice: metalRate || goldRate,
          totalPrice: item.totalPrice,
        })),
      }
    }, {
      onSuccess: (data) => {
        toast({ title: "Invoice created successfully" });
        setLocation(`/invoices/${data.id}`);
      },
      onError: (err: any) => {
        toast({ title: "Error creating invoice", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleSubmit = () => {
    if (!customerName) {
      toast({ title: "Validation Error", description: "Customer name is required", variant: "destructive" });
      return;
    }

    // If this is a new (not existing) customer, auto-save them to Customers first
    if (!customerId && customerName) {
      createCustomer.mutate({
        data: {
          name: customerName,
          mobile: customerMobile || undefined,
          email: customerEmail || undefined,
          passportNumber: idType === "passport" ? idValue || undefined : undefined,
          emiratesId: idType === "emirates" ? idValue || undefined : undefined,
          nationality: customerNationality || undefined,
          country: customerCountry || undefined,
          address: customerAddress || undefined,
        }
      }, {
        onSuccess: (newCustomer) => {
          queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey({}) });
          setCustomerId(newCustomer.id);
          doCreateInvoice(newCustomer.id);
        },
        onError: () => {
          // Even if customer save fails, still create the invoice
          doCreateInvoice();
        }
      });
    } else {
      doCreateInvoice();
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-20">
      <div className="flex items-center gap-4">
        <Link href="/invoices">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">New Invoice</h1>
          {prices && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Gold Rate: AED {goldRate}/g &nbsp;|&nbsp; Silver Rate: AED {prices.silverPricePerGram}/g
            </p>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* Invoice Items */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Invoice Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded overflow-hidden border border-border">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ backgroundColor: "#1e3a5f" }}>
                    <th className="py-2.5 px-3 text-left text-xs font-semibold text-white whitespace-nowrap w-10">S.No.</th>
                    <th className="py-2.5 px-3 text-left text-xs font-semibold text-white whitespace-nowrap min-w-[180px]">Stock Description</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[100px]">Gross Wt.</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[120px]">Purity</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[90px]">Pure Wt.</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[110px]">Making Rate</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[120px]">Making Amt. (AED)</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[110px]">Total (AED)</th>
                    <th className="w-8 bg-[#1e3a5f]"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id} className="border-b border-border/50 even:bg-muted/20">
                      <td className="py-2 px-3 text-center text-muted-foreground text-sm">{index + 1}</td>
                      <td className="py-2 px-3 min-w-[180px]">
                        {item.descriptionIsCustom ? (
                          <div className="flex gap-1 items-center">
                            <Input
                              autoFocus
                              placeholder="Type description…"
                              value={item.description}
                              onChange={e => updateItem(index, "description", e.target.value)}
                              className="h-8 text-sm"
                            />
                            <button
                              type="button"
                              className="text-[10px] text-blue-500 hover:underline whitespace-nowrap"
                              onClick={() => {
                                updateItem(index, "descriptionIsCustom" as keyof LineItem, false);
                                updateItem(index, "description", "");
                              }}
                            >List</button>
                          </div>
                        ) : (
                          <Select
                            value={item.description}
                            onValueChange={val => {
                              if (val === "__custom__") {
                                updateItem(index, "descriptionIsCustom" as keyof LineItem, true);
                                updateItem(index, "description", "");
                              } else {
                                updateItem(index, "description", val);
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Live-Priced Assets</div>
                              {LIVE_ASSET_DESCRIPTIONS.map(d => (
                                <SelectItem key={d} value={d}>{d}</SelectItem>
                              ))}
                              <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-t mt-1 pt-2">Other</div>
                              {(prices?.customDescriptions as {name:string;rate:number}[] ?? []).map(d => (
                                <SelectItem key={d.name} value={d.name}>{d.name}</SelectItem>
                              ))}
                              {products && products.length > 0 && (
                                <>
                                  <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide border-t mt-1 pt-2">Products</div>
                                  {products.map(p => (
                                    <SelectItem key={`product-${p.id}`} value={p.name}>{p.name}</SelectItem>
                                  ))}
                                </>
                              )}
                              <SelectItem value="__custom__">✏️ Custom…</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={item.grossWeight || ""}
                          onChange={e => updateItem(index, "grossWeight", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm text-center"
                        />
                      </td>
                      <td className="py-2 px-3 min-w-[130px]">
                        {!item.purityIsCustom ? (
                          <Select
                            value={PURITY_OPTIONS.includes(item.purity) ? item.purity : ""}
                            onValueChange={val => {
                              if (val === "__custom__") {
                                updateItem(index, "purityIsCustom" as keyof LineItem, true);
                                updateItem(index, "purity", "");
                              } else {
                                updateItem(index, "purity", val);
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue placeholder="Select purity" />
                            </SelectTrigger>
                            <SelectContent>
                              {PURITY_OPTIONS.map(p => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                              ))}
                              <SelectItem value="__custom__">Custom…</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="flex gap-1 items-center">
                            <Input
                              autoFocus
                              placeholder="e.g. 0.916"
                              value={item.purity}
                              onChange={e => updateItem(index, "purity", e.target.value)}
                              className="h-8 text-sm text-center"
                            />
                            <button
                              type="button"
                              className="text-[10px] text-blue-500 hover:underline whitespace-nowrap"
                              onClick={() => {
                                updateItem(index, "purityIsCustom" as keyof LineItem, false);
                                updateItem(index, "purity", "");
                              }}
                            >Presets</button>
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={item.pureWeight || ""}
                          onChange={e => updateItem(index, "pureWeight", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm text-center"
                          placeholder="0.0000"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.makingRate || ""}
                          onChange={e => updateItem(index, "makingRate", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm text-center"
                        />
                        {item.description && getRateForDesc(item.description, prices as PricesData | undefined, metalRate || goldRate) > 0 && (
                          <button
                            type="button"
                            className="text-[10px] text-center text-amber-600 mt-0.5 w-full hover:underline"
                            onClick={() => updateItem(index, "makingRate", getRateForDesc(item.description, prices as PricesData | undefined, metalRate || goldRate))}
                          >
                            Suggested: {getRateForDesc(item.description, prices as PricesData | undefined, metalRate || goldRate)} AED/g
                          </button>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.makingAmt || ""}
                          onChange={e => updateItem(index, "makingAmt", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm text-center"
                        />
                      </td>
                      <td className="py-2 px-3 text-center font-semibold font-mono text-sm text-primary">
                        {fmt(item.totalPrice)}
                      </td>
                      <td className="py-2 px-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => removeItem(index)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button variant="outline" className="mt-4 w-full border-dashed" onClick={addItem}>
              <Plus className="w-4 h-4 mr-2" /> Add Line Item
            </Button>
          </CardContent>
        </Card>

        {/* Invoice Details + Customer Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Customer Details */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Customer Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {customers && customers.length > 0 && (
                <div className="space-y-2">
                  <Label>Existing Customer</Label>
                  <Select onValueChange={handleCustomerSelect}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select or type below" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in / New Customer</SelectItem>
                      {customers.map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.name}{c.mobile ? ` (${c.mobile})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" />
              </div>
              <div className="space-y-2">
                <Label>Mobile Number</Label>
                <Input value={customerMobile} onChange={e => setCustomerMobile(e.target.value)} placeholder="+971 50 123 4567" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>ID Type</Label>
                  <Select value={idType} onValueChange={v => { setIdType(v as "passport" | "emirates"); setIdValue(""); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="passport">Passport No.</SelectItem>
                      <SelectItem value="emirates">Emirates ID</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{idType === "passport" ? "Passport Number" : "Emirates ID"}</Label>
                  <Input
                    value={idValue}
                    onChange={e => setIdValue(e.target.value)}
                    placeholder={idType === "passport" ? "e.g. A1234567" : "784-XXXX-XXXXXXX-X"}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="email@example.com" type="email" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Nationality</Label>
                  <Input value={customerNationality} onChange={e => setCustomerNationality(e.target.value)} placeholder="e.g. Indian" />
                </div>
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Input value={customerCountry} onChange={e => setCustomerCountry(e.target.value)} placeholder="e.g. UAE" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Textarea value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder="Full address..." rows={2} />
              </div>
            </CardContent>
          </Card>

          {/* Payment & Summary */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Payment & Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Metal Rate (AED/g)</Label>
                  {(prices as PricesData | undefined)?.liveModeConnected ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                      <span className="text-emerald-500">●</span> Live Market Rate
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <span>●</span> Manual Mode (Offline)
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={metalRateOverride ?? metalRate}
                    onChange={e => setMetalRateOverride(parseFloat(e.target.value) || 0)}
                    placeholder="e.g. 320.000"
                  />
                  {metalRateOverride !== null && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-blue-500 hover:underline"
                      onClick={() => setMetalRateOverride(null)}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Invoice Date</Label>
                <Input
                  type="date"
                  value={invoiceDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={e => setInvoiceDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Place of Supply</Label>
                <Input value={placeOfSupply} onChange={e => setPlaceOfSupply(e.target.value)} placeholder="e.g. Dubai" />
              </div>

              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={(val: any) => setPaymentMethod(val)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={InvoiceInputPaymentMethod.cash}>Cash Payment</SelectItem>
                    <SelectItem value={InvoiceInputPaymentMethod.card}>Card Payment</SelectItem>
                    <SelectItem value={InvoiceInputPaymentMethod.bank_transfer}>Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Pending Payment</Label>
                  <div className="text-xs text-muted-foreground mt-0.5">Mark if not fully received</div>
                </div>
                <Switch checked={isPending} onCheckedChange={setIsPending} />
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." className="h-16 resize-none" />
              </div>

              {/* VAT Breakdown */}
              <div className="border rounded-md overflow-hidden">
                <div className="p-3 space-y-2 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Gold Value ({fmt(totalPureWeight)}g pure × {fmt(metalRate)}/g)</span>
                    <span>{fmt(totalGoldValue)} AED</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Making Amount</span>
                    <span>+ {fmt(totalMakingAmount)} AED</span>
                  </div>
                  {vatAmount > 0 && (
                    <div className="flex justify-between font-medium border-t pt-2">
                      <span>Total Before VAT</span>
                      <span>{fmt(totalBeforeVat)} AED</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span>VAT</span>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        className="w-16 h-7 text-center text-sm px-1"
                        value={vatRate}
                        onChange={e => setVatRate(parseFloat(e.target.value) || 0)}
                      />
                      <span>%</span>
                    </div>
                    {vatAmount > 0 && <span className="font-medium">+ {fmt(vatAmount)} AED</span>}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Round Off Discount</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-24 h-7 text-right text-sm"
                      value={roundOffDiscount || ""}
                      onChange={e => setRoundOffDiscount(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <div className="flex justify-between px-3 py-2.5 font-bold text-base border-t" style={{ backgroundColor: "#1e3a5f", color: "white" }}>
                  <span>Total Including VAT</span>
                  <span>{fmt(totalIncludingVat)} AED</span>
                </div>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleSubmit}
                disabled={createInvoice.isPending}
              >
                {createInvoice.isPending ? "Generating..." : "Generate Invoice"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
