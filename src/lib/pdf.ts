"use client";

import type { jsPDF } from "jspdf";
import { formatDateTime, formatMoney } from "@/lib/money";
import { discountLabel, PAYMENT_LABELS, STATUS_LABELS, type BusinessInfo, type SaleDetail } from "@/lib/receipt";
import { ATTRIBUTION } from "@/components/brand";

/** Draws the receipt onto `doc` and returns the final y position (mm). */
function drawReceipt(doc: jsPDF, sale: SaleDetail, business: BusinessInfo, layout: { left: number; width: number; base: number }): number {
  const { left, width, base } = layout;
  const cx = left + width / 2;
  const lh = base * 0.42;
  const money = (v: string | number) => formatMoney(v, sale.currency, business.locale, "code");
  let y = 8;
  const font = (size: number, style: "normal" | "bold" = "normal") => {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
  };
  const center = (text: string, size = base, style: "normal" | "bold" = "normal", color = 20) => {
    font(size, style);
    doc.setTextColor(color);
    for (const l of doc.splitTextToSize(text, width) as string[]) {
      doc.text(l, cx, y, { align: "center" });
      y += size * 0.43;
    }
  };
  const row = (l: string, r: string, style: "normal" | "bold" = "normal", size = base) => {
    font(size, style);
    doc.setTextColor(20);
    const leftLines = doc.splitTextToSize(l, width * 0.62) as string[];
    doc.text(leftLines, left, y);
    doc.text(r, left + width, y, { align: "right" });
    y += Math.max(leftLines.length, 1) * size * 0.43;
  };
  const rule = () => {
    doc.setDrawColor(160);
    doc.setLineDashPattern([0.7, 0.7], 0);
    doc.line(left, y, left + width, y);
    doc.setLineDashPattern([], 0);
    y += lh * 0.9;
  };

  if (business.logoUrl) {
    try {
      const fmt = business.logoUrl.startsWith("data:image/png") ? "PNG" : business.logoUrl.startsWith("data:image/webp") ? "WEBP" : "JPEG";
      const props = doc.getImageProperties(business.logoUrl);
      const h = Math.min(16, width * 0.28);
      const w = (props.width / props.height) * h;
      doc.addImage(business.logoUrl, fmt, cx - w / 2, y - 2, w, h);
      y += h + 2;
    } catch {
      /* logo is optional — ignore unreadable images */
    }
  }
  center(business.receiptName, base + 3, "bold");
  y += 0.5;
  for (const l of [business.address, business.phone, business.email]) if (l) center(l, base - 1.5, "normal", 90);
  y += 1.5;
  rule();
  row("Receipt", sale.receiptNumber, "bold");
  row("Date", formatDateTime(sale.createdAt, business.timezone, business.locale));
  if (sale.cashierName) row("Cashier", sale.cashierName);
  if (sale.customer) row("Customer", sale.customer.name);
  if (sale.status !== "completed") row("Status", STATUS_LABELS[sale.status] ?? sale.status, "bold");
  rule();
  for (const it of sale.items) {
    font(base, "bold");
    doc.setTextColor(20);
    const lines = doc.splitTextToSize(it.name, width) as string[];
    doc.text(lines, left, y);
    y += lines.length * base * 0.43;
    row(`${it.quantity} x ${money(it.unitPrice)}`, money(it.lineTotal), "normal", base - 0.5);
    y += 0.6;
  }
  rule();
  row("Subtotal", money(sale.subtotal));
  if (Number(sale.discountAmount) > 0) row(discountLabel(sale), `-${money(sale.discountAmount)}`);
  if (Number(sale.taxAmount) > 0) row(`${business.taxName} ${Number(sale.taxRate)}%${sale.taxInclusive ? " (incl.)" : ""}`, money(sale.taxAmount));
  y += 0.8;
  row("TOTAL", money(sale.total), "bold", base + 2.5);
  y += 0.8;
  rule();
  row("Payment", PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod);
  row("Amount paid", money(sale.amountPaid));
  if (Number(sale.changeDue) > 0) row("Change", money(sale.changeDue));
  if (Number(sale.refundedAmount) > 0) row("Refunded", `-${money(sale.refundedAmount)}`, "bold");
  y += 2;
  if (business.footer) center(business.footer, base, "normal", 60);
  return y;
}

export async function downloadReceiptPdf(sale: SaleDetail, business: BusinessInfo) {
  const { jsPDF } = await import("jspdf");
  const w = business.receiptWidth;
  const layout =
    w === "58mm"
      ? { pageW: 58, left: 4, width: 50, base: 7.5 }
      : w === "a4"
        ? { pageW: 210, left: 50, width: 110, base: 10 }
        : { pageW: 80, left: 5, width: 70, base: 8.5 };
  const probe = new jsPDF({ unit: "mm", format: [layout.pageW, 3000] });
  const height = drawReceipt(probe, sale, business, layout) + 8;
  const doc = new jsPDF({ unit: "mm", format: [layout.pageW, Math.max(height, w === "a4" ? 297 : 60)] });
  drawReceipt(doc, sale, business, layout);
  doc.save(`receipt-${sale.receiptNumber}.pdf`);
}

export interface PdfSection {
  title: string;
  head: string[];
  rows: string[][];
}

/** Generic report PDF: summary key/values followed by one table per section. */
export async function downloadTablesPdf(opts: { filename: string; title: string; subtitle: string; summary: [string, string][]; sections: PdfSection[] }) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const last = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(20, 29, 61);
  doc.text(opts.title, 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(opts.subtitle, 14, 24);

  autoTable(doc, {
    startY: 30,
    body: opts.summary,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 60 } },
  });
  let y = last() + 8;
  for (const s of opts.sections) {
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20, 29, 61);
    doc.text(s.title, 14, y);
    autoTable(doc, {
      startY: y + 2,
      head: [s.head],
      body: s.rows.length ? s.rows : [["No data for this period", ...s.head.slice(1).map(() => "")]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [20, 29, 61] },
      alternateRowStyles: { fillColor: [245, 246, 248] },
    });
    y = last() + 10;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Charlotte Esthy · ${ATTRIBUTION}`, 14, 289);
    doc.text(`Page ${i} of ${pages}`, 196, 289, { align: "right" });
  }
  doc.save(opts.filename);
}
