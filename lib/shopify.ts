/**
 * Minimal Shopify Admin REST client + order normalizer.
 * Server-side only — uses SHOPIFY_ACCESS_TOKEN.
 */

// Read env lazily (inside functions) so the dotenv-based backfill, which loads
// env after import, still picks these up.
function shopifyConfig() {
  const store = process.env.SHOPIFY_STORE_DOMAIN!;
  const token = process.env.SHOPIFY_ACCESS_TOKEN!;
  const version = process.env.SHOPIFY_API_VERSION || "2024-10";
  return { token, base: `https://${store}/admin/api/${version}` };
}

export interface ShopifyLineItem {
  id: number;
  product_id: number | null;
  variant_id: number | null;
  title: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  price: string;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  order_number: number;
  created_at: string;
  processed_at: string | null;
  cancelled_at: string | null;
  source_name: string | null;
  financial_status: string | null;
  fulfillment_status: string | null;
  currency: string;
  total_price: string;
  current_total_price: string | null; // net total after refunds/edits
  subtotal_price: string;
  total_discounts: string;
  total_tax: string;
  email: string | null;
  customer: { first_name?: string; last_name?: string } | null;
  line_items: ShopifyLineItem[];
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // Link: <https://...page_info=xxx>; rel="next", <...>; rel="previous"
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetch orders updated since `updatedAtMin`, following pagination.
 * `onlyWeb` keeps only website orders (excludes POS, draft, etc.).
 */
export async function fetchOrders(opts: {
  updatedAtMin?: string | null;
  onlyWeb?: boolean;
}): Promise<ShopifyOrder[]> {
  const { updatedAtMin, onlyWeb = true } = opts;
  const { token, base } = shopifyConfig();

  const params = new URLSearchParams({
    status: "any",
    limit: "250",
    order: "updated_at asc",
  });
  if (updatedAtMin) params.set("updated_at_min", updatedAtMin);

  let url: string | null = `${base}/orders.json?${params.toString()}`;
  const all: ShopifyOrder[] = [];

  while (url) {
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (res.status === 429) {
      // rate limited — wait and retry the same url
      const retry = Number(res.headers.get("Retry-After") || "2");
      await new Promise((r) => setTimeout(r, retry * 1000));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify API ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as { orders: ShopifyOrder[] };
    all.push(...data.orders);

    url = parseNextLink(res.headers.get("link"));
    // be gentle with the REST leaky bucket
    if (url) await new Promise((r) => setTimeout(r, 300));
  }

  if (onlyWeb) {
    // website orders: source_name === 'web'. POS orders use 'pos'.
    return all.filter((o) => (o.source_name ?? "web") === "web");
  }
  return all;
}

/** Classify an order as online (website) or offline (POS / retail). */
export function channelOf(o: ShopifyOrder): "online" | "offline" {
  return o.source_name === "pos" ? "offline" : "online";
}

export interface DraftOrderInput {
  lineItems: { variant_id?: number | null; title?: string; price?: number; quantity: number }[];
  email?: string | null;
  phone?: string | null;
  discountCode?: string;
  discountPct?: number; // percentage 0..100
  note?: string;
}

/**
 * Create a Shopify Draft Order (used by the call center to recover an
 * abandoned cart with a discount). Returns the created draft order, which
 * includes an invoice_url that can be sent to the customer to pay.
 */
export async function createDraftOrder(input: DraftOrderInput) {
  const { token, base } = shopifyConfig();

  const line_items = input.lineItems.map((li) =>
    li.variant_id
      ? { variant_id: li.variant_id, quantity: li.quantity }
      : { title: li.title || "Item", price: (li.price ?? 0).toFixed(2), quantity: li.quantity }
  );

  const draft_order: Record<string, unknown> = { line_items };
  if (input.email) draft_order.email = input.email;
  if (input.note) draft_order.note = input.note;
  if (input.discountPct && input.discountPct > 0) {
    draft_order.applied_discount = {
      title: input.discountCode || "Discount",
      description: "Call-center recovery discount",
      value_type: "percentage",
      value: String(input.discountPct),
    };
  }

  const res = await fetch(`${base}/draft_orders.json`, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ draft_order }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify draft order ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as { draft_order: { id: number; name: string; invoice_url: string; total_price: string } };
  return data.draft_order;
}

/** Map a Shopify order into our `orders` table row shape. */
export function toOrderRow(o: ShopifyOrder) {
  const totalItems = o.line_items.reduce((s, li) => s + (li.quantity || 0), 0);
  const customerName = o.customer
    ? `${o.customer.first_name ?? ""} ${o.customer.last_name ?? ""}`.trim()
    : null;

  return {
    id: o.id,
    order_number: o.name,
    created_at: o.created_at,
    processed_at: o.processed_at,
    source_name: o.source_name,
    financial_status: o.financial_status,
    fulfillment_status: o.fulfillment_status,
    currency: o.currency,
    total_price: Number(o.total_price || 0),
    // net sales = current total after refunds/edits (falls back to total_price)
    net_sales: Number(o.current_total_price ?? o.total_price ?? 0),
    subtotal_price: Number(o.subtotal_price || 0),
    total_discounts: Number(o.total_discounts || 0),
    total_tax: Number(o.total_tax || 0),
    total_items: totalItems,
    customer_email: o.email,
    customer_name: customerName || null,
    cancelled_at: o.cancelled_at,
    channel: channelOf(o),
    // Shopify returns created_at in the store's timezone (with offset),
    // so slicing the date portion gives the correct store-local date.
    order_date: o.created_at.slice(0, 10),
    raw: o as unknown as Record<string, unknown>,
  };
}

interface ShopifyAddress {
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  zip?: string | null;
}

export interface AbandonedCheckout {
  id: number;
  name: string | null; // e.g. "#1234"
  created_at: string;
  email: string | null;
  phone: string | null;
  currency: string;
  total_price: string;
  abandoned_checkout_url: string;
  customer: {
    first_name?: string;
    last_name?: string;
    phone?: string | null;
    email?: string | null;
  } | null;
  billing_address: ShopifyAddress | null;
  shipping_address: ShopifyAddress | null;
  line_items: {
    title: string;
    variant_title: string | null;
    quantity: number;
    price: string;
    product_id: number | null;
    variant_id: number | null;
  }[];
}

/**
 * Fetch abandoned checkouts (carts that reached checkout but didn't convert).
 * Follows pagination up to `maxPages` to stay within time limits.
 */
export async function fetchAbandonedCheckouts(maxPages = 4): Promise<AbandonedCheckout[]> {
  const { token, base } = shopifyConfig();
  const params = new URLSearchParams({ limit: "250", status: "open" });
  let url: string | null = `${base}/checkouts.json?${params.toString()}`;
  const all: AbandonedCheckout[] = [];
  let pages = 0;

  while (url && pages < maxPages) {
    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (res.status === 429) {
      const retry = Number(res.headers.get("Retry-After") || "2");
      await new Promise((r) => setTimeout(r, retry * 1000));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify checkouts ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { checkouts: AbandonedCheckout[] };
    all.push(...data.checkouts);
    url = parseNextLink(res.headers.get("link"));
    pages++;
    if (url) await new Promise((r) => setTimeout(r, 300));
  }
  return all;
}

/**
 * Look up storefront handles for a set of product ids.
 * Returns a map of product_id -> handle (for building /products/{handle} URLs).
 */
export async function fetchProductHandles(ids: number[]): Promise<Record<number, string>> {
  const { token, base } = shopifyConfig();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const out: Record<number, string> = {};

  for (let i = 0; i < unique.length; i += 250) {
    const chunk = unique.slice(i, i + 250);
    const params = new URLSearchParams({
      ids: chunk.join(","),
      fields: "id,handle",
      limit: "250",
    });
    const res = await fetch(`${base}/products.json?${params.toString()}`, {
      headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) continue; // best-effort; skip on error
    const data = (await res.json()) as { products: { id: number; handle: string }[] };
    for (const p of data.products) out[p.id] = p.handle;
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

/** Map a Shopify order's line items into our `order_items` table rows. */
export function toItemRows(o: ShopifyOrder) {
  const orderDate = o.created_at.slice(0, 10); // YYYY-MM-DD
  return o.line_items.map((li) => ({
    id: li.id,
    order_id: o.id,
    product_id: li.product_id,
    variant_id: li.variant_id,
    title: li.title,
    variant_title: li.variant_title,
    sku: li.sku,
    quantity: li.quantity || 0,
    price: Number(li.price || 0),
    order_date: orderDate,
    source_name: o.source_name,
  }));
}
