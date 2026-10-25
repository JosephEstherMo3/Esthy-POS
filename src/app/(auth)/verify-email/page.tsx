import { Suspense } from "react";
import { VerifyEmail } from "@/components/verify-email";

export const dynamic = "force-dynamic";

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
