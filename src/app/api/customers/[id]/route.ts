import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, sales } from "@/db/schema";
import { HttpError, parseId, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { customerSchema } from "@/lib/validation";

export const GET = route({ permission: "customers.view" }, async ({ auth, params }) => {
  const id = parseId(params.id);
  const [c] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.businessId, auth.business.id)));
  if (!c) throw new HttpError(404, "Customer not found");
  const history = await db
    .select({ id: sales.id, receiptNumber: sales.receiptNumber, createdAt: sales.createdAt, total: sales.total, status: sales.status, paymentMethod: sales.paymentMethod })
    .from(sales)
    .where(and(eq(sales.customerId, id), eq(sales.businessId, auth.business.id)))
    .orderBy(desc(sales.createdAt))
    .limit(50);
  return {
    customer: { id: c.id, name: c.name, phone: c.phone, email: c.email, notes: c.notes },
    sales: history.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
  };
});

export const PATCH = route({ permission: "customers.manage" }, async ({ req, auth, params }) => {
  const id = parseId(params.id);
  const input = await readJson(req, customerSchema);
  const [c] = await db
    .update(customers)
    .set({ name: input.name, phone: input.phone ?? null, email: input.email ?? null, notes: input.notes ?? null })
    .where(and(eq(customers.id, id), eq(customers.businessId, auth.business.id)))
    .returning({ id: customers.id });
  if (!c) throw new HttpError(404, "Customer not found");
  await audit(db, { businessId: auth.business.id, userId: auth.user.id, action: "customer.updated", entityType: "customer", entityId: id });
  return { ok: true };
});

/** Deleting a customer keeps their sales (customer link is cleared). */
export const DELETE = route({ permission: "customers.delete" }, async ({ auth, params }) => {
  const id = parseId(params.id);
  const [c] = await db
    .delete(customers)
    .where(and(eq(customers.id, id), eq(customers.businessId, auth.business.id)))
    .returning({ id: customers.id, name: customers.name });
  if (!c) throw new HttpError(404, "Customer not found");
  await audit(db, { businessId: auth.business.id, userId: auth.user.id, action: "customer.deleted", entityType: "customer", entityId: id, metadata: { name: c.name } });
  return { ok: true };
});
