import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers, memberships, saleItems, sales, users } from "@/db/schema";
import { parseQuery, readJson, route } from "@/lib/api";
import { can } from "@/lib/permissions";
import { createSale, getBusinessInfo, getSaleDetail } from "@/lib/services/sales";
import { dateStr, uuidField } from "@/lib/validation";

export const GET = route({ permission: "sales.view_own" }, async ({ url, auth }) => {
  const q = parseQuery(
    url,
    z.object({
      q: z.string().trim().max(100).optional(),
      from: dateStr.optional(),
      to: dateStr.optional(),
      cashierId: uuidField.optional(),
      method: z.enum(["cash", "transfer", "card"]).optional(),
      status: z.enum(["completed", "partially_refunded", "refunded", "voided"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  );
  const tz = auth.settings.timezone;
  const viewAll = can(auth.role, "sales.view_all");
  const conds = [eq(sales.businessId, auth.business.id)];
  if (!viewAll) conds.push(eq(sales.cashierId, auth.user.id));
  else if (q.cashierId) conds.push(eq(sales.cashierId, q.cashierId));
  if (q.q) conds.push(or(ilike(sales.receiptNumber, `%${q.q}%`), ilike(customers.name, `%${q.q}%`))!);
  if (q.method) conds.push(eq(sales.paymentMethod, q.method));
  if (q.status) conds.push(eq(sales.status, q.status));
  if (q.from) conds.push(sql`${sales.createdAt} >= ((${q.from}::date)::timestamp at time zone ${tz})`);
  if (q.to) conds.push(sql`${sales.createdAt} < (((${q.to}::date) + 1)::timestamp at time zone ${tz})`);

  const base = db
    .select({
      id: sales.id,
      receiptNumber: sales.receiptNumber,
      createdAt: sales.createdAt,
      total: sales.total,
      refundedAmount: sales.refundedAmount,
      status: sales.status,
      paymentMethod: sales.paymentMethod,
      cashierName: users.fullName,
      customerName: customers.name,
      itemCount: sql<number>`(select coalesce(sum(${saleItems.quantity}), 0)::int from ${saleItems} where ${saleItems.saleId} = ${sales.id})`,
    })
    .from(sales)
    .leftJoin(users, eq(users.id, sales.cashierId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(and(...conds));

  const [rows, [agg]] = await Promise.all([
    base.orderBy(desc(sales.createdAt)).limit(q.limit).offset(q.offset),
    db
      .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${sales.total}), 0)::text` })
      .from(sales)
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .where(and(...conds)),
  ]);

  const cashiers = viewAll
    ? await db
        .select({ id: users.id, name: users.fullName })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.businessId, auth.business.id))
        .orderBy(users.fullName)
    : [];

  return {
    sales: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    total: agg.count,
    totalAmount: agg.total,
    cashiers,
  };
});

const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: uuidField,
        quantity: z.number("Invalid quantity").int("Quantity must be a whole number").min(1).max(100_000),
      }),
    )
    .min(1, "The cart is empty")
    .max(200, "Too many items in one sale"),
  discountType: z.enum(["none", "percent", "fixed"]).default("none"),
  discountValue: z.number().finite().min(0, "Discount cannot be negative").max(999_999_999).default(0),
  paymentMethod: z.enum(["cash", "transfer", "card"]),
  amountTendered: z.number().finite().min(0).max(999_999_999).nullish(),
  customerId: uuidField.nullish(),
  note: z.string().trim().max(300).nullish(),
  idempotencyKey: z.string().min(16, "Missing request id").max(80),
});

export const POST = route({ permission: "pos.sell" }, async ({ req, auth }) => {
  const input = await readJson(req, checkoutSchema);
  const result = await createSale({
    businessId: auth.business.id,
    cashierId: auth.user.id,
    ...input,
  });
  const [sale, business] = await Promise.all([getSaleDetail(auth.business.id, result.saleId), getBusinessInfo(auth.business.id)]);
  return Response.json({ sale, business, duplicate: result.duplicate }, { status: result.duplicate ? 200 : 201 });
});
