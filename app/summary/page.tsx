"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui";
import { fmtNum } from "@/lib/format";

type Cell = { orders: number; value: number; na?: boolean }; // na = row does not apply to this channel
type Block = Record<string, Cell>;
interface SummaryResp {
  ok: boolean;
  error?: string;
  channels: { label: string; type: "Branches" | "Online" }[];
  period: Block;
  mtd: Block;
  lastMonth: Block; // same day / same range, one month back
  lastMonthMtd: Block; // last month measured to the same day of the month
  // Orders that paid with a voucher, on the day they were placed: how many,
  // how much cashback they spent, and what they came to.
  cashback: { orders: Block; spent: Block; net: Block; purchases: Block };
  cashbackMtd: { orders: Block; spent: Block; net: Block; purchases: Block };
  // What the table above reports for the same window, so the products section
  // can show the discounts and land on the same figure.
  productsNet: { offline: number; online: number; total: number };
  products: {
    product_id: number;
    name: string;
    offline: number;
    online: number;
    total: number;
    returned: number;
    offlineValue: number;
    onlineValue: number;
    value: number;
    unitPrice: number;
    unitPriceMax: number;
    variants: number;
  }[];
  meta: {
    from: string;
    to: string;
    lmFrom: string;
    lmTo: string;
    lmStart: string;
    lmMtdEnd: string;
    single: boolean;
  };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
const money = (n: number) => fmtNum(Math.round(n));

// Uniform brown gridline on every cell.
const BORDER = "border border-[#8a5730]";

/**
 * One colour per block of rows. Every row in a block shares its label colour,
 * so the block is obvious at a glance and the white gaps between blocks do the
 * separating. (This replaced a per-metric scheme that tinted each metric and
 * its comparison row alike — with the table grouped by period, colouring by
 * metric cut across the grouping instead of reinforcing it.)
 */
const TINT = {
  header: "bg-[#332a24]", // Channel / Location — the table's own headings
  period: "bg-[#6f4423]", // the picked day or range
  lastMonth: "bg-[#7a3f5d]", // the same window one month back
  mtd: "bg-[#2f5d5b]", // month to date
  cashback: "bg-[#4d6b2f]", // orders that paid with a voucher
  target: "bg-[#1f4e79]", // monthly target and how much of it MTD covers
} as const;

// Default monthly sales targets, used for any channel that has no saved target
// yet. Each branch and online can be given its own via "Edit targets".
const BRANCH_TARGET = 500_000;
const ONLINE_TARGET = 1_000_000;

export default function SummaryPage() {
  const [mode, setMode] = useState<"day" | "range">("day");
  const [day, setDay] = useState(todayStr());
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<SummaryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Saved targets per channel label; channels missing here use the defaults.
  const [savedTargets, setSavedTargets] = useState<Record<string, number>>({});
  const [editingTargets, setEditingTargets] = useState(false);

  useEffect(() => {
    fetch("/api/targets")
      .then((r) => r.json())
      .then((j: { ok: boolean; targets?: Record<string, number> }) => j.ok && setSavedTargets(j.targets ?? {}))
      .catch(() => {});
  }, []);

  const query = useMemo(
    () => (mode === "day" ? `day=${day}` : `from=${from}&to=${to}`),
    [mode, day, from, to]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/summary?${query}`)
      .then(async (r) => {
        const text = await r.text();
        try {
          return JSON.parse(text) as SummaryResp;
        } catch {
          throw new Error(r.status === 504 ? "Timed out loading summary — try again." : `Server error (${r.status}).`);
        }
      })
      .then((j: SummaryResp) => {
        if (!alive) return;
        if (j.ok) setData(j);
        else setError(j.error || "Failed to load summary");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  const cols = data ? [...data.channels.map((c) => c.label), "Total"] : [];
  const periodLabel = data
    ? data.meta.single
      ? data.meta.from
      : `${data.meta.from} → ${data.meta.to}`
    : "";
  // The same day/range one month back — what the "Last Month" rows now show.
  const lastMonthLabel = data
    ? data.meta.single
      ? data.meta.lmFrom
      : `${data.meta.lmFrom} → ${data.meta.lmTo}`
    : "";
  // Last month up to the same day of the month — what MTD is compared against.
  const lastMonthMtdLabel = data ? `${data.meta.lmStart} → ${data.meta.lmMtdEnd}` : "";

  // Average order value per column = value / orders, for a given block.
  const aovOf = (block: Block | undefined): Block => {
    const out: Block = {};
    if (block) for (const c of cols) {
      const m = block[c];
      out[c] = { orders: 0, value: m && m.orders ? m.value / m.orders : 0 };
    }
    return out;
  };
  // Per day (the picked day/range), per month (MTD), and the two windows each
  // is measured against: the same day/range one month back, and last month to
  // the same day of the month.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const aovDay: Block = useMemo(() => aovOf(data?.period), [data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const aovMonth: Block = useMemo(() => aovOf(data?.mtd), [data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const aovLastMonth: Block = useMemo(() => aovOf(data?.lastMonth), [data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const aovLastMonthMtd: Block = useMemo(() => aovOf(data?.lastMonthMtd), [data]);

  // Monthly target per column (Total = sum of all targets), what is left to
  // reach it, and the % of it that MTD Value covers.
  const targets = useMemo(() => {
    const target: Block = {};
    const remaining: Block = {};
    const pct: Record<string, number> = {};
    if (!data) return { target, remaining, pct };
    let total = 0;
    for (const ch of data.channels) {
      const t = savedTargets[ch.label] ?? (ch.type === "Online" ? ONLINE_TARGET : BRANCH_TARGET);
      target[ch.label] = { orders: 0, value: t };
      total += t;
    }
    target.Total = { orders: 0, value: total };
    for (const c of Object.keys(target)) {
      const achieved = data.mtd[c]?.value ?? 0;
      const t = target[c].value;
      remaining[c] = { orders: 0, value: Math.max(t - achieved, 0) };
      pct[c] = t ? (achieved / t) * 100 : 0;
    }
    return { target, remaining, pct };
  }, [data, savedTargets]);

  // MTD Value plus the Cashback Used row exactly as it appears above, so the
  // sum can be checked against the table. It used the whole month's cashback
  // before, which made the row impossible to verify: on a day with no
  // redemptions the table showed 0 while the row still added 144,411.
  const productTotals = useMemo(
    () => ({
      offline: (data?.products ?? []).reduce((a, p) => a + p.offline, 0),
      online: (data?.products ?? []).reduce((a, p) => a + p.online, 0),
      returned: (data?.products ?? []).reduce((a, p) => a + p.returned, 0),
      offlineValue: (data?.products ?? []).reduce((a, p) => a + p.offlineValue, 0),
      onlineValue: (data?.products ?? []).reduce((a, p) => a + p.onlineValue, 0),
      value: (data?.products ?? []).reduce((a, p) => a + p.value, 0),
    }),
    [data]
  );


  return (
    <div>
      <PageHeader title="Summary" description="Orders & value by channel — branches vs online — for a day or a range." />

      {/* Filter */}
      <div className="mb-5 flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm">
          <button
            onClick={() => setMode("day")}
            className={`px-3 py-1.5 font-medium ${mode === "day" ? "bg-[#6f4423] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            Single day
          </button>
          <button
            onClick={() => setMode("range")}
            className={`px-3 py-1.5 font-medium ${mode === "range" ? "bg-[#6f4423] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            Range
          </button>
        </div>

        {mode === "day" ? (
          <>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button onClick={() => setDay(yesterdayStr())} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Yesterday</button>
            <button onClick={() => setDay(todayStr())} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Today</button>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5" />
            <span className="text-gray-400">→</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5" />
          </div>
        )}

        {data && (
          <button
            onClick={() => setEditingTargets((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium sm:ml-auto ${
              editingTargets ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            🎯 Edit targets
          </button>
        )}
      </div>

      {data && editingTargets && (
        <TargetEditor
          channels={data.channels}
          current={(label, type) => savedTargets[label] ?? (type === "Online" ? ONLINE_TARGET : BRANCH_TARGET)}
          onSaved={(t) => {
            setSavedTargets((prev) => ({ ...prev, ...t }));
            setEditingTargets(false);
          }}
          onCancel={() => setEditingTargets(false)}
        />
      )}

      {error && (
        <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error === "Invalid token"
            ? "Odoo rejected the API key (Invalid token) — update ODOO_API_TOKEN in Vercel to the production token and redeploy."
            : error}
        </div>
      )}

      {!data || cols.length === 0 ? (
        <EmptyState loading={loading} label="No data for this selection." />
      ) : (
        <div className="overflow-hidden rounded-xl border-2 border-[#5c3a1e]">
          <table className="w-full table-fixed border-collapse text-center text-[11px] leading-tight sm:text-sm">
            <colgroup>
              <col className="w-[27%] sm:w-[24%]" />
            </colgroup>
            <tbody>
              <HeaderRow
                label="Channel"
                cols={cols}
                render={(c) => (c === "Total" ? "Total" : data.channels.find((x) => x.label === c)?.type ?? "")}
              />
              <HeaderRow
                label="Location"
                cols={cols}
                render={(c) => (c === "Total" ? "All" : c)}
                strong
              />

              <GroupGap cols={cols} />

              {/* Selected day or range: orders, value, and the average. */}
              <DataRow label={<>Orders <span className="font-normal opacity-80">{periodLabel}</span></>} cols={cols} block={data.period} kind="orders" tint={TINT.period} />
              <DataRow label={<>Value <span className="font-normal opacity-80">{periodLabel}</span></>} cols={cols} block={data.period} kind="value" tint={TINT.period} />
              <DataRow
                label={<>Avg Order Value <span className="font-normal opacity-80">per {data.meta.single ? "day" : "range"} · {periodLabel}</span></>}
                cols={cols}
                block={aovDay}
                kind="value"
                compareBlock={aovLastMonth}
                accent
                tint={TINT.period}
              />

              <GroupGap cols={cols} />

              {/* The same window one month back, then the month-to-date average. */}
              <DataRow
                label={<>Orders Last Month <span className="font-normal opacity-80">{lastMonthLabel}</span></>}
                cols={cols}
                block={data.lastMonth}
                kind="orders"
                muted
                tint={TINT.lastMonth}
              />
              <DataRow
                label={<>Amount Last Month <span className="font-normal opacity-80">{lastMonthLabel}</span></>}
                cols={cols}
                block={data.lastMonth}
                kind="value"
                muted
                tint={TINT.lastMonth}
              />
              <DataRow
                label={<>Avg Order Value per {data.meta.single ? "day" : "range"} Last Month <span className="font-normal opacity-80">{lastMonthLabel}</span></>}
                cols={cols}
                block={aovLastMonth}
                kind="value"
                accent
                tint={TINT.lastMonth}
              />
              <DataRow
                label={<>Avg Order Value per month Last Month <span className="font-normal opacity-80">{lastMonthMtdLabel}</span></>}
                cols={cols}
                block={aovLastMonthMtd}
                kind="value"
                accent
                tint={TINT.lastMonth}
              />

              <GroupGap cols={cols} />

              {/* Month to date. */}
              <DataRow label="MTD Orders" cols={cols} block={data.mtd} kind="orders" compareBlock={data.lastMonthMtd} tint={TINT.mtd} />
              <DataRow label="MTD Value" cols={cols} block={data.mtd} kind="value" compareBlock={data.lastMonthMtd} tint={TINT.mtd} />
              <DataRow
                label={<>Avg Order Value <span className="font-normal opacity-80">per month · MTD</span></>}
                cols={cols}
                block={aovMonth}
                kind="value"
                compareBlock={aovLastMonthMtd}
                accent
                tint={TINT.mtd}
              />

              <GroupGap cols={cols} />

              {/* Monthly target: 500k per branch, 1M online, and how much MTD covers. */}
              <DataRow
                label={<>Monthly Target <span className="font-normal opacity-80">editable · 🎯 Edit targets</span></>}
                cols={cols}
                block={targets.target}
                kind="value"
                tint={TINT.target}
              />
              <DataRow label="Achieved (MTD Value)" cols={cols} block={data.mtd} kind="value" tint={TINT.target} />
              <PercentRow label="% of Target Achieved" cols={cols} pct={targets.pct} tint={TINT.target} />
              <DataRow label="Remaining to Target" cols={cols} block={targets.remaining} kind="value" muted tint={TINT.target} />

              <GroupGap cols={cols} />

              {/* Orders that paid with cashback, on the day of purchase. */}
              <DataRow
                label={<>Orders paid with cashback <span className="font-normal opacity-80">{periodLabel}</span></>}
                cols={cols}
                block={data.cashback.orders}
                kind="orders"
                tint={TINT.cashback}
              />
              <DataRow
                label={<>Cashback used <span className="font-normal opacity-80">{periodLabel}</span></>}
                cols={cols}
                block={data.cashback.spent}
                kind="value"
                accent
                tint={TINT.cashback}
              />
              <DataRow
                label={<>Value of those orders <span className="font-normal opacity-80">{periodLabel}</span></>}
                cols={cols}
                block={data.cashback.purchases}
                kind="value"
                tint={TINT.cashback}
              />

            </tbody>
          </table>
        </div>
      )}

      {/* What sold, and where */}
      {data && data.products.length > 0 && (
        <div className="mt-5 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <h2 className="text-sm font-bold text-gray-900">Products sold · {periodLabel}</h2>
            <p className="text-[11px] text-gray-400">
              {fmtNum(data.products.length)} products · {fmtNum(Math.round(productTotals.offline))} in the shops ·{" "}
              {fmtNum(Math.round(productTotals.online))} online
              {productTotals.returned > 0 && ` · ${fmtNum(Math.round(productTotals.returned))} returned`}
              <span className="ml-1">
                · {money(productTotals.value)} at list price, {money(data.productsNet.total)} after discounts
              </span>
            </p>
          </div>
          <div className="max-h-[460px] overflow-y-auto">
            <table className="w-full table-fixed border-collapse text-left text-xs">
              {/* Widths must total 100%: at 90% the browser handed the
                  remainder to a phantom column on the right. */}
              <colgroup>
                <col className="w-[25%]" />
                <col className="w-[9%]" />
                <col className="w-[8%]" />
                <col className="w-[11%]" />
                <col className="w-[8%]" />
                <col className="w-[11%]" />
                <col className="w-[8%]" />
                <col className="w-[13%]" />
                <col className="w-[7%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-gray-50">
                {/* Two header rows: the channel, then what each number is. One
                    row of stacked figures left the money unlabelled. */}
                <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                  <th rowSpan={2} className="border-b border-gray-200 px-3 py-2 align-bottom font-semibold">
                    Product
                  </th>
                  <th
                    rowSpan={2}
                    className="border-b border-l border-gray-200 px-2 py-2 text-right align-bottom font-semibold"
                  >
                    Price
                  </th>
                  <th colSpan={2} className="border-b border-l border-gray-200 px-3 pt-2 text-center font-semibold">
                    In the shops
                  </th>
                  <th colSpan={2} className="border-b border-l border-gray-200 px-3 pt-2 text-center font-semibold">
                    Online
                  </th>
                  <th colSpan={2} className="border-b border-l border-gray-200 px-3 pt-2 text-center font-semibold">
                    Total
                  </th>
                  <th rowSpan={2} className="border-b border-l border-gray-200 px-3 py-2 text-right align-bottom font-semibold">
                    Ret.
                  </th>
                </tr>
                <tr className="text-[10px] text-gray-400">
                  <th className="border-b border-l border-gray-200 px-2 pb-1.5 text-right font-medium">Qty</th>
                  <th className="border-b border-gray-200 px-3 pb-1.5 text-right font-medium">EGP</th>
                  <th className="border-b border-l border-gray-200 px-2 pb-1.5 text-right font-medium">Qty</th>
                  <th className="border-b border-gray-200 px-3 pb-1.5 text-right font-medium">EGP</th>
                  <th className="border-b border-l border-gray-200 px-2 pb-1.5 text-right font-medium">Qty</th>
                  <th className="border-b border-gray-200 px-3 pb-1.5 text-right font-medium">EGP</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.name} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="truncate px-3 py-2 text-gray-800" title={p.name}>
                      {p.name}
                      {p.variants > 1 && (
                        <span className="ml-1.5 text-[10px] text-gray-400">{p.variants} variants</span>
                      )}
                    </td>
                    <td className="border-l border-gray-100 px-2 py-2 text-right tabular-nums text-gray-500">
                      {p.unitPrice ? (
                        p.unitPriceMax > p.unitPrice ? (
                          <span title={`sold at ${fmtNum(p.unitPrice)} and ${fmtNum(p.unitPriceMax)}`}>
                            {fmtNum(p.unitPrice)}
                            <span className="text-gray-400">–{fmtNum(p.unitPriceMax)}</span>
                          </span>
                        ) : (
                          fmtNum(p.unitPrice)
                        )
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <Qty n={p.offline} bordered />
                    <Money n={p.offlineValue} />
                    <Qty n={p.online} bordered />
                    <Money n={p.onlineValue} />
                    <Qty n={p.total} bordered strong />
                    <Money n={p.value} strong />
                    <td className="border-l border-gray-100 px-3 py-2 text-right tabular-nums text-rose-600">
                      {p.returned ? fmtNum(Math.round(p.returned)) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 bg-[#f6f2ed]">
                <tr className="border-t-2 border-[#d8c3aa] font-semibold text-gray-900">
                  <td className="px-3 py-2">Total at list price</td>
                  <td className="border-l border-gray-200 px-2 py-2 text-right tabular-nums text-gray-400">—</td>
                  <Qty n={productTotals.offline} bordered strong />
                  <Money n={productTotals.offlineValue} strong />
                  <Qty n={productTotals.online} bordered strong />
                  <Money n={productTotals.onlineValue} strong />
                  <Qty n={productTotals.offline + productTotals.online} bordered strong />
                  <Money n={productTotals.value} strong />
                  <td className="border-l border-gray-200 px-3 py-2 text-right tabular-nums text-rose-600">
                    {productTotals.returned ? fmtNum(Math.round(productTotals.returned)) : "—"}
                  </td>
                </tr>
                {/* A product row is price x quantity, which cannot carry the
                    order-level discounts — they belong to no single line. So
                    they are taken off here, and the section lands on the same
                    figure as the table above rather than near it. */}
                <tr className="text-[11px] text-rose-600">
                  <td className="px-3 py-1.5">Discounts</td>
                  <td className="border-l border-gray-200" />
                  <td className="border-l border-gray-200" />
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmtNum(Math.round(data.productsNet.offline - productTotals.offlineValue))}
                  </td>
                  <td className="border-l border-gray-200" />
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmtNum(Math.round(data.productsNet.online - productTotals.onlineValue))}
                  </td>
                  <td className="border-l border-gray-200" />
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {fmtNum(Math.round(data.productsNet.total - productTotals.value))}
                  </td>
                  <td className="border-l border-gray-200" />
                </tr>
                <tr className="border-t border-[#d8c3aa] text-xs font-bold text-gray-900">
                  <td className="px-3 py-2">Net sales · same as the table above</td>
                  <td className="border-l border-gray-200" />
                  <td className="border-l border-gray-200" />
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtNum(Math.round(data.productsNet.offline))}
                  </td>
                  <td className="border-l border-gray-200" />
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtNum(Math.round(data.productsNet.online))}
                  </td>
                  <td className="border-l border-gray-200" />
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(Math.round(data.productsNet.total))}</td>
                  <td className="border-l border-gray-200" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Legend */}
      {data && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> MTD above {lastMonthMtdLabel}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" /> MTD below {lastMonthMtdLabel}</span>
          <span>· Avg Order Value = value ÷ orders — “per {data.meta.single ? "day" : "range"}” uses {periodLabel}, “per month” uses month to date</span>
          <span>
            · Every order counts at its full value, a voucher-paid one included. Only the website needs adjusting:
            Shopify treats a cashback code as a discount, so its orders arrive already reduced and the voucher is put
            back. Shop orders already carry their full value.
          </span>
          <span>
            · Cashback rows count the orders that paid with a voucher, on the day the order was placed: how many, how
            much cashback they spent, what was left to pay, and what they came to before any discount. Branch columns are shop redemptions,
            read off the redeeming invoice; Website is online ones, read off the Shopify order. Cashback runs at 20+
            branches but only branches with sales rows get a column, so Total covers them all and can exceed the columns
            beside it.
          </span>
          <span className="inline-flex items-center gap-1">
            · One colour per block:
            <span className={`ml-0.5 inline-block h-2.5 w-2.5 rounded-sm ${TINT.period}`} /> {periodLabel}
            <span className={`ml-1 inline-block h-2.5 w-2.5 rounded-sm ${TINT.lastMonth}`} /> last month
            <span className={`ml-1 inline-block h-2.5 w-2.5 rounded-sm ${TINT.mtd}`} /> month to date
            <span className={`ml-1 inline-block h-2.5 w-2.5 rounded-sm ${TINT.cashback}`} /> cashback
            <span className={`ml-1 inline-block h-2.5 w-2.5 rounded-sm ${TINT.target}`} /> target
          </span>
          <span>
            · Monthly target per column, set with “Edit targets” (default {fmtNum(BRANCH_TARGET)} a branch,{" "}
            {fmtNum(ONLINE_TARGET)} online). % = MTD Value ÷
            target — green at 100%+, amber at 50%+, red below 50%
          </span>
          {loading && <span className="text-gray-400">· Refreshing…</span>}
        </div>
      )}
    </div>
  );
}

function HeaderRow({
  label,
  cols,
  render,
  strong,
}: {
  label: string;
  cols: string[];
  render: (c: string) => string;
  strong?: boolean;
}) {
  return (
    <tr>
      <th className={`${BORDER} ${TINT.header} px-2 py-2.5 text-left font-bold text-white sm:px-4`}>{label}</th>
      {cols.map((c) => (
        <th
          key={c}
          className={`${BORDER} px-1 py-2.5 font-bold sm:px-3 ${
            c === "Total" ? "bg-[#e7dccb] text-[#4a2f16]" : "bg-[#f4ebe1] text-[#5c3a1e]"
          } ${strong ? "text-[13px] sm:text-base" : ""}`}
        >
          {render(c)}
        </th>
      ))}
    </tr>
  );
}

function DataRow({
  label,
  cols,
  block,
  kind,
  compareBlock,
  accent,
  muted,
  tint = "bg-[#6f4423]",
}: {
  label: React.ReactNode;
  cols: string[];
  block: Block;
  kind: "orders" | "value";
  compareBlock?: Block; // green if > last month, red if less
  accent?: boolean; // Avg Order Value highlight
  muted?: boolean; // last-month rows
  tint?: string; // label-cell colour, shared with this row's comparison row
}) {
  return (
    <tr>
      <th className={`${BORDER} ${tint} px-2 py-2.5 text-left align-middle font-semibold text-white sm:px-4 ${accent ? "italic" : ""}`}>
        {label}
      </th>
      {cols.map((c) => {
        const pick = (m: Cell | undefined) => (!m ? 0 : kind === "orders" ? m.orders : m.value);
        const cell = block[c];
        const v = pick(cell);
        const isTotal = c === "Total";
        // A dash, not a zero: the shops issue cashback and the website spends
        // it, so each cashback row genuinely has nothing to say on one side.
        if (cell?.na) {
          return (
            <td key={c} className={`${BORDER} bg-white px-1 py-2.5 text-center font-medium text-gray-300 sm:px-3`}>
              —
            </td>
          );
        }
        let cls = "bg-white text-gray-800";
        if (compareBlock) {
          const cv = pick(compareBlock[c]);
          if (v > cv) cls = isTotal ? "bg-emerald-600 font-bold text-white" : "bg-emerald-50 font-semibold text-emerald-700";
          else if (v < cv) cls = isTotal ? "bg-rose-600 font-bold text-white" : "bg-rose-50 font-semibold text-rose-700";
          else cls = isTotal ? "bg-[#e7dccb] font-bold text-[#4a2f16]" : "bg-white text-gray-800";
        } else if (isTotal) {
          cls = "bg-[#e7dccb] font-bold text-[#4a2f16]";
        } else if (accent) {
          cls = "bg-[#faf3e8] font-semibold text-[#6f4423]";
        } else if (muted) {
          cls = "bg-white text-gray-500";
        }
        if (v < 0 && !cls.includes("text-white")) cls += " !text-rose-600";
        return (
          <td key={c} className={`${BORDER} px-1 py-2.5 font-medium tabular-nums sm:px-3 ${cls}`}>
            {kind === "orders" ? fmtNum(v) : money(v)}
          </td>
        );
      })}
    </tr>
  );
}

/** One input per branch and online; saves to /api/targets for everyone. */
function TargetEditor({
  channels,
  current,
  onSaved,
  onCancel,
}: {
  channels: { label: string; type: "Branches" | "Online" }[];
  current: (label: string, type: "Branches" | "Online") => number;
  onSaved: (t: Record<string, number>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(channels.map((c) => [c.label, String(current(c.label, c.type))]))
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parsed: Record<string, number> = {};
  for (const c of channels) parsed[c.label] = Number((values[c.label] ?? "").replace(/,/g, "").trim());
  const invalid = channels.some(
    (c) => (values[c.label] ?? "").trim() === "" || !Number.isFinite(parsed[c.label]) || parsed[c.label] < 0
  );
  const total = channels.reduce((a, c) => a + (Number.isFinite(parsed[c.label]) ? parsed[c.label] : 0), 0);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: parsed }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error || "Could not save targets");
      onSaved(parsed);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-5 rounded-xl border-2 border-[#1f4e79] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900">Monthly targets (EGP)</h2>
        <span className="text-[11px] text-gray-500">Saved for everyone · Total {fmtNum(Math.round(total))}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {channels.map((c) => (
          <label key={c.label} className="block text-xs">
            <span className="mb-1 block font-semibold text-gray-700">
              {c.label} <span className="font-normal text-gray-400">· {c.type === "Online" ? "Online" : "Branch"}</span>
            </span>
            <input
              type="number"
              min={0}
              step={10000}
              inputMode="numeric"
              value={values[c.label] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [c.label]: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums focus:border-[#1f4e79] focus:outline-none"
            />
          </label>
        ))}
      </div>
      {err && <p className="mt-3 text-xs text-rose-600">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button
          onClick={save}
          disabled={saving || invalid}
          className="rounded-lg bg-[#1f4e79] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save targets"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** % of the monthly target reached, coloured by how close it is. */
function PercentRow({
  label,
  cols,
  pct,
  tint,
}: {
  label: React.ReactNode;
  cols: string[];
  pct: Record<string, number>;
  tint: string;
}) {
  return (
    <tr>
      <th className={`${BORDER} ${tint} px-2 py-2.5 text-left align-middle font-semibold text-white sm:px-4`}>{label}</th>
      {cols.map((c) => {
        const p = pct[c] ?? 0;
        const isTotal = c === "Total";
        let cls: string;
        if (p >= 100) cls = isTotal ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700";
        else if (p >= 50) cls = isTotal ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-700";
        else cls = isTotal ? "bg-rose-600 text-white" : "bg-rose-50 text-rose-700";
        return (
          <td key={c} className={`${BORDER} px-1 py-2.5 font-bold tabular-nums sm:px-3 ${cls}`}>
            {p.toFixed(1)}%
          </td>
        );
      })}
    </tr>
  );
}

/**
 * A clean white band between blocks of rows. It carries no gridline of its own
 * — a bordered cell here would read as an empty row — so the blocks above and
 * below simply stop, and the white does the separating.
 */
function GroupGap({ cols }: { cols: string[] }) {
  return (
    <tr aria-hidden="true">
      <td colSpan={cols.length + 1} className="h-2.5 border-0 bg-white p-0" />
    </tr>
  );
}

function Qty({ n, bordered, strong }: { n: number; bordered?: boolean; strong?: boolean }) {
  return (
    <td
      className={`px-2 py-2 text-right tabular-nums ${bordered ? "border-l border-gray-100" : ""} ${
        strong ? "font-semibold text-gray-900" : "text-gray-700"
      }`}
    >
      {n ? fmtNum(Math.round(n)) : <span className="text-gray-300">—</span>}
    </td>
  );
}

/** Money, with a loss in red — a day whose returns outweigh its sales is a
 *  real thing and should look like one rather than like a broken figure. */
function Money({ n, strong }: { n: number; strong?: boolean }) {
  const v = Math.round(n);
  return (
    <td
      className={`px-3 py-2 text-right tabular-nums ${
        v < 0 ? "text-rose-600" : strong ? "font-semibold text-gray-900" : "text-gray-600"
      }`}
    >
      {v ? fmtNum(v) : <span className="text-gray-300">—</span>}
    </td>
  );
}
