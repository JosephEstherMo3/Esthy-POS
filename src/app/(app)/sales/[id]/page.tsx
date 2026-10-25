"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, RotateCcw, Undo2 } from "lucide-react";
import { useApp } from "@/components/app-context";
import { ReceiptActions, ReceiptView } from "@/components/receipt";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ErrorState, Modal, PageLoader, TextAreaField, useToast } from "@/components/ui";
import { apiFetch, useApi } from "@/lib/client";
import { PAYMENT_LABELS, STATUS_LABELS, type BusinessInfo, type SaleDetail } from "@/lib/receipt";

type Res = { sale: SaleDetail; business: BusinessInfo };
const tone = (s: string) => (s === "completed" ? "emerald" : s === "partially_refunded" ? "amber" : "red") as "emerald" | "amber" | "red";

function RefundModal({ sale, mode, open, onClose, onDone }: { sale: SaleDetail; mode: "refund" | "void"; open: boolean; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const toast = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const remaining = sale.items.map((i) => ({ ...i, left: i.quantity - i.refundedQuantity }));
  const selected = mode === "void" ? remaining.reduce((s, i) => s + i.left, 0) : Object.values(qty).reduce((s, n) => s + n, 0);

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await apiFetch(`/api/sales/${sale.id}/refund`, {
        method: "POST",
        body: {
          kind: mode,
          reason,
          restock,
          items: mode === "refund" ? Object.entries(qty).filter(([, n]) => n > 0).map(([saleItemId, quantity]) => ({ saleItemId, quantity })) : undefined,
        },
      });
      toast.success(mode === "void" ? "Sale cancelled" : "Refund recorded");
      onDone();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={mode === "void" ? "Cancel this sale" : "Refund items"}
      description={mode === "void" ? "Every remaining item is reversed. The sale stays on record as cancelled." : "Choose the quantity of each item being returned."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={selected === 0 || reason.trim().length < 3}>
            {mode === "void" ? "Cancel sale" : "Record refund"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        {mode === "refund" && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {remaining.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{i.name}</p>
                  <p className="tabular text-xs text-slate-500">{app.money(i.unitPrice)} · {i.left} refundable</p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={i.left}
                  disabled={i.left === 0}
                  aria-label={`Refund quantity for ${i.name}`}
                  value={qty[i.id] ?? 0}
                  onChange={(e) => setQty((q) => ({ ...q, [i.id]: Math.max(0, Math.min(i.left, parseInt(e.target.value, 10) || 0)) }))}
                  className="tabular h-9 w-20 rounded-lg border border-slate-300 px-2 text-center text-sm disabled:bg-slate-100"
                />
              </li>
            ))}
          </ul>
        )}
        <TextAreaField label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} hint="Recorded in the audit log (min. 3 characters)." maxLength={300} />
        <Checkbox label="Return items to stock" hint="Untick for damaged or unsellable goods." checked={restock} onChange={(e) => setRestock(e.target.checked)} />
      </div>
    </Modal>
  );
}

export default function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const app = useApp();
  const { data, error, reload } = useApi<Res>(`/api/sales/${id}`);
  const [modal, setModal] = useState<"refund" | "void" | null>(null);

  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageLoader label="Loading receipt…" />;
  const { sale, business } = data;
  const reversible = sale.status === "completed" || sale.status === "partially_refunded";

  return (
    <div>
      <Link href="/sales" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Back to sales</Link>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="tabular text-2xl font-semibold tracking-tight text-navy-900">{sale.receiptNumber}</h1>
          <Badge tone={tone(sale.status)}>{STATUS_LABELS[sale.status]}</Badge>
        </div>
        <ReceiptActions sale={sale} business={business} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4">
          <div className="shadow-md"><ReceiptView sale={sale} business={business} /></div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Transaction details" />
            <dl className="grid gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-2">
              {[
                ["Date & time", app.dateTime(sale.createdAt)],
                ["Cashier", sale.cashierName ?? "—"],
                ["Payment method", PAYMENT_LABELS[sale.paymentMethod]],
                ["Amount paid", app.money(sale.amountPaid)],
                ["Change given", app.money(sale.changeDue)],
                ["Total", app.money(sale.total)],
              ].map(([k, v]) => (
                <div key={k}><dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt><dd className="tabular mt-0.5 font-medium text-slate-900">{v}</dd></div>
              ))}
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Customer</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{sale.customer ? sale.customer.name : "Walk-in"}{sale.customer?.phone ? <span className="block text-xs font-normal text-slate-500">{sale.customer.phone}</span> : null}</dd>
              </div>
            </dl>
          </Card>

          {app.can("sales.refund") && (
            <Card>
              <CardHeader title="Refunds & cancellation" description="Completed sales are never deleted. Reversals are recorded and audited." />
              <div className="space-y-4 p-5">
                {sale.refunds.length === 0 ? (
                  <p className="text-sm text-slate-500">No refunds have been recorded for this sale.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {sale.refunds.map((r) => (
                      <li key={r.id} className="px-4 py-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-slate-900">{r.kind === "void" ? "Sale cancelled" : "Refund"} · {app.money(r.amount)}</span>
                          <span className="text-xs text-slate-500">{app.dateTime(r.createdAt)}</span>
                        </div>
                        <p className="mt-0.5 text-slate-600">“{r.reason}” — {r.createdByName ?? "Unknown"}{r.restocked ? " · restocked" : ""}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {reversible ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setModal("refund")}><Undo2 className="h-4 w-4" /> Refund items</Button>
                    {sale.status === "completed" && <Button variant="danger" onClick={() => setModal("void")}><RotateCcw className="h-4 w-4" /> Cancel sale</Button>}
                  </div>
                ) : (
                  <Alert tone="info">This sale has been fully reversed.</Alert>
                )}
              </div>
            </Card>
          )}
          {!app.can("sales.refund") && sale.refunds.length > 0 && <Alert tone="warning">This sale has {sale.refunds.length} refund record(s). Total refunded: {app.money(sale.refundedAmount)}.</Alert>}
        </div>
      </div>

      {modal && <RefundModal key={modal} sale={sale} mode={modal} open onClose={() => setModal(null)} onDone={reload} />}
    </div>
  );
}
