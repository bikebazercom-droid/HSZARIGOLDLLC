import React, { useState, useEffect, useRef } from "react";
import {
  useGetPrices,
  getGetPricesQueryKey,
  useUpdatePrices,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, RefreshCw, Plus, Trash2, Check, CalendarDays } from "lucide-react";

const NAVY = "#1e3a5f";
const GOLD = "#c8a43a";

type RateKey = "goldJewelryRate" | "goldBullionRate" | "ttBarRate" | "kgBarRate" | "silverPricePerGram";
interface CustomItem { name: string; rate: number }

const TODAY = new Date().toLocaleDateString("en-AE", { day: "2-digit", month: "short", year: "numeric" });

/* ── Built-in rate card ─────────────────────────────────────── */
interface RateCardProps {
  label: string; sublabel: string; icon: string; color: string;
  fieldKey: RateKey; savedValue: number; value: number;
  onChange: (field: RateKey, value: number) => void;
  onSave: (field: RateKey, value: number) => Promise<void>;
}

function RateCard({ label, sublabel, icon, color, fieldKey, savedValue, value, onChange, onSave }: RateCardProps) {
  const [saving, setSaving] = useState(false);
  const changed = value !== savedValue;
  const handleSave = async () => { setSaving(true); await onSave(fieldKey, value); setSaving(false); };
  return (
    <Card className="relative overflow-hidden">
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: color }} />
      <CardHeader className="pb-2 pt-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
            style={{ background: `${color}18`, border: `2px solid ${color}40` }}>{icon}</div>
          <div>
            <CardTitle className="text-base font-bold leading-tight">{label}</CardTitle>
            <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }}>
          <CalendarDays className="w-3.5 h-3.5" />
          Daily Rate — {TODAY}
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Rate per gram (AED)</div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
            <Input type="number" step="0.01" min="0" value={value}
              onChange={e => onChange(fieldKey, parseFloat(e.target.value) || 0)}
              className="pl-14 text-xl font-bold h-12" style={{ fontFamily: "monospace" }} />
          </div>
          {changed && <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-600"><span>●</span><span>Unsaved — was AED {savedValue.toFixed(2)}</span></div>}
        </div>
        <Button className="w-full" style={{ background: changed ? NAVY : undefined }}
          onClick={handleSave} disabled={saving || !changed} size="sm">
          {saving ? "Saving..." : changed ? `Update ${label} Rate` : "Rate Saved ✓"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Custom item card ───────────────────────────────────────── */
interface CustomCardProps {
  item: CustomItem;
  saved: boolean;
  onRateChange: (name: string, rate: number) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}

function CustomCard({ item, saved, onRateChange, onSave, onDelete }: CustomCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: NAVY }} />
      <CardHeader className="pb-2 pt-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
            style={{ background: `${NAVY}18`, border: `2px solid ${NAVY}40` }}>🏷️</div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base font-bold leading-tight truncate">{item.name}</CardTitle>
            <div className="text-xs text-muted-foreground mt-0.5">Custom Item</div>
          </div>
          <button onClick={() => onDelete(item.name)} title="Delete"
            className="text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0 p-1">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: NAVY }}>
          <CalendarDays className="w-3.5 h-3.5" />
          Daily Rate — {TODAY}
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Rate per gram (AED)</div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
            <Input type="number" step="0.01" min="0" value={item.rate}
              onChange={e => onRateChange(item.name, parseFloat(e.target.value) || 0)}
              className="pl-14 text-xl font-bold h-12" style={{ fontFamily: "monospace" }} />
          </div>
        </div>
        <Button className="w-full flex items-center gap-2" size="sm"
          style={{ background: saved ? undefined : NAVY }}
          onClick={() => onSave(item.name)} disabled={saved}>
          <Check className="w-4 h-4" />
          {saved ? "Rate Saved ✓" : "Save Daily Rate"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── "Add New Item" card (placeholder in grid) ──────────────── */
function AddItemCard({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/30 transition-all flex flex-col items-center justify-center gap-3 p-8 text-muted-foreground hover:text-primary min-h-[200px]">
      <div className="w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: `${NAVY}12`, border: `2px dashed ${NAVY}40` }}>
        <Plus className="w-6 h-6" style={{ color: NAVY }} />
      </div>
      <div className="text-center">
        <p className="font-semibold text-sm" style={{ color: NAVY }}>New Custom Item</p>
        <p className="text-xs mt-0.5">Create your own rate card</p>
      </div>
    </button>
  );
}

/* ── Main page ──────────────────────────────────────────────── */
export default function Prices() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: prices, isLoading } = useGetPrices({ query: { queryKey: getGetPricesQueryKey() } });
  const updatePrices = useUpdatePrices();

  const RATE_KEYS: RateKey[] = ["goldJewelryRate", "goldBullionRate", "ttBarRate", "kgBarRate", "silverPricePerGram"];

  const [localRates, setLocalRates] = useState<Record<RateKey, number>>({
    goldJewelryRate: 0, goldBullionRate: 0, ttBarRate: 0, kgBarRate: 0, silverPricePerGram: 0,
  });
  const [syncingAll, setSyncingAll] = useState(false);
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState<number>(0);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prices) {
      setLocalRates({
        goldJewelryRate: prices.goldJewelryRate,
        goldBullionRate: prices.goldBullionRate,
        ttBarRate: prices.ttBarRate,
        kgBarRate: prices.kgBarRate,
        silverPricePerGram: prices.silverPricePerGram,
      });
      const items = (prices.customDescriptions ?? []) as CustomItem[];
      setCustomItems(items);
      setSavedNames(new Set(items.map(i => i.name)));
    }
  }, [prices]);

  /* ── Built-in rate handlers ── */
  const handleChange = (field: RateKey, value: number) => setLocalRates(prev => ({ ...prev, [field]: value }));

  const handleSaveOne = async (field: RateKey, value: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      updatePrices.mutate({ data: { [field]: value } as any }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() }); toast({ title: "Rate updated" }); resolve(); },
        onError: (err: any) => { toast({ title: "Failed", description: err.message, variant: "destructive" }); reject(err); },
      });
    });

  const hasAnyChange = prices && RATE_KEYS.some(k => localRates[k] !== (prices as any)[k]);

  const handleSyncAll = async () => {
    if (!prices) return;
    const changed = RATE_KEYS.filter(k => localRates[k] !== (prices as any)[k]);
    if (!changed.length) return;
    setSyncingAll(true);
    try {
      const patch: Record<string, number> = {};
      changed.forEach(k => { patch[k] = localRates[k]; });
      await new Promise<void>((resolve, reject) => {
        updatePrices.mutate({ data: patch as any }, {
          onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() }); toast({ title: `✓ ${changed.length} rate${changed.length > 1 ? "s" : ""} synced` }); resolve(); },
          onError: (err: any) => { toast({ title: "Sync failed", description: err.message, variant: "destructive" }); reject(err); },
        });
      });
    } finally { setSyncingAll(false); }
  };

  /* ── Custom item handlers ── */
  const persistCustomItems = (items: CustomItem[]) => {
    updatePrices.mutate({ data: { customDescriptions: items } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
        setSavedNames(new Set(items.map(i => i.name)));
      },
      onError: (err: any) => { toast({ title: "Save failed", description: err.message, variant: "destructive" }); },
    });
  };

  const handleAddNewItem = () => {
    const name = newName.trim();
    if (!name || customItems.some(i => i.name === name)) return;
    const next = [...customItems, { name, rate: newRate }];
    setCustomItems(next);
    setShowNewForm(false);
    setNewName(""); setNewRate(0);
    persistCustomItems(next);
    toast({
      title: `"${name}" added to Live Prices`,
      description: "Now appears in Invoice Stock Description dropdown automatically.",
    });
  };

  const handleCustomRateChange = (name: string, rate: number) => {
    setCustomItems(prev => prev.map(i => i.name === name ? { ...i, rate } : i));
    setSavedNames(prev => { const s = new Set(prev); s.delete(name); return s; });
  };

  const handleSaveCustomItem = (name: string) => {
    persistCustomItems(customItems);
    toast({ title: `"${name}" rate saved` });
  };

  const handleDeleteCustomItem = (name: string) => {
    const next = customItems.filter(i => i.name !== name);
    setCustomItems(next);
    persistCustomItems(next);
    toast({ title: `"${name}" removed` });
  };

  if (isLoading || !prices) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-52" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-52" />)}
        </div>
      </div>
    );
  }

  const metals = [
    { label: "Gold Jewelry", sublabel: "22K / 916", icon: "💍", color: GOLD, fieldKey: "goldJewelryRate" as const },
    { label: "GOLD", sublabel: "24K / 999.9", icon: "🥇", color: "#d4aa00", fieldKey: "goldBullionRate" as const },
    { label: "TT BAR", sublabel: "24K / 999.9", icon: "📊", color: "#e67e22", fieldKey: "ttBarRate" as const },
    { label: "KG BAR", sublabel: "24K / 999.9", icon: "🏅", color: "#f39c12", fieldKey: "kgBarRate" as const },
    { label: "Silver", sublabel: "Pure Silver", icon: "🪙", color: "#95a5a6", fieldKey: "silverPricePerGram" as const },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-primary">Live Prices</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Daily Rates — update each metal independently</p>
          </div>
        </div>
        <Button onClick={handleSyncAll} disabled={syncingAll || !hasAnyChange}
          className="flex items-center gap-2 px-5 h-11 text-sm font-semibold shadow-md"
          style={{ background: hasAnyChange ? NAVY : undefined, minWidth: 200 }}>
          <RefreshCw className={`w-4 h-4 ${syncingAll ? "animate-spin" : ""}`} />
          {syncingAll ? "Syncing..." : hasAnyChange ? "Save All & Apply to Invoices" : "All Rates Synced ✓"}
        </Button>
      </div>

      {/* All cards in one grid: built-in + custom + add button */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {metals.map(metal => (
          <RateCard key={metal.fieldKey} {...metal}
            savedValue={(prices as any)[metal.fieldKey]}
            value={localRates[metal.fieldKey]}
            onChange={handleChange} onSave={handleSaveOne} />
        ))}

        {customItems.map(item => (
          <CustomCard key={item.name} item={item}
            saved={savedNames.has(item.name)}
            onRateChange={handleCustomRateChange}
            onSave={handleSaveCustomItem}
            onDelete={handleDeleteCustomItem} />
        ))}

        {/* New item form or add button */}
        {showNewForm ? (
          <Card className="relative overflow-hidden">
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: NAVY }} />
            <CardHeader className="pb-2 pt-5">
              <CardTitle className="text-base font-bold">New Custom Item</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: NAVY }}>
                <CalendarDays className="w-3.5 h-3.5" />
                Daily Rate — {TODAY}
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Item Name</div>
                <Input ref={nameInputRef} autoFocus placeholder="e.g. Rose Gold Ring"
                  value={newName} onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddNewItem()} />
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Daily Rate per gram (AED)</div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
                  <Input type="number" step="0.01" min="0" value={newRate || ""}
                    onChange={e => setNewRate(parseFloat(e.target.value) || 0)}
                    className="pl-14 text-xl font-bold h-12" style={{ fontFamily: "monospace" }} />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button className="flex-1" style={{ background: NAVY }}
                  onClick={handleAddNewItem} disabled={!newName.trim()}>
                  <Plus className="w-4 h-4 mr-1" /> Add Item
                </Button>
                <Button variant="outline" onClick={() => { setShowNewForm(false); setNewName(""); setNewRate(0); }}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <AddItemCard onClick={() => { setShowNewForm(true); setTimeout(() => nameInputRef.current?.focus(), 50); }} />
        )}
      </div>
    </div>
  );
}
