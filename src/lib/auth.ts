import { cookies, headers } from "next/headers";
import { cache } from "react";
import { and, asc, eq, getTableColumns, gt } from "drizzle-orm";
import { db } from "@/db";
import { businesses, businessSettings, memberships, sessions, users, type Settings } from "@/db/schema";
import { hashToken, newToken } from "@/lib/password";
import type { Role } from "@/lib/permissions";

export const SESSION_COOKIE = "ce_session";
/**
 * Sign-in requests from a page embedded in another site send this header to receive the session as a token in the
 * response body instead of a cookie. The page keeps it in its own sessionStorage and presents it as `Authorization: Bearer`.
 */
export const SESSION_TRANSPORT_HEADER = "x-session-transport";
const SESSION_DAYS = 14;
const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export interface AuthContext {
  user: { id: string; email: string; fullName: string; phone: string | null };
  business: { id: string; name: string };
  role: Role;
  /** Settings without the (potentially large) logo data URL. */
  settings: Omit<Settings, "logoUrl">;
  /** Hash of the session credential that authenticated this request (keeps the current session when others are revoked). */
  sessionTokenHash: string;
}

export function requestedTokenTransport(h: Pick<Headers, "get">): boolean {
  return (h.get(SESSION_TRANSPORT_HEADER) ?? "").toLowerCase() === "token";
}

/**
 * True when the browser reached us over HTTPS. Reverse proxies differ in what they forward,
 * so several signals are checked (any one is enough): X-Forwarded-Proto, the RFC 7239
 * `Forwarded` header, the Origin / Referer the browser sent, APP_URL, or the request URL.
 */
export function isHttpsRequest(h: Pick<Headers, "get">, requestUrl?: string): boolean {
  const xfp = (h.get("x-forwarded-proto") ?? "").toLowerCase();
  if (xfp.split(",").some((p) => p.trim() === "https")) return true;
  if (/proto=https/i.test(h.get("forwarded") ?? "")) return true;
  if ((h.get("x-forwarded-ssl") ?? "").toLowerCase() === "on") return true;
  if ((h.get("origin") ?? "").toLowerCase().startsWith("https://")) return true;
  if ((h.get("referer") ?? "").toLowerCase().startsWith("https://")) return true;
  if ((process.env.APP_URL ?? "").toLowerCase().startsWith("https://")) return true;
  return (requestUrl ?? "").toLowerCase().startsWith("https://");
}

/**
 * Cookie attributes. Over HTTPS the cookie is `SameSite=None; Secure; Partitioned` so that sign-in also works
 * inside an embedded preview. Cross-site request forgery is still prevented server-side (assertSameSiteRequest in
 * src/lib/api.ts). Over plain HTTP (local development) it stays `Lax`.
 */
export function sessionCookieOptions(secure: boolean, expires: Date) {
  return {
    httpOnly: true,
    path: "/",
    expires,
    ...(secure
      ? { secure: true, sameSite: "none" as const, partitioned: true }
      : { secure: false, sameSite: "lax" as const }),
  };
}

/** Session credentials presented with this request: an explicit Bearer token and/or the session cookie. */
async function candidateSessionTokens(): Promise<string[]> {
  const h = await headers();
  const out: string[] = [];
  const authz = h.get("authorization") ?? "";
  if (authz.startsWith("Bearer ")) {
    const t = authz.slice(7).trim();
    if (TOKEN_RE.test(t)) out.push(t);
  }
  const cookieToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (cookieToken && TOKEN_RE.test(cookieToken) && !out.includes(cookieToken)) out.push(cookieToken);
  return out;
}

/**
 * Creates a session. With "cookie" transport the httpOnly cookie is set (normal browser tabs).
 * With "token" transport nothing is set and the raw token is returned for the embedded page to keep in this tab.
 * Only the SHA-256 hash of the token is stored in the database.
 */
export async function createSession(userId: string, transport: "cookie" | "token" = "cookie"): Promise<string> {
  const token = newToken();
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    userAgent: (h.get("user-agent") ?? "").slice(0, 200),
    expiresAt,
  });
  if (transport !== "token") {
    try {
      (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(isHttpsRequest(h), expiresAt));
    } catch {
      /* ignore if cookies cannot be set in this context */
    }
  }
  return token;
}

/** Ends every session presented with this request and clears the cookie. */
export async function destroySession(): Promise<void> {
  const h = await headers();
  for (const token of await candidateSessionTokens()) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  // Expire with the same attributes it was set with (a partitioned cookie is only cleared by a partitioned one).
  (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookieOptions(isHttpsRequest(h), new Date(0)), maxAge: 0 });
}

const { logoUrl: _logo, ...settingsColumns } = getTableColumns(businessSettings);
void _logo;

async function authForToken(token: string): Promise<AuthContext | null> {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      phone: users.phone,
      role: memberships.role,
      businessId: businesses.id,
      businessName: businesses.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.status, "active")))
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  if (!row) return null;
  const [settings] = await db.select(settingsColumns).from(businessSettings).where(eq(businessSettings.businessId, row.businessId));
  if (!settings) return null;
  return {
    user: { id: row.userId, email: row.email, fullName: row.fullName, phone: row.phone },
    business: { id: row.businessId, name: row.businessName },
    role: row.role,
    settings,
    sessionTokenHash: tokenHash,
  };
}

/** Resolves the authenticated user, active business membership and role. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  for (const token of await candidateSessionTokens()) {
    const auth = await authForToken(token);
    if (auth) return auth;
  }
  return null;
});
