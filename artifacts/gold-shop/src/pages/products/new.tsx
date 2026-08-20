import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateProduct } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PRESET_CATEGORIES = ["gold_jewelry", "ten_tola_bar", "kg_bar", "silver"];
const CATEGORY_LABELS: Record<string, string> = {
  gold_jewelry: "Gold Jewelry",
  ten_tola_bar: "TEN TOLA BAR",
  kg_bar: "KG Bar",
  silver: "Silver",
};

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  unit: z.string().min(1, "Unit is required"),
  pricePerUnit: z.coerce.number().optional(),
  stock: z.coerce.number().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewProduct() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createProduct = useCreateProduct();
  const [isCustomCategory, setIsCustomCategory] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      category: "gold_jewelry",
      unit: "Gram",
      pricePerUnit: undefined,
      stock: undefined,
    },
  });

  function onSubmit(values: FormValues) {
    createProduct.mutate(
      { data: values as any },
      {
        onSuccess: () => {
          toast({ title: "Product added successfully" });
          setLocation("/products");
        },
        onError: (err: any) => {
          toast({ title: "Error adding product", description: err.message, variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/products">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-primary">New Product</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="E.g., 22K Gold Chain" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category *</FormLabel>
                      {isCustomCategory ? (
                        <div className="flex gap-2 items-center">
                          <FormControl>
                            <Input
                              placeholder="Type custom category…"
                              value={field.value}
                              onChange={field.onChange}
                              autoFocus
                            />
                          </FormControl>
                          <button
                            type="button"
                            className="text-xs text-blue-500 hover:underline whitespace-nowrap"
                            onClick={() => {
                              setIsCustomCategory(false);
                              field.onChange("gold_jewelry");
                            }}
                          >List</button>
                        </div>
                      ) : (
                        <Select
                          value={field.value}
                          onValueChange={val => {
                            if (val === "__custom__") {
                              setIsCustomCategory(true);
                              field.onChange("");
                            } else {
                              field.onChange(val);
                            }
                          }}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {PRESET_CATEGORIES.map(cat => (
                              <SelectItem key={cat} value={cat}>
                                {CATEGORY_LABELS[cat] ?? cat}
                              </SelectItem>
                            ))}
                            <SelectItem value="__custom__">✏️ Custom…</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="unit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit *</FormLabel>
                      <FormControl>
                        <Input placeholder="Gram, Piece, etc." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="pricePerUnit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fixed Price (Optional)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Leave empty for live price" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="stock"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Stock Quantity (Optional)</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="0" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end gap-4 pt-4 border-t">
                <Link href="/products">
                  <Button type="button" variant="outline">Cancel</Button>
                </Link>
                <Button type="submit" disabled={createProduct.isPending}>
                  {createProduct.isPending ? "Saving..." : "Save Product"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
