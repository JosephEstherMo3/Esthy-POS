"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, MessageCircle, Printer } from "lucide-react";
import { Alert, Button, Modal, TextField, useToast } from "@/components/ui";
import { formatDateTime, formatMoney } from "@/lib/money";
import {
  buildReceiptText,
  buildWhatsAppLink,
  discountLabel,
  PAYMENT_LABELS,
  STATUS_LABELS,
  type BusinessInfo,
  type SaleDetail,
} from "@/lib/receipt";

export function ReceiptView({ sale, business, preview }: { sale: SaleDetail; business: BusinessInfo; preview?: boolean }) {
  const money = (v: string | number) => formatMoney(v, sale.currency, business.locale);
  const w = business.receiptWidth;
  const width = w === "58mm" ? "58mm" : w === "a4" ? "150mm" : "80mm";
  const row = "flex items-baseline justify-between gap-3";
  return (
    <div
      data-testid="receipt"
      className={`mx-auto bg-white text-slate-900 ${w === "58mm" ? "text-[11px]" : "text-xs"} leading-snug`}
      style={{ width, maxWidth: "100%", padding: "4mm" }}
    >
      {preview && <p className="mb-2 rounded bg-amber-100 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-amber-900">Preview — not yet saved</p>}
      <div className="text-center">
        {business.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logoUrl} alt={`${business.receiptName} logo`} className="mx-auto mb-2 max-h-14 w-auto object-contain" />
        )}
        <p className="text-base font-bold tracking-tight">{business.receiptName}</p>
        {business.address && <p className="text-slate-600">{business.address}</p>}
        {business.phone && <p className="text-slate-600">{business.phone}</p>}
        {business.email && <p className="text-slate-600">{business.email}</p>}
      </div>

      <hr className="my-2.5 border-dashed border-slate-400" />
      <div className="space-y-0.5">
        <div className={row}><span className="text-slate-600">Receipt</span><span className="font-semibold tabular">{sale.receiptNumber}</span></div>
        <div className={row}><span className="text-slate-600">Date</span><span className="text-right">{formatDateTime(sale.createdAt, business.timezone, business.locale)}</span></div>
        {sale.cashierName && <div className={row}><span className="text-slate-600">Cashier</span><span>{sale.cashierName}</span></div>}
        {sale.customer && <div className={row}><span className="text-slate-600">Customer</span><span>{sale.customer.name}</span></div>}
      </div>
      {sale.status !== "completed" && (
        <p className="mt-2 rounded border border-red-300 py-1 text-center text-[11px] font-bold uppercase tracking-widest text-red-700">{STATUS_LABELS[sale.status]}</p>
      )}

      <hr className="my-2.5 border-dashed border-slate-400" />
      <ul className="space-y-1.5">
        {sale.items.map((it) => (
          <li key={it.id}>
            <p className="font-medium">{it.name}</p>
            <div className={`${row} text-slate-600`}>
              <span className="tabular">{it.quantity} × {money(it.unitPrice)}</span>
              <span className="tabular font-medium text-slate-900">{money(it.lineTotal)}</span>
            </div>
          </li>
        ))}
      </ul>

      <hr className="my-2.5 border-dashed border-slate-400" />
      <div className="space-y-0.5 tabular">
        <div className={row}><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
        {Number(sale.discountAmount) > 0 && <div className={row}><span>{discountLabel(sale)}</span><span>−{money(sale.discountAmount)}</span></div>}
        {Number(sale.taxAmount) > 0 && (
          <div className={row}>
            <span>{business.taxName} ({Number(sale.taxRate)}%{sale.taxInclusive ? ", incl." : ""})</span>
            <span>{money(sale.taxAmount)}</span>
          </div>
        )}
        <div className={`${row} mt-1 border-t border-slate-900 pt-1.5 text-base font-bold`}><span>TOTAL</span><span>{money(sale.total)}</span></div>
      </div>

      <hr className="my-2.5 border-dashed border-slate-400" />
      <div className="space-y-0.5 tabular">
        <div className={row}><span>Payment</span><span>{PAYMENT_LABELS[sale.paymentMethod]}</span></div>
        <div className={row}><span>Amount paid</span><span>{money(sale.amountPaid)}</span></div>
        {Number(sale.changeDue) > 0 && <div className={row}><span>Change</span><span>{money(sale.changeDue)}</span></div>}
        {Number(sale.refundedAmount) > 0 && <div className={`${row} font-semibold text-red-700`}><span>Refunded</span><span>−{money(sale.refundedAmount)}</span></div>}
      </div>

      {business.footer && <p className="mt-4 text-center text-slate-600">{business.footer}</p>}
    </div>
  );
}

/** Print, PDF download and WhatsApp share for a saved receipt. */
export function ReceiptActions({ sale, business }: { sale: SaleDetail; business: BusinessInfo }) {
  const toast = useToast();
  const [printing, setPrinting] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [waOpen, setWaOpen] = useState(false);
  const [phone, setPhone] = useState(sale.customer?.phone ?? "");

  // Render the receipt into a dedicated print-only portal, then open the print dialog.
  useEffect(() => {
    if (!printing) return;
    const id = requestAnimationFrame(() => {
      window.print();
      setPrinting(false);
    });
    return () => cancelAnimationFrame(id);
  }, [printing]);

  async function pdf() {
    setPdfBusy(true);
    try {
      const { downloadReceiptPdf } = await import("@/lib/pdf");
      await downloadReceiptPdf(sale, business);
    } catch {
      toast.error("Could not create the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  const link = buildWhatsAppLink(phone, buildReceiptText(sale, business));
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setPrinting(true)}><Printer className="h-4 w-4" /> Print</Button>
        <Button variant="secondary" onClick={pdf} loading={pdfBusy}><Download className="h-4 w-4" /> PDF</Button>
        <Button variant="secondary" onClick={() => setWaOpen(true)}><MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp</Button>
      </div>
      {printing && createPortal(<div className="print-portal"><ReceiptView sale={sale} business={business} /></div>, document.body)}
      <Modal open={waOpen} onClose={() => setWaOpen(false)} title="Share receipt on WhatsApp" size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setWaOpen(false)}>Close</Button>
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => setTimeout(() => setWaOpen(false), 300)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700">
              <MessageCircle className="h-4 w-4" /> Open WhatsApp
            </a>
          </>
        }>
        <div className="space-y-4">
          <TextField label="Customer phone (optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 2348012345678" hint="Include the country code, digits only. Leave empty to choose the contact inside WhatsApp." />
          <Alert tone="info">
            This opens WhatsApp with the receipt text already typed. <strong>You must press Send inside WhatsApp</strong> — Charlotte Esthy cannot send messages automatically.
          </Alert>
        </div>
      </Modal>
    </>
  );
}
