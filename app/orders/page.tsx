"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, EmptyState, Badge } from "@/components/ui";
import { fmtNum, fmtMoney } from "@/lib/format";

interface OrderRow {
  id: number;
  order_number: string | null;
  order_date: string;
  created_at: string;
  customer_name: string | null;
  customer_email: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  items: number;
  total_price: number;
  total_discounts: number;
  net_sales: number;
  currency: string | null;
  cancelled: boolean;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  zip: string | null;
  discount_codes: string[];
  cashback: boolean;
}
interface Resp {
  ok: boolean;
  error?: string;
  from: string;
  to: string;
  count: number;
  truncated: boolean;
  orders: OrderRow[];
}

const CASHBACK_SHAPE = /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/i;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Declared once so the table and the export can never drift apart. */
const COLUMNS: { label: string; get: (o: OrderRow) => string | number }[] = [
  { label: "Order", get: (o) => o.order_number ?? String(o.id) },
  { label: "Date", get: (o) => o.order_date },
  { label: "Time", get: (o) => o.created_at.slice(11, 16) },
  { label: "Customer", get: (o) => o.customer_name ?? "" },
  { label: "Email", get: (o) => o.customer_email ?? "" },
  { label: "Phone", get: (o) => o.phone ?? "" },
  { label: "Address", get: (o) => [o.address1, o.address2].filter(Boolean).join(" ") },
  { label: "City", get: (o) => o.city ?? "" },
  { label: "Province", get: (o) => o.province ?? "" },
  { label: "Country", get: (o) => o.country ?? "" },
  { label: "Zip", get: (o) => o.zip ?? "" },
  { label: "Payment", get: (o) => o.financial_status ?? "" },
  { label: "Fulfilment", get: (o) => o.fulfillment_status ?? "unfulfilled" },
  { label: "Items", get: (o) => o.items },
  { label: "Discount", get: (o) => o.total_discounts },
  { label: "Total", get: (o) => o.total_price },
  { label: "Net", get: (o) => o.net_sales },
  { label: "Currency", get: (o) => o.currency ?? "" },
  { label: "Codes", get: (o) => o.discount_codes.join(" ") },
  { label: "Cashback", get: (o) => (o.cashback ? "yes" : "") },
  { label: "Cancelled", get: (o) => (o.cancelled ? "yes" : "") },
];

export default function OrdersPage() {
  const [mode, setMode] = useState<"day" | "range">("range");
  const [day, setDay] = useState(todayStr());
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(todayStr());
  const [search, setSearch] = useState("");
  const [onlyCashback, setOnlyCashback] = useState(false);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useMemo(
    () => (mode === "day" ? `day=${day}` : `from=${from}&to=${to}`),
    [mode, day, from, to]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/orders?${query}&limit=5000`)
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
        else setError(j.error || "Failed to load orders");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query]);

  // Search and the cashback toggle filter in the browser: the rows are already
  // here, so there is no reason to round-trip for them.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.orders ?? []).filter((o) => {
      if (onlyCashback && !o.cashback) return false;
      if (!q) return true;
      return [o.order_number, o.customer_name, o.customer_email, o.phone, o.address1, o.city, o.province, ...o.discount_codes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [data, search, onlyCashback]);

  const shown = useMemo(
    () => ({
      orders: rows.length,
      items: rows.reduce((s, r) => s + r.items, 0),
      total: rows.reduce((s, r) => s + r.total_price, 0),
      net: rows.reduce((s, r) => s + r.net_sales, 0),
    }),
    [rows]
  );

  const currency = data?.orders[0]?.currency ?? "EGP";
  const label = mode === "day" ? day : `${from}_${to}`;

  async function exportRows(kind: "csv" | "xlsx") {
    if (!rows.length) return;
    setBusy(true);
    try {
      const header = COLUMNS.map((c) => c.label);
      const body = rows.map((o) => COLUMNS.map((c) => c.get(o)));
      if (kind === "csv") {
        const esc = (v: string | number) => {
          const s = String(v ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        // BOM so Excel reads the Arabic customer names in the right encoding.
        const csv = "﻿" + [header, ...body].map((r) => r.map(esc).join(",")).join("\r\n");
        download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `orders_${label}.csv`);
      } else {
        const XLSX = await import("xlsx");
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...body]), "Orders");
        const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
        download(
          new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          `orders_${label}.xlsx`
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Every Shopify order for a day or a range — with the delivery address. Search it, filter it, export it."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
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
            <button
              onClick={() => setDay(daysAgo(1))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Yesterday
            </button>
            <button
              onClick={() => setDay(todayStr())}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Today
            </button>
          </>
        ) : (
          <>
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
            {[7, 30, 90].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setFrom(daysAgo(n));
                  setTo(todayStr());
                }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                {n}d
              </button>
            ))}
          </>
        )}

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order, customer, code…"
          className="min-w-[180px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
          <input type="checkbox" checked={onlyCashback} onChange={(e) => setOnlyCashback(e.target.checked)} />
          Cashback only
        </label>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => exportRows("csv")}
            disabled={busy || rows.length === 0}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Export CSV
          </button>
          <button
            onClick={() => exportRows("xlsx")}
            disabled={busy || rows.length === 0}
            className="rounded-lg bg-[#6f4423] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#5c3a1e] disabled:opacity-40"
          >
            Export Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      )}

      {data && (
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
          <span>
            <b className="text-gray-900">{fmtNum(shown.orders)}</b> orders
          </span>
          <span>
            <b className="text-gray-900">{fmtNum(shown.items)}</b> items
          </span>
          <span>
            Total <b className="text-gray-900">{fmtMoney(shown.total, currency)}</b>
          </span>
          <span>
            Net <b className="text-gray-900">{fmtMoney(shown.net, currency)}</b>
          </span>
          {rows.length !== data.count && (
            <span className="text-gray-400">· filtered from {fmtNum(data.count)}</span>
          )}
          {data.truncated && <span className="text-amber-600">· capped at 5,000 — narrow the range</span>}
        </div>
      )}

      {!data || rows.length === 0 ? (
        <EmptyState loading={loading} label="No orders for this selection." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[1100px] border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                {["Order", "Date", "Customer", "Address", "Payment", "Fulfilment", "Items", "Discount", "Total", "Codes"].map(
                  (h) => (
                    <th key={h} className="whitespace-nowrap border-b border-gray-200 px-3 py-2 font-semibold">
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{o.order_number ?? o.id}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">
                    {o.order_date} <span className="text-gray-400">{o.created_at.slice(11, 16)}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-800">{o.customer_name ?? "—"}</div>
                    {o.phone && <div className="text-[11px] text-gray-500">{o.phone}</div>}
                    {o.customer_email && <div className="text-[11px] text-gray-400">{o.customer_email}</div>}
                  </td>
                  <td className="max-w-[240px] px-3 py-2 align-top">
                    <div className="truncate text-gray-800" title={[o.address1, o.address2].filter(Boolean).join(" ")}>
                      {o.address1 ?? "—"}
                    </div>
                    <div className="text-[11px] text-gray-400">
                      {[o.city, o.province].filter(Boolean).join(", ") || (o.country ?? "")}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Badge
                      color={
                        o.financial_status === "paid"
                          ? "emerald"
                          : o.financial_status === "refunded"
                            ? "rose"
                            : "amber"
                      }
                    >
                      {o.financial_status ?? "—"}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Badge color={o.fulfillment_status === "fulfilled" ? "emerald" : "gray"}>
                      {o.fulfillment_status ?? "unfulfilled"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{fmtNum(o.items)}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-500">
                    {o.total_discounts ? fmtMoney(o.total_discounts, o.currency ?? currency) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums font-semibold text-gray-900">
                    {fmtMoney(o.total_price, o.currency ?? currency)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {o.cashback && <Badge color="indigo">cashback</Badge>}
                      {o.cancelled && <Badge color="rose">cancelled</Badge>}
                      {o.discount_codes
                        .filter((c) => !CASHBACK_SHAPE.test(c))
                        .map((c) => (
                          <Badge key={c}>{c}</Badge>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
