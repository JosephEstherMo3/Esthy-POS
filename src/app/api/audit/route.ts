import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, users } from "@/db/schema";
import { parseQuery, route } from "@/lib/api";

export const GET = route({ permission: "audit.view" }, async ({ url, auth }) => {
  const q = parseQuery(
    url,
    z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }),
  );
  const where = eq(auditEvents.businessId, auth.business.id);
  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
        userName: users.fullName,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.userId))
      .where(where)
      .orderBy(desc(auditEvents.createdAt))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ count: sql<number>`count(*)::int` }).from(auditEvents).where(where),
  ]);
  return { events: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })), total: count };
});
