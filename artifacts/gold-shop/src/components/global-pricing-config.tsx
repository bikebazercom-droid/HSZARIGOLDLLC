import React, { useState, useEffect } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Gauge, Percent, Sparkles, Radio, KeyRound, AlertTriangle } from "lucide-react";

const NAVY = "#1e3a5f";
const GOLD = "#c8a43a";

interface GlobalPricingConfigProps {
  /** Slightly denser presentation for embedding above other dashboard content. */
  compact?: boolean;
}

/**
 * "Global Price Control Panel" — lets an admin fine-tune the international
 * spot-gold pricing engine with a flat AED spread/premium (can be positive
 * or negative) and a jewelry-only labor cost %.
 *
 * Formula: Final_24K_Base = Live_API_Rate (Base_24K_AED) + Spread_Input
 * Every TV row (TT. BAR, GOLD KG, Jewelry 22K/21K/18K) recalculates from
 * Final_24K_Base. Saved values persist in the `prices` table and are picked
 * up by the 1s live-price poll used everywhere (dashboard, /tv, invoices),
 * so the TV board reflects a saved change within ~1 second — no manual
 * reload required.
 */
export function GlobalPricingConfig({ compact = false }: GlobalPricingConfigProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { liveRates } = useLivePrice();
  const { data: prices } = useGetPrices({ query: { queryKey: getGetPricesQueryKey() } });
  const updatePrices = useUpdatePrices();

  const [localSpreadPremiumAed, setLocalSpreadPremiumAed] = useState(0);
  const [localLaborCostPercent, setLocalLaborCostPercent] = useState(0);
  const [localFeedSource, setLocalFeedSource] = useState<"free" | "goldapi">("free");
  const [localApiKey, setLocalApiKey] = useState("");
  const [savingPricingConfig, setSavingPricingConfig] = useState(false);

  useEffect(() => {
    if (prices) {
      setLocalSpreadPremiumAed(prices.spreadPremiumAed ?? 0);
      setLocalLaborCostPercent(prices.laborCostPercent ?? 0);
      setLocalFeedSource(prices.liveApiProvider === "goldapi" ? "goldapi" : "free");
    }
  }, [prices]);

  const pricingConfigChanged = prices
    ? localSpreadPremiumAed !== (prices.spreadPremiumAed ?? 0)
      || localLaborCostPercent !== (prices.laborCostPercent ?? 0)
      || localFeedSource !== (prices.liveApiProvider === "goldapi" ? "goldapi" : "free")
      || localApiKey.length > 0
    : false;

  const handleSavePricingConfig = async () => {
    setSavingPricingConfig(true);
    try {
      await new Promise<void>((resolve, reject) => {
        updatePrices.mutate(
          {
            data: {
              spreadPremiumAed: localSpreadPremiumAed,
              laborCostPercent: localLaborCostPercent,
              liveApiProvider: localFeedSource,
              ...(localApiKey.length > 0 ? { liveApiKey: localApiKey } : {}),
            } as any,
          },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
              setLocalApiKey("");
              toast({
                title: "Global Price Control saved",
                description: "The TV board and every invoice rate update within 1 second — no reload needed.",
              });
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

  const baseAedPerGram = liveRates.baseAedPerGram;
  const previewFinal24k = baseAedPerGram != null ? baseAedPerGram + localSpreadPremiumAed : null;

  return (
    <Card className="relative overflow-hidden border-2" style={{ borderColor: `${GOLD}55` }}>
      <div
        className="absolute top-0 left-0 right-0 h-1"
        style={{ background: `linear-gradient(to right, ${NAVY}, ${GOLD}, ${NAVY})` }}
      />
      <CardHeader className={compact ? "pb-3 pt-4" : "pb-3 pt-5"}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `${NAVY}12`, border: `1px solid ${NAVY}33` }}
            >
              <Sparkles className="w-4.5 h-4.5" style={{ color: NAVY }} />
            </div>
            <div>
              <CardTitle className="text-base font-bold">Global Price Control Panel</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                International Spot Gold (XAU/USD) engine · full manual control over margin
              </p>
            </div>
          </div>
          {baseAedPerGram != null && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ background: "#10b98114", border: "1px solid #10b98140", color: "#047857" }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#10b981" }} />
              Live Base_24K_AED: AED {baseAedPerGram.toFixed(2)}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-gradient-to-br from-slate-50 to-white p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: NAVY }}>
              <Gauge className="w-3.5 h-3.5" />
              Price Adjustment / Spread (AED per Gram)
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold select-none">AED</span>
              <Input
                type="number"
                step="0.01"
                value={localSpreadPremiumAed}
                onChange={e => setLocalSpreadPremiumAed(parseFloat(e.target.value))}
                placeholder="e.g. +0.25 or -0.10"
                className="pl-14 text-xl font-bold h-12 tracking-tight"
                style={{ fontFamily: "monospace", color: localSpreadPremiumAed < 0 ? "#b91c1c" : localSpreadPremiumAed > 0 ? "#047857" : undefined }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Accepts positive or negative decimals. <code className="px-1 py-0.5 rounded bg-muted text-[10px]">Final_24K = Live_API_Rate + Spread</code>
            </p>
          </div>

          <div className="rounded-xl border bg-gradient-to-br from-slate-50 to-white p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: NAVY }}>
              <Percent className="w-3.5 h-3.5" />
              Labor Cost (%)
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-semibold select-none">%</span>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={localLaborCostPercent}
                onChange={e => setLocalLaborCostPercent(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder="e.g. 3"
                className="pl-9 text-xl font-bold h-12 tracking-tight"
                style={{ fontFamily: "monospace", color: GOLD }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Applied automatically to Gold Jewelry <strong>22K / 21K / 18K</strong> rows only.
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-gradient-to-br from-slate-50 to-white p-4 mt-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: NAVY }}>
            <Radio className="w-3.5 h-3.5" />
            Price Feed Source
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select value={localFeedSource} onValueChange={v => setLocalFeedSource(v as "free" | "goldapi")}>
              <SelectTrigger className="h-11 text-sm font-semibold">
                <SelectValue placeholder="Select feed source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free Live Feed (estimated bid/ask)</SelectItem>
                <SelectItem value="goldapi">Paid Premium API (GoldAPI.io)</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="password"
                value={localApiKey}
                onChange={e => setLocalApiKey(e.target.value)}
                placeholder={
                  prices?.liveApiKeyConfigured
                    ? `Saved key: ${prices.liveApiKeyMasked ?? "••••"}`
                    : "Paid API Key (GoldAPI.io)"
                }
                disabled={localFeedSource !== "goldapi"}
                className="pl-9 h-11 text-sm"
                autoComplete="new-password"
              />
            </div>
          </div>
          {localFeedSource === "goldapi" && !prices?.liveApiKeyConfigured && localApiKey.length === 0 && (
            <p className="flex items-center gap-1 text-[11px] mt-1.5" style={{ color: "#b91c1c" }}>
              <AlertTriangle className="w-3 h-3" />
              Enter and save an API key to activate the paid feed — otherwise the free feed stays active.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Free: <code className="px-1 py-0.5 rounded bg-muted text-[10px]">Ask = XAU/USD + 1.04, Bid = Ask − 0.90</code>.
            Paid: real bid/ask/high/low streamed directly from GoldAPI.io.
          </p>
        </div>

        {previewFinal24k != null && (
          <div className="flex items-center justify-center gap-2 mt-4 rounded-lg py-2 text-sm font-semibold" style={{ background: `${NAVY}0a`, color: NAVY }}>
            Final 24K Base Preview: AED {previewFinal24k.toFixed(2)} / g
            <span className="text-xs font-normal text-muted-foreground">
              ({baseAedPerGram!.toFixed(2)} {localSpreadPremiumAed >= 0 ? "+" : "−"} {Math.abs(localSpreadPremiumAed).toFixed(2)})
            </span>
          </div>
        )}

        <Button
          className="w-full mt-4 h-11 text-sm font-semibold shadow-sm"
          style={{ background: pricingConfigChanged ? NAVY : undefined }}
          onClick={handleSavePricingConfig}
          disabled={savingPricingConfig || !pricingConfigChanged}
        >
          {savingPricingConfig ? "Saving..." : pricingConfigChanged ? "Save & Sync to TV Instantly" : "Configuration Saved ✓"}
        </Button>
      </CardContent>
    </Card>
  );
}
