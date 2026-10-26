"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  WalletCards,
  WifiOff,
  X,
} from "lucide-react";
import { Attribution, BrandLogo } from "@/components/brand";
import { useApp } from "@/components/app-context";
import { cn } from "@/components/ui";
import { apiFetch, clearStoredSessionToken, useApi, useOnline } from "@/lib/client";
import { navForRole, ROLE_LABELS, type NavItem } from "@/lib/permissions";

const ICONS = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  receipts: Receipt,
  products: Package,
  customers: Users,
  expenses: WalletCards,
  reports: BarChart3,
  team: ShieldCheck,
  settings: Settings,
} as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function SideNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-navy-200 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon className={cn("h-[18px] w-[18px]", active ? "text-emerald-400" : "text-navy-300 group-hover:text-white")} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );







}

function SidebarBody({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const { business, user, role } = useApp();
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <BrandLogo light />
      </div>
      <div className="mx-4 mb-4 rounded-xl bg-white/5 px-3 py-2.5">
        <p className="text-[11px] uppercase tracking-wider text-navy-300">Business</p>
        <p className="truncate text-sm font-medium text-white">{business.name}</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <SideNav items={items} onNavigate={onNavigate} />
      </div>
      <div className="border-t border-white/10 px-5 py-4">
        <p className="truncate text-sm font-medium text-white">{user.fullName}</p>
        <p className="text-xs text-navy-300">{ROLE_LABELS[role]}</p>
      </div>
    </div>
  );
}

function useClickOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function Notifications() {
  const { can } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  const { data } = useApi<{ lowStock: { count: number; items: { id: string; name: string; stockQty: number }[] } }>(can("products.view") ? "/api/notifications" : null);
  const count = data?.lowStock.count ?? 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${count ? `, ${count} low stock alerts` : ""}`}
        aria-expanded={open}
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{count > 9 ? "9+" : count}</span>}
      </button>
      {open && (
        <div className="ce-fade-in absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Low stock alerts</p>
          {count === 0 ? (
            <p className="px-2 py-4 text-sm text-slate-500">All products are sufficiently stocked.</p>
          ) : (
            <ul>
              {data?.lowStock.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm">
                  <span className="truncate text-slate-800">{i.name}</span>
                  <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">{i.stockQty} left</span>
                </li>
              ))}
            </ul>
          )}
          {count > 0 && (
            <Link href="/products?filter=low" onClick={() => setOpen(false)} className="mt-1 block rounded-lg px-2 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
              View all in inventory →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, role } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useClickOutside(open, () => setOpen(false));
  const initials = user.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  async function signOut() {
    setBusy(true);
    try {
      await apiFetch("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      clearStoredSessionToken();
      window.location.href = "/login";
    }
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu" className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">{initials}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-32 truncate text-sm font-medium text-slate-900">{user.fullName}</span>
          <span className="block text-xs text-slate-500">{ROLE_LABELS[role]}</span>
        </span>
      </button>
      {open && (
        <div className="ce-fade-in absolute right-0 z-40 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="border-b border-slate-100 px-2 pb-2">
            <p className="truncate text-sm font-medium text-slate-900">{user.fullName}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <Link href="/settings" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-100">
            <Settings className="h-4 w-4" /> Account & settings
          </Link>
          <button type="button" onClick={signOut} disabled={busy} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60">
            <LogOut className="h-4 w-4" /> {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function Breadcrumbs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const root = items.find((i) => i.href === "/" + parts[0]);
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1 text-xs text-slate-500">
      <Link href="/dashboard" className="hover:text-slate-800">Charlotte Esthy</Link>
      <ChevronRight className="h-3 w-3" aria-hidden />
      {parts.length > 1 ? (
        <>
          <Link href={"/" + parts[0]} className="hover:text-slate-800">{root?.label ?? parts[0]}</Link>
          <ChevronRight className="h-3 w-3" aria-hidden />
          <span aria-current="page" className="font-medium text-slate-700">Details</span>
        </>
      ) : (
        <span aria-current="page" className="font-medium text-slate-700">{root?.label ?? parts[0]}</span>
      )}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { role } = useApp();
  const items = navForRole(role);
  const pathname = usePathname();
  const router = useRouter();
  const online = useOnline();
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState("");
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!drawer) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);

  const primary = ["/dashboard", "/pos", "/sales", "/products"].map((h) => items.find((i) => i.href === h)).filter(Boolean) as NavItem[];

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-navy-900 lg:block">
        <SidebarBody items={items} />
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setDrawer(false)} />
          <div className="ce-fade-in absolute inset-y-0 left-0 w-72 max-w-[85%] bg-navy-900 shadow-2xl">
            <button ref={closeBtn} type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-3 top-4 rounded-lg p-1.5 text-navy-200 hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
            <SidebarBody items={items} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <form
            role="search"
            className="relative max-w-md flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              router.push(`/sales?q=${encodeURIComponent(q.trim())}`);
              setQ("");
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search receipts or customers"
              placeholder="Search receipts or customers…"
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <Notifications />
            <UserMenu />
          </div>
        </header>

        {!online && (
          <div role="alert" className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            You are offline. Changes and sales cannot be saved until your connection returns — nothing is queued offline.
          </div>
        )}

        <main className="relative mx-auto min-w-0 max-w-[1400px] overflow-x-clip px-4 pb-28 pt-5 sm:px-6 lg:pb-10" key={pathname.split("/")[1]}>
          <Breadcrumbs items={items} />
          <div className="ce-fade-in">{children}</div>
          <footer className="mt-12 border-t border-slate-200 pt-5">
            <Attribution />
            <p className="mt-1 text-center text-[11px] text-slate-400">© {new Date().getFullYear()} Charlotte Esthy</p>
          </footer>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-lg items-stretch justify-around">
          {primary.map((item) => {
            const Icon = ICONS[item.icon];
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="flex-1">
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-emerald-700" : "text-slate-500")}>
                  <Icon className="h-5 w-5" aria-hidden />
                  {item.label.split(" ")[0]}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button type="button" onClick={() => setDrawer(true)} className="flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-slate-500">
              <MoreHorizontal className="h-5 w-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
