import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateInvoice, InvoiceInputPaymentMethod, useListProducts, getListProductsQueryKey, useListCustomers, getListCustomersQueryKey, useGetPrices, getGetPricesQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, ArrowLeft, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export default function NewInvoice() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createInvoice = useCreateInvoice();

  // Data fetching
  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });
  const { data: products } = useListProducts({}, { query: { queryKey: getListProductsQueryKey({}) } });
  const { data: prices } = useGetPrices({ query: { queryKey: getGetPricesQueryKey() } });

  // Form state
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

  // Items state
  const [items, setItems] = useState<Array<{
    id: string;
    productId?: number;
    description: string;
    category?: string;
    quantity: number;
    weight: number;
    unitPrice: number;
    totalPrice: number;
  }>>([]);

  const handleCustomerSelect = (id: string) => {
    if (id === "walk-in") {
      setCustomerId(undefined);
      return;
    }
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

  const handleProductSelect = (id: string, index: number) => {
    const product = products?.find(p => p.id === parseInt(id));
    if (product) {
      const newItems = [...items];
      let unitPrice = product.pricePerUnit || 0;
      
      // Calculate unit price from live rate if not fixed
      if (!product.pricePerUnit && prices) {
        if (product.category === 'silver') unitPrice = prices.silverPricePerGram;
        else unitPrice = prices.goldPricePerGram; // TT bar, KG bar, jewelry
      }

      newItems[index] = {
        ...newItems[index],
        productId: product.id,
        description: product.name,
        category: product.category,
        unitPrice: unitPrice,
        totalPrice: unitPrice * newItems[index].quantity * (newItems[index].weight || 1)
      };
      setItems(newItems);
    }
  };

  const addItem = () => {
    setItems([...items, {
      id: Math.random().toString(36).substring(7),
      description: "",
      quantity: 1,
      weight: 0,
      unitPrice: 0,
      totalPrice: 0
    }]);
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // Recalculate total for this item
    const item = newItems[index];
    item.totalPrice = item.unitPrice * item.quantity * (item.weight || 1);
    
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
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

    // validate items
    for (const item of items) {
      if (!item.description || item.unitPrice <= 0) {
        toast({ title: "Validation Error", description: "All items must have a description and valid price", variant: "destructive" });
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
          productId: item.productId,
          description: item.description,
          category: item.category,
          quantity: item.quantity,
          weight: item.weight || undefined,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice
        }))
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-20">
      <div className="flex items-center gap-4">
        <Link href="/invoices">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-primary">New Invoice</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Invoice Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[250px]">Product / Description</TableHead>
                      <TableHead className="w-[100px]">Qty</TableHead>
                      <TableHead className="w-[120px]">Weight (g)</TableHead>
                      <TableHead className="w-[150px]">Unit Price</TableHead>
                      <TableHead className="w-[150px] text-right">Total (AED)</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="space-y-2">
                            {products && products.length > 0 && (
                              <Select 
                                value={item.productId?.toString() || "custom"} 
                                onValueChange={(val) => {
                                  if (val !== "custom") handleProductSelect(val, index);
                                }}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder="Select product" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="custom">Custom Item</SelectItem>
                                  {products.map(p => (
                                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            <Input 
                              placeholder="Description" 
                              value={item.description}
                              onChange={(e) => updateItem(index, "description", e.target.value)}
                              className="h-8"
                            />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="number" 
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateItem(index, "quantity", parseFloat(e.target.value) || 0)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="number" 
                            min="0"
                            step="0.01"
                            value={item.weight}
                            onChange={(e) => updateItem(index, "weight", parseFloat(e.target.value) || 0)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell>
                          <Input 
                            type="number" 
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(index, "unitPrice", parseFloat(e.target.value) || 0)}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {item.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeItem(index)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button variant="outline" className="mt-4 w-full border-dashed" onClick={addItem}>
                <Plus className="w-4 h-4 mr-2" /> Add Line Item
              </Button>
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
                      <SelectValue placeholder="Select a customer or type below" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in / New Customer</SelectItem>
                      {customers.map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>{c.name} {c.mobile ? `(${c.mobile})` : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="John Doe" />
              </div>
              <div className="space-y-2">
                <Label>Mobile Number</Label>
                <Input value={customerMobile} onChange={e => setCustomerMobile(e.target.value)} placeholder="+971 50 123 4567" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Passport Number</Label>
                  <Input value={customerPassportNumber} onChange={e => setCustomerPassportNumber(e.target.value)} placeholder="Passport No." />
                </div>
                <div className="space-y-2">
                  <Label>Emirates ID</Label>
                  <Input value={customerEmiratesId} onChange={e => setCustomerEmiratesId(e.target.value)} placeholder="EID" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="Email" type="email" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Payment & Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={(val: any) => setPaymentMethod(val)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={InvoiceInputPaymentMethod.cash}>Cash Payment</SelectItem>
                      <SelectItem value={InvoiceInputPaymentMethod.card}>Card Payment</SelectItem>
                      <SelectItem value={InvoiceInputPaymentMethod.bank_transfer}>Bank Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Pending Payment</Label>
                    <div className="text-sm text-muted-foreground">Mark if payment is not fully received</div>
                  </div>
                  <Switch checked={isPending} onCheckedChange={setIsPending} />
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional invoice notes..." className="h-20 resize-none" />
                </div>
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span className="font-medium">{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} AED</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span>Discount (AED)</span>
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
                  <span>{total.toLocaleString(undefined, { minimumFractionDigits: 2 })} AED</span>
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
