import React from "react";
import { Link, useParams } from "wouter";
import { useGetInvoice, getGetInvoiceQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function InvoiceDetail() {
  const params = useParams();
  const id = parseInt(params.id || "0");
  
  const { data: invoice, isLoading } = useGetInvoice(id, {
    query: { queryKey: getGetInvoiceQueryKey(id), enabled: !!id }
  });

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-96" /></div>;
  }

  if (!invoice) {
    return <div className="p-8">Invoice not found</div>;
  }

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 print:p-0 print:m-0 print:max-w-none">
      <div className="flex justify-between items-center no-print">
        <div className="flex items-center gap-4">
          <Link href="/invoices">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Invoice #{invoice.invoiceNumber}</h1>
        </div>
        <Button onClick={handlePrint}><Printer className="w-4 h-4 mr-2" /> Print Invoice</Button>
      </div>

      <div className="bg-white text-black p-10 border rounded-sm shadow-sm print:border-none print:shadow-none print:p-0">
        <div className="flex justify-between items-start border-b pb-8 mb-8">
          <div>
            <h1 className="text-2xl font-serif font-bold text-[#b8860b] mb-1">AL WAJEEH GOLD AND JEWELLERY</h1>
            <p className="text-sm text-gray-600">Gold Souk, Deira</p>
            <p className="text-sm text-gray-600">Dubai, United Arab Emirates</p>
            <p className="text-sm text-gray-600">Tel: +971 4 123 4567 | TRN: 100XXXXXXX00003</p>
          </div>
          <div className="text-right">
            <h2 className="text-3xl font-bold text-gray-300 uppercase tracking-widest mb-2">TAX INVOICE</h2>
            <p className="font-medium">Invoice No: <span className="text-gray-900">{invoice.invoiceNumber}</span></p>
            <p className="font-medium">Date: <span className="text-gray-900">{format(new Date(invoice.createdAt), "dd MMM yyyy, hh:mm a")}</span></p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase mb-3">Bill To:</h3>
            <p className="font-bold text-lg">{invoice.customerName || "Walk-in Customer"}</p>
            {invoice.customerMobile && <p className="text-sm mt-1">Mobile: {invoice.customerMobile}</p>}
            {invoice.customerEmail && <p className="text-sm">Email: {invoice.customerEmail}</p>}
            {invoice.customerPassportNumber && <p className="text-sm mt-1">Passport No: {invoice.customerPassportNumber}</p>}
            {invoice.customerEmiratesId && <p className="text-sm">Emirates ID: {invoice.customerEmiratesId}</p>}
          </div>
          <div className="text-right">
            <h3 className="text-sm font-bold text-gray-500 uppercase mb-3">Payment Info:</h3>
            <div className="inline-block px-3 py-1 rounded border-2 border-gray-200 font-bold uppercase tracking-wider text-sm">
              {invoice.paymentMethod === 'cash' ? 'Cash Payment' : invoice.paymentMethod === 'card' ? 'Card Payment' : 'Bank Transfer'}
            </div>
            {invoice.isPending && (
              <div className="mt-2 text-red-600 font-bold uppercase text-sm border-2 border-red-200 inline-block px-3 py-1 rounded">
                Payment Pending
              </div>
            )}
          </div>
        </div>

        <table className="w-full mb-8 text-sm">
          <thead>
            <tr className="border-y-2 border-gray-300 bg-gray-50">
              <th className="py-3 px-2 text-left font-bold">Sr.No</th>
              <th className="py-3 px-2 text-left font-bold">Description</th>
              <th className="py-3 px-2 text-center font-bold">Qty</th>
              <th className="py-3 px-2 text-right font-bold">Weight (g)</th>
              <th className="py-3 px-2 text-right font-bold">Unit Price (AED)</th>
              <th className="py-3 px-2 text-right font-bold">Total (AED)</th>
            </tr>
          </thead>
          <tbody>
            {invoice.items?.map((item, index) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="py-3 px-2">{index + 1}</td>
                <td className="py-3 px-2 font-medium">
                  {item.description}
                  {item.category && (
                    <span className="block text-xs text-gray-500 capitalize">{item.category.replace('_', ' ')}</span>
                  )}
                </td>
                <td className="py-3 px-2 text-center">{item.quantity}</td>
                <td className="py-3 px-2 text-right">{item.weight || "-"}</td>
                <td className="py-3 px-2 text-right">{item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="py-3 px-2 text-right font-medium">{item.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-between items-start">
          <div className="w-1/2">
            {invoice.notes && (
              <div className="mt-4">
                <p className="text-xs font-bold text-gray-500 uppercase mb-1">Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{invoice.notes}</p>
              </div>
            )}
          </div>
          
          <div className="w-[300px]">
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-2 text-gray-600">Subtotal</td>
                  <td className="py-2 text-right font-medium">{invoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
                {invoice.discount && invoice.discount > 0 ? (
                  <tr>
                    <td className="py-2 text-gray-600">Discount</td>
                    <td className="py-2 text-right text-red-600">-{invoice.discount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  </tr>
                ) : null}
                <tr className="border-t-2 border-gray-800 text-lg">
                  <td className="py-3 font-bold">Grand Total</td>
                  <td className="py-3 text-right font-bold">AED {invoice.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-gray-200 text-center text-xs text-gray-500">
          <p>Thank you for your business.</p>
          <p>Goods once sold will not be returned or exchanged without the original invoice.</p>
        </div>
      </div>
    </div>
  );
}
