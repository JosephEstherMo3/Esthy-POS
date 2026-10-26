const { Pool } = require("pg");
require("dotenv/config");

const BASE = "http://localhost:3000";

async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const sessionCookie = setCookies.find((c) => c.startsWith("ce_session="));
  let json = null;
  try { json = await res.clone().json(); } catch {}
  return { status: res.status, json, sessionCookie };
}

async function runTests() {
  const results = [];
  const testEmail = `e2e_test_${Date.now()}@example.com`;

  // Test 1: Register new user
  const t1 = await req("/api/auth/register", {
    body: { fullName: "E2E Test User", businessName: "E2E Store", email: testEmail, password: "SecurePass1!" },
  });
  results.push({ test: "1. Register new user", pass: t1.status === 200 && t1.json && t1.json.ok === true, detail: `${t1.status} ${JSON.stringify(t1.json).slice(0, 80)}` });

  // Test 2: Duplicate email
  const t2 = await req("/api/auth/register", {
    body: { fullName: "Dup User", businessName: "Dup Store", email: testEmail, password: "SecurePass1!" },
  });
  results.push({ test: "2. Duplicate email → 409", pass: t2.status === 409, detail: `${t2.status} ${t2.json && t2.json.error}` });

  // Test 3: Invalid email format
  const t3 = await req("/api/auth/register", {
    body: { fullName: "User", businessName: "Store", email: "not-an-email", password: "SecurePass1!" },
  });
  results.push({ test: "3. Invalid email → 400", pass: t3.status === 400, detail: `${t3.status} ${t3.json && t3.json.error}` });

  // Test 4: Missing required fields
  const t4 = await req("/api/auth/register", { body: { email: "x@x.com", password: "SecurePass1!" } });
  results.push({ test: "4. Missing fullName/businessName → 400", pass: t4.status === 400, detail: `${t4.status} ${JSON.stringify(t4.json && t4.json.fieldErrors)}` });

  // Test 5: Password too short
  const t5 = await req("/api/auth/register", {
    body: { fullName: "User", businessName: "Store", email: "short@pass.com", password: "123" },
  });
  results.push({ test: "5. Password too short → 400", pass: t5.status === 400, detail: `${t5.status} ${t5.json && t5.json.error}` });

  // Test 6: Successful login
  const t6 = await req("/api/auth/login", { body: { email: testEmail, password: "SecurePass1!" } });
  const cookie = t6.sessionCookie;
  results.push({ test: "6. Login succeeds with role=owner", pass: t6.status === 200 && t6.json && t6.json.role === "owner", detail: `${t6.status} role:${t6.json && t6.json.role}` });

  // Test 7: Wrong password
  const t7 = await req("/api/auth/login", { body: { email: testEmail, password: "WrongPass!" } });
  results.push({ test: "7. Wrong password → 401", pass: t7.status === 401, detail: `${t7.status} ${t7.json && t7.json.error}` });

  // Test 8: Unknown email
  const t8 = await req("/api/auth/login", { body: { email: "nobody_xyz@example.com", password: "SecurePass1!" } });
  results.push({ test: "8. Unknown email → 401", pass: t8.status === 401, detail: `${t8.status} ${t8.json && t8.json.error}` });

  // Test 9: Protected route without auth
  const t9 = await req("/api/me/context");
  results.push({ test: "9. Unauthenticated /api/me/context → 401", pass: t9.status === 401, detail: `${t9.status}` });

  if (cookie) {
    const cookieVal = cookie.split(";")[0];

    // Test 10: Session cookie works
    const t10 = await req("/api/me/context", { headers: { Cookie: cookieVal } });
    results.push({ test: "10. Session cookie works", pass: t10.status === 200 && t10.json && t10.json.user && t10.json.user.email === testEmail, detail: `${t10.status} user:${t10.json && t10.json.user && t10.json.user.email}` });

    // Test 11: Auth session check
    const t11 = await req("/api/auth/session", { headers: { Cookie: cookieVal } });
    results.push({ test: "11. /auth/session → authenticated:true", pass: t11.json && t11.json.authenticated === true, detail: JSON.stringify(t11.json) });

    // Test 12: Logout
    const t12 = await req("/api/auth/logout", { method: "POST", body: {}, headers: { Cookie: cookieVal } });
    results.push({ test: "12. Logout → 200", pass: t12.status === 200, detail: `${t12.status}` });

    // Test 13: Session invalid after logout
    const t13 = await req("/api/me/context", { headers: { Cookie: cookieVal } });
    results.push({ test: "13. Session rejected after logout → 401", pass: t13.status === 401, detail: `${t13.status}` });
  }

  // Test 14: Missing fields for login
  const t14 = await req("/api/auth/login", { body: { email: "" } });
  results.push({ test: "14. Empty login fields → 400", pass: t14.status === 400, detail: `${t14.status} ${t14.json && t14.json.error}` });

  // Cleanup test data
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query("DELETE FROM users WHERE email = $1", [testEmail]);
  await pool.end();

  console.log("\n=== AUTH E2E TEST RESULTS ===");
  results.forEach((r) => console.log((r.pass ? "PASS" : "FAIL") + " | " + r.test + " | " + r.detail));
  const passing = results.filter((r) => r.pass).length;
  console.log("\n" + passing + "/" + results.length + " tests passed");
  if (passing < results.length) process.exit(1);
}

runTests().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
