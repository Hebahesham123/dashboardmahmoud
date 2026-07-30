"use client";

import Link from "next/link";
import { useDash } from "@/components/DataProvider";
import { Card, EmptyState, PageHeader, Badge, MetricCard } from "@/components/ui";
import { VisitorsPerSession, ChannelDonut, FunnelBars } from "@/components/charts";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { buildInsights } from "@/lib/insights";
import { useEffect, useMemo, useState } from "react";

export default function OverviewPage() {
  const { rangeLabel, range, metrics, agg, bestSellers, abandonedCount, offlineAmount, offlineInvoices, prev, loading, error } = useDash();

  /** Build a MetricCard `compare` prop, or undefined while `prev` is loading. */
  const cmp = (
    current: number,
    previous: number | undefined,
    format: (n: number) => string,
    inverse?: boolean
  ) =>
    prev && previous !== undefined
      ? { current, previous, label: prev.label, format, inverse }
      : undefined;

  const online = agg.total_sales; // Shopify online (website + call-center)
  const offline = offlineAmount; // Odoo استهلاكي (offline) sales
  // Sales before vs after refunds.
  const salesAfter = Number(agg.total_sales) || 0; // net (after refunds)
  const refunds = Number(agg.total_refunds) || 0;
  const salesBefore = salesAfter + refunds; // gross (before refunds)
  // Real abandoned checkouts from Shopify (not the analytics funnel).
  const totalCheckouts = agg.orders_count + abandonedCount; // checkouts started = completed + abandoned
  const abandoned = totalCheckouts > 0 ? abandonedCount / totalCheckouts : 0;
  // Average order value per channel.
  const onlineAov = agg.orders_count > 0 ? salesAfter / agg.orders_count : 0;
  const offlineAov = offlineInvoices > 0 ? offline / offlineInvoices : 0;
  const prevOnlineAov = prev && prev.orders > 0 ? prev.salesAfter / prev.orders : undefined;
  const prevOfflineAov =
    prev && prev.offlineInvoices > 0 ? prev.offlineAmount / prev.offlineInvoices : undefined;
  const insights = useMemo(() => buildInsights(metrics, bestSellers), [metrics, bestSellers]);

  const funnel = [
    { label: "Visitors", value: agg.visitors },
    { label: "Sessions", value: agg.sessions },
    { label: "Add to Cart", value: agg.add_to_cart },
    { label: "Reached Checkout", value: agg.reached_checkout },
    { label: "Orders", value: agg.orders_count },
  ];

  return (
    <div>
      <PageHeader title="Overview" description={`Key performance for ${rangeLabel}.`} />

      {error && <ErrorBanner msg={error} />}

      {/* KPI cards — two channels side by side: OFFLINE left, ONLINE right.
          Rows, top to bottom: sales after refund · orders · AOV · abandoned.
          Cards are interleaved (offline, online) so each row lines up, and every
          card carries a vs-previous-period delta. */}
      <div className="mb-6">
        <div className="mb-3 hidden gap-4 md:grid md:grid-cols-2">
          <ChannelHeader
            title="Offline — Branches"
            subtitle={`Odoo invoices (Maadi, Semoha, …) — ${rangeLabel}`}
            accent="bg-violet-50 text-violet-700 ring-violet-200"
            icon="🏬"
          />
          <ChannelHeader
            title="Online — Website"
            subtitle={`Shopify website + call-center — ${rangeLabel}`}
            accent="bg-emerald-50 text-emerald-700 ring-emerald-200"
            icon="🌐"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* 1 — Total Sales (after refund) */}
          <MetricCard
            tag="Offline"
            label="Total Sales (after refund)"
            value={fmtMoney(offline)}
            accent="violet"
            icon="🏬"
            formula={`${fmtNum(offlineInvoices)} Odoo branch invoices in ${rangeLabel}, net of returns.`}
            compare={cmp(offline, prev?.offlineAmount, fmtMoney)}
          />
          <MetricCard
            tag="Online"
            label="Total Sales (after refund)"
            value={fmtMoney(salesAfter)}
            accent="emerald"
            icon="💰"
            formula={`Before refund ${fmtMoney(salesBefore)} − refunds ${fmtMoney(refunds)} = ${fmtMoney(
              salesAfter
            )}. Includes ${fmtMoney(agg.unpaid_sales)} COD / not paid yet (${fmtNum(agg.unpaid_orders)} orders).`}
            compare={cmp(salesAfter, prev?.salesAfter, fmtMoney)}
          />

          {/* 2 — Total Number of Orders */}
          <MetricCard
            tag="Offline"
            label="Total Number of Orders"
            value={fmtNum(offlineInvoices)}
            accent="violet"
            icon="🧾"
            formula="Distinct Odoo branch invoices; refund (R-prefix) invoices are not counted as orders."
            compare={cmp(offlineInvoices, prev?.offlineInvoices, fmtNum)}
          />
          <MetricCard
            tag="Online"
            label="Total Number of Orders"
            value={fmtNum(agg.orders_count)}
            accent="indigo"
            icon="🧾"
            formula={`Website + call-center, incl. cancelled/refunded/COD; only POS excluded. Total checkouts started: ${fmtNum(
              totalCheckouts
            )}.`}
            compare={cmp(agg.orders_count, prev?.orders, fmtNum)}
          />

          {/* 3 — Avg Order Value */}
          <MetricCard
            tag="Offline"
            label="Avg Order Value"
            value={fmtMoney(offlineAov)}
            accent="violet"
            icon="📐"
            formula={`${fmtMoney(offline)} ÷ ${fmtNum(offlineInvoices)} invoices = ${fmtMoney(offlineAov)}`}
            compare={cmp(offlineAov, prevOfflineAov, fmtMoney)}
          />
          <MetricCard
            tag="Online"
            label="Avg Order Value"
            value={fmtMoney(onlineAov)}
            accent="sky"
            icon="📐"
            formula={`${fmtMoney(salesAfter)} ÷ ${fmtNum(agg.orders_count)} orders = ${fmtMoney(onlineAov)}`}
            compare={cmp(onlineAov, prevOnlineAov, fmtMoney)}
          />

          {/* 4 — Abandoned Checkout (online only) */}
          <MetricCard
            tag="Offline"
            label="Abandoned Checkout"
            value="—"
            accent="violet"
            icon="🛒"
            muted
            formula="Not applicable — walk-in branch sales have no checkout funnel to abandon."
          />
          <MetricCard
            tag="Online"
            label="Abandoned Checkout"
            value={fmtNum(abandonedCount)}
            accent="amber"
            icon="🛒"
            href="/abandoned"
            formula={`Real Shopify abandoned carts in ${rangeLabel} — ${fmtNum(abandonedCount)} ÷ ${fmtNum(
              totalCheckouts
            )} checkouts = ${fmtPct(abandoned)}. Click to view & call →`}
            compare={cmp(abandonedCount, prev?.abandonedCount, fmtNum, true)}
          />

        </div>
      </div>

      <ShopifyBreakdown start={range.start} end={range.end} />

      {/* Sessions per unique visitor + channel split */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Sessions per Unique Visitor (daily)" subtitle={`Bars: visitors & sessions · Line: sessions ÷ unique visitor — ${rangeLabel}`}>
          {metrics.some((m) => Number(m.visitors) > 0 || Number(m.sessions) > 0) ? (
            <VisitorsPerSession data={metrics} />
          ) : (
            <EmptyState
              loading={loading}
              label="No per-day visitors yet. Import a by-day traffic report, or assign an upload to a date on the Import page."
            />
          )}
        </Card>
        <Card
          title="Online vs Offline"
          subtitle={`Offline (استهلاكي / Odoo): ${fmtNum(offlineInvoices)} invoices · ${fmtMoney(offline)}`}
        >
          {online > 0 || offline > 0 ? (
            <ChannelDonut online={online} offline={offline} />
          ) : (
            <EmptyState loading={loading} />
          )}
        </Card>
      </div>

      {/* Insights + funnel + best sellers */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Insights" className="lg:col-span-1">
          <ul className="divide-y divide-gray-100">
            {insights.map((i, idx) => (
              <li key={idx} className="flex gap-3 px-5 py-3">
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    i.tone === "good" ? "bg-emerald-500" : i.tone === "bad" ? "bg-rose-500" : "bg-sky-500"
                  }`}
                />
                <div>
                  <div className="text-sm font-medium text-gray-800">{i.title}</div>
                  <div className="text-xs text-gray-500">{i.text}</div>
                </div>
              </li>
            ))}
            {insights.length === 0 && <li className="px-5 py-8 text-center text-sm text-gray-400">No insights yet.</li>}
          </ul>
        </Card>

        <Card title="Conversion Funnel">
          {agg.sessions > 0 ? <FunnelBars steps={funnel} /> : <EmptyState loading={loading} label="Import traffic data to see the funnel." />}
        </Card>

        <Card
          title="Top Products"
          action={
            <Link href="/products" className="text-xs font-medium text-indigo-600 hover:underline">
              View all →
            </Link>
          }
        >
          <ol className="divide-y divide-gray-100">
            {bestSellers.slice(0, 6).map((b, i) => (
              <li key={`${b.product_id}-${i}`} className="flex items-center gap-3 px-5 py-2.5">
                <Badge color={i === 0 ? "amber" : "gray"}>{i + 1}</Badge>
                <span className="flex-1 truncate text-sm text-gray-700" title={b.title}>
                  {b.title}
                </span>
                <span className="text-sm font-semibold text-gray-900">{fmtNum(Number(b.units_sold))}</span>
              </li>
            ))}
            {bestSellers.length === 0 && <li className="px-5 py-8 text-center text-sm text-gray-400">No sales yet.</li>}
          </ol>
        </Card>
      </div>
    </div>
  );
}

/** Column header above a channel's KPI stack (desktop only). */
function ChannelHeader({
  title,
  subtitle,
  accent,
  icon,
}: {
  title: string;
  subtitle: string;
  accent: string;
  icon: string;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ring-1 ${accent}`}>
      <span className="text-lg">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-bold">{title}</div>
        <div className="truncate text-xs opacity-70">{subtitle}</div>
      </div>
    </div>
  );
}

interface Row {
  count: number;
  value: number;
}
interface Breakdown {
  total: Row;
  website: Row;
  draftPaid: Row;
  draftOther: Row;
  pos: Row;
  cancelled: Row;
  onlineCounted: Row;
  financial: Record<string, Row>;
}

/** Live Shopify order breakdown for the selected range — detailed table. */
function ShopifyBreakdown({ start, end }: { start: string; end: string }) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    fetch(`/api/order-breakdown?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.ok) setData(j);
        else setErr(j.error || "Failed to load");
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [start, end]);

  const TR = ({ label, row, tone, counted, note }: { label: string; row: Row; tone?: string; counted?: boolean; note?: string }) => (
    <tr className={`border-t ${counted ? "bg-indigo-50/40" : ""}`}>
      <td className={`px-4 py-2.5 ${tone ?? "text-gray-700"}`}>
        {label}
        {note && <span className="ml-2 text-xs text-gray-400">{note}</span>}
      </td>
      <td className="px-4 py-2.5 text-right font-medium">{fmtNum(row.count)}</td>
      <td className="px-4 py-2.5 text-right font-medium">{fmtMoney(row.value)}</td>
    </tr>
  );

  return (
    <Card className="mb-6" title="Order Breakdown" subtitle="Live from Shopify for the selected range — counts & values">
      <div className="p-5">
        {loading ? (
          <EmptyState loading label="Loading from Shopify…" />
        ) : err ? (
          <div className="text-sm text-rose-600">{err}</div>
        ) : data ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Category</th>
                    <th className="px-4 py-2 text-right">Orders</th>
                    <th className="px-4 py-2 text-right">Value (gross)</th>
                  </tr>
                </thead>
                <tbody>
                  <TR label="🌐 Website orders" row={data.website} tone="text-emerald-700" />
                  <TR label="📞 Call-center drafts — paid" row={data.draftPaid} tone="text-emerald-700" note="counted" />
                  <TR label="📞 Call-center drafts — pending/cancelled" row={data.draftOther} tone="text-gray-600" note="counted" />
                  <TR label="✅ Counted as Online (dashboard)" row={data.onlineCounted} tone="font-semibold text-indigo-700" counted />
                  <TR label="🏬 POS / retail (offline)" row={data.pos} tone="text-gray-400" note="excluded" />
                  <TR label="❌ Cancelled (incl. above)" row={data.cancelled} tone="text-rose-600" />
                  <TR label="📦 All Shopify orders (any source)" row={data.total} tone="font-semibold text-gray-900" />
                </tbody>
              </table>
            </div>

            <div className="mt-5">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">By payment status</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Orders</th>
                      <th className="px-4 py-2 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(data.financial)
                      .sort((a, b) => b[1].count - a[1].count)
                      .map(([k, v]) => (
                        <tr key={k} className="border-t">
                          <td className="px-4 py-2 capitalize text-gray-700">{k.replace(/_/g, " ")}</td>
                          <td className="px-4 py-2 text-right font-medium">{fmtNum(v.count)}</td>
                          <td className="px-4 py-2 text-right font-medium">{fmtMoney(v.value)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="mt-3 text-xs text-gray-400">
              The dashboard’s “online” = <strong>website + all call-center orders</strong> (the highlighted row). Only POS/retail is excluded (offline). “Value” is gross (before refunds). Note: Shopify’s Sales report is accrual (returns on the refund day), so its monthly total can still differ slightly.
            </p>
          </>
        ) : null}
      </div>
    </Card>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
      <strong>Couldn’t load data.</strong> {msg}
      <div className="mt-1 text-xs text-rose-500">
        Make sure the Supabase migrations (v2 &amp; v3) have been run.
      </div>
    </div>
  );
}
