import React, { useState, useEffect, useRef } from "react";
import { useLivePrice } from "@/context/live-price";
import {
  useGetPrices,
  getGetPricesQueryKey,
  useUpdatePrices,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, RefreshCw, Plus, Trash2, Check, CalendarDays, Zap, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import tenTolaBarImg from "@/assets/rates/ten-tola-bar.png";
import singleGoldBarImg from "@/assets/rates/single-gold-bar.png";
import goldKiloBrickImg from "@/assets/rates/gold-kilo-brick.png";
import goldBarStackImg from "@/assets/rates/gold-bar-stack.png";
import jewelryRingImg from "@/assets/rates/jewelry-ring.png";

const NAVY = "#1e3a5f";

type RateKey = "goldJewelryRate" | "goldBullionRate" | "ttBarRate" | "ttBar24kRate" | "kgBarRate" | "silverPricePerGram" | "gold22kRate" | "gold21kRate" | "gold18kRate" | "gold9999Rate" | "goldKg9999Rate";
interface CustomItem { name: string; rate: number }

const TODAY = new Date().toLocaleDateString("en-AE", { day: "2-digit", month: "short", year: "numeric" });

/* ── Luxury asset rate card ───────────────────────────────────── */
type TvVisibilityKey = "tvShowTtBar995" | "tvShowTtBar999" | "tvShowGold9999" | "tvShowKgBar995" | "tvShowGold22k" | "tvShowGold21k" | "tvShowGold18k" | "tvShowGoldKg9999";

interface AssetCardProps {
  label: string; sublabel: string; image: string;
  fieldKey: RateKey; savedValue: number; value: number;
  onChange: (field: RateKey, value: number) => void;
  onSave: (field: RateKey, value: number) => Promise<void>;
  liveLocked?: boolean;
  liveValue?: number | null;
  tvVisibilityKey?: TvVisibilityKey;
  tvVisible?: boolean;
  onToggleTvVisible?: (key: TvVisibilityKey, value: boolean) => void;
}

function AssetCard({ label, sublabel, image, fieldKey, savedValue, value, onChange, onSave, liveLocked, liveValue, tvVisibilityKey, tvVisible, onToggleTvVisible }: AssetCardProps) {
  const [saving, setSaving] = useState(false);
  const changed = value !== savedValue;
  const handleSave = async () => { setSaving(true); await onSave(fieldKey, value); setSaving(false); };
  const displayValue = liveLocked && liveValue != null ? liveValue : value;
  return (
    <Card
      className="relative overflow-hidden transition-shadow"
      style={liveLocked ? { borderColor: "#10b98166", boxShadow: "0 0 0 1px #10b98133, 0 8px 24px -8px #10b98155" } : undefined}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: liveLocked ? "#10b981" : NAVY }} />
      <CardHeader className="pb-2 pt-5">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 border" style={{ borderColor: liveLocked ? "#10b98155" : "#e5e7eb" }}>
            <img src={image} alt={label} className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base font-bold leading-tight truncate">{label}</CardTitle>
            <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: liveLocked ? "#059669" : NAVY }}>
          <CalendarDays className="w-3.5 h-3.5" />
          {liveLocked ? "Live Market Rate — auto-synced" : `Daily Rate — ${TODAY}`}
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">
            Rate per gram (AED)
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
            {liveLocked ? (
              <div className="pl-14 text-xl font-bold h-12 flex items-center rounded-md border bg-emerald-50/50" style={{ fontFamily: "monospace", borderColor: "#10b98155" }}>
                {displayValue > 0 ? displayValue.toFixed(2) : "—"}
              </div>
            ) : (
              <Input type="number" step="0.01" min="0" value={value}
                onChange={e => onChange(fieldKey, parseFloat(e.target.value) || 0)}
                className="pl-14 text-xl font-bold h-12" style={{ fontFamily: "monospace" }} />
            )}
          </div>
          {!liveLocked && changed && <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-600"><span>●</span><span>Unsaved — was AED {savedValue.toFixed(2)}</span></div>}
        </div>
        {liveLocked ? (
          <div
            className="text-[10px] text-center font-bold uppercase tracking-wide py-1.5 rounded-md"
            style={{ color: "#059669", background: "#10b98118", border: "1px solid #10b98140" }}
          >
            ((●)) Real-time 1s Sync <span className="mx-1">·</span> Dubai Retail Market Rate
          </div>
        ) : (
          <Button className="w-full" style={{ background: changed ? NAVY : undefined }}
            onClick={handleSave} disabled={saving || !changed} size="sm">
            {saving ? "Saving..." : changed ? `Update ${label} Rate` : "Rate Saved ✓"}
          </Button>
        )}
        {tvVisibilityKey && onToggleTvVisible && (
          <div
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 mt-1"
            style={{
              background: tvVisible ? "#f0fdf4" : "#fafafa",
              border: `1px solid ${tvVisible ? "#10b98144" : "#e5e7eb"}`,
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm" aria-hidden>📺</span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground leading-tight">Show on TV Screen</div>
                <div className="text-[10px] text-muted-foreground leading-tight truncate">
                  {tvVisible ? "Visible on showroom board" : "Hidden from showroom board"}
                </div>
              </div>
            </div>
            <Switch
              checked={tvVisible ?? true}
              onCheckedChange={v => onToggleTvVisible(tvVisibilityKey, v)}
              className="flex-shrink-0"
            />
          </div>
        )}
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


/* ── "Add New Item" card (always visible in grid) ───────────── */
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
  const { liveRates } = useLivePrice();

  // Live values for each card — derived from Final_24K (Base_24K_AED + admin
  // spread), the international-spot-based baseline computed by the live-price
  // context. Silver has no live feed so it stays as manual-editable (liveValue: undefined).
  const base24k = liveRates.aedPerGram;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const liveValueByKey: Partial<Record<RateKey, number | null>> = {
    ttBarRate:           base24k != null ? round2(base24k * 0.995) : null,
    ttBar24kRate:        base24k != null ? round2(base24k * 0.9999) : null,
    gold9999Rate:        liveRates.gold9999Rate,
    goldKg9999Rate:      liveRates.goldKg9999Rate,
    kgBarRate:           base24k != null ? round2(base24k * 0.995) : null,
    gold22kRate:         liveRates.gold22kRate,
    gold21kRate:         liveRates.gold21kRate,
    gold18kRate:         liveRates.gold18kRate,
  };

  const RATE_KEYS: RateKey[] = ["goldJewelryRate", "goldBullionRate", "ttBarRate", "ttBar24kRate", "kgBarRate", "silverPricePerGram", "gold22kRate", "gold21kRate", "gold18kRate", "gold9999Rate", "goldKg9999Rate"];

  const [localRates, setLocalRates] = useState<Record<RateKey, number>>({
    goldJewelryRate: 0, goldBullionRate: 0, ttBarRate: 0, ttBar24kRate: 0, kgBarRate: 0, silverPricePerGram: 0,
    gold22kRate: 0, gold21kRate: 0, gold18kRate: 0, gold9999Rate: 0, goldKg9999Rate: 0,
  });
  const [localManualMode, setLocalManualMode] = useState(false);
  const [togglingMode, setTogglingMode] = useState(false);

  // Global Pricing Configuration — spread/premium (fixed AED) added on top of
  // the raw international spot conversion, and labor cost % applied only to
  // jewelry rows. Both are admin-configurable and drive every derived rate.
  const [localSpreadPremiumAed, setLocalSpreadPremiumAed] = useState(0);
  const [localLaborCostPercent, setLocalLaborCostPercent] = useState(0);
  const [savingPricingConfig, setSavingPricingConfig] = useState(false);

  const [tvVisibility, setTvVisibility] = useState<Record<TvVisibilityKey, boolean>>({
    tvShowTtBar995: true, tvShowTtBar999: true, tvShowGold9999: true, tvShowKgBar995: true,
    tvShowGold22k: true, tvShowGold21k: true, tvShowGold18k: true, tvShowGoldKg9999: true,
  });

  // Sync manual-mode flag and TV visibility from DB whenever prices load/refresh
  useEffect(() => {
    if (prices) {
      setLocalManualMode(prices.manualInvoiceMode ?? false);
      setLocalSpreadPremiumAed(prices.spreadPremiumAed ?? 0);
      setLocalLaborCostPercent(prices.laborCostPercent ?? 0);
      setTvVisibility({
        tvShowTtBar995: prices.tvShowTtBar995 ?? true,
        tvShowTtBar999: prices.tvShowTtBar999 ?? true,
        tvShowGold9999: prices.tvShowGold9999 ?? true,
        tvShowKgBar995: prices.tvShowKgBar995 ?? true,
        tvShowGold22k:    prices.tvShowGold22k    ?? true,
        tvShowGold21k:    prices.tvShowGold21k    ?? true,
        tvShowGold18k:    prices.tvShowGold18k    ?? true,
        tvShowGoldKg9999: prices.tvShowGoldKg9999 ?? true,
      });
    }
  }, [prices]);

  const handleToggleManualMode = () => {
    const next = !localManualMode;
    setLocalManualMode(next);          // optimistic flip
    setTogglingMode(true);
    updatePrices.mutate({ data: { manualInvoiceMode: next } as any }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
        toast({
          title: next ? "Switched to Manual Mode" : "Switched to Live Mode",
          description: next
            ? "Invoice baseline will use the rates you set on the cards below."
            : "Invoice baseline is back on the real-time 1s XAUUSD spot feed.",
        });
      },
      onError: (err: any) => {
        setLocalManualMode(!next);     // revert on error
        toast({ title: "Toggle failed", description: err.message, variant: "destructive" });
      },
      onSettled: () => setTogglingMode(false),
    });
  };

  const pricingConfigChanged = prices
    ? localSpreadPremiumAed !== (prices.spreadPremiumAed ?? 0) || localLaborCostPercent !== (prices.laborCostPercent ?? 0)
    : false;

  const handleSavePricingConfig = async () => {
    setSavingPricingConfig(true);
    try {
      await new Promise<void>((resolve, reject) => {
        updatePrices.mutate(
          { data: { spreadPremiumAed: localSpreadPremiumAed, laborCostPercent: localLaborCostPercent } as any },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
              toast({ title: "Global Pricing Configuration saved", description: "Every derived rate now reflects the new spread/labor cost." });
              resolve();
            },
            onError: (err: any) => {
              toast({ title: "Save failed", description: err.message, variant: "destructive" });
              reject(err);
            },
          },
        );
      });
    } finally {
      setSavingPricingConfig(false);
    }
  };

  const handleToggleTvVisible = (key: TvVisibilityKey, value: boolean) => {
    setTvVisibility(prev => ({ ...prev, [key]: value }));
    updatePrices.mutate({ data: { [key]: value } as any }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() }),
      onError: (err: any) => {
        setTvVisibility(prev => ({ ...prev, [key]: !value }));
        toast({ title: "Toggle failed", description: err.message, variant: "destructive" });
      },
    });
  };

  const [forcingRefresh, setForcingRefresh] = useState(false);
  const handleForceRefresh = async () => {
    setForcingRefresh(true);
    try {
      const res = await fetch("/api/prices/spot/refresh", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast({ title: `Rate refreshed — AED ${data.aedPerGram?.toFixed(2)} / g`, description: "TV board will update within 1 second." });
        queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
      } else {
        toast({ title: "Refresh failed", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e.message, variant: "destructive" });
    } finally {
      setForcingRefresh(false);
    }
  };

  const [syncingAll, setSyncingAll] = useState(false);
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [savedNames, setSavedNames] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState<number>(0);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prices) {
      setLocalRates({
        goldJewelryRate: prices.goldJewelryRate,
        goldBullionRate: prices.goldBullionRate,
        ttBarRate: prices.ttBarRate,
        ttBar24kRate: prices.ttBar24kRate,
        kgBarRate: prices.kgBarRate,
        silverPricePerGram: prices.silverPricePerGram,
        gold22kRate: prices.gold22kRate,
        gold21kRate: prices.gold21kRate,
        gold18kRate: prices.gold18kRate,
        gold9999Rate:    prices.gold9999Rate,
        goldKg9999Rate:  prices.goldKg9999Rate,
      });
      const items = (prices.customDescriptions ?? []) as CustomItem[];
      setCustomItems(items);
      setSavedNames(new Set(items.map(i => i.name)));
    }
  }, [prices]);

  /* ── Built-in rate handlers ── */
  const handleChange = (field: RateKey, value: number) => setLocalRates(prev => ({ ...prev, [field]: value }));

  // Guards against accidentally saving a mock/placeholder rate (e.g. a leftover
  // "10" from testing) that would silently undervalue every invoice using it.
  const MIN_REALISTIC_GOLD_RATE = 50;
  const isGoldField = (field: RateKey) => field !== "silverPricePerGram";

  const handleSaveOne = async (field: RateKey, value: number): Promise<void> => {
    if (isGoldField(field) && value > 0 && value < MIN_REALISTIC_GOLD_RATE) {
      toast({
        title: "Rate looks too low",
        description: `AED ${value}/g is far below realistic gold market rates. Please double-check before saving.`,
        variant: "destructive",
      });
      return Promise.reject(new Error("Rate below realistic threshold"));
    }
    return new Promise<void>((resolve, reject) => {
      updatePrices.mutate({ data: { [field]: value } as any }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() }); toast({ title: "Rate updated" }); resolve(); },
        onError: (err: any) => { toast({ title: "Failed", description: err.message, variant: "destructive" }); reject(err); },
      });
    });
  };

  const hasAnyChange = prices && RATE_KEYS.some(k => localRates[k] !== (prices as any)[k]);

  const handleSyncAll = async () => {
    if (!prices) return;
    const changed = RATE_KEYS.filter(k => localRates[k] !== (prices as any)[k]);
    if (!changed.length) return;
    const tooLow = changed.filter(k => isGoldField(k) && localRates[k] > 0 && localRates[k] < MIN_REALISTIC_GOLD_RATE);
    if (tooLow.length) {
      toast({
        title: "Rate looks too low",
        description: `One or more gold rates are below AED ${MIN_REALISTIC_GOLD_RATE}/g, which is far below realistic market value. Please double-check before saving.`,
        variant: "destructive",
      });
      return;
    }
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

  const openDialog = () => {
    setNewName("");
    setNewRate(0);
    setDialogOpen(true);
    setTimeout(() => nameInputRef.current?.focus(), 80);
  };

  const handleAddNewItem = () => {
    const name = newName.trim();
    if (!name || customItems.some(i => i.name === name)) return;
    const next = [...customItems, { name, rate: newRate }];
    setCustomItems(next);
    setDialogOpen(false);
    setNewName(""); setNewRate(0);
    persistCustomItems(next);
    toast({ title: `"${name}" added to Live Prices` });
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

  const assetCards: Array<{
    label: string; sublabel: string; image: string;
    fieldKey: RateKey; tvVisibilityKey?: TvVisibilityKey;
  }> = [
    { label: "TT. BAR (0.995)", sublabel: "Purity 0.995 — Rate per 1 Gram", image: tenTolaBarImg, fieldKey: "ttBarRate", tvVisibilityKey: "tvShowTtBar995" },
    { label: "TT. BAR (0.9999)", sublabel: "Purity 0.9999 — Rate per 1 Gram", image: tenTolaBarImg, fieldKey: "ttBar24kRate", tvVisibilityKey: "tvShowTtBar999" },
    { label: "GOLD (0.9999)", sublabel: "Purity 0.9999 — Rate per 1 Gram", image: singleGoldBarImg, fieldKey: "gold9999Rate", tvVisibilityKey: "tvShowGold9999" },
    { label: "GOLD KG (0.9999)", sublabel: "Purity 0.9999 — Rate per 1 Gram (TV shows 1KG total)", image: singleGoldBarImg, fieldKey: "goldKg9999Rate", tvVisibilityKey: "tvShowGoldKg9999" },
    { label: "KG BAR (0.995)", sublabel: "Purity 0.995 — Rate per 1 Gram", image: goldKiloBrickImg, fieldKey: "kgBarRate", tvVisibilityKey: "tvShowKgBar995" },
    { label: "Silver (0.999)", sublabel: "Purity 0.999 — Rate per 1 Gram", image: goldBarStackImg, fieldKey: "silverPricePerGram" },
    { label: "Gold Jewelry 22K", sublabel: "Purity 0.916 — Rate per 1 Gram", image: jewelryRingImg, fieldKey: "gold22kRate", tvVisibilityKey: "tvShowGold22k" },
    { label: "Gold Jewelry 21K", sublabel: "Purity 0.875 — Rate per 1 Gram", image: jewelryRingImg, fieldKey: "gold21kRate", tvVisibilityKey: "tvShowGold21k" },
    { label: "Gold Jewelry 18K", sublabel: "Purity 0.750 — Rate per 1 Gram", image: jewelryRingImg, fieldKey: "gold18kRate", tvVisibilityKey: "tvShowGold18k" },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-primary">Live Prices</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Daily Rates — update each metal independently</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={handleForceRefresh} disabled={forcingRefresh} variant="outline"
            className="flex items-center gap-2 px-4 h-11 text-sm font-semibold"
            title="Immediately fetch the latest rate from DGJG / goldratesindubai.com, bypassing the 60-second cache">
            <RefreshCw className={`w-4 h-4 ${forcingRefresh ? "animate-spin" : ""}`} style={{ color: "#059669" }} />
            {forcingRefresh ? "Fetching..." : "Sync Dubai Rate Now"}
          </Button>
          <Button onClick={handleSyncAll} disabled={syncingAll || !hasAnyChange}
            className="flex items-center gap-2 px-5 h-11 text-sm font-semibold shadow-md"
            style={{ background: hasAnyChange ? NAVY : undefined, minWidth: 200 }}>
            <RefreshCw className={`w-4 h-4 ${syncingAll ? "animate-spin" : ""}`} />
            {syncingAll ? "Syncing..." : hasAnyChange ? "Save All & Apply to Invoices" : "All Rates Synced ✓"}
          </Button>
        </div>
      </div>

      {/* ── Invoice Rate Mode Toggle ─────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-4 rounded-xl border-2 p-4 transition-all"
        style={{
          borderColor: localManualMode ? "#f59e0b66" : "#10b98166",
          background: localManualMode ? "#fffbeb" : "#f0fdf4",
          boxShadow: localManualMode
            ? "0 0 0 1px #f59e0b22 inset, 0 4px 16px -6px #f59e0b33"
            : "0 0 0 1px #10b98122 inset, 0 4px 16px -6px #10b98133",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: localManualMode ? "#f59e0b18" : "#10b98118",
              border: `2px solid ${localManualMode ? "#f59e0b55" : "#10b98155"}`,
            }}
          >
            {localManualMode
              ? <Lock className="w-5 h-5" style={{ color: "#d97706" }} />
              : <Zap className="w-5 h-5" style={{ color: "#059669" }} />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground">Invoice Rate Mode</div>
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {localManualMode
                ? "Manual — new invoices use the fixed rates you set on the cards below"
                : "Live — new invoices auto-populate from the real-time Dubai retail market rate"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span
            className="text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full"
            style={{
              color: localManualMode ? "#92400e" : "#065f46",
              background: localManualMode ? "#fef3c7" : "#d1fae5",
              border: `1px solid ${localManualMode ? "#fcd34d" : "#6ee7b7"}`,
            }}
          >
            {localManualMode ? "Manual" : "Live"}
          </span>
          <Switch
            checked={localManualMode}
            onCheckedChange={handleToggleManualMode}
            disabled={togglingMode}
          />
        </div>
      </div>

      {/* ── Global Pricing Configuration ─────────────────────────────── */}
      <Card className="relative overflow-hidden">
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: NAVY }} />
        <CardHeader className="pb-2 pt-5">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <TrendingUp className="w-4 h-4" style={{ color: NAVY }} />
            Global Pricing Configuration
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            International Spot Gold (XAU/USD) engine — every rate below is derived from
            <code className="mx-1 px-1 py-0.5 rounded bg-muted text-[11px]">Final_24K = Base_24K_AED + Spread</code>
            {liveRates.baseAedPerGram != null && (
              <>· Live Base_24K_AED: <span className="font-semibold" style={{ color: NAVY }}>AED {liveRates.baseAedPerGram.toFixed(2)}</span></>
            )}
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">
                Spread / Premium (AED)
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
                <Input type="number" step="0.01" value={localSpreadPremiumAed}
                  onChange={e => setLocalSpreadPremiumAed(parseFloat(e.target.value) || 0)}
                  className="pl-14 text-lg font-bold h-11" style={{ fontFamily: "monospace" }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Fixed buffer added to the raw international rate.</p>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">
                Labor Cost %
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">%</span>
                <Input type="number" step="0.01" value={localLaborCostPercent}
                  onChange={e => setLocalLaborCostPercent(parseFloat(e.target.value) || 0)}
                  className="pl-9 text-lg font-bold h-11" style={{ fontFamily: "monospace" }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Applied only to Gold Jewelry 22K / 21K / 18K rows.</p>
            </div>
          </div>
          <Button className="w-full mt-4" style={{ background: pricingConfigChanged ? NAVY : undefined }}
            onClick={handleSavePricingConfig} disabled={savingPricingConfig || !pricingConfigChanged} size="sm">
            {savingPricingConfig ? "Saving..." : pricingConfigChanged ? "Save Pricing Configuration" : "Configuration Saved ✓"}
          </Button>
        </CardContent>
      </Card>

      {/* All cards in one grid: built-in + custom + always-visible add button */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {assetCards.map(asset => (
          <AssetCard key={asset.label} {...asset}
            savedValue={(prices as any)[asset.fieldKey]}
            value={localRates[asset.fieldKey]}
            onChange={handleChange} onSave={handleSaveOne}
            liveLocked={prices.liveModeConnected && !localManualMode}
            liveValue={liveValueByKey[asset.fieldKey]}
            tvVisible={asset.tvVisibilityKey ? tvVisibility[asset.tvVisibilityKey] : undefined}
            onToggleTvVisible={handleToggleTvVisible} />
        ))}

        {customItems.map(item => (
          <CustomCard key={item.name} item={item}
            saved={savedNames.has(item.name)}
            onRateChange={handleCustomRateChange}
            onSave={handleSaveCustomItem}
            onDelete={handleDeleteCustomItem} />
        ))}

        {/* Always-visible add button */}
        <AddItemCard onClick={openDialog} />
      </div>

      {/* Add new item dialog */}
      <Dialog open={dialogOpen} onOpenChange={open => { setDialogOpen(open); if (!open) { setNewName(""); setNewRate(0); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" style={{ color: NAVY }} />
              New Custom Rate Card
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: NAVY }}>
              <CalendarDays className="w-3.5 h-3.5" />
              Daily Rate — {TODAY}
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Item Name</div>
              <Input ref={nameInputRef} placeholder="e.g. Rose Gold Ring"
                value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddNewItem()} />
              {customItems.some(i => i.name === newName.trim()) && newName.trim() && (
                <p className="text-xs text-red-500 mt-1">Name already exists</p>
              )}
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Daily Rate per gram (AED)</div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
                <Input type="number" step="0.01" min="0" value={newRate || ""}
                  onChange={e => setNewRate(parseFloat(e.target.value) || 0)}
                  onKeyDown={e => e.key === "Enter" && handleAddNewItem()}
                  className="pl-14 text-xl font-bold h-12" style={{ fontFamily: "monospace" }} />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" style={{ background: NAVY }}
                onClick={handleAddNewItem}
                disabled={!newName.trim() || customItems.some(i => i.name === newName.trim())}>
                <Plus className="w-4 h-4 mr-1" /> Add Item
              </Button>
              <Button variant="outline" onClick={() => { setDialogOpen(false); setNewName(""); setNewRate(0); }}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
