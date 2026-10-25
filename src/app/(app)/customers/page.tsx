"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useApp } from "@/components/app-context";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, Skeleton, TextAreaField, TextField, useToast } from "@/components/ui";
import { ApiError, apiFetch, qs, useApi, useDebounced } from "@/lib/client";
import { STATUS_LABELS } from "@/lib/receipt";

interface Cust {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  purchases: number;
  spent: string;
  lastPurchase: string | null;
}

function CustomerForm({ customer, onClose, onSaved }: { customer: Cust | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: customer?.name ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", notes: customer?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setErr("");
    setFields({});
    try {
      await apiFetch(customer ? `/api/customers/${customer.id}` : "/api/customers", { method: customer ? "PATCH" : "POST", body: v });
      toast.success(customer ? "Customer updated" : "Customer added");
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as ApiError).message);
      setFields((e as ApiError).fieldErrors ?? {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={() => !busy && onClose()} title={customer ? "Edit customer" : "Add customer"} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} loading={busy} disabled={!v.name.trim()}>Save</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <TextField label="Name" value={v.name} onChange={set("name")} error={fields.name} required autoFocus />
        <TextField label="Phone" type="tel" value={v.phone} onChange={set("phone")} error={fields.phone} hint="Used for WhatsApp receipts — include the country code." />
        <TextField label="Email" type="email" value={v.email} onChange={set("email")} error={fields.email} />
        <TextAreaField label="Notes" value={v.notes} onChange={set("notes")} error={fields.notes} maxLength={500} />
      </div>
    </Modal>
  );
}

function History({ id, onClose }: { id: string; onClose: () => void }) {
  const app = useApp();
  const { data, error, reload } = useApi<{ customer: Cust; sales: { id: string; receiptNumber: string; createdAt: string; total: string; status: string }[] }>(`/api/customers/${id}`);
  return (
    <Modal open onClose={onClose} title={data?.customer.name ?? "Customer"} description={[data?.customer.phone, data?.customer.email].filter(Boolean).join(" · ") || "Purchase history"} size="md">
      {error ? <ErrorState message={error} onRetry={reload} /> : !data ? <Skeleton className="h-32" /> : data.sales.length === 0 ? (
        <EmptyState title="No purchases yet" description="Sales linked to this customer will appear here." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.sales.map((s) => (
            <li key={s.id}>
              <Link href={`/sales/${s.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50">
                <div>
                  <p className="tabular text-sm font-medium text-navy-800">{s.receiptNumber}</p>
                  <p className="text-xs text-slate-500">{app.dateTime(s.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  {s.status !== "completed" && <Badge tone="amber">{STATUS_LABELS[s.status]}</Badge>}
                  <span className="tabular text-sm font-semibold">{app.money(s.total)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export default function CustomersPage() {
  const app = useApp();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const dsearch = useDebounced(search, 250);
  const [editing, setEditing] = useState<Cust | "new" | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Cust | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useApi<{ customers: Cust[] }>(`/api/customers${qs({ q: dsearch.trim() })}`);

  async function remove(c: Cust) {
    setBusy(true);
    try {
      await apiFetch(`/api/customers/${c.id}`, { method: "DELETE" });
      toast.success("Customer deleted");
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Customers" description="Keep contact details and purchase history in one place." actions={app.can("customers.manage") && <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add customer</Button>} />
      <Card>
        <div className="border-b border-slate-100 p-4"><Input aria-label="Search customers" placeholder="Search name, phone or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" /></div>
        {error && !data ? <ErrorState message={error} onRetry={reload} /> : !data ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : data.customers.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title={search ? "No customers match" : "No customers yet"} description={search ? "Try a different search." : "Add customers to track purchases and send receipts on WhatsApp."} action={!search && app.can("customers.manage") ? <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add customer</Button> : undefined} />
        ) : (
          <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-5 py-3 font-medium">Customer</th>
                    <th scope="col" className="hidden px-3 py-3 font-medium sm:table-cell">Contact</th>
                    <th scope="col" className="px-3 py-3 text-right font-medium">Purchases</th>
                    <th scope="col" className="hidden px-3 py-3 text-right font-medium md:table-cell">Total spent</th>
                    <th scope="col" className="hidden px-3 py-3 font-medium lg:table-cell">Last purchase</th>
                    <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.customers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-3"><button type="button" onClick={() => setViewing(c.id)} className="font-medium text-navy-800 hover:underline">{c.name}</button></td>
                      <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">{c.phone ?? "—"}{c.email && <span className="block text-xs text-slate-500">{c.email}</span>}</td>
                      <td className="tabular px-3 py-3 text-right text-slate-700">{c.purchases}</td>
                      <td className="tabular hidden px-3 py-3 text-right font-medium text-slate-900 md:table-cell">{app.money(c.spent)}</td>
                      <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">{c.lastPurchase ? app.date(c.lastPurchase) : "—"}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          {app.can("customers.manage") && <Button variant="ghost" size="sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button>}
                          {app.can("customers.delete") && <Button variant="ghost" size="sm" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-5 py-3 text-xs text-slate-500">{data.customers.length} customer{data.customers.length === 1 ? "" : "s"}</p>
          </div>
        )}
      </Card>
      {editing && <CustomerForm customer={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {viewing && <History id={viewing} onClose={() => setViewing(null)} />}
      <ConfirmDialog open={!!deleting} title="Delete customer?" message={<>“{deleting?.name}” will be removed. Their past sales are kept on record as walk-in transactions.</>} confirmLabel="Delete" danger loading={busy} onConfirm={() => deleting && remove(deleting)} onClose={() => setDeleting(null)} />
    </div>
  );
}
