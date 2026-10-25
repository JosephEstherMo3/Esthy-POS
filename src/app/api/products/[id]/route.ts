import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { products } from "@/db/schema";
import { HttpError, parseId, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { resolveCategoryId } from "@/lib/services/catalog";
import { imageField, moneyField, optText } from "@/lib/validation";

const patchSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(120).optional(),
  sku: optText(64),
  barcode: optText(64),
  categoryName: optText(60),
  description: optText(500),
  imageUrl: imageField,
  price: moneyField.optional(),
  costPrice: moneyField.optional(),
  lowStockThreshold: z.number().int().min(0).max(1_000_000).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** Edit, archive (isActive=false) or restore a product. Products are never hard-deleted. */
export const PATCH = route({ permission: "products.manage" }, async ({ req, auth, params }) => {
  const id = parseId(params.id);
  const input = await readJson(req, patchSchema);
  const biz = auth.business.id;

  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(and(eq(products.id, id), eq(products.businessId, biz))).for("update");
    if (!before) throw new HttpError(404, "Product not found");
    const categoryId = await resolveCategoryId(tx, biz, input.categoryName);

    const set: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.sku !== undefined) set.sku = input.sku;
    if (input.barcode !== undefined) set.barcode = input.barcode;
    if (categoryId !== undefined) set.categoryId = categoryId;
    if (input.description !== undefined) set.description = input.description;
    if (input.imageUrl !== undefined) set.imageUrl = input.imageUrl;
    if (input.price !== undefined) set.price = input.price;
    if (input.costPrice !== undefined) set.costPrice = input.costPrice;
    if (input.lowStockThreshold !== undefined) set.lowStockThreshold = input.lowStockThreshold;
    if (input.isActive !== undefined) set.isActive = input.isActive;

    await tx.update(products).set(set).where(eq(products.id, id));

    const priceChanged = input.price !== undefined && input.price !== before.price;
    const costChanged = input.costPrice !== undefined && input.costPrice !== before.costPrice;
    const action =
      input.isActive !== undefined && input.isActive !== before.isActive
        ? input.isActive
          ? "product.restored"
          : "product.archived"
        : priceChanged || costChanged
          ? "product.price_changed"
          : "product.updated";
    await audit(tx, {
      businessId: biz,
      userId: auth.user.id,
      action,
      entityType: "product",
      entityId: id,
      metadata: {
        name: before.name,
        ...(priceChanged ? { price: { from: before.price, to: input.price } } : {}),
        ...(costChanged ? { costPrice: { from: before.costPrice, to: input.costPrice } } : {}),
      },
    });
  });
  return { ok: true };
});
