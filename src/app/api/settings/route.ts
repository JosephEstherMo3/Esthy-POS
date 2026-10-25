import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { businesses, businessSettings } from "@/db/schema";
import { HttpError, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { currencyField, imageField, isValidLocale, isValidTimezone, optEmail, optText } from "@/lib/validation";

export const GET = route({ permission: "settings.manage" }, async ({ auth }) => {
  const [r] = await db
    .select({ name: businesses.name, s: businessSettings })
    .from(businesses)
    .innerJoin(businessSettings, eq(businessSettings.businessId, businesses.id))
    .where(eq(businesses.id, auth.business.id));
  if (!r) throw new HttpError(404, "Business not found");
  const { updatedAt: _u, businessId: _b, ...settings } = r.s;
  void _u;
  void _b;
  return { businessName: r.name, ...settings };
});

const schema = z.object({
  businessName: z.string().trim().min(2, "Business name is required").max(100).optional(),
  receiptBusinessName: z.string().trim().min(1, "Receipt name is required").max(100).optional(),
  address: optText(250),
  phone: optText(40),
  email: optEmail,
  logoUrl: imageField,
  currency: currencyField.optional(),
  locale: z.string().trim().refine(isValidLocale, "Invalid locale (example: en-US)").optional(),
  timezone: z.string().trim().refine(isValidTimezone, "Unknown timezone").optional(),
  taxName: z.string().trim().min(1).max(30).optional(),
  taxRate: z.number("Enter a valid tax rate").min(0, "Tax rate cannot be negative").max(100, "Tax rate cannot exceed 100%").optional(),
  taxInclusive: z.boolean().optional(),
  receiptPrefix: z.string().trim().max(12).regex(/^[A-Za-z0-9\-_/]*$/, "Use letters, numbers, - _ or / only").optional(),
  receiptPadding: z.number().int().min(1).max(10).optional(),
  nextReceiptNumber: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  receiptFooter: z.string().trim().max(200).optional(),
  receiptWidth: z.enum(["58mm", "80mm", "a4"]).optional(),
  defaultLowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
  allowNegativeStock: z.boolean().optional(),
});

export const PATCH = route({ permission: "settings.manage" }, async ({ req, auth }) => {
  const input = await readJson(req, schema);
  const biz = auth.business.id;
  const { businessName, taxRate, ...rest } = input;

  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(businessSettings).where(eq(businessSettings.businessId, biz)).for("update");
    if (!current) throw new HttpError(404, "Business not found");
    if (rest.nextReceiptNumber !== undefined && rest.nextReceiptNumber < current.nextReceiptNumber) {
      throw new HttpError(400, `The next receipt number cannot be lower than the current one (${current.nextReceiptNumber}) — that could create duplicate receipts.`, {
        nextReceiptNumber: `Must be at least ${current.nextReceiptNumber}`,
      });
    }
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) set[k] = v;
    if (taxRate !== undefined) set.taxRate = taxRate.toFixed(2);
    await tx.update(businessSettings).set(set).where(eq(businessSettings.businessId, biz));
    if (businessName) await tx.update(businesses).set({ name: businessName }).where(eq(businesses.id, biz));
    const changed = Object.keys(input).filter((k) => k !== "logoUrl");
    await audit(tx, {
      businessId: biz,
      userId: auth.user.id,
      action: "settings.updated",
      entityType: "settings",
      entityId: biz,
      metadata: { changed: input.logoUrl !== undefined ? [...changed, "logoUrl"] : changed },
    });
  });
  return { ok: true };
});
