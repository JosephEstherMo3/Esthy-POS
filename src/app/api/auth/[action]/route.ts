import type { NextRequest } from "next/server";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { businesses, businessSettings, memberships, passwordResets, sessions, users } from "@/db/schema";
import { clearRateLimit, clientIp, HttpError, publicRoute, rateLimit, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { createSession, destroySession, getAuth, requestedTokenTransport } from "@/lib/auth";
import { emailDeliveryStatus, sendPasswordResetEmail, sendVerificationEmail } from "@/lib/email";
import { DUMMY_HASH, hashPassword, hashToken, newToken, verifyPassword } from "@/lib/password";
import { createEmailVerification, isEmailVerificationRequired, verifyEmailToken } from "@/lib/verification";
import { emailField, passwordField } from "@/lib/validation";

function baseUrl(req: NextRequest): string {
  // APP_URL is the preferred canonical origin in production, preventing Host-header link poisoning.
  if (process.env.APP_URL) return new URL(process.env.APP_URL).origin;
  const forwardedProto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim();
  const proto = forwardedProto || new URL(req.url).protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || new URL(req.url).host;
  return `${proto}://${host}`;
}

/** Sends a verification email for an account and reports whether it was delivered. */
async function sendVerification(req: NextRequest, userId: string, email: string): Promise<boolean> {
  const token = await createEmailVerification(userId);
  const link = `${baseUrl(req)}/verify-email?token=${encodeURIComponent(token)}`;
  return (await sendVerificationEmail(email, link)).delivered;
}

async function register(req: NextRequest) {
  const input = await readJson(
    req,
    z.object({
      fullName: z.string().trim().min(2, "Enter your full name").max(100),
      businessName: z.string().trim().min(2, "Enter your business name").max(100),
      email: emailField,
      password: passwordField,
    }),
  );
  const normalizedEmail = input.email.trim().toLowerCase();
  rateLimit(`register:${clientIp(req)}`, 30, 60 * 60 * 1000);
  const [exists] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${normalizedEmail})`);
  if (exists) throw new HttpError(409, "An account with this email already exists.", { email: "An account with this email already exists." });

  const verificationRequired = isEmailVerificationRequired();
  const passwordHash = await hashPassword(input.password);
  let userId: string;
  try {
    userId = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: normalizedEmail,
          passwordHash,
          fullName: input.fullName,
          emailVerifiedAt: verificationRequired ? null : new Date(),
        })
        .returning({ id: users.id });
      const [b] = await tx.insert(businesses).values({ name: input.businessName }).returning({ id: businesses.id });
      await tx.insert(businessSettings).values({ businessId: b.id, receiptBusinessName: input.businessName });
      await tx.insert(memberships).values({ businessId: b.id, userId: u.id, role: "owner" });
      await audit(tx, { businessId: b.id, userId: u.id, action: "business.created", entityType: "business", entityId: b.id });
      return u.id;
    });
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") {
      throw new HttpError(409, "An account with this email already exists.", { email: "An account with this email already exists." });
    }
    throw err;
  }

  if (!verificationRequired) {
    const sessionToken = await createSession(userId, requestedTokenTransport(req.headers) ? "token" : "cookie");
    return {
      ok: true,
      status: "created" as const,
      email: normalizedEmail,
      verificationRequired: false,
      sessionToken,
    };
  }
  const delivered = await sendVerification(req, userId, normalizedEmail);
  return {
    ok: true,
    status: "verification_sent" as const,
    email: normalizedEmail,
    verificationRequired: true,
    delivered,
  };
}

async function login(req: NextRequest) {
  const input = await readJson(req, z.object({ email: emailField, password: z.string().min(1, "Enter your password").max(128) }));
  const normalizedEmail = input.email.trim().toLowerCase();
  const key = `login:${clientIp(req)}:${normalizedEmail}`;
  rateLimit(key, 8, 15 * 60 * 1000);
  const [u] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${normalizedEmail})`);
  const ok = await verifyPassword(input.password, u?.passwordHash ?? DUMMY_HASH); // constant-ish time
  if (!u || !ok) throw new HttpError(401, "Incorrect email or password.");
  if (!u.emailVerifiedAt && isEmailVerificationRequired()) {
    throw new HttpError(
      403,
      "Verify your email address before signing in. Open the verification link we sent to your inbox.",
      undefined,
      "EMAIL_NOT_VERIFIED",
    );
  }
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, u.id), eq(memberships.status, "active")))
    .limit(1);
  if (!m) throw new HttpError(403, "Your account is not active. Please contact your business owner.");
  clearRateLimit(key);
  const sessionToken = await createSession(u.id, requestedTokenTransport(req.headers) ? "token" : "cookie");
  await audit(db, { businessId: m.businessId, userId: u.id, action: "auth.login" });
  return { ok: true, sessionToken, role: m.role };
}

/** Requests a new verification email. Same response for known and unknown addresses. */
async function resendVerification(req: NextRequest) {
  const input = await readJson(req, z.object({ email: emailField }));
  const normalizedEmail = input.email.trim().toLowerCase();
  rateLimit(`resend:${clientIp(req)}`, 5, 15 * 60 * 1000);
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${normalizedEmail})`);
  const status = emailDeliveryStatus();
  if (u && !u.emailVerifiedAt && status.configured) {
    await sendVerification(req, u.id, u.email);
  }
  return { ok: true, emailConfigured: status.configured, emailProvider: status.provider };
}

async function verify(req: NextRequest) {
  const input = await readJson(req, z.object({ token: z.string().min(10).max(200) }));
  const result = await verifyEmailToken(input.token);
  return { ok: true, email: result.email };
}

async function forgot(req: NextRequest) {
  const input = await readJson(req, z.object({ email: emailField }));
  const normalizedEmail = input.email.trim().toLowerCase();
  rateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60 * 1000);
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${normalizedEmail})`);
  const emailStatus = emailDeliveryStatus();

  // Keep the same response for known and unknown email addresses. Reset links are only ever emailed.
  if (u && emailStatus.configured) {
    const token = newToken();
    const link = `${baseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
    await db.transaction(async (tx) => {
      // A newer request invalidates previous unused links for this account.
      await tx.delete(passwordResets).where(and(eq(passwordResets.userId, u.id), isNull(passwordResets.usedAt)));
      await tx.insert(passwordResets).values({
        userId: u.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
    });
    await sendPasswordResetEmail(u.email, link);
  }

  return {
    ok: true,
    emailConfigured: emailStatus.configured,
    emailProvider: emailStatus.provider,
  };
}

async function reset(req: NextRequest) {
  const input = await readJson(req, z.object({ token: z.string().min(10).max(200), password: passwordField }));
  const [row] = await db
    .select()
    .from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, hashToken(input.token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date())));
  if (!row) throw new HttpError(400, "This reset link is invalid or has expired. Please request a new one.");
  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await tx.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.id, row.id));
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    await audit(tx, { businessId: null, userId: row.userId, action: "auth.password_reset" });
  });
  return { ok: true };
}

/** Reports whether the caller has an active session (cookie or bearer token). Never reveals user data. */
export const GET = publicRoute(async ({ params }) => {
  if (params.action !== "session") throw new HttpError(404, "Not found");
  const auth = await getAuth();
  return Response.json(
    { authenticated: Boolean(auth), role: auth?.role },
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const POST = publicRoute(async ({ req, params }) => {
  switch (params.action) {
    case "register":
      return register(req);
    case "login":
      return login(req);
    case "logout":
      await destroySession();
      return { ok: true };
    case "verify":
      return verify(req);
    case "resend-verification":
      return resendVerification(req);
    case "forgot":
      return forgot(req);
    case "reset":
      return reset(req);
    default:
      throw new HttpError(404, "Not found");
  }
});
