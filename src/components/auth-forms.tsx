"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { BarChart3, Boxes, CheckCircle2, Eye, EyeOff, ReceiptText, ShieldCheck } from "lucide-react";
import { Attribution, BrandLogo } from "@/components/brand";
import { Alert, Button, TextField } from "@/components/ui";
import { ApiError, apiFetch, clearStoredSessionToken, storeSessionToken } from "@/lib/client";

export type AuthMode = "login" | "register" | "forgot-password" | "reset-password";

function PasswordField({ label, value, onChange, error, autoComplete, hint }: { label: string; value: string; onChange: (v: string) => void; error?: string; autoComplete: string; hint?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <TextField label={label} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} error={error} hint={hint} autoComplete={autoComplete} required />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-[30px] rounded p-1 text-slate-500 hover:text-slate-800"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Embedded pages (for example a preview panel) receive their session as a token that they keep in this tab only. */
function sessionTransportHeaders(): Record<string, string> {
  return typeof window !== "undefined" && window.top !== window.self ? { "x-session-transport": "token" } : {};
}

function useSubmit() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  async function run(fn: () => Promise<void>, e?: FormEvent) {
    e?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setFields({});
    try {
      await fn();
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message || "Something went wrong. Please try again.");
      setFields(ae.fieldErrors ?? {});
    } finally {
      setLoading(false);
    }
  }

  return { loading, error, fields, run, setError, setFields };
}

/** Confirms the session is active in this browsing context, then opens dashboard or POS. */
async function completeSignIn(sessionToken?: string, role?: string) {
  if (sessionToken) storeSessionToken(sessionToken);
  const s = await apiFetch<{ authenticated: boolean; role?: string }>("/api/auth/session");
  if (s.authenticated) {
    const activeRole = role || s.role;
    window.location.href = activeRole === "cashier" ? "/pos" : "/dashboard";
    return;
  }
  if (sessionToken) clearStoredSessionToken();
  throw new ApiError("Your sign-in could not be kept in this browser. Open the app's address in a regular browser tab and sign in there.", 0);
}

function ResendVerification({ email }: { email: string }) {
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" | "error"; message?: string }>({ status: "idle" });
  async function resend() {
    setState({ status: "sending" });
    try {
      const res = await apiFetch<{ emailConfigured: boolean }>("/api/auth/resend-verification", { method: "POST", body: { email } });
      setState(
        res.emailConfigured
          ? { status: "sent", message: `If ${email} needs verification, a new link has been sent. Check your inbox and spam folder.` }
          : { status: "error", message: "Email delivery is not configured on this server, so verification emails cannot be sent yet." },
      );
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <Button variant="secondary" size="sm" onClick={resend} loading={state.status === "sending"}>Send a new verification email</Button>
      {state.message && <p role="status" className="text-xs text-slate-700">{state.message}</p>}
    </div>
  );
}

/** Shown after registration. Verification is only required when email delivery is configured. */
function RegisteredPanel({
  email,
  verificationRequired,
  delivered,
  sessionToken,
}: {
  email: string;
  verificationRequired: boolean;
  delivered: boolean;
  sessionToken?: string;
}) {
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState("");

  if (!verificationRequired) {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
          <div>
            <p className="font-semibold text-emerald-950 text-base">Account Created Successfully!</p>
            <p className="mt-1 text-sm text-emerald-800">
              Your business account for <strong>{email}</strong> has been created. You can now sign in using your credentials.
            </p>
          </div>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="space-y-2.5 pt-1">
          <Link
            href={`/login?registered=1&email=${encodeURIComponent(email)}`}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-navy-900 text-sm font-semibold text-white hover:bg-navy-800 transition shadow-sm"
          >
            Continue to Sign In
          </Link>
          {sessionToken && (
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              loading={entering}
              onClick={async () => {
                setEntering(true);
                setError("");
                try {
                  await completeSignIn(sessionToken);
                } catch (err) {
                  setError((err as Error).message);
                  setEntering(false);
                }
              }}
            >
              Enter Dashboard Directly
            </Button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
        <div>
          <p className="font-semibold text-emerald-950 text-base">Account Created Successfully!</p>
          <p className="mt-1 text-sm text-emerald-800">Verify your email address to finish setting it up.</p>
        </div>
      </div>
      {delivered ? (
        <Alert tone="info">We sent a verification link to <strong>{email}</strong>. Open it on this device to confirm your address. Check your spam folder if it does not arrive.</Alert>
      ) : (
        <Alert tone="warning">We could not send the verification email to <strong>{email}</strong>. Try sending it again in a moment.</Alert>
      )}
      <ResendVerification email={email} />
      <Link href={`/login?registered=1&email=${encodeURIComponent(email)}`} className="block text-center text-sm font-medium text-emerald-700 hover:text-emerald-800">Back to sign in</Link>
    </div>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [unverified, setUnverified] = useState<string | null>(null);
  const s = useSubmit();

  useEffect(() => {
    const qEmail = params.get("email");
    if (qEmail) setEmail(qEmail);
  }, [params]);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) =>
        s.run(async () => {
          setUnverified(null);
          try {
            const result = await apiFetch<{ sessionToken?: string; role?: string }>("/api/auth/login", {
              method: "POST",
              body: { email: email.trim(), password },
              headers: sessionTransportHeaders(),
            });
            await completeSignIn(result.sessionToken, result.role);
          } catch (err) {
            if ((err as ApiError).code === "EMAIL_NOT_VERIFIED") setUnverified(email.trim().toLowerCase());
            throw err;
          }
        }, e)
      }
    >
      {params.get("registered") && (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          <div>
            <p className="font-semibold">Account created successfully!</p>
            <p className="text-xs text-emerald-800 mt-0.5">Please enter your password to sign in to your store.</p>
          </div>
        </div>
      )}
      {params.get("expired") && <Alert tone="warning">Your session expired. Please sign in again.</Alert>}
      {params.get("reset") && <Alert tone="success">Password updated. You can now sign in.</Alert>}
      {params.get("verified") && <Alert tone="success">Your email is verified. You can now sign in.</Alert>}
      {s.error && <Alert tone="error">{s.error}</Alert>}
      {unverified && (
        <Alert tone="warning">
          <p>Your email address is not verified yet. Open the verification link we sent to {unverified}.</p>
          <ResendVerification email={unverified} />
        </Alert>
      )}
      <TextField label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={s.fields.email} autoComplete="email" required autoFocus />
      <PasswordField label="Password" value={password} onChange={setPassword} error={s.fields.password} autoComplete="current-password" />
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">Forgot password?</Link>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={s.loading}>{s.loading ? "Signing in…" : "Sign in"}</Button>
      <p className="text-center text-sm text-slate-600">
        New to Charlotte Esthy? <Link href="/register" className="font-medium text-emerald-700 hover:text-emerald-800">Create a business account</Link>
      </p>
    </form>
  );
}

function RegisterForm() {
  const [v, setV] = useState({ fullName: "", businessName: "", email: "", password: "", confirm: "" });
  const [registered, setRegistered] = useState<{ email: string; verificationRequired: boolean; delivered: boolean; sessionToken?: string } | null>(null);
  const s = useSubmit();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  if (registered) return <RegisteredPanel {...registered} />;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) =>
        s.run(async () => {
          if (v.password !== v.confirm) {
            s.setFields({ confirm: "Passwords do not match" });
            throw new ApiError("Passwords do not match", 0, { confirm: "Passwords do not match" });
          }
          const result = await apiFetch<{ email: string; verificationRequired: boolean; delivered?: boolean; sessionToken?: string }>("/api/auth/register", {
            method: "POST",
            body: { fullName: v.fullName, businessName: v.businessName, email: v.email.trim(), password: v.password },
            headers: sessionTransportHeaders(),
          });
          setRegistered({
            email: result.email,
            verificationRequired: Boolean(result.verificationRequired),
            delivered: Boolean(result.delivered),
            sessionToken: result.sessionToken,
          });
        }, e)
      }
    >
      {s.error && <Alert tone="error">{s.error}</Alert>}
      <TextField label="Your full name" value={v.fullName} onChange={set("fullName")} error={s.fields.fullName} autoComplete="name" required autoFocus />
      <TextField label="Business name" value={v.businessName} onChange={set("businessName")} error={s.fields.businessName} autoComplete="organization" required />
      <TextField label="Email address" type="email" value={v.email} onChange={set("email")} error={s.fields.email} autoComplete="email" required />
      <PasswordField label="Password" value={v.password} onChange={(x) => setV((p) => ({ ...p, password: x }))} error={s.fields.password} autoComplete="new-password" hint="At least 8 characters." />
      <TextField label="Confirm password" type="password" value={v.confirm} onChange={set("confirm")} error={s.fields.confirm} autoComplete="new-password" required />
      <Button type="submit" size="lg" className="w-full" loading={s.loading}>{s.loading ? "Creating account…" : "Create account"}</Button>
      <p className="text-center text-sm text-slate-600">
        Already registered? <Link href="/login" className="font-medium text-emerald-700 hover:text-emerald-800">Sign in</Link>
      </p>
    </form>
  );
}

function ForgotForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<{ emailConfigured: boolean; emailProvider?: "resend" | "smtp" | null } | null>(null);
  const s = useSubmit();
  if (done)
    return (
      <div className="space-y-4">
        <Alert tone="success">
          If this email address belongs to an account, password-reset instructions will be sent when email delivery is available. Check your inbox and spam folder.
        </Alert>
        {!done.emailConfigured && (
          <Alert tone="warning">
            <p className="font-semibold">Password-reset email is not configured on this server.</p>
            <p className="mt-1">No email was sent. The person who deploys Charlotte Esthy must configure one mail provider and redeploy:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong>Resend:</strong> set <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code>.</li>
              <li><strong>SMTP:</strong> set <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code>, and <code>EMAIL_FROM</code>; optionally set <code>SMTP_PORT</code> (587 by default) and <code>SMTP_SECURE</code> (true for port 465).</li>
              <li>Set <code>APP_URL</code> to the public HTTPS app URL, then request a fresh reset link.</li>
            </ul>
          </Alert>
        )}
        {done.emailConfigured && (
          <Alert tone="info">
            Email delivery is configured{done.emailProvider ? ` through ${done.emailProvider === "resend" ? "Resend" : "SMTP"}` : ""}. If no message arrives after a few minutes, ask the server administrator to check provider credentials, sender-domain verification, and mail delivery logs.
          </Alert>
        )}
        <Link href="/login" className="block text-center text-sm font-medium text-emerald-700">Back to sign in</Link>
      </div>
    );
  return (
    <form noValidate className="space-y-4" onSubmit={(e) => s.run(async () => { setDone(await apiFetch("/api/auth/forgot", { method: "POST", body: { email } })); }, e)}>
      {s.error && <Alert tone="error">{s.error}</Alert>}
      <TextField label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={s.fields.email} autoComplete="email" required autoFocus />
      <Button type="submit" size="lg" className="w-full" loading={s.loading}>Send reset link</Button>
      <Link href="/login" className="block text-center text-sm font-medium text-emerald-700">Back to sign in</Link>
    </form>
  );
}

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const s = useSubmit();
  if (!token) return <Alert tone="error">This reset link is missing its token. Please request a new link from the sign-in page.</Alert>;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) =>
        s.run(async () => {
          if (password !== confirm) throw new ApiError("Passwords do not match", 0, { confirm: "Passwords do not match" });
          await apiFetch("/api/auth/reset", { method: "POST", body: { token, password } });
          window.location.href = "/login?reset=1";
        }, e)
      }
    >
      {s.error && <Alert tone="error">{s.error}</Alert>}
      <PasswordField label="New password" value={password} onChange={setPassword} error={s.fields.password} autoComplete="new-password" hint="At least 8 characters." />
      <TextField label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={s.fields.confirm} autoComplete="new-password" required />
      <Button type="submit" size="lg" className="w-full" loading={s.loading}>Update password</Button>
    </form>
  );
}

const COPY: Record<AuthMode, { title: string; subtitle: string }> = {
  login: { title: "Welcome back", subtitle: "Sign in to continue to your point of sale." },
  register: { title: "Create your business account", subtitle: "Set up Charlotte Esthy in a minute — you will be the owner." },
  "forgot-password": { title: "Reset your password", subtitle: "Enter your email and we'll create a secure reset link." },
  "reset-password": { title: "Choose a new password", subtitle: "Pick a strong password you haven't used before." },
};

export function AuthScreen({ mode }: { mode: AuthMode }) {
  const copy = COPY[mode];
  let form: ReactNode;
  if (mode === "login") form = <LoginForm />;
  else if (mode === "register") form = <RegisterForm />;
  else if (mode === "forgot-password") form = <ForgotForm />;
  else form = <ResetForm />;

  const features = [
    { icon: ReceiptText, text: "Receipts you can print, download and share" },
    { icon: Boxes, text: "Live inventory with full stock history" },
    { icon: BarChart3, text: "Sales analytics from your real data" },
    { icon: ShieldCheck, text: "Role-based access for every team member" },
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-navy-600/30 blur-3xl" />
        <BrandLogo light size={44} />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Sell faster. Know your numbers. Stay in control.</h2>
          <p className="mt-4 text-navy-200">A calm, dependable point of sale built for shops that care about every receipt.</p>
          <ul className="mt-8 space-y-4">
            {features.map((f) => (
              <li key={f.text} className="flex items-center gap-3 text-sm text-navy-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-emerald-400"><f.icon className="h-[18px] w-[18px]" /></span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <Attribution light className="relative" />
      </aside>

      <main className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 lg:hidden"><BrandLogo /></div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{copy.title}</h1>
          <p className="mb-6 mt-1.5 text-sm text-slate-500">{copy.subtitle}</p>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">{form}</div>
          <Attribution className="mt-8" />
        </div>
      </main>
    </div>
  );
}
