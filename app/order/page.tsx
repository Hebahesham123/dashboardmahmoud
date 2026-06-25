"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase";
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
  id?: number; // abandoned checkout id (to mark recovered)
  checkout_number: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
  items: CartItem[];
}
interface ProductVariant { id: number; title: string; price: number; available: boolean }
interface Product { id: number; title: string; image: string | null; variants: ProductVariant[] }

interface Result { name: string; total_price: number; invoice_url: string; admin_url: string }
interface CreatedOrder {
  id: number;
  name: string;
  created_at: string;
  total_price: number;
  status: string;
  customer_name: string | null;
  email: string | null;
  invoice_url: string | null;
  admin_url: string;
}

const STORAGE_KEY = "order_cart";

export default function OrderPage() {
  const supabase = useMemo(() => createBrowserClient(), []);
  const [cart, setCart] = useState<Cart | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [discountCode, setDiscountCode] = useState("");
  const [discountType, setDiscountType] = useState<"percentage" | "fixed_amount">("percentage");
  const [discountValue, setDiscountValue] = useState(0);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  // add-product-by-url
  const [url, setUrl] = useState("");
  const [looking, setLooking] = useState(false);
  const [pending, setPending] = useState<Product | null>(null);
  const [pendingVariant, setPendingVariant] = useState<number | null>(null);

  // created orders list
  const [created, setCreated] = useState<CreatedOrder[]>([]);
  const [loadingCreated, setLoadingCreated] = useState(true);

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

  const loadCreated = useCallback(async () => {
    setLoadingCreated(true);
    try {
      const res = await fetch("/api/order");
      const json = await res.json();
      if (res.ok) setCreated(json.orders ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoadingCreated(false);
    }
  }, []);

  useEffect(() => {
    loadCreated();
  }, [loadCreated]);

  const currency = cart?.currency || "EGP";
  const subtotal = useMemo(() => items.reduce((s, i) => s + i.price * i.quantity, 0), [items]);
  const val = Math.max(discountValue || 0, 0);
  const discountAmount =
    discountType === "percentage" ? (subtotal * Math.min(val, 100)) / 100 : Math.min(val, subtotal);
  const afterTotal = subtotal - discountAmount;
  const discountLabel =
    discountType === "percentage"
      ? `Discount${val ? ` (${Math.min(val, 100)}%)` : ""}`
      : `Discount${val ? ` (${fmtMoney(Math.min(val, subtotal), currency)})` : ""}`;

  const setQty = (idx: number, q: number) =>
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, quantity: Math.max(1, q || 1) } : it)));
  const removeItem = (idx: number) => setItems((arr) => arr.filter((_, i) => i !== idx));

  const lookUp = async () => {
    setLooking(true);
    setError(null);
    setPending(null);
    try {
      const res = await fetch(`/api/product?url=${encodeURIComponent(url)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Product not found");
      const p: Product = json.product;
      if (p.variants.length === 1) {
        addVariant(p, p.variants[0]);
        setUrl("");
      } else {
        setPending(p);
        setPendingVariant(p.variants[0]?.id ?? null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLooking(false);
    }
  };

  const addVariant = (p: Product, v: ProductVariant) => {
    setItems((arr) => [
      ...arr,
      {
        title: p.title,
        variant_title: v.title === "Default Title" ? null : v.title,
        quantity: 1,
        price: v.price,
        variant_id: v.id,
      },
    ]);
  };

  const confirmPending = () => {
    if (!pending) return;
    const v = pending.variants.find((x) => x.id === pendingVariant) ?? pending.variants[0];
    addVariant(pending, v);
    setPending(null);
    setUrl("");
  };

  const createOrder = async () => {
    setCreating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineItems: items.map((i) => ({ variant_id: i.variant_id, title: i.title, price: i.price, quantity: i.quantity })),
          email: cart?.email,
          discountCode,
          discountType,
          discountValue: val,
          note: `Call-center order · cart ${cart?.checkout_number ?? ""}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create order");
      setResult(json);

      // Mark the source cart as recovered so it drops off the Abandoned list.
      if (cart?.id) {
        await supabase.from("abandoned_followups").upsert(
          {
            checkout_id: String(cart.id),
            call_status: "recovered",
            note: `Order ${json.name} created (tag: checkout)`,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "checkout_id" }
        );
        sessionStorage.removeItem(STORAGE_KEY);
      }
      loadCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Create Order"
        description="Build a discounted order, add products by URL, and create it in Shopify (tagged “checkout”)."
      />

      <div className="mb-4">
        <Link href="/abandoned" className="text-sm text-indigo-600 hover:underline">← Back to Abandoned Carts</Link>
      </div>

      {cart ? (
        <div className="mb-8 grid gap-6 lg:grid-cols-3">
          {/* Items + add by URL */}
          <Card className="lg:col-span-2" title={`Items · cart ${cart.checkout_number}`} subtitle={cart.customer_name || cart.email || ""}>
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
                        <input type="number" min={1} value={it.quantity} onChange={(e) => setQty(idx, Number(e.target.value))} className="w-16 rounded-md border border-gray-300 px-2 py-1 text-center text-sm" />
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium">{fmtMoney(it.price * it.quantity, currency)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <button onClick={() => removeItem(idx)} className="text-xs text-rose-600 hover:underline">remove</button>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-400">No items — add one below.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* add product by URL */}
            <div className="border-t border-gray-100 p-4">
              <label className="mb-1 block text-xs font-medium text-gray-500">Add a product by URL</label>
              <div className="flex gap-2">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && url && lookUp()}
                  placeholder="Paste a product link, e.g. https://…/products/king-flat-sheet-set"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button onClick={lookUp} disabled={looking || !url.trim()} className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                  {looking ? "…" : "Add"}
                </button>
              </div>

              {pending && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                  <span className="font-medium">{pending.title}</span>
                  <select value={pendingVariant ?? ""} onChange={(e) => setPendingVariant(Number(e.target.value))} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
                    {pending.variants.map((v) => (
                      <option key={v.id} value={v.id}>{v.title} — {fmtMoney(v.price, currency)}{v.available ? "" : " (out of stock)"}</option>
                    ))}
                  </select>
                  <button onClick={confirmPending} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700">Add this variant</button>
                  <button onClick={() => setPending(null)} className="text-xs text-gray-500 hover:underline">cancel</button>
                </div>
              )}
            </div>
          </Card>

          {/* Discount + totals */}
          <Card title="Discount & Total">
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Discount code</label>
                <input value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} placeholder="e.g. WELCOME10" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Discount</label>
                <div className="flex gap-2">
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as "percentage" | "fixed_amount")}
                    className="rounded-lg border border-gray-300 px-2 py-2 text-sm"
                  >
                    <option value="percentage">Percentage %</option>
                    <option value="fixed_amount">Amount ({currency})</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={discountType === "percentage" ? 100 : undefined}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    placeholder={discountType === "percentage" ? "e.g. 10" : "e.g. 100"}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2 rounded-lg bg-gray-50 p-4 text-sm">
                <Line label="Before discount" value={fmtMoney(subtotal, currency)} />
                <Line label={`${discountLabel}${discountCode ? ` · ${discountCode}` : ""}`} value={`− ${fmtMoney(discountAmount, currency)}`} tone="rose" />
                <div className="border-t border-gray-200 pt-2">
                  <Line label="After discount" value={fmtMoney(afterTotal, currency)} bold />
                </div>
              </div>

              <button onClick={createOrder} disabled={creating || items.length === 0} className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {creating ? "Creating…" : "Create order in Shopify"}
              </button>

              {error && <p className="text-xs text-rose-600">{error}</p>}

              {result && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <div className="font-semibold text-emerald-800">Draft order {result.name} created ✓ (tag: checkout)</div>
                  <div className="mt-1 text-emerald-700">Total: {fmtMoney(result.total_price, currency)}</div>
                  <div className="mt-2 flex flex-col gap-1">
                    <a href={result.invoice_url} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-600 hover:underline">→ Send invoice link to customer ↗</a>
                    <a href={result.admin_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">Open in Shopify admin ↗</a>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <Card className="mb-8" title="No cart selected">
          <EmptyState label="Open this from an abandoned cart — click the “Order” button on a cart in Abandoned Carts." />
          <div className="px-5 pb-5">
            <Link href="/abandoned" className="text-sm font-medium text-indigo-600 hover:underline">→ Go to Abandoned Carts</Link>
          </div>
        </Card>
      )}

      {/* Created orders */}
      <Card
        title="Created Orders"
        subtitle="Draft orders created here (tagged “checkout”)"
        action={
          <button onClick={loadCreated} className="text-xs font-medium text-indigo-600 hover:underline">↻ Refresh</button>
        }
      >
        {created.length === 0 ? (
          <EmptyState loading={loadingCreated} label="No orders created yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-5 py-2">Order</th>
                  <th className="px-5 py-2">Customer</th>
                  <th className="px-5 py-2">Created</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2 text-right">Total</th>
                  <th className="px-5 py-2 text-right">Links</th>
                </tr>
              </thead>
              <tbody>
                {created.map((o) => (
                  <tr key={o.id} className="border-t hover:bg-gray-50">
                    <td className="px-5 py-2.5 font-medium">{o.name}</td>
                    <td className="px-5 py-2.5">{o.customer_name || o.email || "—"}</td>
                    <td className="px-5 py-2.5 text-gray-500">{new Date(o.created_at).toLocaleString()}</td>
                    <td className="px-5 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${o.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{o.status}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right">{fmtMoney(o.total_price)}</td>
                    <td className="px-5 py-2.5 text-right">
                      {o.invoice_url && <a href={o.invoice_url} target="_blank" rel="noopener noreferrer" className="mr-3 text-indigo-600 hover:underline">invoice ↗</a>}
                      <a href={o.admin_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">admin ↗</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Line({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "rose" }) {
  return (
    <div className="flex items-center justify-between">
      <span className={tone === "rose" ? "text-rose-600" : "text-gray-500"}>{label}</span>
      <span className={`${bold ? "text-lg font-bold text-gray-900" : "font-medium text-gray-800"} ${tone === "rose" ? "text-rose-600" : ""}`}>{value}</span>
    </div>
  );
}
