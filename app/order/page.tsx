"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { fmtMoney } from "@/lib/format";

interface CartItem {
  title: string;
  variant_title: string | null;
  quantity: number;
  price: number;
  variant_id: number | null;
}
interface Cart {
  checkout_number: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
  items: CartItem[];
}

interface Result {
  name: string;
  total_price: number;
  invoice_url: string;
  admin_url: string;
}

const STORAGE_KEY = "order_cart";

export default function OrderPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [discountCode, setDiscountCode] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const c = JSON.parse(raw) as Cart;
        setCart(c);
        setItems(c.items.map((i) => ({ ...i })));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const currency = cart?.currency || "EGP";
  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.quantity, 0), [items]);
  const pct = Math.min(Math.max(discountPct || 0, 0), 100);
  const discountAmount = (subtotal * pct) / 100;
  const afterTotal = subtotal - discountAmount;

  const setQty = (idx: number, q: number) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, quantity: Math.max(1, q || 1) } : it)));

  const removeItem = (idx: number) => setItems((arr) => arr.filter((_, i) => i !== idx));

  const createOrder = async () => {
    setCreating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems: items.map((i) => ({
            variant_id: i.variant_id,
            title: i.title,
            price: i.price,
            quantity: i.quantity,
          })),
          email: cart?.email,
          discountCode,
          discountPct: pct,
          note: `Call-center order · cart ${cart?.checkout_number ?? ""}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create order");
      setResult(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (!cart) {
    return (
      <div>
        <PageHeader title="Create Order" description="Build a discounted order for a customer and send them an invoice." />
        <Card title="No cart selected">
          <EmptyState
            label="Open this from an abandoned cart — click the “Order” button on a cart in Abandoned Carts."
          />
          <div className="px-5 pb-5">
            <Link href="/abandoned" className="text-sm font-medium text-indigo-600 hover:underline">
              → Go to Abandoned Carts
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Create Order"
        description={`Recover cart ${cart.checkout_number} for ${cart.customer_name || cart.email || "customer"}.`}
      />

      <div className="mb-4">
        <Link href="/abandoned" className="text-sm text-indigo-600 hover:underline">← Back to Abandoned Carts</Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Items */}
        <Card className="lg:col-span-2" title="Items">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-5 py-2">Product</th>
                  <th className="px-5 py-2 text-right">Price</th>
                  <th className="px-5 py-2 text-center">Qty</th>
                  <th className="px-5 py-2 text-right">Line total</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="px-5 py-2.5">
                      {it.title}
                      {it.variant_title ? <span className="text-gray-400"> — {it.variant_title}</span> : ""}
                    </td>
                    <td className="px-5 py-2.5 text-right">{fmtMoney(it.price, currency)}</td>
                    <td className="px-5 py-2.5 text-center">
                      <input
                        type="number"
                        min={1}
                        value={it.quantity}
                        onChange={(e) => setQty(idx, Number(e.target.value))}
                        className="w-16 rounded-md border border-gray-300 px-2 py-1 text-center text-sm"
                      />
                    </td>
                    <td className="px-5 py-2.5 text-right font-medium">{fmtMoney(it.price * it.quantity, currency)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button onClick={() => removeItem(idx)} className="text-xs text-rose-600 hover:underline">remove</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No items.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Discount + totals */}
        <Card title="Discount & Total">
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Discount code</label>
              <input
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value)}
                placeholder="e.g. WELCOME10"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Discount percentage (%)</label>
              <input
                type="number"
                min={0}
                max={100}
                value={discountPct}
                onChange={(e) => setDiscountPct(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-2 rounded-lg bg-gray-50 p-4 text-sm">
              <Line label="Before discount" value={fmtMoney(subtotal, currency)} />
              <Line
                label={`Discount${pct ? ` (${pct}%)` : ""}${discountCode ? ` · ${discountCode}` : ""}`}
                value={`− ${fmtMoney(discountAmount, currency)}`}
                tone="rose"
              />
              <div className="border-t border-gray-200 pt-2">
                <Line label="After discount" value={fmtMoney(afterTotal, currency)} bold />
              </div>
            </div>

            <button
              onClick={createOrder}
              disabled={creating || items.length === 0}
              className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create order in Shopify"}
            </button>

            {error && <p className="text-xs text-rose-600">{error}</p>}

            {result && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <div className="font-semibold text-emerald-800">Draft order {result.name} created ✓</div>
                <div className="mt-1 text-emerald-700">Total: {fmtMoney(result.total_price, currency)}</div>
                <div className="mt-2 flex flex-col gap-1">
                  <a href={result.invoice_url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 hover:underline">
                    → Send invoice link to customer ↗
                  </a>
                  <a href={result.admin_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">
                    Open in Shopify admin ↗
                  </a>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Line({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "rose" }) {
  return (
    <div className="flex items-center justify-between">
      <span className={tone === "rose" ? "text-rose-600" : "text-gray-500"}>{label}</span>
      <span className={`${bold ? "text-lg font-bold text-gray-900" : "font-medium text-gray-800"} ${tone === "rose" ? "text-rose-600" : ""}`}>
        {value}
      </span>
    </div>
  );
}
