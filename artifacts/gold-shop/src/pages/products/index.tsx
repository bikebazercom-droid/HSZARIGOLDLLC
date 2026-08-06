import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { PurchaseDrawer, StockLedger } from "./stock";

export default function Products() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <h1 className="text-3xl font-bold tracking-tight text-primary">Products &amp; Inventory</h1>
        <Button onClick={() => setDrawerOpen(true)}><Plus className="w-4 h-4 mr-2" /> Add Product</Button>
      </div>

      <PurchaseDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />

      <StockLedger />
    </div>
  );
}
