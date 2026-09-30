"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState } from "@/components/ui";
import { fmtNum, fmtMoney } from "@/lib/format";

interface TypeRow {
  label: string;
  room: string;
  category: string;
  subcategory: string;
  products: number;
  stock: number;
  sold: number;
  value: number;
}
interface RoomRow {
  label: string;
  products: number;
  stock: number;
  sold: number;
  value: number;
}
interface ProductRow {
  product_id: number;
  title: string;
  label: string;
  room: string;
  stock: number;
  variants: number;
  price: number;
  sold: number;
}
interface Resp {
  ok: boolean;
  error?: string;
  window: { from: string; to: string; days: number };
  totals: { products: number; stock: number; value: number; sold: number; outOfStock: number };
  rooms: RoomRow[];
  types: TypeRow[];
  products: ProductRow[];
  options: { rooms: string[] };
}

const ROOM_COLOR: Record<string, string> = {
  Bedroom: "#2a78d6",
  "Living Room": "#eb6834",
  Bathroom: "#1baf7a",
  Other: "#9a948c",
};
const roomHue = (r: string) => ROOM_COLOR[r] ?? ROOM_COLOR.Other;

/** Shortcuts for the sold window; the date inputs cover anything else. */
const PRESETS: { label: string; from: () => string; to: () => string }[] = [
  { label: "Today", from: todayStr, to: todayStr },
  { label: "Yesterday", from: () => daysAgoStr(1), to: () => daysAgoStr(1) },
  { label: "7 days", from: () => daysAgoStr(6), to: todayStr },
  { label: "30 days", from: () => daysAgoStr(29), to: todayStr },
  { label: "90 days", from: () => daysAgoStr(89), to: todayStr },
];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function StockPage() {
  // The window applies to the SOLD side only — stock is a snapshot and has no
  // period to it.
  const [from, setFrom] = useState(daysAgoStr(29));
  const [to, setTo] = useState(todayStr());
  const [room, setRoom] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ from, to });
    if (room) p.set("room", room);
    return p.toString();
  }, [from, to, room]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/stock?${query}`)
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
        else setError(j.error || "Failed to load stock");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  const currency = "EGP";
  const maxStock = Math.max(1, ...(data?.types ?? []).map((t) => t.stock));

  return (
    <div>
      <PageHeader
        title="Stock"
        description="What the website is holding, by type, against what it has been selling."
      />

      <div className="mb-4 rounded-xl border border-[#e7e2dc] bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">Sold</span>
          <div className="inline-flex overflow-hidden rounded-lg border border-[#ddd6cd] text-xs font-medium">
            {PRESETS.map((preset) => {
              const f = preset.from();
              const t = preset.to();
              const active = f === from && t === to;
              return (
                <button
                  key={preset.label}
                  onClick={() => {
                    setFrom(f);
                    setTo(t);
                  }}
                  className={`px-3 py-1.5 ${
                    active ? "bg-[#6f4423] text-white" : "bg-white text-gray-600 hover:bg-[#faf7f3]"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-[#ddd6cd] px-2 py-1.5"
            />
            <span className="text-gray-400">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-[#ddd6cd] px-2 py-1.5"
            />
          </div>

          <select
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            className="rounded-lg border border-[#ddd6cd] bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700"
          >
            <option value="">All rooms</option>
            {(data?.options.rooms ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {room && (
            <button
              onClick={() => setRoom("")}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-[#6f4423] underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {!data || data.totals.products === 0 ? (
        <EmptyState
          loading={loading}
          label="No stock stored yet — run migration_v16.sql, then /api/sync-stock."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="In stock" value={fmtNum(data.totals.stock)} hint="pieces on the website" strong />
            <Stat label="Stock value" value={fmtMoney(data.totals.value, currency)} hint="at list price" />
            <Stat label="Sold" value={fmtNum(Math.round(data.totals.sold))} hint={`online · ${data.window.from} → ${data.window.to}`} />
            <Stat
              label="Out of stock"
              value={fmtNum(data.totals.outOfStock)}
              hint={`of ${fmtNum(data.totals.products)} products`}
            />
          </div>

          <section className="rounded-xl border border-[#e7e2dc] bg-white p-4 shadow-[0_1px_2px_rgba(16,12,8,0.04)]">
            <header className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[13px] font-bold tracking-tight text-gray-900">By room</h2>
              <p className="text-[11px] text-gray-400">pieces held</p>
            </header>
            <div className="space-y-1.5">
              {data.rooms.map((r) => (
                <button
                  key={r.label}
                  onClick={() => setRoom(r.label === room ? "" : r.label)}
                  className="block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[#faf7f3]"
                >
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="truncate font-medium text-gray-800">{r.label}</span>
                    <span className="shrink-0 tabular-nums text-gray-500">
                      {fmtNum(r.stock)} held · <b className="text-gray-900">{fmtNum(Math.round(r.sold))} sold</b>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#f2eee9]">
                    <div
                      className="h-full rounded-r-[4px]"
                      style={{
                        width: `${Math.max(1.5, (r.stock / Math.max(1, ...data.rooms.map((x) => x.stock))) * 100)}%`,
                        backgroundColor: roomHue(r.label),
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#e7e2dc] bg-white">
            <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-bold text-gray-900">By type</h2>
              <p className="text-[11px] text-gray-400">
stock now · sold in the last {data.window.days} days
              </p>
            </div>
            <table className="w-full table-fixed border-collapse text-left text-xs">
              <colgroup>
                <col className="w-[38%]" />
                <col className="w-[11%]" />
                <col className="w-[16%]" />
                <col className="w-[16%]" />
                <col className="w-[19%]" />
              </colgroup>
              <thead className="bg-gray-50">
                <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="border-b border-gray-200 px-3 py-2 font-semibold">Type</th>
                  <th className="border-b border-gray-200 px-2 py-2 text-right font-semibold">Products</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">In stock</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">Sold</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">Stock value</th>
                </tr>
              </thead>
              <tbody>
                {data.types.map((t) => (
                  <tr key={t.label} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="truncate px-3 py-2" title={t.label}>
                      <span
                        className="mr-2 inline-block h-2 w-2 shrink-0 rounded-sm align-middle"
                        style={{ backgroundColor: roomHue(t.room) }}
                      />
                      <span className="text-gray-800">{t.subcategory}</span>
                      <span className="ml-1.5 text-[10px] text-gray-400">{t.category}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-500">{fmtNum(t.products)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">
                      {fmtNum(t.stock)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {t.sold ? fmtNum(Math.round(t.sold)) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="truncate px-3 py-2 text-right tabular-nums text-gray-600">
                      {fmtMoney(t.value, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#e7e2dc] bg-white">
            <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-bold text-gray-900">Products</h2>
              <p className="text-[11px] text-gray-400">{fmtNum(data.products.length)} live on the website</p>
            </div>
            <div className="max-h-[460px] overflow-y-auto">
              <table className="w-full table-fixed border-collapse text-left text-xs">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[22%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Product</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Type</th>
                    <th className="border-b border-gray-200 px-2 py-2 text-right font-semibold">Price</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">Sold</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">In stock</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.map((p) => (
                    <tr key={p.product_id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="truncate px-3 py-1.5 text-gray-800" title={p.title}>
                        {p.title}
                        {p.variants > 1 && (
                          <span className="ml-1.5 text-[10px] text-gray-400">{p.variants} variants</span>
                        )}
                      </td>
                      <td className="truncate px-3 py-1.5 text-gray-500" title={p.label}>
                        {p.label}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                        {p.price ? fmtNum(Math.round(p.price)) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                        {p.sold ? fmtNum(Math.round(p.sold)) : <span className="text-gray-300">—</span>}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums ${
                          p.stock <= 0 ? "font-semibold text-rose-600" : "font-semibold text-gray-900"
                        }`}
                      >
                        {p.stock <= 0 ? "out" : fmtNum(p.stock)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="px-1 text-[11px] leading-relaxed text-gray-400">
            Stock is what the website holds right now, taken from the live Shopify products — a snapshot, not a
            history, so it does not move with the period above. Sold counts online sales over that period, so the two
            together read as &ldquo;what I have, and how fast it goes&rdquo;. Drafts are excluded: the store carries thousands of them from the
            fabric catalogue.
            {loading && <span className="ml-1">· Refreshing…</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${strong ? "border-[#d8c3aa] bg-[#fdfbf8]" : "border-[#e7e2dc]"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="mt-1.5 text-xl font-bold tabular-nums text-gray-900 sm:text-2xl">{value}</div>
      {hint && <div className="mt-1 truncate text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}
