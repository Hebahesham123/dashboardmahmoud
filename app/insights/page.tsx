"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui";
import { fmtNum, fmtMoney } from "@/lib/format";

interface Slice {
  label: string;
  units: number;
  value: number;
  orders: number;
}
interface Band {
  label: string;
  min: number;
  max: number | null;
  units: number;
  value: number;
}
interface TopProduct {
  product_id: number;
  name: string;
  units: number;
  value: number;
  subcategory: string;
}
interface Resp {
  ok: boolean;
  error?: string;
  coverage: { first: string | null; last: string | null; rows: number };
  totals: { units: number; value: number; products: number };
  rooms: Slice[];
  categories: Slice[];
  subcategories: Slice[];
  bands: Band[];
  topProducts: TopProduct[];
  options: { rooms: string[]; categories: string[]; subcategories: string[] };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function InsightsPage() {
  // Default to everything on record — "from the beginning" is the question
  // this page exists to answer; narrowing is opt-in.
  const [allTime, setAllTime] = useState(true);
  const [from, setFrom] = useState("2025-01-01");
  const [to, setTo] = useState(todayStr());
  const [room, setRoom] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (!allTime) {
      p.set("from", from);
      p.set("to", to);
    }
    if (room) p.set("room", room);
    if (subcategory) p.set("subcategory", subcategory);
    if (minPrice) p.set("minPrice", minPrice);
    if (maxPrice) p.set("maxPrice", maxPrice);
    return p.toString();
  }, [allTime, from, to, room, subcategory, minPrice, maxPrice]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/insights?${query}`)
      .then(async (r) => {
        const text = await r.text();
        try {
          return JSON.parse(text) as Resp;
        } catch {
          throw new Error(`Server error (${r.status}).`);
        }
      })
      .then((j) => {
        if (!alive) return;
        if (j.ok) setData(j);
        else setError(j.error || "Failed to load insights");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  const currency = "EGP";
  const periodLabel = allTime
    ? data?.coverage.first
      ? `all time · ${data.coverage.first} → ${data.coverage.last}`
      : "all time"
    : `${from} → ${to}`;

  return (
    <div>
      <PageHeader
        title="Insights"
        description="What sells, by room, category and price — across every branch and the website."
      />

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-end gap-2 sm:gap-3">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm">
          <button
            onClick={() => setAllTime(true)}
            className={`px-3 py-1.5 font-medium ${allTime ? "bg-[#6f4423] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            All time
          </button>
          <button
            onClick={() => setAllTime(false)}
            className={`px-3 py-1.5 font-medium ${!allTime ? "bg-[#6f4423] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
          >
            Date range
          </button>
        </div>

        {!allTime && (
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5"
            />
            <span className="text-gray-400">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5"
            />
          </div>
        )}

        <select
          value={room}
          onChange={(e) => {
            setRoom(e.target.value);
            setSubcategory("");
          }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All rooms</option>
          {(data?.options.rooms ?? []).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <select
          value={subcategory}
          onChange={(e) => setSubcategory(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All sub-categories</option>
          {(data?.options.subcategories ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-xs text-gray-500">Price</span>
          <input
            type="number"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="min"
            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5"
          />
          <span className="text-gray-400">–</span>
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="max"
            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5"
          />
        </div>

        {(room || subcategory || minPrice || maxPrice) && (
          <button
            onClick={() => {
              setRoom("");
              setSubcategory("");
              setMinPrice("");
              setMaxPrice("");
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {!data || data.coverage.rows === 0 ? (
        <EmptyState
          loading={loading}
          label="No product sales stored yet — run migration_v13.sql, then scripts/backfill-products.ts."
        />
      ) : (
        <div className="space-y-5">
          {/* Headline */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Revenue" value={fmtMoney(data.totals.value, currency)} hint={periodLabel} />
            <Stat label="Units sold" value={fmtNum(Math.round(data.totals.units))} hint="pieces" />
            <Stat label="Products" value={fmtNum(data.totals.products)} hint="distinct items sold" />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="By room" subtitle="Bedroom · Living Room · Bathroom">
              <Bars rows={data.rooms} currency={currency} onPick={(l) => setRoom(l === room ? "" : l)} active={room} />
            </Panel>
            <Panel title="By price band" subtitle="banded on unit price">
              <BandTable bands={data.bands} currency={currency} />
            </Panel>
          </div>

          <Panel title="By sub-category" subtitle="towels, fitted sheets, cushions …">
            <Bars
              rows={data.subcategories}
              currency={currency}
              onPick={(l) => setSubcategory(l === subcategory ? "" : l)}
              active={subcategory}
            />
          </Panel>

          <Panel title="Top 10 products" subtitle="by revenue">
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full table-fixed border-collapse text-left text-xs">
                <colgroup>
                  <col className="w-[6%]" />
                  <col className="w-[46%]" />
                  <col className="w-[20%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    {["#", "Product", "Sub-category", "Units", "Revenue"].map((h) => (
                      <th key={h} className="truncate border-b border-gray-200 px-2 py-1.5 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts.map((p, i) => (
                    <tr key={p.product_id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                      <td className="truncate px-2 py-1.5 text-gray-800" title={p.name}>
                        {p.name}
                      </td>
                      <td className="truncate px-2 py-1.5 text-gray-500" title={p.subcategory}>
                        {p.subcategory}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-gray-700">{fmtNum(Math.round(p.units))}</td>
                      <td className="truncate px-2 py-1.5 tabular-nums font-semibold text-gray-900">
                        {fmtMoney(p.value, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <p className="text-[11px] text-gray-400">
            NS Home retail lines only — the fabric and commercial side of the catalogue is excluded. Refunds subtract, so
            a returned piece cancels its sale. Price bands use the unit price (value ÷ units).
            {loading && <span className="ml-1 text-gray-400">· Refreshing…</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-gray-900 sm:text-xl">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {subtitle && <p className="text-[11px] text-gray-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Horizontal bars, widest first. Clicking a row filters to it. */
function Bars({
  rows,
  currency,
  onPick,
  active,
}: {
  rows: Slice[];
  currency: string;
  onPick?: (label: string) => void;
  active?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <p className="text-xs text-gray-400">Nothing in this selection.</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <button
          key={r.label}
          onClick={() => onPick?.(r.label)}
          className={`block w-full rounded-md px-2 py-1 text-left transition hover:bg-gray-50 ${
            active === r.label ? "bg-[#faf3e8] ring-1 ring-[#d8c3aa]" : ""
          }`}
        >
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium text-gray-800">{r.label}</span>
            <span className="shrink-0 tabular-nums text-gray-500">
              {fmtNum(Math.round(r.units))} u · <b className="text-gray-900">{fmtMoney(r.value, currency)}</b>
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-[#6f4423]"
              style={{ width: `${Math.max(2, (Math.abs(r.value) / max) * 100)}%` }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

function BandTable({ bands, currency }: { bands: Band[]; currency: string }) {
  const totalUnits = bands.reduce((s, b) => s + b.units, 0) || 1;
  return (
    <div className="space-y-1.5">
      {bands.map((b) => (
        <div key={b.label} className="px-2 py-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium text-gray-800">{b.label}</span>
            <span className="shrink-0 tabular-nums text-gray-500">
              {fmtNum(Math.round(b.units))} u · <b className="text-gray-900">{fmtMoney(b.value, currency)}</b>
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-[#2f5d5b]"
              style={{ width: `${Math.max(2, (Math.abs(b.units) / totalUnits) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
