"use client";

import Link from "next/link";
import { useDash } from "@/components/DataProvider";
import { Card, EmptyState, PageHeader, Badge, MetricCard } from "@/components/ui";
import { SalesTrend, ChannelDonut, FunnelBars } from "@/components/charts";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { buildInsights } from "@/lib/insights";
import { useMemo } from "react";

export default function OverviewPage() {
  const { rangeLabel, metrics, agg, channels, bestSellers, abandonedCount, loading, error } = useDash();

  const online = channels.filter((c) => c.channel === "online").reduce((s, c) => s + Number(c.sales), 0);
  const offline = channels.filter((c) => c.channel === "offline").reduce((s, c) => s + Number(c.sales), 0);
  // Real abandoned checkouts from Shopify (not the analytics funnel).
  const totalCheckouts = agg.orders_count + abandonedCount; // checkouts started = completed + abandoned
  const abandoned = totalCheckouts > 0 ? abandonedCount / totalCheckouts : 0;
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

      {/* KPI cards — only the 6 requested, each showing how it's calculated */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          label="Total Sales"
          value={fmtMoney(agg.total_sales)}
          accent="emerald"
          icon="💰"
          formula={`Σ net sales (after refunds) of ${fmtNum(agg.orders_count)} online orders`}
        />
        <MetricCard
          label="Number of Orders"
          value={fmtNum(agg.orders_count)}
          accent="indigo"
          icon="🧾"
          formula="Paid online orders, excluding cancelled"
        />
        <MetricCard
          label="Total Checkout"
          value={fmtNum(totalCheckouts)}
          accent="sky"
          icon="🧮"
          formula={`${fmtNum(agg.orders_count)} orders + ${fmtNum(abandonedCount)} abandoned = ${fmtNum(totalCheckouts)}`}
        />
        <MetricCard
          label="Abandoned Checkout"
          value={fmtNum(abandonedCount)}
          accent="amber"
          icon="🛒"
          href="/abandoned"
          formula={`Real Shopify abandoned carts in ${rangeLabel}. Click to view & call →`}
        />
        <MetricCard
          label="Abandoned Checkout Rate"
          value={fmtPct(abandoned)}
          accent="rose"
          icon="📉"
          href="/abandoned"
          formula={`${fmtNum(abandonedCount)} abandoned ÷ ${fmtNum(totalCheckouts)} checkouts = ${fmtPct(abandoned)}`}
        />
      </div>

      {/* Trend + channel split */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Sales & Orders Trend">
          {metrics.length ? <SalesTrend data={metrics} /> : <EmptyState loading={loading} />}
        </Card>
        <Card title="Online vs Offline" subtitle="Offline arrives in Phase 2 (Odoo)">
          {agg.total_sales > 0 ? (
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
