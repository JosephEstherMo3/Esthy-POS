import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { HttpError, readJson, route } from "@/lib/api";
import { audit } from "@/lib/audit";

import { hashPassword, verifyPassword } from "@/lib/password";
import { optText, passwordField } from "@/lib/validation";

export const PATCH = route({}, async ({ req, auth }) => {
  const input = await readJson(
    req,
    z.object({
      fullName: z.string().trim().min(2, "Enter your full name").max(100).optional(),
      phone: optText(30),
      currentPassword: z.string().max(128).optional(),
      newPassword: passwordField.optional(),
    }),
  );
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.fullName !== undefined) set.fullName = input.fullName;
  if (input.phone !== undefined) set.phone = input.phone;

  if (input.newPassword) {
    if (!input.currentPassword) throw new HttpError(400, "Enter your current password", { currentPassword: "Enter your current password" });
    const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, auth.user.id));
    if (!u || !(await verifyPassword(input.currentPassword, u.hash))) {
      throw new HttpError(400, "Your current password is incorrect", { currentPassword: "Your current password is incorrect" });
    }
    set.passwordHash = await hashPassword(input.newPassword);
  }
  if (Object.keys(set).length === 0) throw new HttpError(400, "Nothing to update");

  await db.update(users).set(set).where(eq(users.id, auth.user.id));
  if (set.passwordHash) {
    // Sign out all other devices after a password change.
    const current = auth.sessionTokenHash;
    await db.delete(sessions).where(and(eq(sessions.userId, auth.user.id), current ? ne(sessions.tokenHash, current) : undefined));
  }
  await audit(db, {
    businessId: auth.business.id,
    userId: auth.user.id,
    action: set.passwordHash ? "account.password_changed" : "account.profile_updated",
    entityType: "user",
    entityId: auth.user.id,
  });
  return { ok: true };
});
