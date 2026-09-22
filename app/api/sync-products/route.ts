import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { fetchAnalyticsInvoices, aggregateProductSales } from "@/lib/odoo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sync NS Home product sales by category into product_sales.
 * Protected by CRON_SECRET (Bearer header or ?secret=).
 *
 * The analytics feed carries every branch plus shopify, and roughly half a
 * million lines since 2025, so the rolling window is deliberately small.
 * Use scripts/backfill-products.ts for history.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const urlSecret = req.nextUrl.searchParams.get("secret");
  const uiSync = req.headers.get("x-ui-sync") === "1";
  if (secret && !(auth === `Bearer ${secret}` || urlSecret === secret || uiSync)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const days = Number(req.nextUrl.searchParams.get("days")) || 3;
  const to = req.nextUrl.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const from =
    req.nextUrl.searchParams.get("from") ||
    (() => {
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().slice(0, 10);
    })();

  try {
    const lines = await fetchAnalyticsInvoices(from, to);
    const rows = aggregateProductSales(lines);

    const sb = createServiceClient();
    const now = new Date().toISOString();

    // Same reason as offline_branch_sales: the key carries the branch name, so
    // a renamed shop would leave its old rows behind to be counted twice.
    const { error: delErr } = await sb.from("product_sales").delete().gte("day", from).lte("day", to);
    if (delErr) throw new Error(`product_sales clear: ${delErr.message}`);

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now }));
      const { error } = await sb
        .from("product_sales")
        .upsert(chunk, { onConflict: "day,branch,product_id" });
      if (error) throw new Error(`product_sales upsert: ${error.message}`);
      upserted += chunk.length;
    }

    return NextResponse.json({
      ok: true,
      from,
      to,
      lines: lines.length,
      upserted,
      units: rows.reduce((s, r) => s + r.qty, 0),
      value: rows.reduce((s, r) => s + r.value, 0),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
