"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui";
import { fmtNum, fmtMoney } from "@/lib/format";

interface Slice {
  label: string;
  units: number;
  value: number;
  orders: number;
  room?: string;
}
interface Point {
  label: string;
  units: number;
  value: number;
}
interface Trend {
  current: { from: string | null; to: string | null; units: number; value: number };
  previous: { from: string; to: string; units: number; value: number } | null;
}
interface Band {
  label: string;
  min: number;
  max: number | null;
  units: number;
  value: number;
}
interface Product {
  product_id: number;
  name: string;
  units: number;
  value: number;
  subcategory: string;
  lastSold: string;
}
interface Resp {
  ok: boolean;
  error?: string;
  coverage: { first: string | null; last: string | null; rows: number };
  totals: {
    units: number;
    gross: number;
    discounts: number;
    shipping: number;
    totalSales: number;
    products: number;
  };
  channels: Slice[];
  branches: Slice[];
  rooms: Slice[];
  categories: Slice[];
  subcategories: Slice[];
  bands: Band[];
  timeseries: Point[];
  daily: Point[];
  monthly: Point[];
  trend: Trend;
  topProducts: Product[];
  slowProducts: Product[];
  options: { rooms: string[]; categories: string[]; subcategories: string[]; branches: string[] };
}

/**
 * Data colours, run through the dataviz palette validator rather than picked by
 * eye. Every bar chart here plots ONE measure, so it gets ONE hue — identity
 * comes from the label beside the bar, never from its colour, and a
 * darker-where-bigger ramp would just re-encode the length. The exception is
 * the price bands, which are genuinely ordered, so they earn an ordinal ramp:
 * single hue, monotone lightness, light end clear of the surface (validated).
 */
const INK = "#6f4423";
const BAND_RAMP = ["#cca47c", "#b8885c", "#a26c40", "#8a5428", "#6f4120", "#553219"];

/**
 * Rooms are an identity, so they get categorical hues — and the mapping is by
 * NAME, never by rank, so filtering the page can never repaint a survivor.
 * These three slots validate on the all-pairs gate (worst normal-vision ΔE
 * 24.0, CVD 9.2), which is what a donut needs; "Other" takes a neutral gray
 * rather than a fourth hue, because slot four puts yellow beside orange and
 * that pair fails the floor. Aqua sits under 3:1 on white, so every slice and
 * bar carries a visible label — the relief the validator requires.
 */
const ROOM_COLOR: Record<string, string> = {
  Bedroom: "#2a78d6",
  "Living Room": "#eb6834",
  Bathroom: "#1baf7a",
  Other: "#9a948c",
};
const roomHue = (room?: string) => ROOM_COLOR[room ?? "Other"] ?? ROOM_COLOR.Other;

/**
 * The date shortcuts. "This month" is the default because that is what the
 * page is usually opened to check; All time is one click away and is what the
 * coverage line reports.
 */
const PRESETS: { label: string; allTime?: boolean; from?: () => string; to?: () => string }[] = [
  { label: "Today", from: todayStr, to: todayStr },
  { label: "Yesterday", from: () => daysAgoStr(1), to: () => daysAgoStr(1) },
  { label: "This month", from: monthStartStr, to: todayStr },
  { label: "All time", allTime: true },
];

/** Which shortcut the current dates correspond to, for the active styling. */
function isPreset(
  preset: (typeof PRESETS)[number],
  allTime: boolean,
  from: string,
  to: string
): boolean {
  if (preset.allTime) return allTime;
  if (allTime) return false;
  return preset.from!() === from && preset.to!() === to;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function monthStartStr() {
  return `${todayStr().slice(0, 7)}-01`;
}

export default function InsightsPage() {
  // This month by default: the page is read most often to see how the month is
  // going. All time is one click away, and it is what the coverage line says.
  const [allTime, setAllTime] = useState(false);
  const [from, setFrom] = useState(monthStartStr());
  const [to, setTo] = useState(todayStr());
  const [branch, setBranch] = useState("");
  const [room, setRoom] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [channel, setChannel] = useState("");
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
    if (channel) p.set("channel", channel);
    if (branch) p.set("branch", branch);
    if (room) p.set("room", room);
    if (subcategory) p.set("subcategory", subcategory);
    if (minPrice) p.set("minPrice", minPrice);
    if (maxPrice) p.set("maxPrice", maxPrice);
    return p.toString();
  }, [allTime, from, to, channel, branch, room, subcategory, minPrice, maxPrice]);

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
      ? `${data.coverage.first} → ${data.coverage.last}`
      : "all time"
    : `${from} → ${to}`;
  const activeFilters = [channel && (channel === "online" ? "Online" : "Branches"), branch, room, subcategory]
    .filter(Boolean)
    .join(" · ");
  // Days while the window is short enough to read; months beyond that.
  const byDay = !allTime && (data?.daily.length ?? 0) > 0 && (data?.daily.length ?? 0) <= 62;
  const prevLabel = data?.trend.previous
    ? `vs ${data.trend.previous.from.slice(5)} → ${data.trend.previous.to.slice(5)}`
    : undefined;

  // A handful of plain-language reads of the same numbers. They earn their
  // place by saying the thing a glance at the charts would take a minute to
  // work out — the leader and its share, the concentration, the return rate.
  const highlights = useMemo(() => {
    if (!data) return [] as { text: string; tone: "up" | "down" | "flat" }[];
    const out: { text: string; tone: "up" | "down" | "flat" }[] = [];
    const totalValue = data.rooms.reduce((s2, r) => s2 + r.value, 0);
    const topRoom = data.rooms[0];
    if (topRoom && totalValue > 0) {
      out.push({
        text: `${topRoom.label} is ${Math.round((topRoom.value / totalValue) * 100)}% of sales`,
        tone: "flat",
      });
    }
    const topSub = data.subcategories[0];
    if (topSub) out.push({ text: `${topSub.label} leads at ${fmtMoney(topSub.value, currency)}`, tone: "flat" });
    const d = delta(data.trend.current.value, data.trend.previous?.value);
    if (d !== null) {
      out.push({
        text: `Sales ${d >= 0 ? "up" : "down"} ${Math.abs(Math.round(d * 100))}% on the previous period`,
        tone: d >= 0 ? "up" : "down",
      });
    }
    const bandTop = [...data.bands].sort((a, b) => b.units - a.units)[0];
    if (bandTop && bandTop.units > 0) out.push({ text: `Most pieces sell at ${bandTop.label}`, tone: "flat" });
    return out;
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Insights"
        description="What sells and what doesn't — online and across every branch."
      />

      {/* Filters, in one row above the charts. */}
      <div className="mb-4 rounded-xl border border-[#e7e2dc] bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-[#ddd6cd] text-xs font-medium">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => {
                  if (preset.allTime) {
                    setAllTime(true);
                  } else {
                    setAllTime(false);
                    setFrom(preset.from!());
                    setTo(preset.to!());
                  }
                }}
                className={`px-3 py-1.5 ${
                  isPreset(preset, allTime, from, to)
                    ? "bg-[#6f4423] text-white"
                    : "bg-white text-gray-600 hover:bg-[#faf7f3]"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {!allTime && (
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setAllTime(false);
                  setFrom(e.target.value);
                }}
                className="rounded-lg border border-[#ddd6cd] px-2 py-1.5"
              />
              <span className="text-gray-400">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setAllTime(false);
                  setTo(e.target.value);
                }}
                className="rounded-lg border border-[#ddd6cd] px-2 py-1.5"
              />
            </div>
          )}

          <Select value={channel} onChange={setChannel}>
            <option value="">Online + branches</option>
            <option value="online">Online only</option>
            <option value="offline">Branches only</option>
          </Select>

          <Select value={branch} onChange={setBranch}>
            <option value="">All branches</option>
            {(data?.options.branches ?? []).map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>

          <Select
            value={room}
            onChange={(v) => {
              setRoom(v);
              setSubcategory("");
            }}
          >
            <option value="">All rooms</option>
            {(data?.options.rooms ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>

          <Select value={subcategory} onChange={setSubcategory}>
            <option value="">All sub-categories</option>
            {(data?.options.subcategories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>

          <div className="flex items-center gap-1 text-xs">
            <span className="text-gray-400">Unit price</span>
            <input
              type="number"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="min"
              className="w-16 rounded-lg border border-[#ddd6cd] px-2 py-1.5"
            />
            <span className="text-gray-300">–</span>
            <input
              type="number"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="max"
              className="w-16 rounded-lg border border-[#ddd6cd] px-2 py-1.5"
            />
          </div>

          {(channel || branch || room || subcategory || minPrice || maxPrice) && (
            <button
              onClick={() => {
                setChannel("");
                setBranch("");
                setRoom("");
                setSubcategory("");
                setMinPrice("");
                setMaxPrice("");
              }}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-[#6f4423] underline-offset-2 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {!data || data.coverage.rows === 0 ? (
        <EmptyState
          loading={loading}
          label="No product sales stored yet — run migration_v13.sql, then scripts/backfill-products.ts."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label="Total sales"
              value={fmtMoney(data.totals.totalSales, currency)}
              hint={activeFilters ? `${periodLabel} · ${activeFilters}` : periodLabel}
              delta={delta(data.trend.current.value, data.trend.previous?.value)}
              deltaHint={prevLabel}
              strong
            />
            <Stat
              label="Units sold"
              value={fmtNum(Math.round(data.totals.units))}
              hint="pieces"
              delta={delta(data.trend.current.units, data.trend.previous?.units)}
              deltaHint={prevLabel}
            />
            <Stat label="Products" value={fmtNum(data.totals.products)} hint="distinct items sold" />
          </div>

          {highlights.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {highlights.map((h) => (
                <Highlight key={h.text} text={h.text} tone={h.tone} />
              ))}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Share by room" subtitle="part of the whole">
              <Donut rows={data.rooms} currency={currency} />
            </Panel>
            <div className="lg:col-span-2">
              <Panel title={byDay ? "Sales by day" : "Sales by month"} subtitle="EGP">
                <Columns
                  points={byDay ? data.daily : data.timeseries}
                  currency={currency}
                  unit={byDay ? "day" : "month"}
                />
              </Panel>
            </div>
          </div>

          {byDay && data.monthly.length > 1 && (
            <Panel title="Sales by month" subtitle="every month on record — the date filter above does not apply here">
              <Columns points={data.monthly} currency={currency} unit="month" />
            </Panel>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Where it sells" subtitle="online against the shops, then branch by branch">
              <Bars
                rows={data.channels}
                currency={currency}
                onPick={(l) => {
                  const next = l === "Online" ? "online" : "offline";
                  setChannel(channel === next ? "" : next);
                }}
                active={channel === "online" ? "Online" : channel === "offline" ? "Branches" : ""}
              />
              {data.branches.length > 1 && (
                <div className="mt-3 border-t border-[#f0ece7] pt-3">
                  <Bars rows={data.branches} currency={currency} scroll />
                </div>
              )}
            </Panel>

            <Panel title="Price bands" subtitle="by unit price — darker is dearer">
              <BandBars bands={data.bands} currency={currency} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By room" subtitle="click a bar to filter the page">
              <Bars
                rows={data.rooms}
                currency={currency}
                onPick={(l) => setRoom(l === room ? "" : l)}
                active={room}
                colorByRoom
              />
            </Panel>
            <Panel title="By sub-category" subtitle="towels, fitted sheets, cushions …">
              <Bars
                rows={data.subcategories}
                currency={currency}
                onPick={(l) => setSubcategory(l === subcategory ? "" : l)}
                active={subcategory}
                colorByRoom
                scroll
              />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Top 10 products" subtitle="by revenue">
              <ProductTable rows={data.topProducts} currency={currency} />
            </Panel>
            <Panel title="10 slowest movers" subtitle="fewest pieces sold, and when they last moved">
              <ProductTable rows={data.slowProducts} currency={currency} trailing="last" />
            </Panel>
          </div>

          <p className="px-1 text-[11px] leading-relaxed text-gray-400">
            NS Home retail only, online and in the shops — the fabric and commercial catalogue is excluded. Total sales
            is product value after discounts and with shipping, so it matches the rest of the dashboard; every
            per-room, per-category and per-product figure is product value before discount, because Odoo books a
            discount against no category. Units and revenue are net of anything returned.
            Price bands use the unit price (value ÷ units).
            {loading && <span className="ml-1">· Refreshing…</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[#ddd6cd] bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700"
    >
      {children}
    </select>
  );
}

/** Change against the previous period, or null when there is nothing to compare. */
function delta(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function Stat({
  label,
  value,
  hint,
  strong,
  delta: d,
  deltaHint,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  delta?: number | null;
  deltaHint?: string;
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,12,8,0.04)] ${
        strong ? "border-[#d8c3aa] bg-gradient-to-b from-[#fdfaf6] to-white" : "border-[#e7e2dc] bg-white"
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-xl font-bold tabular-nums text-gray-900 sm:text-2xl">{value}</span>
        {d !== null && d !== undefined && <Arrow value={d} />}
      </div>
      {(hint || deltaHint) && (
        <div className="mt-1 truncate text-[11px] text-gray-400">
          {hint}
          {hint && deltaHint && d !== null && d !== undefined ? " · " : ""}
          {d !== null && d !== undefined ? deltaHint : ""}
        </div>
      )}
    </div>
  );
}

/**
 * Direction rides the glyph and the sign, not colour alone, so the arrow reads
 * the same in grayscale and to a colourblind viewer.
 */
function Arrow({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
      title={`${up ? "up" : "down"} ${Math.abs(value * 100).toFixed(1)}% on the previous period`}
    >
      <span aria-hidden="true">{up ? "\u25b2" : "\u25bc"}</span>
      {Math.abs(Math.round(value * 100))}%
    </span>
  );
}

function Highlight({ text, tone }: { text: string; tone: "up" | "down" | "flat" }) {
  const glyph = tone === "up" ? "\u25b2" : tone === "down" ? "\u25bc" : "\u2022";
  const cls =
    tone === "up"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "down"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-[#e7e2dc] bg-white text-gray-700";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${cls}`}>
      <span aria-hidden="true" className="text-[10px] opacity-70">
        {glyph}
      </span>
      {text}
    </span>
  );
}

/**
 * Part-to-whole at a glance, four slices at most. Every slice is named in the
 * legend beside it, so identity never rests on colour — which is also the
 * relief the palette validator requires for the low-contrast slot.
 */
function Donut({ rows, currency }: { rows: Slice[]; currency: string }) {
  const total = rows.reduce((acc, r) => acc + Math.max(0, r.value), 0);
  if (!total) return <p className="py-6 text-center text-xs text-gray-400">Nothing in this selection.</p>;
  const R = 52;
  const C = 2 * Math.PI * R;
  let cursor = 0;
  const arcs = rows
    .filter((r) => r.value > 0)
    .map((r) => {
      const frac = r.value / total;
      // 2px of surface between neighbours — the same spacer the bars use.
      const len = Math.max(0, C * frac - 2);
      const seg = { r, frac, len, offset: cursor };
      cursor += C * frac;
      return seg;
    });
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 130 130" className="h-[130px] w-[130px] shrink-0" role="img" aria-label="Share by room">
        <text x="65" y="63" textAnchor="middle" className="fill-gray-900 text-[12px] font-bold">
          {fmtNum(Math.round(total))}
        </text>
        <text x="65" y="76" textAnchor="middle" className="fill-gray-400 text-[8px]">
          EGP
        </text>
        <g transform="translate(65,65) rotate(-90)">
          {arcs.map(({ r, len, offset }) => (
            <circle
              key={r.label}
              r={R}
              fill="none"
              stroke={roomHue(r.label)}
              strokeWidth={18}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
            >
              <title>{`${r.label} \u2014 ${fmtMoney(r.value, currency)}`}</title>
            </circle>
          ))}
        </g>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {arcs.map(({ r, frac }) => (
          <li key={r.label} className="flex items-baseline gap-2 text-xs">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: roomHue(r.label) }}
            />
            <span className="truncate text-gray-700">{r.label}</span>
            <span className="ml-auto shrink-0 font-semibold tabular-nums text-gray-900">
              {Math.round(frac * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Change over time as columns, not a line: the series is monthly and discrete,
 * and a line would imply readings in between that do not exist.
 */
function Columns({
  points,
  currency,
  unit = "month",
}: {
  points: Point[];
  currency: string;
  unit?: "day" | "month";
}) {
  if (!points.length) return <p className="py-6 text-center text-xs text-gray-400">No months in this selection.</p>;
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const peak = points.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
  // Heights in pixels, not percentages: the column wrapper is sized by its
  // content, and a percentage height against an auto-height parent resolves to
  // nothing — which is how this chart first rendered, all labels and no bars.
  const PLOT = 124;
  return (
    <div>
      <div className="relative">
        <span className="absolute -top-2 left-0 z-10 bg-white pr-1 text-[9px] tabular-nums text-gray-300">
          {fmtMoney(max, currency)}
        </span>
        {/* One recessive reference line at the top of the scale, so a column
            can be read against something rather than floating. */}
        <div className="absolute inset-x-0 top-0 border-t border-[#f2eee9]" />
        <div className="flex items-end gap-1 overflow-hidden border-b border-[#e7e2dc]" style={{ height: PLOT }}>
          {points.map((p) => (
            <div key={p.label} className="group flex min-w-0 flex-1 justify-center">
              <div
                className="w-full max-w-[38px] rounded-t-[4px] transition-opacity group-hover:opacity-70"
                style={{
                  height: Math.max(2, (Math.abs(p.value) / max) * (PLOT - 6)),
                  backgroundColor: INK,
                  opacity: p.label === peak.label ? 1 : 0.75,
                }}
                title={`${p.label} — ${fmtMoney(p.value, currency)} from ${fmtNum(Math.round(p.units))} pieces`}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-1 overflow-hidden">
        {points.map((p) => (
          <span
            key={p.label}
            className="min-w-0 flex-1 truncate pt-1.5 text-center text-[10px] tabular-nums text-gray-400"
          >
            {unit === "day" ? p.label.slice(8) : p.label.slice(2)}
          </span>
        ))}
      </div>
      <p className="mt-2 border-t border-[#f0ece7] pt-2 text-[11px] text-gray-400">
        Best {unit} {peak.label} &middot; <b className="text-gray-700">{fmtMoney(peak.value, currency)}</b>
      </p>
    </div>
  );
}



function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#e7e2dc] bg-white p-4 shadow-[0_1px_2px_rgba(16,12,8,0.04)]">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-bold tracking-tight text-gray-900">{title}</h2>
        {subtitle && <p className="shrink-0 truncate text-[11px] text-gray-400">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

/**
 * Ranked magnitude bars: one measure, one hue. The bar is thin with a rounded
 * data end, the track holds the leftover space, and the whole row — not the
 * bar alone — is the hover and click target.
 */
function Bars({
  rows,
  currency,
  onPick,
  active,
  scroll,
  colorByRoom,
}: {
  rows: Slice[];
  currency: string;
  onPick?: (label: string) => void;
  active?: string;
  scroll?: boolean;
  colorByRoom?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <p className="py-6 text-center text-xs text-gray-400">Nothing in this selection.</p>;
  return (
    <div className={scroll ? "max-h-[260px] space-y-0.5 overflow-y-auto pr-1" : "space-y-0.5"}>
      {rows.map((r) => {
        const isActive = active === r.label;
        return (
          <button
            key={r.label}
            onClick={() => onPick?.(r.label)}
            title={`${r.label} — ${fmtMoney(r.value, currency)} from ${fmtNum(Math.round(r.units))} pieces`}
            className={`block w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
              onPick ? "hover:bg-[#faf7f3]" : "cursor-default"
            } ${isActive ? "bg-[#f6efe7]" : ""}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs font-medium text-gray-800">{r.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-gray-900">{fmtMoney(r.value, currency)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f2eee9]">
                <div
                  className="h-full rounded-r-[4px]"
                  style={{
                    width: `${Math.max(1.5, (Math.abs(r.value) / max) * 100)}%`,
                    backgroundColor: colorByRoom ? roomHue(r.room ?? r.label) : INK,
                    opacity: !active || isActive ? 1 : 0.3,
                  }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-gray-400">
                {fmtNum(Math.round(r.units))}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Price bands are ordered, so here the ordinal ramp is the right encoding. */
function BandBars({ bands, currency }: { bands: Band[]; currency: string }) {
  const max = Math.max(1, ...bands.map((b) => Math.abs(b.units)));
  return (
    <div className="space-y-0.5">
      {bands.map((b, i) => (
        <div
          key={b.label}
          title={`${b.label} — ${fmtNum(Math.round(b.units))} pieces, ${fmtMoney(b.value, currency)}`}
          className="rounded-lg px-2 py-1.5"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-xs font-medium text-gray-800">{b.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-gray-900">{fmtMoney(b.value, currency)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f2eee9]">
              <div
                className="h-full rounded-r-[4px]"
                style={{
                  width: `${Math.max(1.5, (Math.abs(b.units) / max) * 100)}%`,
                  backgroundColor: BAND_RAMP[Math.min(i, BAND_RAMP.length - 1)],
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-gray-400">
              {fmtNum(Math.round(b.units))}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductTable({
  rows,
  currency,
  trailing,
}: {
  rows: Product[];
  currency: string;
  trailing?: "last";
}) {
  if (!rows.length) return <p className="py-6 text-center text-xs text-gray-400">Nothing in this selection.</p>;
  return (
    <table className="w-full table-fixed border-collapse text-left text-xs">
      <colgroup>
        <col className="w-[6%]" />
        <col className={trailing ? "w-[42%]" : "w-[56%]"} />
        <col className="w-[12%]" />
        <col className="w-[26%]" />
        {trailing && <col className="w-[14%]" />}
      </colgroup>
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-gray-400">
          <th className="border-b border-[#f0ece7] px-1.5 py-1.5 font-semibold">#</th>
          <th className="border-b border-[#f0ece7] px-1.5 py-1.5 font-semibold">Product</th>
          <th className="border-b border-[#f0ece7] px-1.5 py-1.5 text-right font-semibold">Units</th>
          <th className="border-b border-[#f0ece7] px-1.5 py-1.5 text-right font-semibold">Revenue</th>
          {trailing === "last" && (
            <th className="border-b border-[#f0ece7] px-1.5 py-1.5 text-right font-semibold">Last</th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => (
          <tr key={p.product_id} className="border-b border-[#f7f5f2] last:border-0 hover:bg-[#faf7f3]">
            <td className="px-1.5 py-1.5 tabular-nums text-gray-300">{i + 1}</td>
            <td className="px-1.5 py-1.5">
              <div className="truncate text-gray-800" title={p.name}>
                {p.name}
              </div>
              <div className="truncate text-[10px] text-gray-400">{p.subcategory}</div>
            </td>
            <td className="px-1.5 py-1.5 text-right tabular-nums text-gray-700">{fmtNum(Math.round(p.units))}</td>
            <td className="truncate px-1.5 py-1.5 text-right tabular-nums font-semibold text-gray-900">
              {fmtMoney(p.value, currency)}
            </td>
            {trailing === "last" && (
              <td className="px-1.5 py-1.5 text-right tabular-nums text-gray-400">{p.lastSold.slice(5)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
