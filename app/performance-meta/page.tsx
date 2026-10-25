"use client";

import { useCallback, useEffect, useMemo, useState, ReactNode } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useDash } from "@/components/DataProvider";
import { fmtNum } from "@/lib/format";
import type { MetaReport, MetaRow } from "@/lib/meta";

// ------------------------------------------------------------------ helpers

/** Rates derived from a row's raw counts — never averaged across rows. */
function derive(r: MetaRow) {
  const d = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    roas: d(r.revenue, r.spend),
    cpa: d(r.spend, r.purchases),
    ctr: d(r.linkClicks, r.impressions),
    cpc: d(r.spend, r.linkClicks),
    cpm: d(r.spend, r.impressions) * 1000,
    freq: d(r.impressions, r.reach),
    cvr: d(r.purchases, r.linkClicks),
    aov: d(r.revenue, r.purchases),
  };
}

function shiftDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((+new Date(b + "T00:00:00Z") - +new Date(a + "T00:00:00Z")) / 864e5) + 1;
}

const pct = (n: number, digits = 2) => `${(n * 100).toFixed(digits)}%`;
const x2 = (n: number) => `${n.toFixed(2)}x`;
const compact = (n: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);

const roasTone = (r: number) =>
  r >= 4 ? "text-emerald-600 bg-emerald-50" : r >= 2 ? "text-amber-600 bg-amber-50" : r > 0 ? "text-rose-600 bg-rose-50" : "text-gray-400 bg-gray-50";

const PLATFORM: Record<string, { label: string; color: string }> = {
  facebook: { label: "Facebook", color: "#1877f2" },
  instagram: { label: "Instagram", color: "#d62976" },
  messenger: { label: "Messenger", color: "#00b2ff" },
  audience_network: { label: "Audience Network", color: "#64748b" },
  threads: { label: "Threads", color: "#111827" },
};
const prettyPos = (s: string) =>
  s.replace(/^(facebook|instagram|messenger|an)_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ------------------------------------------------------------------ page

interface Resp {
  ok: boolean;
  configured: boolean;
  error?: string;
  report?: MetaReport;
}

export default function PerformanceMetaPage() {
  const { range, agg } = useDash();
  const [sample, setSample] = useState(false);
  // /performance-meta?sample=1 opens straight into the sample preview.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("sample") === "1") setSample(true);
  }, []);
  const [cur, setCur] = useState<Resp | null>(null);
  const [prev, setPrev] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  const prevRange = useMemo(() => {
    const n = daysBetween(range.start, range.end);
    return { start: shiftDays(range.start, -n), end: shiftDays(range.start, -1) };
  }, [range.start, range.end]);

  const load = useCallback(async () => {
    setLoading(true);
    const q = (s: string, e: string) => `/api/meta?from=${s}&to=${e}${sample ? "&sample=1" : ""}`;
    try {
      const [a, b] = await Promise.all([
        fetch(q(range.start, range.end)).then((r) => r.json()),
        fetch(q(prevRange.start, prevRange.end)).then((r) => r.json()).catch(() => null),
      ]);
      setCur(a);
      setPrev(b);
    } catch (e) {
      setCur({ ok: false, configured: true, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, prevRange.start, prevRange.end, sample]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !cur) return <Skeleton />;
  if (cur && !cur.configured && !sample) return <Setup onPreview={() => setSample(true)} />;
  if (cur && !cur.ok)
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <div className="mb-1 font-semibold">Couldn't load Meta data</div>
        {cur.error}
        <button onClick={load} className="ml-3 rounded-lg bg-rose-600 px-3 py-1 text-xs font-medium text-white">
          Retry
        </button>
      </div>
    );
  if (!cur?.report) return <Skeleton />;

  return (
    <Dashboard
      r={cur.report}
      p={prev?.ok ? prev.report ?? null : null}
      prevLabel={`${prevRange.start} → ${prevRange.end}`}
      shopifySales={agg.total_sales}
      shopifyOrders={agg.orders_count}
      loading={loading}
      reload={load}
      sample={sample}
      exitSample={cur.configured ? () => setSample(false) : undefined}
    />
  );
}

// ------------------------------------------------------------------ dashboard

function Dashboard({
  r,
  p,
  prevLabel,
  shopifySales,
  shopifyOrders,
  loading,
  reload,
  sample,
  exitSample,
}: {
  r: MetaReport;
  p: MetaReport | null;
  prevLabel: string;
  shopifySales: number;
  shopifyOrders: number;
  loading: boolean;
  reload: () => void;
  sample: boolean;
  exitSample?: () => void;
}) {
  const cur = r.account.currency || "EGP";
  const money = useCallback(
    (n: number, digits = 0) =>
      new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: digits }).format(n || 0),
    [cur]
  );
  const t = r.totals;
  const d = derive(t);
  const pd = p ? derive(p.totals) : null;
  const mer = t.spend > 0 ? shopifySales / t.spend : 0;
  const share = shopifySales > 0 ? Math.min(1, t.revenue / shopifySales) : 0;

  const spark = (f: (row: MetaRow) => number) => r.daily.map((x) => f(x));

  return (
    <div className="space-y-6">
      {/* ---------- hero ---------- */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-900 p-6 text-white shadow-xl lg:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 font-semibold backdrop-blur">
                <MetaLogo /> Meta Ads
              </span>
              {sample ? (
                <span className="rounded-full bg-amber-400/90 px-2.5 py-1 font-bold text-amber-950">SAMPLE DATA</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live
                </span>
              )}
              <span className="text-white/50">{r.account.timezone}</span>
            </div>
            <h1 className="mt-3 truncate text-2xl font-bold tracking-tight lg:text-3xl">Performance · {r.account.name}</h1>
            <p className="mt-1 text-sm text-white/60">
              {r.window.from} → {r.window.to} · compared with {prevLabel}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
              <HeroStat label="Spend" value={money(t.spend)} />
              <HeroStat label="Purchase value" value={money(t.revenue)} />
              <HeroStat label="Purchases" value={fmtNum(t.purchases)} />
              <HeroStat label="Reach" value={compact(t.reach)} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                onClick={reload}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium backdrop-blur transition hover:bg-white/20"
              >
                {loading ? "Refreshing…" : "↻ Refresh"}
              </button>
              {exitSample && (
                <button onClick={exitSample} className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-950">
                  Show live data
                </button>
              )}
            </div>
          </div>
          <RoasGauge roas={d.roas} />
        </div>
      </section>

      {/* ---------- KPI tiles ---------- */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Amount spent" value={money(t.spend)} cur={t.spend} prev={p?.totals.spend} fmt={money} inverse data={spark((x) => x.spend)} color="#6366f1" />
        <Tile label="Purchase value" value={money(t.revenue)} cur={t.revenue} prev={p?.totals.revenue} fmt={money} data={spark((x) => x.revenue)} color="#10b981" />
        <Tile label="ROAS" value={x2(d.roas)} cur={d.roas} prev={pd?.roas} fmt={x2} data={spark((x) => derive(x).roas)} color="#f59e0b" />
        <Tile label="Purchases" value={fmtNum(t.purchases)} cur={t.purchases} prev={p?.totals.purchases} fmt={fmtNum} data={spark((x) => x.purchases)} color="#0ea5e9" />
        <Tile label="Cost per purchase" value={money(d.cpa, 2)} cur={d.cpa} prev={pd?.cpa} fmt={(n) => money(n, 2)} inverse data={spark((x) => derive(x).cpa)} color="#f43f5e" />
        <Tile label="Link CTR" value={pct(d.ctr)} cur={d.ctr} prev={pd?.ctr} fmt={(n) => pct(n)} data={spark((x) => derive(x).ctr)} color="#8b5cf6" />
        <Tile label="CPM" value={money(d.cpm, 2)} cur={d.cpm} prev={pd?.cpm} fmt={(n) => money(n, 2)} inverse data={spark((x) => derive(x).cpm)} color="#64748b" />
        <Tile label="Cost per link click" value={money(d.cpc, 2)} cur={d.cpc} prev={pd?.cpc} fmt={(n) => money(n, 2)} inverse data={spark((x) => derive(x).cpc)} color="#14b8a6" />
      </div>

      {/* ---------- trend + blended ---------- */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Daily performance" subtitle="Pick what to plot">
          <Trend r={r} money={money} />
        </Panel>
        <Panel title="Meta vs. the whole store" subtitle="Meta spend against every Shopify sale in the range">
          <div className="space-y-5 p-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Blended ROAS (MER)</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-bold text-gray-900">{x2(mer)}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${roasTone(mer)}`}>
                  {mer >= 4 ? "Healthy" : mer >= 2 ? "OK" : "Low"}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {money(shopifySales)} Shopify sales ÷ {money(t.spend)} Meta spend
              </p>
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500">
                <span>Sales Meta takes credit for</span>
                <span className="font-semibold text-gray-800">{pct(share, 1)}</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-fuchsia-500" style={{ width: `${share * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                {money(t.revenue)} of {money(shopifySales)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 text-sm">
              <Mini label="Shopify orders" value={fmtNum(shopifyOrders)} />
              <Mini label="Meta purchases" value={fmtNum(t.purchases)} />
              <Mini label="Cost / Shopify order" value={money(shopifyOrders ? t.spend / shopifyOrders : 0, 2)} />
              <Mini label="Meta AOV" value={money(d.aov)} />
              <Mini label="Frequency" value={d.freq.toFixed(2)} />
              <Mini label="Click → purchase" value={pct(d.cvr)} />
            </div>
          </div>
        </Panel>
      </div>

      {/* ---------- funnel + insights ---------- */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title="Conversion funnel" subtitle="Each step as a share of the one before it">
          <Funnel t={t} />
        </Panel>
        <Panel className="xl:col-span-2" title="What stands out" subtitle="Read off the numbers in this range">
          <Insights r={r} p={p} money={money} />
        </Panel>
      </div>

      {/* ---------- entity tables ---------- */}
      <Panel title="Campaigns, ad sets & ads" subtitle="Click a column to sort">
        <Entities r={r} money={money} />
      </Panel>

      {/* ---------- creatives ---------- */}
      {r.ads.length > 0 && (
        <Panel title="Top creatives" subtitle="Ads with the most spend, ranked">
          <Creatives r={r} money={money} />
        </Panel>
      )}

      {/* ---------- audience ---------- */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Audience · age × gender" subtitle="Darker = more">
          <AgeGender r={r} money={money} />
        </Panel>
        <Panel title="Placements" subtitle="Where the money goes and what it brings back">
          <Placements r={r} money={money} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Devices" subtitle="Share of spend">
          <Devices r={r} money={money} />
        </Panel>
        <Panel className="xl:col-span-2" title="Regions" subtitle="Ranked by spend">
          <Regions r={r} money={money} />
        </Panel>
      </div>

      {r.hours.length > 0 && (
        <Panel title="Hour of day" subtitle={`Account time zone (${r.account.timezone}) · bar = spend, colour = ROAS`}>
          <Hours r={r} money={money} />
        </Panel>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

type Money = (n: number, digits?: number) => string;

function Panel({
  title,
  subtitle,
  children,
  className = "",
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-white/50">{label}</div>
      <div className="mt-0.5 text-lg font-bold">{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-gray-400">{label}</div>
      <div className="font-semibold text-gray-800">{value}</div>
    </div>
  );
}

function MetaLogo() {
  return (
    <svg width="16" height="10" viewBox="0 0 36 20" fill="none" aria-hidden>
      <path
        d="M4 14c0 3 1.6 5 4 5 2 0 3.2-1 5.6-5.2L17 8c1.8-3 3.6-6 6.8-6C28.4 2 32 7 32 12.4 32 16 30.4 19 27.4 19c-2.4 0-3.8-1.3-6-5L18 8.6M4 14c0-4.8 2.6-12 6.8-12 2.4 0 4.2 1.6 7.2 6.6"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Semi-circle gauge, full at 8x. */
function RoasGauge({ roas }: { roas: number }) {
  const max = 8;
  const f = Math.min(1, roas / max);
  const R = 70;
  const len = Math.PI * R;
  const color = roas >= 4 ? "#34d399" : roas >= 2 ? "#fbbf24" : "#fb7185";
  return (
    <div className="relative mx-auto w-56 shrink-0 lg:mx-0">
      <svg viewBox="0 0 180 105" className="w-full">
        <defs>
          <linearGradient id="gauge" x1="0" x2="1">
            <stop offset="0%" stopColor="#fb7185" />
            <stop offset="45%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <path d="M20 95 A70 70 0 0 1 160 95" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="14" strokeLinecap="round" />
        <path
          d="M20 95 A70 70 0 0 1 160 95"
          fill="none"
          stroke="url(#gauge)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${len * f} ${len}`}
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div className="text-4xl font-black tracking-tight" style={{ color }}>
          {roas.toFixed(2)}x
        </div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-white/50">Return on ad spend</div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  cur,
  prev,
  fmt,
  inverse,
  data,
  color,
}: {
  label: string;
  value: string;
  cur: number;
  prev?: number;
  fmt: (n: number) => string;
  inverse?: boolean;
  data: number[];
  color: string;
}) {
  const has = prev !== undefined && prev !== null;
  const diff = has ? cur - (prev as number) : 0;
  const chg = has && prev ? diff / (prev as number) : null;
  const good = inverse ? diff < 0 : diff > 0;
  const id = `sp-${label.replace(/\W/g, "")}`;
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold text-gray-900">{value}</div>
      {has && (
        <div className="mt-1 flex items-center gap-1.5 text-xs" title={`Previous: ${fmt(prev as number)}`}>
          <span
            className={`rounded-md px-1.5 py-0.5 font-semibold ${
              Math.abs(diff) < 1e-9 ? "bg-gray-50 text-gray-500" : good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            {Math.abs(diff) < 1e-9 ? "—" : diff > 0 ? "▲" : "▼"} {chg === null ? "new" : `${Math.abs(chg * 100).toFixed(1)}%`}
          </span>
          <span className="text-gray-400">vs prev.</span>
        </div>
      )}
      <div className="-mx-4 -mb-4 mt-2 h-12">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.map((v, i) => ({ i, v }))} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const TREND_VIEWS = ["Spend & value", "ROAS", "Purchases & CPA", "CTR & CPM"] as const;

function Trend({ r, money }: { r: MetaReport; money: Money }) {
  const [view, setView] = useState<(typeof TREND_VIEWS)[number]>("Spend & value");
  const data = r.daily.map((x) => {
    const d = derive(x);
    return {
      date: x.day.slice(5),
      spend: Math.round(x.spend),
      revenue: Math.round(x.revenue),
      roas: Number(d.roas.toFixed(2)),
      purchases: x.purchases,
      cpa: Number(d.cpa.toFixed(2)),
      ctr: Number((d.ctr * 100).toFixed(2)),
      cpm: Number(d.cpm.toFixed(2)),
    };
  });
  const tip = { borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12, boxShadow: "0 10px 30px -10px rgba(0,0,0,.2)" };
  return (
    <div className="p-4">
      <div className="mb-3 inline-flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
        {TREND_VIEWS.map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              view === v ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gRoas" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="date" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis yAxisId="l" fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={compact} />
            <YAxis yAxisId="r" orientation="right" fontSize={11} tickLine={false} axisLine={false} width={44} />
            {view === "Spend & value" && (
              <>
                <Tooltip contentStyle={tip} formatter={(v: number, n) => [money(v), n]} />
                <Area yAxisId="l" type="monotone" dataKey="revenue" name="Purchase value" stroke="#10b981" strokeWidth={2.5} fill="url(#gRev)" />
                <Bar yAxisId="l" dataKey="spend" name="Spend" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={22} />
              </>
            )}
            {view === "ROAS" && (
              <>
                <Tooltip contentStyle={tip} formatter={(v: number) => [`${v}x`, "ROAS"]} />
                <Area yAxisId="l" type="monotone" dataKey="roas" name="ROAS" stroke="#f59e0b" strokeWidth={2.5} fill="url(#gRoas)" />
              </>
            )}
            {view === "Purchases & CPA" && (
              <>
                <Tooltip contentStyle={tip} formatter={(v: number, n) => [n === "Cost per purchase" ? money(v, 2) : fmtNum(v), n]} />
                <Bar yAxisId="r" dataKey="purchases" name="Purchases" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Line yAxisId="l" type="monotone" dataKey="cpa" name="Cost per purchase" stroke="#f43f5e" strokeWidth={2.5} dot={false} />
              </>
            )}
            {view === "CTR & CPM" && (
              <>
                <Tooltip contentStyle={tip} formatter={(v: number, n) => [n === "CPM" ? money(v, 2) : `${v}%`, n]} />
                <Line yAxisId="l" type="monotone" dataKey="cpm" name="CPM" stroke="#64748b" strokeWidth={2.5} dot={false} />
                <Line yAxisId="r" type="monotone" dataKey="ctr" name="Link CTR" stroke="#8b5cf6" strokeWidth={2.5} dot={false} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Funnel({ t }: { t: MetaRow }) {
  const steps = [
    { label: "Impressions", v: t.impressions, c: "#6366f1" },
    { label: "Link clicks", v: t.linkClicks, c: "#7c3aed" },
    { label: "Landing page views", v: t.landingViews, c: "#9333ea" },
    { label: "Content views", v: t.viewContent, c: "#c026d3" },
    { label: "Adds to cart", v: t.addToCart, c: "#db2777" },
    { label: "Checkouts started", v: t.checkout, c: "#e11d48" },
    { label: "Purchases", v: t.purchases, c: "#f97316" },
  ].filter((s, i) => i < 2 || s.v > 0);
  const top = Math.max(1, steps[0].v);
  return (
    <div className="space-y-2 p-5">
      {steps.map((s, i) => {
        // Log scale, so the bottom of the funnel stays visible next to impressions.
        const w = s.v > 0 ? Math.max(6, (Math.log10(s.v + 1) / Math.log10(top + 1)) * 100) : 2;
        const step = i > 0 && steps[i - 1].v > 0 ? s.v / steps[i - 1].v : null;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <div className="w-36 shrink-0 text-right text-xs font-medium text-gray-500">{s.label}</div>
            <div className="relative h-9 flex-1">
              <div
                className="flex h-full items-center rounded-lg px-3 text-xs font-bold text-white shadow-sm transition-all duration-700"
                style={{ width: `${w}%`, background: `linear-gradient(90deg, ${s.c}, ${s.c}cc)` }}
              >
                {compact(s.v)}
              </div>
            </div>
            <div className="w-16 shrink-0 text-right text-xs">
              {step !== null ? (
                <span className="font-semibold text-gray-700">{pct(step, step < 0.01 ? 2 : 1)}</span>
              ) : (
                <span className="text-gray-300">—</span>
              )}
            </div>
          </div>
        );
      })}
      <p className="pt-2 text-[11px] text-gray-400">
        Bar widths use a log scale. Steps with no events are hidden — they need the Meta Pixel / Conversions API to report them.
      </p>
    </div>
  );
}

function Insights({ r, p, money }: { r: MetaReport; p: MetaReport | null; money: Money }) {
  const items: { tone: "good" | "bad" | "info"; text: ReactNode }[] = [];
  const spent = r.campaigns.filter((c) => c.spend > 0);
  const best = [...spent].filter((c) => c.purchases > 0).sort((a, b) => derive(b).roas - derive(a).roas)[0];
  if (best)
    items.push({
      tone: "good",
      text: (
        <>
          <b>{best.name}</b> returns the most: {x2(derive(best).roas)} on {money(best.spend)}.
        </>
      ),
    });
  const waste = spent.filter((c) => c.purchases === 0 && c.spend > r.totals.spend * 0.03);
  if (waste.length)
    items.push({
      tone: "bad",
      text: (
        <>
          {waste.length} campaign{waste.length > 1 ? "s" : ""} spent {money(waste.reduce((a, c) => a + c.spend, 0))} with no
          purchases ({waste.slice(0, 2).map((c) => c.name).join(", ")}
          {waste.length > 2 ? "…" : ""}). Check if that's intended (awareness) or wasted.
        </>
      ),
    });
  const losing = spent.filter((c) => c.purchases > 0 && derive(c).roas < 1);
  if (losing.length)
    items.push({ tone: "bad", text: <>{losing.length} campaign(s) bring back less than they cost (ROAS under 1x).</> });
  const d = derive(r.totals);
  if (d.freq > 3) items.push({ tone: "bad", text: <>Frequency is {d.freq.toFixed(1)} — people see the ads often; creative fatigue is likely.</> });
  if (p) {
    const pd = derive(p.totals);
    if (pd.cpm > 0 && d.cpm > pd.cpm * 1.2)
      items.push({ tone: "bad", text: <>CPM rose {pct(d.cpm / pd.cpm - 1, 0)} on the previous period — reaching people costs more.</> });
    if (pd.roas > 0) {
      const ch = d.roas / pd.roas - 1;
      if (Math.abs(ch) > 0.1)
        items.push({
          tone: ch > 0 ? "good" : "bad",
          text: <>ROAS is {ch > 0 ? "up" : "down"} {pct(Math.abs(ch), 0)} on the previous period ({x2(pd.roas)} → {x2(d.roas)}).</>,
        });
    }
  }
  const topPlace = [...r.placements].filter((x) => x.spend > r.totals.spend * 0.05).sort((a, b) => derive(b).roas - derive(a).roas)[0];
  if (topPlace)
    items.push({
      tone: "info",
      text: (
        <>
          Best placement: <b>{PLATFORM[topPlace.platform]?.label ?? topPlace.platform} {prettyPos(topPlace.position)}</b> at{" "}
          {x2(derive(topPlace).roas)}.
        </>
      ),
    });
  const fem = r.ageGender.filter((x) => x.gender === "female").reduce((a, x) => a + x.spend, 0);
  if (r.totals.spend > 0 && r.ageGender.length)
    items.push({ tone: "info", text: <>{pct(fem / r.totals.spend, 0)} of spend reaches women.</> });

  if (!items.length) return <div className="p-5 text-sm text-gray-400">Nothing unusual in this range.</div>;
  const icon = { good: "▲", bad: "!", info: "i" };
  const tone = {
    good: "bg-emerald-100 text-emerald-700",
    bad: "bg-rose-100 text-rose-700",
    info: "bg-sky-100 text-sky-700",
  };
  return (
    <ul className="divide-y divide-gray-50">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 px-5 py-3 text-sm text-gray-600">
          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${tone[it.tone]}`}>
            {icon[it.tone]}
          </span>
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

type Col = { key: string; label: string; get: (x: MetaRow) => number; fmt: (n: number) => string };

function Entities({ r, money }: { r: MetaReport; money: Money }) {
  const [tab, setTab] = useState<"campaigns" | "adsets" | "ads">("campaigns");
  const [sort, setSort] = useState("spend");
  const [asc, setAsc] = useState(false);
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);

  const cols: Col[] = [
    { key: "spend", label: "Spend", get: (x) => x.spend, fmt: (n) => money(n) },
    { key: "revenue", label: "Value", get: (x) => x.revenue, fmt: (n) => money(n) },
    { key: "roas", label: "ROAS", get: (x) => derive(x).roas, fmt: x2 },
    { key: "purchases", label: "Purch.", get: (x) => x.purchases, fmt: fmtNum },
    { key: "cpa", label: "CPA", get: (x) => derive(x).cpa, fmt: (n) => money(n, 2) },
    { key: "ctr", label: "CTR", get: (x) => derive(x).ctr, fmt: (n) => pct(n) },
    { key: "cpm", label: "CPM", get: (x) => derive(x).cpm, fmt: (n) => money(n, 2) },
    { key: "impressions", label: "Impr.", get: (x) => x.impressions, fmt: compact },
  ];

  type Row = MetaRow & { id: string; name: string; sub: string; status?: string; budget?: number | null };
  const rows: Row[] =
    tab === "campaigns"
      ? r.campaigns.map((c) => ({ ...c, sub: c.objective }))
      : tab === "adsets"
      ? r.adsets.map((c) => ({ ...c, sub: c.campaign }))
      : r.ads.map((c) => ({ ...c, sub: c.campaign }));

  const col = cols.find((c) => c.key === sort) ?? cols[0];
  const list = rows
    .filter((x) => !q || `${x.name} ${x.sub}`.toLowerCase().includes(q.toLowerCase()))
    .filter((x) => !activeOnly || !x.status || x.status === "ACTIVE")
    .sort((a, b) => (asc ? 1 : -1) * (col.get(a) - col.get(b)));
  const maxSpend = Math.max(1, ...rows.map((x) => x.spend));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3">
        <div className="inline-flex rounded-xl bg-gray-100 p-1">
          {(["campaigns", "adsets", "ads"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                tab === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {k === "adsets" ? "Ad sets" : k} <span className="text-gray-400">{(k === "campaigns" ? r.campaigns : k === "adsets" ? r.adsets : r.ads).length}</span>
            </button>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="w-48 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
        />
        {tab === "campaigns" && (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="rounded" />
            Active only
          </label>
        )}
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50/95 text-[11px] uppercase tracking-wide text-gray-500 backdrop-blur">
            <tr>
              <th className="px-5 py-2.5 text-left font-semibold">Name</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => (sort === c.key ? setAsc(!asc) : (setSort(c.key), setAsc(false)))}
                  className="cursor-pointer select-none px-3 py-2.5 text-right font-semibold hover:text-gray-800"
                >
                  {c.label}
                  {sort === c.key && <span className="ml-0.5 text-indigo-500">{asc ? "↑" : "↓"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {list.map((x) => {
              const roas = derive(x).roas;
              return (
                <tr key={x.id} className="transition hover:bg-indigo-50/40">
                  <td className="max-w-[320px] px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      {x.status && (
                        <span
                          title={x.status}
                          className={`h-2 w-2 shrink-0 rounded-full ${x.status === "ACTIVE" ? "bg-emerald-500" : x.status === "PAUSED" ? "bg-amber-400" : "bg-gray-300"}`}
                        />
                      )}
                      <span className="truncate font-medium text-gray-800" title={x.name}>
                        {x.name}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400">
                      <span className="truncate capitalize">{x.sub}</span>
                      {x.budget ? <span className="shrink-0">· {money(x.budget)}/budget</span> : null}
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-indigo-400" style={{ width: `${(x.spend / maxSpend) * 100}%` }} />
                    </div>
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-gray-700">
                      {c.key === "roas" ? (
                        <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${roasTone(roas)}`}>{x2(roas)}</span>
                      ) : (
                        c.fmt(c.get(x))
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!list.length && (
              <tr>
                <td colSpan={cols.length + 1} className="px-5 py-10 text-center text-sm text-gray-400">
                  Nothing matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Creatives({ r, money }: { r: MetaReport; money: Money }) {
  const ads = r.ads.slice(0, 8);
  const grads = ["from-indigo-500 to-blue-500", "from-fuchsia-500 to-pink-500", "from-amber-400 to-orange-500", "from-emerald-500 to-teal-500"];
  return (
    <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
      {ads.map((a, i) => {
        const d = derive(a);
        return (
          <div key={a.id} className="group overflow-hidden rounded-xl border border-gray-200 transition hover:shadow-lg">
            <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
              {a.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.thumbnail} alt={a.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              ) : (
                <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${grads[i % grads.length]} text-3xl font-black text-white/80`}>
                  #{i + 1}
                </div>
              )}
              <span className={`absolute right-2 top-2 rounded-lg px-2 py-1 text-xs font-bold shadow ${roasTone(d.roas)}`}>{x2(d.roas)}</span>
              <span className="absolute left-2 top-2 rounded-lg bg-black/60 px-2 py-1 text-[11px] font-bold text-white">#{i + 1}</span>
            </div>
            <div className="p-3">
              <div className="truncate text-sm font-semibold text-gray-800" title={a.name}>
                {a.name}
              </div>
              <div className="truncate text-[11px] text-gray-400">{a.campaign}</div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                <Stat3 l="Spend" v={money(a.spend)} />
                <Stat3 l="Purch." v={fmtNum(a.purchases)} />
                <Stat3 l="CTR" v={pct(d.ctr, 1)} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
function Stat3({ l, v }: { l: string; v: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-1 py-1.5">
      <div className="text-[10px] uppercase text-gray-400">{l}</div>
      <div className="truncate text-xs font-semibold text-gray-800">{v}</div>
    </div>
  );
}

function AgeGender({ r, money }: { r: MetaReport; money: Money }) {
  const [m, setM] = useState<"spend" | "roas" | "purchases">("spend");
  const ages = Array.from(new Set(r.ageGender.map((x) => x.age))).sort();
  const genders = ["female", "male", "unknown"].filter((g) => r.ageGender.some((x) => x.gender === g && x.spend > 0));
  const val = (x: MetaRow) => (m === "spend" ? x.spend : m === "purchases" ? x.purchases : derive(x).roas);
  const max = Math.max(1e-9, ...r.ageGender.map(val));
  const cell = (age: string, g: string) => r.ageGender.find((x) => x.age === age && x.gender === g);
  if (!r.ageGender.length) return <div className="p-5 text-sm text-gray-400">No audience breakdown for this range.</div>;
  return (
    <div className="p-5">
      <div className="mb-4 inline-flex rounded-xl bg-gray-100 p-1">
        {(["spend", "purchases", "roas"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setM(k)}
            className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize ${m === k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            {k === "roas" ? "ROAS" : k}
          </button>
        ))}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `72px repeat(${ages.length}, minmax(0,1fr))` }}>
        <div />
        {ages.map((a) => (
          <div key={a} className="text-center text-[11px] font-medium text-gray-500">
            {a}
          </div>
        ))}
        {genders.map((g) => (
          <FragmentRow key={g}>
            <div className="flex items-center text-xs font-medium capitalize text-gray-600">{g}</div>
            {ages.map((a) => {
              const c = cell(a, g);
              const v = c ? val(c) : 0;
              const f = v / max;
              const base = g === "female" ? "236,72,153" : g === "male" ? "59,130,246" : "100,116,139";
              return (
                <div
                  key={a}
                  title={c ? `${g} ${a}: ${money(c.spend)} spend · ${c.purchases} purchases · ${x2(derive(c).roas)}` : ""}
                  className="flex h-14 items-center justify-center rounded-lg text-[11px] font-bold transition hover:scale-105"
                  style={{ background: `rgba(${base},${0.08 + f * 0.82})`, color: f > 0.5 ? "white" : "#334155" }}
                >
                  {m === "spend" ? compact(v) : m === "roas" ? `${v.toFixed(1)}x` : fmtNum(v)}
                </div>
              );
            })}
          </FragmentRow>
        ))}
      </div>
    </div>
  );
}
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function Placements({ r, money }: { r: MetaReport; money: Money }) {
  const rows = r.placements.filter((x) => x.spend > 0).slice(0, 9);
  const max = Math.max(1, ...rows.map((x) => x.spend));
  if (!rows.length) return <div className="p-5 text-sm text-gray-400">No placement breakdown for this range.</div>;
  return (
    <div className="space-y-3 p-5">
      {rows.map((x) => {
        const pl = PLATFORM[x.platform] ?? { label: x.platform, color: "#94a3b8" };
        const roas = derive(x).roas;
        return (
          <div key={x.platform + x.position}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 font-medium text-gray-700">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: pl.color }} />
                {pl.label} · {prettyPos(x.position)}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                <span className="text-gray-500">{money(x.spend)}</span>
                <span className={`rounded px-1.5 py-0.5 font-bold ${roasTone(roas)}`}>{x2(roas)}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(x.spend / max) * 100}%`, background: pl.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Devices({ r, money }: { r: MetaReport; money: Money }) {
  const COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#64748b"];
  const label = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const data = r.devices.filter((x) => x.spend > 0).map((x) => ({ name: label(x.device), value: x.spend, roas: derive(x).roas }));
  const total = data.reduce((a, x) => a + x.value, 0);
  if (!data.length) return <div className="p-5 text-sm text-gray-400">No device breakdown for this range.</div>;
  return (
    <div className="p-5">
      <div className="relative h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={58} outerRadius={82} paddingAngle={3} stroke="none">
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => money(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[10px] uppercase text-gray-400">Spend</div>
          <div className="text-lg font-bold text-gray-800">{compact(total)}</div>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {data.map((x, i) => (
          <div key={x.name} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-gray-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              {x.name}
            </span>
            <span className="tabular-nums text-gray-500">
              {pct(x.value / total, 0)} · <b className="text-gray-800">{x2(x.roas)}</b>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Regions({ r, money }: { r: MetaReport; money: Money }) {
  const rows = r.regions.filter((x) => x.spend > 0).slice(0, 10);
  const max = Math.max(1, ...rows.map((x) => x.spend));
  if (!rows.length) return <div className="p-5 text-sm text-gray-400">No region breakdown for this range.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-gray-500">
          <tr className="border-b border-gray-100">
            <th className="px-5 py-2 text-left font-semibold">Region</th>
            <th className="px-3 py-2 text-left font-semibold">Spend</th>
            <th className="px-3 py-2 text-right font-semibold">Purch.</th>
            <th className="px-3 py-2 text-right font-semibold">CPA</th>
            <th className="px-5 py-2 text-right font-semibold">ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((x, i) => {
            const d = derive(x);
            return (
              <tr key={x.region} className="hover:bg-gray-50">
                <td className="px-5 py-2 text-gray-700">
                  <span className="mr-2 inline-block w-4 text-right text-xs text-gray-400">{i + 1}</span>
                  {x.region.replace(/ Governorate$/, "")}
                </td>
                <td className="w-1/3 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${(x.spend / max) * 100}%` }} />
                    </div>
                    <span className="w-24 text-right text-xs tabular-nums text-gray-600">{money(x.spend)}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtNum(x.purchases)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700">{money(d.cpa, 2)}</td>
                <td className="px-5 py-2 text-right">
                  <span className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${roasTone(d.roas)}`}>{x2(d.roas)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Hours({ r, money }: { r: MetaReport; money: Money }) {
  const max = Math.max(1, ...r.hours.map((h) => h.spend));
  const best = [...r.hours].filter((h) => h.purchases > 0).sort((a, b) => derive(b).roas - derive(a).roas)[0];
  return (
    <div className="p-5">
      <div className="flex h-36 items-end gap-1">
        {Array.from({ length: 24 }, (_, h) => {
          const x = r.hours.find((y) => y.hour === h);
          const roas = x ? derive(x).roas : 0;
          const hue = Math.min(140, (roas / 6) * 140); // red → green
          return (
            <div key={h} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className="w-full rounded-t-md transition-all duration-500 group-hover:opacity-80"
                style={{ height: `${x ? Math.max(3, (x.spend / max) * 100) : 2}%`, background: x ? `hsl(${hue} 70% 50%)` : "#e5e7eb" }}
              />
              {x && (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1 text-[11px] text-white shadow-lg group-hover:block">
                  {String(h).padStart(2, "0")}:00 · {money(x.spend)} · {x.purchases} purch. · {x2(roas)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-center text-[10px] text-gray-400">
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="flex-1">
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
      </div>
      {best && (
        <p className="mt-3 text-xs text-gray-500">
          Best hour for return: <b className="text-gray-800">{String(best.hour).padStart(2, "0")}:00</b> ({x2(derive(best).roas)}).
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ states

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="h-56 animate-pulse rounded-3xl bg-gradient-to-br from-slate-200 to-slate-100" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-gray-100" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-2xl bg-gray-100" />
    </div>
  );
}

function Setup({ onPreview }: { onPreview: () => void }) {
  const steps = [
    {
      t: "Get your Ad Account ID",
      d: (
        <>
          Meta Business Suite → <b>Settings → Accounts → Ad accounts</b>. Copy the number (e.g. <code>1234567890</code>).
        </>
      ),
    },
    {
      t: "Create a System User",
      d: (
        <>
          Business Settings → <b>Users → System users → Add</b> (role: Employee). Then <b>Assign assets</b> → your ad account → “View
          performance”.
        </>
      ),
    },
    {
      t: "Create a Meta app (if you have none)",
      d: (
        <>
          developers.facebook.com → <b>My Apps → Create app</b> → type “Business”. Add the <b>Marketing API</b> product. Connect the app to
          your Business in Business Settings → Apps.
        </>
      ),
    },
    {
      t: "Generate the token",
      d: (
        <>
          On the System User click <b>Generate new token</b> → pick the app → expiry <b>Never</b> → tick <code>ads_read</code> (and{" "}
          <code>read_insights</code>). Copy the token.
        </>
      ),
    },
    {
      t: "Add them to the dashboard",
      d: (
        <>
          Put the values in <code>.env.local</code> (and in Vercel → Settings → Environment Variables), then restart / redeploy.
        </>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-900 p-8 text-white shadow-xl">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/30 blur-3xl" />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">
          <MetaLogo /> Meta Ads
        </span>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Connect your Meta ad account</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/70">
          This page reads Facebook & Instagram ads results straight from the Meta Marketing API — spend, ROAS, purchases, campaigns,
          creatives, audience, placements and more. It needs two values; nothing is changed on your ad account (read-only).
        </p>
        <button onClick={onPreview} className="mt-5 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-indigo-900 shadow hover:bg-indigo-50">
          Preview with sample data →
        </button>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Steps" subtitle="About 10 minutes, done once">
          <ol className="space-y-4 p-5">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{i + 1}</span>
                <div className="text-sm">
                  <div className="font-semibold text-gray-800">{s.t}</div>
                  <div className="mt-0.5 text-gray-500 [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:text-xs">{s.d}</div>
                </div>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title=".env.local" subtitle="Server-side only — never put these in a NEXT_PUBLIC_ variable">
          <pre className="overflow-x-auto bg-slate-950 p-5 text-xs leading-relaxed text-slate-200">
{`# ---- Meta Ads (Performance Meta page) ----
META_ACCESS_TOKEN=EAAG...your-system-user-token
META_AD_ACCOUNT_ID=1234567890
# optional
META_API_VERSION=v23.0`}
          </pre>
          <div className="space-y-2 p-5 text-xs text-gray-500">
            <p>
              <b className="text-gray-700">Purchases & value</b> come from the Meta Pixel / Conversions API on Shopify. Install the
              “Facebook & Instagram” sales channel in Shopify so purchases are reported back to Meta.
            </p>
            <p>
              <b className="text-gray-700">Blended ROAS</b> on this page uses the Shopify sales already in the dashboard — no extra setup.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
