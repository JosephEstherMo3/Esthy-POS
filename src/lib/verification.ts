import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { emailVerifications, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { emailDeliveryStatus } from "@/lib/email";
import { HttpError } from "@/lib/errors";
import { hashToken, newToken } from "@/lib/password";

const VERIFY_HOURS = 24;

/**
 * Email verification is enforced only when a mail provider is configured. Without one there is no way to
 * deliver the link, so accounts are activated when they are created and the registration screen says so.
 * Enabling a provider later turns verification on for accounts created afterwards (see README).
 */
export function isEmailVerificationRequired(env: Record<string, string | undefined> = process.env): boolean {
  if (env.REQUIRE_EMAIL_VERIFICATION === "false") return false;
  if (env.REQUIRE_EMAIL_VERIFICATION === "true") return true;

  // In local development or when using the Resend test domain sandbox (onboarding@resend.dev),
  // external email delivery fails with 403, so verification is skipped unless explicitly forced.
  const emailFrom = env.EMAIL_FROM || "";
  const appUrl = env.APP_URL || "";
  if (emailFrom.includes("onboarding@resend.dev") || appUrl.includes("localhost")) {
    return false;
  }

  return emailDeliveryStatus(env).configured;
}

/** Creates a single-use verification token for a user and invalidates older unused tokens. Returns the plaintext token once. */
export async function createEmailVerification(userId: string): Promise<string> {
  const token = newToken();
  await db.transaction(async (tx) => {
    await tx
      .delete(emailVerifications)
      .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.usedAt)));
    await tx.insert(emailVerifications).values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + VERIFY_HOURS * 60 * 60 * 1000),
    });
  });
  return token;
}

/** Consumes a verification token and marks the account's email as verified. */
export async function verifyEmailToken(token: string): Promise<{ email: string }> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ tokenHash: emailVerifications.tokenHash, userId: emailVerifications.userId, email: users.email })
      .from(emailVerifications)
      .innerJoin(users, eq(users.id, emailVerifications.userId))
      .where(
        and(
          eq(emailVerifications.tokenHash, hashToken(token)),
          isNull(emailVerifications.usedAt),
          gt(emailVerifications.expiresAt, now),
        ),
      )
      .for("update", { of: emailVerifications });
    if (!row) {
      throw new HttpError(400, "This verification link is invalid, has expired, or was already used. Sign in, or request a new verification email.");
    }
    await tx.update(emailVerifications).set({ usedAt: now }).where(eq(emailVerifications.tokenHash, row.tokenHash));
    await tx.update(users).set({ emailVerifiedAt: now }).where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)));
    await audit(tx, { businessId: null, userId: row.userId, action: "auth.email_verified" });
    return { email: row.email };
  });
}
