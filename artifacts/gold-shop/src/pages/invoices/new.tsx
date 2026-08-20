import React, { useState, useEffect, useMemo } from "react";
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
  PriceItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { tenTolaPurityMultiplier } from "@/lib/invoice-category-rates";

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
  gold22kRate: number;
  gold21kRate: number;
  gold18kRate: number;
  gold9999Rate: number;
  goldKg9999Rate: number;
  manualInvoiceMode?: boolean;
}

// Canonical live-priced item list — exactly the 8 trade items plus Silver.
// Names use the "(purity)" suffix convention so staff can see the fineness
// at a glance and the rate resolver can match unambiguously.
const LIVE_ASSET_DESCRIPTIONS = [
  "TEN TOLA BAR (0.9999)",
  "GOLD 9999 (0.9999)",
  "KG BAR (0.9999)",
  "KG BAR (0.995)",
  "995",
  "Gold Jewelry 22K",
  "Gold Jewelry 21K",
  "Gold Jewelry 18K",
  "Silver",
] as const;

// Visual-only display labels for the dropdown — underlying values (above) stay
// canonical so rate resolution is unaffected.
const DESC_DISPLAY_LABEL: Record<string, string> = {
  "TEN TOLA BAR (0.9999)": "TEN TOLA BAR",
  "GOLD 9999 (0.9999)":    "GOLD 9999",
  "KG BAR (0.9999)":  "GOLD KG",
  "KG BAR (0.995)":   "KG BAR",
};

// Gross Weight is always entered manually — no description ever auto-fills a
// default weight. The user must type the exact weight for every line item.

// Selecting a Stock Description only SUGGESTS a starting Purity value in the
// separate Purity dropdown — the user can freely change it afterward, and the
// Pure Weight formula always multiplies by whatever purity is currently
// selected (see calcItem), never by this initial suggestion.
const DESC_TO_PURITY: Record<string, string> = {
  // ── Canonical item names ─────────────────────────────────────────────────
  "TEN TOLA BAR (0.995)":  "0.995",
  "TEN TOLA BAR (0.9999)": "0.9999",
  "GOLD 9999 (0.9999)":    "0.9999",
  "KG BAR (0.995)":   "0.995",
  "995":              "0.995",
  "KG BAR (0.9999)":  "0.9999",
  "Gold Jewelry 22K": "0.916",
  "Gold Jewelry 21K": "0.875",
  "Gold Jewelry 18K": "0.750",
  "Silver":           "0.999",
  // ── Legacy aliases (backward compatibility with existing invoices) ────────
  "TT. BAR (0.995)": "0.995",
  "TT. BAR (0.9999)": "0.9999",
  "GOLD (0.9999)": "0.9999",
  "TT. BAR": "0.995",
  "KG BAR":  "0.995",
  "GOLD":    "0.9999",
  "TT. BAR (0.999)": "0.999",
  "GOLD KG (0.9999)": "0.9999",
  "Gold 22K (0.916)": "0.916",
  "Gold 21K (0.875)": "0.875",
  "Gold 18K (0.750)": "0.750",
  "Silver (0.999)": "0.999",
  "TT. BAR 995": "0.995",
  "TT. BAR 24K": "0.999",
  "Gold Jewelry 22k": "0.916",
  "Gold Jewelry 21k": "0.875",
  "Gold Jewelry 18k": "0.750",
  "GOLD 999.99": "0.9999",
  "KG BAR 995": "0.995",
  "Silver 999": "0.999",
  "Gold Jewelry": "0.916",
  "22K Gold Jewelry": "0.916",
  "24K GOLD": "0.9999",
  "KG. BAR": "0.995",
  "Ten Tola Bar TTB": "0.995",
  "Jewellery 22K 1GM": "0.916",
  "Gold 9999 1GM": "0.9999",
  "Gold 9999 1KG": "0.9999",
  "Kilo Bar 995 1KG": "0.995",
};

const JEWELRY_DESCS = new Set([
  "Gold Jewelry 22K", "Gold Jewelry 21K", "Gold Jewelry 18K",
  "Gold 22K (0.916)", "Gold 21K (0.875)", "Gold 18K (0.750)",
  "Gold Jewelry 22k", "Gold Jewelry 21k", "Gold Jewelry 18k",
  "Gold Jewelry", "22K Gold Jewelry", "Jewellery 22K 1GM",
]);
const GOLD_DESCS = new Set([
  "GOLD 9999 (0.9999)", "GOLD (0.9999)", "KG BAR (0.9999)", "GOLD KG (0.9999)",
  "GOLD 999.99", "GOLD", "24K GOLD", "Gold 9999 1GM", "Gold 9999 1KG",
]);
const TT_BAR_DESCS = new Set([
  "TEN TOLA BAR (0.995)", "TEN TOLA BAR (0.9999)",
  "TT. BAR (0.995)", "TT. BAR (0.9999)", "TT. BAR", "TT. BAR (0.999)",
  "TT. BAR 995", "TT. BAR 24K", "Ten Tola Bar TTB", "995",
]);
const KG_BAR_DESCS = new Set([
  "KG BAR (0.995)", "KG BAR", "KG BAR 995", "KG. BAR", "Kilo Bar 995 1KG",
]);
const SILVER_DESCS = new Set(["Silver", "Silver (0.999)", "Silver 999"]);


function descToCategory(desc: string): string {
  if (JEWELRY_DESCS.has(desc)) return "gold_jewelry";
  if (GOLD_DESCS.has(desc))    return "gold_9999";
  if (TT_BAR_DESCS.has(desc))  return "ten_tola_bar";
  if (KG_BAR_DESCS.has(desc))  return "kg_bar";
  if (SILVER_DESCS.has(desc))  return "silver";
  return "custom";
}

// When the Purity dropdown is changed directly, the Metal Rate AED/g must
// instantly resolve to the matching first-class asset's own saved/live rate.
// Labor cost % is applied to jewelry purities (0.916 / 0.875 / 0.750) when
// a non-zero laborPct is supplied.
function getRateForPurity(
  purity: string,
  category: string,
  prices: PricesData | undefined,
  fallback: number,
  rawAedPerGram?: number | null,
  laborPct = 0,
): number {
  if (category === "silver") return prices?.silverPricePerGram ?? fallback;
  const lm = 1 + laborPct / 100;
  if (rawAedPerGram && rawAedPerGram > 0) {
    if (purity === "0.9999") return roundTo(rawAedPerGram * 0.9999, 2);
    if (purity === "0.916")  return roundTo(rawAedPerGram * (22 / 24) * lm, 2);
    if (purity === "0.875")  return roundTo(rawAedPerGram * (21 / 24) * lm, 2);
    if (purity === "0.750")  return roundTo(rawAedPerGram * (18 / 24) * lm, 2);
    if (purity === "0.995")  return roundTo(rawAedPerGram * 0.995, 2);
    if (purity === "0.999")  return roundTo(rawAedPerGram * 0.999, 2);
    const factor = parsePurity(purity);
    if (factor > 0) return roundTo(rawAedPerGram * factor, 2);
    return fallback;
  }
  if (!prices) return fallback;
  if (purity === "0.9999") return prices.gold9999Rate;
  if (purity === "0.916") return prices.gold22kRate;
  if (purity === "0.875") return prices.gold21kRate;
  if (purity === "0.750") return prices.gold18kRate;
  if (purity === "0.995") return prices.ttBarRate;
  if (purity === "0.999") return prices.ttBar24kRate;
  const factor = parsePurity(purity);
  if (!factor) return fallback;
  return roundTo(prices.goldBullionRate * factor, 2);
}

// Resolve the per-gram Metal Rate for a given item description.
// Hierarchy: live spot math → DB stored rates → fallback.
// laborPct is applied to all jewelry items (22K/21K/18K) so the rate
// matches the formula: Adjusted_Base × purity × (1 + labor%/100).
function getRateForDesc(
  description: string,
  prices: PricesData | undefined,
  fallback: number,
  rawAedPerGram?: number | null,
  laborPct = 0,
): number {
  const lm = 1 + laborPct / 100;

  if (rawAedPerGram && rawAedPerGram > 0) {
    // Bars & bullion (no labor)
    if (TT_BAR_DESCS.has(description)) {
      return roundTo(rawAedPerGram * tenTolaPurityMultiplier(description), 2);
    }
    if (KG_BAR_DESCS.has(description)) return roundTo(rawAedPerGram * 0.995, 2);
    if (GOLD_DESCS.has(description))   return roundTo(rawAedPerGram * 0.9999, 2);
    // Jewelry (labor applied)
    if (JEWELRY_DESCS.has(description)) {
      if (description === "Gold Jewelry 21K" || description === "Gold 21K (0.875)" || description === "Gold Jewelry 21k")
        return roundTo(rawAedPerGram * (21 / 24) * lm, 2);
      if (description === "Gold Jewelry 18K" || description === "Gold 18K (0.750)" || description === "Gold Jewelry 18k")
        return roundTo(rawAedPerGram * (18 / 24) * lm, 2);
      return roundTo(rawAedPerGram * (22 / 24) * lm, 2);   // 22K and generic jewelry
    }
    // Silver
    if (SILVER_DESCS.has(description)) return prices?.silverPricePerGram ?? fallback;
  }

  // DB fallbacks (manual mode or no live feed)
  if (!prices) return fallback;
  if (JEWELRY_DESCS.has(description)) {
    if (description === "Gold Jewelry 21K" || description === "Gold 21K (0.875)" || description === "Gold Jewelry 21k") return prices.gold21kRate;
    if (description === "Gold Jewelry 18K" || description === "Gold 18K (0.750)" || description === "Gold Jewelry 18k") return prices.gold18kRate;
    return prices.gold22kRate;
  }
  if (description === "TEN TOLA BAR (0.9999)" || description === "TT. BAR (0.9999)") return prices.ttBar24kRate;
  if (description === "KG BAR (0.9999)" || description === "GOLD KG (0.9999)") return prices.goldKg9999Rate;
  if (GOLD_DESCS.has(description)) return prices.gold9999Rate;
  if (TT_BAR_DESCS.has(description)) return prices.ttBarRate;
  if (KG_BAR_DESCS.has(description)) return prices.kgBarRate;
  if (SILVER_DESCS.has(description)) return prices.silverPricePerGram;
  // Custom saved descriptions
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

// Every line item reads from a SINGLE global Metal Rate (AED/g) — the one
// field in the Payment & Summary panel. There is no per-row rate; every
// line item's Gold Value, and the invoice total, are always driven by this
// one shared number.
function calcItem(item: LineItem, metalRate: number): LineItem {
  // Pure Wt. = Gross Wt. × Purity, always computed by direct multiplication —
  // no per-category exceptions. Rounded to 3 decimal places, recalculated live
  // as either value changes (e.g. 92.50 × 0.999 = 92.408).
  const purityFactor = item.purity ? parsePurity(item.purity) : 0;
  const pureWeight = purityFactor > 0 && item.grossWeight > 0
    ? roundTo(item.grossWeight * purityFactor, 3)
    : item.pureWeight;
  // Gold Value = GROSS Weight × the single global Metal Rate, priced per gram.
  // The metal rate is already the per-gross-gram selling rate for the chosen
  // item/purity, so purity must NOT discount the total again. Pure Weight stays
  // as an informational column only.
  const goldValue = roundTo(item.grossWeight * (metalRate || 0), 2);
  // Item Total = Gold Value + Making Amount
  const totalPrice = roundTo(goldValue + item.makingAmt, 2);
  return { ...item, pureWeight, totalPrice };
}

// Determines "the 100% accurate live calculated rate" that should be pushed
// into the global Metal Rate field — resolved from the invoice's primary
// item (the first row that has a description or purity chosen). Falls back
// to the raw live spot rate when no item has been specified yet.
function resolvePrimaryRate(
  currentItems: LineItem[],
  prices: PricesData | undefined,
  fallback: number,
  rawAedPerGram?: number | null,
  laborPct = 0,
): number {
  const primary = currentItems.find(i => i.description || i.purity);
  if (!primary) return fallback;
  if (primary.description) return getRateForDesc(primary.description, prices, fallback, rawAedPerGram, laborPct);
  return getRateForPurity(primary.purity, primary.category, prices, fallback, rawAedPerGram, laborPct);
}

export default function NewInvoice() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createInvoice = useCreateInvoice();
  const createCustomer = useCreateCustomer();

  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });
  // Live rates are the absolute source of truth for every calculation on this
  // page — the invoice draft must never freeze/lock a stale rate. Poll every
  // 5s so a change on the Prices page (manual edit, or the live feed ticking)
  // flows straight into every line item's own rate and the totals below.
  const { data: prices } = useGetPrices({
    query: { queryKey: getGetPricesQueryKey(), refetchInterval: 5000, refetchIntervalInBackground: true },
  });
  const { data: products } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });

  const isManualMode = !!(prices as PricesData | undefined)?.manualInvoiceMode;
  const goldRate = prices?.goldPricePerGram ?? 320;

  // Per-gram AED from the prices API (live, polled every 5s)
  const liveAed: number | null = (prices as any)?.goldPricePerGram ?? null;

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
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [vatRate, setVatRate] = useState<number>(5);
  const [roundOffDiscount, setRoundOffDiscount] = useState<number>(0);

  const [items, setItems] = useState<LineItem[]>([]);

  // The single, global Metal Rate (AED/g) — the ONE source every line item's
  // Gold Value and the invoice total are calculated from. There is no more
  // per-row rate. While Live Mode is connected, this is kept in lockstep with
  // the invoice's primary item (see the effect below) and is read-only; while
  // disconnected, the user can type it directly.
  const [metalRate, setMetalRate] = useState<number>(0);

  const baselineRate = prices?.gold9999Rate ?? prices?.goldBullionRate ?? goldRate;

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
    }]);
    // The very first row added to a fresh invoice should immediately give the
    // global Metal Rate field a sensible starting value.
    if (items.length === 0) setMetalRate(baselineRate);
  };

  const updateItem = (index: number, field: keyof LineItem, value: string | number | boolean) => {
    let pushedRate: number | null = null;
    setItems(prev => {
      const next = [...prev];
      let updated = { ...next[index], [field]: value };
      // Selecting a Stock Description OR changing Purity is an explicit
      // trigger to instantly re-derive the correct live rate — computed as
      // Live Spot Gold Rate × Selected Purity Factor (or the asset's own
      // first-class live rate when one exists) — and push it straight into
      // the single GLOBAL Metal Rate field. The user never types a per-row
      // rate anymore.
      if (field === "description") {
        const autoCategory = descToCategory(value as string);
        const autoPurity = DESC_TO_PURITY[value as string] ?? "";
        if (value) {
          pushedRate = getRateForDesc(value as string, prices as PricesData | undefined, metalRate || baselineRate, liveAed, 0);
        }
        // Gross Weight is never auto-filled — it stays exactly as-is (blank/0
        // for a fresh line item) so every weight is entered manually.
        updated = {
          ...updated,
          category: autoCategory,
          purity: autoPurity,
          purityIsCustom: false,
          makingRate: 0,
          makingAmt: 0,
        };
      }
      // Purity change is display-only — it does NOT recalculate or override the
      // metal rate. The rate is locked to whatever was pulled from the price list
      // when the item description was selected. Changing purity only affects the
      // Pure Weight column (grossWeight × purityFactor) and is otherwise inert.
      // Auto-compute Making Amount = Gross Weight × Making Rate
      if (field === "makingRate") {
        updated.makingAmt = parseFloat((updated.grossWeight * (value as number)).toFixed(2));
      }
      if (field === "grossWeight" && updated.makingRate > 0) {
        updated.makingAmt = parseFloat(((value as number) * updated.makingRate).toFixed(2));
      }
      next[index] = calcItem(updated as LineItem, pushedRate ?? metalRate);
      return next;
    });
    if (pushedRate != null) setMetalRate(pushedRate);
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  // While Live Mode is connected, keep the global Metal Rate locked to "the
  // 100% accurate live calculated rate" for the invoice's primary item —
  // recomputed whenever `prices` ticks or whenever any item's description/
  // purity changes. Depends on a stable description|purity signature (not the
  // `items` array reference itself) so this never fights with the recompute
  // effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Purity is intentionally excluded — purity changes must NOT re-trigger a
  // rate recalculation. Only description/category changes should re-sync the rate.
  const itemSignature = items.map(i => `${i.description}|${i.category}`).join("~");
  // Seed the global Metal Rate with a sensible baseline the moment prices
  // first load (covers page load / Live Mode toggling before any item has a
  // description or purity chosen yet).
  useEffect(() => {
    if (metalRate === 0 && baselineRate > 0) setMetalRate(baselineRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineRate]);

  // Every line item's Pure Weight + Total must fully recalculate the instant
  // the single global Metal Rate changes — whether that's a live tick, an
  // auto-push from a description/purity pick, or a manual edit while offline.
  useEffect(() => {
    setItems(prev => prev.map(item => calcItem(item, metalRate)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metalRate]);

  // Totals following the formula:
  // Gold Value = Σ(Gross Weight) × the single global Metal Rate per gram
  // Total Before VAT = Gold Value + Σ(Making Amount)
  const totalGrossWeight = items.reduce((s, i) => s + (i.grossWeight || 0), 0);
  const totalPureWeight = items.reduce((s, i) => s + (i.pureWeight || 0), 0);
  const totalGoldValue = roundTo(items.reduce((s, i) => s + roundTo((i.grossWeight || 0) * metalRate, 2), 0), 2);
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
          // Frozen decimal multiplier applied at the moment this invoice was
          // created — sent as a literal number, never re-derived server-side.
          purityMultiplier: item.purity ? parsePurity(item.purity) : undefined,
          pureWeight: item.pureWeight || undefined,
          makingRate: item.makingRate || undefined,
          makingAmt: item.makingAmt || undefined,
          // Literal frozen metal rate (AED/gram) locked in at sale time — the
          // single global rate, written to the DB as a plain number and must
          // never be recomputed from a live price feed when the invoice is
          // viewed/printed later.
          unitPrice: metalRate || goldRate,
          totalPrice: item.totalPrice,
        })),
      }
    }, {
      onSuccess: (data) => {
        toast({ title: "Invoice created successfully" });
        // Stock auto-deduction warnings (sold more than available)
        if (data.stockWarnings && data.stockWarnings.length > 0) {
          for (const w of data.stockWarnings) {
            toast({ title: "Stock warning", description: w, variant: "destructive" });
          }
        }
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
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-20 px-1 sm:px-0">
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
                    <th className="py-2.5 px-3 text-left text-xs font-semibold text-white whitespace-nowrap min-w-[220px]">Stock Description</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[130px]">Gross Wt.</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[150px]">Purity</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[110px]">Pure Wt.</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[140px]">Making Rate</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[150px]">Making Amt. (AED)</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[130px]">Total (AED)</th>
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
                              <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Stock Description</div>
                              {LIVE_ASSET_DESCRIPTIONS.map(d => (
                                <SelectItem key={d} value={d}>{DESC_DISPLAY_LABEL[d] ?? d}</SelectItem>
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
                          value={item.pureWeight ? item.pureWeight.toFixed(3) : ""}
                          onChange={e => updateItem(index, "pureWeight", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm text-center"
                          placeholder="0.000"
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
                        {item.description && metalRate > 0 && (
                          <button
                            type="button"
                            className="text-[10px] text-center text-amber-600 mt-0.5 w-full hover:underline"
                            onClick={() => updateItem(index, "makingRate", metalRate)}
                          >
                            Suggested: {metalRate} AED/g
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
                  <Label className="text-base font-semibold">Metal Rate (AED/g)</Label>
                  <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                    <span>●</span> Manual Rate
                  </span>
                </div>
                <Input
                  type="number"
                  min="0"
                  step="0.001"
                  className="h-11 text-base font-bold font-mono border-2 border-primary/40"
                  value={metalRate || ""}
                  onChange={e => setMetalRate(parseFloat(e.target.value) || 0)}
                  placeholder="e.g. 320.000"
                />
                <p className="text-[11px] text-muted-foreground">
                  Every line item's Gold Value and the invoice total are calculated from this single rate.
                </p>
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
                    <span>Gold Value ({fmt(totalGrossWeight)}g gross × {fmt(metalRate)}/g)</span>
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
