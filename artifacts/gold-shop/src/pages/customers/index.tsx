import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { useListCustomers, getListCustomersQueryKey, useDeleteCustomer } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Trash2, Edit } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

function fmtAED(n: number | undefined | null): string {
  return (n ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Customers() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: customers, isLoading, isFetching } = useListCustomers(
    { search: debouncedSearch || undefined },
    { query: { queryKey: getListCustomersQueryKey({ search: debouncedSearch || undefined }) } }
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteCustomer = useDeleteCustomer();

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this customer?")) {
      deleteCustomer.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Customer deleted successfully" });
          queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to delete customer", variant: "destructive" });
        }
      });
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight text-primary">Customers</h1>
        <Link href="/customers/new">
          <Button><Plus className="w-4 h-4 mr-2" /> Add Customer</Button>
        </Link>
      </div>

      <div className="max-w-xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search by Name, Phone, Passport, or Emirates ID..."
            className="pl-9 h-11 text-base"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-card rounded-md border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>ID / Passport</TableHead>
              <TableHead>Nationality</TableHead>
              <TableHead className="text-right">Total Invoices</TableHead>
              <TableHead className="text-right">Total Spent (AED)</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">Loading...</TableCell>
              </TableRow>
            ) : customers?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {search ? `No customers found matching "${search}".` : "No customers found."}
                </TableCell>
              </TableRow>
            ) : (
              customers?.map((customer) => (
                <TableRow key={customer.id} className={isFetching ? "opacity-60" : undefined}>
                  <TableCell className="font-medium">
                    <Link href={`/customers/${customer.id}`} className="hover:underline text-primary">
                      {customer.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{customer.mobile || "-"}</div>
                    <div className="text-xs text-muted-foreground">{customer.email || ""}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{customer.emiratesId || "-"}</div>
                    <div className="text-xs text-muted-foreground">{customer.passportNumber || ""}</div>
                  </TableCell>
                  <TableCell>{customer.nationality || "-"}</TableCell>
                  <TableCell className="text-right">{customer.invoiceCount}</TableCell>
                  <TableCell className="text-right">AED {fmtAED(customer.totalSpent)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(customer.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link href={`/customers/${customer.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Edit className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(customer.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
