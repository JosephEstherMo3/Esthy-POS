"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Download, ReceiptText } from "lucide-react";
import { useApp } from "@/components/app-context";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Skeleton } from "@/components/ui";
import { qs, useApi, useDebounced } from "@/lib/client";
import { PAYMENT_LABELS, STATUS_LABELS } from "@/lib/receipt";

interface Row {
  id: string;
  receiptNumber: string;
  createdAt: string;
  total: string;
  refundedAmount: string;
  status: "completed" | "partially_refunded" | "refunded" | "voided";
  paymentMethod: string;
  cashierName: string | null;
  customerName: string | null;
  itemCount: number;
}
interface Res {
  sales: Row[];
  total: number;
  totalAmount: string;
  cashiers: { id: string; name: string }[];
}

const statusTone = (s: string) => (s === "completed" ? "emerald" : s === "partially_refunded" ? "amber" : "red") as "emerald" | "amber" | "red";

function SalesInner({ initialQ }: { initialQ: string }) {
  const app = useApp();
  const [q, setQ] = useState(initialQ);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [cashierId, setCashierId] = useState("");
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q, 300);
  const limit = 25;
  const query = qs({ q: dq.trim(), from, to, method, status, cashierId, limit, offset });
  const { data, error, loading, reload } = useApi<Res>(`/api/sales${query}`);
  const reset = (fn: () => void) => { fn(); setOffset(0); };

  const exportHref = `/api/export${qs({ type: "sales", from, to, method, status, cashierId })}`;

  return (
    <div>
      <PageHeader
        title="Receipts & sales"
        description={app.can("sales.view_all") ? "Every transaction for your business." : "Your transactions."}
        actions={
          app.can("data.export") && (
            <a href={exportHref} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50" title="Exports the selected dates (last 30 days when no dates are chosen)">
              <Download className="h-4 w-4" /> Export CSV
            </a>
          )
        }
      />
      <Card>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <Input aria-label="Search receipt number or customer" placeholder="Receipt # or customer…" value={q} onChange={(e) => reset(() => setQ(e.target.value))} className="lg:col-span-2" />
          <Input aria-label="From date" type="date" value={from} max={to || undefined} onChange={(e) => reset(() => setFrom(e.target.value))} />
          <Input aria-label="To date" type="date" value={to} min={from || undefined} onChange={(e) => reset(() => setTo(e.target.value))} />
          <Select aria-label="Payment method" value={method} onChange={(e) => reset(() => setMethod(e.target.value))}>
            <option value="">All payments</option>
            {Object.entries(PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Status" value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {app.can("sales.view_all") && (
            <Select aria-label="Cashier" value={cashierId} onChange={(e) => reset(() => setCashierId(e.target.value))} className="sm:col-span-2 lg:col-span-2">
              <option value="">All cashiers</option>
              {data?.cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          {(q || from || to || method || status || cashierId) && (
            <Button variant="ghost" onClick={() => { setQ(""); setFrom(""); setTo(""); setMethod(""); setStatus(""); setCashierId(""); setOffset(0); }}>Clear filters</Button>
          )}
        </div>

        {error && !data ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : data.sales.length === 0 ? (
          <EmptyState icon={<ReceiptText className="h-6 w-6" />} title="No sales found" description="Adjust the filters, or complete a sale to see it here." action={app.can("pos.sell") ? <Link href="/pos" className="inline-flex h-10 items-center rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700">New sale</Link> : undefined} />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <p className="tabular border-b border-slate-100 px-5 py-2.5 text-xs text-slate-500">
              {data.total} sale{data.total === 1 ? "" : "s"} · {app.money(data.totalAmount)} gross
            </p>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Receipt</th>
                    <th scope="col" className="px-3 py-3 font-medium">Date</th>
                    <th scope="col" className="px-3 py-3 font-medium">Customer</th>
                    {app.can("sales.view_all") && <th scope="col" className="px-3 py-3 font-medium">Cashier</th>}
                    <th scope="col" className="px-3 py-3 font-medium">Payment</th>
                    <th scope="col" className="px-3 py-3 font-medium">Status</th>
                    <th scope="col" className="px-5 py-3 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.sales.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3"><Link href={`/sales/${s.id}`} className="tabular font-medium text-navy-800 hover:underline">{s.receiptNumber}</Link></td>
                      <td className="px-3 py-3 text-slate-600">{app.dateTime(s.createdAt)}</td>
                      <td className="px-3 py-3 text-slate-600">{s.customerName ?? "Walk-in"}</td>
                      {app.can("sales.view_all") && <td className="px-3 py-3 text-slate-600">{s.cashierName ?? "—"}</td>}
                      <td className="px-3 py-3 text-slate-600">{PAYMENT_LABELS[s.paymentMethod]}</td>
                      <td className="px-3 py-3"><Badge tone={statusTone(s.status)}>{STATUS_LABELS[s.status]}</Badge></td>
                      <td className="tabular px-5 py-3 text-right font-semibold text-slate-900">{app.money(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-slate-100 md:hidden">
              {data.sales.map((s) => (
                <li key={s.id}>
                  <Link href={`/sales/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 active:bg-slate-50">
                    <div className="min-w-0">
                      <p className="tabular text-sm font-semibold text-navy-800">{s.receiptNumber}</p>
                      <p className="truncate text-xs text-slate-500">{app.dateTime(s.createdAt)} · {PAYMENT_LABELS[s.paymentMethod]}</p>
                      <p className="truncate text-xs text-slate-500">{s.customerName ?? "Walk-in"}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="tabular text-sm font-semibold text-slate-900">{app.money(s.total)}</span>
                      <Badge tone={statusTone(s.status)}>{STATUS_LABELS[s.status]}</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination offset={offset} limit={limit} total={data.total} onChange={setOffset} />
          </div>
        )}
      </Card>
    </div>
  );
}

function SalesWithParams() {
  const q = useSearchParams().get("q") ?? "";
  return <SalesInner key={q} initialQ={q} />;
}

export default function SalesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <SalesWithParams />
    </Suspense>
  );
}
