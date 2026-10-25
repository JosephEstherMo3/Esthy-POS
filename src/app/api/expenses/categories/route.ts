import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { expenseCategories } from "@/db/schema";
import { HttpError, readJson, route } from "@/lib/api";

const DEFAULT_CATEGORIES = [
  { name: "Rent & Rates", color: "#3b82f6" },
  { name: "Utilities (Power & Water)", color: "#f59e0b" },
  { name: "Staff Salaries & Wages", color: "#10b981" },
  { name: "Inventory & Restock", color: "#8b5cf6" },
  { name: "Equipment & Maintenance", color: "#ec4899" },
  { name: "Marketing & Advertising", color: "#06b6d4" },
  { name: "Transport & Logistics", color: "#f97316" },
  { name: "Office & Cleaning Supplies", color: "#14b8a6" },
  { name: "Miscellaneous & Petty Cash", color: "#64748b" },
];

export const GET = route({ permission: "expenses.view" }, async ({ auth }) => {
  let categories = await db
    .select({
      id: expenseCategories.id,
      name: expenseCategories.name,
      color: expenseCategories.color,
      createdAt: expenseCategories.createdAt,
    })
    .from(expenseCategories)
    .where(eq(expenseCategories.businessId, auth.business.id))
    .orderBy(asc(expenseCategories.name));

  // If no categories exist yet for this business, seed defaults automatically
  if (categories.length === 0) {
    await db.insert(expenseCategories).values(
      DEFAULT_CATEGORIES.map((c) => ({
        businessId: auth.business.id,
        name: c.name,
        color: c.color,
      })),
    );

    categories = await db
      .select({
        id: expenseCategories.id,
        name: expenseCategories.name,
        color: expenseCategories.color,
        createdAt: expenseCategories.createdAt,
      })
      .from(expenseCategories)
      .where(eq(expenseCategories.businessId, auth.business.id))
      .orderBy(asc(expenseCategories.name));
  }

  return { categories };
});

const createCategorySchema = z.object({
  name: z.string().trim().min(2, "Category name must be at least 2 characters").max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid color hex code").default("#64748b"),
});

export const POST = route({ permission: "expenses.manage" }, async ({ req, auth }) => {
  const input = await readJson(req, createCategorySchema);

  // Check for duplicate name in the same business
  const existing = await db
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(eq(expenseCategories.businessId, auth.business.id));

  if (existing.some((c) => c.id && c.id === input.name)) {
    throw new HttpError(409, "A category with this name already exists.");
  }

  const [created] = await db
    .insert(expenseCategories)
    .values({
      businessId: auth.business.id,
      name: input.name,
      color: input.color,
    })
    .returning({
      id: expenseCategories.id,
      name: expenseCategories.name,
      color: expenseCategories.color,
    });

  return Response.json(created, { status: 201 });
});
