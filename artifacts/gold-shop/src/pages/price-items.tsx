import React, { useState, useEffect } from "react";
import {
  useListPriceItems,
  getListPriceItemsQueryKey,
  useCreatePriceItem,
  useUpdatePriceItem,
  useDeletePriceItem,
  PriceItemInputFormulaType,
} from "@workspace/api-client-react";
import type { PriceItem, PriceItemInput } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lock, Plus, Trash2, Zap } from "lucide-react";

const NAVY = "#1e3a5f";

// ── Formula helpers ───────────────────────────────────────────────────────────
const r2 = (n: number) => Math.round(n * 100) / 100;

function computePrice(item: PriceItem, base: number | null): number | null {
  if (item.formulaType === "manual")
    return item.manualRateAed == null ? null : r2(item.manualRateAed + item.premiumOffsetAed);
  if (base == null) return null;
  if (item.formulaType === "spot_bar")
    return r2(base * (item.weightGrams ?? 0) * item.purityFactor + item.premiumOffsetAed);
  return r2(base * item.purityFactor + item.premiumOffsetAed);
}

function karatLabel(purity: number): string {
  if (Math.abs(purity - 1.0) < 0.0005) return "24K / 9999";
  if (Math.abs(purity - 0.995) < 0.0005) return "24K / 995";
  if (Math.abs(purity - 0.91667) < 0.0006) return "22K";
  if (Math.abs(purity - 0.875) < 0.0005) return "21K";
  if (Math.abs(purity - 0.75) < 0.0005) return "18K";
  return `${(purity * 100).toFixed(3)}%`;
}

const PURITY_PRESETS = [
  { label: "24K — 9999  (1.0000)", value: "1.0" },
  { label: "24K — 995   (0.9950)", value: "0.9950" },
  { label: "22K         (0.9167)", value: "0.91667" },
  { label: "21K         (0.8750)", value: "0.875" },
  { label: "18K         (0.7500)", value: "0.75" },
  { label: "Custom…", value: "custom" },
];

// ── Item Card ─────────────────────────────────────────────────────────────────
function ItemCard({
  item,
  base,
  onUpdate,
  onDelete,
}: {
  item: PriceItem;
  base: number | null;
  onUpdate: (id: number, data: PriceItemInput) => Promise<void>;
  onDelete: (id: number, name: string) => void;
}) {
  const [localOffset, setLocalOffset] = useState(item.premiumOffsetAed);
  const [saving, setSaving] = useState(false);
  const changed = localOffset !== item.premiumOffsetAed;
  const price = computePrice(item, base);
  const isSpot = item.formulaType !== "manual";

  useEffect(() => { setLocalOffset(item.premiumOffsetAed); }, [item.premiumOffsetAed]);

  const fullPatch = (overrides: Partial<PriceItemInput>): PriceItemInput => ({
    name: item.name,
    formulaType: item.formulaType as PriceItemInputFormulaType,
    weightLabel: item.weightLabel,
    purityFactor: item.purityFactor,
    weightGrams: item.weightGrams,
    premiumOffsetAed: item.premiumOffsetAed,
    manualRateAed: item.manualRateAed,
    tvVisible: item.tvVisible,
    displayOrder: item.displayOrder,
    ...overrides,
  });

  const handleSaveOffset = async () => {
    setSaving(true);
    try { await onUpdate(item.id, fullPatch({ premiumOffsetAed: localOffset })); }
    finally { setSaving(false); }
  };

  const handleToggleTv = (val: boolean) => {
    void onUpdate(item.id, fullPatch({ tvVisible: val }));
  };

  return (
    <Card className="relative overflow-hidden flex flex-col">
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: isSpot ? "#10b981" : NAVY }} />
      <CardContent className="pt-5 pb-4 space-y-4 flex flex-col flex-1">

        {/* Header row */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-bold text-sm leading-tight">{item.name}</span>
              {item.isCore && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 flex-shrink-0">
                  <Lock className="w-2.5 h-2.5" />Core
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded leading-tight"
                style={{
                  background: isSpot ? "#10b98115" : "#1e3a5f15",
                  color: isSpot ? "#059669" : NAVY,
                  border: `1px solid ${isSpot ? "#10b98130" : "#1e3a5f30"}`,
                }}
              >
                {item.formulaType === "spot_per_gram"
                  ? "spot × purity"
                  : item.formulaType === "spot_bar"
                  ? `spot × ${item.weightGrams}g × purity`
                  : "manual rate"}
              </span>
              {isSpot && (
                <span className="text-[11px] text-muted-foreground">
                  {karatLabel(item.purityFactor)} · {item.weightLabel}
                </span>
              )}
            </div>
          </div>

        </div>

        {/* Live price */}
        <div
          className="rounded-lg py-3 px-4 text-center flex-shrink-0"
          style={{
            background: isSpot && base != null ? "#10b98109" : "#f9fafb",
            border: `1px solid ${isSpot && base != null ? "#10b98130" : "#e5e7eb"}`,
          }}
        >
          {price != null ? (
            <>
              <div className="text-[11px] font-medium text-muted-foreground mb-0.5">
                AED / {item.formulaType === "spot_bar" ? `${item.weightGrams}g` : "gram"}
              </div>
              <div
                className="text-2xl font-bold tracking-tight"
                style={{ fontFamily: "monospace", color: isSpot && base != null ? "#059669" : "#374151" }}
              >
                {price.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              {isSpot && base != null && (
                <div className="text-[10px] text-emerald-600 mt-0.5 font-semibold uppercase tracking-wide">
                  ((●)) Live — updates every XAU/USD tick
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-1">No live feed available</div>
          )}
        </div>

        {/* Formula breakdown */}
        {isSpot && base != null && (
          <div
            className="text-[11px] text-muted-foreground rounded px-2.5 py-1.5 font-mono leading-relaxed"
            style={{ background: "#f3f4f6" }}
          >
            {item.formulaType === "spot_bar"
              ? `${base.toFixed(2)} × ${item.weightGrams} × ${item.purityFactor} + ${localOffset.toFixed(2)}`
              : `${base.toFixed(2)} × ${item.purityFactor} + ${localOffset.toFixed(2)}`}
            {" "}= {price?.toFixed(2) ?? "—"}
          </div>
        )}

        {/* Premium offset */}
        <div className="mt-auto">
          <Label className="text-xs text-muted-foreground mb-1.5 block font-medium">
            Premium / Making Charge (AED)
          </Label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">±</span>
              <Input
                type="number"
                step="0.01"
                value={localOffset}
                onChange={e => setLocalOffset(parseFloat(e.target.value) || 0)}
                className="pl-7 font-mono text-sm h-9"
              />
            </div>
            <Button
              size="sm"
              className="h-9 px-4 text-sm"
              disabled={!changed || saving}
              style={{ background: changed ? NAVY : undefined, minWidth: 64 }}
              onClick={handleSaveOffset}
            >
              {saving ? "…" : "Save"}
            </Button>
          </div>
          {changed && (
            <p className="text-[11px] text-amber-600 mt-1.5">
              ● Unsaved — was AED {item.premiumOffsetAed.toFixed(2)}
            </p>
          )}
        </div>

        {/* Delete (non-core only) */}
        {!item.isCore && (
          <button
            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors mt-1"
            onClick={() => onDelete(item.id, item.name)}
          >
            <Trash2 className="w-3.5 h-3.5" />Remove item
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Add Item Dialog ───────────────────────────────────────────────────────────
function AddItemDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: PriceItemInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [formulaType, setFormulaType] = useState<PriceItemInputFormulaType>(PriceItemInputFormulaType.spot_per_gram);
  const [purityPreset, setPurityPreset] = useState("0.91667");
  const [customPurity, setCustomPurity] = useState("");
  const [weightLabel, setWeightLabel] = useState("1GM");
  const [weightGrams, setWeightGrams] = useState("");
  const [offset, setOffset] = useState(0);
  const [manualRate, setManualRate] = useState(0);
  const [tvVisible, setTvVisible] = useState(true);
  const [saving, setSaving] = useState(false);

  const purity = purityPreset === "custom" ? (parseFloat(customPurity) || 0) : parseFloat(purityPreset);
  const isBar = formulaType === PriceItemInputFormulaType.spot_bar;
  const isManual = formulaType === PriceItemInputFormulaType.manual;

  const valid =
    name.trim().length > 0 &&
    weightLabel.trim().length > 0 &&
    (isManual ? manualRate > 0 : purity > 0 && purity <= 1);

  const handleCreate = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        formulaType,
        purityFactor: !isManual ? purity : 1,
        weightLabel: weightLabel.trim(),
        weightGrams: isBar ? (parseFloat(weightGrams) || null) : null,
        premiumOffsetAed: offset,
        manualRateAed: isManual ? manualRate : null,
        tvVisible,
        displayOrder: 99,
      });
      setName(""); setFormulaType(PriceItemInputFormulaType.spot_per_gram);
      setPurityPreset("0.91667"); setCustomPurity(""); setWeightLabel("1GM");
      setWeightGrams(""); setOffset(0); setManualRate(0); setTvVisible(true);
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Price Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">

          <div>
            <Label className="text-xs font-medium">Item Name</Label>
            <Input
              className="mt-1"
              placeholder="e.g. JEWELLERY 21K"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <Label className="text-xs font-medium">Formula Type</Label>
            <Select
              value={formulaType}
              onValueChange={v => setFormulaType(v as PriceItemInputFormulaType)}
            >
              <SelectTrigger className="mt-1 text-sm h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PriceItemInputFormulaType.spot_per_gram}>
                  Spot × purity + offset (per gram)
                </SelectItem>
                <SelectItem value={PriceItemInputFormulaType.spot_bar}>
                  Spot × weight × purity + offset (per bar)
                </SelectItem>
                <SelectItem value={PriceItemInputFormulaType.manual}>
                  Fixed manual rate
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!isManual && (
            <div>
              <Label className="text-xs font-medium">Purity (Karat)</Label>
              <Select value={purityPreset} onValueChange={setPurityPreset}>
                <SelectTrigger className="mt-1 text-sm h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PURITY_PRESETS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {purityPreset === "custom" && (
                <Input
                  className="mt-1.5 text-sm h-9 font-mono"
                  type="number" step="0.0001" min="0.01" max="1"
                  placeholder="e.g. 0.9166"
                  value={customPurity}
                  onChange={e => setCustomPurity(e.target.value)}
                />
              )}
            </div>
          )}

          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs font-medium">Weight Label</Label>
              <Input
                className="mt-1 text-sm h-9 font-mono"
                placeholder={isBar ? "TTB" : "1GM"}
                value={weightLabel}
                onChange={e => setWeightLabel(e.target.value)}
              />
            </div>
            {isBar && (
              <div className="flex-1">
                <Label className="text-xs font-medium">Weight (grams)</Label>
                <Input
                  className="mt-1 text-sm h-9 font-mono"
                  type="number" step="0.001"
                  placeholder="116.64"
                  value={weightGrams}
                  onChange={e => setWeightGrams(e.target.value)}
                />
              </div>
            )}
          </div>

          {isManual && (
            <div>
              <Label className="text-xs font-medium">Fixed Rate (AED / unit)</Label>
              <Input
                className="mt-1 text-sm h-9 font-mono"
                type="number" step="0.01"
                value={manualRate}
                onChange={e => setManualRate(parseFloat(e.target.value) || 0)}
              />
            </div>
          )}

          <div>
            <Label className="text-xs font-medium">Premium / Offset (AED)</Label>
            <Input
              className="mt-1 text-sm h-9 font-mono"
              type="number" step="0.01"
              value={offset}
              onChange={e => setOffset(parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <Label className="text-xs font-medium">Show on TV Board</Label>
            <Switch checked={tvVisible} onCheckedChange={setTvVisible} />
          </div>
        </div>
        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            disabled={!valid || saving}
            onClick={handleCreate}
            style={{ background: valid ? NAVY : undefined }}
          >
            {saving ? "Adding…" : "Add Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PriceItemsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: items, isLoading } = useListPriceItems({
    query: { queryKey: getListPriceItemsQueryKey(), refetchInterval: 10_000 },
  });

  const updateItem = useUpdatePriceItem();
  const createItem = useCreatePriceItem();
  const deleteItem = useDeletePriceItem();

  const base: number | null = null;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListPriceItemsQueryKey() });

  const handleUpdate = async (id: number, data: PriceItemInput): Promise<void> =>
    new Promise(resolve => {
      updateItem.mutate({ id, data }, {
        onSuccess: () => { invalidate(); toast({ title: "Saved" }); resolve(); },
        onError: (err: any) => {
          toast({ title: "Save failed", description: err.message, variant: "destructive" });
          resolve();
        },
      });
    });

  const handleCreate = async (data: PriceItemInput): Promise<void> =>
    new Promise((resolve, reject) => {
      createItem.mutate({ data }, {
        onSuccess: item => {
          invalidate();
          setAddOpen(false);
          toast({ title: `"${item.name}" added to pricing engine` });
          resolve();
        },
        onError: (err: any) => {
          toast({ title: "Create failed", description: err.message, variant: "destructive" });
          reject(err);
        },
      });
    });

  const handleDelete = (id: number, name: string) => {
    if (!window.confirm(`Remove "${name}" from the pricing engine?`)) return;
    deleteItem.mutate({ id }, {
      onSuccess: () => { invalidate(); toast({ title: `"${name}" removed` }); },
      onError: (err: any) =>
        toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
    });
  };

  if (isLoading || !items) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-72" />)}
        </div>
      </div>
    );
  }

  const sorted = [...items].sort((a, b) => a.displayOrder - b.displayOrder);
  const tvCount = sorted.filter(i => i.tvVisible).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Zap className="w-8 h-8" style={{ color: "#c8a43a" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: NAVY }}>
              Live Pricing Engine
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {sorted.length} price items configured
            </p>
          </div>
        </div>
        <Button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 h-10"
          style={{ background: NAVY }}
        >
          <Plus className="w-4 h-4" />Add Item
        </Button>
      </div>

      {/* Info banner */}
      <div
        className="rounded-xl p-4 text-sm"
        style={{ background: "#10b98109", border: "1px solid #10b98128" }}
      >
        <p className="font-semibold text-emerald-700 mb-1 flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5" />How the pricing engine works
        </p>
        <p className="text-emerald-800 leading-relaxed">
          <strong>Price = Base AED/g × purity factor + per-item offset.</strong>{" "}
          The base comes from the live XAU/USD WebSocket feed ÷ 31.1034 (troy oz→g) × USD/AED rate,
          plus your global spread from the Prices page. Each item then applies its own purity multiplier
          (e.g. 22K = ×0.9167) and a fixed <strong>Premium / Making Charge</strong> you set below.
          Toggle the TV switch to instantly show or hide any row on the showroom display screen.
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map(item => (
          <ItemCard
            key={item.id}
            item={item}
            base={base}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        ))}

        {/* Add placeholder card */}
        <button
          onClick={() => setAddOpen(true)}
          className="rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30 transition-all flex flex-col items-center justify-center gap-3 p-8 text-muted-foreground hover:text-primary min-h-[220px]"
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: `${NAVY}12`, border: `2px dashed ${NAVY}40` }}
          >
            <Plus className="w-6 h-6" style={{ color: NAVY }} />
          </div>
          <div className="text-center">
            <p className="font-semibold text-sm" style={{ color: NAVY }}>New Price Item</p>
            <p className="text-xs mt-0.5 text-muted-foreground">Add a custom karat or formula</p>
          </div>
        </button>
      </div>

      <AddItemDialog open={addOpen} onClose={() => setAddOpen(false)} onCreate={handleCreate} />
    </div>
  );
}
