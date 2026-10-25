"use client";

import { useApp } from "@/components/app-context";
import { cn } from "@/components/ui";
import { addDays, todayInTz } from "@/lib/money";

export interface DateRange {
  from: string;
  to: string;
}

export function defaultRange(tz: string, days: number): DateRange {
  const today = todayInTz(tz);
  return { from: addDays(today, -(days - 1)), to: today };
}

/** Preset buttons plus explicit from/to dates. Dates are calendar days in the business timezone. */
export function RangePicker({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const { settings } = useApp();
  const today = todayInTz(settings.timezone);
  const presets = [
    { id: "today", label: "Today", from: today, to: today },
    { id: "7d", label: "7 days", from: addDays(today, -6), to: today },
    { id: "30d", label: "30 days", from: addDays(today, -29), to: today },
    { id: "month", label: "This month", from: `${today.slice(0, 8)}01`, to: today },
  ];
  const active = presets.find((p) => p.from === value.from && p.to === value.to)?.id;
  const dateCls = "h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20";
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={active === p.id}
            onClick={() => onChange({ from: p.from, to: p.to })}
            className={cn("h-9 px-3 text-sm font-medium transition-colors", active === p.id ? "bg-navy-900 text-white" : "text-slate-700 hover:bg-slate-50")}
          >
            {p.label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="range-from">From date</label>
      <input id="range-from" type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to: value.to })} className={dateCls} />
      <span className="text-slate-400" aria-hidden>–</span>
      <label className="sr-only" htmlFor="range-to">To date</label>
      <input id="range-to" type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ from: value.from, to: e.target.value })} className={dateCls} />
    </div>
  );
}
