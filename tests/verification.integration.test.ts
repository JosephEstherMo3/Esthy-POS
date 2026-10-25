import { eq, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { emailVerifications, users } from "@/db/schema";
import { createEmailVerification, isEmailVerificationRequired, verifyEmailToken } from "@/lib/verification";
import { verificationMessage } from "@/lib/email";

const tag = `vfy${Date.now()}`;

async function newUser(name: string, verified: boolean) {
  const [u] = await db
    .insert(users)
    .values({ email: `${tag}-${name}@test.local`, passwordHash: "x", fullName: name, emailVerifiedAt: verified ? new Date() : null })
    .returning();
  return u;
}

afterAll(async () => {
  await db.delete(users).where(like(users.email, `${tag}%`));
  await pool.end();
});

describe("email verification", () => {
  it("requires verification only when a mail provider is configured", () => {
    expect(isEmailVerificationRequired({})).toBe(false);
    expect(isEmailVerificationRequired({ RESEND_API_KEY: "k", EMAIL_FROM: "a@b.test" })).toBe(true);
    expect(isEmailVerificationRequired({ SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASSWORD: "p", EMAIL_FROM: "a@b.test" })).toBe(true);
  });

  it("verifies an address with a single-use token and stores only its hash", async () => {
    const u = await newUser("single", false);
    const token = await createEmailVerification(u.id);
    const [row] = await db.select().from(emailVerifications).where(eq(emailVerifications.userId, u.id));
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).not.toContain(token);

    const result = await verifyEmailToken(token);
    expect(result.email).toBe(`${tag}-single@test.local`);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after.emailVerifiedAt).toBeInstanceOf(Date);

    await expect(verifyEmailToken(token)).rejects.toMatchObject({ status: 400 }); // cannot be reused
  });

  it("rejects unknown tokens and replaces older unused links when a new one is issued", async () => {
    await expect(verifyEmailToken("not-a-real-token-value-0000")).rejects.toMatchObject({ status: 400 });

    const u = await newUser("replace", false);
    const first = await createEmailVerification(u.id);
    const second = await createEmailVerification(u.id);
    await expect(verifyEmailToken(first)).rejects.toMatchObject({ status: 400 });
    await expect(verifyEmailToken(second)).resolves.toBeDefined();
  });

  it("builds a verification email that contains the link and the attribution", () => {
    const msg = verificationMessage("person@example.com", "https://pos.example.com/verify-email?token=abc");
    expect(msg.to).toBe("person@example.com");
    expect(msg.subject).toContain("Charlotte Esthy");
    expect(msg.text).toContain("https://pos.example.com/verify-email?token=abc");
    expect(msg.html).toContain("Created during internship at Hamplus Hub");
  });
});
