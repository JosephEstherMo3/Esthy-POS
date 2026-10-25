"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppProvider, type AppValue } from "@/components/app-context";
import { AppShell } from "@/components/app-shell";
import { BrandLogo } from "@/components/brand";
import { Alert, Button, Spinner } from "@/components/ui";
import { apiFetch, ApiError, clearStoredSessionToken } from "@/lib/client";

type State =
  | { status: "loading" }
  | { status: "ready"; value: AppValue }
  | { status: "signed-out" }
  | { status: "error"; message: string };

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-5 py-10">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex justify-center"><BrandLogo /></div>
        {children}
      </div>
    </main>
  );
}

/**
 * Loads the signed-in workspace in the browser, so the app works whether the session is a cookie or a token
 * kept in this tab (embedded previews). Every data request is still checked by the server.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AppValue>("/api/me/context")
      .then((value) => {
        if (!cancelled) setState({ status: "ready", value });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err as ApiError;
        if (e.status === 401) {
          clearStoredSessionToken();
          setState({ status: "signed-out" });
        } else {
          setState({ status: "error", message: e.message || "We couldn't load your account. Please try again." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (state.status === "signed-out") window.location.replace("/login");
  }, [state.status]);

  if (state.status === "ready") {
    return (
      <AppProvider value={state.value}>
        <AppShell>{children}</AppShell>
      </AppProvider>
    );
  }
  if (state.status === "error") {
    return (
      <Frame>
        <Alert tone="error">{state.message}</Alert>
        <Button onClick={() => { setState({ status: "loading" }); setAttempt((a) => a + 1); }}>Try again</Button>
      </Frame>
    );
  }
  if (state.status === "signed-out") {
    return <Frame><p className="text-sm text-slate-600" role="status">Redirecting to sign in…</p></Frame>;
  }
  return (
    <Frame>
      <div className="flex items-center justify-center gap-3 text-sm text-slate-600" role="status">
        <Spinner /> Loading your workspace…
      </div>
    </Frame>
  );
}
