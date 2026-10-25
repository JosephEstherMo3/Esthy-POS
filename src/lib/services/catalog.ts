import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { addDays, todayInTz } from "@/lib/money";
import { HttpError } from "@/lib/errors";

type Reader = Pick<typeof db, "select" | "insert">;

/** Finds (case-insensitively) or creates a category. undefined = leave unchanged, null/"" = clear. */
export async function resolveCategoryId(
  tx: Reader,
  businessId: string,
  name: string | null | undefined,
): Promise<string | null | undefined> {
  if (name === undefined) return undefined;
  if (!name) return null;
  const find = async () => {
    const [row] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.businessId, businessId), sql`lower(${categories.name}) = lower(${name})`));
    return row?.id;
  };
  const existing = await find();
  if (existing) return existing;
  const [created] = await tx.insert(categories).values({ businessId, name }).onConflictDoNothing().returning({ id: categories.id });
  return created?.id ?? (await find()) ?? null;
}

/** Resolves and validates a [from, to] date range in the business timezone (max 366 days). */
export function resolveRange(q: { from?: string; to?: string }, tz: string, defaultDays = 7, maxDays = 366) {
  const today = todayInTz(tz);
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -(defaultDays - 1));
  if (from > to) throw new HttpError(400, "The start date must be on or before the end date");
  if (addDays(from, maxDays) < to) {
    throw new HttpError(400, maxDays <= 366 ? "Please choose a range of one year or less" : "Please choose a range of ten years or less");
  }
  return { from, to, today };
}
