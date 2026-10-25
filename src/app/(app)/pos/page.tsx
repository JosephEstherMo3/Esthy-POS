"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  Banknote,
  Camera,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Landmark,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useApp } from "@/components/app-context";
import { CameraScannerModal } from "@/components/camera-scanner";
import { ReceiptActions, ReceiptView } from "@/components/receipt";
import { Alert, Badge, Button, cn, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Select, TextField, useToast } from "@/components/ui";
import { ApiError, apiFetch, uid, useApi, useOnline } from "@/lib/client";
import { calculateTotals, fromCents, toCents, type DiscountType, type Totals } from "@/lib/money";
import type { BusinessInfo, SaleDetail } from "@/lib/receipt";

interface P {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  imageUrl: string | null;
  price: string;
  stockQty: number;
  categoryId: string | null;
  categoryName: string | null;
  isLow: boolean;
}
interface ProductsRes {
  products: P[];
  categories: { id: string; name: string }[];
}
interface CartLine {
  productId: string;
  name: string;
  sku: string | null;
  price: number;
  qty: number;
  stock: number;
}
interface SaleRes {
  sale: SaleDetail;
  business: BusinessInfo;
  duplicate: boolean;
}
type Method = "cash" | "transfer" | "card";
type Calc = { t: Totals; error?: undefined } | { t?: undefined; error: string };

const METHODS: { id: Method; label: string; icon: typeof Banknote }[] = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "transfer", label: "Transfer", icon: Landmark },
  { id: "card", label: "Card", icon: CreditCard },
];

function roundUp(n: number, step: number) {
  return Math.ceil(n / step) * step;
}

export default function PosPage() {
  const app = useApp();
  const toast = useToast();
  const online = useOnline();
  const { settings } = app;
  const products = useApi<ProductsRes>("/api/products?status=active");
  const customers = useApi<{ customers: { id: string; name: string; phone: string | null }[] }>("/api/customers");
  const businessInfo = useApi<{ business: BusinessInfo }>("/api/business");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>("none");
  const [discountValue, setDiscountValue] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [tendered, setTendered] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [completed, setCompleted] = useState<SaleRes | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [custModal, setCustModal] = useState(false);
  const [newCust, setNewCust] = useState({ name: "", phone: "" });
  const [custBusy, setCustBusy] = useState(false);
  const [custErr, setCustErr] = useState("");

  const submittingRef = useRef(false);
  const keyRef = useRef<{ key: string; sig: string }>({ key: "", sig: "" });
  const searchRef = useRef<HTMLInputElement>(null);

  const allowNeg = settings.allowNegativeStock;
  const list = useMemo(() => products.data?.products ?? [], [products.data]);

  function handleBarcodeScanned(barcode: string) {
    const s = barcode.trim().toLowerCase();
    const exact = list.find((p) => (p.barcode ?? "").toLowerCase() === s || (p.sku ?? "").toLowerCase() === s);
    if (exact) {
      add(exact);
      toast.success(`Scanned: ${exact.name}`);
    } else {
      toast.error(`No product matches barcode "${barcode}"`);
    }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return list.filter(
      (p) =>
        (!category || p.categoryId === category) &&
        (!s || p.name.toLowerCase().includes(s) || (p.sku ?? "").toLowerCase().includes(s) || (p.barcode ?? "").toLowerCase().includes(s)),
    );
  }, [list, search, category]);

  const calc: Calc = useMemo(() => {
    try {
      return {
        t: calculateTotals({
          lines: cart.map((l) => ({ unitPriceCents: toCents(l.price), quantity: l.qty })),
          discountType,
          discountValue: Number(discountValue) || 0,
          taxRatePercent: Number(settings.taxRate),
          taxInclusive: settings.taxInclusive,
        }),
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [cart, discountType, discountValue, settings.taxRate, settings.taxInclusive]);

  const totalCents = calc.t?.totalCents ?? 0;
  const tenderedCents = tendered === "" ? null : toCents(tendered);
  const changeCents = tenderedCents !== null ? tenderedCents - totalCents : 0;
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const cashOk = method !== "cash" || (tenderedCents !== null && tenderedCents >= totalCents);
  const canCharge = cart.length > 0 && !!calc.t && totalCents > 0 && cashOk && online;

  function add(p: P) {
    const existing = cart.find((l) => l.productId === p.id);
    const next = (existing?.qty ?? 0) + 1;
    if (!allowNeg && next > p.stockQty) {
      toast.error(p.stockQty <= 0 ? `"${p.name}" is out of stock` : `Only ${p.stockQty} of "${p.name}" in stock`);
      return;
    }
    setCart((prev) =>
      existing
        ? prev.map((l) => (l.productId === p.id ? { ...l, qty: next } : l))
        : [...prev, { productId: p.id, name: p.name, sku: p.sku, price: Number(p.price), qty: 1, stock: p.stockQty }],
    );
  }

  function setQty(productId: string, qty: number) {
    const line = cart.find((l) => l.productId === productId);
    if (!line) return;
    if (!Number.isFinite(qty) || qty <= 0) return setCart((prev) => prev.filter((l) => l.productId !== productId));
    if (!allowNeg && qty > line.stock) {
      toast.error(`Only ${line.stock} of "${line.name}" in stock`);
      qty = line.stock;
    }
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, qty: Math.floor(qty) } : l)));
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const s = search.trim().toLowerCase();
    if (!s) return;
    const exact = list.find((p) => (p.sku ?? "").toLowerCase() === s || (p.barcode ?? "").toLowerCase() === s);
    const pick = exact ?? (filtered.length === 1 ? filtered[0] : undefined);
    if (pick) {
      add(pick);
      setSearch("");
    } else if (filtered.length === 0) toast.error(`No product matches "${search.trim()}"`);
  }

  const previewSale: SaleDetail | null = useMemo(() => {
    if (!calc.t) return null;
    const cust = customers.data?.customers.find((c) => c.id === customerId);
    return {
      id: "preview",
      receiptNumber: "Assigned on save",
      status: "completed",
      createdAt: new Date().toISOString(),
      currency: settings.currency,
      subtotal: fromCents(calc.t.subtotalCents),
      discountType,
      discountValue: String(Number(discountValue) || 0),
      discountAmount: fromCents(calc.t.discountCents),
      taxRate: settings.taxRate,
      taxInclusive: settings.taxInclusive,
      taxAmount: fromCents(calc.t.taxCents),
      total: fromCents(calc.t.totalCents),
      amountPaid: method === "cash" && tenderedCents !== null ? fromCents(tenderedCents) : fromCents(calc.t.totalCents),
      changeDue: method === "cash" && tenderedCents !== null ? fromCents(Math.max(0, tenderedCents - calc.t.totalCents)) : "0.00",
      paymentMethod: method,
      refundedAmount: "0.00",
      note: null,
      cashierName: app.user.fullName,
      customer: cust ? { id: cust.id, name: cust.name, phone: cust.phone, email: null } : null,
      items: cart.map((l) => ({ id: l.productId, productId: l.productId, name: l.name, sku: l.sku, quantity: l.qty, unitPrice: l.price.toFixed(2), lineTotal: fromCents(toCents(l.price) * l.qty), refundedQuantity: 0 })),
      refunds: [],
    };
  }, [calc, cart, customerId, customers.data, discountType, discountValue, method, settings, tenderedCents, app.user.fullName]);

  async function submit() {
    if (submittingRef.current || !canCharge) return; // blocks double-clicks / duplicate submissions
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    const payload = {
      items: cart.map((l) => ({ productId: l.productId, quantity: l.qty })),
      discountType,
      discountValue: discountType === "none" ? 0 : Number(discountValue) || 0,
      paymentMethod: method,
      amountTendered: method === "cash" ? Number(tendered) : null,
      customerId: customerId || null,
    };
    // Same payload → same idempotency key, so a retry after a network failure can never create a second sale.
    const sig = JSON.stringify(payload);
    if (keyRef.current.sig !== sig || !keyRef.current.key) keyRef.current = { key: uid(), sig };
    try {
      const res = await apiFetch<SaleRes>("/api/sales", { method: "POST", body: { ...payload, idempotencyKey: keyRef.current.key } });
      // Only clear the cart after the sale is saved.
      setCompleted(res);
      setConfirmOpen(false);
      setCartOpen(false);
      setCart([]);
      setDiscountType("none");
      setDiscountValue("");
      setTendered("");
      setCustomerId("");
      keyRef.current = { key: "", sig: "" };
      products.reload();
      toast.success(res.duplicate ? "This sale was already recorded." : `Sale ${res.sale.receiptNumber} completed`);
    } catch (e) {
      const msg = (e as ApiError).message;
      setSubmitError(msg);
      toast.error(msg);
      if ((e as ApiError).status === 409 || (e as ApiError).status === 422) products.reload();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function addCustomer() {
    setCustBusy(true);
    setCustErr("");
    try {
      const c = await apiFetch<{ id: string }>("/api/customers", { method: "POST", body: { name: newCust.name, phone: newCust.phone } });
      customers.reload();
      setCustomerId(c.id);
      setCustModal(false);
      setNewCust({ name: "", phone: "" });
      toast.success("Customer added");
    } catch (e) {
      setCustErr((e as Error).message);
    } finally {
      setCustBusy(false);
    }
  }

  const quick = useMemo(() => {
    if (totalCents <= 0) return [];
    const set = new Set<number>([totalCents]);
    for (const step of [1000, 5000, 10000, 50000]) set.add(roundUp(totalCents, step));
    return [...set].sort((a, b) => a - b).slice(0, 4);
  }, [totalCents]);

  const cartPanel = (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <ShoppingCart className="h-5 w-5 text-navy-700" aria-hidden /> Current sale
          {itemCount > 0 && <Badge tone="navy">{itemCount} item{itemCount === 1 ? "" : "s"}</Badge>}
        </h2>
        <div className="flex items-center gap-1">
          {cart.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setCart([])}>Clear</Button>
          )}
          <button type="button" aria-label="Close cart" onClick={() => setCartOpen(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div>
        {cart.length === 0 ? (
          <EmptyState icon={<ShoppingCart className="h-6 w-6" />} title="Cart is empty" description="Tap a product or scan a barcode to start a sale." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {cart.map((l) => (
              <li key={l.productId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{l.name}</p>
                    <p className="tabular text-xs text-slate-500">{app.money(l.price)} each</p>
                  </div>
                  <p className="tabular text-sm font-semibold text-slate-900">{app.money((toCents(l.price) * l.qty) / 100)}</p>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="inline-flex items-center rounded-lg border border-slate-300">
                    <button type="button" aria-label={`Decrease ${l.name}`} onClick={() => setQty(l.productId, l.qty - 1)} className="flex h-9 w-9 items-center justify-center text-slate-700 hover:bg-slate-50">
                      <Minus className="h-4 w-4" />
                    </button>
                    <input
                      aria-label={`Quantity of ${l.name}`}
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => setQty(l.productId, parseInt(e.target.value, 10))}
                      className="tabular h-9 w-12 border-x border-slate-300 text-center text-sm focus:outline-none"
                    />
                    <button type="button" aria-label={`Increase ${l.name}`} onClick={() => setQty(l.productId, l.qty + 1)} className="flex h-9 w-9 items-center justify-center text-slate-700 hover:bg-slate-50">
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <button type="button" aria-label={`Remove ${l.name}`} onClick={() => setCart((p) => p.filter((x) => x.productId !== l.productId))} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {cart.length > 0 && (
        <div className="space-y-4 border-t border-slate-200 bg-slate-50/60 p-4">
          <div className="flex gap-2">
            <Select aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="flex-1">
              <option value="">Walk-in customer</option>
              {customers.data?.customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>
              ))}
            </Select>
            <Button variant="secondary" aria-label="Add customer" onClick={() => setCustModal(true)}><UserPlus className="h-4 w-4" /></Button>
          </div>

          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <Select aria-label="Discount type" value={discountType} onChange={(e) => { setDiscountType(e.target.value as DiscountType); setDiscountValue(""); }}>
              <option value="none">No discount</option>
              <option value="percent">Discount %</option>
              <option value="fixed">Discount amount</option>
            </Select>
            <Input aria-label="Discount value" type="number" min="0" step="0.01" inputMode="decimal" disabled={discountType === "none"} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder={discountType === "percent" ? "0 %" : "0.00"} />
          </div>
          {calc.error && <Alert tone="error">{calc.error}</Alert>}

          <dl className="tabular space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{calc.t ? app.money(calc.t.subtotalCents / 100) : "—"}</dd></div>
            {calc.t && calc.t.discountCents > 0 && <div className="flex justify-between text-emerald-700"><dt>Discount</dt><dd>−{app.money(calc.t.discountCents / 100)}</dd></div>}
            {Number(settings.taxRate) > 0 && calc.t && (
              <div className="flex justify-between"><dt className="text-slate-600">{settings.taxName} ({Number(settings.taxRate)}%{settings.taxInclusive ? " incl." : ""})</dt><dd>{app.money(calc.t.taxCents / 100)}</dd></div>
            )}
            <div className="flex justify-between border-t border-slate-300 pt-2 text-lg font-semibold text-slate-900"><dt>Total</dt><dd>{calc.t ? app.money(calc.t.totalCents / 100) : "—"}</dd></div>
          </dl>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">Payment method</legend>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <label key={m.id} className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-emerald-600", method === m.id ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                  <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} className="sr-only" />
                  <m.icon className="h-5 w-5" aria-hidden /> {m.label}
                </label>
              ))}
            </div>
          </fieldset>

          {method === "cash" && (
            <div className="space-y-2">
              <TextField label="Amount received" type="number" min="0" step="0.01" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="0.00" />
              <div className="flex flex-wrap gap-2">
                {quick.map((q) => (
                  <button key={q} type="button" onClick={() => setTendered((q / 100).toFixed(2))} className="tabular rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                    {q === totalCents ? "Exact" : app.money(q / 100)}
                  </button>
                ))}
              </div>
              {tenderedCents !== null && (
                <p className={cn("tabular text-sm font-semibold", changeCents >= 0 ? "text-emerald-700" : "text-red-600")} role="status">
                  {changeCents >= 0 ? `Change due: ${app.money(changeCents / 100)}` : `Short by ${app.money(-changeCents / 100)}`}
                </p>
              )}
            </div>
          )}

          {!online && <Alert tone="warning">You are offline — reconnect to complete the sale.</Alert>}
          <Button variant="accent" size="lg" className="w-full" disabled={!canCharge} onClick={() => { setSubmitError(""); setConfirmOpen(true); }}>
            Review & charge {calc.t ? app.money(calc.t.totalCents / 100) : ""}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <PageHeader title="New sale" description="Search or scan products, build the cart, and take payment." />
      {products.error && !products.data ? (
        <ErrorState message={products.error} onRetry={products.reload} />
      ) : !products.data ? (
        <PageLoader label="Loading products…" />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section aria-label="Products" className="min-w-0">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={onSearchKey}
                  aria-label="Search products by name, SKU or barcode"
                  placeholder="Search name, SKU or scan barcode…"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  autoFocus
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setScannerOpen(true)}
                className="h-11 shrink-0 gap-2 border-emerald-600/30 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
              >
                <Camera className="h-4 w-4 text-emerald-600" />
                <span>Scan Barcode</span>
              </Button>
            </div>
            {products.data.categories.length > 0 && (
              <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Categories">
                {[{ id: "", name: "All" }, ...products.data.categories].map((c) => (
                  <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors", category === c.id ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {list.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white">
                <EmptyState icon={<Package className="h-6 w-6" />} title="No products yet" description="Add products to your catalogue before making a sale." action={app.can("products.manage") ? <Link href="/products" className="inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-medium text-white">Add products</Link> : undefined} />
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white"><EmptyState icon={<Search className="h-6 w-6" />} title="No matching products" description="Try a different search or category." /></div>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {filtered.map((p) => {
                  const out = !allowNeg && p.stockQty <= 0;
                  const inCart = cart.find((l) => l.productId === p.id)?.qty ?? 0;
                  return (
                    <li key={p.id}>
                      <button type="button" disabled={out} onClick={() => add(p)} className={cn("group relative flex h-full w-full flex-col overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0", inCart ? "border-emerald-500 ring-1 ring-emerald-500" : "border-slate-200")}>
                        <div className="flex aspect-[4/3] w-full items-center justify-center bg-navy-50">
                          {p.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <span className="text-3xl font-semibold text-navy-300" aria-hidden>{p.name.slice(0, 1).toUpperCase()}</span>
                          )}
                        </div>
                        {inCart > 0 && <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-xs font-bold text-white">{inCart}</span>}
                        <div className="flex flex-1 flex-col gap-1 p-3">
                          <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-900">{p.name}</p>
                          <p className="tabular mt-auto text-sm font-semibold text-navy-900">{app.money(p.price)}</p>
                          <p className={cn("text-xs", out ? "font-medium text-red-600" : p.isLow ? "font-medium text-amber-700" : "text-slate-500")}>
                            {out ? "Out of stock" : `${p.stockQty} in stock${p.isLow ? " · low" : ""}`}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside aria-label="Cart" className={cn("fixed inset-0 z-40 overflow-y-auto bg-white lg:sticky lg:top-24 lg:z-auto lg:block lg:max-h-[calc(100dvh-7rem)] lg:rounded-2xl lg:border lg:border-slate-200 lg:shadow-sm", cartOpen ? "block" : "hidden")}>
            {cartPanel}
          </aside>
        </div>
      )}

      {cart.length > 0 && !cartOpen && (
        <div className="fixed inset-x-3 bottom-[4.5rem] z-30 lg:hidden">
          <button type="button" onClick={() => setCartOpen(true)} className="flex w-full items-center justify-between rounded-xl bg-navy-900 px-4 py-3.5 text-white shadow-xl">
            <span className="flex items-center gap-2 text-sm font-medium"><ShoppingCart className="h-5 w-5" /> {itemCount} item{itemCount === 1 ? "" : "s"}</span>
            <span className="tabular text-base font-semibold">{calc.t ? app.money(calc.t.totalCents / 100) : ""} →</span>
          </button>
        </div>
      )}

      {/* Confirmation */}
      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="Confirm sale"
        description="Please review the details. The sale is saved when you confirm."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={submitting}>Back</Button>
            <Button variant="accent" onClick={submit} loading={submitting} disabled={!canCharge}>{submitting ? "Saving…" : "Confirm & complete sale"}</Button>
          </>
        }
      >
        {calc.t && (
          <div className="space-y-4">
            {submitError && <Alert tone="error">{submitError}</Alert>}
            <dl className="tabular space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-slate-600">Items</dt><dd>{itemCount}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-600">Payment</dt><dd className="capitalize">{method}</dd></div>
              {method === "cash" && tenderedCents !== null && (
                <>
                  <div className="flex justify-between"><dt className="text-slate-600">Cash received</dt><dd>{app.money(tenderedCents / 100)}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-600">Change due</dt><dd className="font-semibold text-emerald-700">{app.money(Math.max(0, changeCents) / 100)}</dd></div>
                </>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-xl font-semibold text-slate-900"><dt>Total</dt><dd>{app.money(calc.t.totalCents / 100)}</dd></div>
            </dl>
            <button type="button" onClick={() => setShowPreview((s) => !s)} aria-expanded={showPreview} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Live receipt preview <ChevronDown className={cn("h-4 w-4 transition-transform", showPreview && "rotate-180")} />
            </button>
            {showPreview && previewSale && businessInfo.data && (
              <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-slate-100 p-3">
                <div className="shadow"><ReceiptView sale={previewSale} business={businessInfo.data.business} preview /></div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Success */}
      <Modal
        open={!!completed}
        onClose={() => setCompleted(null)}
        title="Sale complete"
        footer={<Button variant="accent" onClick={() => { setCompleted(null); searchRef.current?.focus(); }}>Start new sale</Button>}
      >
        {completed && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-4">
              <CheckCircle2 className="h-9 w-9 shrink-0 text-emerald-600" aria-hidden />
              <div>
                <p className="font-semibold text-emerald-900">Receipt {completed.sale.receiptNumber}</p>
                <p className="tabular text-sm text-emerald-800">
                  Total {app.money(completed.sale.total)}
                  {Number(completed.sale.changeDue) > 0 && <> · Change due <strong>{app.money(completed.sale.changeDue)}</strong></>}
                </p>
              </div>
            </div>
            {completed.duplicate && <Alert tone="info">This request was already processed — no duplicate sale was created.</Alert>}
            <ReceiptActions sale={completed.sale} business={completed.business} />
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-3">
              <div className="shadow"><ReceiptView sale={completed.sale} business={completed.business} /></div>
            </div>
          </div>
        )}
      </Modal>

      {/* Quick-add customer */}
      <Modal
        open={custModal}
        onClose={() => setCustModal(false)}
        title="Add customer"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCustModal(false)}>Cancel</Button>
            <Button onClick={addCustomer} loading={custBusy} disabled={!newCust.name.trim()}>Save customer</Button>
          </>
        }
      >
        <div className="space-y-4">
          {custErr && <Alert tone="error">{custErr}</Alert>}
          <TextField label="Name" value={newCust.name} onChange={(e) => setNewCust((c) => ({ ...c, name: e.target.value }))} required autoFocus />
          <TextField label="Phone (optional)" type="tel" value={newCust.phone} onChange={(e) => setNewCust((c) => ({ ...c, phone: e.target.value }))} />
        </div>
      </Modal>

      {/* Barcode scanner */}
      <CameraScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleBarcodeScanned}
        continuous={true}
        title="Live Barcode Scanner"
        description="Hold any product barcode in front of the camera to instantly add it to the cart."
      />
    </div>
  );
}
