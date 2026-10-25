import { formatDateTime, formatMoney } from "@/lib/money";

/** Shared receipt types and pure helpers (used by server, UI, PDF and tests). */

export interface BusinessInfo {
  name: string;
  receiptName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  footer: string;
  receiptWidth: string;
  currency: string;
  locale: string;
  timezone: string;
  taxName: string;
}

export interface SaleItemDetail {
  id: string;
  productId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  refundedQuantity: number;
}

export interface RefundDetail {
  id: string;
  kind: "refund" | "void";
  amount: string;
  reason: string;
  restocked: boolean;
  createdAt: string;
  createdByName: string | null;
}

export interface SaleDetail {
  id: string;
  receiptNumber: string;
  status: "completed" | "partially_refunded" | "refunded" | "voided";
  createdAt: string;
  currency: string;
  subtotal: string;
  discountType: "none" | "percent" | "fixed";
  discountValue: string;
  discountAmount: string;
  taxRate: string;
  taxInclusive: boolean;
  taxAmount: string;
  total: string;
  amountPaid: string;
  changeDue: string;
  paymentMethod: "cash" | "transfer" | "card";
  refundedAmount: string;
  note: string | null;
  cashierName: string | null;
  customer: { id: string; name: string; phone: string | null; email: string | null } | null;
  items: SaleItemDetail[];
  refunds: RefundDetail[];
}

export const PAYMENT_LABELS: Record<string, string> = { cash: "Cash", transfer: "Bank transfer", card: "Card" };

export const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  voided: "Cancelled",
};

export function formatReceiptNumber(prefix: string, padding: number, seq: number): string {
  return `${prefix}${String(seq).padStart(Math.max(1, padding), "0")}`;
}

export function discountLabel(sale: Pick<SaleDetail, "discountType" | "discountValue">): string {
  if (sale.discountType === "percent") return `Discount (${Number(sale.discountValue)}%)`;
  return "Discount";
}

/** Digits only, as required by wa.me links. */
export function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

export function buildReceiptText(sale: SaleDetail, business: BusinessInfo): string {
  const money = (v: string | number) => formatMoney(v, sale.currency, business.locale, "code");
  const lines: string[] = [];
  lines.push(`*${business.receiptName}*`);
  lines.push(`Receipt ${sale.receiptNumber}`);
  lines.push(formatDateTime(sale.createdAt, business.timezone, business.locale));
  lines.push("");
  for (const it of sale.items) lines.push(`${it.quantity} x ${it.name} — ${money(it.lineTotal)}`);
  lines.push("");
  if (Number(sale.discountAmount) > 0) lines.push(`Discount: -${money(sale.discountAmount)}`);
  if (Number(sale.taxAmount) > 0) lines.push(`${business.taxName}: ${money(sale.taxAmount)}`);
  lines.push(`*Total: ${money(sale.total)}*`);
  lines.push(`Paid by ${PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}`);
  if (business.footer) {
    lines.push("");
    lines.push(business.footer);
  }
  return lines.join("\n");
}

/**
 * Builds a wa.me share link. This only opens WhatsApp with a pre-filled
 * message — the user must still press "Send" inside WhatsApp.
 */
export function buildWhatsAppLink(phone: string | null | undefined, text: string): string {
  const digits = normalizePhone(phone);
  const base = digits ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

// ───────────── CSV ─────────────

/** Escapes a CSV cell and neutralises spreadsheet formula injection. */
export function csvEscape(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(",")).join("\r\n");
}
