export const ATTRIBUTION = "Created during internship at Hamplus Hub";

/** Original receipt-inspired brand mark: a torn-edge receipt with an emerald confirmation badge. */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} role="img" aria-label="Charlotte Esthy logo">
      <rect width="40" height="40" rx="10" fill="#141d3d" />
      <path
        d="M13 9h15a1 1 0 0 1 1 1v21l-2.83-1.8-2.83 1.8-2.83-1.8-2.83 1.8-2.83-1.8L12 31V10a1 1 0 0 1 1-1z"
        fill="#fff"
      />
      <path d="M15.5 15.5h9" stroke="#141d3d" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15.5 20h5" stroke="#cbd5e1" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="26" cy="26" r="6" fill="#10b981" />
      <path d="M23.2 26l2 2 3.6-3.8" stroke="#fff" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandLogo({ light = false, size = 36 }: { light?: boolean; size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark size={size} />
      <div className="leading-tight">
        <div className={`text-[17px] font-semibold tracking-tight ${light ? "text-white" : "text-navy-900"}`}>Charlotte Esthy</div>
        <div className={`text-[11px] uppercase tracking-[0.14em] ${light ? "text-navy-300" : "text-slate-500"}`}>Point of Sale</div>
      </div>
    </div>
  );
}

export function Attribution({ className = "", light = false }: { className?: string; light?: boolean }) {
  return (
    <p className={`flex items-center justify-center gap-2 text-xs ${light ? "text-navy-300" : "text-slate-500"} ${className}`}>
      <span aria-hidden className="h-px w-5 bg-emerald-500/70" />
      <span className="italic">{ATTRIBUTION}</span>
      <span aria-hidden className="h-px w-5 bg-emerald-500/70" />
    </p>
  );
}
