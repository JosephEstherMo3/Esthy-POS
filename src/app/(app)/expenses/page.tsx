"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  CreditCard,
  Download,
  Filter,
  Landmark,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  TrendingDown,
  WalletCards,
} from "lucide-react";
import { useApp } from "@/components/app-context";
import { defaultRange, RangePicker, type DateRange } from "@/components/range-picker";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  cn,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  Select,
  SelectField,
  Skeleton,
  StatCard,
  TextField,
  useToast,
} from "@/components/ui";
import { ApiError, apiFetch, qs, useApi } from "@/lib/client";

interface ExpenseItem {
  id: string;
  title: string;
  amount: string;
  date: string;
  paymentMethod: "cash" | "transfer" | "card";
  reference: string | null;
  note: string | null;
  createdAt: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  recordedById: string;
  recordedByName: string;
}

interface ExpenseCategory {
  id: string;
  name: string;
  color: string;
}

interface ExpensesRes {
  expenses: ExpenseItem[];
  summary: {
    totalAmount: string;
    count: number;
    categoryBreakdown: { name: string; color: string; total: number; count: number }[];
  };
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  transfer: "Bank Transfer",
  card: "POS / Card",
};

export default function ExpensesPage() {
  const app = useApp();
  const toast = useToast();
  const [range, setRange] = useState<DateRange>(() => defaultRange(app.settings.timezone, 30));
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMethod, setSelectedMethod] = useState("");

  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);
  const [categoriesModalOpen, setCategoriesModalOpen] = useState(false);
  const [deletingExpense, setDeletingExpense] = useState<ExpenseItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Queries
  const queryParams = qs({
    from: range.from,
    to: range.to,
    categoryId: selectedCategory || undefined,
    paymentMethod: selectedMethod || undefined,
    q: search || undefined,
  });

  const { data, error, reload } = useApi<ExpensesRes>(`/api/expenses?${queryParams}`);
  const categoriesApi = useApi<{ categories: ExpenseCategory[] }>("/api/expenses/categories");

  const categories = useMemo(() => categoriesApi.data?.categories ?? [], [categoriesApi.data]);
  const expenses = useMemo(() => data?.expenses ?? [], [data]);
  const summary = data?.summary ?? { totalAmount: "0.00", count: 0, categoryBreakdown: [] };

  const topCategory = summary.categoryBreakdown[0];

  async function handleDelete() {
    if (!deletingExpense) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/api/expenses/${deletingExpense.id}`, { method: "DELETE" });
      toast.success("Expense deleted");
      setDeletingExpense(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  function exportCsv() {
    if (expenses.length === 0) {
      toast.error("No expenses to export");
      return;
    }
    const headers = ["Date", "Category", "Description", "Amount", "Currency", "Payment Method", "Reference", "Recorded By", "Note"];
    const rows = expenses.map((e) => [
      e.date,
      e.categoryName || "Uncategorized",
      `"${e.title.replace(/"/g, '""')}"`,
      e.amount,
      app.settings.currency,
      PAYMENT_LABELS[e.paymentMethod] || e.paymentMethod,
      e.reference ? `"${e.reference.replace(/"/g, '""')}"` : "",
      `"${e.recordedByName.replace(/"/g, '""')}"`,
      e.note ? `"${e.note.replace(/"/g, '""')}"` : "",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `expenses_${range.from}_to_${range.to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Expenses CSV exported");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses & Overheads"
        description="Log, track, and categorize operating bills, restocking expenses, and shop overheads."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setCategoriesModalOpen(true)}>
              <Tag className="h-4 w-4" /> Categories
            </Button>
            {app.can("expenses.manage") && (
              <Button onClick={() => setRecordModalOpen(true)}>
                <Plus className="h-4 w-4" /> Record expense
              </Button>
            )}
          </div>
        }
      />

      {/* Overview Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Expenses in Period"
          value={app.money(summary.totalAmount)}
          hint={`${summary.count} expense${summary.count === 1 ? "" : "s"} recorded`}
          tone="navy"
          icon={<TrendingDown className="h-5 w-5 text-red-500" />}
        />
        <StatCard
          label="Top Expense Category"
          value={topCategory ? topCategory.name : "None"}
          hint={topCategory ? `${app.money(topCategory.total)} (${Math.round((topCategory.total / Number(summary.totalAmount || 1)) * 100)}% of total)` : "No expenses recorded"}
          icon={<WalletCards className="h-5 w-5 text-navy-600" />}
        />
        <StatCard
          label="Categories Active"
          value={String(summary.categoryBreakdown.length)}
          hint={`${categories.length} total categories configured`}
          icon={<Tag className="h-5 w-5 text-emerald-600" />}
        />
      </div>

      {/* Category breakdown bar if expenses exist */}
      {summary.categoryBreakdown.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Expenses by Category</p>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {summary.categoryBreakdown.map((cat, idx) => {
              const pct = (cat.total / Number(summary.totalAmount || 1)) * 100;
              return (
                <div
                  key={cat.name + idx}
                  style={{ width: `${pct}%`, backgroundColor: cat.color }}
                  title={`${cat.name}: ${app.money(cat.total)} (${pct.toFixed(1)}%)`}
                  className="transition-all"
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
            {summary.categoryBreakdown.slice(0, 6).map((cat) => (
              <div key={cat.name} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                <span className="text-slate-700">{cat.name}:</span>
                <span className="font-semibold text-slate-900">{app.money(cat.total)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filter and Control Bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <RangePicker value={range} onChange={setRange} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1 sm:flex-initial">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search description, reference…"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-emerald-600 focus:outline-none"
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={selectedMethod}
              onChange={(e) => setSelectedMethod(e.target.value)}
              className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 focus:border-emerald-600 focus:outline-none"
            >
              <option value="">All Payment Methods</option>
              <option value="cash">Cash</option>
              <option value="transfer">Bank Transfer</option>
              <option value="card">Card / POS</option>
            </select>
            <Button variant="secondary" size="sm" onClick={exportCsv} disabled={expenses.length === 0}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>
      </Card>

      {/* Expenses Table */}
      <Card>
        <CardHeader
          title="Recorded Expenses"
          description={
            summary.count > 0
              ? `Showing ${summary.count} expense${summary.count === 1 ? "" : "s"} totaling ${app.money(summary.totalAmount)}`
              : "No expenses recorded for this timeframe."
          }
        />
        {error && !data ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={<WalletCards className="h-8 w-8 text-slate-400" />}
            title="No expenses in this period"
            description="Use 'Record expense' to log supplier payments, utilities, or daily petty cash."
            action={
              app.can("expenses.manage") ? (
                <Button onClick={() => setRecordModalOpen(true)}>
                  <Plus className="h-4 w-4" /> Record expense
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Date</th>
                  <th scope="col" className="px-5 py-3 font-medium">Description</th>
                  <th scope="col" className="px-5 py-3 font-medium">Category</th>
                  <th scope="col" className="px-5 py-3 font-medium">Payment</th>
                  <th scope="col" className="px-5 py-3 font-medium">Recorded By</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Amount</th>
                  {app.can("expenses.manage") && <th scope="col" className="px-5 py-3 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="whitespace-nowrap px-5 py-3.5 font-medium text-slate-900">
                      {item.date}
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-slate-900">{item.title}</p>
                      {item.reference && <p className="text-xs text-slate-500">Ref: {item.reference}</p>}
                      {item.note && <p className="text-xs italic text-slate-400">{item.note}</p>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `${item.categoryColor || "#94a3b8"}18`,
                          color: item.categoryColor || "#475569",
                        }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: item.categoryColor || "#94a3b8" }} />
                        {item.categoryName || "Uncategorized"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-xs text-slate-600">
                      <Badge tone="slate">{PAYMENT_LABELS[item.paymentMethod] || item.paymentMethod}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-xs text-slate-600">
                      {item.recordedByName}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold text-slate-900">
                      {app.money(item.amount)}
                    </td>
                    {app.can("expenses.manage") && (
                      <td className="whitespace-nowrap px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingExpense(item)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            title="Edit expense"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingExpense(item)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Delete expense"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Record / Edit Expense Modal */}
      {(recordModalOpen || editingExpense) && (
        <ExpenseFormModal
          categories={categories}
          expense={editingExpense}
          onClose={() => {
            setRecordModalOpen(false);
            setEditingExpense(null);
          }}
          onSaved={() => {
            setRecordModalOpen(false);
            setEditingExpense(null);
            reload();
          }}
          onCategoriesChange={() => categoriesApi.reload()}
        />
      )}

      {/* Manage Categories Modal */}
      {categoriesModalOpen && (
        <CategoriesModal
          categories={categories}
          onClose={() => setCategoriesModalOpen(false)}
          onChanged={() => {
            categoriesApi.reload();
            reload();
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deletingExpense}
        onClose={() => !deleteBusy && setDeletingExpense(null)}
        onConfirm={handleDelete}
        loading={deleteBusy}
        title="Delete expense"
        message={`Are you sure you want to delete the expense "${deletingExpense?.title}" of ${deletingExpense ? app.money(deletingExpense.amount) : ""}? This cannot be undone.`}
        confirmLabel="Delete expense"
        danger
      />
    </div>
  );
}

// ───────────────────────── Form Modal ─────────────────────────

function ExpenseFormModal({
  categories,
  expense,
  onClose,
  onSaved,
  onCategoriesChange,
}: {
  categories: ExpenseCategory[];
  expense: ExpenseItem | null;
  onClose: () => void;
  onSaved: () => void;
  onCategoriesChange: () => void;
}) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(expense?.title ?? "");
  const [amount, setAmount] = useState(expense ? expense.amount : "");
  const [date, setDate] = useState(expense?.date ?? today);
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? (categories[0]?.id || ""));
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "card">(expense?.paymentMethod ?? "cash");
  const [reference, setReference] = useState(expense?.reference ?? "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleSave() {
    if (!title.trim()) {
      setErr("Please enter a description for the expense.");
      return;
    }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      setErr("Please enter an amount greater than 0.");
      return;
    }

    setBusy(true);
    setErr("");

    const body = {
      title: title.trim(),
      amount: num,
      date,
      categoryId: categoryId || null,
      paymentMethod,
      reference: reference.trim() || null,
      note: note.trim() || null,
    };

    try {
      if (expense) {
        await apiFetch(`/api/expenses/${expense.id}`, { method: "PATCH", body });
        toast.success("Expense updated");
      } else {
        await apiFetch("/api/expenses", { method: "POST", body });
        toast.success("Expense recorded");
      }
      onSaved();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={expense ? "Edit expense" : "Record new expense"}
      description="Enter the expense details, category, and payment method."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} loading={busy} disabled={!title.trim() || !amount}>
            {expense ? "Save changes" : "Record expense"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <Alert tone="error">{err}</Alert>}

        <TextField
          label="Description / Item"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Electricity bill, Shop rent, Restock courier"
          required
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Amount"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </SelectField>

          <SelectField
            label="Payment method"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as "cash" | "transfer" | "card")}
          >
            <option value="cash">Cash</option>
            <option value="transfer">Bank Transfer</option>
            <option value="card">POS / Card</option>
          </SelectField>
        </div>

        <TextField
          label="Reference / Invoice # (optional)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. INV-2024-089, Transfer ref"
        />

        <TextField
          label="Additional note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Paid to building manager"
        />
      </div>
    </Modal>
  );
}

// ───────────────────────── Categories Modal ─────────────────────────

function CategoriesModal({
  categories,
  onClose,
  onChanged,
}: {
  categories: ExpenseCategory[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const PRESET_COLORS = [
    "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
    "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#64748b",
  ];

  async function addCategory() {
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await apiFetch("/api/expenses/categories", {
        method: "POST",
        body: { name: name.trim(), color },
      });
      toast.success("Category added");
      setName("");
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Expense Categories"
      description="Organize your shop expenses and see where money is going."
      size="md"
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}
    >
      <div className="space-y-5">
        {err && <Alert tone="error">{err}</Alert>}

        {/* Add new category form */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">Create new category</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-700">Category name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Internet & Airtime, Licenses"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-emerald-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Color</label>
              <div className="flex items-center gap-1.5">
                {PRESET_COLORS.slice(0, 5).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={cn(
                      "h-7 w-7 rounded-full transition-transform",
                      color === c ? "ring-2 ring-slate-900 ring-offset-2 scale-110" : "opacity-80 hover:opacity-100",
                    )}
                  />
                ))}
              </div>
            </div>
            <Button onClick={addCategory} loading={busy} disabled={!name.trim()}>
              Add
            </Button>
          </div>
        </div>

        {/* List of existing categories */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active categories ({categories.length})</p>
          <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="text-sm font-medium text-slate-800">{c.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
