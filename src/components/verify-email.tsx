"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Attribution, BrandLogo } from "@/components/brand";
import { Alert, Button, Spinner } from "@/components/ui";
import { apiFetch } from "@/lib/client";

type State = { status: "verifying" } | { status: "verified"; email: string } | { status: "error"; message: string };

export function VerifyEmail() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<State>({ status: "verifying" });
  // Strict Mode runs effects twice in development; a verification link is single use.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      window.setTimeout(() => setState({ status: "error", message: "This verification link is incomplete. Open the link from your email again." }), 0);
      return;
    }
    apiFetch<{ email: string }>("/api/auth/verify", { method: "POST", body: { token } })
      .then((res) => setState({ status: "verified", email: res.email }))
      .catch((err: Error) => setState({ status: "error", message: err.message || "We could not verify your email. Please try again." }));
  }, [token]);

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-5 py-10">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <BrandLogo />
        {state.status === "verifying" && (
          <div className="mt-8 flex items-center gap-3 text-sm text-slate-600" role="status">
            <Spinner /> Verifying your email address…
          </div>
        )}
        {state.status === "verified" && (
          <div className="mt-8 space-y-5">
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
              <div>
                <p className="font-semibold text-emerald-900">Your account has been created successfully.</p>
                <p className="mt-1 text-sm text-emerald-800">
                  {state.email} is verified. Sign in with the email address and password you used to create the account.
                </p>
              </div>
            </div>
            <Link href="/login?verified=1" className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-navy-900 text-sm font-semibold text-white hover:bg-navy-800">
              Sign in
            </Link>
          </div>
        )}
        {state.status === "error" && (
          <div className="mt-8 space-y-4">
            <Alert tone="error">{state.message}</Alert>
            <Link href="/login"><Button>Go to sign in</Button></Link>
          </div>
        )}
        <Attribution className="mt-8" />
      </section>
    </main>
  );
}
