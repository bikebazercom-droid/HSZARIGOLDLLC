import React, { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useListProducts, getListProductsQueryKey, useUpdateProduct } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

const PRESET_CATEGORIES = ["gold_jewelry", "tt_bar", "kg_bar", "silver"];
const CATEGORY_LABELS: Record<string, string> = {
  gold_jewelry: "Gold Jewelry",
  tt_bar: "TT Bar",
  kg_bar: "KG Bar",
  silver: "Silver",
};

export default function ProductDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateProduct = useUpdateProduct();

  const { data: products, isLoading } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });
  const product = products?.find(p => p.id === id);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("gold_jewelry");
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [unit, setUnit] = useState("Gram");
  const [pricePerUnit, setPricePerUnit] = useState<string>("");
  const [stock, setStock] = useState<string>("");

  useEffect(() => {
    if (product) {
      setName(product.name);
      setCategory(product.category);
      setIsCustomCategory(!PRESET_CATEGORIES.includes(product.category));
      setUnit(product.unit);
      setPricePerUnit(product.pricePerUnit != null ? String(product.pricePerUnit) : "");
      setStock(product.stock != null ? String(product.stock) : "");
    }
  }, [product]);

  const handleSave = () => {
    if (!name.trim() || !category.trim() || !unit.trim()) {
      toast({ title: "Name, Category and Unit are required", variant: "destructive" });
      return;
    }
    updateProduct.mutate(
      {
        id,
        data: {
          name,
          category,
          unit,
          pricePerUnit: pricePerUnit ? parseFloat(pricePerUnit) : undefined,
          stock: stock ? parseFloat(stock) : undefined,
        } as any,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey({}) });
          toast({ title: "Product updated" });
          setLocation("/products");
        },
        onError: (err: any) => {
          toast({ title: "Error updating product", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  if (isLoading) return <div className="space-y-4 max-w-2xl mx-auto"><Skeleton className="h-10 w-52" /><Skeleton className="h-64" /></div>;
  if (!product) return <div className="p-8 text-muted-foreground">Product not found.</div>;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/products">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-primary">Edit Product</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Product Details</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Product Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="E.g., 22K Gold Chain" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label>Category *</Label>
              {isCustomCategory ? (
                <div className="flex gap-2 items-center">
                  <Input
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    placeholder="Type custom category…"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="text-xs text-blue-500 hover:underline whitespace-nowrap"
                    onClick={() => { setIsCustomCategory(false); setCategory("gold_jewelry"); }}
                  >List</button>
                </div>
              ) : (
                <Select
                  value={PRESET_CATEGORIES.includes(category) ? category : "__custom__"}
                  onValueChange={val => {
                    if (val === "__custom__") {
                      setIsCustomCategory(true);
                      setCategory("");
                    } else {
                      setCategory(val);
                    }
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRESET_CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{CATEGORY_LABELS[cat] ?? cat}</SelectItem>
                    ))}
                    <SelectItem value="__custom__">✏️ Custom…</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Unit *</Label>
              <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Gram, Piece, etc." />
            </div>

            <div className="space-y-2">
              <Label>Fixed Price (Optional)</Label>
              <Input type="number" value={pricePerUnit} onChange={e => setPricePerUnit(e.target.value)} placeholder="Leave empty for live price" />
            </div>

            <div className="space-y-2">
              <Label>Stock Quantity (Optional)</Label>
              <Input type="number" value={stock} onChange={e => setStock(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-4 border-t">
            <Link href="/products">
              <Button type="button" variant="outline">Cancel</Button>
            </Link>
            <Button onClick={handleSave} disabled={updateProduct.isPending}>
              {updateProduct.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
