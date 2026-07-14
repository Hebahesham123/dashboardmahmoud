import { NextRequest, NextResponse } from "next/server";
import { fetchOdooInvoices, odooConfig } from "@/lib/odoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

/**
 * Per-invoice offline (استهلاكي) detail from the Odoo NS Home endpoint.
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD (default last 30 days). ?includeOnline=1 to
 * also include the "shopify" branch (online). Groups invoice lines by number.
 */
export async function GET(req: NextRequest) {
  try {
    const { filter, excludeBranches } = odooConfig();
    const to = req.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);
    const from =
      req.nextUrl.searchParams.get("from") ||
      (() => {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - 30);
        return d.toISOString().slice(0, 10);
      })();
    const includeOnline = req.nextUrl.searchParams.get("includeOnline") === "1";

    const rows = await fetchOdooInvoices(from, to);
    const f = filter.trim().toLowerCase();
    const skip = new Set(includeOnline ? [] : excludeBranches.map((b) => b.toLowerCase()));

    const map = new Map<string, OfflineInvoice>();
    for (const r of rows) {
      if (f && !(r.customer_type ?? "").toLowerCase().includes(f)) continue;
      if (skip.size && skip.has((r.branch ?? "").toLowerCase())) continue;
      const key = r.invoice_number;
      if (!key) continue;
      let inv = map.get(key);
      if (!inv) {
        inv = {
          invoice_number: key,
          invoice_date: (r.invoice_date ?? "").slice(0, 10),
          customer_name: r.customer_name ?? "",
          branch: r.branch ?? "",
          salesperson: r.salesperson ?? "",
          amount: 0,
          items: 0,
          lines: [],
        };
        map.set(key, inv);
      }
      inv.amount += Number(r.price_total || 0);
      inv.items += Number(r.qty || 0);
      inv.lines.push({
        product_name: r.product_name ?? "",
        attribute_name: r.attribute_name ?? "",
        qty: Number(r.qty || 0),
        price_total: Number(r.price_total || 0),
        category: r.product_category ?? "",
      });
    }

    const invoices = [...map.values()].sort(
      (a, b) =>
        b.invoice_date.localeCompare(a.invoice_date) ||
        a.invoice_number.localeCompare(b.invoice_number)
    );

    return NextResponse.json({
      ok: true,
      from,
      to,
      count: invoices.length,
      amount: invoices.reduce((s, i) => s + i.amount, 0),
      items: invoices.reduce((s, i) => s + i.items, 0),
      invoices,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
