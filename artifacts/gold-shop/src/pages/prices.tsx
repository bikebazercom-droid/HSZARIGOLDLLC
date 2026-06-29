import React, { useEffect } from "react";
import { useGetPrices, getGetPricesQueryKey, useUpdatePrices } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

const formSchema = z.object({
  goldPricePerGram: z.coerce.number().min(0.01, "Price must be greater than 0"),
  silverPricePerGram: z.coerce.number().min(0.01, "Price must be greater than 0"),
});

type FormValues = z.infer<typeof formSchema>;

export default function Prices() {
  const { toast } = useToast();
  const { data: prices, isLoading } = useGetPrices({ query: { queryKey: getGetPricesQueryKey() } });
  const updatePrices = useUpdatePrices();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      goldPricePerGram: 0,
      silverPricePerGram: 0,
    },
  });

  useEffect(() => {
    if (prices) {
      form.reset({
        goldPricePerGram: prices.goldPricePerGram,
        silverPricePerGram: prices.silverPricePerGram,
      });
    }
  }, [prices, form]);

  function onSubmit(values: FormValues) {
    updatePrices.mutate(
      { data: values },
      {
        onSuccess: () => {
          toast({ title: "Prices updated successfully" });
        },
        onError: (err: any) => {
          toast({ title: "Error updating prices", description: err.message, variant: "destructive" });
        },
      }
    );
  }

  if (isLoading) {
    return <div className="space-y-6 max-w-xl mx-auto"><Skeleton className="h-8 w-48" /><Skeleton className="h-64" /></div>;
  }

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <h1 className="text-3xl font-bold tracking-tight text-primary">Live Prices</h1>

      <Card>
        <CardHeader>
          <CardTitle>Daily Rates</CardTitle>
          <CardDescription>
            Set the base rate for gold and silver. These rates will be used across the application for live-priced items.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="goldPricePerGram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gold Price (per gram in AED)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">AED</span>
                        <Input type="number" step="0.01" className="pl-12 text-lg font-bold" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="silverPricePerGram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Silver Price (per gram in AED)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">AED</span>
                        <Input type="number" step="0.01" className="pl-12 text-lg font-bold" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end pt-4 border-t">
                <Button type="submit" disabled={updatePrices.isPending} size="lg" className="w-full sm:w-auto">
                  {updatePrices.isPending ? "Updating..." : "Update Live Prices"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
      
      {prices && (
        <p className="text-center text-sm text-muted-foreground">
          Last updated: {new Date(prices.updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
