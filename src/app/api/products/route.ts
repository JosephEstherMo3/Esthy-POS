import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { categories, inventoryMovements, products } from "@/db/schema";
import { parseQuery, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { resolveCategoryId } from "@/lib/services/catalog";
import { getInventoryReport } from "@/lib/services/reports";
import { imageField, moneyField, optText, uuidField } from "@/lib/validation";

export const GET = route({ permission: "products.view" }, async ({ url, auth }) => {
  const q = parseQuery(
    url,
    z.object({
      q: z.string().trim().max(100).optional(),
      categoryId: uuidField.optional(),
      status: z.enum(["active", "archived", "all"]).default("active"),
      lowStock: z.enum(["1"]).optional(),
    }),
  );
  const biz = auth.business.id;
  const showCost = can(auth.role, "cost.view");
  const threshold = sql`coalesce(${products.lowStockThreshold}, ${auth.settings.defaultLowStockThreshold})`;
  const conds = [eq(products.businessId, biz)];
  if (q.status !== "all") conds.push(eq(products.isActive, q.status === "active"));
  if (q.categoryId) conds.push(eq(products.categoryId, q.categoryId));
  if (q.lowStock) conds.push(sql`${products.stockQty} <= ${threshold}`);
  if (q.q) {
    const like = `%${q.q}%`;
    conds.push(or(ilike(products.name, like), ilike(products.sku, like), ilike(products.barcode, like))!);
  }

  const rows = await db
    .select({
      p: products,
      categoryName: categories.name,
      threshold: sql<number>`${threshold}::int`,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...conds))
    .orderBy(asc(products.name))
    .limit(1000);

  const cats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.businessId, biz))
    .orderBy(asc(categories.name));

  const valuation = showCost ? (await getInventoryReport(biz, auth.settings.defaultLowStockThreshold)).totals : null;

  return {
    products: rows.map(({ p, categoryName, threshold: th }) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      barcode: p.barcode,
      description: p.description,
      imageUrl: p.imageUrl,
      price: p.price,
      costPrice: showCost ? p.costPrice : null,
      stockQty: p.stockQty,
      lowStockThreshold: p.lowStockThreshold,
      effectiveThreshold: th,
      isLow: p.stockQty <= th,
      isActive: p.isActive,
      categoryId: p.categoryId,
      categoryName,
    })),
    categories: cats,
    valuation,
    settings: {
      defaultLowStockThreshold: auth.settings.defaultLowStockThreshold,
      allowNegativeStock: auth.settings.allowNegativeStock,
    },
  };
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(120),
  sku: optText(64),
  barcode: optText(64),
  categoryName: optText(60),
  description: optText(500),
  imageUrl: imageField,
  price: moneyField,
  costPrice: moneyField.default("0.00"),
  stockQty: z.number("Enter a valid quantity").int("Quantity must be a whole number").min(0, "Stock cannot be negative").max(10_000_000).default(0),
  lowStockThreshold: z.number().int().min(0).max(1_000_000).nullish(),
});

export const POST = route({ permission: "products.manage" }, async ({ req, auth }) => {
  const input = await readJson(req, createSchema);
  const biz = auth.business.id;
  const created = await db.transaction(async (tx) => {
    const categoryId = await resolveCategoryId(tx, biz, input.categoryName);
    const [p] = await tx
      .insert(products)
      .values({
        businessId: biz,
        categoryId: categoryId ?? null,
        name: input.name,
        sku: input.sku ?? null,
        barcode: input.barcode ?? null,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        price: input.price,
        costPrice: input.costPrice,
        stockQty: input.stockQty,
        lowStockThreshold: input.lowStockThreshold ?? null,
      })
      .returning({ id: products.id });
    if (input.stockQty > 0) {
      await tx.insert(inventoryMovements).values({
        businessId: biz,
        productId: p.id,
        type: "initial",
        quantityChange: input.stockQty,
        balanceAfter: input.stockQty,
        reason: "Opening stock",
        userId: auth.user.id,
      });
    }
    await audit(tx, { businessId: biz, userId: auth.user.id, action: "product.created", entityType: "product", entityId: p.id, metadata: { name: input.name } });
    return p;
  });
  return Response.json({ id: created.id }, { status: 201 });
});
