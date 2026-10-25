import { z } from "zod";
import { CURRENCIES } from "@/lib/money";

/** Shared server-side input schemas. */

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .refine((v) => z.email().safeParse(v).success, "Enter a valid email address");

export const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");

export const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid date");

/** Money in major units → fixed 2dp string. */
export const moneyField = z
  .number("Enter a valid amount")
  .finite()
  .min(0, "Amount cannot be negative")
  .max(999_999_999, "Amount is too large")
  .transform((n) => (Math.round(n * 100) / 100).toFixed(2));

/** Optional text: undefined = not provided, null/"" = cleared. */
export const optText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));

export const optEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullish()
  .refine((v) => !v || z.email().safeParse(v).success, "Enter a valid email address")
  .transform((v) => (v === undefined ? undefined : v || null));

export const imageField = z
  .string()
  .max(250_000, "Image is too large")
  .nullish()
  .refine(
    (v) => !v || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) || /^https:\/\/\S+$/.test(v),
    "Image must be an uploaded PNG/JPEG/WebP or an https URL",
  )
  .transform((v) => (v === undefined ? undefined : v || null));

export const uuidField = z.uuid("Invalid id");

export const customerSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(120),
  phone: optText(30),
  email: optEmail,
  notes: optText(500),
});

export const currencyField = z.enum(CURRENCIES);

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidLocale(l: string): boolean {
  try {
    new Intl.NumberFormat(l);
    return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l);
  } catch {
    return false;
  }
}

export const rangeQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  bucket: z.enum(["day", "week", "month"]).default("day"),
});
