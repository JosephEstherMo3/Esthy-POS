import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { addDays } from "@/lib/money";

export type Bucket = "day" | "week" | "month";

export interface RangeArgs {
  businessId: string;
  /** Inclusive start date, YYYY-MM-DD, interpreted in `tz`. */
  from: string;
  /** Inclusive end date, YYYY-MM-DD, interpreted in `tz`. */
  to: string;
  tz: string;
  /** When set, restricts to a single cashier (used for cashier-scoped views). */
  cashierId?: string | null;
}

async function q<T>(query: SQL): Promise<T[]> {
  const r = await db.execute(query);
  return r.rows as T[];
}

/** Correct local-day boundaries: [start of `from`, start of day after `to`) in the business timezone. */
function bounds(a: RangeArgs) {
  return {
    start: sql`((${a.from}::date)::timestamp at time zone ${a.tz})`,
    end: sql`(((${a.to}::date) + 1)::timestamp at time zone ${a.tz})`,
  };
}

function saleWhere(a: RangeArgs): SQL {
  const { start, end } = bounds(a);
  return sql`s.business_id = ${a.businessId} and s.created_at >= ${start} and s.created_at < ${end} ${
    a.cashierId ? sql`and s.cashier_id = ${a.cashierId}` : sql``
  }`;
}

function refundWhere(a: RangeArgs): SQL {
  const { start, end } = bounds(a);
  return sql`r.business_id = ${a.businessId} and r.created_at >= ${start} and r.created_at < ${end} ${
    a.cashierId ? sql`and s.cashier_id = ${a.cashierId}` : sql``
  }`;
}

export async function getSummary(a: RangeArgs) {
  const [s] = await q<{
    transactions: number;
    gross: string;
    subtotal: string;
    discounts: string;
    discounted_sales: number;
    tax: string;
  }>(sql`
    select count(*)::int as transactions,
      coalesce(sum(s.total), 0)::text as gross,
      coalesce(sum(s.subtotal), 0)::text as subtotal,
      coalesce(sum(s.discount_amount), 0)::text as discounts,
      (count(*) filter (where s.discount_amount > 0))::int as discounted_sales,
      coalesce(sum(s.tax_amount), 0)::text as tax
    from sales s where ${saleWhere(a)} and s.status <> 'voided'`);
  const [rf] = await q<{ count: number; amount: string }>(sql`
    select count(*)::int as count, coalesce(sum(r.amount), 0)::text as amount
    from refunds r join sales s on s.id = r.sale_id
    where ${refundWhere(a)} and r.kind = 'refund'`);
  const [vd] = await q<{ count: number; amount: string }>(sql`
    select count(*)::int as count, coalesce(sum(r.amount), 0)::text as amount
    from refunds r join sales s on s.id = r.sale_id
    where ${refundWhere(a)} and r.kind = 'void'`);
  const gross = Number(s.gross);
  const refunded = Number(rf.amount);
  return {
    transactions: s.transactions,
    gross,
    refunds: refunded,
    refundCount: rf.count,
    voids: vd.count,
    voidedAmount: Number(vd.amount),
    net: gross - refunded,
    average: s.transactions > 0 ? gross / s.transactions : 0,
    discounts: Number(s.discounts),
    discountedSales: s.discounted_sales,
    tax: Number(s.tax),
  };
}

export async function getSeries(a: RangeArgs, bucket: Bucket) {
  const { start, end } = bounds(a);
  const saleRows = await q<{ bucket: string; transactions: number; gross: string }>(sql`
    select to_char(date_trunc(${bucket}::text, s.created_at at time zone ${a.tz}), 'YYYY-MM-DD') as bucket,
      count(*)::int as transactions, coalesce(sum(s.total), 0)::text as gross
    from sales s where ${saleWhere(a)} and s.status <> 'voided' group by 1 order by 1`);
  const refundRows = await q<{ bucket: string; amount: string }>(sql`
    select to_char(date_trunc(${bucket}::text, r.created_at at time zone ${a.tz}), 'YYYY-MM-DD') as bucket,
      coalesce(sum(r.amount), 0)::text as amount
    from refunds r join sales s on s.id = r.sale_id
    where ${refundWhere(a)} and r.kind = 'refund' group by 1 order by 1`);
  void start;
  void end;

  const map = new Map<string, { bucket: string; transactions: number; gross: number; refunds: number }>();
  if (bucket === "day") {
    let d = a.from;
    for (let i = 0; i < 400 && d <= a.to; i++) {
      map.set(d, { bucket: d, transactions: 0, gross: 0, refunds: 0 });
      d = addDays(d, 1);
    }
  }
  for (const r of saleRows) {
    const e = map.get(r.bucket) ?? { bucket: r.bucket, transactions: 0, gross: 0, refunds: 0 };
    e.transactions = r.transactions;
    e.gross = Number(r.gross);
    map.set(r.bucket, e);
  }
  for (const r of refundRows) {
    const e = map.get(r.bucket) ?? { bucket: r.bucket, transactions: 0, gross: 0, refunds: 0 };
    e.refunds = Number(r.amount);
    map.set(r.bucket, e);
  }
  return [...map.values()]
    .sort((x, y) => x.bucket.localeCompare(y.bucket))
    .map((e) => ({ ...e, net: Math.round((e.gross - e.refunds) * 100) / 100 }));
}

export async function getTopProducts(a: RangeArgs, limit = 10) {
  const rows = await q<{ product_id: string | null; name: string; sku: string | null; units: number; revenue: string; profit: string }>(sql`
    select si.product_id, si.name, max(si.sku) as sku,
      sum(si.quantity - si.refunded_quantity)::int as units,
      coalesce(sum(si.line_total * (si.quantity - si.refunded_quantity) / si.quantity), 0)::text as revenue,
      coalesce(sum((si.unit_price - si.unit_cost) * (si.quantity - si.refunded_quantity)), 0)::text as profit
    from sale_items si join sales s on s.id = si.sale_id
    where ${saleWhere(a)} and s.status <> 'voided'
    group by si.product_id, si.name
    having sum(si.quantity - si.refunded_quantity) > 0
    order by units desc, revenue desc limit ${limit}`);
  return rows.map((r) => ({ productId: r.product_id, name: r.name, sku: r.sku, units: r.units, revenue: Number(r.revenue), profit: Number(r.profit) }));
}

export async function getPaymentMethods(a: RangeArgs) {
  const rows = await q<{ method: string; count: number; amount: string }>(sql`
    select s.payment_method::text as method, count(*)::int as count, coalesce(sum(s.total), 0)::text as amount
    from sales s where ${saleWhere(a)} and s.status <> 'voided' group by 1 order by 3 desc`);
  return rows.map((r) => ({ method: r.method, count: r.count, amount: Number(r.amount) }));
}

export async function getCashierPerformance(a: RangeArgs) {
  const rows = await q<{ user_id: string; name: string; count: number; gross: string; discounts: string }>(sql`
    select s.cashier_id as user_id, u.full_name as name, count(*)::int as count,
      coalesce(sum(s.total), 0)::text as gross, coalesce(sum(s.discount_amount), 0)::text as discounts
    from sales s join users u on u.id = s.cashier_id
    where ${saleWhere(a)} and s.status <> 'voided' group by s.cashier_id, u.full_name order by 4 desc`);
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    transactions: r.count,
    gross: Number(r.gross),
    average: r.count ? Number(r.gross) / r.count : 0,
    discounts: Number(r.discounts),
  }));
}

export async function getLowStock(businessId: string, defaultThreshold: number, limit = 8) {
  const rows = await q<{ id: string; name: string; sku: string | null; stock_qty: number; threshold: number }>(sql`
    select p.id, p.name, p.sku, p.stock_qty, coalesce(p.low_stock_threshold, ${defaultThreshold})::int as threshold
    from products p
    where p.business_id = ${businessId} and p.is_active and p.stock_qty <= coalesce(p.low_stock_threshold, ${defaultThreshold})
    order by p.stock_qty asc, p.name asc`);
  return {
    count: rows.length,
    items: rows.slice(0, limit).map((r) => ({ id: r.id, name: r.name, sku: r.sku, stockQty: r.stock_qty, threshold: r.threshold })),
  };
}

export async function getRecentSales(a: { businessId: string; cashierId?: string | null }, limit = 8) {
  const rows = await q<{
    id: string;
    receipt_number: string;
    created_at: Date;
    total: string;
    status: string;
    payment_method: string;
    cashier: string | null;
    customer: string | null;
  }>(sql`
    select s.id, s.receipt_number, s.created_at, s.total::text as total, s.status::text as status,
      s.payment_method::text as payment_method, u.full_name as cashier, c.name as customer
    from sales s left join users u on u.id = s.cashier_id left join customers c on c.id = s.customer_id
    where s.business_id = ${a.businessId} ${a.cashierId ? sql`and s.cashier_id = ${a.cashierId}` : sql``}
    order by s.created_at desc limit ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    receiptNumber: r.receipt_number,
    createdAt: new Date(r.created_at).toISOString(),
    total: r.total,
    status: r.status,
    paymentMethod: r.payment_method,
    cashierName: r.cashier,
    customerName: r.customer,
  }));
}

export async function getInventoryReport(businessId: string, defaultThreshold: number) {
  const rows = await q<{
    id: string;
    name: string;
    sku: string | null;
    category: string | null;
    stock_qty: number;
    price: string;
    cost_price: string;
    threshold: number;
  }>(sql`
    select p.id, p.name, p.sku, c.name as category, p.stock_qty, p.price::text as price, p.cost_price::text as cost_price,
      coalesce(p.low_stock_threshold, ${defaultThreshold})::int as threshold
    from products p left join categories c on c.id = p.category_id
    where p.business_id = ${businessId} and p.is_active order by p.name`);
  const items = rows.map((r) => {
    const stock = Math.max(0, r.stock_qty);
    return {
      id: r.id,
      name: r.name,
      sku: r.sku,
      category: r.category,
      stockQty: r.stock_qty,
      threshold: r.threshold,
      price: Number(r.price),
      costPrice: Number(r.cost_price),
      valueAtCost: Math.round(stock * Number(r.cost_price) * 100) / 100,
      valueAtRetail: Math.round(stock * Number(r.price) * 100) / 100,
      low: r.stock_qty <= r.threshold,
    };
  });
  return {
    items,
    totals: {
      products: items.length,
      units: items.reduce((s, i) => s + Math.max(0, i.stockQty), 0),
      valueAtCost: items.reduce((s, i) => s + i.valueAtCost, 0),
      valueAtRetail: items.reduce((s, i) => s + i.valueAtRetail, 0),
      lowStock: items.filter((i) => i.low).length,
    },
  };
}

export async function hasAnySales(businessId: string, cashierId?: string | null) {
  const rows = await q<{ n: number }>(sql`
    select count(*)::int as n from (select 1 from sales s where s.business_id = ${businessId}
    ${cashierId ? sql`and s.cashier_id = ${cashierId}` : sql``} limit 1) t`);
  return (rows[0]?.n ?? 0) > 0;
}

export async function getExpensesReport(a: { businessId: string; from: string; to: string }) {
  const rows = await q<{ category: string | null; color: string | null; count: number; total: string }>(sql`
    select ec.name as category, ec.color as color, count(e.id)::int as count, coalesce(sum(e.amount), 0)::text as total
    from expenses e left join expense_categories ec on ec.id = e.category_id
    where e.business_id = ${a.businessId} and e.date >= ${a.from} and e.date <= ${a.to}
    group by ec.name, ec.color order by 4 desc`);
  const total = rows.reduce((s, r) => s + Number(r.total), 0);
  return {
    total,
    count: rows.reduce((s, r) => s + r.count, 0),
    categories: rows.map((r) => ({
      category: r.category || "Uncategorized",
      color: r.color || "#94a3b8",
      count: r.count,
      total: Number(r.total),
    })),
  };
}

export async function getGrossProfit(a: RangeArgs) {
  const [row] = await q<{ revenue: string; cost: string; profit: string }>(sql`
    select
      coalesce(sum(si.line_total * (si.quantity - si.refunded_quantity) / si.quantity), 0)::text as revenue,
      coalesce(sum(si.unit_cost * (si.quantity - si.refunded_quantity)), 0)::text as cost,
      coalesce(sum((si.unit_price - si.unit_cost) * (si.quantity - si.refunded_quantity)), 0)::text as profit
    from sale_items si join sales s on s.id = si.sale_id
    where ${saleWhere(a)} and s.status <> 'voided' and si.quantity > si.refunded_quantity`);
  return {
    revenue: Number(row?.revenue || 0),
    cost: Number(row?.cost || 0),
    grossProfit: Number(row?.profit || 0),
  };
}

