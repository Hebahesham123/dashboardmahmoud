"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui";
import { fmtNum } from "@/lib/format";

type Cell = { orders: number; value: number };
type Block = Record<string, Cell>;
interface SummaryResp {
  ok: boolean;
  error?: string;
  channels: { label: string; type: "Branches" | "Online" }[];
  period: Block;
  mtd: Block;
  lastMonth: Block;
  meta: { from: string; to: string; single: boolean };
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

export default function SummaryPage() {
  const [mode, setMode] = useState<"day" | "range">("day");
  const [day, setDay] = useState(todayStr());
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<SummaryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Average order value (MTD) per column = value / orders.
  const aov: Block = useMemo(() => {
    const out: Block = {};
    if (data) for (const c of cols) {
      const m = data.mtd[c];
      out[c] = { orders: 0, value: m && m.orders ? m.value / m.orders : 0 };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
      </div>

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
              <DataRow label={<>Orders <span className="font-normal opacity-80">{periodLabel}</span></>} cols={cols} block={data.period} kind="orders" />
              <DataRow label={<>Value <span className="font-normal opacity-80">{periodLabel}</span></>} cols={cols} block={data.period} kind="value" />
              <DataRow label="MTD Orders" cols={cols} block={data.mtd} kind="orders" compareBlock={data.lastMonth} />
              <DataRow label="MTD Value" cols={cols} block={data.mtd} kind="value" compareBlock={data.lastMonth} />
              <DataRow label="Avg Order Value" cols={cols} block={aov} kind="value" accent />
              <DataRow label="Orders Last Month" cols={cols} block={data.lastMonth} kind="orders" muted />
              <DataRow label="Amount Last Month" cols={cols} block={data.lastMonth} kind="value" muted />
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {data && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> MTD above last month</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" /> MTD below last month</span>
          <span>· Avg Order Value = MTD value ÷ orders</span>
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
      <th className={`${BORDER} bg-[#6f4423] px-2 py-2.5 text-left font-bold text-white sm:px-4`}>{label}</th>
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
}: {
  label: React.ReactNode;
  cols: string[];
  block: Block;
  kind: "orders" | "value";
  compareBlock?: Block; // green if > last month, red if less
  accent?: boolean; // Avg Order Value highlight
  muted?: boolean; // last-month rows
}) {
  return (
    <tr>
      <th className={`${BORDER} bg-[#6f4423] px-2 py-2.5 text-left align-middle font-semibold text-white sm:px-4 ${accent ? "italic" : ""}`}>
        {label}
      </th>
      {cols.map((c) => {
        const cell = block[c];
        const v = cell ? (kind === "orders" ? cell.orders : cell.value) : 0;
        const isTotal = c === "Total";
        let cls = "bg-white text-gray-800";
        if (compareBlock) {
          const cc = compareBlock[c];
          const cv = cc ? (kind === "orders" ? cc.orders : cc.value) : 0;
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
