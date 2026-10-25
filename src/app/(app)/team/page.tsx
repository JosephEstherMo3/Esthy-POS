"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Pencil, Phone, Plus, Search, ShieldCheck } from "lucide-react";
import { useApp } from "@/components/app-context";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Modal, PageHeader, SelectField, Skeleton, TextField, useToast } from "@/components/ui";
import { ApiError, apiFetch, useApi } from "@/lib/client";
import { PERMISSION_LABELS, PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS, type Role } from "@/lib/permissions";

interface Member {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  status: "active" | "disabled";
  createdAt: string;
  isYou: boolean;
}

function AddMember({ allowedRoles, onClose, onSaved }: { allowedRoles: Role[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ fullName: "", email: "", phone: "", password: "", role: allowedRoles[allowedRoles.length - 1] as Role });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ fullName: string; email: string; password: string; role: Role } | null>(null);
  const [copied, setCopied] = useState(false);

  async function save() {
    setBusy(true);
    setErr("");
    setFields({});
    try {
      await apiFetch("/api/team", { method: "POST", body: v });
      toast.success("Team member added");
      onSaved();
      setCreated({ fullName: v.fullName, email: v.email, password: v.password, role: v.role });
    } catch (e) {
      setErr((e as ApiError).message);
      setFields((e as ApiError).fieldErrors ?? {});
    } finally {
      setBusy(false);
    }
  }

  function copyCredentials() {
    if (!created) return;
    const text = `Staff Account Credentials:\nName: ${created.fullName}\nRole: ${ROLE_LABELS[created.role]}\nEmail: ${created.email}\nTemporary Password: ${created.password}\nLogin at: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Login details copied to clipboard");
    setTimeout(() => setCopied(false), 3000);
  }

  if (created) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Staff Account Created"
        description="Share these login credentials with the staff member."
        size="sm"
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <div className="space-y-4">
          <Alert tone="success">
            Account for <strong>{created.fullName}</strong> is ready. Cashiers and staff can sign in immediately at the login page.
          </Alert>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">Role:</span>
              <span className="font-semibold text-slate-900">{ROLE_LABELS[created.role]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">Login Email:</span>
              <span className="font-mono font-semibold text-slate-900">{created.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">Temporary Password:</span>
              <span className="font-mono font-semibold text-slate-900">{created.password}</span>
            </div>
          </div>
          <Button variant="secondary" className="w-full" onClick={copyCredentials}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? "Copied to clipboard!" : "Copy login details"}</span>
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title="Add team member" description="Create an account and share the temporary password securely." size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} loading={busy} disabled={!v.fullName.trim() || !v.email.trim() || v.password.length < 8}>Add member</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <TextField label="Full name" value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} error={fields.fullName} required autoFocus />
        <TextField label="Email address" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={fields.email} hint="Used for signing in." required />
        <TextField label="Phone number (optional)" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} error={fields.phone} placeholder="e.g. 08012345678" />
        <TextField label="Temporary password" type="text" autoComplete="off" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} error={fields.password} hint="At least 8 characters. They can change it in Settings." required />
        <SelectField label="Role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })} hint={ROLE_DESCRIPTIONS[v.role]}>
          {allowedRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </SelectField>
      </div>
    </Modal>
  );
}

function EditMember({ member, allowedRoles, onClose, onSaved }: { member: Member; allowedRoles: Role[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState<Role>(member.role);
  const [status, setStatus] = useState(member.status);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setBusy(true);
    setErr("");
    const body: Record<string, unknown> = {};
    if (role !== member.role) body.role = role;
    if (status !== member.status) body.status = status;
    if (password) body.password = password;
    try {
      await apiFetch(`/api/team/${member.id}`, { method: "PATCH", body });
      toast.success("Team member updated");
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const changed = role !== member.role || status !== member.status || password.length > 0;
  return (
    <Modal open onClose={() => !busy && onClose()} title={member.fullName} description={member.email} size="sm"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} loading={busy} disabled={!changed || (password.length > 0 && password.length < 8)}>Save changes</Button></>}>
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}
        <SelectField label="Role" value={role} disabled={member.isYou} onChange={(e) => setRole(e.target.value as Role)} hint={member.isYou ? "You can't change your own role." : ROLE_DESCRIPTIONS[role]}>
          {allowedRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </SelectField>
        <SelectField label="Account status" value={status} disabled={member.isYou} onChange={(e) => setStatus(e.target.value as "active" | "disabled")} hint="Disabled members are signed out immediately and cannot sign in.">
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </SelectField>
        {!member.isYou && <TextField label="Set new password (optional)" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} hint="Signs them out of all devices." />}
      </div>
    </Modal>
  );
}

export default function TeamPage() {
  const app = useApp();
  const { data, error, reload } = useApi<{ members: Member[] }>("/api/team");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const isOwner = app.role === "owner";
  const allowedRoles: Role[] = isOwner ? ["owner", "manager", "cashier"] : ["cashier"];
  const canManage = (m: Member) => app.can("team.manage") && (isOwner || m.role === "cashier");

  const filteredMembers = (data?.members ?? []).filter((m) => {
    const s = search.trim().toLowerCase();
    return (
      !s ||
      m.fullName.toLowerCase().includes(s) ||
      m.email.toLowerCase().includes(s) ||
      (m.phone ?? "").toLowerCase().includes(s) ||
      m.role.toLowerCase().includes(s)
    );
  });

  return (
    <div>
      <PageHeader title="Team & staff accounts" description="Manage shop cashier and manager accounts, roles, and access." actions={app.can("team.manage") && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add staff member</Button>} />
      {!isOwner && <div className="mb-5"><Alert tone="info">As a manager you can add and manage cashier accounts. Only the owner can manage managers and owners.</Alert></div>}

      <Card>
        <CardHeader
          title="Team Members"
          description={`${data?.members.length ?? 0} staff account${(data?.members.length ?? 0) === 1 ? "" : "s"} registered`}
          action={
            (data?.members.length ?? 0) > 2 && (
              <div className="relative w-48 sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search staff…"
                  className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-2.5 text-xs focus:border-emerald-600 focus:outline-none"
                />
              </div>
            )
          }
        />
        {error && !data ? <ErrorState message={error} onRetry={reload} /> : !data ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div> : data.members.length === 0 ? <EmptyState title="No team members" /> : (
          <ul className="divide-y divide-slate-100">
            {filteredMembers.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">{m.fullName.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{m.fullName}{m.isYou && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}</p>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    <span className="truncate">{m.email}</span>
                    {m.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {m.phone}</span>}
                  </div>
                </div>
                <Badge tone={m.role === "owner" ? "navy" : m.role === "manager" ? "emerald" : "slate"}>{ROLE_LABELS[m.role]}</Badge>
                {m.status === "disabled" && <Badge tone="red">Disabled</Badge>}
                {canManage(m) && <Button variant="ghost" size="sm" onClick={() => setEditing(m)} aria-label={`Manage ${m.fullName}`}>{m.isYou ? <KeyRound className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}<span className="hidden sm:inline">Manage</span></Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader title="Role permissions" description="Enforced by the server on every request — not just hidden in the interface." action={<ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />} />
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {(["owner", "manager", "cashier"] as Role[]).map((r) => (
            <div key={r} className="rounded-xl bg-slate-50 p-4"><p className="text-sm font-semibold text-navy-900">{ROLE_LABELS[r]}</p><p className="mt-1 text-xs text-slate-600">{ROLE_DESCRIPTIONS[r]}</p></div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th scope="col" className="px-5 py-3 font-medium">Permission</th>{(["owner", "manager", "cashier"] as Role[]).map((r) => <th key={r} scope="col" className="px-5 py-3 text-center font-medium">{ROLE_LABELS[r]}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {PERMISSIONS.map((p) => (
                <tr key={p}>
                  <th scope="row" className="px-5 py-2.5 font-normal text-slate-700">{PERMISSION_LABELS[p]}</th>
                  {(["owner", "manager", "cashier"] as Role[]).map((r) => (
                    <td key={r} className="px-5 py-2.5 text-center">
                      {ROLE_PERMISSIONS[r].includes(p) ? <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="Allowed" /> : <span className="text-slate-300" aria-label="Not allowed">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {adding && <AddMember allowedRoles={allowedRoles} onClose={() => setAdding(false)} onSaved={reload} />}
      {editing && <EditMember member={editing} allowedRoles={allowedRoles} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
