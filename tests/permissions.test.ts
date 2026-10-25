import { describe, expect, it } from "vitest";
import { hashPassword, hashToken, newToken, verifyPassword } from "@/lib/password";
import { can, navForRole, PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/permissions";

describe("role permissions", () => {
  it("owner can do everything", () => {
    for (const p of PERMISSIONS) expect(can("owner", p)).toBe(true);
  });
  it("manager runs the shop but cannot change business settings", () => {
    expect(can("manager", "sales.refund")).toBe(true);
    expect(can("manager", "reports.view")).toBe(true);
    expect(can("manager", "team.manage")).toBe(true);
    expect(can("manager", "settings.manage")).toBe(false);
  });
  it("cashier is restricted", () => {
    expect(can("cashier", "pos.sell")).toBe(true);
    expect(can("cashier", "sales.view_own")).toBe(true);
    for (const p of ["sales.view_all", "sales.refund", "products.manage", "inventory.adjust", "cost.view", "reports.view", "data.export", "team.manage", "settings.manage", "customers.delete"] as const) {
      expect(can("cashier", p), p).toBe(false);
    }
  });
  it("denies unknown or missing roles", () => {
    expect(can(null, "pos.sell")).toBe(false);
    expect(can(undefined, "pos.sell")).toBe(false);
  });
  it("cashier permissions are a subset of manager permissions", () => {
    for (const p of ROLE_PERMISSIONS.cashier) expect(ROLE_PERMISSIONS.manager).toContain(p);
  });
});

describe("role-based navigation", () => {
  const labels = (r: "owner" | "manager" | "cashier") => navForRole(r).map((n) => n.href);
  it("owner sees all 9 sections", () => expect(labels("owner")).toHaveLength(9));
  it("cashier sees only sale-related sections plus settings", () => {
    expect(labels("cashier")).toEqual(["/dashboard", "/pos", "/sales", "/products", "/customers", "/settings"]);
  });
  it("manager sees expenses, reports and team", () => {
    expect(labels("manager")).toContain("/expenses");
    expect(labels("manager")).toContain("/reports");
    expect(labels("manager")).toContain("/team");
  });
});

describe("password and token hashing", () => {
  it("verifies correct passwords and rejects wrong ones", async () => {
    const hash = await hashPassword("Correct Horse 9");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("Correct Horse 9", hash)).toBe(true);
    expect(await verifyPassword("correct horse 9", hash)).toBe(false);
  });
  it("uses a unique salt per hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "bcrypt:aa:bb")).toBe(false);
  });
  it("hashes session tokens deterministically and never equals the token", () => {
    const t = newToken();
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });
});
