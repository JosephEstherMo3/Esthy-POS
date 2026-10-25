import nodemailer from "nodemailer";

export type EmailProvider = "resend" | "smtp";

type Env = Record<string, string | undefined>;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailConfig =
  | { provider: "resend"; apiKey: string; from: string }
  | { provider: "smtp"; host: string; port: number; secure: boolean; username: string; password: string; from: string }
  | { provider: null };

export interface DeliveryResult {
  configured: boolean;
  provider: EmailProvider | null;
  delivered: boolean;
}

export interface EmailDependencies {
  fetcher?: typeof fetch;
  smtpSend?: (config: Extract<EmailConfig, { provider: "smtp" }>, message: EmailMessage) => Promise<void>;
}

/** Resolve a configured provider without returning any secret values to the client. Resend wins if complete. */
export function resolveEmailConfig(env: Env = process.env): EmailConfig {
  const from = env.EMAIL_FROM?.trim();
  const resendKey = env.RESEND_API_KEY?.trim();
  if (resendKey && from) return { provider: "resend", apiKey: resendKey, from };

  const host = env.SMTP_HOST?.trim();
  const username = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD;
  const smtpFrom = env.SMTP_FROM?.trim() || from;
  const parsedPort = Number(env.SMTP_PORT || 587);
  if (
    host && username && password && password.length > 0 && smtpFrom &&
    Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
  ) {
    const secureValue = env.SMTP_SECURE?.trim().toLowerCase();
    const secure = secureValue === "true" ? true : secureValue === "false" ? false : parsedPort === 465;
    return { provider: "smtp", host, port: parsedPort, secure, username, password, from: smtpFrom };
  }

  return { provider: null };
}

export function emailDeliveryStatus(env: Env = process.env): { configured: boolean; provider: EmailProvider | null } {
  const config = resolveEmailConfig(env);
  return { configured: config.provider !== null, provider: config.provider };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** Shared HTML layout for transactional email. */
function layout(heading: string, intro: string, buttonLabel: string, link: string, outro: string): { text: string; html: string } {
  const safeLink = escapeHtml(link);
  const text = `${heading}\n\n${intro}\n\n${buttonLabel}: ${link}\n\n${outro}\n\nCreated during internship at Hamplus Hub`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(intro)}</p><p><a href="${safeLink}" style="display:inline-block;background:#141d3d;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">${escapeHtml(buttonLabel)}</a></p><p>If the button does not work, copy this link into your browser:<br><a href="${safeLink}">${safeLink}</a></p><p>${escapeHtml(outro)}</p><hr><p style="font-size:12px;color:#64748b">Created during internship at Hamplus Hub</p></div>`;
  return { text, html };
}

export function passwordResetMessage(to: string, link: string): EmailMessage {
  const body = layout(
    "Reset your Charlotte Esthy password",
    "We received a request to reset your Charlotte Esthy password.",
    "Choose a new password",
    link,
    "This link expires in 60 minutes. If you did not request it, you can ignore this email.",
  );
  return { to, subject: "Reset your Charlotte Esthy password", text: body.text, html: body.html };
}

export function verificationMessage(to: string, link: string): EmailMessage {
  const body = layout(
    "Verify your email address",
    "Thank you for creating your Charlotte Esthy business account. Confirm this email address to finish setting up your account.",
    "Verify my email",
    link,
    "This link expires in 24 hours. If you did not create an account, you can ignore this email.",
  );
  return { to, subject: "Verify your Charlotte Esthy email address", text: body.text, html: body.html };
}

async function smtpSend(config: Extract<EmailConfig, { provider: "smtp" }>, message: EmailMessage): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Port 587 uses STARTTLS; fail closed rather than send credentials/content in plaintext.
    requireTLS: !config.secure,
    auth: { user: config.username, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transporter.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
  } finally {
    transporter.close();
  }
}

/** Sends one message through the configured provider. Returns safe status only (no secrets, links or raw provider errors). */
export async function sendEmail(message: EmailMessage, deps: EmailDependencies = {}): Promise<DeliveryResult> {
  const config = resolveEmailConfig();
  if (!config.provider) return { configured: false, provider: null, delivered: false };

  try {
    if (config.provider === "resend") {
      const fetcher = deps.fetcher ?? fetch;
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(12_000),
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: config.from, to: message.to, subject: message.subject, text: message.text, html: message.html }),
      });
      if (!response.ok) console.error("Email provider rejected delivery", { provider: "resend", status: response.status });
      return { configured: true, provider: "resend", delivered: response.ok };
    }

    await (deps.smtpSend ?? smtpSend)(config, message);
    return { configured: true, provider: "smtp", delivered: true };
  } catch (err) {
    // Do not print links, message bodies, recipients, auth data or raw SMTP responses.
    const e = err as { name?: string; code?: string };
    console.error("Email delivery failed", { provider: config.provider, error: e?.code ?? e?.name ?? "unknown" });
    return { configured: true, provider: config.provider, delivered: false };
  }
}

export function sendPasswordResetEmail(to: string, link: string, deps: EmailDependencies = {}): Promise<DeliveryResult> {
  return sendEmail(passwordResetMessage(to, link), deps);
}

export function sendVerificationEmail(to: string, link: string, deps: EmailDependencies = {}): Promise<DeliveryResult> {
  return sendEmail(verificationMessage(to, link), deps);
}
