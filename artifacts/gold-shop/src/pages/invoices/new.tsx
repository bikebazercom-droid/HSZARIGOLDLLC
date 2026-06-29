import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useCreateInvoice,
  useCreateCustomer,
  InvoiceInputPaymentMethod,
  useListCustomers,
  getListCustomersQueryKey,
  useGetPrices,
  getGetPricesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
  purity: string;
  pureWeight: number;
  makingRate: number;
  makingAmt: number;
  totalPrice: number;
}

function makeItem(description: string, category: string, purity: string): LineItem {
  return {
    id: Math.random().toString(36).substring(7),
    description,
    category,
    grossWeight: 0,
    purity,
    pureWeight: 0,
    makingRate: 0,
    makingAmt: 0,
    totalPrice: 0,
  };
}

const DEFAULT_ITEMS: LineItem[] = [
  makeItem("22K Gold Jewelry", "gold_jewelry", "22K (916)"),
  makeItem("24K GOLD", "gold_jewelry", "24K (999.9)"),
  makeItem("TT BAR", "tt_bar", "24K (999.9)"),
  makeItem("KG BAR", "kg_bar", "24K (999.9)"),
  makeItem("Silver", "silver", ""),
];

function calcItem(item: LineItem, goldRate: number): LineItem {
  const parsedPurity = parseFloat(item.purity);
  const pureWeight = isNaN(parsedPurity) ? 0 : parseFloat((item.grossWeight * parsedPurity).toFixed(4));
  const totalPrice = parseFloat((item.grossWeight * goldRate + item.makingAmt).toFixed(2));
  return { ...item, pureWeight, totalPrice };
}

export default function NewInvoice() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createInvoice = useCreateInvoice();
  const createCustomer = useCreateCustomer();

  const { data: customers } = useListCustomers({}, { query: { queryKey: getListCustomersQueryKey({}) } });
  const { data: prices } = useGetPrices({ query: { queryKey: getGetPricesQueryKey() } });

  const goldRate = prices?.goldPricePerGram ?? 320;

  const [customerId, setCustomerId] = useState<number | undefined>();
  const [customerName, setCustomerName] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPassportNumber, setCustomerPassportNumber] = useState("");
  const [customerEmiratesId, setCustomerEmiratesId] = useState("");
  const [customerNationality, setCustomerNationality] = useState("");
  const [customerCountry, setCustomerCountry] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<InvoiceInputPaymentMethod>(InvoiceInputPaymentMethod.cash);
  const [isPending, setIsPending] = useState(false);
  const [notes, setNotes] = useState("");
  const [metalRate, setMetalRate] = useState<number>(goldRate);
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [vatRate, setVatRate] = useState<number>(5);
  const [roundOffDiscount, setRoundOffDiscount] = useState<number>(0);

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
      setCustomerNationality((customer as any).nationality || "");
      setCustomerCountry((customer as any).country || "");
      setCustomerAddress((customer as any).address || "");
    }
  };

  const addItem = () => {
    setItems(prev => [...prev, {
      id: Math.random().toString(36).substring(7),
      description: "",
      category: "gold_jewelry",
      grossWeight: 0,
      purity: "",
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
      next[index] = calcItem(updated as LineItem, metalRate || goldRate);
      return next;
    });
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const totalBeforeVat = Math.max(0, subtotal);
  const vatAmount = parseFloat((totalBeforeVat * vatRate / 100).toFixed(2));
  const totalIncludingVat = parseFloat((totalBeforeVat + vatAmount - roundOffDiscount).toFixed(2));

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const doCreateInvoice = (resolvedCustomerId?: number) => {
    createInvoice.mutate({
      data: {
        customerId: resolvedCustomerId ?? customerId,
        customerName,
        customerMobile,
        customerEmail,
        customerPassportNumber,
        customerEmiratesId,
        customerNationality,
        customerCountry,
        paymentMethod,
        isPending,
        notes,
        metalRate: metalRate || goldRate,
        placeOfSupply,
        subtotal,
        discount: roundOffDiscount,
        total: totalIncludingVat,
        vatRate,
        vatAmount,
        totalBeforeVat,
        totalIncludingVat,
        roundOffDiscount,
        items: items.map(item => ({
          description: item.description || "-",
          category: item.category,
          quantity: 1,
          grossWeight: item.grossWeight || undefined,
          purity: item.purity || undefined,
          pureWeight: item.pureWeight || undefined,
          makingRate: item.makingRate || undefined,
          makingAmt: item.makingAmt || undefined,
          unitPrice: metalRate || goldRate,
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

  const handleSubmit = () => {
    if (!customerName) {
      toast({ title: "Validation Error", description: "Customer name is required", variant: "destructive" });
      return;
    }

    // If this is a new (not existing) customer, auto-save them to Customers first
    if (!customerId && customerName) {
      createCustomer.mutate({
        data: {
          name: customerName,
          mobile: customerMobile || undefined,
          email: customerEmail || undefined,
          passportNumber: customerPassportNumber || undefined,
          emiratesId: customerEmiratesId || undefined,
          nationality: customerNationality || undefined,
          country: customerCountry || undefined,
          address: customerAddress || undefined,
        }
      }, {
        onSuccess: (newCustomer) => {
          queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey({}) });
          setCustomerId(newCustomer.id);
          doCreateInvoice(newCustomer.id);
        },
        onError: () => {
          // Even if customer save fails, still create the invoice
          doCreateInvoice();
        }
      });
    } else {
      doCreateInvoice();
    }
  };

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

      <div className="space-y-6">
        {/* Invoice Items */}
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
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[120px]">Purity</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[90px]">Pure Wt.</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[110px]">Making Rate</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[120px]">Making Amt. (AED)</th>
                    <th className="py-2.5 px-3 text-center text-xs font-semibold text-white whitespace-nowrap w-[110px]">Total (AED)</th>
                    <th className="w-8 bg-[#1e3a5f]"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id} className="border-b border-border/50 even:bg-muted/20">
                      <td className="py-2 px-3 text-center text-muted-foreground text-sm">{index + 1}</td>
                      <td className="py-2 px-3 min-w-[180px]">
                        <Select
                          value={item.description}
                          onValueChange={val => updateItem(index, "description", val)}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="22K Gold Jewelry">22K Gold Jewelry</SelectItem>
                            <SelectItem value="24K GOLD">24K GOLD</SelectItem>
                            <SelectItem value="TT BAR">TT BAR</SelectItem>
                            <SelectItem value="KG BAR">KG BAR</SelectItem>
                            <SelectItem value="Silver">Silver</SelectItem>
                            <SelectItem value="Gold Jewelry">Gold Jewelry</SelectItem>
                            <SelectItem value="GOLD">GOLD</SelectItem>
                          </SelectContent>
                        </Select>
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
                        <Input
                          placeholder="e.g. 22K, 999"
                          value={item.purity || ""}
                          onChange={e => updateItem(index, "purity", e.target.value)}
                          className="h-8 text-sm text-center"
                        />
                      </td>
                      <td className="py-2 px-3 text-center font-mono text-sm">
                        {item.pureWeight > 0 ? item.pureWeight.toFixed(4) : "—"}
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
                      <td className="py-2 px-3">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.makingAmt || ""}
                          onChange={e => updateItem(index, "makingAmt", parseFloat(e.target.value) || 0)}
                          className="h-8 text-sm text-center"
                        />
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
                  ))}
                </tbody>
              </table>
            </div>

            <Button variant="outline" className="mt-4 w-full border-dashed" onClick={addItem}>
              <Plus className="w-4 h-4 mr-2" /> Add Line Item
            </Button>
          </CardContent>
        </Card>

        {/* Invoice Details + Customer Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Customer Details */}
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
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Nationality</Label>
                  <Select value={customerNationality} onValueChange={setCustomerNationality}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select nationality" />
                    </SelectTrigger>
                    <SelectContent>
                      {["Afghan","Albanian","Algerian","American","Andorran","Angolan","Antiguan","Argentine","Armenian","Australian","Austrian","Azerbaijani","Bahamian","Bahraini","Bangladeshi","Barbadian","Belarusian","Belgian","Belizean","Beninese","Bhutanese","Bolivian","Bosnian","Botswanan","Brazilian","British","Bruneian","Bulgarian","Burkinabe","Burmese","Burundian","Cambodian","Cameroonian","Canadian","Cape Verdean","Central African","Chadian","Chilean","Chinese","Colombian","Comorian","Congolese","Costa Rican","Croatian","Cuban","Cypriot","Czech","Danish","Djiboutian","Dominican","Dutch","East Timorese","Ecuadorian","Egyptian","Emirati","Equatorial Guinean","Eritrean","Estonian","Ethiopian","Fijian","Finnish","French","Gabonese","Gambian","Georgian","German","Ghanaian","Greek","Grenadian","Guatemalan","Guinean","Guinea-Bissauan","Guyanese","Haitian","Honduran","Hungarian","Icelandic","Indian","Indonesian","Iranian","Iraqi","Irish","Israeli","Italian","Ivorian","Jamaican","Japanese","Jordanian","Kazakhstani","Kenyan","Kiribati","Kuwaiti","Kyrgyz","Laotian","Latvian","Lebanese","Lesothan","Liberian","Libyan","Liechtensteiner","Lithuanian","Luxembourger","Malagasy","Malawian","Malaysian","Maldivian","Malian","Maltese","Marshallese","Mauritanian","Mauritian","Mexican","Micronesian","Moldovan","Monacan","Mongolian","Montenegrin","Moroccan","Mozambican","Namibian","Nauruan","Nepali","New Zealander","Nicaraguan","Nigerian","Nigerien","Norwegian","Omani","Pakistani","Palauan","Palestinian","Panamanian","Papua New Guinean","Paraguayan","Peruvian","Filipino","Polish","Portuguese","Qatari","Romanian","Russian","Rwandan","Saint Kitts and Nevisian","Saint Lucian","Saint Vincentian","Samoan","San Marinese","Saudi","Senegalese","Serbian","Sierra Leonean","Singaporean","Slovak","Slovenian","Solomon Islander","Somali","South African","South Korean","South Sudanese","Spanish","Sri Lankan","Sudanese","Surinamese","Swazi","Swedish","Swiss","Syrian","Taiwanese","Tajik","Tanzanian","Thai","Togolese","Tongan","Trinidadian","Tunisian","Turkish","Turkmen","Tuvaluan","Ugandan","Ukrainian","Uruguayan","Uzbek","Vanuatuan","Venezuelan","Vietnamese","Yemeni","Zambian","Zimbabwean"].map(n => (
                        <SelectItem key={n} value={n}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Select value={customerCountry} onValueChange={setCustomerCountry}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {["UAE","India","Pakistan","Bangladesh","Philippines","Egypt","Nepal","Sri Lanka","Jordan","Lebanon","Syria","Iraq","Iran","Kuwait","Saudi Arabia","Qatar","Bahrain","Oman","Yemen","Afghanistan","Ethiopia","Kenya","Nigeria","Ghana","Sudan","Somalia","Tanzania","Uganda","Eritrea","Morocco","Tunisia","Algeria","Libya","South Africa","China","Japan","South Korea","Indonesia","Malaysia","Thailand","Vietnam","Myanmar","USA","UK","Canada","Australia","Germany","France","Italy","Spain","Russia","Turkey","Brazil","Mexico","Argentina"].map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Textarea value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder="Full address..." rows={2} />
              </div>
            </CardContent>
          </Card>

          {/* Payment & Summary */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle>Payment & Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Metal Rate (AED/g)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={metalRate || ""}
                    onChange={e => setMetalRate(parseFloat(e.target.value) || 0)}
                    placeholder={String(goldRate)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Place of Supply</Label>
                  <Input value={placeOfSupply} onChange={e => setPlaceOfSupply(e.target.value)} placeholder="e.g. Dubai" />
                </div>
              </div>

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
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Additional notes..." className="h-16 resize-none" />
              </div>

              {/* VAT Breakdown */}
              <div className="border rounded-md overflow-hidden">
                <div className="p-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Before VAT</span>
                    <span className="font-medium">{fmt(totalBeforeVat)} AED</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span>VAT</span>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        className="w-16 h-7 text-center text-sm px-1"
                        value={vatRate}
                        onChange={e => setVatRate(parseFloat(e.target.value) || 0)}
                      />
                      <span>%</span>
                    </div>
                    <span className="font-medium">+ {fmt(vatAmount)} AED</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Round Off Discount</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-24 h-7 text-right text-sm"
                      value={roundOffDiscount || ""}
                      onChange={e => setRoundOffDiscount(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <div className="flex justify-between px-3 py-2.5 font-bold text-base border-t" style={{ backgroundColor: "#1e3a5f", color: "white" }}>
                  <span>Total Including VAT</span>
                  <span>{fmt(totalIncludingVat)} AED</span>
                </div>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={handleSubmit}
                disabled={createInvoice.isPending}
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
