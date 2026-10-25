import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { businessSettings, inventoryMovements, products, users } from "@/db/schema";
import { HttpError, parseQuery, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { uuidField } from "@/lib/validation";

export const GET = route({ permission: "inventory.adjust" }, async ({ url, auth }) => {
  const q = parseQuery(
    url,
    z.object({
      productId: uuidField.optional(),
      type: z.enum(["initial", "restock", "adjustment", "damage", "sale", "refund"]).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  );
  const conds = [eq(inventoryMovements.businessId, auth.business.id)];
  if (q.productId) conds.push(eq(inventoryMovements.productId, q.productId));
  if (q.type) conds.push(eq(inventoryMovements.type, q.type));

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: inventoryMovements.id,
        type: inventoryMovements.type,
        quantityChange: inventoryMovements.quantityChange,
        balanceAfter: inventoryMovements.balanceAfter,
        reason: inventoryMovements.reason,
        createdAt: inventoryMovements.createdAt,
        productId: inventoryMovements.productId,
        productName: products.name,
        sku: products.sku,
        userName: users.fullName,
        saleId: inventoryMovements.saleId,
      })
      .from(inventoryMovements)
      .innerJoin(products, eq(products.id, inventoryMovements.productId))
      .leftJoin(users, eq(users.id, inventoryMovements.userId))
      .where(and(...conds))
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryMovements)
      .where(and(...conds)),
  ]);
  return { movements: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), total: count };
});

const adjustSchema = z.object({
  productId: uuidField,
  type: z.enum(["restock", "adjustment", "damage"]),
  quantityChange: z
    .number("Enter a quantity")
    .int("Quantity must be a whole number")
    .refine((n) => n !== 0, "Quantity cannot be zero")
    .refine((n) => Math.abs(n) <= 10_000_000, "Quantity is too large"),
  reason: z.string().trim().min(3, "Please give a reason (at least 3 characters)").max(200),
});

export const POST = route({ permission: "inventory.adjust" }, async ({ req, auth }) => {
  const input = await readJson(req, adjustSchema);
  if (input.type === "restock" && input.quantityChange < 0) throw new HttpError(400, "A restock must add stock");
  if (input.type === "damage" && input.quantityChange > 0) throw new HttpError(400, "Damaged or lost stock must remove stock");
  const biz = auth.business.id;

  return db.transaction(async (tx) => {
    const [s] = await tx.select({ allow: businessSettings.allowNegativeStock }).from(businessSettings).where(eq(businessSettings.businessId, biz));
    const [updated] = await tx
      .update(products)
      .set({ stockQty: sql`${products.stockQty} + ${input.quantityChange}`, updatedAt: new Date() })
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.businessId, biz),
          s?.allow ? undefined : sql`${products.stockQty} + ${input.quantityChange} >= 0`,
        ),
      )
      .returning({ stockQty: products.stockQty, name: products.name });
    if (!updated) {
      const [exists] = await tx.select({ id: products.id }).from(products).where(and(eq(products.id, input.productId), eq(products.businessId, biz)));
      throw new HttpError(exists ? 409 : 404, exists ? "That adjustment would make stock negative" : "Product not found");
    }
    await tx.insert(inventoryMovements).values({
      businessId: biz,
      productId: input.productId,
      type: input.type,
      quantityChange: input.quantityChange,
      balanceAfter: updated.stockQty,
      reason: input.reason,
      userId: auth.user.id,
    });
    await audit(tx, {
      businessId: biz,
      userId: auth.user.id,
      action: "inventory.adjusted",
      entityType: "product",
      entityId: input.productId,
      metadata: { name: updated.name, change: input.quantityChange, type: input.type, reason: input.reason, balance: updated.stockQty },
    });
    return { stockQty: updated.stockQty };
  });
});
