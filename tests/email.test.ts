import { afterEach, describe, expect, it, vi } from "vitest";
import { emailDeliveryStatus, resolveEmailConfig, sendPasswordResetEmail } from "@/lib/email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("email provider configuration", () => {
  it("reports no provider when credentials are absent", () => {
    expect(resolveEmailConfig({})).toEqual({ provider: null });
    expect(emailDeliveryStatus({})).toEqual({ configured: false, provider: null });
  });

  it("selects Resend when a key and verified sender are configured", () => {
    expect(resolveEmailConfig({ RESEND_API_KEY: "secret", EMAIL_FROM: "Shop <no-reply@example.com>" })).toEqual({
      provider: "resend",
      apiKey: "secret",
      from: "Shop <no-reply@example.com>",
    });
  });

  it("selects SMTP and defaults to STARTTLS on port 587", () => {
    expect(resolveEmailConfig({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "user",
      SMTP_PASSWORD: "smtp-secret",
      EMAIL_FROM: "no-reply@example.com",
    })).toMatchObject({ provider: "smtp", port: 587, secure: false, host: "smtp.example.com" });
  });

  it("uses implicit TLS on port 465 and supports an explicit sender", () => {
    expect(resolveEmailConfig({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_USER: "user",
      SMTP_PASSWORD: "smtp-secret",
      SMTP_FROM: "Charlotte Esthy <pos@example.com>",
    })).toMatchObject({ provider: "smtp", port: 465, secure: true, from: "Charlotte Esthy <pos@example.com>" });
  });

  it("rejects incomplete credentials and invalid ports", () => {
    expect(resolveEmailConfig({ SMTP_HOST: "smtp.example.com", SMTP_USER: "user", EMAIL_FROM: "a@b.test" })).toEqual({ provider: null });
    expect(resolveEmailConfig({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "bad", SMTP_USER: "u", SMTP_PASSWORD: "p", EMAIL_FROM: "a@b.test" })).toEqual({ provider: null });
  });

});

describe("password-reset email delivery", () => {
  it("sends a reset email through SMTP and returns no credentials", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "Charlotte Esthy <no-reply@example.com>");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("SMTP_USER", "smtp-user");
    vi.stubEnv("SMTP_PASSWORD", "smtp-secret");
    const smtpSend = vi.fn().mockResolvedValue(undefined);

    const result = await sendPasswordResetEmail("person@example.com", "https://pos.example.com/reset-password?token=abc123", { smtpSend });

    expect(result).toEqual({ configured: true, provider: "smtp", delivered: true });
    expect(JSON.stringify(result)).not.toContain("smtp-secret");
    expect(smtpSend).toHaveBeenCalledOnce();
    const [config, message] = smtpSend.mock.calls[0];
    expect(config).toMatchObject({ host: "smtp.example.com", port: 587, secure: false, username: "smtp-user" });
    expect(message).toMatchObject({ to: "person@example.com" });
    expect(config.from).toBe("Charlotte Esthy <no-reply@example.com>");
    expect(message.subject).toContain("Charlotte Esthy");
    expect(message.text).toContain("token=abc123");
    expect(message.html).toContain("https://pos.example.com/reset-password?token=abc123");
  });

  it("sends through Resend and HTML-escapes user-independent link content", async () => {
    vi.stubEnv("RESEND_API_KEY", "resend-secret");
    vi.stubEnv("EMAIL_FROM", "no-reply@example.com");
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await sendPasswordResetEmail("person@example.com", "https://pos.example.com/reset?token=x&next=\"bad\"", { fetcher });
    expect(result).toEqual({ configured: true, provider: "resend", delivered: true });
    const request = fetcher.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.to).toBe("person@example.com");
    expect(body.html).toContain("&amp;next=&quot;bad&quot;");
    expect(body.html).not.toContain("href=\"https://pos.example.com/reset?token=x&next=\"bad\"\"");
  });

  it("does not expose provider failures or message content to callers", async () => {
    vi.stubEnv("RESEND_API_KEY", "resend-secret");
    vi.stubEnv("EMAIL_FROM", "no-reply@example.com");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn().mockRejectedValue(new Error("SMTP auth secret and reset token leaked"));
    const result = await sendPasswordResetEmail("person@example.com", "https://example.test/reset?token=secret", { fetcher });
    expect(result).toEqual({ configured: true, provider: "resend", delivered: false });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("does not claim mail was sent when no provider is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("SMTP_HOST", "");
    const smtpSend = vi.fn();
    const result = await sendPasswordResetEmail("person@example.com", "https://example.test/reset", { smtpSend });
    expect(result).toEqual({ configured: false, provider: null, delivered: false });
    expect(smtpSend).not.toHaveBeenCalled();
  });
});
