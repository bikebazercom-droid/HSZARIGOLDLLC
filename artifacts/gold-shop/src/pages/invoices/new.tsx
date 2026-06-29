import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateInvoice,
  InvoiceInputPaymentMethod,
  useListCustomers,
  getListCustomersQueryKey,
  useGetPrices,
  getGetPricesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface LineItem {
  id: string;
  description: string;
  category: string;
  grossWeight: number;
  purity: number;
  pureWeight: number;
  makingRate: number;
  makingAmt: number;
  totalPrice: number;
}

const PURITY_OPTIONS = [
  { label: "24K (0.9999)", value: 0.9999 },
  { label: "22K (0.9167)", value: 0.9167 },
  { label: "21K (0.8750)", value: 0.875 },
  { label: "18K (0.7500)", value: 0.75 },
  { label: "Silver (0.9990)", value: 0.999 },
  { label: "Custom", value: 0 },
];

function calcItem(item: LineItem, goldRate: number): LineItem {
  const pureWeight = parseFloat((item.grossWeight * item.purity).toFixed(4));
  const makingAmt = parseFloat((item.grossWeight * item.makingRate).toFixed(2));
  const totalPrice = parseFloat((pureWeight * goldRate + makingAmt).toFixed(2));
  return { ...item, pureWeight, makingAmt, totalPrice };
}

export default function NewInvoice() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createInvoice = useCreateInvoice();

  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });
  const { data: prices } = useGetPrices({ query: { queryKey: getGetPricesQueryKey() } });

  const goldRate = prices?.goldPricePerGram ?? 320;

  const [customerId, setCustomerId] = useState<number | undefined>();
  const [customerName, setCustomerName] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPassportNumber, setCustomerPassportNumber] = useState("");
  const [customerEmiratesId, setCustomerEmiratesId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<InvoiceInputPaymentMethod>(InvoiceInputPaymentMethod.cash);
  const [isPending, setIsPending] = useState(false);
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState<number>(0);
  const [customPurityIdx, setCustomPurityIdx] = useState<Record<number, boolean>>({});

  const [items, setItems] = useState<LineItem[]>([]);

  const handleCustomerSelect = (id: string) => {
    if (id === "walk-in") { setCustomerId(undefined); return; }
    const customer = customers?.find(c => c.id === parseInt(id));
    if (customer) {
      setCustomerId(customer.id);
      setCustomerName(customer.name || "");
      setCustomerMobile(customer.mobile || "");
      setCustomerEmail(customer.email || "");
      setCustomerPassportNumber(customer.passportNumber || "");
      setCustomerEmiratesId(customer.emiratesId || "");
    }
  };

  const addItem = () => {
    setItems(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      description: "",
      category: "gold_jewelry",
      grossWeight: 0,
      purity: 0.9167,
      pureWeight: 0,
      makingRate: 0,
      makingAmt: 0,
      totalPrice: 0,
    }]);
  };

  const updateItem = (index: number, field: keyof LineItem, value: string | number) => {
    setItems(prev => {
      const next = [...prev];
      const updated = { ...next[index], [field]: value };
      next[index] = calcItem(updated as LineItem, goldRate);
      return next;
    });
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const total = Math.max(0, subtotal - discount);

  const handleSubmit = () => {
    if (!customerName) {
      toast({ title: "Validation Error", description: "Customer name is required", variant: "destructive" });
      return;
    }
    if (items.length === 0) {
      toast({ title: "Validation Error", description: "At least one item is required", variant: "destructive" });
      return;
    }
    for (const item of items) {
      if (!item.description) {
        toast({ title: "Validation Error", description: "All items must have a description", variant: "destructive" });
        return;
      }
    }

    createInvoice.mutate({
      data: {
        customerId,
        customerName,
        customerMobile,
        customerEmail,
        customerPassportNumber,
        customerEmiratesId,
        paymentMethod,
        isPending,
        notes,
        subtotal,
        discount,
        total,
        items: items.map(item => ({
          description: item.description,
          category: item.category,
          quantity: 1,
          grossWeight: item.grossWeight,
          purity: item.purity,
          pureWeight: item.pureWeight,
          makingRate: item.makingRate,
          makingAmt: item.makingAmt,
          unitPrice: goldRate,
          totalPrice: item.totalPrice,
        })),
      }
    }, {
      onSuccess: (data) => {
        toast({ title: "Invoice created successfully" });
        setLocation(`/invoices/${data.id}`);
      },
      onError: (err: any) => {
        toast({ title: "Error creating invoice", description: err.message, variant: "destructive" });
      }
    });
  };

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-20">
      <div className="flex items-center gap-4">
        <Link href="/invoices">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">New Invoice</h1>
          {prices && (
            <p className="text-sm text-muted-foreground mt-0.5">
              Gold Rate: AED {goldRate}/g &nbsp;|&nbsp; Silver Rate: AED {prices.silverPricePerGram}/g
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Invoice Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded overflow-hidden border border-border">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: "#1e3a5f" }}>
                      <th className="py-2.5 px-3 text-left text-xs font-semibold text-white whitespace-nowrap w-10">S.No.</th>
                      <th className="py-2.5 px-3 text-left text-xs font-semibold text-white whitespace-nowrap min-w-[180px]">Stock Description</th>
                      <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[100px]">Gross Wt.</th>
                      <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[130px]">Purity</th>
                      <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[90px]">Pure Wt.</th>
                      <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[110px]">Making Rate</th>
                      <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[120px]">Making Amt. (AED)</th>
                      <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[110px]">Total (AED)</th>
                      <th className="w-8 bg-[#1e3a5f]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-muted-foreground text-sm">
                          No items yet. Click "Add Line Item" below.
                        </td>
                      </tr>
                    )}
                    {items.map((item, index) => {
                      const isCustomPurity = customPurityIdx[index];
                      return (
                        <tr key={item.id} className="border-b border-border/50 even:bg-muted/20">
                          <td className="py-2 px-3 text-center text-muted-foreground text-sm">{index + 1}</td>
                          <td className="py-2 px-3">
                            <Input
                              placeholder="Stock description"
                              value={item.description}
                              onChange={e => updateItem(index, "description", e.target.value)}
                              className="h-8 text-sm"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              type="number"
                              min="0"
                              step="0.001"
                              value={item.grossWeight || ""}
                              onChange={e => updateItem(index, "grossWeight", parseFloat(e.target.value) || 0)}
                              className="h-8 text-sm text-center"
                            />
                          </td>
                          <td className="py-2 px-3">
                            {isCustomPurity ? (
                              <Input
                                type="number"
                                min="0"
                                max="1"
                                step="0.0001"
                                value={item.purity || ""}
                                onChange={e => updateItem(index, "purity", parseFloat(e.target.value) || 0)}
                                className="h-8 text-sm text-center"
                                placeholder="0.9167"
                              />
                            ) : (
                              <Select
                                value={item.purity === 0 ? "custom" : String(item.purity)}
                                onValueChange={val => {
                                  if (val === "custom") {
                                    setCustomPurityIdx(p => ({ ...p, [index]: true }));
                                    updateItem(index, "purity", 0);
                                  } else {
                                    updateItem(index, "purity", parseFloat(val));
                                  }
                                }}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue placeholder="Select purity" />
                                </SelectTrigger>
                                <SelectContent>
                                  {PURITY_OPTIONS.map(o => (
                                    <SelectItem key={o.label} value={o.value === 0 ? "custom" : String(o.value)}>{o.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center font-mono text-sm">
                            {item.pureWeight.toFixed(4)}
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.makingRate || ""}
                              onChange={e => updateItem(index, "makingRate", parseFloat(e.target.value) || 0)}
                              className="h-8 text-sm text-center"
                            />
                          </td>
                          <td className="py-2 px-3 text-center font-mono text-sm">
                            {fmt(item.makingAmt)}
                          </td>
                          <td className="py-2 px-3 text-center font-semibold font-mono text-sm text-primary">
                            {fmt(item.totalPrice)}
                          </td>
                          <td className="py-2 px-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => removeItem(index)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Button variant="outline" className="mt-4 w-full border-dashed" onClick={addItem}>
                <Plus className="w-4 h-4 mr-2" /> Add Line Item
              </Button>

              {items.length > 0 && (
                <div className="mt-4 p-3 bg-muted/40 rounded text-xs text-muted-foreground">
                  Formula: Pure Wt = Gross Wt × Purity &nbsp;|&nbsp; Making Amt = Gross Wt × Making Rate &nbsp;|&nbsp; Total = (Pure Wt × Gold Rate AED {goldRate}/g) + Making Amt
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Customer Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {customers && customers.length > 0 && (
                <div className="space-y-2">
                  <Label>Existing Customer</Label>
                  <Select onValueChange={handleCustomerSelect}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select or type below" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in / New Customer</SelectItem>
                      {customers.map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>
                          {c.name}{c.mobile ? ` (${c.mobile})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" />
              </div>
              <div className="space-y-2">
                <Label>Mobile Number</Label>
                <Input value={customerMobile} onChange={e => setCustomerMobile(e.target.value)} placeholder="+971 50 123 4567" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Passport No.</Label>
                  <Input value={customerPassportNumber} onChange={e => setCustomerPassportNumber(e.target.value)} placeholder="Passport" />
                </div>
                <div className="space-y-2">
                  <Label>Emirates ID</Label>
                  <Input value={customerEmiratesId} onChange={e => setCustomerEmiratesId(e.target.value)} placeholder="EID" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="email@example.com" type="email" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Payment & Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={paymentMethod} onValueChange={(val: any) => setPaymentMethod(val)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={InvoiceInputPaymentMethod.cash}>Cash Payment</SelectItem>
                    <SelectItem value={InvoiceInputPaymentMethod.card}>Card Payment</SelectItem>
                    <SelectItem value={InvoiceInputPaymentMethod.bank_transfer}>Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Pending Payment</Label>
                  <div className="text-xs text-muted-foreground mt-0.5">Mark if not fully received</div>
                </div>
                <Switch checked={isPending} onCheckedChange={setIsPending} />
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." className="h-20 resize-none" />
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">{fmt(subtotal)} AED</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Discount (AED)</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-24 h-8 text-right"
                    value={discount}
                    onChange={e => setDiscount(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t text-primary">
                  <span>Grand Total</span>
                  <span>{fmt(total)} AED</span>
                </div>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleSubmit}
                disabled={createInvoice.isPending || items.length === 0}
              >
                {createInvoice.isPending ? "Generating..." : "Generate Invoice"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
