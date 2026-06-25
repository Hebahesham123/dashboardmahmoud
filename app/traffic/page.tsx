"use client";

import Link from "next/link";
import { useDash } from "@/components/DataProvider";
import { Card, PageHeader, MetricCard, EmptyState } from "@/components/ui";
import { TrafficTrend, ConversionTrend, FunnelBars } from "@/components/charts";
import { fmtNum, fmtPct } from "@/lib/format";

export default function TrafficPage() {
  const { metrics, agg, traffic, abandonedCount, rangeLabel, loading } = useDash();

  const hasTraffic = agg.sessions > 0 || agg.visitors > 0;
  const orders = agg.orders_count;
  // Consistent with the Overview: conversion is orders / unique visitors.
  const conv = agg.visitors > 0 ? orders / agg.visitors : 0;
  const cartRate = agg.sessions > 0 ? agg.add_to_cart / agg.sessions : 0;
  const checkoutRate = agg.sessions > 0 ? agg.reached_checkout / agg.sessions : 0;
  // Abandoned = real Shopify abandoned checkouts (same as Overview).
  const totalCheckouts = orders + abandonedCount;
  const abandoned = totalCheckouts > 0 ? abandonedCount / totalCheckouts : 0;

  const funnel = [
    { label: "Visitors", value: agg.visitors },
    { label: "Sessions", value: agg.sessions },
    { label: "Add to Cart", value: agg.add_to_cart },
    { label: "Reached Checkout", value: agg.reached_checkout },
    { label: "Orders", value: orders },
  ];

  return (
    <div>
      <PageHeader title="Traffic & Funnel" description={`Storefront traffic (imported) and the path to purchase — ${rangeLabel}.`} />

      {!hasTraffic && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No traffic data imported for this range yet.{" "}
          <Link href="/import" className="font-semibold underline">
            Import a Shopify Analytics report
          </Link>{" "}
          (Visitors / Sessions / Add to Cart / Reached Checkout). Note: a single-month
          “by landing page” upload only fills a <strong>whole month</strong> range.
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Visitors" value={fmtNum(agg.visitors)} icon="👥" accent="violet" formula="Σ unique visitors from your imported analytics" />
        <MetricCard label="Sessions" value={fmtNum(agg.sessions)} icon="🖱️" accent="sky" formula="Σ sessions from your imported analytics" />
        <MetricCard label="Add-to-Cart Rate" value={fmtPct(cartRate)} icon="🛒" accent="amber" formula={`${fmtNum(agg.add_to_cart)} cart adds ÷ ${fmtNum(agg.sessions)} sessions = ${fmtPct(cartRate)}`} />
        <MetricCard label="Reached-Checkout Rate" value={fmtPct(checkoutRate)} icon="➡️" accent="indigo" formula={`${fmtNum(agg.reached_checkout)} reached checkout ÷ ${fmtNum(agg.sessions)} sessions = ${fmtPct(checkoutRate)}`} />
        <MetricCard label="Conversion Rate" value={fmtPct(conv)} icon="🎯" accent="emerald" formula={`${fmtNum(orders)} orders ÷ ${fmtNum(agg.visitors)} unique NS Home visitors = ${fmtPct(conv)}`} />
        <MetricCard label="Abandoned Checkouts" value={fmtNum(abandonedCount)} icon="❌" accent="rose" href="/abandoned" formula={`Real Shopify abandoned carts in ${rangeLabel} →`} />
        <MetricCard label="Abandoned Rate" value={fmtPct(abandoned)} icon="🚪" accent="rose" formula={`${fmtNum(abandonedCount)} abandoned ÷ (${fmtNum(orders)} orders + ${fmtNum(abandonedCount)}) = ${fmtPct(abandoned)}`} />
        <MetricCard label="Days With Data" value={fmtNum(traffic.length)} icon="📆" accent="sky" formula="Days in range that have an imported daily traffic row" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Visitors & Sessions">
          {metrics.length ? <TrafficTrend data={metrics} /> : <EmptyState loading={loading} />}
        </Card>
        <Card title="Conversion Funnel">
          {hasTraffic ? <FunnelBars steps={funnel} /> : <EmptyState loading={loading} label="Import traffic to see the funnel." />}
        </Card>
      </div>

      <Card title="Conversion Rate Trend">
        {hasTraffic ? <ConversionTrend data={metrics} /> : <EmptyState loading={loading} label="Import traffic to see conversion." />}
      </Card>
    </div>
  );
}
