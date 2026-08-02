"use client";

import { ReactNode } from "react";
import Link from "next/link";

type Accent = "indigo" | "emerald" | "amber" | "sky" | "rose" | "violet";
const ACCENTS: Record<Accent, string> = {
  indigo: "bg-indigo-50 text-indigo-600",
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  sky: "bg-sky-50 text-sky-600",
  rose: "bg-rose-50 text-rose-600",
  violet: "bg-violet-50 text-violet-600",
};

/** KPI card that shows the value AND a "How: …" formula line with live numbers. */
export function MetricCard({
  label,
  value,
  formula,
  icon,
  accent = "indigo",
  href,
  tag,
  muted,
  compare,
  sub,
}: {
  label: string;
  value: string;
  formula: ReactNode;
  icon?: ReactNode;
  accent?: Accent;
  href?: string;
  /** Small chip above the label — e.g. the channel ("Online" / "Offline"). */
  tag?: string;
  /** Dim the value, for a not-applicable metric. */
  muted?: boolean;
  /** Second figure shown beside the value — e.g. the rate next to a count. */
  sub?: string;
  /** Comparison vs the previous period — renders a ▲/▼ % chip under the value. */
  compare?: {
    current: number;
    previous: number;
    label: string; // period being compared against, e.g. "2026-06"
    format: (n: number) => string;
    /** true when up is bad (abandoned carts, returns) — flips the colours. */
    inverse?: boolean;
  };
}) {
  const inner = (
    <div className="h-full rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {tag && (
            <span className={`mb-1.5 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${ACCENTS[accent]}`}>
              {tag}
            </span>
          )}
          <span className="block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        </div>
        {icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ACCENTS[accent]}`}>{icon}</span>
        )}
      </div>
      <div className={`mt-3 flex flex-wrap items-baseline gap-x-2 text-3xl font-bold ${muted ? "text-gray-300" : "text-gray-900"}`}>
        {value}
        {sub && (
          <span className={`text-lg font-semibold ${muted ? "text-gray-300" : "text-gray-400"}`}>{sub}</span>
        )}
      </div>
      {compare && <CompareChip {...compare} />}
      <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-500">
        <span className="font-medium text-gray-400">How: </span>
        {formula}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-400">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/**
 * "▲ 12.4% vs 2026-06 (EGP 121,300)" — the change against the comparison
 * period. Green = better, rose = worse (flipped when `inverse`). A previous
 * value of 0 has no meaningful percentage, so only the direction is shown.
 */
function CompareChip({
  current,
  previous,
  label,
  format,
  inverse,
}: {
  current: number;
  previous: number;
  label: string;
  format: (n: number) => string;
  inverse?: boolean;
}) {
  const diff = current - previous;
  const flat = Math.abs(diff) < 0.005;
  const pct = previous !== 0 ? Math.abs(diff / previous) : null;
  const better = inverse ? diff < 0 : diff > 0;
  const tone = flat
    ? "bg-gray-50 text-gray-500"
    : better
    ? "bg-emerald-50 text-emerald-700"
    : "bg-rose-50 text-rose-700";
  const arrow = flat ? "—" : diff > 0 ? "▲" : "▼";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold ${tone}`}>
        {arrow}
        {flat ? "no change" : pct === null ? format(Math.abs(diff)) : `${(pct * 100).toFixed(1)}%`}
      </span>
      <span className="text-gray-400">
        vs {label} · {format(previous)}
      </span>
    </div>
  );
}

export function Card({
  children,
  className = "",
  title,
  action,
  subtitle,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold text-gray-800">{title}</h2>}
            {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  delta,
  hint,
  icon,
  accent = "indigo",
}: {
  label: string;
  value: string;
  delta?: number | null; // fraction change vs comparison
  hint?: string;
  icon?: ReactNode;
  accent?: "indigo" | "emerald" | "amber" | "sky" | "rose" | "violet";
}) {
  const accents: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    sky: "bg-sky-50 text-sky-600",
    rose: "bg-rose-50 text-rose-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
        {icon && (
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accents[accent]}`}>
            {icon}
          </span>
        )}
      </div>
      <div className="mt-3 text-2xl font-bold text-gray-900">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {delta !== null && delta !== undefined && (
          <Delta value={delta} />
        )}
        {hint && <span className="text-gray-400">{hint}</span>}
      </div>
    </div>
  );
}

export function Delta({ value }: { value: number }) {
  if (!isFinite(value) || value === 0) return <span className="text-gray-400">—</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? "▲" : "▼"} {Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

export function Badge({ children, color = "gray" }: { children: ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray: "bg-gray-100 text-gray-600",
    indigo: "bg-indigo-100 text-indigo-700",
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    sky: "bg-sky-100 text-sky-700",
    rose: "bg-rose-100 text-rose-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ loading, label }: { loading?: boolean; label?: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-gray-400">
      {loading ? (
        <>
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-500" />
          <span className="text-sm">Loading…</span>
        </>
      ) : (
        <span className="text-sm">{label ?? "No data for this period."}</span>
      )}
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
    </div>
  );
}
