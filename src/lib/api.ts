import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getAuth, type AuthContext } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { can, type Permission } from "@/lib/permissions";

export { HttpError };

export interface RouteCtx {
  req: NextRequest;
  url: URL;
  auth: AuthContext;
  params: Record<string, string>;
}

export interface PublicCtx {
  req: NextRequest;
  url: URL;
  params: Record<string, string>;
}

// `any` keeps this wrapper compatible with Next's generated per-route params types.
type Next = { params: Promise<any> };

/**
 * CSRF defence for state-changing requests (the session cookie may be SameSite=None so it works in
 * embedded previews, so we must not rely on SameSite alone):
 *  1. Browsers label every request with Sec-Fetch-Site. `cross-site` → reject.
 *  2. Older browsers: if an Origin header is present it must match this host / APP_URL.
 *  3. Requests with neither header (curl, server-to-server, our test-suite) carry no browser
 *     credentials to abuse, and `readJson` additionally requires Content-Type: application/json,
 *     which a cross-site page cannot send without a CORS pre-flight that this API never grants.
 */
export function assertSameSiteRequest(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const site = req.headers.get("sec-fetch-site");
  if (site) {
    if (site === "cross-site") throw new HttpError(403, "Cross-site requests are not allowed.");
    return;
  }
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    throw new HttpError(403, "Cross-site requests are not allowed.");
  }
  const allowed = new Set<string>();
  for (const v of [req.headers.get("host"), req.headers.get("x-forwarded-host"), new URL(req.url).host]) {
    for (const part of (v ?? "").split(",")) if (part.trim()) allowed.add(part.trim().toLowerCase());
  }
  try {
    if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).host.toLowerCase());
  } catch {
    /* ignore malformed APP_URL */
  }
  if (!allowed.has(originHost)) throw new HttpError(403, "Cross-site requests are not allowed.");
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  return NextResponse.json(result ?? { ok: true });
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message, fieldErrors: err.fieldErrors, code: err.code }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid input", fieldErrors }, { status: 400 });
  }
  const e = err as { code?: string; cause?: { code?: string; detail?: string; constraint?: string } };
  const pgCode = e?.cause?.code ?? e?.code;
  if (pgCode === "23505") {
    const detail = (e?.cause?.detail ?? "").toLowerCase();
    const constraint = (e?.cause?.constraint ?? "").toLowerCase();
    if (detail.includes("email") || constraint.includes("email")) {
      return NextResponse.json({
        error: "An account with this email already exists.",
        fieldErrors: { email: "An account with this email already exists." },
      }, { status: 409 });
    }
    return NextResponse.json({ error: "That value already exists. Please use a different one." }, { status: 409 });
  }
  if (pgCode === "23503") {
    return NextResponse.json({ error: "This record is referenced by other data and cannot be changed this way." }, { status: 409 });
  }
  if (pgCode === "23514") {
    return NextResponse.json({ error: "The values provided are not allowed." }, { status: 422 });
  }
  // Never leak internals to the client; keep details in server logs only.
  console.error("[api] unhandled error:", err);
  return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
}

/** Authenticated route: verifies session, business membership and permission server-side. */
export function route(
  opts: { permission?: Permission | Permission[] },
  fn: (ctx: RouteCtx) => Promise<unknown>,
) {
  return async (req: NextRequest, next: Next): Promise<Response> => {
    try {
      assertSameSiteRequest(req);
      const auth = await getAuth();
      if (!auth) throw new HttpError(401, "Please sign in to continue.");
      if (opts.permission) {
        const needed = Array.isArray(opts.permission) ? opts.permission : [opts.permission];
        if (!needed.some((p) => can(auth.role, p))) {
          throw new HttpError(403, "You do not have permission to do that.");
        }
      }
      const params = next?.params ? await next.params : {};
      return toResponse(await fn({ req, url: new URL(req.url), auth, params }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function publicRoute(fn: (ctx: PublicCtx) => Promise<unknown>) {
  return async (req: NextRequest, next: Next): Promise<Response> => {
    try {
      assertSameSiteRequest(req);
      const params = next?.params ? await next.params : {};
      return toResponse(await fn({ req, url: new URL(req.url), params }));
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/**
 * Parses a JSON body. Requiring application/json (together with SameSite=Lax
 * session cookies) means cross-site forms cannot trigger state changes.
 */
export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  return schema.parse(raw);
}

export function parseQuery<T>(url: URL, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseId(id: string | undefined): string {
  if (!id || !UUID_RE.test(id)) throw new HttpError(404, "Not found");
  return id;
}

export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
}

// Simple in-memory limiter (per server instance) to slow down credential guessing.
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  b.count += 1;
  if (b.count > max) throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
}
export function clearRateLimit(key: string) {
  buckets.delete(key);
}
