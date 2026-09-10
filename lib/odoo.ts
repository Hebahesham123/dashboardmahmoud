/** Odoo CDS Analytics Integration — offline (استهلاكي) invoice data. */

export function odooConfig() {
  const base = process.env.ODOO_API_URL || process.env.ODOO_BASE_URL;
  const key = process.env.ODOO_API_TOKEN || process.env.ODOO_API_KEY;
  // Empty (default) = include ALL customer types (استهلاكي + تجاري), matching
  // the ops sheet. Set ODOO_CUSTOMER_FILTER to restrict to one type.
  const filter = process.env.ODOO_CUSTOMER_FILTER ?? "";
  const path = process.env.ODOO_INVOICES_PATH || "/api/nshome/invoices";
  // Branches that are actually ONLINE (Shopify) — excluded from offline totals
  // so we don't double-count orders already in the Shopify online numbers.
  const excludeBranches = (process.env.ODOO_EXCLUDE_BRANCH ?? "shopify")
    .split(",")
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean);
  if (!base || !key) {
    throw new Error("ODOO_API_URL / ODOO_API_TOKEN are not set in the environment.");
  }
  if (!/^https?:\/\//i.test(base)) {
    throw new Error(
      `ODOO_API_URL must be the full https URL (got "${base}"). It looks like the URL and token env vars are swapped in Vercel.`
    );
  }
  return { base: base.replace(/\/+$/, ""), key, filter, path, excludeBranches };
}

/**
 * The cashback report (ns_loyalty_cashback) lives on the same Odoo server but
 * behind its own analytics token, so it needs its own key.
 */
export function cashbackConfig() {
  const { base } = odooConfig();
  const key = process.env.ODOO_CASHBACK_TOKEN;
  const path = process.env.ODOO_CASHBACK_PATH || "/api/analytics/cashback-report";
  if (!key) throw new Error("ODOO_CASHBACK_TOKEN is not set in the environment.");
  return { base, key, path };
}

/** One coupon from /api/analytics/cashback-report. */
export interface OdooCashbackCoupon {
  id: number;
  date: string; // order confirmation datetime, "YYYY-MM-DD HH:mm:ss"
  customer_id: number | null;
  customer_name: string | null;
  phone: string | null;
  code: string;
  salesperson: string | null;
  branch: string | null;
  discount_amount: number; // cashback earned (5% of the invoice)
  invoice_id: number | null;
  invoice_number: string | null;
  invoice_amount: number;
  used: boolean;
  currency: string | null;
}

/**
 * Fetch cashback coupons issued between two dates (paginated).
 * Dates filter on the order confirmation date, same as the invoices endpoint.
 */
export async function fetchCashbackCoupons(
  dateFrom: string,
  dateTo: string
): Promise<OdooCashbackCoupon[]> {
  const { base, key, path } = cashbackConfig();
  const all: OdooCashbackCoupon[] = [];
  let page = 1;
  const limit = 500; // the endpoint caps at 500

  for (let guard = 0; guard < 1000; guard++) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "API-Key": key },
      body: JSON.stringify({ page, limit, date_from: dateFrom, date_to: dateTo }),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Odoo cashback ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const j = await res.json();
    // JSON-RPC wrapper, same as the invoices endpoint.
    const payload = (j.result ?? j) as {
      status: string;
      error?: string;
      data?: OdooCashbackCoupon[];
      pagination?: { page: number; total_pages: number };
    };
    if (payload.status !== "success") throw new Error(payload.error || "Odoo returned an error");
    all.push(...(payload.data ?? []));
    const p = payload.pagination;
    if (!p || page >= p.total_pages) break;
    page += 1;
  }
  return all;
}

/** Coupon → cashback_coupons row. Drops anything without a code or a date. */
export function toCashbackRow(c: OdooCashbackCoupon) {
  const day = (c.date ?? "").slice(0, 10);
  const code = (c.code ?? "").trim();
  if (!day || !code) return null;
  return {
    id: c.id,
    // Odoo sends a naive datetime in UTC; make that explicit for timestamptz.
    issued_at: `${(c.date ?? "").slice(0, 19).replace(" ", "T")}Z`,
    issued_day: day,
    branch: c.branch ?? null,
    code,
    customer_id: c.customer_id ?? null,
    customer_name: c.customer_name ?? null,
    phone: c.phone ?? null,
    salesperson: c.salesperson ?? null,
    discount_amount: Number(c.discount_amount || 0),
    invoice_id: c.invoice_id ?? null,
    invoice_number: c.invoice_number ?? null,
    invoice_amount: Number(c.invoice_amount || 0),
    used: Boolean(c.used),
    currency: c.currency ?? null,
  };
}

export interface OdooInvoiceLine {
  invoice_number: string;
  invoice_date: string;
  salesperson: string;
  customer_name: string;
  customer_id: number;
  product_name: string;
  product_id: number;
  attribute_name?: string;
  pricelist?: string;
  qty: number;
  price_total: number;
  product_category: string;
  customer_type: string;
  customer_type_id: number;
  branch: string;
}

/** Fetch all invoice lines from Odoo between two dates (paginated). */
export async function fetchOdooInvoices(dateFrom: string, dateTo: string): Promise<OdooInvoiceLine[]> {
  const { base, key, path } = odooConfig();
  const all: OdooInvoiceLine[] = [];
  let page = 1;
  const limit = 500;

  for (let guard = 0; guard < 1000; guard++) {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "API-Key": key },
      // Send the filters directly in the body (the endpoint ignores a
      // `params` wrapper). date_from/date_to must be applied server-side.
      body: JSON.stringify({ page, limit, date_from: dateFrom, date_to: dateTo }),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Odoo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const j = await res.json();
    // Response is wrapped in `result` (JSON-RPC style); tolerate both shapes.
    const payload = (j.result ?? j) as {
      status: string;
      error?: string;
      data?: OdooInvoiceLine[];
      pagination?: { page: number; total_pages: number };
    };
    if (payload.status !== "success") throw new Error(payload.error || "Odoo returned an error");
    all.push(...(payload.data ?? []));
    const p = payload.pagination;
    if (!p || page >= p.total_pages) break;
    page += 1;
  }
  return all;
}

/**
 * Refund / credit-note invoices use an "R" prefix in Odoo (e.g. RMAADI/…,
 * RAS-SL/…) while sales invoices are MAADI/…, AS-SL/…, SHPFY/…. The API sends
 * their price_total as POSITIVE, so we flip the sign to subtract refunds.
 */
export function isRefund(invoiceNumber: string): boolean {
  return /^r/i.test((invoiceNumber ?? "").trim());
}
/** price_total signed negative for refunds. */
export function signedTotal(row: { invoice_number: string; price_total: number }): number {
  const v = Number(row.price_total || 0);
  return isRefund(row.invoice_number) ? -Math.abs(v) : v;
}

export interface OfflineDay {
  day: string;
  invoices: number;
  amount: number;
  items: number;
}

export interface OfflineBranchDay {
  day: string;
  branch: string;
  orders: number;
  value: number;
}

/**
 * Per-day, per-branch offline totals (online/shopify branch excluded).
 * orders = distinct non-refund invoices; value = refund-signed sum.
 * Stored in offline_branch_sales so the Summary page reads Supabase (fast)
 * instead of hitting Odoo live (which times out on Vercel).
 */
export function aggregateOfflineByBranch(
  rows: OdooInvoiceLine[],
  filter: string,
  excludeBranches: string[] = []
): OfflineBranchDay[] {
  const f = filter.trim().toLowerCase();
  const skip = new Set(excludeBranches.map((b) => b.toLowerCase()));
  const map = new Map<string, { orders: Set<string>; value: number }>();
  for (const r of rows) {
    if (f && !(r.customer_type ?? "").toLowerCase().includes(f)) continue;
    if (skip.size && skip.has((r.branch ?? "").toLowerCase())) continue;
    const day = (r.invoice_date ?? "").slice(0, 10);
    const branch = r.branch ?? "";
    if (!day || !branch) continue;
    const key = `${day}|${branch}`;
    const e = map.get(key) ?? { orders: new Set<string>(), value: 0 };
    const refund = isRefund(r.invoice_number);
    e.value += Number(r.price_total || 0) * (refund ? -1 : 1);
    if (r.invoice_number && !refund) e.orders.add(r.invoice_number);
    map.set(key, e);
  }
  return [...map.entries()].map(([k, e]) => {
    const [day, branch] = k.split("|");
    return { day, branch, orders: e.orders.size, value: e.value };
  });
}

/**
 * Aggregate invoice lines into daily offline totals for the given customer
 * type (matched on the customer_type field). Invoices = distinct
 * invoice_number per day; amount = Σ price_total; items = Σ qty.
 */
export function aggregateOffline(
  rows: OdooInvoiceLine[],
  filter: string,
  excludeBranches: string[] = []
): OfflineDay[] {
  const f = filter.trim().toLowerCase();
  const skip = new Set(excludeBranches.map((b) => b.toLowerCase()));
  const byDay = new Map<string, { amount: number; items: number; invoices: Set<string> }>();
  for (const r of rows) {
    if (f && !(r.customer_type ?? "").toLowerCase().includes(f)) continue;
    // Skip ONLINE branches (Shopify) — those are already in the online numbers.
    if (skip.size && skip.has((r.branch ?? "").toLowerCase())) continue;
    const day = (r.invoice_date ?? "").slice(0, 10);
    if (!day) continue;
    const e = byDay.get(day) ?? { amount: 0, items: 0, invoices: new Set<string>() };
    const refund = isRefund(r.invoice_number);
    const sign = refund ? -1 : 1;
    e.amount += Number(r.price_total || 0) * sign;
    e.items += Number(r.qty || 0) * sign;
    // Count sales invoices only; refunds subtract from amount but aren't "orders".
    if (r.invoice_number && !refund) e.invoices.add(r.invoice_number);
    byDay.set(day, e);
  }
  return [...byDay.entries()]
    .map(([day, e]) => ({ day, invoices: e.invoices.size, amount: e.amount, items: e.items }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
