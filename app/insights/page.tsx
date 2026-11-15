"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui";
import { fmtNum, fmtMoney } from "@/lib/format";

interface Slice {
  label: string;
  units: number;
  items?: number;
  value: number;
  orders: number | null;
  room?: string;
}
interface Point {
  label: string;
  units: number;
  value: number;
  orders?: number | null;
}
interface Trend {
  // Both sides are per day, so any window length compares like for like.
  current: { from: string; to: string; days: number; units: number; value: number; orders?: number | null };
  baseline: { label: string; from: string; to: string; days: number; units: number; value: number; orders?: number | null };
}
interface Band {
  label: string;
  min: number;
  max: number | null;
  units: number;
  items?: number;
  value: number;
  orders?: number | null;
}
interface Product {
  product_id: number;
  name: string;
  units: number;
  value: number;
  orders?: number | null;
  subcategory: string;
  lastSold: string;
}
interface Resp {
  ok: boolean;
  error?: string;
  coverage: {
    first: string | null;
    last: string | null;
    rows: number;
    stored: number;
    latest: string | null;
  };
  totals: {
    units: number;
    items?: number;
    orders?: number | null;
    hasInvoices?: boolean;
    gross: number;
    discounts: number;
    shipping: number;
    totalSales: number;
    products: number;
    onlineSource?: "shopify" | "odoo";
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
  pickedProducts?: Product[];
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

  // Every filter except the dates: a box's Compare reuses it with its own dates.
  const filterQuery = useMemo(() => {
    const p = new URLSearchParams();
    if (channel) p.set("channel", channel);
    if (branch) p.set("branch", branch);
    if (room) p.set("room", room);
    if (subcategory) p.set("subcategory", subcategory);
    if (minPrice) p.set("minPrice", minPrice);
    if (maxPrice) p.set("maxPrice", maxPrice);
    return p.toString();
  }, [channel, branch, room, subcategory, minPrice, maxPrice]);

  const query = useMemo(() => {
    const p = new URLSearchParams(filterQuery);
    if (!allTime) {
      p.set("from", from);
      p.set("to", to);
    }
    return p.toString();
  }, [filterQuery, allTime, from, to]);
  const compareCtx = useMemo(
    () => ({ filterQuery, base: allTime ? null : { from, to } }),
    [filterQuery, allTime, from, to]
  );

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
  const prevLabel = data ? `vs ${data.trend.baseline.label}` : undefined;
  // Where the online money comes from, for the info popovers.
  const onlineFrom =
    data?.totals.onlineSource === "odoo"
      ? "the Shopify order lines in your selection, at their line prices (order discounts and shipping belong to no product)"
      : "Shopify, the same figure as the Summary page";

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
    const d = delta(data.trend.current.value, data.trend.baseline.value);
    if (d !== null) {
      out.push({
        text: `${Math.abs(Math.round(d * 100))}% ${d >= 0 ? "above" : "below"} an average day this month`,
        tone: d >= 0 ? "up" : "down",
      });
    }
    const bandTop = [...data.bands].sort((a, b) => (b.orders ?? 0) - (a.orders ?? 0))[0];
    if (bandTop && (bandTop.orders ?? 0) > 0) out.push({ text: `Most orders are at ${bandTop.label}`, tone: "flat" });
    return out;
  }, [data]);

  return (
    <CompareCtx.Provider value={compareCtx}>
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
          label={
            // An empty selection is not an empty table. Saying "run the
            // migration" when the only problem is that today has no sales yet
            // sends you off to fix something that is not broken.
            !data || data.coverage.stored === 0
              ? "No product sales stored yet — run migration_v13.sql, then scripts/backfill-products.ts."
              : `No sales in this selection${
                  data.coverage.latest ? `. Sales are synced up to ${data.coverage.latest}` : ""
                }${activeFilters ? ` · filters: ${activeFilters}` : ""}.`
          }
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Total sales"
              value={fmtMoney(data.totals.totalSales, currency)}
              hint={activeFilters ? `${periodLabel} · ${activeFilters}` : periodLabel}
              delta={delta(data.trend.current.value, data.trend.baseline.value)}
              deltaHint={prevLabel}
              strong
              compare={{
                now: data.totals.totalSales,
                pick: (r) => r.totals.totalSales,
                format: (n) => fmtMoney(n, currency),
              }}
              info={
                <>
                  <p>All NS Home sales in the dates you picked: after discounts, with shipping, minus returns.</p>
                  <p>
                    <b>Online</b> comes from {onlineFrom}. <b>Branches</b> come from Odoo sales invoices.
                  </p>
                  <p>The arrow compares a day in this period with an average day of the month.</p>
                </>
              }
            />
            <Stat
              label="Orders"
              value={data.totals.orders == null ? "—" : fmtNum(data.totals.orders)}
              hint="orders"
              compare={{ now: data.totals.orders, pick: (r) => r.totals.orders, format: fmtNum }}
              delta={
                data.trend.current.orders != null && data.trend.baseline.orders != null
                  ? delta(data.trend.current.orders, data.trend.baseline.orders)
                  : null
              }
              deltaHint={prevLabel}
              info={
                <>
                  <p>Number of orders in the dates you picked. Returns are not counted as orders.</p>
                  <p>
                    With no room, sub-category or price filter: online is the Shopify order count and each branch is its
                    number of Odoo sales invoices, the same as the Summary page.
                  </p>
                  <p>
                    With one of those filters on: the number of Odoo sales invoices that contain at least one product
                    in your selection. An order with two towels counts once.
                  </p>
                </>
              }
            />
            <Stat
              label="Pieces"
              value={fmtNum(data.totals.units)}
              hint="pieces sold"
              compare={{ now: data.totals.units, pick: (r) => r.totals.units, format: fmtNum }}
              delta={delta(data.trend.current.units, data.trend.baseline.units)}
              deltaHint={prevLabel}
              info={
                <>
                  <p>Number of pieces sold in the dates you picked, counted the same way as the Summary page.</p>
                  <p>
                    Shops: pieces on Odoo sales invoices. Online: pieces on Shopify orders, cancelled orders left out.
                    Returns are not taken off. An order with two towels counts as two pieces.
                  </p>
                  <p>
                    Every panel on this page uses the same orders, so the dates you pick apply everywhere: online
                    figures come from the Shopify orders placed on those days.
                  </p>
                </>
              }
            />
            <Stat
              label="Products"
              value={fmtNum(data.totals.items ?? data.totals.products)}
              hint="distinct items sold"
              compare={{
                now: data.totals.items ?? data.totals.products,
                pick: (r) => r.totals.items ?? r.totals.products,
                format: fmtNum,
              }}
              info={<p>How many different products sold at least once in the dates you picked. From Odoo invoice lines.</p>}
            />
          </div>

          {highlights.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {highlights.map((h) => (
                <Highlight key={h.text} text={h.text} tone={h.tone} />
              ))}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              title="Share by room"
              subtitle="part of the whole"
              comparable
              info={
                <>
                  <p>Each room&apos;s share of total sales.</p>
                  <p>A product&apos;s room comes from its Odoo category, e.g. &quot;NS Home / Bed Linen&quot; → Bedroom.</p>
                  <p>Discounts and shipping belong to no product, so they are shared across rooms by value.</p>
                </>
              }
            >
              {(cmp) =>
                cmp ? (
                  <CompareTable
                    rows={pairRows(data.rooms, cmp.rooms, (r) => r.label)}
                    currency={currency}
                    nameHeader="Room"
                  />
                ) : (
                  <Donut rows={data.rooms} currency={currency} />
                )
              }
            </Panel>
            <div className="lg:col-span-2">
              <Panel
                title={byDay ? "Sales by day" : "Sales by month"}
                subtitle="EGP"
                comparable
                info={
                  <>
                    <p>Total sales for each {byDay ? "day" : "month"} in the dates you picked, after discounts and returns.</p>
                    <p>
                      Online from {onlineFrom}; branches from Odoo sales invoices, by invoice date.
                    </p>
                  </>
                }
              >
                {(cmp) =>
                  cmp ? (
                    <CompareTable
                      rows={pairByPosition(
                        byDay ? data.daily : data.timeseries,
                        byDay ? cmp.daily : cmp.timeseries
                      )}
                      currency={currency}
                      nameHeader={byDay ? "Day" : "Month"}
                    />
                  ) : (
                    <Columns
                      points={byDay ? data.daily : data.timeseries}
                      currency={currency}
                      unit={byDay ? "day" : "month"}
                    />
                  )
                }
              </Panel>
            </div>
          </div>

          {data.monthly.length > 1 && (
            <Panel
              title="Sales by month"
              subtitle="every month on record — the date filter above does not apply here"
              info={
                <>
                  <p>Total sales for every month on record. The other filters apply, but not the dates.</p>
                  <p>Online from {onlineFrom}; branches from Odoo sales invoices.</p>
                </>
              }
            >
              <Columns points={data.monthly} currency={currency} unit="month" />
            </Panel>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Where it sells"
              subtitle="online against the shops, then branch by branch"
              comparable
              info={
                <>
                  <p>
                    <b>EGP</b> is total sales: online from {onlineFrom}; each branch from its Odoo sales invoices.
                  </p>
                  <p>
                    <b>Orders</b> (grey): online is the Shopify order count; a branch is its number of Odoo sales
                    invoices, the same as the Summary page. Returns are not counted as orders.
                  </p>
                  <p>
                    <b>pcs</b> is pieces sold, also as on the Summary page: online from Shopify orders (cancelled ones
                    left out), branches from Odoo invoices. <b>items</b> is how many different products those pieces
                    were.
                  </p>
                  <p>
                    With a room, sub-category or price filter on, orders are the Shopify orders and Odoo invoices
                    holding at least one product in your selection.
                  </p>
                </>
              }
            >
              {(cmp) =>
                cmp ? (
                  <>
                    <CompareTable
                      rows={pairRows(data.channels, cmp.channels, (r) => r.label)}
                      currency={currency}
                      nameHeader="Channel"
                    />
                    {data.branches.length > 1 && (
                      <div className="mt-3 border-t border-[#f0ece7] pt-3">
                        <CompareTable
                          rows={pairRows(data.branches, cmp.branches, (r) => r.label)}
                          currency={currency}
                          nameHeader="Branch"
                        />
                      </div>
                    )}
                  </>
                ) : (
                <>
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
                </>
                )
              }
            </Panel>

            <Panel
              title="Price bands"
              subtitle="by unit price — darker is dearer"
              comparable
              info={
                <>
                  <p>Sales grouped by the price of one piece (line value ÷ pieces), from Odoo invoice lines.</p>
                  <p>
                    <b>EGP</b> is the sales in that band. <b>Orders</b> (grey) is the number of Odoo sales invoices
                    with a product in that band, and sets the bar length. One order with a cheap and a dear item counts
                    in both bands.
                  </p>
                </>
              }
            >
              {(cmp) =>
                cmp ? (
                  <CompareTable
                    rows={pairRows(data.bands, cmp.bands, (b) => b.label)}
                    currency={currency}
                    nameHeader="Unit price"
                    total={false}
                  />
                ) : (
                  <BandBars bands={data.bands} currency={currency} />
                )
              }
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="By room"
              subtitle={`sums to ${fmtMoney(
                data.rooms.reduce((a, r) => a + r.value, 0),
                currency
              )} — total sales`}
              comparable
              info={
                <>
                  <p>
                    <b>EGP</b> is each room&apos;s sales. Discounts and shipping belong to no product, so they are shared
                    across rooms by value. That way the rooms add up to total sales.
                  </p>
                  <p>
                    <b>Orders</b> (grey) is the number of Odoo sales invoices with at least one product from that room.
                    An order with a towel and a cushion counts in both rooms, so rooms can add up to more than the
                    total. The room comes from the product&apos;s Odoo category.
                  </p>
                </>
              }
            >
              {(cmp) =>
                cmp ? (
                  <CompareTable
                    rows={pairRows(data.rooms, cmp.rooms, (r) => r.label)}
                    currency={currency}
                    nameHeader="Room"
                  />
                ) : (
                <Bars
                  rows={data.rooms}
                  currency={currency}
                  onPick={(l) => setRoom(l === room ? "" : l)}
                  active={room}
                  colorByRoom
                />
                )
              }
            </Panel>
            <Panel
              title="By sub-category"
              subtitle="towels, fitted sheets, cushions …"
              comparable
              info={
                <>
                  <p>
                    <b>EGP</b> is each sub-category&apos;s sales, with discounts and shipping shared by value, like the
                    rooms.
                  </p>
                  <p>
                    <b>Orders</b> (grey) is the number of Odoo sales invoices with at least one product from that
                    sub-category. The sub-category is the last part of the product&apos;s Odoo category, e.g.
                    &quot;Bathroom Textile/Towels&quot; → Towels.
                  </p>
                </>
              }
            >
              {(cmp) =>
                cmp ? (
                  <CompareTable
                    rows={pairRows(data.subcategories, cmp.subcategories, (r) => r.label, (r) => r.room)}
                    currency={currency}
                    nameHeader="Sub-category"
                  />
                ) : (
                <Bars
                  rows={data.subcategories}
                  currency={currency}
                  onPick={(l) => setSubcategory(l === subcategory ? "" : l)}
                  active={subcategory}
                  colorByRoom
                  scroll
                />
                )
              }
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Top 10 products"
              subtitle="by revenue"
              comparable
              products={data.topProducts.map((p) => p.name)}
              info={
                <>
                  <p>The 10 products with the most sales in the dates you picked, from Odoo invoice lines.</p>
                  <p>
                    <b>Orders</b> is how many Odoo sales invoices included the product. <b>Pcs</b> is how many pieces
                    sold, minus returns. <b>Revenue</b> is the
                    product&apos;s sales with its share of discounts and shipping.
                  </p>
                </>
              }
            >
              {(cmp) =>
                cmp ? (
                  <CompareTable
                    rows={pairProducts(data.topProducts, cmp.pickedProducts ?? [])}
                    currency={currency}
                    nameHeader="Product"
                    total={false}
                  />
                ) : (
                  <ProductTable rows={data.topProducts} currency={currency} />
                )
              }
            </Panel>
            <Panel
              title="10 slowest movers"
              subtitle="fewest orders, and when they last moved"
              comparable
              products={data.slowProducts.map((p) => p.name)}
              info={
                <>
                  <p>Products that sold, but in the fewest orders in the dates you picked. From Odoo invoice lines.</p>
                  <p>
                    <b>Orders</b> is how many Odoo sales invoices included the product. <b>Revenue</b> is as in Top
                    10. <b>Last</b> is the last day the product sold (month-day).
                  </p>
                </>
              }
            >
              {(cmp) =>
                cmp ? (
                  <CompareTable
                    rows={pairProducts(data.slowProducts, cmp.pickedProducts ?? [])}
                    currency={currency}
                    nameHeader="Product"
                    total={false}
                  />
                ) : (
                  <ProductTable rows={data.slowProducts} currency={currency} trailing="last" />
                )
              }
            </Panel>
          </div>

          <p className="px-1 text-[11px] leading-relaxed text-gray-400">
            NS Home retail only, online and in the shops — the fabric and commercial catalogue is excluded. Total sales
            is product value after discounts and with shipping, so it matches the rest of the dashboard; every
            per-room, per-category and per-product figure is scaled so the parts add up to that total: Odoo books a
            discount against no category, shipping belongs to none, and Odoo's copy of the website differs from
            Shopify's, so those ride along in proportion to value rather than being dropped. That makes a single
            category figure an apportionment, not the exact value of one sale. Revenue is net of anything returned;
            orders count sales invoices only, never returns. Price bands use the unit price (value ÷ pieces).
            {data.totals.hasInvoices === false && (
              <b className="ml-1 font-semibold text-amber-700">
                Order counts per room, product and band need migration_v19.sql and a re-run of
                scripts/backfill-products.ts — until then they show —.
              </b>
            )}
            {loading && <span className="ml-1">· Refreshing…</span>}
          </p>
        </div>
      )}
    </div>
    </CompareCtx.Provider>
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
  info,
  compare,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  delta?: number | null;
  deltaHint?: string;
  info?: React.ReactNode;
  /** The same number for another date range, picked with the Compare button. */
  compare?: {
    now: number | null | undefined;
    pick: (r: Resp) => number | null | undefined;
    format: (n: number) => string;
  };
}) {
  const [range, setRange] = useState<Range | null>(null);
  const cmp = useCompare(compare ? range : null);
  const was = cmp.data && compare ? compare.pick(cmp.data) : null;
  const { base: baseRange } = useContext(CompareCtx);
  return (
    <div
      className={`rounded-xl border p-4 shadow-[0_1px_2px_rgba(16,12,8,0.04)] ${
        strong ? "border-[#d8c3aa] bg-gradient-to-b from-[#fdfaf6] to-white" : "border-[#e7e2dc] bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          {label}
          {info && <Info>{info}</Info>}
        </div>
        {compare && <CompareButton range={range} onChange={setRange} />}
      </div>
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
      {compare && range && (
        <div className="mt-2 border-t border-[#f0ece7] pt-2 text-[11px]">
          {cmp.loading ? (
            <span className="text-gray-400">Loading {fmtRange(range)}…</span>
          ) : cmp.error ? (
            <span className="text-rose-600">{cmp.error}</span>
          ) : cmp.data ? (
            <table className="w-full border-collapse tabular-nums">
              <tbody>
                <tr>
                  <td className="py-0.5 text-gray-500">{baseRange ? fmtRange(baseRange) : "All time"}</td>
                  <td className="py-0.5 text-right font-semibold text-gray-800">
                    {compare.now == null ? "—" : compare.format(compare.now)}
                  </td>
                </tr>
                <tr>
                  <td className="py-0.5 text-gray-500">{fmtRange(range)}</td>
                  <td className="py-0.5 text-right font-semibold text-gray-800">
                    {was == null ? "—" : compare.format(was)}
                  </td>
                </tr>
                <tr className="border-t border-[#f0ece7]">
                  <td className="py-0.5 text-gray-500">Change</td>
                  <td className="py-0.5 text-right">
                    {compare.now != null && was != null && (
                      <span className="mr-1 text-gray-600">
                        {compare.now - was >= 0 ? "+" : "−"}
                        {compare.format(Math.abs(compare.now - was))}
                      </span>
                    )}
                    <Change now={compare.now} was={was} />
                  </td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------------- Compare: any box against another date range ---------------- */

interface Range {
  from: string;
  to: string;
}

/** The page's filters (without dates) and its current dates, for every box's Compare. */
const CompareCtx = createContext<{ filterQuery: string; base: Range | null }>({ filterQuery: "", base: null });

/** One request per range and filter set, however many boxes ask for it. */
const compareCache = new Map<string, Promise<Resp>>();
function loadInsights(q: string): Promise<Resp> {
  let p = compareCache.get(q);
  if (!p) {
    p = fetch(`/api/insights?${q}`).then(async (r) => {
      const text = await r.text();
      let j: Resp;
      try {
        j = JSON.parse(text) as Resp;
      } catch {
        throw new Error(`Server error (${r.status}).`);
      }
      if (!j.ok) throw new Error(j.error || "Failed to load");
      return j;
    });
    p.catch(() => compareCache.delete(q));
    compareCache.set(q, p);
  }
  return p;
}

/** The page's data for another date range, with the same filters. */
function useCompare(range: Range | null, products?: string[]) {
  const { filterQuery } = useContext(CompareCtx);
  const [state, setState] = useState<{ data: Resp | null; loading: boolean; error: string | null }>({
    data: null,
    loading: false,
    error: null,
  });
  const productsKey = (products ?? []).join("\u0001");
  const from = range?.from;
  const to = range?.to;
  useEffect(() => {
    if (!from || !to) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let alive = true;
    const p = new URLSearchParams(filterQuery);
    p.set("from", from);
    p.set("to", to);
    for (const n of productsKey ? productsKey.split("\u0001") : []) p.append("product", n);
    setState((s) => ({ ...s, loading: true, error: null }));
    loadInsights(p.toString())
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((e) => alive && setState({ data: null, loading: false, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [filterQuery, from, to, productsKey]);
  return state;
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** Same day n months away, kept inside the month (Mar 31 − 1 month = Feb 28). */
function addMonths(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, last))).toISOString().slice(0, 10);
}
function comparePresets(base: Range | null): { label: string; range: Range }[] {
  if (!base || !base.from || !base.to) return [];
  const days = Math.round((Date.parse(base.to) - Date.parse(base.from)) / 86_400_000) + 1;
  return [
    { label: "Days just before", range: { from: addDays(base.from, -days), to: addDays(base.from, -1) } },
    { label: "Same days last month", range: { from: addMonths(base.from, -1), to: addMonths(base.to, -1) } },
    { label: "Same days last year", range: { from: addMonths(base.from, -12), to: addMonths(base.to, -12) } },
  ];
}
/** "Oct 1 – Oct 15", with the year when it is not this year. */
function fmtRange(r: Range): string {
  const thisYear = todayStr().slice(0, 4);
  const day = (d: string) => {
    const [y, m, dd] = d.split("-").map(Number);
    const name = new Date(Date.UTC(y, m - 1, dd)).toLocaleString("en", { month: "short", timeZone: "UTC" });
    return `${name} ${dd}${String(y) !== thisYear ? ` ${y}` : ""}`;
  };
  return r.from === r.to ? day(r.from) : `${day(r.from)} – ${day(r.to)}`;
}

/** Change from the compared range to now: ▲ 12%, ▼ 5%, or "new". */
function Change({ now, was }: { now: number | null | undefined; was: number | null | undefined }) {
  if (now == null || was == null) return null;
  if (was === 0) {
    return now === 0 ? null : (
      <span className="shrink-0 rounded bg-emerald-50 px-1 text-[10px] font-semibold text-emerald-700">new</span>
    );
  }
  const d = (now - was) / Math.abs(was);
  const up = d >= 0;
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded px-1 text-[10px] font-semibold tabular-nums ${
        up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
      }`}
      title={`${up ? "up" : "down"} ${Math.abs(d * 100).toFixed(1)}% on the compared dates`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(Math.round(d * 100))}%
    </span>
  );
}

/** "Compare" — pick the dates to set this box against. */
function CompareButton({ range, onChange }: { range: Range | null; onChange: (r: Range | null) => void }) {
  const { base } = useContext(CompareCtx);
  const presets = comparePresets(base);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Start the custom fields on what is compared now, or the days just before.
    const start = range ?? presets[0]?.range ?? { from: daysAgoStr(30), to: todayStr() };
    setFrom(start.from);
    setTo(start.to);
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (r: Range) => {
    onChange(r.from <= r.to ? r : { from: r.to, to: r.from });
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative shrink-0 normal-case tracking-normal">
      {range ? (
        <span className="inline-flex items-center overflow-hidden rounded-md border border-[#d8c3aa] bg-[#f6efe7] text-[10px] font-semibold text-[#6f4423]">
          <button type="button" onClick={() => setOpen((o) => !o)} className="px-1.5 py-0.5 hover:bg-[#efe4d7]">
            vs {fmtRange(range)}
          </button>
          <button
            type="button"
            aria-label="Stop comparing"
            title="Stop comparing"
            onClick={() => onChange(null)}
            className="border-l border-[#d8c3aa] px-1.5 py-0.5 hover:bg-[#efe4d7]"
          >
            ×
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-[#ddd6cd] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 hover:border-[#6f4423] hover:text-[#6f4423]"
        >
          Compare
        </button>
      )}
      {open && (
        <div className="absolute right-0 top-7 z-40 w-64 max-w-[calc(100vw-32px)] rounded-lg border border-[#e7e2dc] bg-white p-3 text-left font-normal shadow-lg">
          <p className="mb-1.5 text-[11px] font-semibold text-gray-700">Compare with</p>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => pick(p.range)}
              className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-xs text-gray-700 hover:bg-[#faf7f3]"
            >
              <span>{p.label}</span>
              <span className="shrink-0 text-[10px] text-gray-400">{fmtRange(p.range)}</span>
            </button>
          ))}
          <div className={presets.length ? "mt-2 border-t border-[#f0ece7] pt-2" : ""}>
            <p className="mb-1 text-[10px] text-gray-400">Or pick the dates</p>
            <div className="flex items-center gap-1 text-xs">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="min-w-0 flex-1 rounded border border-[#ddd6cd] px-1 py-1"
              />
              <span className="text-gray-400">→</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="min-w-0 flex-1 rounded border border-[#ddd6cd] px-1 py-1"
              />
            </div>
            <button
              type="button"
              disabled={!from || !to}
              onClick={() => pick({ from, to })}
              className="mt-2 w-full rounded-md bg-[#6f4423] px-2 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              Compare
            </button>
          </div>
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
      title={`${up ? "above" : "below"} an average day this month by ${Math.abs(value * 100).toFixed(1)}%`}
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
/**
 * The move from the previous column, under the column it lands on. A true
 * boundary marker would read better, but it cannot be placed reliably between
 * two flex items that size themselves; anchoring it to the column keeps it
 * correct at any width. Direction rides the glyph as well as the colour, so it
 * survives greyscale.
 */
function Step({ from, to, inside }: { from?: number; to: number; inside?: boolean }) {
  if (from === undefined || from === 0) return null;
  const pct = ((to - from) / Math.abs(from)) * 100;
  const up = pct >= 0;
  // No triangle in the upright label: the 180deg rotation that stands the text
  // up turns the glyph over with it, so a rise drew as a down arrow \u2014 Sep was
  // +161% on Aug and the chart showed it falling. A plus or minus survives the
  // rotation; the axis label below the bar keeps the triangle.
  const text = `${up ? "+" : "\u2212"}${Math.abs(Math.round(pct))}%`;
  const axisText = `${up ? "\u25b2" : "\u25bc"}${Math.abs(Math.round(pct))}%`;
  const title = `${up ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% on the previous column`;
  if (inside) {
    // On the bar, upright, in white — the bar is dark enough to carry it, and
    // standing it up means a narrow day column cannot clip it.
    return (
      <span
        className="text-[8px] font-semibold tabular-nums leading-none text-white/90"
        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        title={title}
      >
        {text}
      </span>
    );
  }
  return (
    <span
      className={`block w-full truncate text-center text-[8px] font-semibold tabular-nums ${
        up ? "text-emerald-600" : "text-rose-600"
      }`}
      title={title}
    >
      {axisText}
    </span>
  );
}

/** 112,942 -> "113k". Short enough to sit above a column without colliding. */
function compact(n: number): string {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

/** "2026-09" -> "Sep", or "Sep 26" when the series crosses a year. */
function monthLabel(ym: string, withYear: boolean): string {
  const [y, m] = ym.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: "short", timeZone: "UTC" });
  return withYear ? `${name} ${String(y).slice(2)}` : name;
}

/**
 * Change over time as columns, not a line: the series is discrete, and a line
 * would imply readings between the points that do not exist. Every column is
 * labelled with its value — normally a chart labels selectively, but these are
 * few enough to read and the number is the thing being asked for.
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
  if (!points.length) return <p className="py-6 text-center text-xs text-gray-400">No data in this selection.</p>;
  const max = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const peak = points.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
  const spansYears = new Set(points.map((p) => p.label.slice(0, 4))).size > 1;
  const label = (p: Point) => (unit === "day" ? p.label.slice(8) : monthLabel(p.label, spansYears));
  // Heights in pixels: a percentage against a content-sized parent resolves to
  // nothing, which is how this chart first rendered — labels and no bars.
  const PLOT = 150;
  const CAP = 34; // headroom for the upright value above the tallest column
  const barHeight = (p: Point) => Math.max(2, (Math.abs(p.value) / max) * (PLOT - CAP - 4));
  return (
    <div>
      <div className="flex items-end gap-1 overflow-hidden border-b border-[#e7e2dc]" style={{ height: PLOT }}>
        {points.map((p, i) => (
          <div key={p.label} className="group flex min-w-0 flex-1 flex-col items-center justify-end">
            <span
              className="mb-1 text-[9px] font-semibold tabular-nums leading-none text-gray-600"
              style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
            >
              {compact(p.value)}
            </span>
            <div
              className="flex w-full max-w-[38px] items-center justify-center rounded-t-[4px] transition-opacity group-hover:opacity-70"
              style={{
                height: barHeight(p),
                backgroundColor: INK,
                opacity: p.label === peak.label ? 1 : 0.75,
              }}
              title={`${p.label} — ${fmtMoney(p.value, currency)}${p.orders != null ? ` from ${fmtNum(p.orders)} orders` : ""}, ${piecesLabel(p.units)}`}
            >
              {/* Only when the column is tall enough to hold it without
                  clipping; the tooltip carries it otherwise. */}
              {barHeight(p) >= 42 && <Step from={points[i - 1]?.value} to={p.value} inside />}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1 overflow-hidden">
        {points.map((p) => (
          <div key={p.label} className="min-w-0 flex-1 truncate pt-1.5 text-center text-[10px] tabular-nums text-gray-400">
            {label(p)}
          </div>
        ))}
      </div>
      <p className="mt-2 border-t border-[#f0ece7] pt-2 text-[11px] text-gray-400">
        Best {unit} {unit === "day" ? peak.label : monthLabel(peak.label, true)} &middot;{" "}
        <b className="text-gray-700">{fmtMoney(peak.value, currency)}</b>
      </p>
    </div>
  );
}

/**
 * A small "i" beside a number that says what the number is and where it comes
 * from. Opens on hover, and on tap (focus) so it works on a phone too.
 */
function Info({ children }: { children: React.ReactNode }) {
  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label="What is this number?"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[9px] font-bold normal-case text-gray-400 hover:border-[#6f4423] hover:text-[#6f4423] focus:border-[#6f4423] focus:text-[#6f4423] focus:outline-none"
      >
        i
      </button>
      <span
        role="tooltip"
        className="invisible absolute left-0 top-6 z-30 w-72 max-w-[80vw] space-y-1.5 rounded-lg border border-[#e7e2dc] bg-white p-3 text-left text-[11px] font-normal normal-case leading-relaxed tracking-normal text-gray-600 opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

function Panel({
  title,
  subtitle,
  info,
  children,
  comparable,
  products,
}: {
  title: string;
  subtitle?: string;
  info?: React.ReactNode;
  /** A function gets the compared range's data (or null) to show beside the current figures. */
  children: React.ReactNode | ((cmp: Resp | null) => React.ReactNode);
  comparable?: boolean;
  /** Products this box lists, so Compare can find the same products in the other range. */
  products?: string[];
}) {
  const [range, setRange] = useState<Range | null>(null);
  const cmp = useCompare(comparable ? range : null, products);
  const { base } = useContext(CompareCtx);
  const headings = useMemo(
    () => ({ base: base ? fmtRange(base) : "All time", compared: range ? fmtRange(range) : "" }),
    [base, range]
  );
  return (
    <CompareTableCtx.Provider value={headings}>
    <section className="rounded-xl border border-[#e7e2dc] bg-white p-4 shadow-[0_1px_2px_rgba(16,12,8,0.04)]">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-bold tracking-tight text-gray-900">
          {title}
          {info && <Info>{info}</Info>}
        </h2>
        <div className="flex min-w-0 items-baseline gap-2">
          {subtitle && <p className="min-w-0 truncate text-[11px] text-gray-400">{subtitle}</p>}
          {comparable && <CompareButton range={range} onChange={setRange} />}
        </div>
      </header>
      {comparable && range && (
        <p className="-mt-1 mb-2 text-[11px] text-gray-400">
          {cmp.loading ? (
            `Loading ${fmtRange(range)}…`
          ) : cmp.error ? (
            <span className="text-rose-600">{cmp.error}</span>
          ) : (
            <>
              <b className="text-gray-600">{headings.base}</b> against <b className="text-gray-600">{fmtRange(range)}</b>,
              same filters. Each cell is sales, with orders and pieces under it.
            </>
          )}
        </p>
      )}
      {typeof children === "function" ? children(range ? cmp.data : null) : children}
    </section>
    </CompareTableCtx.Provider>
  );
}

/** "120 pcs" — pieces sold. */
function piecesLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${fmtNum(n)} pcs`;
}

/** "40 items" — different products. */
function itemsLabel(n: number | null | undefined): string {
  if (n == null) return "";
  return ` · ${fmtNum(n)} ${n === 1 ? "item" : "items"}`;
}

/** "73 orders", or a dash while order numbers are not stored yet. */
function ordersLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${fmtNum(n)} ${n === 1 ? "order" : "orders"}`;
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
  const countOf = (r: Slice) => ordersLabel(r.orders);
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
            title={`${r.label} — ${fmtMoney(r.value, currency)} from ${countOf(r)}, ${piecesLabel(r.units)}${itemsLabel(r.items)}`}
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
              <span className="shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-gray-400">
                {countOf(r)} · {piecesLabel(r.units)}
                {itemsLabel(r.items)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** One figure set for a row of the compare table. */
interface Figures {
  value: number;
  orders?: number | null;
  units: number;
}
interface CompareRow {
  label: string;
  sub?: string;
  now: Figures | null;
  was: Figures | null;
}

/** Rows of two lists side by side, matched by name; rows only in the old one come last. */
function pairRows<T extends Figures>(
  now: T[],
  was: T[],
  label: (r: T) => string,
  sub?: (r: T) => string | undefined
): CompareRow[] {
  const key = (r: T) => label(r).trim().toLowerCase();
  const wasBy = new Map(was.map((r) => [key(r), r]));
  const seen = new Set<string>();
  const out: CompareRow[] = now.map((r) => {
    seen.add(key(r));
    return { label: label(r), sub: sub?.(r), now: r, was: wasBy.get(key(r)) ?? null };
  });
  for (const r of was) if (!seen.has(key(r))) out.push({ label: label(r), sub: sub?.(r), now: null, was: r });
  return out;
}

/** The listed products only, each beside the same product on the compared dates. */
function pairProducts(now: Product[], was: Product[]): CompareRow[] {
  const key = (n: string) => n.trim().toLowerCase();
  const by = new Map(was.map((p) => [key(p.name), p]));
  return now.map((p) => ({ label: p.name, sub: p.subcategory, now: p, was: by.get(key(p.name)) ?? null }));
}

/** Days (or months) matched by position: 1st beside 1st, so ranges of any dates line up. */
function pairByPosition(now: Point[], was: Point[]): CompareRow[] {
  const n = Math.max(now.length, was.length);
  const name = (l: string) => (l.length === 10 ? fmtRange({ from: l, to: l }) : monthLabel(l, true));
  return Array.from({ length: n }, (_, i) => ({
    label: now[i] ? name(now[i].label) : `#${i + 1}`,
    sub: was[i] ? `vs ${name(was[i].label)}` : undefined,
    now: now[i] ?? null,
    was: was[i] ?? null,
  }));
}

/**
 * The compare view of a box: one row per item, the picked dates beside the
 * compared dates, and the change. Each cell is sales, with orders and pieces
 * under it.
 */
function CompareTable({
  rows,
  currency,
  total = true,
  nameHeader = "Name",
}: {
  rows: CompareRow[];
  currency: string;
  /** A Total row. Off where the rows overlap (one order holds two products). */
  total?: boolean;
  nameHeader?: string;
}) {
  const { base, compared } = useContext(CompareTableCtx);
  if (!rows.length) return <p className="py-6 text-center text-xs text-gray-400">Nothing in this selection.</p>;
  const sum = (pick: (r: CompareRow) => Figures | null) => {
    const list = rows.map(pick).filter(Boolean) as Figures[];
    return {
      value: list.reduce((a, f) => a + f.value, 0),
      units: list.reduce((a, f) => a + f.units, 0),
      orders: null,
    };
  };
  const cell = (f: Figures | null) =>
    f ? (
      <>
        <div className="font-semibold text-gray-900">{fmtMoney(f.value, currency)}</div>
        <div className="text-[10px] text-gray-400">
          {f.orders != null ? `${fmtNum(f.orders)} ord · ` : ""}
          {fmtNum(f.units)} pcs
        </div>
      </>
    ) : (
      <span className="text-gray-300">—</span>
    );
  const pcsChange = (r: CompareRow) =>
    r.now && r.was && r.was.units ? (
      <div className="text-[10px] text-gray-400">
        pcs <Change now={r.now.units} was={r.was.units} />
      </div>
    ) : null;
  const th = "border-b border-[#f0ece7] px-1.5 py-1.5 font-semibold";
  const td = "px-1.5 py-1.5 align-top tabular-nums";
  return (
    <div className="max-h-[340px] overflow-auto">
      <table className="w-full min-w-[420px] border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-white">
          <tr className="text-[10px] uppercase tracking-wider text-gray-400">
            <th className={th}>{nameHeader}</th>
            <th className={`${th} text-right`}>{base}</th>
            <th className={`${th} text-right`}>{compared}</th>
            <th className={`${th} text-right`}>Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-[#f7f5f2] last:border-0 hover:bg-[#faf7f3]">
              <td className={`${td} max-w-[180px]`}>
                <div className="truncate text-gray-800" title={r.label}>
                  {r.label}
                </div>
                {r.sub && <div className="truncate text-[10px] text-gray-400">{r.sub}</div>}
              </td>
              <td className={`${td} text-right`}>{cell(r.now)}</td>
              <td className={`${td} text-right`}>{cell(r.was)}</td>
              <td className={`${td} text-right`}>
                <Change now={r.now?.value ?? 0} was={r.was?.value ?? 0} />
                {!r.now && r.was && <span className="text-[10px] text-rose-600">no sales</span>}
                {pcsChange(r)}
              </td>
            </tr>
          ))}
        </tbody>
        {total && rows.length > 1 && (
          <tfoot>
            {(() => {
              const n = sum((r) => r.now);
              const w = sum((r) => r.was);
              return (
                <tr className="border-t border-[#e7e2dc] bg-[#faf7f3] font-semibold">
                  <td className={`${td} text-gray-800`}>Total</td>
                  <td className={`${td} text-right`}>{cell(n)}</td>
                  <td className={`${td} text-right`}>{cell(w)}</td>
                  <td className={`${td} text-right`}>
                    <Change now={n.value} was={w.value} />
                  </td>
                </tr>
              );
            })()}
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Column headings for the compare table: the picked dates and the compared ones. */
const CompareTableCtx = createContext<{ base: string; compared: string }>({ base: "Now", compared: "Then" });

/** Price bands are ordered, so here the ordinal ramp is the right encoding. */
function BandBars({ bands, currency }: { bands: Band[]; currency: string }) {
  // Bar length follows orders; before order numbers are stored, sales value.
  const hasOrders = bands.some((b) => b.orders != null);
  const size = (b: Band) => Math.abs(hasOrders ? (b.orders ?? 0) : b.value);
  const max = Math.max(1, ...bands.map(size));
  return (
    <div className="space-y-0.5">
      {bands.map((b, i) => (
        <div
          key={b.label}
          title={`${b.label} — ${ordersLabel(b.orders)}, ${piecesLabel(b.units)}, ${fmtMoney(b.value, currency)}`}
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
                  width: `${Math.max(1.5, (size(b) / max) * 100)}%`,
                  backgroundColor: BAND_RAMP[Math.min(i, BAND_RAMP.length - 1)],
                }}
              />
            </div>
            <span className="shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-gray-400">
              {ordersLabel(b.orders)} · {piecesLabel(b.units)}
              {itemsLabel(b.items)}
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
        <col className={trailing ? "w-[32%]" : "w-[46%]"} />
        <col className="w-[12%]" />
        <col className="w-[12%]" />
        <col className="w-[24%]" />
        {trailing && <col className="w-[14%]" />}
      </colgroup>
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-gray-400">
          <th className="border-b border-[#f0ece7] px-1.5 py-1.5 font-semibold">#</th>
          <th className="border-b border-[#f0ece7] px-1.5 py-1.5 font-semibold">Product</th>
          <th className="border-b border-[#f0ece7] px-1.5 py-1.5 text-right font-semibold">Orders</th>
          <th className="border-b border-[#f0ece7] px-1.5 py-1.5 text-right font-semibold">Pcs</th>
          <th className="border-b border-[#f0ece7] px-1.5 py-1.5 text-right font-semibold">Revenue</th>
          {trailing === "last" && (
            <th className="border-b border-[#f0ece7] px-1.5 py-1.5 text-right font-semibold">Last</th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => (
          <tr key={p.name} className="border-b border-[#f7f5f2] last:border-0 hover:bg-[#faf7f3]">
            <td className="px-1.5 py-1.5 tabular-nums text-gray-300">{i + 1}</td>
            <td className="px-1.5 py-1.5">
              <div className="truncate text-gray-800" title={p.name}>
                {p.name}
              </div>
              <div className="truncate text-[10px] text-gray-400">{p.subcategory}</div>
            </td>
            <td className="px-1.5 py-1.5 text-right tabular-nums text-gray-700">
              {p.orders == null ? "—" : fmtNum(p.orders)}
            </td>
            <td className="px-1.5 py-1.5 text-right tabular-nums text-gray-700">{fmtNum(p.units)}</td>
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
