import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { businesses, users } from "@/db/schema";

/**
 * HTTP-level authentication / authorization / isolation tests.
 * They run against a live server: E2E_BASE_URL=http://localhost:3000 npm test
 * (skipped automatically when E2E_BASE_URL is not set).
 */
const BASE = process.env.E2E_BASE_URL;
const tag = `e2e${Date.now()}`;

class Client {
  cookie = "";
  async req(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? "POST" : "GET"),
      headers,
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      redirect: "manual",
    });
    const set = res.headers.getSetCookie?.() ?? [];
    const sess = set.find((c) => c.startsWith("ce_session="));
    if (sess) this.cookie = sess.split(";")[0];
    let json: any = null;
    try {
      json = await res.clone().json();
    } catch {
      /* not json */
    }
    return { status: res.status, json, res };
  }
}

describe.skipIf(!BASE)("API authentication, authorization and isolation", () => {
  const A = new Client();
  const B = new Client();
  const cashier = new Client();
  const anon = new Client();
  let productId = "";
  let saleId = "";
  const password = "Sup3r-Secret-pass";

  beforeAll(async () => {
    const ra = await A.req("/api/auth/register", { body: { fullName: "Owner A", businessName: `${tag} Shop A`, email: `${tag}-a@test.local`, password } });
    expect(ra.status).toBe(200);
    const rb = await B.req("/api/auth/register", { body: { fullName: "Owner B", businessName: `${tag} Shop B`, email: `${tag}-b@test.local`, password } });
    expect(rb.status).toBe(200);
    // Registration does not sign the owner in; sign in explicitly, as a user would after creating the account.
    expect((await A.req("/api/auth/login", { body: { email: `${tag}-a@test.local`, password } })).status).toBe(200);
    expect((await B.req("/api/auth/login", { body: { email: `${tag}-b@test.local`, password } })).status).toBe(200);
  });

  afterAll(async () => {
    await db.delete(businesses).where(like(businesses.name, `${tag}%`));
    await db.delete(users).where(like(users.email, `${tag}%`));
    await pool.end();
  });

  it("blocks unauthenticated API access", async () => {
    for (const p of ["/api/products", "/api/sales", "/api/dashboard", "/api/reports", "/api/team", "/api/settings", "/api/customers", "/api/export?type=sales"]) {
      expect((await anon.req(p)).status, p).toBe(401);
    }
    expect((await anon.req("/api/sales", { body: {} })).status).toBe(401);
  });

  it("registers without signing in, then signs in with the same credentials", async () => {
    const fresh = new Client();
    expect((await fresh.req("/api/auth/session")).json).toEqual({ authenticated: false });
    const email = `${tag}-fresh@test.local`;
    const reg = await fresh.req("/api/auth/register", { body: { fullName: "Fresh User", businessName: `${tag} Fresh`, email, password } });
    expect(reg.status).toBe(200);
    // This server has no mail provider, so verification is not active and the account is usable immediately.
    expect(reg.json.status).toBe("created");
    expect(reg.json.verificationRequired).toBe(false);
    expect(reg.json).not.toHaveProperty("handoffToken");
    expect(fresh.cookie).toBe(""); // registration does not sign the user in by itself
    expect((await fresh.req("/api/products")).status).toBe(401);

    const again = new Client();
    const login = await again.req("/api/auth/login", { body: { email, password } });
    expect(login.status).toBe(200);
    expect((await again.req("/api/auth/session")).json).toEqual({ authenticated: true });
    expect((await again.req("/api/me/context")).json.user.email).toBe(email);
    // email is case-insensitive
    const upper = new Client();
    expect((await upper.req("/api/auth/login", { body: { email: email.toUpperCase(), password } })).status).toBe(200);
  });

  it("rejects invalid or unknown email verification tokens", async () => {
    expect((await anon.req("/api/auth/verify", { body: { token: "x".repeat(40) } })).status).toBe(400);
    expect((await anon.req("/api/auth/verify", { body: { token: "short" } })).status).toBe(400);
  });

  it("issues a cross-context cookie (SameSite=None; Secure; Partitioned) over https and Lax over http", async () => {
    const email = `${tag}-a@test.local`;
    const https = await new Client().req("/api/auth/login", { body: { email, password }, headers: { "x-forwarded-proto": "https" } });
    const httpsCookie = (https.res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("ce_session=")) ?? "";
    expect(httpsCookie).toMatch(/HttpOnly/i);
    expect(httpsCookie).toMatch(/Secure/i);
    expect(httpsCookie).toMatch(/SameSite=none/i);
    expect(httpsCookie).toMatch(/Partitioned/i);

    const viaOrigin = await new Client().req("/api/auth/login", { body: { email, password }, headers: { origin: "https://example-preview.app" } });
    // an https Origin from another host is still rejected as cross-site (see next test), so this must be refused
    expect(viaOrigin.status).toBe(403);

    const http = await new Client().req("/api/auth/login", { body: { email, password } });
    const httpCookie = (http.res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("ce_session=")) ?? "";
    expect(httpCookie).toMatch(/SameSite=lax/i);
    expect(httpCookie).not.toMatch(/Secure/i);
  });

  it("rejects cross-site state-changing requests but allows same-origin ones", async () => {
    const email = `${tag}-a@test.local`;
    const cross = await new Client().req("/api/auth/login", { body: { email, password }, headers: { "sec-fetch-site": "cross-site" } });
    expect(cross.status).toBe(403);
    expect(cross.json.error).toMatch(/cross-site/i);
    const evilOrigin = await A.req("/api/products", { body: { name: "CSRF", price: 1 }, headers: { origin: "https://evil.example" } });
    expect(evilOrigin.status).toBe(403);
    const same = await new Client().req("/api/auth/login", { body: { email, password }, headers: { "sec-fetch-site": "same-origin" } });
    expect(same.status).toBe(200);
    const sameOrigin = await new Client().req("/api/auth/login", { body: { email, password }, headers: { origin: new URL(BASE!).origin } });
    expect(sameOrigin.status).toBe(200);
    // reads are never blocked by this check
    expect((await new Client().req("/api/auth/session", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(200);
  });

  it("supports token sessions for embedded pages that refuse cookies, and revokes them on logout", async () => {
    const c = new Client();
    const login = await c.req("/api/auth/login", {
      body: { email: `${tag}-a@test.local`, password },
      headers: { "x-session-transport": "token" },
    });
    expect(login.status).toBe(200);
    expect(login.json.sessionToken).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
    const setCookie = (login.res.headers.getSetCookie?.() ?? []).join(";");
    expect(setCookie).not.toContain("ce_session="); // token transport sets no cookie
    const bearer = { authorization: `Bearer ${login.json.sessionToken}` };

    const ctx = await new Client().req("/api/me/context", { headers: bearer });
    expect(ctx.status).toBe(200);
    expect(ctx.json.user.email).toBe(`${tag}-a@test.local`);
    expect(ctx.json.settings.currency).toBeTruthy();
    expect((await new Client().req("/api/products", { headers: bearer })).status).toBe(200);
    expect((await new Client().req("/api/auth/session", { headers: bearer })).json).toEqual({ authenticated: true });

    expect((await new Client().req("/api/me/context")).status).toBe(401); // no credential
    expect((await new Client().req("/api/me/context", { headers: { authorization: "Bearer not-a-real-token-value-000" } })).status).toBe(401);

    expect((await new Client().req("/api/auth/logout", { body: {}, headers: bearer })).status).toBe(200);
    expect((await new Client().req("/api/me/context", { headers: bearer })).status).toBe(401); // revoked
  });

  it("returns a generic password-reset response without exposing account existence or reset tokens", async () => {
    const known = await new Client().req("/api/auth/forgot", { body: { email: `${tag}-a@test.local` } });
    const unknown = await new Client().req("/api/auth/forgot", { body: { email: `${tag}-missing@test.local` } });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.json).toEqual(unknown.json);
    expect(known.json).not.toHaveProperty("delivered");
    expect(known.json).not.toHaveProperty("resetToken");
    expect(known.json).not.toHaveProperty("devLink"); // reset links are only ever emailed
  });

  it("serves the app shell to signed-out visitors without data; the workspace API stays protected", async () => {
    const r = await anon.req("/dashboard");
    expect(r.status).toBe(200); // the browser shell checks the session and sends signed-out visitors to /login
    expect((await anon.req("/api/me/context")).status).toBe(401);
    expect((await anon.req("/api/dashboard")).status).toBe(401);

    const verifyPage = await anon.req("/verify-email?token=abc");
    expect(verifyPage.status).toBe(200);
    expect(await verifyPage.res.text()).toContain("Verifying your email address");
  });

  it("rejects wrong passwords with a generic message", async () => {
    const r = await anon.req("/api/auth/login", { body: { email: `${tag}-a@test.local`, password: "wrong-password" } });
    expect(r.status).toBe(401);
    expect(r.json.error).toBe("Incorrect email or password.");
    const unknown = await anon.req("/api/auth/login", { body: { email: `${tag}-nobody@test.local`, password: "wrong-password" } });
    expect(unknown.json.error).toBe(r.json.error); // does not reveal whether the account exists
  });

  it("validates registration input", async () => {
    expect((await anon.req("/api/auth/register", { body: { fullName: "X", businessName: "Y", email: "nope", password: "short" } })).status).toBe(400);
    expect((await anon.req("/api/auth/register", { body: { fullName: "Dup", businessName: `${tag} Dup`, email: `${tag}-a@test.local`, password } })).status).toBe(409);
  });

  it("lets an owner create products and see them", async () => {
    const c = await A.req("/api/products", { body: { name: "Widget", sku: "W-1", price: 10, costPrice: 4, stockQty: 5 } });
    expect(c.status).toBe(201);
    productId = c.json.id;
    const l = await A.req("/api/products");
    expect(l.json.products.map((p: { id: string }) => p.id)).toContain(productId);
  });

  it("isolates data between businesses", async () => {
    const l = await B.req("/api/products");
    expect(l.status).toBe(200);
    expect(l.json.products).toHaveLength(0);
    expect((await B.req(`/api/products/${productId}`, { method: "PATCH", body: { name: "Hacked" } })).status).toBe(404);
    expect((await B.req("/api/inventory", { body: { productId, type: "restock", quantityChange: 5, reason: "attack" } })).status).toBe(404);
    const sell = await B.req("/api/sales", { body: { items: [{ productId, quantity: 1 }], paymentMethod: "card", idempotencyKey: `${tag}-cross-business-0001` } });
    expect(sell.status).toBe(422);
  });

  it("enforces roles on the server", async () => {
    const add = await A.req("/api/team", { body: { fullName: "Cashier One", email: `${tag}-c@test.local`, password, role: "cashier" } });
    expect(add.status).toBe(201);
    expect((await cashier.req("/api/auth/login", { body: { email: `${tag}-c@test.local`, password } })).status).toBe(200);

    for (const [method, path, body] of [
      ["GET", "/api/reports", undefined],
      ["GET", "/api/team", undefined],
      ["GET", "/api/settings", undefined],
      ["GET", "/api/audit", undefined],
      ["GET", "/api/export?type=sales", undefined],
      ["GET", "/api/inventory", undefined],
      ["POST", "/api/products", { name: "Nope", price: 1 }],
      ["PATCH", `/api/products/${productId}`, { price: 0 }],
      ["POST", "/api/team", { fullName: "Evil", email: `${tag}-evil@test.local`, password, role: "owner" }],
      ["PATCH", "/api/settings", { taxRate: 50 }],
    ] as const) {
      const r = await cashier.req(path, { method, body });
      expect(r.status, `${method} ${path}`).toBe(403);
    }
    const prods = await cashier.req("/api/products");
    expect(prods.status).toBe(200);
    expect(prods.json.products[0].costPrice).toBeNull(); // cost prices are hidden from cashiers
  });

  it("lets a cashier sell; totals come from the server and duplicates are ignored", async () => {
    const key = `${tag}-sale-key-000001`;
    const body = { items: [{ productId, quantity: 2 }], paymentMethod: "cash", amountTendered: 50, discountType: "none", discountValue: 0, idempotencyKey: key, total: 0.01 };
    const r = await cashier.req("/api/sales", { body });
    expect(r.status).toBe(201);
    expect(r.json.sale.total).toBe("20.00"); // client-supplied "total" is ignored
    expect(r.json.sale.changeDue).toBe("30.00");
    saleId = r.json.sale.id;
    const again = await cashier.req("/api/sales", { body });
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(again.json.sale.id).toBe(saleId);
    const prods = await A.req("/api/products");
    expect(prods.json.products.find((p: { id: string }) => p.id === productId).stockQty).toBe(3);
  });

  it("refuses to oversell via the API", async () => {
    const r = await cashier.req("/api/sales", { body: { items: [{ productId, quantity: 99 }], paymentMethod: "card", idempotencyKey: `${tag}-oversell-00001` } });
    expect(r.status).toBe(409);
  });

  it("validates sale input", async () => {
    const bad = await cashier.req("/api/sales", { body: { items: [{ productId, quantity: -1 }], paymentMethod: "card", idempotencyKey: `${tag}-bad-qty-000001` } });
    expect(bad.status).toBe(400);
    const short = await cashier.req("/api/sales", { body: { items: [{ productId, quantity: 1 }], paymentMethod: "cash", amountTendered: 1, idempotencyKey: `${tag}-short-cash-0001` } });
    expect(short.status).toBe(422);
    const notJson = await cashier.req("/api/sales", { raw: "items=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(notJson.status).toBe(415);
  });

  it("restricts sale visibility and refunds", async () => {
    expect((await cashier.req(`/api/sales/${saleId}`)).status).toBe(200); // own sale
    expect((await B.req(`/api/sales/${saleId}`)).status).toBe(404); // other business
    const refund = { kind: "refund", items: [], reason: "test refund", restock: true };
    expect((await cashier.req(`/api/sales/${saleId}/refund`, { body: refund })).status).toBe(403);
    expect((await B.req(`/api/sales/${saleId}/refund`, { body: { kind: "void", reason: "attack", restock: true } })).status).toBe(404);
    const ok = await A.req(`/api/sales/${saleId}/refund`, { body: { kind: "void", reason: "Owner cancelled this", restock: true } });
    expect(ok.status).toBe(200);
    expect(ok.json.sale.status).toBe("voided");
    const prods = await A.req("/api/products");
    expect(prods.json.products.find((p: { id: string }) => p.id === productId).stockQty).toBe(5);
  });

  it("serves CSV exports to authorised users only", async () => {
    const r = await A.req("/api/export?type=sales");
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-type")).toContain("text/csv");
  });

  it("invalidates the session on logout", async () => {
    const c = new Client();
    await c.req("/api/auth/login", { body: { email: `${tag}-b@test.local`, password } });
    expect((await c.req("/api/products")).status).toBe(200);
    const old = c.cookie;
    await c.req("/api/auth/logout", { body: {} });
    const replay = new Client();
    replay.cookie = old;
    expect((await replay.req("/api/products")).status).toBe(401);
  });
});
