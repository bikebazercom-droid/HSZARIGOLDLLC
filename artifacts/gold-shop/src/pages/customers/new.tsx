import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateCustomer } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  mobile: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  passportNumber: z.string().optional(),
  emiratesId: z.string().optional(),
  nationality: z.string().optional(),
  address: z.string().optional(),
  country: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewCustomer() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createCustomer = useCreateCustomer();
  const [idType, setIdType] = useState<"passport" | "emirates">("passport");
  const [idValue, setIdValue] = useState("");

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", mobile: "", email: "",
      passportNumber: "", emiratesId: "",
      nationality: "", address: "", country: "",
    },
  });

  function onSubmit(values: FormValues) {
    const payload: FormValues = {
      ...values,
      passportNumber: idType === "passport" ? idValue : "",
      emiratesId: idType === "emirates" ? idValue : "",
    };
    createCustomer.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({ title: "Customer added successfully" });
          setLocation("/customers");
        },
        onError: (err: any) => {
          toast({ title: "Error adding customer", description: err.message, variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/customers">
          <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-primary">New Customer</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer Details</CardTitle>
          <CardDescription>Add a new customer to your database.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name *</FormLabel>
                    <FormControl><Input placeholder="John Doe" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="mobile" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mobile Number</FormLabel>
                    <FormControl><Input placeholder="+971 50 123 4567" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl><Input type="email" placeholder="john@example.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="nationality" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nationality</FormLabel>
                    <FormControl><Input placeholder="e.g. Indian" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                {/* ID Type selector + value input */}
                <div className="md:col-span-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium leading-none">ID Type</label>
                      <Select value={idType} onValueChange={v => { setIdType(v as "passport" | "emirates"); setIdValue(""); }}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="passport">Passport No.</SelectItem>
                          <SelectItem value="emirates">Emirates ID</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium leading-none">
                        {idType === "passport" ? "Passport Number" : "Emirates ID Number"}
                      </label>
                      <Input
                        value={idValue}
                        onChange={e => setIdValue(e.target.value)}
                        placeholder={idType === "passport" ? "e.g. A1234567" : "784-XXXX-XXXXXXX-X"}
                      />
                    </div>
                  </div>
                </div>

                <FormField control={form.control} name="address" render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Address</FormLabel>
                    <FormControl><Input placeholder="Full Address" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="country" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl><Input placeholder="United Arab Emirates" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="flex justify-end gap-4 pt-4 border-t">
                <Link href="/customers">
                  <Button type="button" variant="outline">Cancel</Button>
                </Link>
                <Button type="submit" disabled={createCustomer.isPending}>
                  {createCustomer.isPending ? "Saving..." : "Save Customer"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
