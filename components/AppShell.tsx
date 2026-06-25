"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useDash } from "./DataProvider";
import { exportWorkbook } from "@/lib/exporter";
import { rangeForPreset, PRESET_LABELS, type RangePreset } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview", icon: "📊" },
  { href: "/daily", label: "Daily Report", icon: "📅" },
  { href: "/products", label: "Products", icon: "🛍️" },
  { href: "/abandoned", label: "Abandoned Carts", icon: "🛒" },
  { href: "/order", label: "Create Order", icon: "🧾" },
  { href: "/compare", label: "Compare", icon: "⚖️" },
  { href: "/import", label: "Import Data", icon: "⬆️" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { month, range, setRange, rangeLabel, lastSync, loading, reload, metrics, agg, channels, bestSellers } =
    useDash();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const runSync = async (silent: boolean) => {
    if (!silent) setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST", headers: { "x-ui-sync": "1" } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
      await reload();
      if (!silent)
        alert(`Synced ✓ ${json.ordersUpserted ?? 0} orders, ${json.itemsUpserted ?? 0} items updated.`);
    } catch (e) {
      if (!silent) alert(`Sync failed: ${(e as Error).message}`);
    } finally {
      if (!silent) setSyncing(false);
    }
  };

  // Auto-sync: pull new Shopify orders on load and every 60s while open,
  // so orders placed in Shopify appear in the dashboard on their own.
  useEffect(() => {
    runSync(true);
    const id = setInterval(() => runSync(true), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doExport = async () => {
    setExporting(true);
    try {
      await exportWorkbook({ month, metrics, agg, channels, bestSellers });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform bg-slate-900 text-slate-300 transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-6">
          <span className="text-xl">🛒</span>
          <div>
            <div className="text-sm font-bold text-white">Naguib Selim</div>
            <div className="text-[11px] text-slate-400">Sales Analytics</div>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-indigo-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-slate-800 p-4 text-[11px] text-slate-500">
          {lastSync ? (
            <>Last Shopify sync:<br />{new Date(lastSync).toLocaleString()}</>
          ) : (
            "Not synced yet"
          )}
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-gray-200 bg-white/80 px-4 backdrop-blur lg:px-8">
          <button
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <select
              onChange={(e) => {
                const r = rangeForPreset(e.target.value as RangePreset);
                setRange(r.start, r.end);
              }}
              defaultValue="this_month"
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
              title="Quick ranges"
            >
              {(Object.keys(PRESET_LABELS) as RangePreset[]).map((k) => (
                <option key={k} value={k}>{PRESET_LABELS[k]}</option>
              ))}
            </select>
            <input
              type="date"
              value={range.start}
              max={range.end}
              onChange={(e) => setRange(e.target.value, range.end)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <span className="text-gray-400">→</span>
            <input
              type="date"
              value={range.end}
              min={range.start}
              onChange={(e) => setRange(range.start, e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => runSync(false)}
              disabled={syncing}
              className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              title="Auto-syncs every 60s. Click to sync now."
            >
              {syncing ? "Syncing…" : "⟳ Sync Shopify"}
            </button>
            <button
              onClick={reload}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {loading ? "Refreshing…" : "↻ Refresh"}
            </button>
            <button
              onClick={doExport}
              disabled={exporting || metrics.length === 0}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {exporting ? "Exporting…" : "⬇ Export Excel"}
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
