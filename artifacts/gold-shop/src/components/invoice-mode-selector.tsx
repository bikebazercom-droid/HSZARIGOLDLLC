import React from "react";
import { Link, useLocation } from "wouter";

interface InvoiceModeSelectorProps {
  mode: "retail" | "wholesale";
}

export function InvoiceModeSelector({ mode }: InvoiceModeSelectorProps) {
  const [location] = useLocation();

  const isNew = location.endsWith("/new");

  return (
    <div className="flex bg-muted/30 p-1 rounded-lg border border-border/50 self-start sm:self-auto mb-4 w-full sm:w-auto">
      <Link href={isNew ? "/invoices/new" : "/invoices"}>
        <div
          className={`flex-1 sm:flex-none cursor-pointer text-center px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "retail"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          Retail Customer
        </div>
      </Link>
      <Link href={isNew ? "/wholesale/new" : "/wholesale"}>
        <div
          className={`flex-1 sm:flex-none cursor-pointer text-center px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "wholesale"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
          }`}
        >
          Wholesale / Trader
        </div>
      </Link>
    </div>
  );
}
