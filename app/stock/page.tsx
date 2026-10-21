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
  soldValue: number;
  returned: number;
  value: number;
}
interface RoomRow {
  label: string;
  products: number;
  stock: number;
  sold: number;
  soldValue: number;
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
  soldValue: number;
  returned: number;
  status: string;
}
interface Resp {
  ok: boolean;
  error?: string;
  window: { from: string; to: string; days: number };
  totals: {
    products: number;
    stock: number;
    value: number;
    sold: number;
    soldValue: number;
    returned: number;
    outOfStock: number;
    draftProducts: number;
    draftStock: number;
  };
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
            <Stat
              label="Sold"
              value={fmtNum(Math.round(data.totals.sold))}
              hint={`${fmtMoney(data.totals.soldValue, currency)} · ${data.window.from} → ${data.window.to}`}
            />
            <Stat
              label="Out of stock"
              value={fmtNum(data.totals.outOfStock)}
              hint={`of ${fmtNum(data.totals.products)} products${
                data.totals.draftProducts
                  ? ` · ${fmtNum(data.totals.draftProducts)} draft holding ${fmtNum(data.totals.draftStock)}`
                  : ""
              }`}
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
                <col className="w-[32%]" />
                <col className="w-[9%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="bg-gray-50">
                <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                  <th className="border-b border-gray-200 px-3 py-2 font-semibold">Type</th>
                  <th className="border-b border-gray-200 px-2 py-2 text-right font-semibold">Products</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">In stock</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">Sold</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">Sold value</th>
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
                      {t.returned > 0 && (
                        <span className="ml-1 text-[10px] text-rose-500" title="of which returned">
                          ({fmtNum(Math.round(t.returned))})
                        </span>
                      )}
                    </td>
                    <td className="truncate px-3 py-2 text-right tabular-nums text-gray-700">
                      {t.soldValue ? fmtMoney(t.soldValue, currency) : <span className="text-gray-300">—</span>}
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
              <div className="flex items-center gap-3">
                <p className="text-[11px] text-gray-400">{fmtNum(data.products.length)} live on the website</p>
                <ExportButton products={data.products} from={data.window.from} to={data.window.to} room={room} />
              </div>
            </div>
            <div className="max-h-[460px] overflow-y-auto">
              <table className="w-full table-fixed border-collapse text-left text-xs">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[20%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[16%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-[10px] uppercase tracking-wider text-gray-500">
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Product</th>
                    <th className="border-b border-gray-200 px-3 py-2 font-semibold">Type</th>
                    <th className="border-b border-gray-200 px-2 py-2 text-right font-semibold">Price</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">Sold</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">Sold value</th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right font-semibold">In stock</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.map((p) => (
                    <ProductRows
                      key={p.product_id}
                      p={p}
                      from={data.window.from}
                      to={data.window.to}
                      currency={currency}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="px-1 text-[11px] leading-relaxed text-gray-400">
            Stock is what the website holds right now, taken from the Shopify products — a snapshot, not a history, so
            it does not move with the period above. Draft products are counted too, marked as such: 54 retail products
            sit unpublished holding 537 pieces, and stock on an unpublished product is still stock. Sold counts online
            sales over the period and includes anything returned or refunded — the figure is what left the shelf, with
            the returned count beside it in red. Click a product to see its variants; their sold figures come from the
            Shopify orders (cancelled ones left out), so they can differ slightly from the product line.
            {loading && <span className="ml-1">· Refreshing…</span>}
          </p>
        </div>
      )}
    </div>
  );
}

interface VariantRow {
  variant_id: number;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  stock: number;
  sold: number;
  soldValue: number;
}

/** Excel drops leading zeros and turns long barcodes into 1.2E+12 unless told it is text. */
const csvText = (s: string | null | undefined) => (s ? `="${s.replace(/"/g, '""')}"` : "");
const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Every product in the table, each followed by its variants, as a CSV download. */
async function exportProducts(products: ProductRow[], from: string, to: string, room: string) {
  const ids = products.map((p) => p.product_id).join(",");
  const r = await fetch(`/api/stock/variants?${new URLSearchParams({ from, to, ids })}`);
  const j = (await r.json()) as { ok: boolean; error?: string; byProduct?: Record<string, VariantRow[]> };
  if (!j.ok) throw new Error(j.error || "Export failed");
  const byProduct = j.byProduct ?? {};

  const lines: string[] = [
    ["Product", "Variant", "Type", "Status", "SKU", "Barcode", "Price", "Sold", "Sold value", "In stock"].join(","),
  ];
  for (const p of products) {
    lines.push(
      [
        csvCell(p.title),
        "",
        csvCell(p.label),
        p.status,
        "",
        "",
        Math.round(p.price),
        Math.round(p.sold),
        p.soldValue.toFixed(2),
        p.stock,
      ].join(",")
    );
    for (const v of byProduct[String(p.product_id)] ?? []) {
      lines.push(
        [
          csvCell(p.title),
          csvCell(v.title === "Default Title" ? "" : v.title),
          csvCell(p.label),
          p.status,
          csvText(v.sku),
          csvText(v.barcode),
          Math.round(v.price),
          v.sold,
          v.soldValue.toFixed(2),
          v.stock,
        ].join(",")
      );
    }
  }

  // The BOM makes Excel read it as UTF-8.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `stock-${room ? room.replace(/\s+/g, "-").toLowerCase() + "-" : ""}${from}_to_${to}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function ExportButton({ products, from, to, room }: { products: ProductRow[]; from: string; to: string; room: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {err && <span className="text-[11px] text-rose-600">{err}</span>}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await exportProducts(products, from, to, room);
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-lg border border-[#ddd6cd] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6f4423] hover:bg-[#faf7f3] disabled:opacity-50"
      >
        {busy ? "Exporting…" : "Export CSV"}
      </button>
    </span>
  );
}

/** A product line that opens to show its variants, loaded the first time it is opened. */
function ProductRows({ p, from, to, currency }: { p: ProductRow; from: string; to: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [variants, setVariants] = useState<VariantRow[] | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  const [vLoading, setVLoading] = useState(false);
  const [vError, setVError] = useState<string | null>(null);
  const windowKey = `${from}|${to}`;

  useEffect(() => {
    if (!open || loadedFor === windowKey) return;
    let alive = true;
    setVLoading(true);
    setVError(null);
    fetch(`/api/stock/variants?${new URLSearchParams({ product_id: String(p.product_id), from, to })}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.ok) {
          setVariants(j.variants);
          setLoadedFor(windowKey);
        } else setVError(j.error || "Failed to load variants");
      })
      .catch((e) => alive && setVError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setVLoading(false));
    return () => {
      alive = false;
    };
  }, [open, windowKey, loadedFor, p.product_id, from, to]);

  return (
    <>
      <tr
        onClick={() => setOpen((o) => !o)}
        className={`cursor-pointer border-b border-gray-100 hover:bg-gray-50 ${open ? "bg-[#faf7f3]" : ""}`}
      >
                      <td className="truncate px-3 py-1.5 text-gray-800" title={p.title}>
                        <span
                          className={`mr-1.5 inline-block w-3 text-[9px] text-gray-400 transition-transform ${
                            open ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                        {p.title}
                        {p.status === "draft" && (
                          <span
                            className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700"
                            title="not published on the website"
                          >
                            draft
                          </span>
                        )}
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
                      <td className="truncate px-3 py-1.5 text-right tabular-nums text-gray-600">
                        {p.soldValue ? fmtMoney(p.soldValue, currency) : <span className="text-gray-300">—</span>}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums ${
                          p.stock <= 0 ? "font-semibold text-rose-600" : "font-semibold text-gray-900"
                        }`}
                      >
                        {p.stock <= 0 ? "out" : fmtNum(p.stock)}
                      </td>
      </tr>
      {open && (vLoading || vError || !variants) && (
        <tr className="border-b border-gray-100 bg-[#fdfbf8]">
          <td colSpan={6} className={`px-3 py-2 pl-9 text-[11px] ${vError ? "text-rose-600" : "text-gray-400"}`}>
            {vError ?? "Loading variants…"}
          </td>
        </tr>
      )}
      {open &&
        !vLoading &&
        !vError &&
        variants?.map((v) => (
          <tr key={v.variant_id} className="border-b border-gray-100 bg-[#fdfbf8] text-[11px]">
            <td className="truncate py-1.5 pl-9 pr-3 text-gray-700" title={v.title}>
              {v.title === "Default Title" ? "—" : v.title}
            </td>
            <td
              className="truncate px-3 py-1.5 tabular-nums text-gray-500"
              title={`SKU ${v.sku ?? "—"} · Barcode ${v.barcode ?? "—"}`}
            >
              <span className="text-gray-400">SKU</span> {v.sku ?? "—"}
              <span className="ml-2 text-gray-400">Barcode</span> {v.barcode ?? "—"}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
              {v.price ? fmtNum(Math.round(v.price)) : <span className="text-gray-300">—</span>}
            </td>
            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
              {v.sold ? fmtNum(v.sold) : <span className="text-gray-300">—</span>}
            </td>
            <td className="truncate px-3 py-1.5 text-right tabular-nums text-gray-600">
              {v.soldValue ? fmtMoney(v.soldValue, currency) : <span className="text-gray-300">—</span>}
            </td>
            <td
              className={`px-3 py-1.5 text-right tabular-nums ${
                v.stock <= 0 ? "font-medium text-rose-600" : "font-medium text-gray-800"
              }`}
            >
              {v.stock <= 0 ? "out" : fmtNum(v.stock)}
            </td>
          </tr>
        ))}
    </>
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
