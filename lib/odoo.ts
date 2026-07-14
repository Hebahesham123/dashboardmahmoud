/** Odoo CDS Analytics Integration — offline (استهلاكي) invoice data. */

export function odooConfig() {
  const base = process.env.ODOO_API_URL || process.env.ODOO_BASE_URL;
  const key = process.env.ODOO_API_TOKEN || process.env.ODOO_API_KEY;
  const filter = process.env.ODOO_CUSTOMER_FILTER ?? "استهلاكي";
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
  return { base: base.replace(/\/+$/, ""), key, filter, path, excludeBranches };
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

export interface OfflineDay {
  day: string;
  invoices: number;
  amount: number;
  items: number;
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
    e.amount += Number(r.price_total || 0);
    e.items += Number(r.qty || 0);
    if (r.invoice_number) e.invoices.add(r.invoice_number);
    byDay.set(day, e);
  }
  return [...byDay.entries()]
    .map(([day, e]) => ({ day, invoices: e.invoices.size, amount: e.amount, items: e.items }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
