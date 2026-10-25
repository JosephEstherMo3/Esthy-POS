import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenseCategories, expenses, users } from "@/db/schema";
import { HttpError, parseQuery, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categoryId: z.string().uuid().optional(),
  paymentMethod: z.enum(["cash", "transfer", "card"]).optional(),
  q: z.string().trim().max(100).optional(),
});

export const GET = route({ permission: "expenses.view" }, async ({ url, auth }) => {
  const q = parseQuery(url, querySchema);

  const conditions = [eq(expenses.businessId, auth.business.id)];

  if (q.from) {
    conditions.push(gte(expenses.date, q.from));
  }
  if (q.to) {
    conditions.push(lte(expenses.date, q.to));
  }
  if (q.categoryId) {
    conditions.push(eq(expenses.categoryId, q.categoryId));
  }
  if (q.paymentMethod) {
    conditions.push(eq(expenses.paymentMethod, q.paymentMethod));
  }
  if (q.q) {
    const like = `%${q.q}%`;
    conditions.push(
      or(
        ilike(expenses.title, like),
        ilike(expenses.reference, like),
        ilike(expenses.note, like),
      )!,
    );
  }

  const rows = await db
    .select({
      id: expenses.id,
      title: expenses.title,
      amount: expenses.amount,
      date: expenses.date,
      paymentMethod: expenses.paymentMethod,
      reference: expenses.reference,
      note: expenses.note,
      createdAt: expenses.createdAt,
      categoryId: expenses.categoryId,
      categoryName: expenseCategories.name,
      categoryColor: expenseCategories.color,
      recordedById: expenses.recordedBy,
      recordedByName: users.fullName,
    })
    .from(expenses)
    .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
    .innerJoin(users, eq(expenses.recordedBy, users.id))
    .where(and(...conditions))
    .orderBy(desc(expenses.date), desc(expenses.createdAt))
    .limit(500);

  // Compute summary stats
  const totalAmount = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);

  // Category breakdown
  const categoryMap: Record<string, { name: string; color: string; total: number; count: number }> = {};
  for (const r of rows) {
    const catName = r.categoryName || "Uncategorized";
    const catColor = r.categoryColor || "#94a3b8";
    if (!categoryMap[catName]) {
      categoryMap[catName] = { name: catName, color: catColor, total: 0, count: 0 };
    }
    categoryMap[catName].total += Number(r.amount || 0);
    categoryMap[catName].count += 1;
  }

  return {
    expenses: rows.map((r) => ({
      ...r,
      amount: Number(r.amount).toFixed(2),
      createdAt: r.createdAt.toISOString(),
    })),
    summary: {
      totalAmount: totalAmount.toFixed(2),
      count: rows.length,
      categoryBreakdown: Object.values(categoryMap).sort((a, b) => b.total - a.total),
    },
  };
});

const createExpenseSchema = z.object({
  title: z.string().trim().min(2, "Enter an expense description").max(200),
  amount: z.union([z.number().positive(), z.string()]).transform((val) => {
    const n = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(n) || n <= 0) throw new Error("Amount must be greater than 0");
    return n.toFixed(2);
  }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  categoryId: z.string().uuid().nullable().optional(),
  paymentMethod: z.enum(["cash", "transfer", "card"]).default("cash"),
  reference: z.string().trim().max(100).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export const POST = route({ permission: "expenses.manage" }, async ({ req, auth }) => {
  const input = await readJson(req, createExpenseSchema);

  const [created] = await db
    .insert(expenses)
    .values({
      businessId: auth.business.id,
      title: input.title,
      amount: input.amount,
      date: input.date,
      categoryId: input.categoryId || null,
      paymentMethod: input.paymentMethod,
      reference: input.reference || null,
      note: input.note || null,
      recordedBy: auth.user.id,
    })
    .returning({ id: expenses.id });

  await audit(db, {
    businessId: auth.business.id,
    userId: auth.user.id,
    action: "expense.created",
    entityType: "expense",
    entityId: created.id,
    metadata: { title: input.title, amount: input.amount, date: input.date },
  });

  return Response.json(created, { status: 201 });
});
