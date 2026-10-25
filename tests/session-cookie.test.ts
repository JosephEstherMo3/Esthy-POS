import { describe, expect, it } from "vitest";
import { isHttpsRequest, sessionCookieOptions } from "@/lib/auth";

const h = (o: Record<string, string>) => new Headers(o);
const later = new Date(Date.now() + 1000);

describe("HTTPS detection behind reverse proxies", () => {
  it("detects https from any of the common signals", () => {
    expect(isHttpsRequest(h({ "x-forwarded-proto": "https" }))).toBe(true);
    expect(isHttpsRequest(h({ "x-forwarded-proto": "https,http" }))).toBe(true);
    expect(isHttpsRequest(h({ forwarded: "for=1.2.3.4;proto=https" }))).toBe(true);
    expect(isHttpsRequest(h({ "x-forwarded-ssl": "on" }))).toBe(true);
    expect(isHttpsRequest(h({ origin: "https://shop.example.com" }))).toBe(true); // proxy that forwards nothing
    expect(isHttpsRequest(h({ referer: "https://shop.example.com/register" }))).toBe(true);
    expect(isHttpsRequest(h({}), "https://shop.example.com/api/auth/login")).toBe(true);
  });
  it("treats plain http (local development) as not secure", () => {
    expect(isHttpsRequest(h({}))).toBe(false);
    expect(isHttpsRequest(h({ "x-forwarded-proto": "http", origin: "http://localhost:3000" }), "http://localhost:3000/x")).toBe(false);
  });
});

describe("session cookie attributes", () => {
  it("is SameSite=None; Secure; Partitioned over https so sign-in also works in embedded previews", () => {
    const o = sessionCookieOptions(true, later);
    expect(o).toMatchObject({ httpOnly: true, secure: true, sameSite: "none", partitioned: true, path: "/" });
  });
  it("is SameSite=Lax over plain http", () => {
    const o = sessionCookieOptions(false, later);
    expect(o).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax", path: "/" });
    expect("partitioned" in o).toBe(false);
  });
});
