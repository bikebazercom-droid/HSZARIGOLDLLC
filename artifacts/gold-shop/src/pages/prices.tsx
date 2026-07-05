import React, { useState, useEffect, useRef } from "react";
import {
  useGetPrices,
  getGetPricesQueryKey,
  useUpdatePrices,
  useConnectLiveRate,
  useDisconnectLiveRate,
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
import { TrendingUp, RefreshCw, Plus, Trash2, Check, CalendarDays, Wifi, WifiOff, Loader2 } from "lucide-react";

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
  liveLocked?: boolean;
}

function RateCard({ label, sublabel, icon, color, fieldKey, savedValue, value, onChange, onSave, liveLocked }: RateCardProps) {
  const [saving, setSaving] = useState(false);
  const changed = value !== savedValue;
  const handleSave = async () => { setSaving(true); await onSave(fieldKey, value); setSaving(false); };
  return (
    <Card className="relative overflow-hidden">
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: liveLocked ? "#10b981" : color }} />
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
        <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: liveLocked ? "#059669" : color }}>
          <CalendarDays className="w-3.5 h-3.5" />
          {liveLocked ? "Live Market Rate — auto-synced" : `Daily Rate — ${TODAY}`}
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Rate per gram (AED)</div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
            <Input type="number" step="0.01" min="0" value={value} disabled={liveLocked}
              onChange={e => onChange(fieldKey, parseFloat(e.target.value) || 0)}
              className="pl-14 text-xl font-bold h-12" style={{ fontFamily: "monospace" }} />
          </div>
          {!liveLocked && changed && <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-600"><span>●</span><span>Unsaved — was AED {savedValue.toFixed(2)}</span></div>}
        </div>
        {liveLocked ? (
          <div className="text-xs text-center text-emerald-600 font-medium py-1.5">Disconnect API to edit manually</div>
        ) : (
          <Button className="w-full" style={{ background: changed ? NAVY : undefined }}
            onClick={handleSave} disabled={saving || !changed} size="sm">
            {saving ? "Saving..." : changed ? `Update ${label} Rate` : "Rate Saved ✓"}
          </Button>
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

/* ── Live Gold Rate API connection card ─────────────────────── */
interface LiveRateCardProps {
  connected: boolean;
  apiKeyConfigured: boolean;
  lastSyncedAt: string | null;
  liveGoldRate24k: number | null;
  liveGoldRate22k: number | null;
  liveSilverRate: number | null;
  onConnect: (apiKey?: string) => void;
  onDisconnect: () => void;
  connecting: boolean;
  disconnecting: boolean;
}

function LiveRateCard({
  connected, apiKeyConfigured, lastSyncedAt, liveGoldRate24k, liveGoldRate22k, liveSilverRate,
  onConnect, onDisconnect, connecting, disconnecting,
}: LiveRateCardProps) {
  const [apiKeyInput, setApiKeyInput] = useState("");
  const busy = connecting || disconnecting;

  return (
    <Card className="relative overflow-hidden border-2" style={{ borderColor: connected ? "#10b98155" : "#e5e7eb" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: connected ? "#10b981" : NAVY }} />
      <CardHeader className="pb-3 pt-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: connected ? "#10b98118" : `${NAVY}12`, border: `2px solid ${connected ? "#10b98155" : `${NAVY}40`}` }}>
              {connected ? <Wifi className="w-5 h-5 text-emerald-600" /> : <WifiOff className="w-5 h-5" style={{ color: NAVY }} />}
            </div>
            <div>
              <CardTitle className="text-base font-bold leading-tight">Live Gold Rate API Integration</CardTitle>
              <div className="text-xs text-muted-foreground mt-0.5">Powered by GoldAPI.io — 24K, 22K & Silver rates in AED</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: connected ? "#059669" : "#6b7280" }}>
            <span style={{ color: connected ? "#10b981" : "#9ca3af" }}>●</span>
            {connected ? "Live Market Rate" : "Manual Mode (Offline)"}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!apiKeyConfigured && !connected && (
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">GoldAPI.io API Key</div>
            <Input
              type="password"
              placeholder="Paste your GoldAPI.io API key"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">No server-side key found — this key is used only for this request and is not stored.</p>
          </div>
        )}

        {connected && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3 text-center bg-muted/20">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">24K Gold</div>
              <div className="text-lg font-bold" style={{ fontFamily: "monospace" }}>{liveGoldRate24k?.toFixed(2) ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">AED/g</div>
            </div>
            <div className="rounded-lg border p-3 text-center bg-muted/20">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">22K Gold</div>
              <div className="text-lg font-bold" style={{ fontFamily: "monospace" }}>{liveGoldRate22k?.toFixed(2) ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">AED/g</div>
            </div>
            <div className="rounded-lg border p-3 text-center bg-muted/20">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Silver</div>
              <div className="text-lg font-bold" style={{ fontFamily: "monospace" }}>{liveSilverRate?.toFixed(2) ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">AED/g</div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {connected && lastSyncedAt
              ? `Last synced: ${new Date(lastSyncedAt).toLocaleString("en-AE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
              : "Not connected — rates are entered manually below"}
          </div>
          {connected ? (
            <Button
              variant="outline"
              onClick={onDisconnect}
              disabled={busy}
              className="flex items-center gap-2 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <WifiOff className="w-4 h-4" />}
              {disconnecting ? "Disconnecting..." : "Disconnect API"}
            </Button>
          ) : (
            <Button
              onClick={() => onConnect(apiKeyInput || undefined)}
              disabled={busy || (!apiKeyConfigured && !apiKeyInput.trim())}
              style={{ background: NAVY }}
              className="flex items-center gap-2"
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              {connecting ? "Connecting..." : "Connect API"}
            </Button>
          )}
        </div>
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
  const connectLiveRate = useConnectLiveRate();
  const disconnectLiveRate = useDisconnectLiveRate();

  const handleConnectLiveRate = (apiKey?: string) => {
    connectLiveRate.mutate({ data: apiKey ? { apiKey } : {} }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
        toast({ title: "✓ Connected to GoldAPI.io", description: "Live 24K, 22K & Silver rates applied." });
      },
      onError: (err: any) => {
        toast({ title: "Connection failed", description: err?.message ?? "Could not reach GoldAPI.io", variant: "destructive" });
      },
    });
  };

  const handleDisconnectLiveRate = () => {
    disconnectLiveRate.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
        toast({ title: "Disconnected", description: "Switched back to manual rate entry." });
      },
      onError: (err: any) => {
        toast({ title: "Failed to disconnect", description: err?.message, variant: "destructive" });
      },
    });
  };

  const RATE_KEYS: RateKey[] = ["goldJewelryRate", "goldBullionRate", "ttBarRate", "kgBarRate", "silverPricePerGram"];

  const [localRates, setLocalRates] = useState<Record<RateKey, number>>({
    goldJewelryRate: 0, goldBullionRate: 0, ttBarRate: 0, kgBarRate: 0, silverPricePerGram: 0,
  });
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

  const metals = [
    { label: "Gold Jewelry", sublabel: "22K / 916", icon: "💍", color: GOLD, fieldKey: "goldJewelryRate" as const },
    { label: "GOLD", sublabel: "24K / 995.0", icon: "🥇", color: "#d4aa00", fieldKey: "goldBullionRate" as const },
    { label: "TT BAR", sublabel: "24K / 995.0", icon: "📊", color: "#e67e22", fieldKey: "ttBarRate" as const },
    { label: "KG BAR", sublabel: "24K / 995.0", icon: "🏅", color: "#f39c12", fieldKey: "kgBarRate" as const },
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

      {/* Live Gold Rate API Integration */}
      <LiveRateCard
        connected={prices.liveModeConnected}
        apiKeyConfigured={prices.liveApiKeyConfigured}
        lastSyncedAt={prices.liveLastSyncedAt ?? null}
        liveGoldRate24k={prices.liveGoldRate24k ?? null}
        liveGoldRate22k={prices.liveGoldRate22k ?? null}
        liveSilverRate={prices.liveSilverRate ?? null}
        onConnect={handleConnectLiveRate}
        onDisconnect={handleDisconnectLiveRate}
        connecting={connectLiveRate.isPending}
        disconnecting={disconnectLiveRate.isPending}
      />

      {/* All cards in one grid: built-in + custom + always-visible add button */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {metals.map(metal => (
          <RateCard key={metal.fieldKey} {...metal}
            savedValue={(prices as any)[metal.fieldKey]}
            value={localRates[metal.fieldKey]}
            onChange={handleChange} onSave={handleSaveOne}
            liveLocked={prices.liveModeConnected} />
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
