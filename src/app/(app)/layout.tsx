import type { ReactNode } from "react";
import { AppGate } from "@/components/app-gate";

/** Session checks happen in the browser (AppGate) and on every API route. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppGate>{children}</AppGate>;
}
