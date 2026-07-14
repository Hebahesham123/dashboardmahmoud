"use client";

import { useEffect, useMemo, useState } from "react";
import { useDash } from "@/components/DataProvider";
import { Card, PageHeader, Badge, EmptyState, MetricCard } from "@/components/ui";
import { fmtMoney, fmtNum } from "@/lib/format";

interface OfflineLine {
  product_name: string;
  attribute_name: string;
  qty: number;
  price_total: number;
  category: string;
}
interface OfflineInvoice {
  invoice_number: string;
  invoice_date: string;
  customer_name: string;
  branch: string;
  salesperson: string;
  amount: number;
  items: number;
  lines: OfflineLine[];
}

export default function OfflinePage() {
  const { range, rangeLabel } = useDash();
  const { start, end } = range;
  const [invoices, setInvoices] = useState<OfflineInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeOnline, setIncludeOnline] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const url = `/api/offline-invoices?from=${start}&to=${end}${includeOnline ? "&includeOnline=1" : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.ok) setInvoices(j.invoices ?? []);
        else setError(j.error || "Failed to load offline invoices");
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [start, end, includeOnline]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return invoices;
    return invoices.filter(
      (i) =>
        i.invoice_number.toLowerCase().includes(s) ||
        i.customer_name.toLowerCase().includes(s) ||
        i.branch.toLowerCase().includes(s)
    );
  }, [invoices, q]);

  const totalAmount = filtered.reduce((s, i) => s + i.amount, 0);
  const totalItems = filtered.reduce((s, i) => s + i.items, 0);

  return (
    <div>
      <PageHeader
        title="Offline Invoices (Odoo)"
        description={`استهلاكي invoices for ${rangeLabel} — synced from the NS Home endpoint.`}
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Invoices" value={fmtNum(filtered.length)} accent="violet" icon="🧾" formula={`استهلاكي invoices in ${rangeLabel}`} />
        <MetricCard label="Total Amount" value={fmtMoney(totalAmount)} accent="emerald" icon="💰" formula="Σ price_total across shown invoices" />
        <MetricCard label="Items" value={fmtNum(totalItems)} accent="sky" icon="📦" formula="Σ quantity across shown invoices" />
      </div>

      <Card
        title="Invoice Details"
        subtitle={includeOnline ? "Including online (shopify) branch" : "Physical branches only (online excluded)"}
        action={
          <div className="flex items-center gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search #, customer, branch…"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs"
            />
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={includeOnline}
                onChange={(e) => setIncludeOnline(e.target.checked)}
              />
              Include online
            </label>
          </div>
        }
      >
        {error && <div className="px-5 py-3 text-sm text-rose-600">{error}</div>}
        {filtered.length === 0 ? (
          <EmptyState loading={loading} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">Invoice #</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Customer</th>
                  <th className="px-4 py-2.5">Branch</th>
                  <th className="px-4 py-2.5 text-right">Items</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const isOpen = !!open[inv.invoice_number];
                  return (
                    <FragmentRow
                      key={inv.invoice_number}
                      inv={inv}
                      isOpen={isOpen}
                      onToggle={() =>
                        setOpen((o) => ({ ...o, [inv.invoice_number]: !o[inv.invoice_number] }))
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function FragmentRow({
  inv,
  isOpen,
  onToggle,
}: {
  inv: OfflineInvoice;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer border-t hover:bg-gray-50" onClick={onToggle}>
        <td className="px-4 py-3 font-medium">
          <span className="mr-1.5 inline-block text-gray-400">{isOpen ? "▾" : "▸"}</span>
          {inv.invoice_number}
        </td>
        <td className="px-4 py-3 text-gray-600">{inv.invoice_date}</td>
        <td className="px-4 py-3">{inv.customer_name}</td>
        <td className="px-4 py-3">
          <Badge color={inv.branch.toLowerCase() === "shopify" ? "sky" : "violet"}>{inv.branch}</Badge>
        </td>
        <td className="px-4 py-3 text-right">{fmtNum(inv.items)}</td>
        <td className="px-4 py-3 text-right font-semibold">{fmtMoney(inv.amount)}</td>
      </tr>
      {isOpen && (
        <tr className="bg-gray-50/60">
          <td colSpan={6} className="px-4 py-3">
            <table className="w-full text-xs">
              <thead className="text-left uppercase text-gray-400">
                <tr>
                  <th className="px-3 py-1.5">Product</th>
                  <th className="px-3 py-1.5">Variant</th>
                  <th className="px-3 py-1.5">Category</th>
                  <th className="px-3 py-1.5 text-right">Qty</th>
                  <th className="px-3 py-1.5 text-right">Price</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i} className="border-t border-gray-200">
                    <td className="px-3 py-1.5">{l.product_name}</td>
                    <td className="px-3 py-1.5 text-gray-500">{l.attribute_name || "—"}</td>
                    <td className="px-3 py-1.5 text-gray-500">{l.category}</td>
                    <td className="px-3 py-1.5 text-right">{fmtNum(l.qty)}</td>
                    <td className="px-3 py-1.5 text-right">{fmtMoney(l.price_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inv.salesperson && (
              <p className="mt-2 text-xs text-gray-400">Salesperson: {inv.salesperson}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
