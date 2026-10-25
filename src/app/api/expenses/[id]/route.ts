import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenses } from "@/db/schema";
import { HttpError, parseId, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";

const patchExpenseSchema = z.object({
  title: z.string().trim().min(2, "Enter an expense description").max(200).optional(),
  amount: z
    .union([z.number().positive(), z.string()])
    .transform((val) => {
      const n = typeof val === "number" ? val : parseFloat(val);
      if (isNaN(n) || n <= 0) throw new Error("Amount must be greater than 0");
      return n.toFixed(2);
    })
    .optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)").optional(),
  categoryId: z.string().uuid().nullable().optional(),
  paymentMethod: z.enum(["cash", "transfer", "card"]).optional(),
  reference: z.string().trim().max(100).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const PATCH = route({ permission: "expenses.manage" }, async ({ req, auth, params }) => {
  const id = parseId(params.id);
  const input = await readJson(req, patchExpenseSchema);
  const biz = auth.business.id;

  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.businessId, biz)));

  if (!existing) {
    throw new HttpError(404, "Expense not found");
  }

  const set: Partial<typeof expenses.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) set.title = input.title;
  if (input.amount !== undefined) set.amount = input.amount;
  if (input.date !== undefined) set.date = input.date;
  if (input.categoryId !== undefined) set.categoryId = input.categoryId;
  if (input.paymentMethod !== undefined) set.paymentMethod = input.paymentMethod;
  if (input.reference !== undefined) set.reference = input.reference;
  if (input.note !== undefined) set.note = input.note;

  await db.update(expenses).set(set).where(eq(expenses.id, id));

  await audit(db, {
    businessId: biz,
    userId: auth.user.id,
    action: "expense.updated",
    entityType: "expense",
    entityId: id,
    metadata: { title: input.title ?? existing.title, amount: input.amount ?? existing.amount },
  });

  return { ok: true };
});

export const DELETE = route({ permission: "expenses.manage" }, async ({ auth, params }) => {
  const id = parseId(params.id);
  const biz = auth.business.id;

  const [existing] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), eq(expenses.businessId, biz)));

  if (!existing) {
    throw new HttpError(404, "Expense not found");
  }

  await db.delete(expenses).where(eq(expenses.id, id));

  await audit(db, {
    businessId: biz,
    userId: auth.user.id,
    action: "expense.deleted",
    entityType: "expense",
    entityId: id,
    metadata: { title: existing.title, amount: existing.amount },
  });

  return { ok: true };
});
