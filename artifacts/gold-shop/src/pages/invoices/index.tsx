import React, { useState } from "react";
import { Link } from "wouter";
import { useListInvoices, getListInvoicesQueryKey, useDeleteInvoice } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Trash2, Eye } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/auth";

export default function Invoices() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const { data: invoices, isLoading } = useListInvoices(
    { search: search || undefined },
    { query: { queryKey: getListInvoicesQueryKey({ search: search || undefined }) } }
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteInvoice = useDeleteInvoice();

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this invoice?")) {
      deleteInvoice.mutate({ id }, {
        onSuccess: () => {
          toast({ title: "Invoice deleted successfully" });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to delete invoice", variant: "destructive" });
        }
      });
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight text-primary">Invoices</h1>
        <Link href="/invoices/new">
          <Button><Plus className="w-4 h-4 mr-2" /> Create Invoice</Button>
        </Link>
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input 
            placeholder="Search by invoice # or customer..." 
            className="pl-9" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-card rounded-md border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Payment Method</TableHead>
              <TableHead className="text-right">Total (AED)</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">Loading...</TableCell>
              </TableRow>
            ) : invoices?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No invoices found.
                </TableCell>
              </TableRow>
            ) : (
              invoices?.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-medium">
                    <Link href={`/invoices/${invoice.id}`} className="hover:underline text-primary">
                      {invoice.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(invoice.createdAt), "MMM d, yyyy HH:mm")}
                  </TableCell>
                  <TableCell>
                    {invoice.customerName || "Walk-in Customer"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={invoice.paymentMethod === 'cash' ? 'default' : invoice.paymentMethod === 'card' ? 'secondary' : 'outline'}>
                      {invoice.paymentMethod === 'cash' ? 'Cash Customer' : invoice.paymentMethod === 'card' ? 'Card Payment' : 'Bank Transfer'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {invoice.total?.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link href={`/invoices/${invoice.id}`}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      {isAdmin && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(invoice.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
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
