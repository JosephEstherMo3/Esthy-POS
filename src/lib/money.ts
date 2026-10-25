/**
 * Money helpers. All arithmetic is done in integer minor units (cents) to
 * avoid floating point drift. The server is the source of truth for totals;
 * the browser uses the same functions only for live previews.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export type DiscountType = "none" | "percent" | "fixed";

export const toCents = (value: number | string): number => Math.round(Number(value) * 100);
export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

export interface TotalsInput {
  lines: { unitPriceCents: number; quantity: number }[];
  discountType: DiscountType;
  /** percent: 0–100 (max 2dp). fixed: amount in major units. */
  discountValue: number;
  /** Tax rate in percent, e.g. 7.5 */
  taxRatePercent: number;
  taxInclusive: boolean;
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export function calculateTotals(input: TotalsInput): Totals {
  let subtotalCents = 0;
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new MoneyError("Quantity must be a positive whole number");
    if (!Number.isInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw new MoneyError("Invalid unit price");
    subtotalCents += l.unitPriceCents * l.quantity;
  }

  let discountCents = 0;
  if (input.discountType === "percent") {
    if (!(input.discountValue >= 0 && input.discountValue <= 100)) throw new MoneyError("Discount percentage must be between 0 and 100");
    discountCents = Math.round((subtotalCents * Math.round(input.discountValue * 100)) / 10000);
  } else if (input.discountType === "fixed") {
    if (!(input.discountValue >= 0)) throw new MoneyError("Discount cannot be negative");
    discountCents = toCents(input.discountValue);
    if (discountCents > subtotalCents) throw new MoneyError("Discount cannot exceed the subtotal");
  }

  if (!(input.taxRatePercent >= 0 && input.taxRatePercent <= 100)) throw new MoneyError("Invalid tax rate");
  const afterDiscount = subtotalCents - discountCents;
  const rateBps = Math.round(input.taxRatePercent * 100);

  let taxCents: number;
  let totalCents: number;
  if (input.taxInclusive) {
    taxCents = afterDiscount - Math.round((afterDiscount * 10000) / (10000 + rateBps));
    totalCents = afterDiscount;
  } else {
    taxCents = Math.round((afterDiscount * rateBps) / 10000);
    totalCents = afterDiscount + taxCents;
  }
  return { subtotalCents, discountCents, taxCents, totalCents };
}

export function calculateChange(totalCents: number, tenderedCents: number): number {
  if (!Number.isInteger(tenderedCents) || tenderedCents < 0) throw new MoneyError("Invalid amount received");
  if (tenderedCents < totalCents) throw new MoneyError("Amount received is less than the total due");
  return tenderedCents - totalCents;
}

// ───────────── Formatting ─────────────

export function formatMoney(
  value: number | string | null | undefined,
  currency = "NGN",
  locale = "en-NG",
  display: "symbol" | "code" = "symbol",
): string {
  const n = Number(value ?? 0);
  try {
    const out = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: display }).format(n);
    return out.replace(/\u00a0/g, " ");
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatDateTime(iso: string | Date, timeZone = "UTC", locale = "en-US"): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString();
  }
}

export function formatDate(iso: string | Date, timeZone = "UTC", locale = "en-US"): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

/** Current calendar date (YYYY-MM-DD) in the given IANA timezone. */
export function todayInTz(timeZone = "UTC", now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR", "UGX", "TZS", "XOF", "CAD", "AUD", "INR", "AED"] as const;
