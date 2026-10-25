"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, DollarSign, Package, Receipt, ShoppingCart, TrendingUp } from "lucide-react";
import { useApp } from "@/components/app-context";
import { BucketToggle, TrendChart, type Bucket, type SeriesPoint, type Summary } from "@/components/charts";
import { defaultRange, RangePicker, type DateRange } from "@/components/range-picker";
import { Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from "@/components/ui";
import { qs, useApi } from "@/lib/client";
import { STATUS_LABELS } from "@/lib/receipt";

interface Dash {
  range: { from: string; to: string; bucket: Bucket; today: string };
  today: Summary;
  summary: Summary;
  series: SeriesPoint[];
  topProducts: { productId: string | null; name: string; units: number; revenue: number }[];
  recent: { id: string; receiptNumber: string; createdAt: string; total: string; status: string; paymentMethod: string; cashierName: string | null; customerName: string | null }[];
  lowStock: { count: number; items: { id: string; name: string; stockQty: number; threshold: number }[] };
  hasSales: boolean;
  scope: "own" | "business";
}

export default function DashboardPage() {
  const app = useApp();
  const [range, setRange] = useState<DateRange>(() => defaultRange(app.settings.timezone, 7));
  const [bucket, setBucket] = useState<Bucket>("day");
  const { data, error, loading, reload } = useApi<Dash>(`/api/dashboard${qs({ from: range.from, to: range.to, bucket })}`);

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;

  const own = data?.scope === "own";
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={own ? `Your sales at ${app.business.name}` : `How ${app.business.name} is performing`}
        actions={<RangePicker value={range} onChange={setRange} />}
      />

      {!data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Today's revenue" value={app.money(data.today.net)} hint="Net of refunds" icon={<DollarSign className="h-5 w-5" />} tone="emerald" />
            <StatCard label="Transactions today" value={data.today.transactions} hint={data.today.refundCount > 0 ? `${data.today.refundCount} refund${data.today.refundCount === 1 ? "" : "s"} today` : "Completed sales"} icon={<Receipt className="h-5 w-5" />} />
            <StatCard label="Average transaction" value={app.money(data.today.average)} hint="Today" icon={<TrendingUp className="h-5 w-5" />} />
            <Link href="/products?filter=low" className="block rounded-2xl focus-visible:outline-offset-4">
              <StatCard label="Low-stock products" value={data.lowStock.count} hint={data.lowStock.count > 0 ? "Needs restocking" : "All stocked"} icon={<AlertTriangle className="h-5 w-5" />} tone={data.lowStock.count > 0 ? "amber" : "navy"} />
            </Link>
          </div>

          {!data.hasSales ? (
            <Card className="mt-6">
              <EmptyState
                icon={<ShoppingCart className="h-6 w-6" />}
                title="No sales yet"
                description="Your dashboard will fill with real revenue, best sellers and trends as soon as you complete your first sale."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {app.can("pos.sell") && <Link href="/pos" className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700">Make your first sale</Link>}
                    {app.can("products.manage") && <Link href="/products" className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">Add products</Link>}
                  </div>
                }
              />
            </Card>
          ) : (
            <>
              <Card className="mt-6">
                <CardHeader title="Revenue trend" description={`${range.from} → ${range.to}`} action={<BucketToggle value={bucket} onChange={setBucket} />} />
                <div className="grid gap-4 p-5 lg:grid-cols-[1fr_220px]">
                  <TrendChart data={data.series} metric="net" bucket={bucket} />
                  <dl className="tabular grid grid-cols-2 gap-3 text-sm lg:grid-cols-1 lg:content-start">
                    {[
                      ["Net revenue", app.money(data.summary.net)],
                      ["Gross sales", app.money(data.summary.gross)],
                      ["Refunds", app.money(data.summary.refunds)],
                      ["Transactions", String(data.summary.transactions)],
                      ["Average sale", app.money(data.summary.average)],
                      ["Discounts given", app.money(data.summary.discounts)],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                        <dt className="text-xs text-slate-500">{k}</dt>
                        <dd className="font-semibold text-slate-900">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </Card>

              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Best-selling products" description="By units sold in the selected range" />
                  {data.topProducts.length === 0 ? (
                    <EmptyState title="No product sales in this range" />
                  ) : (
                    <ol className="divide-y divide-slate-100">
                      {data.topProducts.map((p, i) => (
                        <li key={`${p.productId}-${p.name}`} className="flex items-center gap-3 px-5 py-3">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy-50 text-xs font-semibold text-navy-700">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{p.name}</span>
                          <span className="tabular text-sm text-slate-500">{p.units} sold</span>
                          <span className="tabular w-24 text-right text-sm font-semibold text-slate-900">{app.money(p.revenue)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Recent transactions" action={<Link href="/sales" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">View all</Link>} />
                  <ul className="divide-y divide-slate-100">
                    {data.recent.map((s) => (
                      <li key={s.id}>
                        <Link href={`/sales/${s.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                          <div className="min-w-0 flex-1">
                            <p className="tabular text-sm font-medium text-slate-900">{s.receiptNumber}</p>
                            <p className="truncate text-xs text-slate-500">{app.dateTime(s.createdAt)}{s.customerName ? ` · ${s.customerName}` : ""}</p>
                          </div>
                          {s.status !== "completed" && <Badge tone={s.status === "partially_refunded" ? "amber" : "red"}>{STATUS_LABELS[s.status]}</Badge>}
                          <span className="tabular text-sm font-semibold text-slate-900">{app.money(s.total)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </>
          )}

          {data.lowStock.count > 0 && (
            <Card className="mt-6">
              <CardHeader title="Low stock" description="Products at or below their alert threshold" action={<Link href="/products?filter=low" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">Manage stock</Link>} />
              <ul className="divide-y divide-slate-100">
                {data.lowStock.items.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <Package className="h-4 w-4 text-amber-600" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{p.name}</span>
                    <Badge tone={p.stockQty <= 0 ? "red" : "amber"}>{p.stockQty <= 0 ? "Out of stock" : `${p.stockQty} left`}</Badge>
                    <span className="hidden text-xs text-slate-500 sm:inline">alert at {p.threshold}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
