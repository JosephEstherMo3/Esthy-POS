import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { parseQuery, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { customerSchema } from "@/lib/validation";

export const GET = route({ permission: "customers.view" }, async ({ url, auth }) => {
  const q = parseQuery(url, z.object({ q: z.string().trim().max(100).optional() }));
  const like = q.q ? `%${q.q}%` : null;
  const r = await db.execute(sql`
    select c.id, c.name, c.phone, c.email, c.notes, c.created_at,
      (count(s.id) filter (where s.status <> 'voided'))::int as purchases,
      coalesce(sum(s.total) filter (where s.status <> 'voided'), 0)::text as spent,
      max(s.created_at) as last_purchase
    from customers c left join sales s on s.customer_id = c.id and s.business_id = c.business_id
    where c.business_id = ${auth.business.id}
      ${like ? sql`and (c.name ilike ${like} or c.phone ilike ${like} or c.email ilike ${like})` : sql``}
    group by c.id order by c.name asc limit 500`);
  type Row = { id: string; name: string; phone: string | null; email: string | null; notes: string | null; created_at: Date; purchases: number; spent: string; last_purchase: Date | null };
  return {
    customers: (r.rows as Row[]).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      notes: c.notes,
      purchases: c.purchases,
      spent: c.spent,
      lastPurchase: c.last_purchase ? new Date(c.last_purchase).toISOString() : null,
    })),
  };
});

export const POST = route({ permission: "customers.manage" }, async ({ req, auth }) => {
  const input = await readJson(req, customerSchema);
  const [c] = await db
    .insert(customers)
    .values({ businessId: auth.business.id, name: input.name, phone: input.phone ?? null, email: input.email ?? null, notes: input.notes ?? null })
    .returning({ id: customers.id, name: customers.name });
  await audit(db, { businessId: auth.business.id, userId: auth.user.id, action: "customer.created", entityType: "customer", entityId: c.id });
  return Response.json(c, { status: 201 });
});
