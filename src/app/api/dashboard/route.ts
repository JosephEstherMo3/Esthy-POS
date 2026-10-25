import { parseQuery, route } from "@/lib/api";
import { can } from "@/lib/permissions";
import { resolveRange } from "@/lib/services/catalog";
import {
  getExpensesReport,
  getLowStock,
  getRecentSales,
  getSeries,
  getSummary,
  getTopProducts,
  hasAnySales,
} from "@/lib/services/reports";
import { rangeQuery } from "@/lib/validation";

export const GET = route({ permission: "dashboard.view" }, async ({ url, auth }) => {
  const q = parseQuery(url, rangeQuery);
  const tz = auth.settings.timezone;
  const { from, to, today } = resolveRange(q, tz, 7);
  const biz = auth.business.id;
  // Cashiers only see their own sales on the dashboard.
  const cashierId = can(auth.role, "sales.view_all") ? null : auth.user.id;
  const base = { businessId: biz, tz, cashierId };
  const canSeeExpenses = can(auth.role, "expenses.view");

  const [todaySummary, summary, series, topProducts, recent, lowStock, anySales, expenses] = await Promise.all([
    getSummary({ ...base, from: today, to: today }),
    getSummary({ ...base, from, to }),
    getSeries({ ...base, from, to }, q.bucket),
    getTopProducts({ ...base, from, to }, 6),
    getRecentSales({ businessId: biz, cashierId }, 8),
    getLowStock(biz, auth.settings.defaultLowStockThreshold, 6),
    hasAnySales(biz, cashierId),
    canSeeExpenses ? getExpensesReport({ businessId: biz, from, to }) : Promise.resolve(null),
  ]);

  return {
    range: { from, to, bucket: q.bucket, today },
    today: todaySummary,
    summary,
    series,
    topProducts,
    recent,
    lowStock,
    hasSales: anySales,
    scope: cashierId ? "own" : "business",
    expenses,
  };
});

