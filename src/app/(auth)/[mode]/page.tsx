import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AuthScreen, type AuthMode } from "@/components/auth-forms";

const MODES = ["login", "register", "forgot-password", "reset-password"] as const;

export const dynamicParams = false;

export function generateStaticParams() {
  return MODES.map((mode) => ({ mode }));
}

export default async function AuthPage({ params }: { params: Promise<{ mode: string }> }) {
  const { mode } = await params;
  if (!(MODES as readonly string[]).includes(mode)) notFound();
  return (
    <Suspense>
      <AuthScreen mode={mode as AuthMode} />
    </Suspense>
  );
}
