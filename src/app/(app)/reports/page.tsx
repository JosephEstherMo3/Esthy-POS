"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { useApp } from "@/components/app-context";
import { BucketToggle, fmtBucket, TrendChart, type Bucket, type SeriesPoint, type Summary } from "@/components/charts";
import { defaultRange, RangePicker, type DateRange } from "@/components/range-picker";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, Tabs, useToast } from "@/components/ui";
import { downloadBlob, qs, useApi } from "@/lib/client";
import { PAYMENT_LABELS, toCsv } from "@/lib/receipt";

interface Rep {
  range: { from: string; to: string; bucket: Bucket; timezone: string };
  summary: Summary;
  series: SeriesPoint[];
  topProducts: { productId: string | null; name: string; sku: string | null; units: number; revenue: number; profit: number }[];
  payments: { method: string; count: number; amount: number }[];
  cashiers: { userId: string; name: string; transactions: number; gross: number; average: number; discounts: number }[];
  inventory: {
    items: { id: string; name: string; sku: string | null; category: string | null; stockQty: number; threshold: number; price: number; costPrice: number; valueAtCost: number; valueAtRetail: number; low: boolean }[];
    totals: { products: number; units: number; valueAtCost: number; valueAtRetail: number; lowStock: number };
  };
  expenses?: {
    total: number;
    count: number;
    categories: { category: string; color: string; count: number; total: number }[];
  };
  profit?: {
    revenue: number;
    cost: number;
    grossProfit: number;
    netProfit: number;
  };
}

type TabId = "overview" | "products" | "inventory" | "payments" | "cashiers" | "discounts" | "expenses";

function Table({ head, rows, empty }: { head: { label: string; right?: boolean }[]; rows: (string | number | React.ReactNode)[][]; empty: string }) {
  if (rows.length === 0) return <EmptyState title={empty} description="Try widening the date range." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((h, i) => <th key={i} scope="col" className={`px-5 py-3 font-medium ${h.right ? "text-right" : ""}`}>{h.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50/70">
              {r.map((c, j) => <td key={j} className={`px-5 py-3 ${head[j]?.right ? "tabular text-right" : ""} ${j === 0 ? "font-medium text-slate-900" : "text-slate-700"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const app = useApp();
  const toast = useToast();
  const [range, setRange] = useState<DateRange>(() => defaultRange(app.settings.timezone, 30));
  const [bucket, setBucket] = useState<Bucket>("day");
  const [tab, setTab] = useState<TabId>("overview");
  const [pdfBusy, setPdfBusy] = useState(false);
  const { data, error, loading, reload } = useApi<Rep>(`/api/reports${qs({ from: range.from, to: range.to, bucket })}`);
  const m = app.money;
  const locale = app.settings.locale;

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;

  const bucketLabel = bucket === "day" ? "Daily" : bucket === "week" ? "Weekly" : "Monthly";
  const seriesRows = (d: Rep) => d.series.map((s) => [fmtBucket(s.bucket, bucket, locale), s.transactions, m(s.gross), m(s.refunds), m(s.net)]);

  function tables(d: Rep) {
    const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "0%");
    const sections: Record<TabId, { title: string; head: string[]; rows: string[][] }> = {
      overview: { title: `${bucketLabel} sales summary`, head: ["Period", "Transactions", "Gross sales", "Refunds", "Net revenue"], rows: seriesRows(d).map((r) => r.map(String)) },
      products: { title: "Product performance", head: ["Product", "SKU", "Units sold", "Item sales", ...(app.can("cost.view") ? ["Profit"] : [])], rows: d.topProducts.map((p) => [p.name, p.sku ?? "", String(p.units), m(p.revenue), ...(app.can("cost.view") ? [m(p.profit)] : [])]) },
      inventory: { title: "Inventory valuation", head: ["Product", "SKU", "Category", "Stock", "Value at cost", "Value at retail", "Status"], rows: d.inventory.items.map((i) => [i.name, i.sku ?? "", i.category ?? "", String(i.stockQty), m(i.valueAtCost), m(i.valueAtRetail), i.low ? "Low" : "OK"]) },
      payments: { title: "Payment methods", head: ["Method", "Transactions", "Amount", "Share"], rows: d.payments.map((p) => [PAYMENT_LABELS[p.method] ?? p.method, String(p.count), m(p.amount), pct(p.amount, d.summary.gross)]) },
      cashiers: { title: "Cashier performance", head: ["Cashier", "Transactions", "Gross sales", "Average sale", "Discounts given"], rows: d.cashiers.map((c) => [c.name, String(c.transactions), m(c.gross), m(c.average), m(c.discounts)]) },
      discounts: { title: "Discounts & refunds", head: ["Metric", "Value"], rows: [["Discounts given", m(d.summary.discounts)], ["Sales with a discount", String(d.summary.discountedSales)], ["Refunds", m(d.summary.refunds)], ["Refund transactions", String(d.summary.refundCount)], ["Cancelled sales", String(d.summary.voids)], ["Tax collected", m(d.summary.tax)]] },
      expenses: { title: "Expenses by category", head: ["Category", "Expenses recorded", "Total spent", "Share of expenses"], rows: (d.expenses?.categories ?? []).map((c) => [c.category, String(c.count), m(c.total), pct(c.total, d.expenses?.total ?? 1)]) },
    };
    return sections;
  }

  function exportCsv() {
    if (!data) return;
    const s = tables(data)[tab];
    downloadBlob("\uFEFF" + toCsv(s.head, s.rows), `charlotte-esthy_${tab}_${range.from}_to_${range.to}.csv`, "text/csv;charset=utf-8");
  }

  async function exportPdf() {
    if (!data) return;
    setPdfBusy(true);
    try {
      const { downloadTablesPdf } = await import("@/lib/pdf");
      const t = tables(data);
      const dm = (n: number) => app.money(n).replace(/\u00a0/g, " ");
      void dm;
      await downloadTablesPdf({
        filename: `charlotte-esthy_report_${range.from}_to_${range.to}.pdf`,
        title: `${app.business.name} — Sales report`,
        subtitle: `${range.from} to ${range.to} · timezone ${data.range.timezone} · generated ${app.dateTime(new Date())}`,
        summary: [
          ["Net revenue", m(data.summary.net)],
          ["Gross sales", m(data.summary.gross)],
          ["Refunds", m(data.summary.refunds)],
          ["Transactions", String(data.summary.transactions)],
          ["Average sale", m(data.summary.average)],
          ["Discounts given", m(data.summary.discounts)],
          ["Tax collected", m(data.summary.tax)],
          ...(data.expenses
            ? ([
                ["Total Expenses", m(data.expenses.total)],
                ["Net Profit", m(data.profit?.netProfit ?? 0)],
              ] as [string, string][])
            : []),
        ],
        sections: [
          t.overview,
          t.products,
          t.payments,
          ...(data.cashiers.length ? [t.cashiers] : []),
          t.inventory,
          t.discounts,
          ...(data.expenses ? [t.expenses] : []),
        ],
      });
    } catch {
      toast.error("Could not create the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  const tabsDef: { id: TabId; label: string }[] = [
    { id: "overview", label: "Sales overview" },
    { id: "products", label: "Products" },
    { id: "inventory", label: "Inventory" },
    { id: "payments", label: "Payments" },
    { id: "cashiers", label: "Cashiers" },
    { id: "discounts", label: "Discounts & refunds" },
    ...(app.can("expenses.view") ? [{ id: "expenses" as TabId, label: "Expenses & Profit" }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Reports & analytics"
        description={`All figures use ${app.settings.timezone} day boundaries.`}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={!data}><Download className="h-4 w-4" /> CSV</Button>
            <Button variant="secondary" onClick={exportPdf} loading={pdfBusy} disabled={!data}><FileText className="h-4 w-4" /> PDF</Button>
          </>
        }
      />
      <div className="mb-5"><RangePicker value={range} onChange={setRange} /></div>
      <Tabs tabs={tabsDef} value={tab} onChange={setTab} />

      {!data ? (
        <div className="space-y-4"><div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-72" /></div>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {tab === "overview" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Net revenue" value={m(data.summary.net)} hint={`Gross ${m(data.summary.gross)} − refunds ${m(data.summary.refunds)}`} tone="emerald" />
                <StatCard label="Transactions" value={data.summary.transactions} hint={`${data.summary.voids} cancelled`} />
                <StatCard label="Average sale" value={m(data.summary.average)} />
                <StatCard label="Discounts given" value={m(data.summary.discounts)} hint={`${data.summary.discountedSales} discounted sales`} tone="amber" />
              </div>
              {data.summary.transactions === 0 && data.summary.refundCount === 0 ? (
                <Card><EmptyState title="No sales in this period" description="Pick another date range, or complete a sale to see analytics." /></Card>
              ) : (
                <>
                  <div className="grid gap-6 lg:grid-cols-2">
                    <Card><CardHeader title="Net revenue" action={<BucketToggle value={bucket} onChange={setBucket} />} /><div className="p-5"><TrendChart data={data.series} metric="net" bucket={bucket} /></div></Card>
                    <Card><CardHeader title="Transactions" /><div className="p-5"><TrendChart data={data.series} metric="transactions" bucket={bucket} /></div></Card>
                  </div>
                  <Card>
                    <CardHeader title={`${bucketLabel} sales report`} />
                    <Table head={[{ label: "Period" }, { label: "Transactions", right: true }, { label: "Gross sales", right: true }, { label: "Refunds", right: true }, { label: "Net revenue", right: true }]} rows={seriesRows(data)} empty="No data" />
                  </Card>
                </>
              )}
            </div>
          )}
          {tab === "products" && (
            <Card><CardHeader title="Product performance" description="Top sellers by units, net of refunds" />
              <Table head={[{ label: "Product" }, { label: "Units sold", right: true }, { label: "Item sales", right: true }, ...(app.can("cost.view") ? [{ label: "Profit", right: true }] : [])]} rows={data.topProducts.map((p) => [p.name, p.units, m(p.revenue), ...(app.can("cost.view") ? [m(p.profit)] : [])])} empty="No product sales in this period" />
            </Card>
          )}
          {tab === "inventory" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Active products" value={data.inventory.totals.products} />
                <StatCard label="Units in stock" value={data.inventory.totals.units} />
                <StatCard label="Value at cost" value={m(data.inventory.totals.valueAtCost)} tone="emerald" />
                <StatCard label="Low stock" value={data.inventory.totals.lowStock} tone={data.inventory.totals.lowStock ? "amber" : "navy"} />
              </div>
              <Card><CardHeader title="Inventory valuation" description="Current stock — not limited by the date range" />
                <Table head={[{ label: "Product" }, { label: "Category" }, { label: "Stock", right: true }, { label: "Value at cost", right: true }, { label: "Value at retail", right: true }, { label: "Status" }]} rows={data.inventory.items.map((i) => [i.name, i.category ?? "—", i.stockQty, m(i.valueAtCost), m(i.valueAtRetail), <Badge key={i.id} tone={i.low ? "amber" : "emerald"}>{i.low ? "Low" : "OK"}</Badge>])} empty="No products yet" />
              </Card>
            </div>
          )}
          {tab === "payments" && (
            <Card><CardHeader title="Payment methods" />
              <Table head={[{ label: "Method" }, { label: "Transactions", right: true }, { label: "Amount", right: true }, { label: "Share", right: true }]} rows={data.payments.map((p) => [PAYMENT_LABELS[p.method] ?? p.method, p.count, m(p.amount), data.summary.gross > 0 ? `${((p.amount / data.summary.gross) * 100).toFixed(1)}%` : "0%"])} empty="No payments in this period" />
            </Card>
          )}
          {tab === "cashiers" && (
            <Card><CardHeader title="Cashier performance" />
              <Table head={[{ label: "Cashier" }, { label: "Transactions", right: true }, { label: "Gross sales", right: true }, { label: "Average sale", right: true }, { label: "Discounts", right: true }]} rows={data.cashiers.map((c) => [c.name, c.transactions, m(c.gross), m(c.average), m(c.discounts)])} empty="No cashier activity in this period" />
            </Card>
          )}
          {tab === "discounts" && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <StatCard label="Discounts given" value={m(data.summary.discounts)} hint={`${data.summary.discountedSales} of ${data.summary.transactions} sales`} tone="amber" />
              <StatCard label="Refunds" value={m(data.summary.refunds)} hint={`${data.summary.refundCount} refund transaction(s)`} tone="red" />
              <StatCard label="Cancelled sales" value={data.summary.voids} hint={`${m(data.summary.voidedAmount)} reversed`} tone="red" />
              <StatCard label="Tax collected" value={m(data.summary.tax)} />
            </div>
          )}
          {tab === "expenses" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Net sales revenue"
                  value={m(data.summary.net)}
                  hint={`Gross ${m(data.summary.gross)} − refunds ${m(data.summary.refunds)}`}
                  tone="emerald"
                />
                <StatCard
                  label="Cost of goods sold"
                  value={m(data.profit?.cost ?? 0)}
                  hint="Product procurement costs"
                />
                <StatCard
                  label="Operating expenses"
                  value={m(data.expenses?.total ?? 0)}
                  hint={`${data.expenses?.count ?? 0} expense(s) logged`}
                  tone="red"
                />
                <StatCard
                  label="Net business profit"
                  value={m(data.profit?.netProfit ?? 0)}
                  hint={`Gross profit ${m(data.profit?.grossProfit ?? 0)} − Expenses ${m(data.expenses?.total ?? 0)}`}
                  tone={(data.profit?.netProfit ?? 0) >= 0 ? "emerald" : "red"}
                />
              </div>

              <Card>
                <CardHeader
                  title="Expenses by category"
                  description="Where your shop's operating funds were spent in this timeframe."
                />
                <Table
                  head={[
                    { label: "Category" },
                    { label: "Expenses count", right: true },
                    { label: "Total spent", right: true },
                    { label: "Share of expenses", right: true },
                  ]}
                  rows={(data.expenses?.categories ?? []).map((c) => [
                    <div key={c.category} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                      <span>{c.category}</span>
                    </div>,
                    c.count,
                    m(c.total),
                    data.expenses?.total ? `${((c.total / data.expenses.total) * 100).toFixed(1)}%` : "0%",
                  ])}
                  empty="No expenses recorded in this period"
                />
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
