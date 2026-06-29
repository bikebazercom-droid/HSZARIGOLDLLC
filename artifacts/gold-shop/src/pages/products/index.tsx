import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListProducts, getListProductsQueryKey, useDeleteProduct, ProductCategory } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Products() {
  const [category, setCategory] = useState<string>("all");
  const { data: products, isLoading } = useListProducts(
    { category: category === "all" ? undefined : category },
    { query: { queryKey: getListProductsQueryKey({ category: category === "all" ? undefined : category }) } }
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteProduct = useDeleteProduct();

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this product?")) {
      deleteProduct.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Product deleted successfully" });
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to delete product", variant: "destructive" });
        }
      });
    }
  };

  const categories = [
    { id: "all", label: "All Products" },
    { id: ProductCategory.gold_jewelry, label: "Gold Jewelry" },
    { id: ProductCategory.tt_bar, label: "TT Bar" },
    { id: ProductCategory.kg_bar, label: "KG Bar" },
    { id: ProductCategory.silver, label: "Silver" },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight text-primary">Products</h1>
        <Link href="/products/new">
          <Button><Plus className="w-4 h-4 mr-2" /> Add Product</Button>
        </Link>
      </div>

      <Tabs defaultValue="all" value={category} onValueChange={setCategory}>
        <TabsList className="mb-4">
          {categories.map(c => (
            <TabsTrigger key={c.id} value={c.id}>{c.label}</TabsTrigger>
          ))}
        </TabsList>

        <div className="bg-card rounded-md border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Price per Unit (AED)</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">Loading...</TableCell>
                </TableRow>
              ) : products?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No products found in this category.
                  </TableCell>
                </TableRow>
              ) : (
                products?.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {product.category.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>{product.unit}</TableCell>
                    <TableCell className="text-right font-medium">
                      {product.pricePerUnit ? product.pricePerUnit.toLocaleString() : "Live Price"}
                    </TableCell>
                    <TableCell className="text-right">
                      {product.stock !== null && product.stock !== undefined ? product.stock : "N/A"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(product.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Tabs>
    </div>
  );
}
