import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { HttpError, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { emailField, passwordField } from "@/lib/validation";

export const GET = route({ permission: "team.view" }, async ({ auth }) => {
  const rows = await db
    .select({
      id: memberships.id,
      userId: users.id,
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      role: memberships.role,
      status: memberships.status,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.businessId, auth.business.id))
    .orderBy(asc(memberships.createdAt));
  return { members: rows.map((m) => ({ ...m, createdAt: m.createdAt.toISOString(), isYou: m.userId === auth.user.id })) };
});

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter the member's full name").max(100),
  email: emailField,
  phone: z.string().trim().max(30).optional(),
  password: passwordField,
  role: z.enum(["owner", "manager", "cashier"]),
});

/** Creates an account for a team member with a temporary password. Managers may only create cashiers. */
export const POST = route({ permission: "team.manage" }, async ({ req, auth }) => {
  const input = await readJson(req, schema);
  if (auth.role !== "owner" && input.role !== "cashier") {
    throw new HttpError(403, "Managers can only add cashier accounts.");
  }
  const normalizedEmail = input.email.trim().toLowerCase();
  const [exists] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${normalizedEmail})`);
  if (exists) throw new HttpError(409, "An account with this email already exists.", { email: "An account with this email already exists." });
  const passwordHash = await hashPassword(input.password);
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      // The owner or manager creates this account and hands over the password, so the address is treated as verified.
      const [u] = await tx
        .insert(users)
        .values({ email: normalizedEmail, passwordHash, fullName: input.fullName, phone: input.phone || null, emailVerifiedAt: new Date() })
        .returning({ id: users.id });
      const [m] = await tx.insert(memberships).values({ businessId: auth.business.id, userId: u.id, role: input.role }).returning({ id: memberships.id });
      await audit(tx, { businessId: auth.business.id, userId: auth.user.id, action: "team.member_added", entityType: "membership", entityId: m.id, metadata: { email: normalizedEmail, role: input.role } });
      return m.id;
    });
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      throw new HttpError(409, "An account with this email already exists.", { email: "An account with this email already exists." });
    }
    throw err;
  }
  return Response.json({ id }, { status: 201 });
});
