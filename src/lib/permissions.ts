/**
 * Role → permission matrix. This is enforced on the server by `route()` in
 * src/lib/api.ts; the UI only uses it to decide what to display.
 */
export type Role = "owner" | "manager" | "cashier";

export const PERMISSIONS = [
  "dashboard.view",
  "pos.sell",
  "sales.view_own",
  "sales.view_all",
  "sales.refund",
  "products.view",
  "products.manage",
  "inventory.adjust",
  "cost.view",
  "customers.view",
  "customers.manage",
  "customers.delete",
  "reports.view",
  "expenses.view",
  "expenses.manage",
  "data.export",
  "team.view",
  "team.manage",
  "settings.manage",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const cashier: Permission[] = [
  "dashboard.view",
  "pos.sell",
  "sales.view_own",
  "products.view",
  "customers.view",
  "customers.manage",
];

const manager: Permission[] = [
  ...cashier,
  "sales.view_all",
  "sales.refund",
  "products.manage",
  "inventory.adjust",
  "cost.view",
  "customers.delete",
  "reports.view",
  "expenses.view",
  "expenses.manage",
  "data.export",
  "team.view",
  "team.manage",
  "audit.view",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  cashier,
  manager,
  owner: [...PERMISSIONS],
};

export const ROLE_LABELS: Record<Role, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier" };

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full access, including business settings, team roles, expenses and all reports.",
  manager: "Runs the shop: products, stock, refunds, expenses, reports, exports and cashier accounts.",
  cashier: "Makes sales, views products and customers, and sees only their own sales.",
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  "dashboard.view": "View dashboard",
  "pos.sell": "Make sales",
  "sales.view_own": "View own sales",
  "sales.view_all": "View all sales",
  "sales.refund": "Refund or cancel sales",
  "products.view": "View products",
  "products.manage": "Create, edit and archive products",
  "inventory.adjust": "Adjust stock",
  "cost.view": "See cost prices and profit",
  "customers.view": "View customers",
  "customers.manage": "Create and edit customers",
  "customers.delete": "Delete customers",
  "reports.view": "View reports and analytics",
  "expenses.view": "View expenses",
  "expenses.manage": "Record and manage expenses",
  "data.export": "Export data (CSV)",
  "team.view": "View team",
  "team.manage": "Manage team members",
  "settings.manage": "Change business settings",
  "audit.view": "View activity log",
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function canAny(role: Role | null | undefined, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export interface NavItem {
  href: string;
  label: string;
  icon: "dashboard" | "pos" | "receipts" | "products" | "customers" | "expenses" | "reports" | "team" | "settings";
  permission?: Permission;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "dashboard.view" },
  { href: "/pos", label: "New Sale", icon: "pos", permission: "pos.sell" },
  { href: "/sales", label: "Receipts & Sales", icon: "receipts", permission: "sales.view_own" },
  { href: "/products", label: "Products & Inventory", icon: "products", permission: "products.view" },
  { href: "/customers", label: "Customers", icon: "customers", permission: "customers.view" },
  { href: "/expenses", label: "Expenses", icon: "expenses", permission: "expenses.view" },
  { href: "/reports", label: "Reports & Analytics", icon: "reports", permission: "reports.view" },
  { href: "/team", label: "Team & Permissions", icon: "team", permission: "team.view" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function navForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((n) => !n.permission || can(role, n.permission));
}
