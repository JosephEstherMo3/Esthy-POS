import { db } from "@/db";
import { auditEvents } from "@/db/schema";

type Executor = Pick<typeof db, "insert">;

/** Records a sensitive operation. Pass a transaction to make it atomic with the change. */
export async function audit(
  executor: Executor,
  event: {
    businessId: string | null;
    userId: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await executor.insert(auditEvents).values({
    businessId: event.businessId,
    userId: event.userId,
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    metadata: event.metadata ?? null,
  });
}
