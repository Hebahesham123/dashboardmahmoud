"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDash } from "./DataProvider";
import { exportWorkbook } from "@/lib/exporter";
import { rangeForPreset, PRESET_LABELS, type RangePreset } from "@/lib/format";

const INQUIRIES_URL = process.env.NEXT_PUBLIC_INQUIRIES_URL || "";

type NavItem = { href: string; label: string; icon: string; external?: boolean };

const INQUIRIES_ITEM: NavItem[] = INQUIRIES_URL
  ? [{ href: INQUIRIES_URL, label: "Sample Inquiries", icon: "📨", external: true }]
  : [];

// Full nav for the normal (admin) dashboard.
const NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "📊" },
  { href: "/daily", label: "Daily Report", icon: "📅" },
  { href: "/products", label: "Products", icon: "🛍️" },
  { href: "/abandoned", label: "Abandoned Carts", icon: "🛒" },
  { href: "/order", label: "Create Order", icon: "🧾" },
  { href: "/compare", label: "Compare", icon: "⚖️" },
  { href: "/import", label: "Import Data", icon: "⬆️" },
  ...INQUIRIES_ITEM,
];

// Restricted nav for the call-center login (only these tabs).
const CC_NAV: NavItem[] = [
  { href: "/abandoned", label: "Abandoned Carts", icon: "🛒" },
  { href: "/order", label: "Create Order", icon: "🧾" },
  ...INQUIRIES_ITEM,
];
// Routes a call-center user may open (anything else → /abandoned).
const CC_ALLOWED = ["/abandoned", "/order"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { month, range, setRange, rangeLabel, lastSync, loading, reload, metrics, agg, channels, bestSellers } =
    useDash();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Call-center restricted mode (set after logging in at /team). When on,
  // only the limited nav shows and other routes redirect to /abandoned.
  const [ccMode, setCcMode] = useState(false);
  const [ccEmail, setCcEmail] = useState("");
  useEffect(() => {
    const on = typeof window !== "undefined" && localStorage.getItem("cc_mode") === "1";
    setCcMode(on);
    setCcEmail(on ? localStorage.getItem("cc_email") || "" : "");
  }, [pathname]);
  useEffect(() => {
    if (ccMode && !CC_ALLOWED.includes(pathname)) router.replace("/abandoned");
  }, [ccMode, pathname, router]);

  const nav = ccMode ? CC_NAV : NAV;
  const logoutCc = () => {
    localStorage.removeItem("cc_mode");
    localStorage.removeItem("cc_email");
    window.location.href = "/team";
  };

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

  // Keep a ref to the latest runSync so the interval always uses the CURRENT
  // date range (otherwise the 60s auto-sync reloads with a stale first-render
  // range and reverts the numbers to "this month").
  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;

  // Auto-sync: pull new Shopify orders on load and every 60s while open,
  // so orders placed in Shopify appear in the dashboard on their own.
  useEffect(() => {
    runSyncRef.current(true);
    const id = setInterval(() => runSyncRef.current(true), 60_000);
    return () => clearInterval(id);
  }, []);

  // Auto-sync offline (Odoo استهلاكي) invoices while the dashboard is open —
  // a small 3-day window (~3s) refreshed on load and every 15 min. Same-origin
  // call is authorized via the x-ui-sync header (no secret needed). Admin only.
  const runOdooRef = useRef<() => Promise<void>>(async () => {});
  runOdooRef.current = async () => {
    if (ccMode) return;
    try {
      await fetch("/api/sync-odoo?days=3", { headers: { "x-ui-sync": "1" } });
      await reload();
    } catch {
      /* ignore — offline sync is best-effort */
    }
  };
  useEffect(() => {
    runOdooRef.current();
    const id = setInterval(() => runOdooRef.current(), 15 * 60_000);
    return () => clearInterval(id);
  }, []);

  const doExport = async () => {
    setExporting(true);
    try {
      await exportWorkbook({ month, metrics, agg, channels, bestSellers });
    } finally {
      setExporting(false);
    }
  };

  // The login page renders bare — no sidebar, no header — until they log in.
  if (pathname === "/team") {
    return <div className="min-h-screen bg-gray-50">{children}</div>;
  }

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
          {nav.map((item) => {
            const active = pathname === item.href;
            const cls = `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              active ? "bg-indigo-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`;
            if (item.external) {
              return (
                <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" className={cls}>
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                  <span className="ml-auto text-xs text-slate-500">↗</span>
                </a>
              );
            }
            return (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={cls}>
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-0 w-full border-t border-slate-800 p-4 text-[11px] text-slate-500">
          {ccMode ? (
            <button onClick={logoutCc} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700">
              Log out
            </button>
          ) : lastSync ? (
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
          {ccMode ? (
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-700">Call Center</span>
              {ccEmail && <span className="text-sm text-gray-400">· {ccEmail}</span>}
            </div>
          ) : (
            <>
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
            </>
          )}
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
