"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { formatDate, formatDateTime, formatMoney } from "@/lib/money";
import { can as canDo, type Permission, type Role } from "@/lib/permissions";

export interface AppSettings {
  currency: string;
  locale: string;
  timezone: string;
  taxName: string;
  taxRate: string;
  taxInclusive: boolean;
  defaultLowStockThreshold: number;
  allowNegativeStock: boolean;
  receiptWidth: string;
  receiptBusinessName: string;
}

export interface AppValue {
  user: { id: string; email: string; fullName: string; phone: string | null };
  business: { id: string; name: string };
  role: Role;
  settings: AppSettings;
}

const Ctx = createContext<AppValue | null>(null);

export function AppProvider({ value, children }: { value: AppValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return useMemo(
    () => ({
      ...v,
      can: (p: Permission) => canDo(v.role, p),
      money: (n: number | string | null | undefined) => formatMoney(n, v.settings.currency, v.settings.locale),
      dateTime: (iso: string | Date) => formatDateTime(iso, v.settings.timezone, v.settings.locale),
      date: (iso: string | Date) => formatDate(iso, v.settings.timezone, v.settings.locale),
    }),
    [v],
  );
}
