import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Shopify orders for a day or a range, newest first.
 * ?day=YYYY-MM-DD, or ?from=&to=. ?limit= caps the rows (default 500);
 * the export asks for everything, so it passes a high limit.
 */

/** Auto-issued cashback vouchers look like "0448-3aae-4127". */
const CASHBACK_RE = new RegExp(
  process.env.CASHBACK_CODE_PATTERN || "^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$|cashback",
  "i"
);

export interface OrderRow {
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
  discount_codes: string[];
  cashback: boolean; // paid, wholly or partly, with a cashback voucher
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const day = sp.get("day");
    const from = sp.get("from") || day || new Date().toISOString().slice(0, 10);
    const to = sp.get("to") || day || from;
    const limit = Math.min(Number(sp.get("limit")) || 500, 5000);

    const sb = createServiceClient();
    const { data, error } = await sb
      .from("orders")
      .select(
        "id,order_number,order_date,created_at,customer_name,customer_email,financial_status,fulfillment_status,total_items,total_price,total_discounts,net_sales,currency,cancelled_at,codes:raw->discount_codes"
      )
      .gte("order_date", from)
      .lte("order_date", to)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);

    const rows: OrderRow[] = ((data ?? []) as Record<string, unknown>[]).map((o) => {
      const codes = ((o.codes as { code?: string }[] | null) ?? [])
        .map((d) => (d?.code ?? "").trim())
        .filter(Boolean);
      return {
        id: Number(o.id),
        order_number: (o.order_number as string) ?? null,
        order_date: String(o.order_date ?? "").slice(0, 10),
        created_at: String(o.created_at ?? ""),
        customer_name: (o.customer_name as string) ?? null,
        customer_email: (o.customer_email as string) ?? null,
        financial_status: (o.financial_status as string) ?? null,
        fulfillment_status: (o.fulfillment_status as string) ?? null,
        items: Number(o.total_items || 0),
        total_price: Number(o.total_price || 0),
        total_discounts: Number(o.total_discounts || 0),
        net_sales: Number(o.net_sales || 0),
        currency: (o.currency as string) ?? null,
        cancelled: Boolean(o.cancelled_at),
        discount_codes: codes,
        cashback: codes.some((c) => CASHBACK_RE.test(c)),
      };
    });

    return NextResponse.json({
      ok: true,
      from,
      to,
      count: rows.length,
      truncated: rows.length >= limit,
      totals: {
        orders: rows.length,
        items: rows.reduce((s, r) => s + r.items, 0),
        total_price: rows.reduce((s, r) => s + r.total_price, 0),
        total_discounts: rows.reduce((s, r) => s + r.total_discounts, 0),
        net_sales: rows.reduce((s, r) => s + r.net_sales, 0),
      },
      orders: rows,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
