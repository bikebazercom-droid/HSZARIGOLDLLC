import React from "react";
import { Link, useParams } from "wouter";
import { useGetInvoice, getGetInvoiceQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

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

  const fmt = (n: number | null | undefined) =>
    (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmt4 = (n: number | null | undefined) =>
    n != null ? n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : "-";

  const paymentLabel =
    invoice.paymentMethod === "cash"
      ? "Cash Customer"
      : invoice.paymentMethod === "card"
      ? "Card Payment"
      : "Bank Transfer";

  // Determine if items use the gold weight model
  const hasWeightData = invoice.items?.some(i => i.grossWeight != null);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20 print:p-0 print:m-0 print:max-w-none">
      <div className="flex justify-between items-center no-print">
        <div className="flex items-center gap-4">
          <Link href="/invoices">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Invoice #{invoice.invoiceNumber}</h1>
        </div>
        <Button onClick={() => window.print()}><Printer className="w-4 h-4 mr-2" /> Print Invoice</Button>
      </div>

      <div className="bg-white text-black p-10 border rounded-sm shadow-sm print:border-none print:shadow-none print:p-6">

        {/* Header */}
        <div className="flex justify-between items-start border-b-2 border-gray-800 pb-6 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#b8860b] mb-1 tracking-wide">AL WAJEEH GOLD AND JEWELLERY</h1>
            <p className="text-xs text-gray-600">Gold Souk, Deira, Dubai, United Arab Emirates</p>
            <p className="text-xs text-gray-600">Tel: +971 4 123 4567 &nbsp;|&nbsp; TRN: 100XXXXXXX00003</p>
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-bold text-gray-300 uppercase tracking-widest mb-2">TAX INVOICE</h2>
            <p className="text-sm font-medium">Invoice No: <span className="text-gray-900 font-bold">{invoice.invoiceNumber}</span></p>
            <p className="text-sm font-medium">Date: <span className="text-gray-900">{format(new Date(invoice.createdAt), "dd MMM yyyy, hh:mm a")}</span></p>
          </div>
        </div>

        {/* Customer + Payment */}
        <div className="grid grid-cols-2 gap-8 mb-6">
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Bill To:</h3>
            <p className="font-bold text-base">{invoice.customerName || "Walk-in Customer"}</p>
            {invoice.customerMobile && <p className="text-xs mt-1">Mobile: {invoice.customerMobile}</p>}
            {invoice.customerEmail && <p className="text-xs">Email: {invoice.customerEmail}</p>}
            {invoice.customerPassportNumber && <p className="text-xs mt-1">Passport No: {invoice.customerPassportNumber}</p>}
            {invoice.customerEmiratesId && <p className="text-xs">Emirates ID: {invoice.customerEmiratesId}</p>}
          </div>
          <div className="text-right">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Payment:</h3>
            <div className="inline-block px-3 py-1 rounded border-2 border-gray-300 font-bold uppercase tracking-wider text-sm">
              {paymentLabel}
            </div>
            {invoice.isPending && (
              <div className="mt-2">
                <span className="px-3 py-1 rounded border-2 border-red-400 text-red-600 font-bold uppercase text-xs inline-block">
                  Payment Pending
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Items Table */}
        {hasWeightData ? (
          <table className="w-full mb-6 text-xs border-collapse">
            <thead>
              <tr className="border-y-2 border-gray-700 bg-gray-50">
                <th className="py-2 px-2 text-left font-bold">S.No</th>
                <th className="py-2 px-2 text-left font-bold">Description</th>
                <th className="py-2 px-2 text-right font-bold">Gross Wt (g)</th>
                <th className="py-2 px-2 text-right font-bold">Purity</th>
                <th className="py-2 px-2 text-right font-bold">Pure Wt (g)</th>
                <th className="py-2 px-2 text-right font-bold">Making Rate</th>
                <th className="py-2 px-2 text-right font-bold">Making Amt AED</th>
                <th className="py-2 px-2 text-right font-bold">Total AED</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items?.map((item, index) => (
                <tr key={item.id} className="border-b border-gray-200">
                  <td className="py-2.5 px-2">{index + 1}</td>
                  <td className="py-2.5 px-2 font-medium">
                    {item.description}
                    {item.category && (
                      <span className="block text-gray-400 text-xs capitalize">{item.category.replace(/_/g, " ")}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono">{fmt4(item.grossWeight)}</td>
                  <td className="py-2.5 px-2 text-right font-mono">{fmt4(item.purity)}</td>
                  <td className="py-2.5 px-2 text-right font-mono">{fmt4(item.pureWeight)}</td>
                  <td className="py-2.5 px-2 text-right font-mono">{fmt4(item.makingRate)}</td>
                  <td className="py-2.5 px-2 text-right font-mono">{fmt(item.makingAmt)}</td>
                  <td className="py-2.5 px-2 text-right font-bold font-mono">{fmt(item.totalPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full mb-6 text-xs border-collapse">
            <thead>
              <tr className="border-y-2 border-gray-700 bg-gray-50">
                <th className="py-2 px-2 text-left font-bold">Sr.No</th>
                <th className="py-2 px-2 text-left font-bold">Description</th>
                <th className="py-2 px-2 text-center font-bold">Qty</th>
                <th className="py-2 px-2 text-right font-bold">Weight (g)</th>
                <th className="py-2 px-2 text-right font-bold">Unit Price (AED)</th>
                <th className="py-2 px-2 text-right font-bold">Total AED</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items?.map((item, index) => (
                <tr key={item.id} className="border-b border-gray-200">
                  <td className="py-2.5 px-2">{index + 1}</td>
                  <td className="py-2.5 px-2 font-medium">
                    {item.description}
                    {item.category && (
                      <span className="block text-gray-400 text-xs capitalize">{item.category.replace(/_/g, " ")}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-2 text-center">{item.quantity}</td>
                  <td className="py-2.5 px-2 text-right">{item.weight ?? "-"}</td>
                  <td className="py-2.5 px-2 text-right">{fmt(item.unitPrice)}</td>
                  <td className="py-2.5 px-2 text-right font-bold">{fmt(item.totalPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Totals */}
        <div className="flex justify-between items-start">
          <div className="w-1/2">
            {invoice.notes && (
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase mb-1">Notes</p>
                <p className="text-xs text-gray-700 whitespace-pre-wrap">{invoice.notes}</p>
              </div>
            )}
          </div>
          <div className="w-[280px]">
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className="py-2 text-gray-600">Subtotal</td>
                  <td className="py-2 text-right font-medium">{fmt(invoice.subtotal)} AED</td>
                </tr>
                {invoice.discount && invoice.discount > 0 ? (
                  <tr>
                    <td className="py-2 text-gray-600">Discount</td>
                    <td className="py-2 text-right text-red-600">-{fmt(invoice.discount)} AED</td>
                  </tr>
                ) : null}
                <tr className="border-t-2 border-gray-800">
                  <td className="py-3 font-bold text-base">Grand Total</td>
                  <td className="py-3 text-right font-bold text-base">AED {fmt(invoice.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-gray-200 text-center text-xs text-gray-400">
          <p>Thank you for your business with AL WAJEEH GOLD AND JEWELLERY.</p>
          <p className="mt-1">Goods once sold will not be returned or exchanged without the original invoice.</p>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}
