"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { useApp } from "@/components/app-context";
import { ReceiptView } from "@/components/receipt";
import { Alert, Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, PageHeader, Pagination, SelectField, Skeleton, Tabs, TextAreaField, TextField, useToast } from "@/components/ui";
import { ApiError, apiFetch, fileToResizedDataUrl, useApi } from "@/lib/client";
import { CURRENCIES } from "@/lib/money";
import type { BusinessInfo, SaleDetail } from "@/lib/receipt";

interface S {
  businessName: string;
  receiptBusinessName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  currency: string;
  locale: string;
  timezone: string;
  taxName: string;
  taxRate: string;
  taxInclusive: boolean;
  receiptPrefix: string;
  receiptPadding: number;
  nextReceiptNumber: number;
  receiptFooter: string;
  receiptWidth: string;
  defaultLowStockThreshold: number;
  allowNegativeStock: boolean;
}

const LOCALES = ["en-NG", "en-US", "en-GB", "en-GH", "en-KE", "en-ZA", "en-IN", "fr-FR", "de-DE", "es-ES", "pt-BR"];

function useSave(onSaved: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  async function save(url: string, body: Record<string, unknown>, message = "Settings saved") {
    setBusy(true);
    setErr("");
    setFields({});
    try {
      await apiFetch(url, { method: "PATCH", body });
      toast.success(message);
      onSaved();
      return true;
    } catch (e) {
      setErr((e as ApiError).message);
      setFields((e as ApiError).fieldErrors ?? {});
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, fields, save };
}

function AccountTab() {
  const app = useApp();
  const router = useRouter();
  const [name, setName] = useState(app.user.fullName);
  const [phone, setPhone] = useState(app.user.phone ?? "");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const profile = useSave(() => router.refresh());
  const pw = useSave(() => { setCur(""); setNext(""); setConfirm(""); });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Profile" description={app.user.email} />
        <div className="space-y-4 p-5">
          {profile.err && <Alert tone="error">{profile.err}</Alert>}
          <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={profile.fields.fullName} required />
          <TextField label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={profile.fields.phone} />
          <Button loading={profile.busy} disabled={name.trim().length < 2} onClick={() => profile.save("/api/me", { fullName: name, phone }, "Profile updated")}>Save profile</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Change password" description="You will stay signed in here; other devices are signed out." />
        <div className="space-y-4 p-5">
          {pw.err && <Alert tone="error">{pw.err}</Alert>}
          <TextField label="Current password" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} error={pw.fields.currentPassword} />
          <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} error={pw.fields.newPassword} hint="At least 8 characters." />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={confirm && confirm !== next ? "Passwords do not match" : undefined} />
          <Button loading={pw.busy} disabled={!cur || next.length < 8 || next !== confirm} onClick={() => pw.save("/api/me", { currentPassword: cur, newPassword: next }, "Password changed")}>Update password</Button>
        </div>
      </Card>
    </div>
  );
}

function BusinessTab({ s, reload }: { s: S; reload: () => void }) {
  const router = useRouter();
  const app = useApp();
  const [v, setV] = useState({
    businessName: s.businessName, receiptBusinessName: s.receiptBusinessName, address: s.address ?? "", phone: s.phone ?? "", email: s.email ?? "",
    receiptFooter: s.receiptFooter, receiptWidth: s.receiptWidth, receiptPrefix: s.receiptPrefix, receiptPadding: String(s.receiptPadding), nextReceiptNumber: String(s.nextReceiptNumber),
  });
  const [logo, setLogo] = useState<string | null>(s.logoUrl);
  const [logoErr, setLogoErr] = useState("");
  const { busy, err, fields, save } = useSave(() => { reload(); router.refresh(); });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  async function pickLogo(file?: File) {
    if (!file) return;
    setLogoErr("");
    try {
      setLogo(await fileToResizedDataUrl(file, 256, "image/png"));
    } catch (e) {
      setLogoErr((e as Error).message);
    }
  }

  const business: BusinessInfo = {
    name: v.businessName, receiptName: v.receiptBusinessName || v.businessName, address: v.address || null, phone: v.phone || null, email: v.email || null, logoUrl: logo,
    footer: v.receiptFooter, receiptWidth: v.receiptWidth, currency: s.currency, locale: s.locale, timezone: s.timezone, taxName: s.taxName,
  };
  const pad = Math.min(10, Math.max(1, Number(v.receiptPadding) || 6));
  const sample: SaleDetail = {
    id: "sample", receiptNumber: `${v.receiptPrefix}${String(v.nextReceiptNumber).padStart(pad, "0")}`, status: "completed", createdAt: new Date().toISOString(), currency: s.currency,
    subtotal: "45.00", discountType: "none", discountValue: "0", discountAmount: "0.00", taxRate: s.taxRate, taxInclusive: s.taxInclusive, taxAmount: "0.00", total: "45.00", amountPaid: "50.00", changeDue: "5.00",
    paymentMethod: "cash", refundedAmount: "0.00", note: null, cashierName: app.user.fullName, customer: null,
    items: [
      { id: "1", productId: null, name: "Sample item A", sku: null, quantity: 2, unitPrice: "10.00", lineTotal: "20.00", refundedQuantity: 0 },
      { id: "2", productId: null, name: "Sample item B", sku: null, quantity: 1, unitPrice: "25.00", lineTotal: "25.00", refundedQuantity: 0 },
    ],
    refunds: [],
  };

  function submit() {
    const body: Record<string, unknown> = {
      businessName: v.businessName, receiptBusinessName: v.receiptBusinessName, address: v.address, phone: v.phone, email: v.email,
      receiptFooter: v.receiptFooter, receiptWidth: v.receiptWidth, receiptPrefix: v.receiptPrefix, receiptPadding: Number(v.receiptPadding),
    };
    if (Number(v.nextReceiptNumber) !== s.nextReceiptNumber) body.nextReceiptNumber = Number(v.nextReceiptNumber);
    if (logo !== s.logoUrl) body.logoUrl = logo;
    save("/api/settings", body);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Business & receipt details" description="Receipt details can differ from the business name used inside the app." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {err && <div className="sm:col-span-2"><Alert tone="error">{err}</Alert></div>}
            <TextField label="Business name (in app)" value={v.businessName} onChange={set("businessName")} error={fields.businessName} required />
            <TextField label="Name printed on receipts" value={v.receiptBusinessName} onChange={set("receiptBusinessName")} error={fields.receiptBusinessName} required />
            <TextField className="sm:col-span-2" label="Address" value={v.address} onChange={set("address")} error={fields.address} />
            <TextField label="Phone" type="tel" value={v.phone} onChange={set("phone")} error={fields.phone} />
            <TextField label="Email" type="email" value={v.email} onChange={set("email")} error={fields.email} />
            <div className="sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Logo</span>
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="Business logo preview" className="max-h-full max-w-full object-contain" />
                  ) : <ImagePlus className="h-6 w-6 text-slate-400" aria-hidden />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 focus-within:outline focus-within:outline-2 focus-within:outline-emerald-600 hover:bg-slate-50">
                    Upload logo
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => pickLogo(e.target.files?.[0])} />
                  </label>
                  {logo && <Button variant="ghost" size="sm" onClick={() => setLogo(null)}><Trash2 className="h-4 w-4" /> Remove</Button>}
                </div>
              </div>
              {(logoErr || fields.logoUrl) && <p role="alert" className="mt-1 text-xs text-red-600">{logoErr || fields.logoUrl}</p>}
              <p className="mt-1 text-xs text-slate-500">PNG, JPEG or WebP. Automatically resized to 256 px.</p>
            </div>
            <TextAreaField className="sm:col-span-2" label="Thank-you message" value={v.receiptFooter} onChange={set("receiptFooter")} error={fields.receiptFooter} maxLength={200} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Receipt format & numbering" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <SelectField label="Paper width" value={v.receiptWidth} onChange={set("receiptWidth")} hint="Applies to the print layout and PDF.">
              <option value="58mm">58 mm thermal printer</option>
              <option value="80mm">80 mm thermal printer</option>
              <option value="a4">A4 / standard paper</option>
            </SelectField>
            <TextField label="Number prefix" value={v.receiptPrefix} onChange={set("receiptPrefix")} error={fields.receiptPrefix} maxLength={12} hint="Letters, numbers, - _ /" />
            <TextField label="Number length" type="number" min="1" max="10" value={v.receiptPadding} onChange={set("receiptPadding")} error={fields.receiptPadding} hint="Digits, zero-padded." />
            <TextField label="Next receipt number" type="number" min={s.nextReceiptNumber} value={v.nextReceiptNumber} onChange={set("nextReceiptNumber")} error={fields.nextReceiptNumber} hint="Can only be increased, to keep every receipt unique." />
          </div>
          <div className="border-t border-slate-100 px-5 py-4"><Button loading={busy} disabled={!v.businessName.trim() || !v.receiptBusinessName.trim()} onClick={submit}>Save business settings</Button></div>
        </Card>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Live receipt preview</p>
        <div className="sticky top-24 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-4"><div className="shadow-md"><ReceiptView sale={sample} business={business} /></div></div>
      </div>
    </div>
  );
}

function TaxTab({ s, reload }: { s: S; reload: () => void }) {
  const router = useRouter();
  const [v, setV] = useState({ currency: s.currency, locale: s.locale, timezone: s.timezone, taxName: s.taxName, taxRate: String(Number(s.taxRate)), taxInclusive: s.taxInclusive });
  const { busy, err, fields, save } = useSave(() => { reload(); router.refresh(); });
  const zones = useMemo(() => {
    try { return Intl.supportedValuesOf("timeZone"); } catch { return ["UTC", "Africa/Lagos", "Africa/Accra", "Europe/London", "America/New_York"]; }
  }, []);
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Currency, timezone & tax" description="Totals are always calculated on the server using these settings." />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Alert tone="error">{err}</Alert></div>}
        <SelectField label="Currency" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} error={fields.currency} hint="Past receipts keep the currency they were issued in.">
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </SelectField>
        <SelectField label="Number & date format" value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })} error={fields.locale}>
          {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
        </SelectField>
        <SelectField className="sm:col-span-2" label="Timezone" value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} error={fields.timezone} hint="Defines when a business day starts and ends in reports.">
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </SelectField>
        <TextField label="Tax name" value={v.taxName} onChange={(e) => setV({ ...v, taxName: e.target.value })} error={fields.taxName} hint="e.g. VAT, GST, Sales tax" />
        <TextField label="Tax rate (%)" type="number" min="0" max="100" step="0.01" value={v.taxRate} onChange={(e) => setV({ ...v, taxRate: e.target.value })} error={fields.taxRate} hint="Use 0 for no tax." />
        <div className="sm:col-span-2"><Checkbox label="Prices already include tax" hint="When ticked, tax is extracted from the price instead of added on top." checked={v.taxInclusive} onChange={(e) => setV({ ...v, taxInclusive: e.target.checked })} /></div>
      </div>
      <div className="border-t border-slate-100 px-5 py-4"><Button loading={busy} onClick={() => save("/api/settings", { ...v, taxRate: Number(v.taxRate) })}>Save</Button></div>
    </Card>
  );
}

function InventoryTab({ s, reload }: { s: S; reload: () => void }) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(String(s.defaultLowStockThreshold));
  const [neg, setNeg] = useState(s.allowNegativeStock);
  const { busy, err, fields, save } = useSave(() => { reload(); router.refresh(); });
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Inventory rules" />
      <div className="space-y-4 p-5">
        {err && <Alert tone="error">{err}</Alert>}
        <TextField label="Default low-stock threshold" type="number" min="0" step="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} error={fields.defaultLowStockThreshold} hint="Products at or below this level trigger low-stock warnings (unless they have their own threshold)." />
        <Checkbox label="Allow selling when stock is zero" hint="Not recommended. When off, the server refuses any sale that would make stock negative." checked={neg} onChange={(e) => setNeg(e.target.checked)} />
      </div>
      <div className="border-t border-slate-100 px-5 py-4"><Button loading={busy} onClick={() => save("/api/settings", { defaultLowStockThreshold: Number(threshold), allowNegativeStock: neg })}>Save</Button></div>
    </Card>
  );
}

function ActivityTab() {
  const app = useApp();
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const { data, error, reload } = useApi<{ events: { id: string; action: string; entityType: string | null; metadata: Record<string, unknown> | null; createdAt: string; userName: string | null }[]; total: number }>(`/api/audit?limit=${limit}&offset=${offset}`);
  const meta = (m: Record<string, unknown> | null) => (m ? Object.entries(m).map(([k, val]) => `${k}: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`).join(" · ").slice(0, 140) : "");
  return (
    <Card>
      <CardHeader title="Activity log" description="A tamper-evident trail of sensitive actions in your business." />
      {error && !data ? <ErrorState message={error} onRetry={reload} /> : !data ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : data.events.length === 0 ? <EmptyState title="No activity yet" /> : (
        <>
          <ul className="divide-y divide-slate-100">
            {data.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium capitalize text-slate-900">{e.action.replace(/[._]/g, " ")}</p>
                  {e.metadata && <p className="truncate text-xs text-slate-500">{meta(e.metadata)}</p>}
                </div>
                <p className="text-xs text-slate-500">{e.userName ?? "System"} · {app.dateTime(e.createdAt)}</p>
              </li>
            ))}
          </ul>
          <Pagination offset={offset} limit={limit} total={data.total} onChange={setOffset} />
        </>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const app = useApp();
  const [tab, setTab] = useState<"account" | "business" | "tax" | "inventory" | "activity">("account");
  const owner = app.can("settings.manage");
  const { data, error, reload } = useApi<S>(owner ? "/api/settings" : null);

  const tabs = [
    { id: "account" as const, label: "My account" },
    ...(owner ? [{ id: "business" as const, label: "Business & receipts" }, { id: "tax" as const, label: "Currency & tax" }, { id: "inventory" as const, label: "Inventory" }] : []),
    ...(app.can("audit.view") ? [{ id: "activity" as const, label: "Activity log" }] : []),
  ];

  return (
    <div>
      <PageHeader title="Settings" description={owner ? "Account, business identity, receipts and rules." : "Manage your account."} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "account" && <AccountTab />}
      {tab === "activity" && <ActivityTab />}
      {(tab === "business" || tab === "tax" || tab === "inventory") &&
        (error && !data ? <ErrorState message={error} onRetry={reload} /> : !data ? <Skeleton className="h-96" /> : (
          <>
            {tab === "business" && <BusinessTab key={JSON.stringify([data.businessName, data.receiptBusinessName, data.nextReceiptNumber, data.logoUrl?.length])} s={data} reload={reload} />}
            {tab === "tax" && <TaxTab s={data} reload={reload} />}
            {tab === "inventory" && <InventoryTab s={data} reload={reload} />}
          </>
        ))}
    </div>
  );
}
