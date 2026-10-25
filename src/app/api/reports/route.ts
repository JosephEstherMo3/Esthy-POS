import { parseQuery, route } from "@/lib/api";
import { resolveRange } from "@/lib/services/catalog";
import {
  getCashierPerformance,
  getExpensesReport,
  getGrossProfit,
  getInventoryReport,
  getPaymentMethods,
  getSeries,
  getSummary,
  getTopProducts,
} from "@/lib/services/reports";
import { rangeQuery } from "@/lib/validation";

export const GET = route({ permission: "reports.view" }, async ({ url, auth }) => {
  const q = parseQuery(url, rangeQuery);
  const tz = auth.settings.timezone;
  const { from, to } = resolveRange(q, tz, 30);
  const args = { businessId: auth.business.id, tz, from, to };

  const [summary, series, daily, topProducts, payments, cashiers, inventory, expenses, profit] = await Promise.all([
    getSummary(args),
    getSeries(args, q.bucket),
    getSeries(args, "day"),
    getTopProducts(args, 25),
    getPaymentMethods(args),
    getCashierPerformance(args),
    getInventoryReport(auth.business.id, auth.settings.defaultLowStockThreshold),
    getExpensesReport({ businessId: auth.business.id, from, to }),
    getGrossProfit(args),
  ]);

  const netProfit = profit.grossProfit - expenses.total;

  return {
    range: { from, to, bucket: q.bucket, timezone: tz },
    summary,
    series,
    daily,
    topProducts,
    payments,
    cashiers,
    inventory,
    expenses,
    profit: {
      ...profit,
      netProfit,
    },
  };
});

