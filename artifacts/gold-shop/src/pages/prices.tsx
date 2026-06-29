import React, { useState, useEffect } from "react";
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
import { TrendingUp } from "lucide-react";

const NAVY = "#1e3a5f";
const GOLD = "#c8a43a";

interface RateCardProps {
  label: string;
  sublabel: string;
  icon: string;
  color: string;
  fieldKey: "goldJewelryRate" | "goldBullionRate" | "ttBarRate" | "kgBarRate" | "silverPricePerGram";
  currentValue: number;
  updatedAt: string;
  onSave: (field: string, value: number) => Promise<void>;
}

function RateCard({ label, sublabel, icon, color, fieldKey, currentValue, updatedAt, onSave }: RateCardProps) {
  const [value, setValue] = useState(currentValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(currentValue);
  }, [currentValue]);

  const handleSave = async () => {
    setSaving(true);
    await onSave(fieldKey, value);
    setSaving(false);
  };

  const changed = value !== currentValue;

  return (
    <Card className="relative overflow-hidden">
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: color }} />
      <CardHeader className="pb-3 pt-5">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
            style={{ background: `${color}18`, border: `2px solid ${color}40` }}
          >
            {icon}
          </div>
          <div>
            <CardTitle className="text-base font-bold leading-tight">{label}</CardTitle>
            <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-xs text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Rate per gram (AED)</div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium select-none">AED</span>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={value}
              onChange={e => setValue(parseFloat(e.target.value) || 0)}
              className="pl-14 text-xl font-bold h-12"
              style={{ fontFamily: "monospace" }}
            />
          </div>
          {changed && (
            <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-600">
              <span>●</span>
              <span>Unsaved — was AED {currentValue.toFixed(2)}</span>
            </div>
          )}
        </div>

        <Button
          className="w-full"
          style={{ background: changed ? NAVY : undefined }}
          onClick={handleSave}
          disabled={saving || !changed}
          size="sm"
        >
          {saving ? "Saving..." : changed ? `Update ${label} Rate` : "Rate Saved ✓"}
        </Button>

        <div className="text-xs text-muted-foreground text-center">
          Last updated: {new Date(updatedAt).toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Prices() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: prices, isLoading } = useGetPrices({
    query: { queryKey: getGetPricesQueryKey() }
  });
  const updatePrices = useUpdatePrices();

  const handleSave = async (field: string, value: number) => {
    return new Promise<void>((resolve, reject) => {
      updatePrices.mutate(
        { data: { [field]: value } as any },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetPricesQueryKey() });
            toast({ title: "Rate updated successfully" });
            resolve();
          },
          onError: (err: any) => {
            toast({ title: "Failed to update rate", description: err.message, variant: "destructive" });
            reject(err);
          },
        }
      );
    });
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
    {
      label: "Gold Jewelry",
      sublabel: "22K / 916",
      icon: "💍",
      color: GOLD,
      fieldKey: "goldJewelryRate" as const,
      currentValue: prices.goldJewelryRate,
    },
    {
      label: "GOLD",
      sublabel: "24K / 999.9",
      icon: "🥇",
      color: "#d4aa00",
      fieldKey: "goldBullionRate" as const,
      currentValue: prices.goldBullionRate,
    },
    {
      label: "TT BAR",
      sublabel: "24K / 999.9",
      icon: "📊",
      color: "#e67e22",
      fieldKey: "ttBarRate" as const,
      currentValue: prices.ttBarRate,
    },
    {
      label: "KG BAR",
      sublabel: "24K / 999.9",
      icon: "🏅",
      color: "#f39c12",
      fieldKey: "kgBarRate" as const,
      currentValue: prices.kgBarRate,
    },
    {
      label: "Silver",
      sublabel: "Pure Silver",
      icon: "🪙",
      color: "#95a5a6",
      fieldKey: "silverPricePerGram" as const,
      currentValue: prices.silverPricePerGram,
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Live Prices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Daily Rates — update each metal independently</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {metals.map(metal => (
          <RateCard
            key={metal.fieldKey}
            {...metal}
            updatedAt={prices.updatedAt}
            onSave={handleSave}
          />
        ))}
      </div>
    </div>
  );
}
