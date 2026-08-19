import React, { useMemo, useRef, useState } from "react";
import {
  useListStockLevels, getListStockLevelsQueryKey,
  useListStockPurchases, getListStockPurchasesQueryKey,
  useListStockSuppliers, getListStockSuppliersQueryKey,
  useCreateStockPurchase, useDeleteStockPurchase,
  useGetSettings, getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { FileDown, Trash2 } from "lucide-react";
import { useAuth } from "@/context/auth";
import {
  decorateStatementPdf,
  GOLD,
  NAVY,
  PdfSignatureBlock,
  STATEMENT_FINAL_FOOTER_SPACER,
  STATEMENT_FIRST_PAGE_SPACER,
  STATEMENT_PDF_MARGIN,
} from "@/components/pdf-branding";

export const STOCK_CATEGORIES = [
  { id: "gold", label: "GOLD" },
  { id: "tt_bar", label: "TT Bar" },
  { id: "kg_bar", label: "KG Bar" },
  { id: "995", label: "995" },
  { id: "gold_jewelry_22k", label: "Gold Jewelry 22K" },
  { id: "silver", label: "Silver" },
] as const;

export function stockCategoryLabel(id: string): string {
  return STOCK_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

function fmtG(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : format(d, "dd/MM/yyyy");
}

// ─── Purchase / Stock Entry Drawer ──────────────────────────────────────────
export function PurchaseDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createPurchase = useCreateStockPurchase();
  const { data: suppliers } = useListStockSuppliers({ query: { queryKey: getListStockSuppliersQueryKey() } });

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const [category, setCategory] = useState<string>("gold");
  const [supplierName, setSupplierName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(todayStr);
  const [weightUnit, setWeightUnit] = useState<"g" | "kg">("g");
  const [weightInput, setWeightInput] = useState("");
  const [rateInput, setRateInput] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [narrative, setNarrative] = useState("");

  const weightGrams = (parseFloat(weightInput) || 0) * (weightUnit === "kg" ? 1000 : 1);
  const totalPriceAed = parseFloat(totalPrice) || 0;
  const pricePerGram = weightGrams > 0 ? totalPriceAed / weightGrams : 0;

  // Total Cost auto-calculates from Gross Weight x Purchase Rate whenever
  // either changes; the total stays manually editable (which clears the rate).
  const syncTotal = (weightStr: string, unit: "g" | "kg", rateStr: string) => {
    const g = (parseFloat(weightStr) || 0) * (unit === "kg" ? 1000 : 1);
    const rate = parseFloat(rateStr) || 0;
    // Only act while the rate field is driving the total (rate non-empty):
    // a manually entered total (rate cleared) is never touched here.
    if (rateStr === "") return;
    if (g > 0 && rate > 0) setTotalPrice((g * rate).toFixed(2));
    // Zeroing/invalidating a driving rate clears the stale auto total.
    else setTotalPrice("");
  };

  const reset = () => {
    setCategory("gold"); setSupplierName(""); setPurchaseDate(todayStr);
    setWeightUnit("g"); setWeightInput(""); setRateInput(""); setTotalPrice(""); setNarrative("");
  };

  const handleSave = () => {
    if (!supplierName.trim()) { toast({ title: "Supplier name is required", variant: "destructive" }); return; }
    if (!(weightGrams > 0)) { toast({ title: "Enter a valid weight", variant: "destructive" }); return; }
    if (!(totalPriceAed >= 0) || totalPrice === "") { toast({ title: "Enter the total purchase price", variant: "destructive" }); return; }
    createPurchase.mutate(
      { data: { category: category as any, supplierName: supplierName.trim(), purchaseDate, weightGrams, totalPriceAed, ...(narrative.trim() ? { narrative: narrative.trim() } : {}) } },
      {
        onSuccess: () => {
          toast({ title: "Stock purchase recorded", description: `${fmtG(weightGrams)} g ${stockCategoryLabel(category)} from ${supplierName.trim()}` });
          queryClient.invalidateQueries({ queryKey: getListStockLevelsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListStockPurchasesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListStockSuppliersQueryKey() });
          reset();
          onOpenChange(false);
        },
        onError: (e: any) => toast({ title: "Failed to record purchase", description: e?.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Purchase / Stock Entry</SheetTitle>
          <SheetDescription>Record a stock purchase from a supplier. Stock levels update automatically.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 mt-6">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STOCK_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Supplier / Vendor Name</Label>
            <Input
              list="supplier-names"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="e.g. Rahim, Karim, Jabbar"
            />
            <datalist id="supplier-names">
              {suppliers?.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div className="space-y-1.5">
            <Label>Purchase Date</Label>
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Quantity / Weight</Label>
            <div className="flex gap-2">
              <Input
                type="number" min="0" step="any" className="flex-1"
                value={weightInput} onChange={(e) => { setWeightInput(e.target.value); syncTotal(e.target.value, weightUnit, rateInput); }}
                placeholder={weightUnit === "kg" ? "e.g. 1.5" : "e.g. 1500"}
              />
              <Select value={weightUnit} onValueChange={(v) => { setWeightUnit(v as "g" | "kg"); syncTotal(weightInput, v as "g" | "kg", rateInput); }}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="g">Grams</SelectItem>
                  <SelectItem value="kg">KG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {weightUnit === "kg" && weightGrams > 0 && (
              <p className="text-xs text-muted-foreground">= {fmtG(weightGrams)} grams</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Purchase Rate (AED/g)</Label>
            <Input
              type="number" min="0" step="any"
              value={rateInput}
              onChange={(e) => {
                setRateInput(e.target.value);
                // Clearing the driving rate clears its auto total; otherwise re-sync.
                if (e.target.value === "") setTotalPrice("");
                else syncTotal(weightInput, weightUnit, e.target.value);
              }}
              placeholder="e.g. 470"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Total Cost (AED)</Label>
            <Input
              type="number" min="0" step="any"
              value={totalPrice} onChange={(e) => { setTotalPrice(e.target.value); setRateInput(""); }}
              placeholder="Auto: Weight x Rate (editable)"
            />
            {rateInput && weightGrams > 0 && (
              <p className="text-xs text-muted-foreground">Auto-calculated: {fmtG(weightGrams)} g x {rateInput} AED/g</p>
            )}
          </div>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm flex justify-between">
            <span className="text-muted-foreground">Price Per Gram (auto)</span>
            <span className="font-semibold">AED {fmtAED(pricePerGram)}</span>
          </div>
          <div className="space-y-1.5">
            <Label>Narrative Note (optional)</Label>
            <Input
              value={narrative} onChange={(e) => setNarrative(e.target.value)}
              placeholder={'e.g. "100.000 gms 22K recd @ 470/g"'}
            />
          </div>
          <Button className="w-full" onClick={handleSave} disabled={createPurchase.isPending}>
            {createPurchase.isPending ? "Saving..." : "Save Purchase"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Stock Levels + Supplier Ledger tab ─────────────────────────────────────
export function StockLedger() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const companyName = settings?.companyName ?? "HAZARI GOLD L.L.C";
  const companyTrn = settings?.trn ?? "";

  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const params = {
    supplier: supplierFilter === "all" ? undefined : supplierFilter,
    category: categoryFilter === "all" ? undefined : categoryFilter,
  };
  const { data: levels } = useListStockLevels({ query: { queryKey: getListStockLevelsQueryKey() } });
  const { data: purchases, isLoading } = useListStockPurchases(params, {
    query: { queryKey: getListStockPurchasesQueryKey(params) },
  });
  const { data: suppliers } = useListStockSuppliers({ query: { queryKey: getListStockSuppliersQueryKey() } });
  const deletePurchase = useDeleteStockPurchase();

  const filtered = useMemo(() => {
    if (!purchases) return [];
    const q = search.trim().toLowerCase();
    if (!q) return purchases;
    return purchases.filter((p) =>
      p.supplierName.toLowerCase().includes(q) || stockCategoryLabel(p.category).toLowerCase().includes(q),
    );
  }, [purchases, search]);

  const totals = useMemo(() => ({
    grams: filtered.reduce((s, p) => s + p.weightGrams, 0),
    aed: filtered.reduce((s, p) => s + p.totalPriceAed, 0),
  }), [filtered]);

  const handleDelete = (id: number, supplier: string) => {
    if (!confirm(`Delete this purchase from ${supplier}? Stock will be reduced accordingly.`)) return;
    deletePurchase.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Purchase deleted" });
        queryClient.invalidateQueries({ queryKey: getListStockLevelsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListStockPurchasesQueryKey() });
      },
      onError: () => toast({ title: "Failed to delete purchase", variant: "destructive" }),
    });
  };

  const handleDownloadPdf = async () => {
    if (!reportRef.current || filtered.length === 0) return;
    setIsDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const supplierTag = supplierFilter === "all" ? "All-Suppliers" : supplierFilter.replace(/\s+/g, "-");

      const subtitle = `Supplier: ${supplierFilter === "all" ? "All Suppliers" : supplierFilter}${categoryFilter !== "all" ? ` | Category: ${stockCategoryLabel(categoryFilter)}` : ""}`;

      const worker: any = html2pdf()
        .set({
          margin: [...STATEMENT_PDF_MARGIN],
          filename: `Supplier-Statement_${supplierTag}_${format(new Date(), "yyyy-MM-dd")}.pdf`,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(reportRef.current)
        .toPdf()
        .get("pdf")
        .then(async (pdf: any) => {
          await decorateStatementPdf(pdf, {
            title: "Supplier Purchase Statement",
            subtitle,
            userName: user?.fullName ?? "Admin",
            columns: [
              { label: "Date", width: 25 },
              { label: "Supplier", width: 36 },
              { label: "Category", width: 39 },
              { label: "Weight (g)", width: 28, align: "right" },
              { label: "Price/Gram (AED)", width: 31, align: "right" },
              { label: "Total (AED)", width: 31, align: "right" },
            ],
          });
        });

      await worker.save();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Live stock levels per category */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        {STOCK_CATEGORIES.map((c) => {
          const lvl = levels?.find((l) => l.category === c.id);
          const grams = lvl?.weightGrams ?? 0;
          return (
            <Card key={c.id}>
              <CardHeader className="pb-1 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground">{c.label}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <div className={`text-base font-bold ${grams < 0 ? "text-destructive" : ""}`}>{fmtG(grams)} g</div>
                {Math.abs(grams) >= 1000 && (
                  <div className="text-[11px] text-muted-foreground">{(grams / 1000).toFixed(3)} kg</div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Supplier</Label>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Suppliers</SelectItem>
              {suppliers?.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {STOCK_CATEGORIES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-40">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier or category..." />
        </div>
        <Button variant="outline" onClick={handleDownloadPdf} disabled={filtered.length === 0 || isDownloading}>
          <FileDown className="w-4 h-4 mr-1.5" />
          {isDownloading ? "Preparing PDF..." : "Download PDF Statement"}
        </Button>
        {user?.role === "admin" && (
          <Button
            variant="outline"
            onClick={() => {
              const params = new URLSearchParams();
              if (supplierFilter !== "all") params.set("party", supplierFilter);
              const qs = params.toString();
              window.open(`${import.meta.env.BASE_URL}api/dashboard/ledger-pdf${qs ? `?${qs}` : ""}`, "_blank");
            }}
          >
            <FileDown className="w-4 h-4 mr-1.5" />
            Dual-Ledger Account PDF
          </Button>
        )}
      </div>

      {/* Ledger table */}
      <div className="bg-card rounded-md border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Weight (g)</TableHead>
                <TableHead className="text-right">Price/Gram (AED)</TableHead>
                <TableHead className="text-right">Total (AED)</TableHead>
                <TableHead>Narrative / Batch Ref</TableHead>
                <TableHead className="text-right pr-4">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="h-24 text-center">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No purchases recorded yet.</TableCell></TableRow>
              ) : (
                <>
                  {filtered.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="pl-4 whitespace-nowrap">{fmtDate(p.purchaseDate)}</TableCell>
                      <TableCell className="font-medium">{p.supplierName}</TableCell>
                      <TableCell>{stockCategoryLabel(p.category)}</TableCell>
                      <TableCell className="text-right">{fmtG(p.weightGrams)}</TableCell>
                      <TableCell className="text-right">{fmtAED(p.pricePerGram)}</TableCell>
                      <TableCell className="text-right font-semibold">{fmtAED(p.totalPriceAed)}</TableCell>
                      <TableCell className="max-w-52">
                        <div className="text-xs text-muted-foreground truncate" title={p.narrative ?? undefined}>
                          <span className="font-mono text-foreground/80">#BATCH-{p.id}</span>
                          {p.narrative ? <span> — {p.narrative}</span> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(p.id, p.supplierName)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40 font-bold border-t-2">
                    <TableCell className="pl-4" colSpan={3}>Total ({filtered.length} purchases)</TableCell>
                    <TableCell className="text-right">{fmtG(totals.grams)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right">AED {fmtAED(totals.aed)}</TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Hidden printable A4 supplier statement (html2pdf source) */}
      <div style={{ position: "fixed", top: 0, left: "-9999px", width: "190mm" }}>
        <div ref={reportRef} style={{ width: "190mm", fontFamily: "Arial, sans-serif", color: "#222", background: "#fff", boxSizing: "border-box" }}>
          <div aria-hidden="true" style={{ height: STATEMENT_FIRST_PAGE_SPACER }} />
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
                <tr>
                  {["Date", "Supplier", "Category", "Weight (g)", "Price/Gram (AED)", "Total (AED)"].map((h, i) => (
                    <th key={h} style={{ background: NAVY, color: "#fff", textAlign: i >= 3 ? "right" : "left", padding: "8px 8px", border: `1px solid ${NAVY}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, idx) => (
                  <tr key={p.id} style={{ background: idx % 2 === 0 ? "#fff" : "#f7f7f7", breakInside: "avoid" }}>
                    <td style={{ padding: "7px 8px", border: "1px solid #ddd", whiteSpace: "nowrap" }}>{fmtDate(p.purchaseDate)}</td>
                    <td style={{ padding: "7px 8px", border: "1px solid #ddd" }}>{p.supplierName}</td>
                    <td style={{ padding: "7px 8px", border: "1px solid #ddd" }}>{stockCategoryLabel(p.category)}</td>
                    <td style={{ padding: "7px 8px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{fmtG(p.weightGrams)}</td>
                    <td style={{ padding: "7px 8px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>{fmtAED(p.pricePerGram)}</td>
                    <td style={{ padding: "7px 8px", border: "1px solid #ddd", textAlign: "right", whiteSpace: "nowrap" }}>AED {fmtAED(p.totalPriceAed)}</td>
                  </tr>
                ))}
              </tbody>
              <tbody style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                <tr style={{ background: "#eee6cf" }}>
                  <td colSpan={3} style={{ padding: "9px 8px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY }}>
                    Grand Total ({filtered.length} purchases)
                  </td>
                  <td style={{ padding: "9px 8px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY, textAlign: "right", whiteSpace: "nowrap" }}>
                    {fmtG(totals.grams)} g ({(totals.grams / 1000).toFixed(3)} kg)
                  </td>
                  <td style={{ border: `2px solid ${NAVY}` }} />
                  <td style={{ padding: "9px 8px", border: `2px solid ${NAVY}`, fontWeight: "bold", color: NAVY, textAlign: "right", whiteSpace: "nowrap" }}>
                    AED {fmtAED(totals.aed)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={6} style={{ padding: 0, border: 0 }}>
                    <PdfSignatureBlock />
                  </td>
                </tr>
                <tr aria-hidden="true">
                  <td colSpan={6} style={{ height: STATEMENT_FINAL_FOOTER_SPACER, padding: 0, border: 0 }} />
                </tr>
              </tbody>
            </table>
        </div>
      </div>
    </div>
  );
}
