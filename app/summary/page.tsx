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
} as const;

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

              {/* Orders that paid with cashback, on the day of purchase. */}
              <DataRow
                label={<>Orders Using Cashback <span className="font-normal opacity-80">{periodLabel}</span></>}
                cols={cols}
                block={data.cashback.orders}
                kind="orders"
                tint={TINT.cashback}
              />
              <DataRow
                label={<>Cashback Used <span className="font-normal opacity-80">{periodLabel}</span></>}
                cols={cols}
                block={data.cashback.spent}
                kind="value"
                accent
                tint={TINT.cashback}
              />
              <DataRow
                label={<>Paid After Cashback <span className="font-normal opacity-80">purchases − cashback used</span></>}
                cols={cols}
                block={data.cashback.net}
                kind="value"
                tint={TINT.cashback}
              />
              <DataRow
                label={<>Total Purchases from Cashback Orders <span className="font-normal opacity-80">{periodLabel}</span></>}
                cols={cols}
                block={data.cashback.purchases}
                kind="value"
                tint={TINT.cashback}
              />
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {data && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" /> MTD above {lastMonthMtdLabel}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-500" /> MTD below {lastMonthMtdLabel}</span>
          <span>· Avg Order Value = value ÷ orders — “per {data.meta.single ? "day" : "range"}” uses {periodLabel}, “per month” uses month to date</span>
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
